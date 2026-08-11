const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const https = require('https');
const path = require('path');
const fs = require('fs');

// Load .env file for secrets
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const [key, ...rest] = line.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch { /* .env not found, use process.env */ }
}
loadEnv();

// ─── Security: Anti-debugging & tamper detection ───────────────────
if (app.isPackaged) {
  app.on('browser-window-created', (_, win) => {
    win.webContents.on('devtools-opened', () => { win.webContents.closeDevTools(); });
  });
  app.commandLine.appendSwitch('disable-features', 'DebugMode');
}
const { initDatabase, getDb } = require('./src/db/database');
const { launchBrowser, closeBrowser, getActiveBrowsers, onLoginSuccess, onLoginFail, setCapsolverKey, getCapsolverKey, setCaptchaProvider, getCaptchaProvider, setCftProgressCallback } = require('./src/browser/manager');
const {
  autoLike, autoFollow, autoUnfollow, autoViewStories,
  autoVisitProfiles, autoComment, extractFollowers,
  likeByHashtag, likeFeed, likeExplore, watchReels, followByHashtag, sendDM,
  uploadPost, editProfile, sharePost, buffPost, followSuggestions, searchAndFollow,
  cancelAutomation, getAllAutomationStatus, onAutomationEvent,
} = require('./src/browser/automations');
const { scrapeProfiles, scrapeHashtagEmails, scrapeFollowersData, onScraperEvent } = require('./src/browser/scrapers');
const { checkAccountHealth, checkShadowban } = require('./src/browser/healthcheck');
const { getSupabase } = require('./src/auth/supabase');
const { saveSession, loadSession, clearSession } = require('./src/auth/session');
const { getDeviceFingerprint, getDeviceName, registerDevice } = require('./src/auth/device');
const { getCurrentTier, saveTierCache, loadTierCache } = require('./src/auth/license');
const { isProFeature, requirePro, FREE_PROFILE_LIMIT } = require('./src/auth/gates');
const { encrypt: encryptField, decrypt: decryptField } = require('./src/db/crypto');

let mainWindow;
let currentUser = null;
let cachedTier = 'free';
let tierRevalidationInterval = null;

// ─── Background Scheduler: Task Executor ────────────────────────────
// Maps scheduler action names to their automation functions.

const automationMap = {
  'auto:like': autoLike,
  'auto:follow': autoFollow,
  'auto:unfollow': autoUnfollow,
  'auto:stories': autoViewStories,
  'auto:visit': autoVisitProfiles,
  'auto:comment': autoComment,
  'auto:like-hashtag': likeByHashtag,
  'auto:like-feed': likeFeed,
  'auto:like-explore': likeExplore,
  'auto:watch-reels': watchReels,
  'auto:follow-hashtag': followByHashtag,
  'auto:send-dm': sendDM,
  'auto:extract-followers': extractFollowers,
};

// Track which tasks already ran this minute to prevent duplicate execution.
// Key format: "taskId:YYYY-MM-DD HH:MM"
const schedulerExecutedSet = new Set();
let schedulerInterval = null;

function executeScheduledTasks() {
  const db = getDb();
  const tasks = db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1').all();

  if (tasks.length === 0) return;

  const now = new Date();
  const currentHH = String(now.getHours()).padStart(2, '0');
  const currentMM = String(now.getMinutes()).padStart(2, '0');
  const currentHHMM = `${currentHH}:${currentMM}`;
  // JavaScript getDay(): 0=Sunday, 1=Monday ... 6=Saturday
  const currentDayOfWeek = now.getDay();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const minuteKey = `${dateStr} ${currentHHMM}`;

  for (const task of tasks) {
    const dedupKey = `${task.id}:${minuteKey}`;

    // Skip if already executed this minute
    if (schedulerExecutedSet.has(dedupKey)) continue;

    // Check if scheduled time matches current HH:MM
    if (task.schedule_time !== currentHHMM) continue;

    // Check if today's day of week is in schedule_days
    let scheduleDays;
    try {
      scheduleDays = JSON.parse(task.schedule_days);
    } catch {
      console.error(`[Scheduler] Invalid schedule_days JSON for task ${task.id}, skipping`);
      continue;
    }
    if (!Array.isArray(scheduleDays) || !scheduleDays.includes(currentDayOfWeek)) continue;

    // Parse profile IDs and config
    let profileIds, config;
    try {
      profileIds = JSON.parse(task.profile_ids);
      config = JSON.parse(task.config);
    } catch {
      console.error(`[Scheduler] Invalid profile_ids or config JSON in task ${task.id}, skipping`);
      continue;
    }

    if (!Array.isArray(profileIds) || profileIds.length === 0) {
      console.warn(`[Scheduler] Task "${task.name}" (${task.id}) has no profile_ids, skipping`);
      continue;
    }

    const automationFn = automationMap[task.action];
    if (!automationFn) {
      console.error(`[Scheduler] Unknown action "${task.action}" for task "${task.name}", skipping`);
      continue;
    }

    // Mark as executed BEFORE running to prevent re-entry on the same minute
    schedulerExecutedSet.add(dedupKey);

    console.log(`[Scheduler] Executing task "${task.name}" (action: ${task.action}) for ${profileIds.length} profile(s) at ${currentHHMM}`);

    // Execute the automation for each profile that has an active browser
    const activeBrowsers = getActiveBrowsers();
    for (const profileId of profileIds) {
      if (!activeBrowsers.has(profileId)) {
        console.warn(`[Scheduler] Browser not active for profile ${profileId}, skipping in task "${task.name}"`);
        if (mainWindow) {
          mainWindow.webContents.send('automation:event', {
            profileId,
            event: 'error',
            data: { message: `[Scheduler] Tarea "${task.name}" omitida: navegador no activo` },
          });
        }
        continue;
      }

      automationFn(profileId, config)
        .then((result) => {
          if (result && result.error) {
            console.error(`[Scheduler] Task "${task.name}" returned error for profile ${profileId}: ${result.error}`);
          } else {
            console.log(`[Scheduler] Task "${task.name}" completed successfully for profile ${profileId}`);
          }
        })
        .catch((err) => {
          console.error(`[Scheduler] Task "${task.name}" threw error for profile ${profileId}:`, err.message);
        });
    }

    // Update last_run timestamp in the database
    db.prepare("UPDATE scheduled_tasks SET last_run = datetime('now') WHERE id = ?").run(task.id);

    // Notify renderer that a scheduled task was executed
    if (mainWindow) {
      mainWindow.webContents.send('scheduler:executed', {
        taskId: task.id,
        taskName: task.name,
        action: task.action,
        time: minuteKey,
      });
    }
  }

  // Cleanup old dedup keys: remove entries that don't belong to the current minute
  for (const key of schedulerExecutedSet) {
    if (!key.endsWith(minuteKey)) {
      schedulerExecutedSet.delete(key);
    }
  }
}

