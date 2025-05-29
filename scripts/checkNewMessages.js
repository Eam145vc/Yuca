require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const TelegramBot = require('node-telegram-bot-api');

// --- Configuration & Constants ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const cookiePath = path.join(__dirname, '../data/cookies.json');
const businessDataPath = path.join(__dirname, '../data/business_data.json');
const qaLogPath = path.join(__dirname, '../data/qa_log.json');
const threadStatePath = path.join(__dirname, '../data/thread_states.json');

const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let conversationHistory = [];
let currentChatGuestName = null;
let currentThreadId = null; // Set once from chatUrl

const MESSAGE_NODE_SELECTOR = 'div.t12j2ntd';
const AIRBNB_INPUT_SELECTOR = '[data-testid="messaging-composebar"]';
const GUEST_NAME_HEADER_BUTTON_SELECTOR = 'button[data-testid="thread-header-title-button"]';

const ASK_HOST_SIGNAL = "##ASK_HOST##";
const SAVE_PAUTA_SIGNAL = "##SAVE_PAUTA##";
const DISCARD_PAUTA_SIGNAL = "##DISCARD_PAUTA##";

const MAX_IDLE_TIME = 5 * 60 * 1000;
const CHECK_INTERVAL = 15000;
const HOST_REQUEST_TIMEOUT = 24 * 60 * 60 * 1000;

// --- ESTADO PERSISTENTE ---
function loadThreadStates() {
    try {
        if (!fs.existsSync(threadStatePath)) {
            fs.writeFileSync(threadStatePath, JSON.stringify({}, null, 2), 'utf-8');
            return {};
        }
        return JSON.parse(fs.readFileSync(threadStatePath, 'utf-8'));
    } catch (error) { console.error('❌ Error loading thread_states.json:', error.message); return {}; }
}

function saveThreadStates(states) {
    try {
        fs.writeFileSync(threadStatePath, JSON.stringify(states, null, 2), 'utf-8');
    } catch (error) { console.error('❌ Error saving thread_states.json:', error.message); }
}

function addPendingHostRequest(threadId, guestMessage, guestName) {
    const states = loadThreadStates();
    if (!states[threadId]) {
        states[threadId] = { pendingHostRequests: [] }; // Removed unprocessedMessages here, seems unused
    }
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const request = { id: requestId, guestMessage, guestName, timestamp: new Date().toISOString(), status: 'waiting' };
    states[threadId].pendingHostRequests.push(request);
    // states[threadId].lastActivity = new Date().toISOString(); // lastActivity is for the main loop
    saveThreadStates(states);
    console.log(`[T:${threadId}] 📝 Added pending host request: ${requestId}`);
    return requestId;
}

function updateHostRequestStatus(requestId, status, hostResponse = null) {
    const states = loadThreadStates();
    for (const threadId in states) {
        if (states[threadId].pendingHostRequests) {
            const request = states[threadId].pendingHostRequests.find(req => req.id === requestId);
            if (request) {
                request.status = status;
                if (hostResponse) request.hostResponse = hostResponse;
                request.respondedAt = new Date().toISOString();
                saveThreadStates(states);
                console.log(`[T:${threadId}] ✅ Host request ${requestId} status: ${status}`);
                return threadId;
            }
        }
    }
    return null;
}

function cleanupExpiredRequests(threadId) {
    if (!threadId) return; // Ensure threadId is defined
    const states = loadThreadStates();
    if (!states[threadId] || !states[threadId].pendingHostRequests) return;
    
    const now = Date.now();
    const initialCount = states[threadId].pendingHostRequests.length;
    states[threadId].pendingHostRequests = states[threadId].pendingHostRequests.filter(req => 
        (now - new Date(req.timestamp).getTime()) < HOST_REQUEST_TIMEOUT
    );
    if (states[threadId].pendingHostRequests.length < initialCount) {
        console.log(`[T:${threadId}] 🧹 Cleaned ${initialCount - states[threadId].pendingHostRequests.length} expired host requests.`);
        saveThreadStates(states);
    }
}

