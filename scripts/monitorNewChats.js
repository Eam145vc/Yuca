require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');

// --- Configuration & Constants ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); 
const cookiePath = path.join(__dirname, '../data/cookies.json');
const threadStatePath = path.join(__dirname, '../data/thread_states.json');
const AIRBNB_UNREAD_MESSAGES_FILTER_URL = 'https://www.airbnb.com.co/guest/messages?unread=1';
const AIRBNB_MESSAGE_BASE_URL = 'https://www.airbnb.com.co/guest/messages/';
const MESSAGE_THREAD_LINK_SELECTOR = 'a[data-testid^="inbox_list_"]';
const CHECK_NEW_MESSAGES_SCRIPT = path.join(__dirname, 'checkNewMessages.js');

if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT_ID || !process.env.OPENAI_API_KEY) {
    console.error('❌ Missing critical environment variables. Check your .env file.');
    process.exit(1);
}

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const processedThreadUrls = new Set();
const conversationHistories = {};
const CONVERSATION_INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const activeChildProcesses = new Map();
const pendingHostResponses = new Map();

// --- FUNCIONES PARA ESTADO PERSISTENTE ---

function loadThreadStates() {
    try {
        if (!fs.existsSync(threadStatePath)) {
            fs.writeFileSync(threadStatePath, JSON.stringify({}, null, 2), 'utf-8');
            return {};
        }
        return JSON.parse(fs.readFileSync(threadStatePath, 'utf-8'));
    } catch (error) {
        console.error('❌ Error loading thread_states.json:', error.message);
        return {};
    }
}

function saveThreadStates(states) {
    try {
        fs.writeFileSync(threadStatePath, JSON.stringify(states, null, 2), 'utf-8');
    } catch (error) {
        console.error('❌ Error saving thread_states.json:', error.message);
    }
}

function cleanupOldHistories() {
    const now = Date.now();
    let cleanedCount = 0;
    for (const threadId in conversationHistories) {
        if (conversationHistories.hasOwnProperty(threadId)) {
            if (now - conversationHistories[threadId].lastActivity > CONVERSATION_INACTIVITY_THRESHOLD_MS) {
                delete conversationHistories[threadId];
                cleanedCount++;
            }
        }
    }
    if (cleanedCount > 0) {
        console.log(`🧹 Cleaned up ${cleanedCount} old conversation histories.`);
    }
}

setInterval(cleanupOldHistories, CLEANUP_INTERVAL_MS);

// --- MANEJO DE RESPUESTAS DEL HOST ---

bot.on('message', async (msg) => {
    if (msg.chat.id.toString() === TELEGRAM_CHAT_ID.toString()) {
        // console.log(`[Parent] Received message from host: "${msg.text}"`); // Can be noisy
        if (msg.reply_to_message) {
            // console.log(`[Parent] This is a reply. Original message text: "${msg.reply_to_message.text}"`); // Verbose
            const originalText = msg.reply_to_message.text;
            const idPatternMatch = originalText.match(/🔗 ID: req([a-zA-Z0-9]{22})/);
            let reconstructedRequestId = null;

            if (idPatternMatch && idPatternMatch[1]) {
                const combinedIdPart = idPatternMatch[1];
                if (combinedIdPart.length === 22) {
                    const timestampPart = combinedIdPart.substring(0, 13);
                    const randomPart = combinedIdPart.substring(13);
                    reconstructedRequestId = `req_${timestampPart}_${randomPart}`;
                    console.log(`[Parent] Matched and Reconstructed requestId: ${reconstructedRequestId}`);
                } else {
                    // console.warn(`[Parent] Matched ID part has incorrect length. Expected 22, got ${combinedIdPart.length}. Original text: "${originalText}"`);
                }
            } else {
                // console.warn(`[Parent] Could NOT match or reconstruct requestId from reply: "${originalText}" (Regex: /🔗 ID: req([a-zA-Z0-9]{22})/)`);
            }

            if (reconstructedRequestId) {
                const requestId = reconstructedRequestId;
                let cleanedResponse = msg.text.trim();
                cleanedResponse = cleanedResponse.replace(/🔗 ID: req[a-zA-Z0-9]{22}/g, '').trim(); 
                cleanedResponse = cleanedResponse.replace(/🔗 ID: req_\d+_[a-zA-Z0-9]+/g, '').trim();

                console.log(`📨 Host responded to request ${requestId}: "${cleanedResponse.substring(0, 50)}..."`);
                const states = loadThreadStates();
                let targetThreadId = null;

                for (const threadId_iter in states) {
                    if (states[threadId_iter].pendingHostRequests) {
                        const request = states[threadId_iter].pendingHostRequests.find(req => req.id === requestId);
                        if (request) {
                            request.status = 'answered';
                            request.hostResponse = cleanedResponse;
                            request.respondedAt = new Date().toISOString();
                            targetThreadId = threadId_iter;
                            break;
                        }
                    }
                }

                if (targetThreadId) {
                    saveThreadStates(states);
                    console.log(`✅ Updated host response for request ${requestId} in thread ${targetThreadId}`);
                    const activeChild = activeChildProcesses.get(targetThreadId);
                    if (activeChild && !activeChild.killed) {
                        activeChild.send({ type: 'hostResponse', requestId: requestId, text: cleanedResponse });
                        console.log(`📤 Sent host response to active child process for thread ${targetThreadId}`);
                    } else {
                        console.log(`🔄 Reactivating child process for thread ${targetThreadId} to handle host response`);
                        const chatUrl = `${AIRBNB_MESSAGE_BASE_URL}${targetThreadId}`;
                        const initialHistory = conversationHistories[targetThreadId]?.history || [];
                        spawnChildProcess(targetThreadId, chatUrl, initialHistory);
                    }
                } else {
                    console.warn(`⚠️ Could not find (reconstructed) request ${requestId} in any thread state.`);
                }
            }
        } else {
            // console.log(`ℹ️ Received unsolicited Telegram message: "${msg.text.substring(0, 50)}..."`);
        }
    }
});

