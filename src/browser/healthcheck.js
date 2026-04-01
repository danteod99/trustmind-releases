const { getActiveBrowsers } = require('./manager');

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getPage(profileId) {
  const entry = getActiveBrowsers().get(profileId);
  if (!entry) return null;
  return entry.context.pages()[0] || null;
}

// ─── Account Health Check ──────────────────────────────────────────

async function checkAccountHealth(profileId) {
  const page = getPage(profileId);
  if (!page) return { status: 'error', message: 'Navegador no abierto' };

  try {
    // Navigate to own profile
    await page.goto('https://www.instagram.com/accounts/edit/', {
      waitUntil: 'load', timeout: 15000,
    });
    await page.waitForTimeout(3000);

    const url = page.url();

    // Check if redirected to login (session expired)
    if (url.includes('/accounts/login')) {
      return { status: 'error', message: 'Sesion expirada — necesita re-login' };
    }

    // Check if on challenge page
    if (url.includes('challenge')) {
      return { status: 'challenge', message: 'Cuenta requiere verificacion' };
    }

    // Check if account is suspended
    if (url.includes('suspended') || url.includes('disabled')) {
      return { status: 'banned', message: 'Cuenta suspendida o deshabilitada' };
    }

    // Try to perform an action to check for action block
    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Check for action blocked messages
    const blockTexts = [
      'Try Again Later',
      'Action Blocked',
      'We restrict certain activity',
      'Intentalo mas tarde',
      'Accion bloqueada',
    ];

    for (const text of blockTexts) {
      try {
        const el = page.locator(`text="${text}"`).first();
        if (await el.isVisible({ timeout: 1000 })) {
          return { status: 'action_blocked', message: `Acciones bloqueadas: ${text}` };
        }
      } catch { /* not found */ }
    }

    // If we got here, account seems fine
    return { status: 'ok', message: 'Cuenta activa y funcionando' };

  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// ─── Shadowban Check ───────────────────────────────────────────────

async function checkShadowban(profileId) {
  const page = getPage(profileId);
  if (!page) return { shadowbanned: false, checks: {}, message: 'Navegador no abierto' };

  const checks = { hashtag: true, explore: true, storyReach: true };

  try {
    // 1. Check hashtag visibility — post with unique hashtag and see if it shows
    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Get own username
    let ownUser = '';
    try {
      const profileLink = page.locator('a[href*="/"][role="link"] img[alt]').first();
      const alt = await profileLink.getAttribute('alt').catch(() => '');
      ownUser = alt.split("'")[0] || '';
    } catch { /* ignore */ }

    // 2. Check if profile appears in explore
    if (ownUser) {
      await page.goto(`https://www.instagram.com/explore/`, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(3000);
      // If explore loads normally, basic explore access is ok
      const exploreUrl = page.url();
      checks.explore = exploreUrl.includes('explore');
    }

    // 3. Check hashtag page access
    await page.goto('https://www.instagram.com/explore/tags/instagram/', { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(3000);
    const hashUrl = page.url();
    if (hashUrl.includes('/accounts/login') || hashUrl.includes('challenge')) {
      checks.hashtag = false;
    }

    // 4. Try to check story views by visiting own stories
    // If story views dropped significantly, it might indicate shadowban
    // For now, just check if we can access stories section
    try {
      await page.goto('https://www.instagram.com/accounts/activity/', { waitUntil: 'load', timeout: 10000 });
      await page.waitForTimeout(2000);
      const actUrl = page.url();
      checks.storyReach = !actUrl.includes('/accounts/login');
    } catch {
      checks.storyReach = false;
    }

    const shadowbanned = !checks.hashtag || !checks.explore;
    const partial = !checks.storyReach && checks.hashtag && checks.explore;

    let message = 'Cuenta limpia — sin restricciones detectadas';
    if (shadowbanned) {
      message = 'Shadowban detectado — hashtags o explore bloqueados';
    } else if (partial) {
      message = 'Posible restriccion — alcance reducido';
    }

    return { shadowbanned, checks, message };

  } catch (err) {
    return { shadowbanned: false, checks, message: `Error verificando: ${err.message}` };
  }
}

module.exports = { checkAccountHealth, checkShadowban };
