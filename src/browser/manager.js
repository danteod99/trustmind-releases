const { chromium } = require('playwright-core');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');
const { generateTOTP } = require('./totp');
const { generateFingerprint, getFingerprintScript } = require('./fingerprint');
const { fetchCodeWithRetries } = require('./email-code-fetcher');
const { getDb } = require('../db/database');

// Map of profileId -> { context, browser }
const activeBrowsers = new Map();

// CapSolver API key
let capsolverApiKey = '';

// ─── Grid Layout for Browser Windows ────────────────────────────────
// Mobile-sized windows arranged in a grid so multiple are visible at once
const BROWSER_WIDTH = 360;
const BROWSER_HEIGHT = 640;
const GRID_PADDING = 5;
const GRID_START_X = 230; // offset to avoid overlapping the Electron sidebar
const GRID_START_Y = 0;

function getNextGridPosition() {
  const count = activeBrowsers.size;
  // Calculate how many columns fit on screen (assume ~1440px wide screen)
  const screenWidth = 1440;
  const usableWidth = screenWidth - GRID_START_X;
  const cols = Math.max(1, Math.floor(usableWidth / (BROWSER_WIDTH + GRID_PADDING)));
  const col = count % cols;
  const row = Math.floor(count / cols);
  return {
    x: GRID_START_X + col * (BROWSER_WIDTH + GRID_PADDING),
    y: GRID_START_Y + row * (BROWSER_HEIGHT + GRID_PADDING + 30), // +30 for title bar
  };
}

// Common user agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

function getProfileDir(profileId) {
  const profilesDir = path.join(app.getPath('userData'), 'browser-profiles', profileId);
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }
  return profilesDir;
}

function buildProxyUrl(profile) {
  if (!profile.proxy_host || !profile.proxy_port) return null;

  const type = profile.proxy_type || 'http';
  if (profile.proxy_user && profile.proxy_pass) {
    return `${type}://${profile.proxy_user}:${profile.proxy_pass}@${profile.proxy_host}:${profile.proxy_port}`;
  }
  return `${type}://${profile.proxy_host}:${profile.proxy_port}`;
}

// ─── Ban Detection Helper ──────────────────────────────────────────
const BAN_TEXT_INDICATORS = [
  'Inhabilitamos tu cuenta',
  'We disabled your account',
  'Your account has been disabled',
  'Tu cuenta ha sido inhabilitada',
  'Ya no tienes acceso',
];

const BAN_URL_PATTERNS = ['disabled', 'suspended', 'appeal'];

// ─── Email Verification Detection ────────────────────────────────────
const EMAIL_VERIFICATION_TEXTS = [
  'Revisa tu correo electrónico',
  'Check your email',
  'Ingresa el código que enviamos',
  'Enter the code we sent',
  'código de confirmación',
  'confirmation code',
  'Enviamos un código',
  'We sent a code',
  'Ingresa el código de 6 dígitos',
  'Enter the 6-digit code',
  'Ingresa el código de 8 dígitos',
  'Enter the 8-digit code',
  'Te enviamos un código',
  'We sent you a code',
  'Revisa tu email',
  'enviamos a tu correo',
  'sent to your email',
  'código de seguridad',
  'security code',
  'Introduce el código de confirmación',
  'Enter the confirmation code',
];

/**
 * Detecta si la página actual es de verificación por email (no TOTP)
 */
async function isEmailVerificationPage(page) {
  try {
    const url = page.url();
    const bodyText = await page.locator('body').textContent({ timeout: 3000 }).catch(() => '');
    const bodyLower = bodyText.toLowerCase();

    // Si la URL contiene 'two_factor' pero el texto pide código de email, es email verification
    // Si la URL contiene 'challenge' y pide un código, también es email verification
    const hasEmailText = EMAIL_VERIFICATION_TEXTS.some(text => bodyLower.includes(text.toLowerCase()));

    if (!hasEmailText) return false;

    // Asegurarse de que NO es la página TOTP normal (que pide código de app de autenticación)
    const totpTexts = [
      'authentication app',
      'aplicación de autenticación',
      'app de autenticación',
      'autenticador',
      'authenticator',
      'google authenticator',
    ];
    const isTotpPage = totpTexts.some(t => bodyLower.includes(t));

    // Si la página menciona app de autenticación, es TOTP, no email
    if (isTotpPage) {
      console.log(`[Email Verify] Página parece ser TOTP, no verificación por email`);
      return false;
    }

    console.log(`[Email Verify] Detectada página de verificación por email`);
    return true;
  } catch (err) {
    console.log(`[Email Verify] Error detectando página: ${err.message}`);
    return false;
  }
}

/**
 * Maneja la verificación por email: busca el código y lo llena automáticamente
 */
