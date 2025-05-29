require('dotenv').config();
const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const TelegramBot = require('node-telegram-bot-api');

// Configuración de Telegram
const tgToken  = process.env.TELEGRAM_TOKEN;    // Token de tu bot
const chatId   = process.env.TELEGRAM_CHAT_ID;  // ID del chat donde enviar y recibir el OTP
if (!tgToken || !chatId) {
  console.error('❌ Debes definir TELEGRAM_TOKEN y TELEGRAM_CHAT_ID en .env');
  process.exit(1);
}
const bot = new TelegramBot(tgToken, { polling: true });

// Función para solicitar el OTP vía Telegram
function solicitarOtpTelegram() {
  return new Promise((resolve) => {
    bot.sendMessage(chatId, '🔐 Por favor, envía el código 2FA de 6 dígitos:');
    const handler = (msg) => {
      if (msg.chat.id.toString() === chatId.toString()) {
        const texto = msg.text.trim();
        if (/^\d{6}$/.test(texto)) {
          bot.removeListener('message', handler);
          resolve(texto);
        } else {
          bot.sendMessage(chatId, '❌ El código debe tener 6 dígitos. Intenta de nuevo:');
        }
      }
    };
    bot.on('message', handler);
  });
}

;(async () => {
  console.log('🔑 Iniciando login en Airbnb con manejo de 2FA y guardado de cookies');
  
  // 0) Validar env
  const email    = process.env.AIRBNB_EMAIL;
  const password = process.env.AIRBNB_PASSWORD;
  if (!email || !password) {
    console.error('❌ Debes definir AIRBNB_EMAIL y AIRBNB_PASSWORD en .env');
    process.exit(1);
  }

  // 1) Crear carpeta data/ si no existe
  const dataDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 Carpeta data/ creada');
  }
  const cookiePath = path.join(dataDir, 'cookies.json');

  // 2) Lanzar navegador visible
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page    = await browser.newPage();

  // 3) Ir a la página de login
  await page.goto('https://www.airbnb.com/login', { waitUntil: 'networkidle2' });
  console.log('📄 Página de login cargada');

  // 4) Pausa de 3 s para que carguen scripts/animaciones
  await page.waitForTimeout(3000);
  console.log('⏸ Pausa de 3 s completada');

  // 5) Clic en “Continue with email”
  const emailBtnSel = '#FMP-target > div > div > div > div._88xxct > div > div:nth-child(3) > button > div > div._bc4egv';
  await page.waitForSelector(emailBtnSel, { visible: true });
  await page.click(emailBtnSel);
  console.log('➡️ Click en “Continue with email”');

  // 6) Escribir el email
  const emailInputSel = 'input[name="user[email]"]';
  await page.waitForSelector(emailInputSel, { visible: true });
  console.log('✉️ Email a tipear:', email);
  await page.type(emailInputSel, email);

  // 7) Clic en “Continue”
  const continueBtnSel = 'button[data-testid="signup-login-submit-btn"]';
  await page.waitForSelector(continueBtnSel, { visible: true });
  await page.click(continueBtnSel);
  console.log('➡️ Click en “Continue”');

  // 8) Escribir la contraseña
  const pwInputSel = 'input[name="user[password]"]';
  await page.waitForSelector(pwInputSel, { visible: true });
  console.log('🔒 Password a tipear: [oculto]');
  await page.type(pwInputSel, password);

  // 9) Clic en “Iniciar sesión”
  const loginBtnSel = '#FMP-target > div > div > div > div:nth-child(1) > form > div._wfo3ii > button';
  await page.waitForSelector(loginBtnSel, { visible: true });
  await page.click(loginBtnSel);
  console.log('➡️ Click en “Iniciar sesión”');

  // 10) Detectar modal “Confirm account” (2FA)
  let twoFaRequired = false;
  try {
    await page.waitForSelector('div.b98pgng', { visible: true, timeout: 15000 });
    twoFaRequired = true;
    console.log('🔐 Modal de Confirm account detectado - 2FA requerido');
  } catch {
    console.log('✅ No apareció modal de 2FA - login directo');
  }

  if (twoFaRequired) {
    // Eliminar overlays invisibles
    await page.evaluate(() => {
      document.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());
    });
    console.log('🗑 Overlays invisibles removidos');

    // Seleccionar Email
    const handles = await page.$$('div.b98pgng button');
    for (const handle of handles) {
      const text = await page.evaluate(el => el.innerText.trim(), handle);
      if (/correo electrónico|email/i.test(text)) {
        await handle.click().catch(() => {});
        break;
      }
    }

    // Solicitar OTP por Telegram
    const otp = await solicitarOtpTelegram();

    // Rellenar cada dígito
    for (let i = 0; i < otp.length; i++) {
      const sel = `#airlock-code-input_codeinput_${i}`;
      await page.waitForSelector(sel, { visible: true });
      await page.type(sel, otp[i]);
    }

    // Esperar navegación
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    bot.sendMessage(chatId, '✅ Código 2FA recibido y validado con éxito');
  }

  // Guardar cookies
  const cookies = await page.cookies();
  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  console.log('💾 Cookies guardadas en:', cookiePath);

  // Cerrar navegador y bot
  await browser.close();
  console.log('🔚 Login y guardado de cookies finalizado');
  process.exit(0);
})();