// --- DETECCIÓN MEJORADA DE MENSAJES ---
async function getAllNewMessagesToProcess(page) { // Removed threadId param, use global currentThreadId
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for DOM to settle

    const allMessagesData = await page.evaluate((msgSelector) => {
        const messages = [];
        const HOST_MESSAGE_COLOR_HEX = '#3f3f3f', GUEST_MESSAGE_COLOR_HEX = '#f7f7f7';
        const HOST_MESSAGE_COLOR_RGB = 'rgb(63, 63, 63)', GUEST_MESSAGE_COLOR_RGB = 'rgb(247, 247, 247)';
        
        document.querySelectorAll(msgSelector).forEach(el => {
            const rect = el.getBoundingClientRect();
            const text = el.innerText.trim();
            if (text.length === 0) return;

            let messageBackgroundColor = null, currentElement = el;
            for (let i = 0; i < 5 && currentElement; i++) {
                const styles = window.getComputedStyle(currentElement);
                const bgColor = styles.backgroundColor;
                let hexColor = null;
                if (bgColor?.startsWith('rgb')) {
                    const rgbMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                    if (rgbMatch) hexColor = `#${parseInt(rgbMatch[1]).toString(16).padStart(2, '0')}${parseInt(rgbMatch[2]).toString(16).padStart(2, '0')}${parseInt(rgbMatch[3]).toString(16).padStart(2, '0')}`;
                }
                if (hexColor === HOST_MESSAGE_COLOR_HEX || bgColor === HOST_MESSAGE_COLOR_RGB) { messageBackgroundColor = 'host'; break; }
                if (hexColor === GUEST_MESSAGE_COLOR_HEX || bgColor === GUEST_MESSAGE_COLOR_RGB) { messageBackgroundColor = 'guest'; break; }
                currentElement = currentElement.parentElement;
            }
            
            let isFromBot = false, isFromGuest = false, detectionMethod = 'unknown';
            if (messageBackgroundColor === 'host') { isFromBot = true; detectionMethod = 'color_host'; }
            else if (messageBackgroundColor === 'guest') { isFromGuest = true; detectionMethod = 'color_guest'; }
            else { // Fallback
                const isClearlyBotResponse = /^(¡Buenos días|¡Buenas tardes|¡Buenas noches|¡Hola|Lamentablemente, no|Sí, hay|No, no hay|disponible en la propiedad)/i.test(text);
                isFromBot = isClearlyBotResponse; isFromGuest = !isClearlyBotResponse;
                detectionMethod = isClearlyBotResponse ? 'content_bot' : 'content_guest';
            }
            messages.push({ text, position: rect.top, isFromGuest, isFromBot, jsTimestamp: Date.now(), detectionMethod });
        });
        return messages.sort((a, b) => a.position - b.position);
    }, MESSAGE_NODE_SELECTOR);

    // console.log(`[T:${currentThreadId}] 📊 Found ${allMessagesData.length} total messages.`); // Reduced verbosity

    if (allMessagesData.length === 0) return [];

    let lastBotMessageIndex = -1;
    for (let i = allMessagesData.length - 1; i >= 0; i--) {
        if (allMessagesData[i].isFromBot) {
            lastBotMessageIndex = i;
            // console.log(`[T:${currentThreadId}] 📍 Last bot message at index ${i} (method: ${allMessagesData[i].detectionMethod})`); // Reduced
            break;
        }
    }
    if (lastBotMessageIndex === -1) console.log(`[T:${currentThreadId}] ⚠️ No bot messages found. Processing all guest messages.`);

    const newGuestMessages = allMessagesData
        .slice(lastBotMessageIndex + 1)
        .filter(msg => msg.isFromGuest && msg.text.length > 3); // Min length filter

    if (newGuestMessages.length > 0) {
        console.log(`[T:${currentThreadId}] 📬 Found ${newGuestMessages.length} potential new guest messages.`);
        // newGuestMessages.forEach((msg, i) => console.log(`  ${i}: "${msg.text.substring(0,40)}..." (method: ${msg.detectionMethod})`)); // Can be noisy
    }
    
    const unprocessedMessages = newGuestMessages.filter(newMsg => 
        !conversationHistory.some(histMsg => histMsg.role === 'user' && histMsg.content === newMsg.text)
    );

    if (unprocessedMessages.length > 0 && newGuestMessages.length > 0) { // Log only if there was a change
        console.log(`[T:${currentThreadId}] 🆕 ${unprocessedMessages.length} messages are truly new (not in history).`);
    }
    
    return unprocessedMessages.map(msg => ({ text: msg.text, guestName: currentChatGuestName, jsTimestamp: msg.jsTimestamp }));
}