async function handleEmailVerification(page, profile) {
  console.log(`[Email Verify] === Iniciando verificación por email para ${profile.name} ===`);

  if (!profile.ig_email || !profile.ig_email_pass) {
    console.log(`[Email Verify] No hay credenciales de email para ${profile.name} — cerrando navegador`);
    if (loginFailCallback) loginFailCallback(profile.id, 'Verificacion por email requerida — sin credenciales de correo configuradas');
    await closeBrowser(profile.id);
    return;
  }

  console.log(`[Email Verify] Buscando código de verificación en ${profile.ig_email}...`);

  // Esperar un poco para que el email llegue
  await page.waitForTimeout(5000);

  // Intentar obtener el código con reintentos (hasta 60 segundos)
  const code = await fetchCodeWithRetries(profile, 6, 10000);

  if (!code) {
    console.log(`[Email Verify] ERROR: No se pudo obtener el código de verificación para ${profile.name} — cerrando navegador`);
    if (loginFailCallback) loginFailCallback(profile.id, 'Verificacion por email requerida — no se pudo obtener el codigo del correo');
    await closeBrowser(profile.id);
    return;
  }

  console.log(`[Email Verify] Código obtenido: ${code}, llenando formulario...`);

  try {
    // Buscar el input de código en la página
    let codeInput = null;
    const allInputs = await page.locator('input').all();
    console.log(`[Email Verify] Encontrados ${allInputs.length} input(s) en la página`);

    for (const input of allInputs) {
      try {
        if (await input.isVisible({ timeout: 500 })) {
          const type = await input.getAttribute('type').catch(() => '');
          const name = await input.getAttribute('name').catch(() => '');
          const placeholder = await input.getAttribute('placeholder').catch(() => '');

          if (type === 'hidden' || type === 'checkbox' || type === 'submit') continue;

          console.log(`[Email Verify] Input visible: type="${type}" name="${name}" placeholder="${placeholder}"`);
          codeInput = input;
          break;
        }
      } catch { /* skip */ }
    }

    if (!codeInput) {
      console.log(`[Email Verify] No se encontró input para el código`);
      return;
    }

    // Llenar el código
    await codeInput.click();
    await page.waitForTimeout(300);
    await codeInput.fill(code);
    await page.waitForTimeout(500);

    // Verificar que se llenó correctamente
    const val = await codeInput.inputValue().catch(() => '');
    console.log(`[Email Verify] Valor en input: "${val}"`);

    if (val !== code) {
      console.log(`[Email Verify] fill() no funcionó, intentando type()...`);
      await codeInput.click({ clickCount: 3 });
      await page.keyboard.type(code, { delay: 50 });
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(500);

    // Buscar y hacer clic en el botón de confirmar
    const allButtons = await page.locator('button').all();
    let clicked = false;

    for (const btn of allButtons) {
      try {
        if (await btn.isVisible({ timeout: 500 })) {
          const text = await btn.textContent().catch(() => '');
          if (text.match(/confirm|verificar|confirmar|verify|submit|enviar|siguiente|next|continuar|continue/i)) {
            await btn.click();
            clicked = true;
            console.log(`[Email Verify] Botón clickeado: "${text.trim()}"`);
            break;
          }
        }
      } catch { /* skip */ }
    }

    if (!clicked) {
      console.log(`[Email Verify] No se encontró botón de confirmar, presionando Enter`);
      await codeInput.press('Enter');
    }

    // Esperar resultado
    console.log(`[Email Verify] Esperando resultado...`);

    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const url = page.url();

      if (!url.includes('challenge') && !url.includes('two_factor') && !url.includes('accounts/login')) {
        console.log(`[Email Verify] ÉXITO! Redirigido a: ${url}`);

        // Cerrar popups post-login
        for (let a = 0; a < 3; a++) {
          await page.waitForTimeout(1500);
          for (const txt of ['Not Now', 'Ahora no']) {
            try {
              const b = page.locator(`button:has-text("${txt}"), div[role="button"]:has-text("${txt}")`).first();
              if (await b.isVisible({ timeout: 1500 })) { await b.click(); break; }
            } catch { /* next */ }
          }
        }

        if (loginSuccessCallback) loginSuccessCallback(profile.id);
        console.log(`[Email Verify] === ${profile.name} LOGGED IN via email code ===`);
        return;
      }
    }

    console.log(`[Email Verify] Aún en la página de verificación después de enviar el código`);
    console.log(`[Email Verify] Dejando navegador abierto para intervención manual`);

  } catch (err) {
    console.log(`[Email Verify] Error llenando código: ${err.message}`);
  }
}

async function checkForBanPage(page, profile) {
  try {
    const url = page.url();

    // Check URL patterns
    for (const pattern of BAN_URL_PATTERNS) {
      if (url.includes(pattern)) {
        console.log(`[Ban Detection] URL ban indicator found for ${profile.name}: ${url}`);
        return true;
      }
    }

    // Check page text content
    const bodyText = await page.locator('body').textContent({ timeout: 3000 }).catch(() => '');
    for (const text of BAN_TEXT_INDICATORS) {
      if (bodyText.includes(text)) {
        console.log(`[Ban Detection] Text ban indicator found for ${profile.name}: "${text}"`);
        return true;
      }
    }
  } catch (err) {
    console.log(`[Ban Detection] Error checking page: ${err.message}`);
  }
  return false;
}