function startSchedulerExecutor() {
  console.log('[Scheduler] Background task executor started (60s check interval)');

  // Run the check every 60 seconds
  schedulerInterval = setInterval(() => {
    try {
      executeScheduledTasks();
    } catch (err) {
      console.error('[Scheduler] Unhandled error in executor loop:', err.message);
    }
  }, 60 * 1000);

  // Run an initial check 5 seconds after startup to catch tasks due right now
  setTimeout(() => {
    try {
      executeScheduledTasks();
    } catch (err) {
      console.error('[Scheduler] Error in initial check:', err.message);
    }
  }, 5000);
}

function stopSchedulerExecutor() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Scheduler] Background task executor stopped');
  }
}

// ─── Window & App Lifecycle ─────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'TrustMind Desktop',
    backgroundColor: '#f3f5f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Dev mode: Vite server | Prod: built files
  if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  initDatabase();

  // Load CapSolver API key from DB
  const db = getDb();
  const capRow = db.prepare("SELECT value FROM settings WHERE key = 'capsolver_api_key'").get();
  if (capRow && capRow.value) {
    setCapsolverKey(capRow.value);
    console.log('[CapSolver] API key loaded from settings');
  }
  const provRow = db.prepare("SELECT value FROM settings WHERE key = 'captcha_provider'").get();
  if (provRow && provRow.value) {
    setCaptchaProvider(provRow.value);
    console.log('[Captcha] Provider loaded from settings:', provRow.value);
  }

  createWindow();

  // Progreso de descarga de Chrome for Testing → renderer
  setCftProgressCallback((data) => {
    if (mainWindow) mainWindow.webContents.send('cft:progress', data);
  });

  // App version
  ipcMain.handle('app:version', () => app.getVersion());

  // Auto-Updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => { if (mainWindow) mainWindow.webContents.send('updater:update-available', { version: info.version }); });
  autoUpdater.on('download-progress', (progress) => { if (mainWindow) mainWindow.webContents.send('updater:download-progress', { percent: progress.percent }); });
  autoUpdater.on('update-downloaded', (info) => { if (mainWindow) mainWindow.webContents.send('updater:update-downloaded', { version: info.version }); });
  autoUpdater.on('error', (err) => { console.error('Updater error:', err.message); if (mainWindow) mainWindow.webContents.send('updater:error', { error: err.message }); });
  // Check al arrancar + cada 30 min mientras esté abierta
  async function safeCheckUpdates(reason) {
    try {
      const r = await autoUpdater.checkForUpdates();
      console.log(`[Updater] check (${reason}): currentVersion=${app.getVersion()} latest=${r?.updateInfo?.version}`);
      return r;
    } catch (e) {
      console.error(`[Updater] check (${reason}) FAILED:`, e.message);
      if (mainWindow) mainWindow.webContents.send('updater:error', { error: e.message });
      return null;
    }
  }
  // Chequeo directo via GitHub API — NO depende de la firma de la app.
  // electron-updater falla en Mac sin firmar, por lo que las versiones viejas
  // nunca se enteraban de una nueva. Esto garantiza que SIEMPRE vean el aviso.
  function cmpVersions(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }
  async function checkGithubLatest(reason) {
    try {
      const res = await fetch('https://api.github.com/repos/danteod99/trustmind-releases/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TrustInsta-Desktop' },
      });
      if (!res.ok) return;
      const data = await res.json();
      const latest = (data.tag_name || '').replace(/^v/, '');
      const current = app.getVersion();
      console.log(`[Updater] github check (${reason}): current=${current} latest=${latest}`);
      if (latest && cmpVersions(latest, current) > 0 && mainWindow) {
        mainWindow.webContents.send('updater:update-available', { version: latest });
      }
    } catch (e) {
      console.error(`[Updater] github check (${reason}) failed:`, e.message);
    }
  }
  if (app.isPackaged) {
    setTimeout(() => { safeCheckUpdates('startup'); checkGithubLatest('startup'); }, 3000);
    setInterval(() => { safeCheckUpdates('periodic-30min'); checkGithubLatest('periodic-30min'); }, 30 * 60 * 1000);
  }
  ipcMain.handle('updater:check', async () => { try { const r = await autoUpdater.checkForUpdates(); return { success: true, updateInfo: r?.updateInfo, currentVersion: app.getVersion() }; } catch (e) { return { success: false, error: e.message }; } });
  ipcMain.handle('updater:download', async () => { try { await autoUpdater.downloadUpdate(); return { success: true }; } catch (e) { return { success: false, error: e.message }; } });
  ipcMain.handle('updater:open-release', async () => {
    // Obtener la ultima version via GitHub API (no depende de la firma).
    let version = app.getVersion();
    try {
      const res = await fetch('https://api.github.com/repos/danteod99/trustmind-releases/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TrustInsta-Desktop' },
      });
      if (res.ok) { const d = await res.json(); version = (d.tag_name || '').replace(/^v/, '') || version; }
    } catch { /* usa la version actual como respaldo */ }
    try {
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const file = process.platform === 'darwin'
        ? `TrustInsta-Desktop-${version}-${arch}.dmg`
        : `TrustInsta-Desktop-Setup-${version}.exe`;
      const url = `https://github.com/danteod99/trustmind-releases/releases/download/v${version}/${file}`;
      await shell.openExternal(url);
      return { success: true, url };
    } catch (e) {
      const fallback = `https://github.com/danteod99/trustmind-releases/releases/latest`;
      await shell.openExternal(fallback);
      return { success: false, error: e.message, fallback };
    }
  });
  ipcMain.handle('updater:install', () => {
    setImmediate(() => {
      // Force quit everything on macOS
      app.removeAllListeners('window-all-closed');
      app.removeAllListeners('before-quit');
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((w) => {
        w.removeAllListeners('close');
        w.destroy();
      });
      autoUpdater.quitAndInstall(true, true);
    });
  });

  // Start the background scheduler executor
  startSchedulerExecutor();

  // Forward scraper events to renderer
  onScraperEvent((profileId, event, data) => {
    if (mainWindow) {
      mainWindow.webContents.send('automation:event', { profileId, event, data });
    }
  });

  // Forward automation events to renderer
  onAutomationEvent((profileId, event, data) => {
    if (mainWindow) {
      mainWindow.webContents.send('automation:event', { profileId, event, data });
    }
  });

  // When Instagram login fails, update status, close browser, and notify
  onLoginFail((profileId, errorMsg) => {
    const db = getDb();
    db.prepare("UPDATE profiles SET status = 'stopped' WHERE id = ?").run(profileId);
    // Determine account_status from error message
    let accStatus = 'error';
    if (errorMsg.includes('inhabilitada') || errorMsg.includes('suspendida')) accStatus = 'banned';
    else if (errorMsg.includes('facial')) accStatus = 'facial_verify';
    else if (errorMsg.includes('Verificacion por email')) accStatus = 'email_verify';
    else if (errorMsg.includes('seguridad') || errorMsg.includes('Verificacion')) accStatus = 'challenge';
    else if (errorMsg.includes('incorrecta') || errorMsg.includes('Credenciales')) accStatus = 'wrong_password';
    db.prepare("UPDATE profiles SET account_status = ?, account_status_msg = ? WHERE id = ?").run(accStatus, errorMsg, profileId);
    // Close the browser automatically on login failure
    closeBrowser(profileId).catch(() => {});
    console.log(`[Login] Cuenta ${profileId} marcada como ${accStatus}. Navegador cerrado.`);
    if (mainWindow) {
      mainWindow.webContents.send('ig:login-fail', { profileId, error: errorMsg, status: accStatus });
    }
  });

  // When Instagram login succeeds, mark profile as logged in
  onLoginSuccess((profileId) => {
    const db = getDb();
    db.prepare('UPDATE profiles SET ig_logged_in = 1, account_status = ?, account_status_msg = ? WHERE id = ?').run('active', 'Cuenta activa', profileId);
    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send('ig:login-success', profileId);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Stop the scheduler before closing
  stopSchedulerExecutor();
  stopTierRevalidation();
  // Close all open browsers on exit
  const active = getActiveBrowsers();
  for (const [profileId] of active) {
    closeBrowser(profileId).catch(() => {});
  }
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Authentication ──────────────────────────────────────────

ipcMain.handle('auth:login', async (_, email, password) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    const user = data.user;
    const session = data.session;
    saveSession({ access_token: session.access_token, refresh_token: session.refresh_token, user });

    // Register device
    const fingerprint = getDeviceFingerprint();
    const deviceName = getDeviceName();
    const deviceResult = await registerDevice(supabase, user.id, fingerprint, deviceName);
    if (deviceResult.error) return { error: deviceResult.error };

    // Get tier
    const db = getDb();
    const tier = await getCurrentTier(supabase, user.id);
    saveTierCache(db, user.id, tier, null);
    currentUser = user;
    cachedTier = tier;

    // Start revalidation
    startTierRevalidation();

    return { user: { id: user.id, email: user.email }, tier };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auth:google', async () => {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./src/auth/supabase');

    // Build the Google OAuth URL via Supabase
    const redirectUrl = 'http://localhost:54321/auth/callback';
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;

    // Open a new window for Google login
    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    authWindow.loadURL(authUrl);

    return new Promise((resolve) => {
      // Listen for the redirect with the tokens
      authWindow.webContents.on('will-redirect', async (event, url) => {
        if (url.startsWith(redirectUrl) || url.includes('access_token') || url.includes('#access_token')) {
          event.preventDefault();
          authWindow.close();

          try {
            // Extract tokens from URL fragment
            const hashParams = new URL(url.replace('#', '?')).searchParams;
            const access_token = hashParams.get('access_token');
            const refresh_token = hashParams.get('refresh_token');

            if (!access_token) {
              resolve({ error: 'No se obtuvo token de Google' });
              return;
            }

            // Set the session in Supabase
            const supabase = getSupabase();
            const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
            if (error) { resolve({ error: error.message }); return; }

            const user = data.user;
            const session = data.session;
            saveSession({ access_token: session.access_token, refresh_token: session.refresh_token, user });

            // Register device
            const fingerprint = getDeviceFingerprint();
            const deviceName = getDeviceName();
            await registerDevice(supabase, user.id, fingerprint, deviceName);

            // Get tier
            const db = getDb();
            const tier = await getCurrentTier(supabase, user.id);
            saveTierCache(db, user.id, tier, null);
            currentUser = user;
            cachedTier = tier;
            startTierRevalidation();

            if (mainWindow) mainWindow.webContents.send('auth:state-change', { user: { id: user.id, email: user.email }, tier });
            resolve({ user: { id: user.id, email: user.email }, tier });
          } catch (err) {
            resolve({ error: err.message });
          }
        }
      });

      // Also handle navigation (some OAuth flows use navigation instead of redirect)
      authWindow.webContents.on('will-navigate', async (event, url) => {
        if (url.includes('access_token') || url.includes('#access_token') || url.startsWith(redirectUrl)) {
          event.preventDefault();
          authWindow.close();

          try {
            const hashParams = new URL(url.replace('#', '?')).searchParams;
            const access_token = hashParams.get('access_token');
            const refresh_token = hashParams.get('refresh_token');

            if (!access_token) { resolve({ error: 'No se obtuvo token de Google' }); return; }

            const supabase = getSupabase();
            const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
            if (error) { resolve({ error: error.message }); return; }

            const user = data.user;
            const session = data.session;
            saveSession({ access_token: session.access_token, refresh_token: session.refresh_token, user });

            const fingerprint = getDeviceFingerprint();
            const deviceName = getDeviceName();
            await registerDevice(supabase, user.id, fingerprint, deviceName);

            const db = getDb();
            const tier = await getCurrentTier(supabase, user.id);
            saveTierCache(db, user.id, tier, null);
            currentUser = user;
            cachedTier = tier;
            startTierRevalidation();

            if (mainWindow) mainWindow.webContents.send('auth:state-change', { user: { id: user.id, email: user.email }, tier });
            resolve({ user: { id: user.id, email: user.email }, tier });
          } catch (err) {
            resolve({ error: err.message });
          }
        }
      });

      // Handle window close without completing
      authWindow.on('closed', () => {
        resolve({ error: 'Login cancelado' });
      });
    });
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auth:register', async (_, email, password) => {
  try {
    // Use server endpoint to create user with auto-confirmed email
    const https = require('https');
    const res = await fetch('https://www.trustmind.online/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const result = await res.json();
    if (!res.ok || result.error) return { error: result.error || 'Error al registrar' };

    // Auto-login after successful registration
    const supabase = getSupabase();
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) return { success: true, message: 'Cuenta creada. Inicia sesión.' };

    // Save session and register device
    if (loginData.session) {
      saveSession(loginData.session);
      currentUser = loginData.user;
      const fingerprint = await getDeviceFingerprint();
      const deviceName = getDeviceName();
      await registerDevice(supabase, loginData.user.id, fingerprint, deviceName);
    }

    return { success: true, autoLogin: true, user: loginData.user, tier: 'free' };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  try {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    clearSession();
    currentUser = null;
    cachedTier = 'free';
    stopTierRevalidation();
    if (mainWindow) mainWindow.webContents.send('auth:state-change', { user: null, tier: 'free' });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auth:session', async () => {
  try {
    const session = loadSession();
    if (!session) return null;

    const supabase = getSupabase();
    const { data, error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });

    if (error) {
      // Try offline mode
      const db = getDb();
      const cached = loadTierCache(db, session.user?.id);
      if (cached) {
        currentUser = session.user;
        cachedTier = cached.tier;
        return { user: { id: session.user.id, email: session.user.email }, tier: cached.tier, offline: true };
      }
      clearSession();
      return null;
    }

    const user = data.user;
    saveSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user });

    const db = getDb();
    const tier = await getCurrentTier(supabase, user.id);
    saveTierCache(db, user.id, tier, null);
    currentUser = user;
    cachedTier = tier;
    startTierRevalidation();

    return { user: { id: user.id, email: user.email }, tier };
  } catch (err) {
    // Offline fallback
    const session = loadSession();
    if (session?.user) {
      try {
        const db = getDb();
        const cached = loadTierCache(db, session.user.id);
        if (cached) {
          currentUser = session.user;
          cachedTier = cached.tier;
          return { user: { id: session.user.id, email: session.user.email }, tier: cached.tier, offline: true };
        }
      } catch {}
    }
    return null;
  }
});