// --- FUNCIONES PARA MANEJAR PROCESOS HIJO ---

function spawnChildProcess(threadId, chatUrl, initialHistory = []) {
    if (activeChildProcesses.has(threadId)) {
        const existingProcess = activeChildProcesses.get(threadId);
        if (!existingProcess.killed) {
            // console.log(`ℹ️ Child process already active for thread ${threadId}`); // Can be noisy
            return existingProcess;
        }
    }
    
    console.log(`🚀 Spawning child process for thread ${threadId}: ${chatUrl}`);
    const child = spawn('node', [CHECK_NEW_MESSAGES_SCRIPT, chatUrl, JSON.stringify(initialHistory)], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });
    activeChildProcesses.set(threadId, child);
    
    child.on('message', async (message) => {
        if (message.type === 'asyncHostRequest') {
            const { requestId } = message; // Other details logged by child
            console.log(`[Parent] Child ${child.pid} initiated async host request: ${requestId}`);
            pendingHostResponses.set(requestId, { 
                threadId: message.threadId, 
                childProcess: child,
                timeout: setTimeout(() => {
                    console.warn(`⏰ Host response timeout for request ${requestId}`);
                    pendingHostResponses.delete(requestId);
                }, 30 * 60 * 1000)
            });
        } else if (message.type === 'policyViolationAlert') {
            console.warn(`⚠️ Policy violation alert from child ${child.pid}`);
            await bot.sendMessage(TELEGRAM_CHAT_ID, 
                `⚠️ Alert: Response for "${message.originalMessage.substring(0,50)}..." might have contained contact info and was auto-corrected. Original AI attempt: "${message.aiAttempt.substring(0,50)}..."`
            );
        } else if (message.type === 'conversationHistoryUpdate') {
            const { threadId: msgThreadId, history } = message;
            if (msgThreadId && history) {
                conversationHistories[msgThreadId] = { history: history, lastActivity: Date.now() };
                // console.log(`💾 Updated conversation history for thread ${msgThreadId} (length: ${history.length})`); // Can be noisy
            }
        }
    });
    
    child.on('close', (code) => {
        console.log(`[Parent] Child process for thread ${threadId} exited with code ${code}.`);
        activeChildProcesses.delete(threadId);
        for (const [requestId, data] of pendingHostResponses.entries()) {
            if (data.threadId === threadId) {
                clearTimeout(data.timeout);
                pendingHostResponses.delete(requestId);
            }
        }
        if (code === 0) {
            const normalizedUrl = normalizeUrl(`${AIRBNB_MESSAGE_BASE_URL}${threadId}`);
            processedThreadUrls.delete(normalizedUrl);
            // console.log(`♻️ Removed ${normalizedUrl} from processed URLs after successful completion`);
        }
    });
    
    child.on('error', (err) => {
        console.error(`[Parent] Failed to start child process for thread ${threadId}: ${err.message}`);
        activeChildProcesses.delete(threadId);
    });
    
    child.stdout.on('data', (data) => { console.log(`[Child ${threadId}] ${data.toString().trim()}`); });
    child.stderr.on('data', (data) => { console.error(`[Child ${threadId} ERROR] ${data.toString().trim()}`); });
    
    return child;
}