// --- ENVÍO ASÍNCRONO AL HOST ---
async function sendToHostAsync(guestMessage, guestName) { // Removed threadId, use global
    if (!process.env.TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return null; 
    const tempBot = new TelegramBot(process.env.TELEGRAM_TOKEN);
    const requestId = addPendingHostRequest(currentThreadId, guestMessage, guestName); // Use global currentThreadId
    
    try {
        await tempBot.sendMessage(TELEGRAM_CHAT_ID, 
            `❓ *${guestName || 'Un huésped'}* (Thread: ${currentThreadId}) necesita ayuda con:\n\n"${guestMessage}"\n\n✍️ Responde a este mensaje.\n\n🔗 ID: ${requestId}`, 
            { parse_mode: 'Markdown' }
        );
        console.log(`[T:${currentThreadId}] 📤 Sent async request to host: ${requestId}`);
        if (process.send) {
            process.send({ type: 'asyncHostRequest', requestId, threadId: currentThreadId, guestMessage, guestName });
        }
        return requestId;
    } catch (error) { console.error(`[T:${currentThreadId}] Error sending Telegram message for ${requestId}:`, error.message); return null; }
}

// --- PROCESAMIENTO DE RESPUESTAS DEL HOST ---
async function processAnsweredHostRequests(page) { // Removed threadId, use global
    if (!currentThreadId) return 0;
    const states = loadThreadStates();
    if (!states[currentThreadId] || !states[currentThreadId].pendingHostRequests) return 0;
    
    const answeredRequests = states[currentThreadId].pendingHostRequests.filter(req => req.status === 'answered');
    if (answeredRequests.length > 0) {
        console.log(`[T:${currentThreadId}] 📊 Found ${answeredRequests.length} answered host requests.`);
    }
    
    let processedCount = 0;
    for (const request of answeredRequests) {
        console.log(`[T:${currentThreadId}] 🔄 Processing host response for ${request.id}: "${request.hostResponse.substring(0,50)}..."`);
        const refinedResponse = await refineHostResponseForGuest(request.hostResponse, request.guestMessage);
        if (refinedResponse) {
            const success = await sendMessageToGuest(page, refinedResponse, conversationHistory);
            if (success) {
                states[currentThreadId].pendingHostRequests = states[currentThreadId].pendingHostRequests.filter(req => req.id !== request.id);
                processedCount++;
                console.log(`[T:${currentThreadId}] ✅ Host response for ${request.id} sent to guest.`);
            } else console.error(`[T:${currentThreadId}] ❌ Failed to send host response for ${request.id} to guest.`);
        } else console.error(`[T:${currentThreadId}] ❌ Failed to refine host response for ${request.id}.`);
    }
    
    if (processedCount > 0) {
        saveThreadStates(states);
        // console.log(`[T:${currentThreadId}] 💾 Saved thread states after processing ${processedCount} host responses.`); // A bit verbose
    }
    return processedCount;
}

// --- FUNCIONES AUXILIARES --- (loadCookies, loadBusinessData, loadQaLog, saveQaEntry, askOpenAI are mostly unchanged)
async function loadCookies(page) { /* ... */ try {const s=fs.readFileSync(cookiePath,'utf-8'); await page.setCookie(...JSON.parse(s)); console.log(`[T:${currentThreadId}] 🍪 Cookies loaded.`);}catch(e){console.error(`[T:${currentThreadId}] ❌ Error loading cookies:`,e.message); throw e;}}
function loadBusinessData() { /* ... */ try {if(!fs.existsSync(businessDataPath)) fs.writeFileSync(businessDataPath,'{}'); return JSON.parse(fs.readFileSync(businessDataPath,'utf-8'));}catch(e){console.error(`[T:${currentThreadId}] ❌ Error loading business_data:`,e.message);return{};}}
function loadQaLog() { /* ... */ try {if(!fs.existsSync(qaLogPath)) fs.writeFileSync(qaLogPath,'[]'); return JSON.parse(fs.readFileSync(qaLogPath,'utf-8'));}catch(e){console.error(`[T:${currentThreadId}] ❌ Error loading qa_log:`,e.message);return[];}}
function saveQaEntry(q, a) { /* ... */ try {const l=loadQaLog();l.push({guest_question:q,bot_answer:a}); fs.writeFileSync(qaLogPath,JSON.stringify(l,null,2)); console.log(`[T:${currentThreadId}] 💾 Q&A entry saved.`);}catch(e){console.error(`[T:${currentThreadId}] ❌ Error saving Q&A:`,e.message);}}
async function askOpenAI(messages, model = 'gpt-3.5-turbo', temperature = 0.5, max_tokens = 300) { try { const r = await openai.chat.completions.create({ model, messages, temperature, max_tokens }); return r.choices[0].message.content.trim(); } catch (e) { console.error(`[T:${currentThreadId}] ❌ OpenAI Error:`, e.message); return null; } }


// --- FUNCIONES DE TIEMPO Y SALUDOS ---
function getCurrentTimeInColombia() { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' }).format(new Date()); }
function getTimeOfDay(currentTimeHHMM) { if (!currentTimeHHMM?.includes(':')) return 'generic'; try { const h = parseInt(currentTimeHHMM.split(':')[0]); if (isNaN(h)) return 'generic'; if (h >= 5 && h < 12) return 'morning'; if (h >= 12 && h < 19) return 'afternoon'; return 'evening'; } catch (e) { return 'generic'; } }

async function getSalutation(isNewInteraction, guestMessageText, guestName) {
    const effectiveGuestName = guestName || "there";
    if (!isNewInteraction) return "";
    const colombiaTimeHHMM = getCurrentTimeInColombia(); const timeOfDay = getTimeOfDay(colombiaTimeHHMM);
    const systemPrompt = `Generate a brief, natural greeting in the guest's language. Guest name: '${effectiveGuestName}'. Time: ${timeOfDay} (${colombiaTimeHHMM}). Spanish patterns: morning:"¡Buenos días...", afternoon:"¡Buenas tardes...", evening:"¡Buenas noches...", generic:"¡Hola...". English similar. ONLY the greeting text + space.`;
    let greeting = await askOpenAI([{role:'system',content:systemPrompt},{role:'user',content:`Guest: "${guestMessageText}"`}], 'gpt-3.5-turbo',0.7,45);
    if (!greeting || greeting.length < 2) { // Fallback
        const names = effectiveGuestName !== 'there' ? ' ' + effectiveGuestName : '';
        if (timeOfDay === 'morning') greeting = `¡Buenos días${names}! `; else if (timeOfDay === 'afternoon') greeting = `¡Buenas tardes${names}! `;
        else if (timeOfDay === 'evening') greeting = `¡Buenas noches${names}! `; else greeting = `¡Hola${names}! `;
    } else if (!greeting.endsWith(" ")) greeting += " ";
    return greeting;
}

// --- RESPUESTA DEL BOT ---
async function getBotResponse(guestMessageText, businessData, qaLog, currentConversationHistory) {
    const recentHistory = currentConversationHistory.slice(-4); 
    const systemPrompt = `You are an AI for "Smoke to Go, Laureles Medellín". Answer using ONLY provided data or say "${ASK_HOST_SIGNAL}". Data: ${JSON.stringify(businessData)}. Q&A: ${JSON.stringify(qaLog)}. History: ${recentHistory.map(m=>`${m.role}:${m.content}`).join('\n')||"None."}`;
    return askOpenAI([{role:'system',content:systemPrompt},{role:'user',content:`Guest: "${guestMessageText}"`}], 'gpt-4o-mini',0.20,370);
}
async function refineHostResponseForGuest(hostRawResponse, guestOriginalMessage) {
    const systemPrompt = `Refine host's raw response into a natural, empathetic message as if YOU are the host. Guest Q: "${guestOriginalMessage}". Host raw answer: "${hostRawResponse}". Respond in guest's language.`;
    return askOpenAI([{role:'system',content:systemPrompt},{role:'user',content:`Refine: "${hostRawResponse}"`}], 'gpt-4o-mini',0.5,300);
}
async function shouldSaveToPautas(guestQuestion, botAnswer) {
    if (botAnswer.includes(ASK_HOST_SIGNAL)||botAnswer.length<15||loadQaLog().some(e=>e.guest_question.toLowerCase().includes(guestQuestion.toLowerCase())||guestQuestion.toLowerCase().includes(e.guest_question.toLowerCase())))return false;
    const systemPrompt = `Save this Q&A? Respond ONLY "${SAVE_PAUTA_SIGNAL}" or "${DISCARD_PAUTA_SIGNAL}". Q:"${guestQuestion}" A:"${botAnswer}"`;
    return await askOpenAI([{role:'system',content:systemPrompt}],'gpt-3.5-turbo',0.3,15) === SAVE_PAUTA_SIGNAL;
}

// --- EXTRACCIÓN Y ENVÍO ---
async function extractGuestNameFromHeader(page) {
    try {
        await page.waitForSelector(GUEST_NAME_HEADER_BUTTON_SELECTOR, { timeout: 3000, visible: true });
        const guestName = await page.evaluate((s) => {
            const btn = document.querySelector(s); if(!btn) return null;
            for (let span of btn.querySelectorAll('span')) { const t=span.innerText?.trim(); if(t&&t.length<30) return t;}
            const btnTxt = btn.innerText?.trim(); if(btnTxt&&btnTxt.length<30) return btnTxt.includes('\n')?btnTxt.split('\n')[0].trim():btnTxt;
            return null;
        }, GUEST_NAME_HEADER_BUTTON_SELECTOR);
        if (guestName) console.log(`[T:${currentThreadId}] 👤 Guest name: ${guestName}`); else console.warn(`[T:${currentThreadId}] ⚠️ Could not extract guest name.`);
        return guestName;
    } catch (e) { console.warn(`[T:${currentThreadId}] ⚠️ Error extracting guest name: ${e.message.split('\n')[0]}`); return null; }
}

async function sendMessageToGuest(page, text, currentConversationHistory) { 
    try {
        await page.waitForSelector(AIRBNB_INPUT_SELECTOR, { visible: true, timeout: 3000 });
        await page.click(AIRBNB_INPUT_SELECTOR);
        await page.evaluate((s)=>{const el=document.querySelector(s); if(el)el.innerHTML='';}, AIRBNB_INPUT_SELECTOR); // Clear
        await page.keyboard.down(process.platform==='darwin'?'Meta':'Control'); await page.keyboard.press('A'); await page.keyboard.up(process.platform==='darwin'?'Meta':'Control'); await page.keyboard.press('Backspace'); // Select all & delete
        await page.type(AIRBNB_INPUT_SELECTOR, text, { delay: 50 }); // Reduced delay
        await new Promise(r=>setTimeout(r,300));
        await page.keyboard.down(process.platform==='darwin'?'Meta':'Control'); await page.keyboard.press('Enter'); await page.keyboard.up(process.platform==='darwin'?'Meta':'Control');
        console.log(`[T:${currentThreadId}] ✅ Response sent to guest.`);
        currentConversationHistory.push({ role:'assistant',content:text,jsTimestamp:Date.now()});
        await new Promise(r=>setTimeout(r,1000)); // Shorter wait after send
        return true;
    } catch (e) { console.error(`[T:${currentThreadId}] ❌ Error sending message: ${e.message.split('\n')[0]}`); return false; }
}

function extractThreadIdFromUrl(url) { try { const u=new URL(url);const p=u.pathname.split('/'); const t=p[p.length-1]; return (t&&/^\d+$/.test(t))?t:null;}catch(e){return null;}}

// --- FUNCIÓN PRINCIPAL CON ARQUITECTURA HÍBRIDA ---
async function processSingleChatThread(chatUrl, initialHistoryJson) {
    if (initialHistoryJson) { try { conversationHistory = JSON.parse(initialHistoryJson); } catch (e) { conversationHistory = []; }} else { conversationHistory = []; }
    currentThreadId = extractThreadIdFromUrl(chatUrl); // Set global currentThreadId
    if (!currentThreadId) { console.error(`❌ Invalid chat URL, no thread ID: ${chatUrl}`); return; }

    console.log(`[T:${currentThreadId}] 🚀 Initializing bot. History: ${conversationHistory.length}`);
    const browser = await puppeteer.launch({ headless: process.env.NODE_ENV === 'production' ? 'new' : false, defaultViewport: null, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/533.36');

    try { await loadCookies(page); } catch (e) { console.error(`[T:${currentThreadId}] Cookie loading failed. Stopping.`); await browser.close(); return; }

    console.log(`[T:${currentThreadId}] 🌍 Navigating to chat...`);
    try {
        await page.goto(chatUrl, { waitUntil: 'networkidle2', timeout: 60000 }); // Reduced timeout
        console.log(`[T:${currentThreadId}] ✅ Chat page loaded.`);
        await new Promise(r => setTimeout(r, 1500)); // Reduced wait
        currentChatGuestName = await extractGuestNameFromHeader(page);
    } catch (e) { console.error(`[T:${currentThreadId}] ❌ Failed to navigate: ${e.message.split('\n')[0]}`); if(browser.isConnected()) await browser.close(); return; }

    let lastActivity = Date.now();
    console.log(`[T:${currentThreadId}] 🔄 Starting processing loop.`);

    while (true) {
        try {
            let hasActivity = false;
            const processedHostResponses = await processAnsweredHostRequests(page);
            if (processedHostResponses > 0) { hasActivity = true; lastActivity = Date.now(); }

            const newMessages = await getAllNewMessagesToProcess(page);
            if (newMessages.length > 0) {
                hasActivity = true; lastActivity = Date.now();
                console.log(`[T:${currentThreadId}] 📨 Processing ${newMessages.length} new message(s).`);
                for (const message of newMessages) {
                    conversationHistory.push({ role:'user',content:message.text,guestName:currentChatGuestName,jsTimestamp:message.jsTimestamp});
                    const botResponse = await getBotResponse(message.text, loadBusinessData(), loadQaLog(), conversationHistory);
                    
                    if (botResponse?.includes(ASK_HOST_SIGNAL)) {
                        console.log(`[T:${currentThreadId}] ❓ Requires host: "${message.text.substring(0,30)}..."`);
                        await sendToHostAsync(message.text, currentChatGuestName);
                    } else if (botResponse) {
                        const isNew = conversationHistory.filter(m=>m.role==='user').length === 1;
                        const salutation = await getSalutation(isNew, message.text, currentChatGuestName);
                        const finalResponse = (salutation + botResponse).trim();
                        if (await sendMessageToGuest(page, finalResponse, conversationHistory)) {
                            if (await shouldSaveToPautas(message.text, botResponse)) saveQaEntry(message.text, botResponse);
                        }
                    } else {
                        console.error(`[T:${currentThreadId}] 🚨 AI failed for: "${message.text.substring(0,30)}..."`);
                        await sendToHostAsync(`Bot error (AI null response): "${message.text}". Assist.`, currentChatGuestName);
                    }
                    await new Promise(r => setTimeout(r, 1500)); // Pause between processing multiple messages
                }
            }
            cleanupExpiredRequests(currentThreadId);

            if (!hasActivity) {
                const idleTime = Date.now() - lastActivity;
                if (idleTime > MAX_IDLE_TIME) {
                    console.log(`[T:${currentThreadId}] ⏰ Idle timeout. Closing.`); break;
                }
                // console.log(`[T:${currentThreadId}] 💤 Idle for ${Math.round(idleTime/1000)}s`); // Can be noisy
            }
            if (process.send) process.send({type:'conversationHistoryUpdate',threadId:currentThreadId,history:conversationHistory});
            await new Promise(r => setTimeout(r, CHECK_INTERVAL));
        } catch (e) { console.error(`[T:${currentThreadId}] ❌ Loop error: ${e.message.split('\n')[0]}`); await new Promise(r=>setTimeout(r,CHECK_INTERVAL));}
    }
    console.log(`[T:${currentThreadId}] 🔚 Closing browser & process.`);
    if (process.send) process.send({type:'conversationHistoryUpdate',threadId:currentThreadId,history:conversationHistory}); // Final history
    if (browser.isConnected()) await browser.close().catch(e => console.error(`[T:${currentThreadId}] Error closing browser: ${e.message}`));
    console.log(`[T:${currentThreadId}] ✅ Process closed.`);
    process.exit(0);
}

// --- LISTENER PARA RESPUESTAS DEL HOST (IPC) ---
if (process.send) { // Ensures this only runs if it's a child process
    process.on('message', (message) => {
        if (message.type === 'hostResponse') {
            const { requestId, text } = message;
            console.log(`[T:${currentThreadId}] 📨 IPC: Host response for ${requestId}`);
            updateHostRequestStatus(requestId, 'answered', text);
        }
    });
}

// --- MAIN EXECUTION ---
const chatUrlFromArg = process.argv[2]; 
const initialHistoryJsonFromArg = process.argv[3];

if (!process.env.OPENAI_API_KEY) { console.error('❌ OPENAI_API_KEY missing.'); process.exit(1); }
if (!chatUrlFromArg) { console.error("Usage: node checkNewMessages.js <chat_url> [initial_history_json]"); process.exit(1); }

processSingleChatThread(chatUrlFromArg, initialHistoryJsonFromArg).catch(err => {
    console.error(`💀 Critical error in child (Thread: ${currentThreadId || 'Unknown'}):`, err);
    if(currentThreadId && process.send){ // Try to notify parent on critical failure
        process.send({type: 'criticalError', threadId: currentThreadId, error: err.message});
    }
    process.exit(1);
});