ipcMain.handle('auth:refresh', async () => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.refreshSession();
    if (error) return { error: error.message };
    if (data.session) {
      saveSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: data.user });
      currentUser = data.user;
      return { user: { id: data.user.id, email: data.user.email }, tier: cachedTier };
    }
    return { error: 'No session to refresh' };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auth:get-tier', () => {
  return cachedTier;
});

function startTierRevalidation() {
  stopTierRevalidation();
  tierRevalidationInterval = setInterval(async () => {
    if (!currentUser) return;
    try {
      const supabase = getSupabase();
      const tier = await getCurrentTier(supabase, currentUser.id);
      const db = getDb();
      saveTierCache(db, currentUser.id, tier, null);
      if (tier !== cachedTier) {
        cachedTier = tier;
        if (mainWindow) mainWindow.webContents.send('auth:state-change', { user: { id: currentUser.id, email: currentUser.email }, tier });
      }
    } catch {}
  }, 30 * 60 * 1000); // Every 30 minutes
}

function stopTierRevalidation() {
  if (tierRevalidationInterval) {
    clearInterval(tierRevalidationInterval);
    tierRevalidationInterval = null;
  }
}

// ─── IPC: Payments ─────────────────────────────────────────────────

ipcMain.handle('payment:create-order', async (_, plan) => {
  if (!currentUser) return { error: 'No autenticado' };
  try {
    const { createPaymentOrder } = require('./src/payments/nowpayments');
    return await createPaymentOrder(currentUser.id, plan);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('payment:check-status', async (_, orderId) => {
  if (!currentUser) return { error: 'No autenticado' };
  try {
    const { checkPaymentStatus } = require('./src/payments/nowpayments');
    const result = await checkPaymentStatus(orderId);
    // If payment confirmed, update tier
    if (result.status === 'finished' || result.status === 'confirmed') {
      cachedTier = 'pro';
      const db = getDb();
      saveTierCache(db, currentUser.id, 'pro', null);
      if (mainWindow) mainWindow.webContents.send('auth:state-change', { user: { id: currentUser.id, email: currentUser.email }, tier: 'pro' });
    }
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('payment:history', async () => {
  if (!currentUser) return { error: 'No autenticado' };
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('tm_payment_orders').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    if (error) return { error: error.message };
    return data || [];
  } catch (err) {
    return { error: err.message };
  }
});

// Saldo SMM del user (smm_balances)
ipcMain.handle('user:get-balance', async () => {
  if (!currentUser) return { balance: 0 };
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('smm_balances')
      .select('balance')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) {
      console.log(`[Saldo] Error: ${error.message}`);
      return { balance: 0 };
    }
    return { balance: Number(data?.balance || 0) };
  } catch (err) {
    return { balance: 0, error: err.message };
  }
});

// ─── Sistema de créditos por acción ─────────────────────────────────
// Cada acción (like, follow, comment, etc.) descuenta del saldo SMM
// vía /api/desktop/charge. Si insuficiente, emite evento al renderer.

const TRUSTMIND_API = 'https://www.trustmind.online';

async function chargeUserAction(action, count) {
  // Modelo sin creditos: las acciones ya no se cobran por saldo.
  // El acceso se controla por tier (free/pro). Pro se activa por WhatsApp.
  return { success: true, skipped: true };
  // eslint-disable-next-line no-unreachable
  if (!currentUser || !count || count < 1) return { skipped: true };
  try {
    const session = loadSession();
    const accessToken = session?.access_token;
    if (!accessToken) return { error: 'no_session' };

    const res = await fetch(`${TRUSTMIND_API}/api/desktop/charge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action, count, app: 'trustinsta' }),
    });
    const data = await res.json();

    if (res.status === 402) {
      // Saldo insuficiente — emitir evento al renderer
      mainWindow?.webContents.send('balance:insufficient', data);
      return { insufficient: true, ...data };
    }
    if (!res.ok) {
      console.log(`[Charge] HTTP ${res.status}: ${data.error || 'unknown'}`);
      return { error: data.error || 'charge_failed' };
    }
    // Éxito — notificar al renderer para refrescar UI
    mainWindow?.webContents.send('balance:updated', { balance: data.newBalance });
    return { success: true, ...data };
  } catch (err) {
    console.log(`[Charge] Error: ${err.message}`);
    return { error: err.message };
  }
}

// IPC handler para que el renderer pueda cobrar manualmente o consultar
ipcMain.handle('desktop:charge', async (_, action, count) => {
  return chargeUserAction(action, count);
});

// ─── IPC: Profile CRUD ─────────────────────────────────────────────

// Sensitive profile fields that must be encrypted at rest
const PROFILE_SENSITIVE = ['ig_pass', 'ig_2fa_secret', 'ig_email_pass', 'proxy_pass'];

function encryptProfile(profile) {
  const enc = { ...profile };
  for (const f of PROFILE_SENSITIVE) { if (enc[f]) enc[f] = encryptField(enc[f]); }
  return enc;
}

function decryptProfile(profile) {
  if (!profile) return profile;
  const dec = { ...profile };
  for (const f of PROFILE_SENSITIVE) { if (dec[f]) dec[f] = decryptField(dec[f]) || dec[f]; }
  return dec;
}

ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url);
});

ipcMain.handle('dialog:select-files', async (_, opts = {}) => {
  const properties = ['openFile'];
  if (opts.multiple) properties.push('multiSelections');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts.multiple ? 'Selecciona los archivos' : 'Selecciona el archivo',
    properties,
    filters: [
      { name: 'Imagenes y videos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'avi', 'mkv', 'webm'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
});

ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona la carpeta de fotos',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('profiles:list', () => {
  const db = getDb();
  return db.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all().map(decryptProfile);
});

ipcMain.handle('profiles:create', (_, profile) => {
  if (cachedTier !== 'pro') {
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
    if (count >= FREE_PROFILE_LIMIT) return { error: 'PROFILE_LIMIT', limit: FREE_PROFILE_LIMIT };
  }
  const db = getDb();
  const id = require('uuid').v4();
  const stmt = db.prepare(`
    INSERT INTO profiles (id, name, ig_user, ig_pass, ig_2fa_secret, ig_email, ig_email_pass, proxy_type, proxy_host, proxy_port, proxy_user, proxy_pass, user_agent, timezone, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const enc = encryptProfile({
    ig_pass: profile.ig_pass || '',
    ig_2fa_secret: profile.ig_2fa_secret || '',
    ig_email_pass: profile.ig_email_pass || '',
    proxy_pass: profile.proxy_pass || '',
  });
  stmt.run(
    id,
    profile.name,
    profile.ig_user || '',
    enc.ig_pass,
    enc.ig_2fa_secret,
    profile.ig_email || '',
    enc.ig_email_pass,
    profile.proxy_type || 'http',
    profile.proxy_host || '',
    profile.proxy_port || '',
    profile.proxy_user || '',
    enc.proxy_pass,
    profile.user_agent || '',
    profile.timezone || 'America/Lima',
    profile.notes || ''
  );
  return decryptProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(id));
});

ipcMain.handle('profiles:update', (_, id, updates) => {
  const db = getDb();
  const ALLOWED = new Set(['name', 'ig_user', 'ig_pass', 'ig_2fa_secret', 'ig_email', 'ig_email_pass', 'proxy_type', 'proxy_host', 'proxy_port', 'proxy_user', 'proxy_pass', 'user_agent', 'timezone', 'notes', 'status', 'ig_logged_in', 'account_status', 'account_status_msg']);
  const safe = {};
  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED.has(k)) safe[k] = v;
  }
  if (Object.keys(safe).length === 0) return { error: 'No valid fields' };
  // Encrypt sensitive fields before saving
  for (const f of PROFILE_SENSITIVE) {
    if (safe[f] !== undefined && safe[f]) safe[f] = encryptField(safe[f]);
  }
  const fields = Object.keys(safe).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(safe);
  db.prepare(`UPDATE profiles SET ${fields}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  return decryptProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(id));
});

ipcMain.handle('profiles:delete', (_, id) => {
  const db = getDb();
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  return { success: true };
});

// ─── IPC: Browser Management ───────────────────────────────────────

ipcMain.handle('browser:launch', async (_, profileId) => {
  try {
    const db = getDb();
    const profile = decryptProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId));
    if (!profile) return { success: false, error: 'Perfil no encontrado' };

    console.log(`[Browser] Launching browser for ${profile.name || profileId}...`);
    await launchBrowser(profile);
    db.prepare("UPDATE profiles SET status = 'running' WHERE id = ?").run(profileId);
    console.log(`[Browser] Browser launched for ${profile.name || profileId}`);
    return { success: true, status: 'running' };
  } catch (err) {
    console.error(`[Browser] Launch error for ${profileId}:`, err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('browser:close', async (_, profileId) => {
  const db = getDb();
  try {
    await closeBrowser(profileId);
    db.prepare("UPDATE profiles SET status = 'stopped' WHERE id = ?").run(profileId);
    return { success: true, status: 'stopped' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('browser:status', () => {
  const active = getActiveBrowsers();
  const running = [];
  for (const [id] of active) {
    running.push(id);
  }
  return running;
});

// ─── IPC: Proxy Import ─────────────────────────────────────────────

ipcMain.handle('proxies:import', (_, proxiesText) => {
  const lines = proxiesText.split('\n').filter((l) => l.trim());
  const parsed = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Formats: host:port, host:port:user:pass, type://host:port, type://user:pass@host:port
    let type = 'http';
    let host = '';
    let port = '';
    let user = '';
    let pass = '';

    if (trimmed.includes('://')) {
      const [proto, rest] = trimmed.split('://');
      type = proto.toLowerCase();
      if (rest.includes('@')) {
        const [auth, addr] = rest.split('@');
        [user, pass] = auth.split(':');
        [host, port] = addr.split(':');
      } else {
        [host, port] = rest.split(':');
      }
    } else {
      const parts = trimmed.split(':');
      if (parts.length === 2) {
        [host, port] = parts;
      } else if (parts.length === 4) {
        [host, port, user, pass] = parts;
      }
    }

    if (host && port) {
      parsed.push({ type, host, port, user: user || '', pass: pass || '' });
    }
  }

  return parsed;
});

// ─── IPC: Proxy Test ────────────────────────────────────────────────

ipcMain.handle('proxy:test', async (_, proxy) => {
  const net = require('net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 5000;
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve({ success: true, latency: Date.now() - start });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
    socket.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    const start = Date.now();
    socket.connect(parseInt(proxy.port), proxy.host);
  });
});

// ─── IPC: Automations ──────────────────────────────────────────────

ipcMain.handle('auto:like', async (_, profileId, config) => {
  try {
    const result = await autoLike(profileId, config);
    if (result.likesGiven > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'auto-like', config.targetUser || '', result.likesGiven);
      await chargeUserAction('like', result.likesGiven);
    }
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auto:follow', async (_, profileId, config) => {
  try {
    const result = await autoFollow(profileId, config);
    if (result.followed > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'auto-follow', config.targetUser || '', result.followed);
      await chargeUserAction('follow', result.followed);
    }
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auto:unfollow', async (_, profileId, config) => {
  try {
    const result = await autoUnfollow(profileId, config);
    if (result.unfollowed > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'auto-unfollow', '', result.unfollowed);
      await chargeUserAction('unfollow', result.unfollowed);
    }
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auto:stories', async (_, profileId, config) => {
  try {
    const result = await autoViewStories(profileId, config);
    if (result.storiesViewed > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'auto-stories', config.targetUser || 'feed', result.storiesViewed);
      await chargeUserAction('story_view', result.storiesViewed);
    }
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auto:visit', async (_, profileId, config) => {
  try {
    const result = await autoVisitProfiles(profileId, config);
    if (result.visited > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'auto-visit', '', result.visited);
      await chargeUserAction('visit', result.visited);
    }
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('auto:comment', async (_, profileId, config) => {
  try {
    requirePro(cachedTier, 'auto:comment');
    const result = await autoComment(profileId, config);
    if (result.commented > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'auto-comment', config.targetUser || '', result.commented);
      await chargeUserAction('comment', result.commented);
    }
    return result;
  } catch (err) {
    return err.error ? err : { error: err.message || 'Error desconocido' };
  }
});

ipcMain.handle('auto:like-hashtag', async (_, profileId, config) => {
  try {
    const result = await likeByHashtag(profileId, config);
    if (result.likesGiven > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'like-hashtag', config.hashtag || '', result.likesGiven);
      await chargeUserAction('like', result.likesGiven);
    }
    return result;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:like-feed', async (_, profileId, config) => {
  try {
    const result = await likeFeed(profileId, config);
    if (result.likesGiven > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'like-feed', 'feed', result.likesGiven);
      await chargeUserAction('like', result.likesGiven);
    }
    return result;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:like-explore', async (_, profileId, config) => {
  try {
    const result = await likeExplore(profileId, config);
    if (result.likesGiven > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'like-explore', 'explore', result.likesGiven);
      await chargeUserAction('like', result.likesGiven);
    }
    return result;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:watch-reels', async (_, profileId, config) => {
  try {
    const result = await watchReels(profileId, config);
    if (result.watched > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'watch-reels', 'reels', result.watched);
      await chargeUserAction('reels_view', result.watched);
    }
    return result;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:follow-hashtag', async (_, profileId, config) => {
  try {
    const result = await followByHashtag(profileId, config);
    if (result.followed > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'follow-hashtag', config.hashtag || '', result.followed);
      await chargeUserAction('follow', result.followed);
    }
    return result;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:send-dm', async (_, profileId, config) => {
  try {
    requirePro(cachedTier, 'auto:send-dm');
    const result = await sendDM(profileId, config);
    if (result.sent > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'send-dm', '', result.sent);
      await chargeUserAction('dm', result.sent);
    }
    return result;
  } catch (err) { return err.error ? err : { error: err.message || 'Error desconocido' }; }
});

ipcMain.handle('auto:upload-post', async (_, profileId, config) => {
  try { return await uploadPost(profileId, config); } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:edit-profile', async (_, profileId, config) => {
  try { return await editProfile(profileId, config); } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:share-post', async (_, profileId, config) => {
  try {
    const result = await sharePost(profileId, config);
    if (result.shared > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'share-post', config.postUrl || '', result.shared);
      await chargeUserAction('like', result.shared);
    }
    return result;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:buff-post', async (_, profileId, config) => {
  try { return await buffPost(profileId, config); } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:follow-suggestions', async (_, profileId, config) => {
  try {
    const result = await followSuggestions(profileId, config);
    if (result.followed > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'follow-suggestions', 'suggestions', result.followed);
      await chargeUserAction('follow', result.followed);
    }
    return result;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:search-follow', async (_, profileId, config) => {
  try {
    const result = await searchAndFollow(profileId, config);
    if (result.followed > 0) {
      const db = getDb();
      db.prepare('INSERT INTO action_log (profile_id, action_type, target, count) VALUES (?, ?, ?, ?)').run(profileId, 'search-follow', config.keyword || '', result.followed);
      await chargeUserAction('follow', result.followed);
    }
    return result;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('auto:extract-followers', async (_, profileId, config) => {
  try {
    requirePro(cachedTier, 'auto:extract-followers');
    const result = await extractFollowers(profileId, config);
    // Save to database
    if (result.followers && result.followers.length > 0) {
      const db = getDb();
      const profile = db.prepare('SELECT ig_user FROM profiles WHERE id = ?').get(profileId);
      const insertStmt = db.prepare(
        'INSERT OR IGNORE INTO extracted_followers (target_user, username, full_name, extracted_by) VALUES (?, ?, ?, ?)'
      );
      const insertMany = db.transaction((followers) => {
        for (const f of followers) {
          insertStmt.run(result.target, f.username, f.fullName || '', profile?.ig_user || '');
        }
      });
      insertMany(result.followers);
      // Save history
      db.prepare(
        'INSERT INTO extraction_history (target_user, count, extracted_by) VALUES (?, ?, ?)'
      ).run(result.target, result.followers.length, profile?.ig_user || '');
      await chargeUserAction('extract_followers', result.followers.length);
    }
    return result;
  } catch (err) {
    return err.error ? err : { error: err.message || 'Error desconocido' };
  }
});

ipcMain.handle('auto:cancel', (_, profileId) => {
  return cancelAutomation(profileId);
});

ipcMain.handle('auto:status', () => {
  return getAllAutomationStatus();
});

// ─── IPC: Followers Data ───────────────────────────────────────────

ipcMain.handle('followers:list-targets', () => {
  const db = getDb();
  return db.prepare(`
    SELECT target_user, COUNT(*) as count, MAX(extracted_at) as last_extracted
    FROM extracted_followers
    GROUP BY target_user
    ORDER BY last_extracted DESC
  `).all();
});

ipcMain.handle('followers:get', (_, targetUser) => {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM extracted_followers WHERE target_user = ? ORDER BY extracted_at DESC'
  ).all(targetUser);
});

ipcMain.handle('followers:history', () => {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM extraction_history ORDER BY extracted_at DESC LIMIT 50'
  ).all();
});

ipcMain.handle('followers:export-csv', (_, targetUser) => {
  const db = getDb();
  const followers = db.prepare(
    'SELECT username, full_name, extracted_at FROM extracted_followers WHERE target_user = ? ORDER BY username'
  ).all(targetUser);
  const header = 'username,full_name,extracted_at';
  const rows = followers.map((f) => `${f.username},"${f.full_name}",${f.extracted_at}`);
  return [header, ...rows].join('\n');
});

ipcMain.handle('followers:delete', (_, targetUser) => {
  const db = getDb();
  db.prepare('DELETE FROM extracted_followers WHERE target_user = ?').run(targetUser);
  return { success: true };
});

// ─── IPC: Settings ─────────────────────────────────────────────────

ipcMain.handle('settings:get', (_, key) => {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
});

ipcMain.handle('settings:set', (_, key, value) => {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);

  // If captcha provider changed, update the manager
  if (key === 'captcha_provider') {
    setCaptchaProvider(value);
    console.log('[Captcha] Provider updated:', value);
  }
  // If capsolver key changed, update the manager
  if (key === 'capsolver_api_key') {
    setCapsolverKey(value);
    console.log('[CapSolver] API key updated');
  }

  return { success: true };
});

ipcMain.handle('settings:getAll', () => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM settings').all();
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
});

// ─── IPC: Dashboard Stats ──────────────────────────────────────────

ipcMain.handle('stats:actions', () => {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN action_type LIKE '%like%' THEN count ELSE 0 END), 0) as likes,
      COALESCE(SUM(CASE WHEN action_type LIKE '%follow' AND action_type NOT LIKE '%unfollow%' THEN count ELSE 0 END), 0) as follows,
      COALESCE(SUM(CASE WHEN action_type LIKE '%unfollow%' THEN count ELSE 0 END), 0) as unfollows,
      COALESCE(SUM(CASE WHEN action_type LIKE '%stories%' OR action_type LIKE '%reels%' THEN count ELSE 0 END), 0) as stories,
      COALESCE(SUM(CASE WHEN action_type LIKE '%comment%' THEN count ELSE 0 END), 0) as comments,
      COALESCE(SUM(CASE WHEN action_type LIKE '%dm%' THEN count ELSE 0 END), 0) as dms,
      COALESCE(SUM(CASE WHEN action_type LIKE '%visit%' THEN count ELSE 0 END), 0) as visits
    FROM action_log
  `).get();
  return row;
});

ipcMain.handle('stats:recent', (_, limit) => {
  const db = getDb();
  return db.prepare('SELECT * FROM action_log ORDER BY created_at DESC LIMIT ?').all(limit || 20);
});

ipcMain.handle('stats:daily', (_, days) => {
  const db = getDb();
  return db.prepare(`
    SELECT DATE(created_at) as date, SUM(count) as actions
    FROM action_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(days || 7);
});

// ─── IPC: Scheduled Tasks ──────────────────────────────────────────

ipcMain.handle('scheduler:list', () => {
  const db = getDb();
  return db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all();
});

ipcMain.handle('scheduler:create', (_, task) => {
  try {
    requirePro(cachedTier, 'scheduler:create');
    const db = getDb();
    const id = require('uuid').v4();
    const scheduleTime = task.schedule?.time || task.schedule_time || '08:00';
    const scheduleDays = JSON.stringify(task.schedule?.days || (typeof task.schedule_days === 'string' ? JSON.parse(task.schedule_days) : task.schedule_days) || [1,2,3,4,5]);
    const profileIds = JSON.stringify(task.profile_ids || []);
    db.prepare(`
      INSERT INTO scheduled_tasks (id, name, action, config, schedule_time, schedule_days, profile_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, task.name, task.action, JSON.stringify(task.config || {}), scheduleTime, scheduleDays, profileIds);
    return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
  } catch (err) {
    return err.error ? err : { error: err.message || 'Error desconocido' };
  }
});

ipcMain.handle('scheduler:toggle', (_, id) => {
  const db = getDb();
  db.prepare('UPDATE scheduled_tasks SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
});

ipcMain.handle('scheduler:delete', (_, id) => {
  const db = getDb();
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
  return { success: true };
});

// ─── IPC: Account Health ───────────────────────────────────────────

ipcMain.handle('health:check', async (_, profileId) => {
  try {
    const result = await checkAccountHealth(profileId);
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO account_health (profile_id, status, message, last_checked) VALUES (?, ?, ?, datetime('now'))`).run(profileId, result.status, result.message);
    return result;
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('health:checkAll', async () => {
  const db = getDb();
  const profiles = db.prepare('SELECT id FROM profiles').all();
  const results = [];
  const active = getActiveBrowsers();
  for (const p of profiles) {
    if (active.has(p.id)) {
      const result = await checkAccountHealth(p.id);
      db.prepare(`INSERT OR REPLACE INTO account_health (profile_id, status, message, last_checked) VALUES (?, ?, ?, datetime('now'))`).run(p.id, result.status, result.message);
      results.push({ profileId: p.id, ...result });
    } else {
      results.push({ profileId: p.id, status: 'error', message: 'Navegador no abierto' });
    }
  }
  return results;
});

ipcMain.handle('health:getAll', () => {
  const db = getDb();
  return db.prepare('SELECT * FROM account_health').all();
});

// ─── IPC: Shadowban ────────────────────────────────────────────────

ipcMain.handle('shadowban:check', async (_, profileId) => {
  try {
    requirePro(cachedTier, 'shadowban:check');
    const db = getDb();

    // Auto-launch browser if not already open
    const active = getActiveBrowsers();
    if (!active.has(profileId)) {
      const profile = decryptProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId));
      if (!profile) return { shadowbanned: false, checks: {}, message: 'Perfil no encontrado' };
      console.log(`[Shadowban] Auto-launching browser for ${profile.name}...`);
      await launchBrowser(profile);
      db.prepare("UPDATE profiles SET status = 'running' WHERE id = ?").run(profileId);
      // Wait for browser to initialize and login
      await new Promise(r => setTimeout(r, 5000));
    }

    const result = await checkShadowban(profileId);
    db.prepare(`INSERT OR REPLACE INTO account_health (profile_id, shadowban, shadowban_checks, last_checked) VALUES (?, ?, ?, datetime('now'))`)
      .run(profileId, result.shadowbanned ? 1 : 0, JSON.stringify(result.checks));
    return result;
  } catch (err) {
    return err.error ? err : { shadowbanned: false, checks: {}, message: err.message || 'Error desconocido' };
  }
});

ipcMain.handle('shadowban:getAll', () => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM account_health').all();
  const result = {};
  for (const row of rows) {
    result[row.profile_id] = row;
  }
  return result;
});

// ─── IPC: Warm-up ──────────────────────────────────────────────────

ipcMain.handle('warmup:getAll', () => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM warmup_status').all();
  const result = {};
  for (const row of rows) {
    result[row.profile_id] = row;
  }
  return result;
});

ipcMain.handle('warmup:start', async (_, profileId) => {
  try {
    requirePro(cachedTier, 'warmup:start');
    const db = getDb();

    // Auto-launch browser if not already open
    const active = getActiveBrowsers();
    if (!active.has(profileId)) {
      const profile = decryptProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId));
      if (!profile) return { error: 'Perfil no encontrado' };
      console.log(`[Warmup] Auto-launching browser for ${profile.name}...`);
      await launchBrowser(profile);
      db.prepare("UPDATE profiles SET status = 'running' WHERE id = ?").run(profileId);
    }

    db.prepare(`INSERT OR REPLACE INTO warmup_status (profile_id, active, day, started_at) VALUES (?, 1, 1, datetime('now'))`).run(profileId);
    return { success: true };
  } catch (err) {
    return err.error ? err : { error: err.message || 'Error desconocido' };
  }
});

ipcMain.handle('warmup:stop', (_, profileId) => {
  const db = getDb();
  db.prepare('UPDATE warmup_status SET active = 0 WHERE profile_id = ?').run(profileId);
  return { success: true };
});

ipcMain.handle('warmup:getStatus', (_, profileId) => {
  const db = getDb();
  return db.prepare('SELECT * FROM warmup_status WHERE profile_id = ?').get(profileId) || { active: 0, day: 0 };
});

// ─── IPC: Scrapers ─────────────────────────────────────────────────

ipcMain.handle('scrape:profiles', async (_, profileId, config) => {
  try {
    requirePro(cachedTier, 'scrape:profiles');
    const result = await scrapeProfiles(profileId, config);
    // Save results to DB
    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO scraped_data (target_user, data_type, value, scraped_by) VALUES (?, ?, ?, ?)');
    const profile = db.prepare('SELECT ig_user FROM profiles WHERE id = ?').get(profileId);
    for (const r of result.results) {
      if (r.error) continue;
      for (const email of (r.emails || [])) {
        stmt.run(r.username, 'email', email, profile?.ig_user || '');
      }
      for (const phone of (r.phones || [])) {
        stmt.run(r.username, 'phone', phone, profile?.ig_user || '');
      }
      if (r.bio) {
        stmt.run(r.username, 'bio', r.bio, profile?.ig_user || '');
      }
      if (r.externalLink) {
        stmt.run(r.username, 'link', r.externalLink, profile?.ig_user || '');
      }
    }
    return result;
  } catch (err) {
    return err.error ? err : { error: err.message || 'Error desconocido' };
  }
});

ipcMain.handle('scrape:hashtag-emails', async (_, profileId, config) => {
  try {
    requirePro(cachedTier, 'scrape:hashtag-emails');
    const result = await scrapeHashtagEmails(profileId, config);
    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO scraped_data (target_user, data_type, value, scraped_by) VALUES (?, ?, ?, ?)');
    const profile = db.prepare('SELECT ig_user FROM profiles WHERE id = ?').get(profileId);
    for (const r of result.results) {
      for (const email of (r.emails || [])) {
        stmt.run(r.username, 'email', email, profile?.ig_user || '');
      }
      for (const phone of (r.phones || [])) {
        stmt.run(r.username, 'phone', phone, profile?.ig_user || '');
      }
    }
    return result;
  } catch (err) {
    return err.error ? err : { error: err.message || 'Error desconocido' };
  }
});

ipcMain.handle('scrape:followers-data', async (_, profileId, config) => {
  try {
    requirePro(cachedTier, 'scrape:followers-data');
    const result = await scrapeFollowersData(profileId, config);
    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO scraped_data (target_user, data_type, value, scraped_by) VALUES (?, ?, ?, ?)');
    const profile = db.prepare('SELECT ig_user FROM profiles WHERE id = ?').get(profileId);
    for (const r of result.results) {
      for (const email of (r.emails || [])) {
        stmt.run(r.username, 'email', email, profile?.ig_user || '');
      }
      for (const phone of (r.phones || [])) {
        stmt.run(r.username, 'phone', phone, profile?.ig_user || '');
      }
    }
    return result;
  } catch (err) {
    return err.error ? err : { error: err.message || 'Error desconocido' };
  }
});

ipcMain.handle('scrape:getData', (_, dataType) => {
  const db = getDb();
  if (dataType) {
    return db.prepare('SELECT * FROM scraped_data WHERE data_type = ? ORDER BY scraped_at DESC').all(dataType);
  }
  return db.prepare('SELECT * FROM scraped_data ORDER BY scraped_at DESC').all();
});

ipcMain.handle('scrape:exportCsv', (_, dataType) => {
  const db = getDb();
  const data = db.prepare('SELECT target_user, data_type, value, scraped_at FROM scraped_data WHERE data_type = ? ORDER BY target_user').all(dataType);
  const header = 'username,type,value,date';
  const rows = data.map((d) => `${d.target_user},${d.data_type},"${d.value}",${d.scraped_at}`);
  return [header, ...rows].join('\n');
});

ipcMain.handle('scrape:delete', (_, dataType) => {
  const db = getDb();
  db.prepare('DELETE FROM scraped_data WHERE data_type = ?').run(dataType);
  return { success: true };
});

// ─── IPC: Facebook Automations ────────────────────────────────────────

const fb = require('./src/browser/facebook-automations');

ipcMain.handle('fb:marketplace-create', async (_, profileId, listing) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.marketplaceCreateListing(browser.page, listing);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:marketplace-repost', async (_, profileId, listingUrl, listingData) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.marketplaceRepost(browser.page, listingUrl, listingData);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:marketplace-scrape', async (_, profileId, query, maxResults) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.scrapeMarketplace(browser.page, query, maxResults);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:marketplace-autoreply', async (_, profileId, template) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.autoReplyMarketplace(browser.page, template);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:send-dm', async (_, profileId, recipient, message) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.sendMessage(browser.page, recipient, message);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:mass-dm', async (_, profileId, recipients, templates, options) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.sendMassDM(browser.page, recipients, templates, options);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:create-post', async (_, profileId, content, options) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.createPost(browser.page, content, options);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:post-group', async (_, profileId, groupUrl, content) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.postToGroup(browser.page, groupUrl, content);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:like', async (_, profileId, targetUrl, maxLikes) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.likePosts(browser.page, targetUrl, maxLikes);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:comment', async (_, profileId, targetUrl, comments, maxComments) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.commentOnPosts(browser.page, targetUrl, comments, maxComments);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:share', async (_, profileId, postUrl) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.sharePost(browser.page, postUrl);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:join-group', async (_, profileId, groupUrl) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.joinGroup(browser.page, groupUrl);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:add-friends', async (_, profileId, profileUrls, maxRequests) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.addFriends(browser.page, profileUrls, maxRequests);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:scrape-group', async (_, profileId, groupUrl, maxMembers) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.scrapeGroupMembers(browser.page, groupUrl, maxMembers);
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fb:warmup', async (_, profileId, options) => {
  try {
    const browsers = getActiveBrowsers();
    const browser = browsers[profileId];
    if (!browser?.page) return { error: 'Browser not running' };
    return await fb.warmupAccount(browser.page, options);
  } catch (err) { return { error: err.message }; }
});

// ─── IPC: AI Text Generation ──────────────────────────────────────

function aiRequest(provider, apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const isAnthropic = provider === 'anthropic';
    const isGemini = provider === 'gemini';
    let options, body;
    if (isGemini) {
      options = {
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: '/v1beta/models/gemini-2.0-flash:generateContent',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      };
      body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 150 } });
    } else {
      options = {
        hostname: isAnthropic ? 'api.anthropic.com' : 'api.openai.com',
        port: 443,
        path: isAnthropic ? '/v1/messages' : '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isAnthropic
            ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
            : { 'Authorization': `Bearer ${apiKey}` }),
        },
      };
      body = isAnthropic
        ? JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
        : JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 150, messages: [{ role: 'user', content: prompt }] });
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (isAnthropic) {
            resolve(json.content?.[0]?.text || '');
          } else if (isGemini) {
            resolve(json.candidates?.[0]?.content?.parts?.[0]?.text || '');
          } else {
            resolve(json.choices?.[0]?.message?.content || '');
          }
        } catch (e) { reject(new Error('AI response parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('AI request timeout')); });
    req.write(body);
    req.end();
  });
}

ipcMain.handle('ai:generate-text', async (_, provider, apiKey, prompt) => {
  try {
    const text = await aiRequest(provider, apiKey, prompt);
    return { success: true, text: text.trim() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Generic Run Automation (for ProfileList context menu) ───
ipcMain.handle('auto:run-generic', async (_, profileId, actionId, config) => {
  const handlerMap = {
    'like': 'auto:like',
    'like-hashtag': 'auto:like-hashtag',
    'like-feed': 'auto:like-feed',
    'like-explore': 'auto:like-explore',
    'follow': 'auto:follow',
    'follow-hashtag': 'auto:follow-hashtag',
    'unfollow': 'auto:unfollow',
    'watch-reels': 'auto:watch-reels',
    'stories': 'auto:stories',
    'visit': 'auto:visit',
    'comment': 'auto:comment',
    'send-dm': 'auto:send-dm',
    'extract': 'auto:extract-followers',
    'buff-post': 'auto:buff-post',
  };
  const autoKey = handlerMap[actionId];
  if (!autoKey) return { error: `Unknown action: ${actionId}` };
  const fn = automationMap[autoKey];
  if (!fn) return { error: `No handler for: ${autoKey}` };
  try {
    return await fn(profileId, config);
  } catch (err) {
    return { error: err.message };
  }
});