async function handleBanDetected(profile, source) {
  console.log(`[Ban Detection] BANNED — ${profile.name} — detected via ${source} — closing browser`);
  if (loginFailCallback) {
    loginFailCallback(profile.id, 'Cuenta inhabilitada o suspendida');
  }
  await closeBrowser(profile.id);
}

function setupBanMonitor(context, profile) {
  // Monitor navigation on all existing pages
  const monitorPage = (page) => {
    page.on('framenavigated', async (frame) => {
      // Only check main frame navigations
      if (frame !== page.mainFrame()) return;
      try {
        // Small delay to let page content render
        await page.waitForTimeout(1500);
        if (!activeBrowsers.has(profile.id)) return; // already closed
        const isBanned = await checkForBanPage(page, profile);
        if (isBanned) {
          await handleBanDetected(profile, 'navigation-monitor');
        }
      } catch {
        // Page may have been closed
      }
    });
  };

  // Monitor existing pages
  for (const page of context.pages()) {
    monitorPage(page);
  }

  // Monitor new pages
  context.on('page', (page) => {
    monitorPage(page);
  });
}

function findChromiumPath() {
  const possiblePaths = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    // Linux
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

async function launchBrowser(profile) {
  if (activeBrowsers.has(profile.id)) {
    throw new Error('Este perfil ya tiene un navegador abierto');
  }

  const executablePath = findChromiumPath();
  if (!executablePath) {
    throw new Error(
      'No se encontr\u00f3 Chrome/Chromium instalado. Instala Google Chrome para continuar.'
    );
  }

  const profileDir = getProfileDir(profile.id);

  // Persistent user-agent: use stored UA from profile, or pick a random one
  // and save it to the DB so subsequent launches use the same UA
  let userAgent = profile.user_agent;
  if (!userAgent) {
    userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    try {
      const db = getDb();
      db.prepare('UPDATE profiles SET user_agent = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(userAgent, profile.id);
      console.log(`[Browser] Assigned persistent user-agent to profile ${profile.name}`);
    } catch (err) {
      console.error(`[Browser] Failed to save user-agent to DB:`, err.message);
    }
  }

  // CapSolver extension path
  const capsolverPath = path.join(__dirname, 'extensions', 'capsolver');
  const hasCapsolverExt = fs.existsSync(path.join(capsolverPath, 'manifest.json'));

  const launchOptions = {
    executablePath,
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${BROWSER_WIDTH},${BROWSER_HEIGHT}`,
      '--password-store=basic',
      '--disable-save-password-bubble',
      '--disable-notifications',
      '--deny-permission-prompts',
      ...(hasCapsolverExt ? [
        `--disable-extensions-except=${capsolverPath}`,
        `--load-extension=${capsolverPath}`,
      ] : []),
    ],
  };

  // Build proxy config
  const proxyUrl = buildProxyUrl(profile);
  if (proxyUrl) {
    launchOptions.proxy = { server: proxyUrl };
    if (profile.proxy_user && profile.proxy_pass) {
      launchOptions.proxy.username = profile.proxy_user;
      launchOptions.proxy.password = profile.proxy_pass;
    }
  }

  // Write Chrome preferences to disable password popups
  const prefsDir = path.join(profileDir, 'Default');
  if (!fs.existsSync(prefsDir)) fs.mkdirSync(prefsDir, { recursive: true });
  const prefsFile = path.join(prefsDir, 'Preferences');
  try {
    let prefs = {};
    if (fs.existsSync(prefsFile)) {
      prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
    }
    // Disable password manager and save prompts
    prefs.credentials_enable_service = false;
    prefs.credentials_enable_autosign_in = false;
    if (!prefs.profile) prefs.profile = {};
    prefs.profile.password_manager_enabled = false;
    if (!prefs.savefile) prefs.savefile = {};
    prefs.savefile.default_directory = '/tmp';
    fs.writeFileSync(prefsFile, JSON.stringify(prefs));
  } catch {
    // Ignore pref errors
  }

  // Write CapSolver API key to extension config file before launch
  // This ensures the service worker has the key immediately on startup
  if (hasCapsolverExt && capsolverApiKey) {
    try {
      const configFile = path.join(capsolverPath, 'config.json');
      fs.writeFileSync(configFile, JSON.stringify({ apiKey: capsolverApiKey }));
      console.log(`[CapSolver] API key written to extension config.json`);
    } catch {
      // Ignore write errors (e.g. read-only extension dir)
    }
  }

  // Launch persistent context (keeps cookies/session between runs)
  const context = await chromium.launchPersistentContext(profileDir, {
    ...launchOptions,
    userAgent,
    viewport: { width: BROWSER_WIDTH, height: BROWSER_HEIGHT },
    locale: 'es-419',
    timezoneId: profile.timezone || 'America/Lima',
    colorScheme: 'dark',
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Generate unique fingerprint for this profile
  const fingerprint = generateFingerprint();
  fingerprint.timezone = profile.timezone || 'America/Lima';
  const fpScript = getFingerprintScript(fingerprint);

  // Apply anti-detection + fingerprint to all pages
  const pages = context.pages();
  for (const p of pages) {
    await p.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await p.addInitScript(fpScript);
  }

  context.on('page', async (p) => {
    await p.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await p.addInitScript(fpScript);
  });

  // Inject CapSolver API key into extension storage before and during browsing
  if (hasCapsolverExt && capsolverApiKey) {
    // Write API key to extension's Local Storage file in the profile directory
    // so it persists across all pages and browser restarts
    try {
      // Find the extension's storage directory in the profile
      // Chrome stores extension local storage in Local Storage/leveldb or
      // in the Extension State directory. We write a config.js file that
      // the extension can read, and also inject via chrome.storage on every page.
      const extLocalStorageDir = path.join(profileDir, 'Default', 'Local Extension Settings');

      // Also try to find the extension ID from the loaded extensions
      // For now, inject into every new page via context event
      const injectCapsolverKey = async (page) => {
        try {
          await page.evaluate((key) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ capsolverApiKey: key });
            }
          }, capsolverApiKey);
        } catch {
          // Extension may not be available on this page (e.g. chrome:// pages)
        }
      };

      // Inject into all currently open pages
      for (const p of pages) {
        await injectCapsolverKey(p);
      }

      // Inject into every new page that opens
      context.on('page', async (p) => {
        // Wait a moment for the page to initialize so chrome.storage is available
        await p.waitForTimeout(500).catch(() => {});
        await injectCapsolverKey(p);
      });

      console.log(`[CapSolver] API key injection set up for all pages`);
    } catch {
      console.log(`[CapSolver] Could not set up API key injection`);
    }
  }

  activeBrowsers.set(profile.id, { context });

  // Auto-dismiss Instagram popups on every page (Not Now, Notifications, etc.)
  // NOTE: Do NOT auto-dismiss on challenge/checkpoint/two_factor pages
  const dismissPopups = async (p) => {
    try {
      const url = p.url();
      // Skip if on verification/challenge pages — don't interfere with login flow
      if (url.includes('challenge') || url.includes('checkpoint') || url.includes('two_factor') || url.includes('accounts/login')) return;

      const selectors = [
        'button:has-text("Ahora no")',
        'button:has-text("Not Now")',
        'button:has-text("Not now")',
      ];
      for (const sel of selectors) {
        try {
          const btn = p.locator(sel).first();
          if (await btn.isVisible({ timeout: 300 })) {
            await btn.click();
            console.log(`[IG Popup] Dismissed: ${sel}`);
            await p.waitForTimeout(500);
          }
        } catch {}
      }
    } catch {}
  };

  // Run popup dismisser periodically on active pages
  const popupInterval = setInterval(async () => {
    try {
      const entry = activeBrowsers.get(profile.id);
      if (!entry) { clearInterval(popupInterval); return; }
      const pages = entry.context.pages();
      for (const p of pages) { await dismissPopups(p); }
    } catch {}
  }, 5000);

  context.on('close', () => clearInterval(popupInterval));

  // Set up ban detection monitor on all pages (catches post-login bans)
  setupBanMonitor(context, profile);

  // Position the browser window in a grid layout
  try {
    const pos = getNextGridPosition();
    const page = context.pages()[0];
    if (page) {
      // Use CDP to position the window
      const cdp = await context.newCDPSession(page);
      await cdp.send('Browser.setWindowBounds', {
        windowId: (await cdp.send('Browser.getWindowForTarget')).windowId,
        bounds: { left: pos.x, top: pos.y, width: BROWSER_WIDTH, height: BROWSER_HEIGHT, windowState: 'normal' },
      });
      console.log(`[Browser] Ventana posicionada en grid: (${pos.x}, ${pos.y})`);
    }
  } catch (err) {
    console.log(`[Browser] No se pudo posicionar ventana:`, err.message);
  }

  // Auto-login to Instagram if credentials are set
  // Always attempt login — handles both fresh login and "Continue as..." popup
  if (profile.ig_user && profile.ig_pass) {
    const loginAsync = async () => {
      try {
        await new Promise((r) => setTimeout(r, 2000));
        const entry = activeBrowsers.get(profile.id);
        if (!entry) return;
        let page = entry.context.pages()[0];
        if (!page) page = await entry.context.newPage();
        console.log(`[IG Login] Starting auto-login for ${profile.name} (@${profile.ig_user})`);
        await loginToInstagram(page, profile);

        // Post-login check: only close if STILL on login page after login attempt
        // Don't close if the browser navigated away (means login worked or user is interacting)
        await new Promise((r) => setTimeout(r, 10000));
        const entry2 = activeBrowsers.get(profile.id);
        if (entry2) {
          try {
            const pages = entry2.context.pages();
            const currentPage = pages[0];
            if (currentPage) {
              const url = currentPage.url();
              // Only close if stuck on the exact login page — NOT if on any other page
              if (url.includes('/accounts/login/') && !url.includes('two_factor') && !url.includes('challenge')) {
                console.log(`[IG Login] ${profile.name} — still on login page, closing`);
                if (loginFailCallback) loginFailCallback(profile.id, 'No se pudo iniciar sesion');
                await closeBrowser(profile.id);
              } else {
                console.log(`[IG Login] ${profile.name} — navigated to ${url.substring(0, 50)}, keeping open`);
              }
            }
          } catch { /* page may have been closed by user, ignore */ }
        }
      } catch (err) {
        console.error(`[IG Login] Error for ${profile.name}:`, err.message);
        // DON'T auto-close on error — browser may still be usable for automations
      }
    };
    loginAsync();
  } else if (profile.ig_user) {
    // Has username but no password — just open Instagram
    const openAsync = async () => {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const entry = activeBrowsers.get(profile.id);
        if (!entry) return;
        let page = entry.context.pages()[0];
        if (!page) page = await entry.context.newPage();
        await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 20000 });
      } catch {
        // Ignore navigation errors
      }
    };
    openAsync();
  }

  // Auto-cleanup when all pages close
  context.on('close', () => {
    activeBrowsers.delete(profile.id);
  });

  return context;
}

async function closeBrowser(profileId) {
  const entry = activeBrowsers.get(profileId);
  if (!entry) return;

  try {
    await entry.context.close();
  } catch {
    // Context may already be closed
  }
  activeBrowsers.delete(profileId);
}

function getActiveBrowsers() {
  return activeBrowsers;
}

// ─── Instagram Auto-Login ──────────────────────────────────────────

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function loginToInstagram(page, profile) {
  console.log(`[IG Login] Starting login for ${profile.name} (@${profile.ig_user})...`);

  try {
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'load',
      timeout: 30000,
    });
  } catch (err) {
    console.log(`[IG Login] Navigation warning (continuing anyway): ${err.message}`);
  }

  console.log(`[IG Login] Page loaded, waiting for login form...`);
  await page.waitForTimeout(1500);

  // ── Handle "Continue as..." / "Continuar como..." popup ──
  try {
    const continueBtn = page.locator('button:has-text("Continuar"), button:has-text("Continue"), [role="button"]:has-text("Continuar"), [role="button"]:has-text("Continue")').first();
    if (await continueBtn.isVisible({ timeout: 2000 })) {
      console.log(`[IG Login] Found "Continue as..." popup — clicking Continue`);
      await continueBtn.click();
      await page.waitForTimeout(3000);
      // Check if we're now logged in
      const url = page.url();
      if (!url.includes('/login') && !url.includes('/accounts/login')) {
        console.log(`[IG Login] SUCCESS — Already logged in via Continue button`);
        return;
      }
    }
  } catch { /* no continue popup */ }

  // ── Handle "Not now" / "Ahora no" save login popup ──
  try {
    const notNowBtn = page.locator('button:has-text("Ahora no"), button:has-text("Not Now"), button:has-text("Not now")').first();
    if (await notNowBtn.isVisible({ timeout: 500 })) {
      await notNowBtn.click();
      console.log(`[IG Login] Dismissed "Save login" popup`);
      await page.waitForTimeout(1000);
    }
  } catch { /* no popup */ }

  // Dismiss cookie banner quickly
  try {
    const cookieBtn = page.locator('button:has-text("cookies"), button:has-text("Permitir"), button:has-text("Accept"), button:has-text("Aceptar"), button:has-text("Allow")').first();
    if (await cookieBtn.isVisible({ timeout: 500 })) {
      await cookieBtn.click();
      console.log(`[IG Login] Cookie banner dismissed`);
      await page.waitForTimeout(800);
    }
  } catch { /* no cookie banner */ }

  // Find username input — wait for it to appear (max 3 sec total)
  let usernameInput;
  try {
    usernameInput = page.locator('input[name="username"], form input[type="text"]').first();
    await usernameInput.waitFor({ state: 'visible', timeout: 3000 });
    console.log(`[IG Login] Found username input`);
  } catch {
    // Fallback: try all selectors
    const inputSelectors = ['input[aria-label*="username"]', 'input[aria-label*="usuario"]', 'form input[type="text"]'];
    for (const sel of inputSelectors) {
      try {
        const input = page.locator(sel).first();
        await input.waitFor({ state: 'visible', timeout: 1000 });
        usernameInput = input;
        console.log(`[IG Login] Found username input: ${sel}`);
        break;
      } catch { /* next */ }
    }
  }

  if (!usernameInput) {
    // Last resort: take screenshot path for debugging
    console.log(`[IG Login] Could not find username input. Current URL: ${page.url()}`);
    const bodyText = await page.locator('body').textContent().catch(() => '');
    console.log(`[IG Login] Page content preview: ${bodyText.substring(0, 200)}`);
    throw new Error('No se encontro el campo de usuario en Instagram');
  }

  await page.waitForTimeout(randomDelay(500, 1000));

  // Type username using fill() — fast and reliable
  await usernameInput.click();
  await page.waitForTimeout(300);
  await usernameInput.fill(profile.ig_user);
  console.log(`[IG Login] Username filled: ${profile.ig_user}`);

  await page.waitForTimeout(randomDelay(400, 800));

  // Find password input quickly
  let passwordInput;
  try {
    passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    await passwordInput.waitFor({ state: 'visible', timeout: 2000 });
    console.log(`[IG Login] Found password input`);
  } catch {
    // Fallback
    const passSelectors = ['input[aria-label*="contrase"]', 'input[aria-label*="password"]', 'form input:nth-of-type(2)'];
    for (const sel of passSelectors) {
      try {
        const input = page.locator(sel).first();
        await input.waitFor({ state: 'visible', timeout: 1000 });
        passwordInput = input;
        console.log(`[IG Login] Found password input: ${sel}`);
        break;
      } catch { /* next */ }
    }
  }

  if (!passwordInput) {
    console.log(`[IG Login] Could not find password field. URL: ${page.url()}`);
    throw new Error('No se encontro el campo de password');
  }

  await passwordInput.click();
  await page.waitForTimeout(300);
  await passwordInput.fill(profile.ig_pass);
  console.log(`[IG Login] Password filled`);

  await page.waitForTimeout(randomDelay(300, 600));

  // Click the Log In button — fast
  let clicked = false;
  try {
    const loginBtn = page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Iniciar sesi\u00f3n")').first();
    if (await loginBtn.isVisible({ timeout: 1500 })) {
      await loginBtn.click();
      clicked = true;
      console.log(`[IG Login] Login button clicked`);
    }
  } catch {
    // Try next
  }

  // Fallback: press Enter on the password field
  if (!clicked) {
    console.log(`[IG Login] No login button found, pressing Enter...`);
    await passwordInput.press('Enter');
  }

  console.log(`[IG Login] Login submitted, waiting for response...`);

  // Wait and poll for page state change (up to 15 seconds)
  let state = 'waiting';
  for (let check = 0; check < 15; check++) {
    await page.waitForTimeout(1000);
    const url = page.url();

    // 2FA page detected — check if it's email verification or TOTP
    if (url.includes('two_factor')) {
      const isEmailVerify = await isEmailVerificationPage(page);
      if (isEmailVerify) {
        state = 'email_verify';
        console.log(`[IG Login] Verificación por email detectada en two_factor: ${url}`);
        break;
      }
      state = '2fa';
      console.log(`[IG Login] 2FA page detected at: ${url}`);
      break;
    }

    // Account banned/disabled (URL check)
    if (url.includes('disabled') || url.includes('suspended') || url.includes('appeal')) {
      state = 'banned';
      console.log(`[IG Login] Account banned/disabled (URL): ${url}`);
      break;
    }

    // Account banned/disabled (text content check)
    try {
      const bodyText = await page.locator('body').textContent({ timeout: 1500 }).catch(() => '');
      for (const banText of BAN_TEXT_INDICATORS) {
        if (bodyText.includes(banText)) {
          state = 'banned';
          console.log(`[IG Login] Account banned/disabled (text): "${banText}"`);
          break;
        }
      }
      if (state === 'banned') break;
    } catch { /* ignore */ }

    // Email verification challenge (check before generic challenge)
    if (url.includes('challenge') || url.includes('checkpoint')) {
      const isEmailVerify = await isEmailVerificationPage(page);
      if (isEmailVerify) {
        state = 'email_verify';
        console.log(`[IG Login] Verificación por email detectada: ${url}`);
        break;
      }
      // Generic challenge (facial, selfie, etc.)
      state = 'challenge';
      console.log(`[IG Login] Challenge/verification detected: ${url}`);
      break;
    }

    // Successfully left login page
    if (!url.includes('/accounts/login')) {
      state = 'success';
      console.log(`[IG Login] Login success, navigated to: ${url}`);
      break;
    }

    // Check for facial/selfie verification text on page
    try {
      const verifyTexts = [
        'text="Verify Your Identity"',
        'text="Verifica tu identidad"',
        'text="selfie"',
        'text="Take a Selfie"',
        'text="video selfie"',
        'text="foto de tu rostro"',
        'text="Confirm Your Identity"',
        'text="Confirma tu identidad"',
        'text="upload a photo"',
        'text="sube una foto"',
      ];
      for (const sel of verifyTexts) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 200 })) {
          state = 'facial';
          console.log(`[IG Login] Facial verification detected on page`);
          break;
        }
      }
      if (state === 'facial') break;
    } catch { /* not found */ }

    // Check for 2FA form on page (sometimes URL doesn't change but form appears)
    try {
      const tfaForm = page.locator('input[placeholder*="seguridad"], input[placeholder*="Security"], input[name="verificationCode"]').first();
      if (await tfaForm.isVisible({ timeout: 300 })) {
        state = '2fa';
        console.log(`[IG Login] 2FA form found on page`);
        break;
      }
    } catch { /* not visible yet */ }

    // Check for error messages
    try {
      const errorEl = page.locator('p[data-testid="login-error-message"], #slfErrorAlert, div[role="alert"]').first();
      if (await errorEl.isVisible({ timeout: 300 })) {
        const errorText = await errorEl.textContent().catch(() => 'Error');
        console.log(`[IG Login] LOGIN FAILED: ${errorText.trim()}`);
        if (loginFailCallback) loginFailCallback(profile.id, errorText.trim());
        await closeBrowser(profile.id);
        return;
      }
    } catch { /* no error */ }

    if (check % 5 === 4) console.log(`[IG Login] Still waiting... (${check + 1}s)`);
  }

  // Handle banned
  if (state === 'banned') {
    console.log(`[IG Login] BANNED — ${profile.name} — closing browser`);
    if (loginFailCallback) loginFailCallback(profile.id, 'Cuenta inhabilitada o suspendida');
    await closeBrowser(profile.id);
    return;
  }

  // Handle facial verification
  if (state === 'facial') {
    console.log(`[IG Login] FACIAL VERIFICATION — ${profile.name} — closing browser`);
    if (loginFailCallback) loginFailCallback(profile.id, 'Verificacion facial requerida');
    await closeBrowser(profile.id);
    return;
  }

  // Handle challenge/checkpoint
  if (state === 'challenge') {
    console.log(`[IG Login] CHALLENGE — ${profile.name} — closing browser`);
    if (loginFailCallback) loginFailCallback(profile.id, 'Verificacion de seguridad requerida');
    await closeBrowser(profile.id);
    return;
  }

  // Handle email verification
  if (state === 'email_verify') {
    await handleEmailVerification(page, profile);
    return;
  }

  // Handle 2FA
  if (state === '2fa') {
    await handle2FA(page, profile);
    return;
  }

  const currentUrl = page.url();

  // Account banned/disabled/suspended (URL + text check)
  if (await checkForBanPage(page, profile)) {
    console.log(`[IG Login] ACCOUNT BANNED: ${profile.name} — closing browser`);
    if (loginFailCallback) {
      loginFailCallback(profile.id, 'Cuenta inhabilitada o suspendida');
    }
    await closeBrowser(profile.id);
    return;
  }

  if (state === 'success' || !currentUrl.includes('/accounts/login')) {
    console.log(`[IG Login] Navigation detected: ${currentUrl}`);
    await page.waitForTimeout(2000);

    // Dismiss popups that Instagram shows after login
    const dismissSelectors = [
      'button:has-text("Not Now")',
      'button:has-text("Ahora no")',
      'button:has-text("Not now")',
      'div[role="button"]:has-text("Not Now")',
      'div[role="button"]:has-text("Ahora no")',
    ];

    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(1500);
      let dismissed = false;
      for (const sel of dismissSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click();
            console.log(`[IG Login] Dismissed popup: ${sel}`);
            dismissed = true;
            break;
          }
        } catch {
          // Try next
        }
      }
      if (!dismissed) break;
    }

    // Mark as logged in
    if (loginSuccessCallback) {
      loginSuccessCallback(profile.id);
    }

    console.log(`[IG Login] SUCCESS — ${profile.name} (@${profile.ig_user}) is now logged in`);
  } else if (currentUrl.includes('challenge')) {
    console.log(`[IG Login] ${profile.name} needs challenge verification — complete manually`);
  } else {
    // Still on login page after 5 seconds — likely wrong credentials
    console.log(`[IG Login] ${profile.name} still on login page — closing browser`);
    if (loginFailCallback) {
      loginFailCallback(profile.id, 'Credenciales incorrectas o cuenta bloqueada');
    }
    await closeBrowser(profile.id);
  }
}

// ─── 2FA Handler ────────────────────────────────────────────────────

async function handle2FA(page, profile) {
  console.log(`[IG 2FA] === Starting 2FA for ${profile.name} ===`);

  if (!profile.ig_2fa_secret) {
    // Sin secreto TOTP — verificar si es verificación por email
    const isEmailVerify = await isEmailVerificationPage(page);
    if (isEmailVerify && profile.ig_email && profile.ig_email_pass) {
      console.log(`[IG 2FA] Sin secreto TOTP pero se detectó verificación por email — redirigiendo`);
      await handleEmailVerification(page, profile);
      return;
    }
    console.log(`[IG 2FA] No secret configured — complete manually`);
    return;
  }

  try {
    // Wait for page to settle
    await page.waitForTimeout(3000);
    console.log(`[IG 2FA] URL: ${page.url()}`);

    // Step 1: Find the input — try getting ANY visible input on the page
    let tfaInput = null;

    // First try: the most direct approach — get all inputs and find the right one
    const allInputs = await page.locator('input').all();
    console.log(`[IG 2FA] Found ${allInputs.length} input(s) on page`);

    for (const input of allInputs) {
      try {
        if (await input.isVisible({ timeout: 500 })) {
          const type = await input.getAttribute('type').catch(() => '');
          const name = await input.getAttribute('name').catch(() => '');
          const placeholder = await input.getAttribute('placeholder').catch(() => '');
          console.log(`[IG 2FA] Visible input: type="${type}" name="${name}" placeholder="${placeholder}"`);

          // Skip hidden/checkbox inputs
          if (type === 'hidden' || type === 'checkbox' || type === 'submit') continue;

          // This is likely the 2FA input
          tfaInput = input;
          console.log(`[IG 2FA] Using this input for 2FA code`);
          break;
        }
      } catch { /* skip */ }
    }

    if (!tfaInput) {
      console.log(`[IG 2FA] No visible input found on page!`);
      const bodyText = await page.locator('body').textContent().catch(() => '');
      console.log(`[IG 2FA] Page text: ${bodyText.substring(0, 500)}`);
      return;
    }

    // Step 2: Generate and enter the code
    const code = generateTOTP(profile.ig_2fa_secret);
    console.log(`[IG 2FA] TOTP code: ${code}`);

    await tfaInput.click();
    await page.waitForTimeout(300);
    await tfaInput.fill(code);
    await page.waitForTimeout(500);

    // Verify
    const val = await tfaInput.inputValue().catch(() => '');
    console.log(`[IG 2FA] Input value: "${val}"`);

    if (val !== code) {
      // Try typing character by character as fallback
      console.log(`[IG 2FA] fill() didn't work, trying type()...`);
      await tfaInput.click({ clickCount: 3 }); // select all
      await page.keyboard.type(code, { delay: 50 });
      await page.waitForTimeout(300);
      const val2 = await tfaInput.inputValue().catch(() => '');
      console.log(`[IG 2FA] Input value after type(): "${val2}"`);
    }

    await page.waitForTimeout(500);

    // Step 3: Click Confirmar button
    const allButtons = await page.locator('button').all();
    console.log(`[IG 2FA] Found ${allButtons.length} button(s)`);

    let clicked = false;
    for (const btn of allButtons) {
      try {
        if (await btn.isVisible({ timeout: 500 })) {
          const text = await btn.textContent().catch(() => '');
          console.log(`[IG 2FA] Button: "${text.trim()}"`);

          if (text.match(/confirm|verificar|confirmar|verify|submit|enviar/i)) {
            await btn.click();
            clicked = true;
            console.log(`[IG 2FA] Clicked: "${text.trim()}"`);
            break;
          }
        }
      } catch { /* skip */ }
    }

    if (!clicked) {
      console.log(`[IG 2FA] No confirm button found, pressing Enter`);
      await tfaInput.press('Enter');
    }

    // Step 4: Wait and check result
    console.log(`[IG 2FA] Waiting for response...`);

    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const url = page.url();

      if (!url.includes('two_factor') && !url.includes('accounts/login')) {
        // SUCCESS
        console.log(`[IG 2FA] SUCCESS! Redirected to: ${url}`);

        // Dismiss popups
        for (let a = 0; a < 3; a++) {
          await page.waitForTimeout(1500);
          for (const txt of ['Not Now', 'Ahora no']) {
            try {
              const b = page.locator(`button:has-text("${txt}"), div[role="button"]:has-text("${txt}")`).first();
              if (await b.isVisible({ timeout: 1500 })) { await b.click(); break; }
            } catch { /* next */ }
          }
        }

        if (loginSuccessCallback) loginSuccessCallback(profile.id);
        console.log(`[IG 2FA] === ${profile.name} LOGGED IN ===`);
        return;
      }
    }

    // Still on 2FA — try fresh code
    console.log(`[IG 2FA] Still on 2FA page, retrying with fresh code...`);
    const freshCode = generateTOTP(profile.ig_2fa_secret);
    console.log(`[IG 2FA] Fresh code: ${freshCode}`);

    await tfaInput.click({ clickCount: 3 });
    await page.keyboard.type(freshCode, { delay: 50 });
    await page.waitForTimeout(500);

    // Click confirm again
    for (const btn of allButtons) {
      try {
        const text = await btn.textContent().catch(() => '');
        if (text.match(/confirm|verificar|confirmar|verify/i) && await btn.isVisible({ timeout: 500 })) {
          await btn.click();
          break;
        }
      } catch { /* skip */ }
    }

    await page.waitForTimeout(8000);

    const finalUrl = page.url();
    if (!finalUrl.includes('two_factor') && !finalUrl.includes('accounts/login')) {
      if (loginSuccessCallback) loginSuccessCallback(profile.id);
      console.log(`[IG 2FA] === ${profile.name} LOGGED IN (retry) ===`);
    } else {
      console.log(`[IG 2FA] FAILED — could not complete 2FA for ${profile.name}`);
    }

  } catch (err) {
    console.log(`[IG 2FA] ERROR: ${err.message}`);
  }
}

let loginSuccessCallback = null;
let loginFailCallback = null;

function onLoginSuccess(callback) {
  loginSuccessCallback = callback;
}

function onLoginFail(callback) {
  loginFailCallback = callback;
}

function setCapsolverKey(key) {
  capsolverApiKey = key || '';
}

function getCapsolverKey() {
  return capsolverApiKey;
}

module.exports = { launchBrowser, closeBrowser, getActiveBrowsers, onLoginSuccess, onLoginFail, setCapsolverKey, getCapsolverKey };
