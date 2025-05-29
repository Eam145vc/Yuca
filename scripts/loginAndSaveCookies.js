// scripts/loginAndSaveCookies.js
console.log('🔑 Iniciando login en Airbnb con manejo de 2FA y guardado de cookies');
require('dotenv').config();
const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const TelegramBot = require('node-telegram-bot-api');

// Inicialización del bot de Telegram
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const chatId = process.env.TELEGRAM_CHAT_ID;

;(async () => {
  // 0) Validar env
  const email    = process.env.AIRBNB_EMAIL;
  const password = process.env.AIRBNB_PASSWORD;
  if (!email || !password) {
    console.error('❌ Debes definir AIRBNB_EMAIL y AIRBNB_PASSWORD en .env');
    process.exit(1);
  }
  if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.error('❌ Debes definir TELEGRAM_TOKEN y TELEGRAM_CHAT_ID en .env');
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
  await new Promise(r => setTimeout(r, 3000));
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
    // 11) Eliminar overlays invisibles
    await page.evaluate(() => {
      document.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());
    });
    console.log('🗑 Overlays invisibles removidos');

    // 12) Listar opciones
    const options = await page.$$eval('div.b98pgng button', btns =>
      btns.map(b => b.innerText.trim())
    );
    console.log('🔍 Opciones en modal:', options);

    // 13) Clic sobre “Correo electrónico”/“Email”
    const handles = await page.$$('div.b98pgng button');
    let clicked = false;
    for (const handle of handles) {
      const text = await page.evaluate(el => el.innerText.trim(), handle);
      if (/correo electrónico|email/i.test(text)) {
        await handle.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await handle.click().catch(() => {});
        console.log(`✅ Intento click en: "${text}"`);
        await new Promise(r => setTimeout(r, 1000));
        const stillThere = await page.$('div.b98pgng');
        if (stillThere) {
          await handle.evaluate(el => {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          });
          console.log('✅ Intento dispatchEvent click');
        }
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('No se pudo clicar la opción “Correo electrónico” en 2FA');

    // 14) Solicitar, validar y rellenar 2FA automáticamente (6 dígitos) vía Telegram
    await page.waitForSelector('#airlock-code-input_codeinput_0', { visible: true });
    const errorSelector = '#code-input-screen-error-text';
    let success = false;

    // Función para esperar un solo mensaje del usuario en Telegram
    function waitForOtp() {
      return new Promise(resolve => {
        bot.once('message', msg => {
          if (msg.chat.id.toString() === chatId.toString()) {
            resolve(msg.text.trim());
          }
        });
      });
    }

    while (!success) {
      // envía petición de código
      await bot.sendMessage(chatId, 'Introduce el código 2FA de 6 dígitos que recibiste por email:');
      const otp = await waitForOtp();
      console.log('🔑 OTP recibido por Telegram:', otp);

      // Limpiar inputs previos
      for (let i = 0; i < 6; i++) {
        const sel = `#airlock-code-input_codeinput_${i}`;
        await page.evaluate(s => {
          const el = document.querySelector(s);
          if (el) el.value = '';
        }, sel);
      }
      // Rellenar cada dígito
      for (let i = 0; i < otp.length; i++) {
        await page.type(`#airlock-code-input_codeinput_${i}`, otp[i]);
      }
      // Pausa de 500 ms
      await new Promise(r => setTimeout(r, 500));

      // Verificar error
      if (await page.$(errorSelector)) {
        console.log('❌ Código incorrecto. Intenta de nuevo.');
        await bot.sendMessage(chatId, 'El código ingresado es incorrecto. Por favor inténtalo de nuevo.');
      } else {
        success = true;
        await bot.sendMessage(chatId, '✅ 2FA válido. Continuando con el login…');
      }
    }

    // Esperar navegación automática tras último dígito
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('✅ 2FA enviado y validado automáticamente');
  }

  // 15) Guardar cookies
  const cookies = await page.cookies();
  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  console.log('💾 Cookies guardadas en:', cookiePath);

  // 16) Cerrar navegador
  await browser.close();
  console.log('🔚 Login y guardado de cookies finalizado');
  process.exit(0);
})();
