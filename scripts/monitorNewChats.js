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
const qaLogPath = path.join(__dirname, '../data/qa_log.json');

// Función para usar OpenAI para extraer pregunta y respuesta
async function extractQAWithAI(text) {
    try {
        console.log('🤖 Using AI to extract Q&A from text of length:', text.length);
        console.log('🤖 Text sample:', text.substring(0, 100) + '...');
        
        // Sanitize input text
        const sanitizedText = text
            .replace(/📝\s*\*¿Guardar esta respuesta en la base de conocimiento\?\*/g, '')
            .replace(/✅\s*\*GUARDADO EN BASE DE CONOCIMIENTO\*/g, '')
            .replace(/❌\s*\*NO GUARDADO\*/g, '')
            .trim();
            
        console.log('🤖 Sanitized text sample:', sanitizedText.substring(0, 100) + '...');
        
        // First attempt with standard extraction
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "Eres un asistente que extrae preguntas y respuestas de un texto. Extrae SOLO la pregunta y la respuesta, sin añadir nada más. Si no puedes identificar claramente una pregunta y respuesta, haz tu mejor esfuerzo para extraerlas."
                },
                {
                    role: "user",
                    content: `Extrae la pregunta y la respuesta de este texto y devuélvelas en formato JSON con las claves 'question' y 'answer':\n\n${sanitizedText}`
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 500
        });
        
        let result;
        try {
            result = JSON.parse(response.choices[0].message.content);
            
            // Validate result
            if (!result.question || !result.answer ||
                typeof result.question !== 'string' ||
                typeof result.answer !== 'string' ||
                result.question.trim().length < 2 ||
                result.answer.trim().length < 2) {
                
                console.warn('🤖 AI extraction returned invalid or incomplete result:', result);
                throw new Error('Invalid AI extraction result');
            }
            
            console.log('🤖 AI extracted:', {
                question: result.question.substring(0, 50) + '...',
                answer: result.answer.substring(0, 50) + '...'
            });
            
            return result;
        } catch (parseError) {
            console.error('❌ Error parsing AI response:', parseError.message);
            console.log('🤖 Raw AI response:', response.choices[0].message.content);
            
            // Second attempt with more explicit instructions
            console.log('🤖 Making second attempt with more explicit instructions');
            const retryResponse = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Use a more capable model for the retry
                messages: [
                    {
                        role: "system",
                        content: "Tu tarea es extraer una pregunta y una respuesta de un texto. DEBES devolver un objeto JSON válido con exactamente dos campos: 'question' y 'answer'. Si no puedes identificar claramente una pregunta y respuesta, haz tu mejor esfuerzo para extraerlas del contexto."
                    },
                    {
                        role: "user",
                        content: `Este texto contiene una pregunta y una respuesta. Extráelas y devuélvelas en formato JSON con las claves 'question' y 'answer':\n\n${sanitizedText}`
                    }
                ],
                response_format: { type: "json_object" },
                temperature: 0.2,
                max_tokens: 500
            });
            
            try {
                result = JSON.parse(retryResponse.choices[0].message.content);
                console.log('🤖 Second attempt AI extracted:', {
                    question: result.question.substring(0, 50) + '...',
                    answer: result.answer.substring(0, 50) + '...'
                });
                return result;
            } catch (retryError) {
                console.error('❌ Error parsing second AI response:', retryError.message);
                return null;
            }
        }
    } catch (error) {
        console.error('❌ Error using AI to extract Q&A:', error.message);
        return null;
    }
}
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

// --- FUNCIONES PARA MANEJAR QA_LOG ---
function loadQaLog() {
    try {
        if (!fs.existsSync(qaLogPath)) {
            fs.writeFileSync(qaLogPath, JSON.stringify([], null, 2), 'utf-8');
            return [];
        }
        return JSON.parse(fs.readFileSync(qaLogPath, 'utf-8'));
    } catch (error) {
        console.error('❌ Error loading qa_log.json:', error.message);
        return [];
    }
}