// --- FUNCIONES AUXILIARES ---

async function loadCookies(page) {
    try {
        const cookiesString = fs.readFileSync(cookiePath, 'utf-8');
        const cookies = JSON.parse(cookiesString);
        await page.setCookie(...cookies);
        console.log('🍪 Cookies loaded successfully.');
    } catch (error) {
        console.error('❌ Error loading cookies:', error.message);
        throw new Error(`Failed to load cookies: ${error.message}`);
    }
}

function normalizeUrl(url) {
    try {
        const urlObj = new URL(url);
        urlObj.search = ''; urlObj.hash = '';
        let normalized = urlObj.toString();
        if (normalized.endsWith('/') && urlObj.pathname !== '/') {
            normalized = normalized.slice(0, -1);
        }
        return normalized;
    } catch (e) { return url; }
}

function extractThreadIdFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split('/');
        const threadId = parts[parts.length - 1];
        return (threadId && /^\d+$/.test(threadId)) ? threadId : null;
    } catch (e) { return null; }
}

// --- FUNCIÓN PRINCIPAL DE MONITOREO ---

async function monitorNewChats() {
    console.log('🚀 Initializing Airbnb Chat Monitor with Hybrid Architecture...');
    const browser = await puppeteer.launch({
        headless: process.env.NODE_ENV === 'production' ? 'new' : false, // updated for modern puppeteer
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Removed --auto-open-devtools-for-tabs
    });
    const page = await browser.newPage();
    
    // console.log('✅ DevTools Protocol attached to page.'); // Implied by successful launch

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/533.36');

    try {
        await loadCookies(page);
    } catch (e) {
        console.error("Stopping monitor due to cookie loading failure.");
        await browser.close(); return;
    }

    await page.setRequestInterception(true);
    page.on('request', interceptedRequest => {
        const requestUrl = interceptedRequest.url();
        const resourceType = interceptedRequest.resourceType();
        
        if (['image', 'stylesheet', 'font', 'media', 'other'].includes(resourceType)) {
            interceptedRequest.abort(); return;
        }
        if (requestUrl.includes('googletagmanager.com') || requestUrl.includes('airbnb.com.co/sgtm')) {
             if (interceptedRequest.isNavigationRequest()) { 
                // console.log(`🚫 Blocking GTM navigation: ${requestUrl}`); // Removed
                interceptedRequest.abort(); return;
             }
        }
        if (interceptedRequest.isNavigationRequest() && 
            requestUrl !== AIRBNB_UNREAD_MESSAGES_FILTER_URL && 
            !requestUrl.startsWith(AIRBNB_MESSAGE_BASE_URL) && // Allow navigation to specific message threads
            !requestUrl.startsWith('data:')) {
            console.log(`🚫 Blocking potential unwanted navigation to: ${requestUrl}`);
            interceptedRequest.abort(); return;
        }
        interceptedRequest.continue();
    });

    while (true) {
        const loopStartTime = Date.now();
        console.log(`🌍 Navigating to unread inbox: ${AIRBNB_UNREAD_MESSAGES_FILTER_URL}`);
        let urlsToProcessInThisCycle = new Set();

        try {
            await page.goto(AIRBNB_UNREAD_MESSAGES_FILTER_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); 
            console.log('✅ Unread inbox loaded. Scraping IDs...');
            
            const currentUrlAfterLoad = page.url();
            if (!currentUrlAfterLoad.startsWith(AIRBNB_UNREAD_MESSAGES_FILTER_URL.split('?')[0])) { // Looser check for query params
                console.error(`⚠️ Page redirected unexpectedly after load to: ${currentUrlAfterLoad}. Attempting to recover.`);
                // Optionally add recovery logic here, e.g., re-navigating, or just let the loop retry.
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
                continue; // Skip to next iteration
            }

            let previousHeight; let currentScrolls = 0; const maxScrolls = 3; 
            while (currentScrolls < maxScrolls) {
                previousHeight = await page.evaluate('document.body.scrollHeight');
                await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
                await new Promise(resolve => setTimeout(resolve, 750)); // Slightly reduced scroll wait
                let newHeight = await page.evaluate('document.body.scrollHeight');
                if (newHeight === previousHeight) break;
                // console.log('Scrolled down...'); // Reduced verbosity
                currentScrolls++;
            }
            // console.log('Finished scrolling.'); // Reduced verbosity

            try {
                await page.waitForSelector(MESSAGE_THREAD_LINK_SELECTOR, { visible: true, timeout: 3000 });
            } catch (e) {
                // console.log("No message threads found on page (or selector timeout)."); // Common, no need to log every time
            }
            
            const unreadThreadUrlsFromFilter = await page.evaluate((selector, baseUrl) => {
                const links = [];
                document.querySelectorAll(selector).forEach(linkElement => {
                    const dataTestId = linkElement.getAttribute('data-testid');
                    if (dataTestId?.startsWith('inbox_list_')) {
                        links.push(baseUrl + dataTestId.replace('inbox_list_', ''));
                    }
                });
                return links;
            }, MESSAGE_THREAD_LINK_SELECTOR, AIRBNB_MESSAGE_BASE_URL);

            for (const threadUrl of unreadThreadUrlsFromFilter) {
                const normalized = normalizeUrl(threadUrl);
                const threadId = extractThreadIdFromUrl(normalized);
                if (threadId && !processedThreadUrls.has(normalized) && !activeChildProcesses.has(threadId)) { // Ensure not already active
                    urlsToProcessInThisCycle.add(normalized);
                }
            }
            
            if (urlsToProcessInThisCycle.size > 0) {
                console.log(`✨ Detected ${urlsToProcessInThisCycle.size} new unread thread(s)!`);
                for (const threadUrl of urlsToProcessInThisCycle) {
                    const normalized = normalizeUrl(threadUrl); // Already normalized, but good practice
                    const threadId = extractThreadIdFromUrl(normalized);
                    if (!threadId) continue;
                    processedThreadUrls.add(normalized);
                    const initialHistory = conversationHistories[threadId]?.history || [];
                    // console.log(`ℹ️ Spawning child for thread ${threadId} (history: ${initialHistory.length})`); // Child logs this
                    spawnChildProcess(threadId, normalized, initialHistory);
                }
            } else {
                // console.log('✅ No new unread messages in this cycle.'); // Can be noisy
            }

        } catch (error) {
            console.error('❌ Error in monitor loop:', error.message.split('\n')[0]); // Shorter error
            if (!browser.isConnected()) {
                console.error("Browser disconnected. Attempting to restart monitor.");
                await browser.close().catch(() => {}); // Ignore errors on close if already disconnected
                return monitorNewChats(); // Restart
            }
             // Simple wait before retrying if browser still connected
            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        const activeProcessCount = activeChildProcesses.size;
        const pendingHostRequestCount = pendingHostResponses.size;
        const conversationCount = Object.keys(conversationHistories).length;
        console.log(`📊 Status: ${activeProcessCount} active, ${pendingHostRequestCount} pending host, ${conversationCount} histories`);

        const loopDuration = Date.now() - loopStartTime;
        const DESIRED_POLLING_INTERVAL = 15000;
        const delayNeeded = Math.max(0, DESIRED_POLLING_INTERVAL - loopDuration);
        // console.log(`⏳ Loop finished in ${loopDuration/1000}s. Wait: ${delayNeeded/1000}s.`); // Reduced verbosity
        await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }
    // Should not be reached in normal operation due to the while(true)
}

// --- MANEJO DE SEÑALES DE TERMINACIÓN ---
async function gracefulShutdown() {
    console.log('\n🛑 Gracefully shutting down...');
    for (const [threadId, childProcess] of activeChildProcesses.entries()) {
        console.log(`SIGTERM: Terminating child for thread ${threadId}`);
        childProcess.kill('SIGTERM');
    }
    activeChildProcesses.clear();
    for (const data of pendingHostResponses.values()) {
        clearTimeout(data.timeout);
    }
    pendingHostResponses.clear();
    
    // Attempt to close browser if monitorNewChats created one and it's still assigned
    // This part is tricky as `browser` is scoped to monitorNewChats
    // A more robust solution would involve a global or passed-around browser instance.
    // For now, we rely on the monitorNewChats's own cleanup if it exits its loop.
    console.log('Graceful shutdown initiated. Child processes signaled.');
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// --- INICIO DEL MONITOR ---
monitorNewChats().catch(err => {
    console.error("💀 Critical unrecoverable error in main monitor:", err);
    process.exit(1); // Exit if monitor itself crashes critically
});