function saveQaEntry(question, answer) {
    try {
        // Validate inputs
        if (!question || !answer || typeof question !== 'string' || typeof answer !== 'string') {
            console.error('❌ Invalid Q&A data:', { question, answer });
            bot.sendMessage(TELEGRAM_CHAT_ID,
                '❌ Error al guardar: datos de pregunta/respuesta inválidos.');
            return false;
        }

        // Trim and clean inputs
        const cleanQuestion = question.trim();
        const cleanAnswer = answer.trim();
        
        if (cleanQuestion.length < 2 || cleanAnswer.length < 2) {
            console.error('❌ Q&A content too short:', { cleanQuestion, cleanAnswer });
            bot.sendMessage(TELEGRAM_CHAT_ID,
                '❌ Error al guardar: contenido de pregunta/respuesta demasiado corto.');
            return false;
        }

        // Load existing data
        const qaLog = loadQaLog();
        
        // Add new entry
        const newEntry = {
            guest_question: cleanQuestion,
            bot_answer: cleanAnswer,
            source: "host_approved",
            timestamp: new Date().toISOString()
        };
        
        console.log('📝 Attempting to save Q&A:', newEntry);
        qaLog.push(newEntry);
        
        // Write to file
        fs.writeFileSync(qaLogPath, JSON.stringify(qaLog, null, 2), 'utf-8');
        
        // Only log success after write completes
        console.log('✅ Q&A entry saved to knowledge base');
        
        // Notificar al host
        bot.sendMessage(TELEGRAM_CHAT_ID,
            '✅ La respuesta ha sido guardada en la base de conocimiento.');
        
        return true;
    } catch (error) {
        console.error('❌ Error saving Q&A entry:', error.message);
        bot.sendMessage(TELEGRAM_CHAT_ID,
            `❌ Error al guardar la respuesta en la base de conocimiento: ${error.message}`);
        return false;
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

// Manejar botones inline de Telegram
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id.toString();
    const messageId = callbackQuery.message.message_id;
    
    if (chatId === TELEGRAM_CHAT_ID.toString()) {
        if (data.startsWith('save_qa_')) {
            // Extraer información de la pregunta/respuesta del mensaje
            const messageText = callbackQuery.message.text;
            console.log('📝 Extracting Q&A from message:', messageText);
            
            try {
                console.log('📝 Raw message text for extraction:', messageText);
                
                // Improved regex patterns with more flexibility
                const questionPatterns = [
                    /\*Pregunta:\*\s*"([^"]+)"/s,
                    /Pregunta:\s*"([^"]+)"/s,
                    /\*Pregunta:\*\s*(.+?)(?=\n\n\*Respuesta:\*)/s,
                    /Pregunta:\s*(.+?)(?=\n\n)/s,
                    /\*Pregunta:\*\s*(.*?)(?=\n)/s,
                    /Pregunta:\s*(.*?)(?=\n)/s,
                    /"([^"]+)"\s*\n\n\*Respuesta:/s,
                    /pregunta[:\s]*"?([^"\n]+)"?/is
                ];
                
                const answerPatterns = [
                    /\*Respuesta:\*\s*"([^"]+)"/s,
                    /Respuesta:\s*"([^"]+)"/s,
                    /\*Respuesta:\*\s*(.+?)(?=\n|$)/s,
                    /Respuesta:\s*(.+?)(?=\n|$)/s,
                    /\*Respuesta:\*\s*(.*)/s,
                    /Respuesta:\s*(.*)/s,
                    /respuesta[:\s]*"?([^"\n]+)"?/is
                ];
                
                // Try each pattern until we find a match
                let questionMatch = null;
                for (const pattern of questionPatterns) {
                    questionMatch = messageText.match(pattern);
                    if (questionMatch && questionMatch[1]?.trim()) {
                        console.log('🔍 Question matched with pattern:', pattern);
                        break;
                    }
                }
                
                let answerMatch = null;
                for (const pattern of answerPatterns) {
                    answerMatch = messageText.match(pattern);
                    if (answerMatch && answerMatch[1]?.trim()) {
                        console.log('🔍 Answer matched with pattern:', pattern);
                        break;
                    }
                }
                
                console.log('🔍 Question match result:', questionMatch ? questionMatch[1] : 'No match');
                console.log('🔍 Answer match result:', answerMatch ? answerMatch[1] : 'No match');
                
                if (questionMatch && answerMatch) {
                    const question = questionMatch[1].trim();
                    const answer = answerMatch[1].trim();
                    
                    console.log('✅ Extracted with regex - Question:', question);
                    console.log('✅ Extracted with regex - Answer:', answer);
                    
                    // Guardar en la base de conocimiento
                    const saveSuccess = saveQaEntry(question, answer);
                    
                    // Direct backup save to ensure the entry is saved
                    try {
                        console.log('📝 Performing direct backup save to qa_log.json');
                        const qaLog = loadQaLog();
                        
                        // Check if this exact Q&A pair already exists
                        const exists = qaLog.some(entry =>
                            entry.guest_question === question &&
                            entry.bot_answer === answer
                        );
                        
                        if (!exists) {
                            qaLog.push({
                                guest_question: question,
                                bot_answer: answer,
                                source: "host_approved_direct",
                                timestamp: new Date().toISOString()
                            });
                            fs.writeFileSync(qaLogPath, JSON.stringify(qaLog, null, 2), 'utf-8');
                            console.log('✅ Direct backup save successful');
                        } else {
                            console.log('ℹ️ Entry already exists in qa_log.json, skipping backup save');
                        }
                    } catch (backupError) {
                        console.error('❌ Error in direct backup save:', backupError.message);
                    }
                    
                    // Responder al callback y actualizar el mensaje
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Guardado en la base de conocimiento' });
                    await bot.editMessageText(
                        `✅ *GUARDADO EN BASE DE CONOCIMIENTO*\n\n*Pregunta:* "${question}"\n\n*Respuesta:* "${answer}"`,
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: { inline_keyboard: [] }
                        }
                    );
                } else {
                    // Si regex falla, usamos AI
                    console.log('⚠️ Regex extraction failed, trying AI extraction');
                    const aiResult = await extractQAWithAI(messageText);
                    
                    if (aiResult && aiResult.question && aiResult.answer) {
                        console.log('✅ Extracted with AI - Question:', aiResult.question);
                        console.log('✅ Extracted with AI - Answer:', aiResult.answer);
                        
                        // Guardar en la base de conocimiento
                        const saveSuccess = saveQaEntry(aiResult.question, aiResult.answer);
                        
                        // Direct backup save to ensure the entry is saved
                        try {
                            console.log('📝 Performing direct backup save to qa_log.json (AI extraction)');
                            const qaLog = loadQaLog();
                            
                            // Check if this exact Q&A pair already exists
                            const exists = qaLog.some(entry =>
                                entry.guest_question === aiResult.question &&
                                entry.bot_answer === aiResult.answer
                            );
                            
                            if (!exists) {
                                qaLog.push({
                                    guest_question: aiResult.question,
                                    bot_answer: aiResult.answer,
                                    source: "host_approved_ai_direct",
                                    timestamp: new Date().toISOString()
                                });
                                fs.writeFileSync(qaLogPath, JSON.stringify(qaLog, null, 2), 'utf-8');
                                console.log('✅ Direct backup save successful (AI extraction)');
                            } else {
                                console.log('ℹ️ AI-extracted entry already exists in qa_log.json, skipping backup save');
                            }
                        } catch (backupError) {
                            console.error('❌ Error in direct backup save (AI extraction):', backupError.message);
                        }
                        
                        // Responder al callback y actualizar el mensaje
                        await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Guardado en la base de conocimiento (AI)' });
                        await bot.editMessageText(
                            `✅ *GUARDADO EN BASE DE CONOCIMIENTO (AI)*\n\n*Pregunta:* "${aiResult.question}"\n\n*Respuesta:* "${aiResult.answer}"`,
                            {
                                chat_id: chatId,
                                message_id: messageId,
                                parse_mode: 'Markdown',
                                reply_markup: { inline_keyboard: [] }
                            }
                        );
                    } else {
                        console.error('❌ Both regex and AI extraction failed for message:', messageText);
                        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Error al extraer pregunta/respuesta' });
                        
                        // Last resort extraction attempt
                        try {
                            console.log('🔄 Attempting last resort extraction');
                            
                            // Simple extraction based on message format
                            const lines = messageText.split('\n').filter(line => line.trim().length > 0);
                            let questionLine = '';
                            let answerLine = '';
                            
                            // Find lines that might contain question/answer
                            for (const line of lines) {
                                if (line.toLowerCase().includes('pregunta') || line.includes('?')) {
                                    questionLine = line.replace(/.*[Pp]regunta[:\s]*["']?/g, '').replace(/["']$/g, '').trim();
                                } else if (line.toLowerCase().includes('respuesta')) {
                                    answerLine = line.replace(/.*[Rr]espuesta[:\s]*["']?/g, '').replace(/["']$/g, '').trim();
                                }
                            }
                            
                            // If we couldn't find clear question/answer lines, try a different approach
                            if (!questionLine || !answerLine) {
                                // Try to extract based on position in the message
                                if (lines.length >= 3) {
                                    // Skip the first line (usually the header)
                                    const potentialQuestion = lines[1].replace(/.*["']?/g, '').replace(/["']$/g, '').trim();
                                    const potentialAnswer = lines[lines.length - 1].replace(/.*["']?/g, '').replace(/["']$/g, '').trim();
                                    
                                    if (potentialQuestion.length > 5 && potentialAnswer.length > 5) {
                                        questionLine = potentialQuestion;
                                        answerLine = potentialAnswer;
                                    }
                                }
                            }
                            
                            if (questionLine && answerLine) {
                                console.log('✅ Last resort extraction - Question:', questionLine);
                                console.log('✅ Last resort extraction - Answer:', answerLine);
                                
                                // Direct save to qa_log.json
                                const qaLog = loadQaLog();
                                qaLog.push({
                                    guest_question: questionLine,
                                    bot_answer: answerLine,
                                    source: "host_approved_last_resort",
                                    timestamp: new Date().toISOString()
                                });
                                fs.writeFileSync(qaLogPath, JSON.stringify(qaLog, null, 2), 'utf-8');
                                
                                await bot.sendMessage(chatId,
                                    `⚠️ *Guardado de emergencia*\n\nSe ha guardado una versión simplificada:\n\n*Pregunta:* "${questionLine}"\n\n*Respuesta:* "${answerLine}"`,
                                    { parse_mode: 'Markdown' }
                                );
                                return;
                            }
                        } catch (lastResortError) {
                            console.error('❌ Last resort extraction failed:', lastResortError.message);
                        }
                        
                        // Send debug info to help troubleshoot
                        await bot.sendMessage(chatId,
                            `❌ *Error de extracción*\n\nTexto del mensaje:\n\`\`\`\n${messageText.substring(0, 500)}...\n\`\`\`\n\nNo se pudo extraer la pregunta y respuesta con regex, IA, ni método de emergencia.`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                }
            } catch (error) {
                console.error('❌ Error in Q&A extraction process:', error.message);
                await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Error en el proceso de extracción' });
                await bot.sendMessage(chatId, `❌ *Error en el proceso*: ${error.message}`, { parse_mode: 'Markdown' });
            }
        } 
        else if (data.startsWith('discard_qa_')) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ No guardado' });
            
            // Extraer información para mostrar en el mensaje actualizado
            const messageText = callbackQuery.message.text;
            console.log('📝 Discarding Q&A from message:', messageText);
            
            try {
                // Primero intentamos con regex
                const questionMatch = messageText.match(/\*Pregunta:\*\s*"([^"]+)"/s) ||
                                     messageText.match(/Pregunta:\s*"([^"]+)"/s) ||
                                     messageText.match(/\*Pregunta:\*\s*(.+?)(?=\n\n\*Respuesta:\*)/s) ||
                                     messageText.match(/Pregunta:\s*(.+?)(?=\n\n)/s);
                                     
                const answerMatch = messageText.match(/\*Respuesta:\*\s*"([^"]+)"/s) ||
                                   messageText.match(/Respuesta:\s*"([^"]+)"/s) ||
                                   messageText.match(/\*Respuesta:\*\s*(.+?)(?=\n|$)/s) ||
                                   messageText.match(/Respuesta:\s*(.+?)(?=\n|$)/s);
                
                if (questionMatch && answerMatch) {
                    const question = questionMatch[1].trim();
                    const answer = answerMatch[1].trim();
                    
                    console.log('✅ Extracted for discard with regex - Question:', question);
                    console.log('✅ Extracted for discard with regex - Answer:', answer);
                    
                    await bot.editMessageText(
                        `❌ *NO GUARDADO*\n\n*Pregunta:* "${question}"\n\n*Respuesta:* "${answer}"`,
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: { inline_keyboard: [] }
                        }
                    );
                } else {
                    // Si regex falla, usamos AI
                    console.log('⚠️ Regex extraction failed for discard, trying AI extraction');
                    const aiResult = await extractQAWithAI(messageText);
                    
                    if (aiResult && aiResult.question && aiResult.answer) {
                        console.log('✅ Extracted for discard with AI - Question:', aiResult.question);
                        console.log('✅ Extracted for discard with AI - Answer:', aiResult.answer);
                        
                        await bot.editMessageText(
                            `❌ *NO GUARDADO (AI)*\n\n*Pregunta:* "${aiResult.question}"\n\n*Respuesta:* "${aiResult.answer}"`,
                            {
                                chat_id: chatId,
                                message_id: messageId,
                                parse_mode: 'Markdown',
                                reply_markup: { inline_keyboard: [] }
                            }
                        );
                    } else {
                        console.error('❌ Both regex and AI extraction failed for discard message:', messageText);
                        
                        // Last resort extraction attempt for discard
                        try {
                            console.log('🔄 Attempting last resort extraction for discard');
                            
                            // Simple extraction based on message format
                            const lines = messageText.split('\n').filter(line => line.trim().length > 0);
                            let questionLine = '';
                            let answerLine = '';
                            
                            // Find lines that might contain question/answer
                            for (const line of lines) {
                                if (line.toLowerCase().includes('pregunta') || line.includes('?')) {
                                    questionLine = line.replace(/.*[Pp]regunta[:\s]*["']?/g, '').replace(/["']$/g, '').trim();
                                } else if (line.toLowerCase().includes('respuesta')) {
                                    answerLine = line.replace(/.*[Rr]espuesta[:\s]*["']?/g, '').replace(/["']$/g, '').trim();
                                }
                            }
                            
                            // If we couldn't find clear question/answer lines, try a different approach
                            if (!questionLine || !answerLine) {
                                // Try to extract based on position in the message
                                if (lines.length >= 3) {
                                    // Skip the first line (usually the header)
                                    const potentialQuestion = lines[1].replace(/.*["']?/g, '').replace(/["']$/g, '').trim();
                                    const potentialAnswer = lines[lines.length - 1].replace(/.*["']?/g, '').replace(/["']$/g, '').trim();
                                    
                                    if (potentialQuestion.length > 5 && potentialAnswer.length > 5) {
                                        questionLine = potentialQuestion;
                                        answerLine = potentialAnswer;
                                    }
                                }
                            }
                            
                            if (questionLine && answerLine) {
                                console.log('✅ Last resort extraction for discard - Question:', questionLine);
                                console.log('✅ Last resort extraction for discard - Answer:', answerLine);
                                
                                await bot.editMessageText(
                                    `❌ *NO GUARDADO (EXTRACCIÓN DE EMERGENCIA)*\n\n*Pregunta:* "${questionLine}"\n\n*Respuesta:* "${answerLine}"`,
                                    {
                                        chat_id: chatId,
                                        message_id: messageId,
                                        parse_mode: 'Markdown',
                                        reply_markup: { inline_keyboard: [] }
                                    }
                                );
                                return;
                            }
                        } catch (lastResortError) {
                            console.error('❌ Last resort extraction for discard failed:', lastResortError.message);
                        }
                        
                        await bot.editMessageText(
                            `❌ *NO GUARDADO* - Error al extraer información`,
                            {
                                chat_id: chatId,
                                message_id: messageId,
                                parse_mode: 'Markdown',
                                reply_markup: { inline_keyboard: [] }
                            }
                        );
                    }
                }
            } catch (error) {
                console.error('❌ Error in Q&A extraction process for discard:', error.message);
                await bot.editMessageText(
                    `❌ *NO GUARDADO* - Error en el proceso: ${error.message}`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [] }
                    }
                );
            }
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
        } else if (message.type === 'saveQARequest') {
            // Manejar solicitud para guardar Q&A
            console.log(`[Parent] Child ${child.pid} requesting to save Q&A`);
            
            // Enviar mensaje con botones al host
            const options = {
                parse_mode: 'Markdown',
                reply_markup: JSON.stringify({
                    inline_keyboard: [
                        [{ text: '✅ Guardar en base de conocimiento', callback_data: `save_qa_${Date.now()}` }],
                        [{ text: '❌ No guardar', callback_data: `discard_qa_${Date.now()}` }]
                    ]
                })
            };
            
            await bot.sendMessage(
                TELEGRAM_CHAT_ID,
                `📝 *¿Guardar esta respuesta en la base de conocimiento?*\n\n*Pregunta:* "${message.question}"\n\n*Respuesta:* "${message.answer}"`,
                options
            );
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