const { getActiveBrowsers } = require('./manager');

// ─── 14-Day Warm-up Plan ─────────────────────────────────────────
// Gradual increase in daily actions to simulate organic growth
const WARMUP_PLAN = {
  1:  { likes: 3,  follows: 1, stories: 5,  comments: 0 },
  2:  { likes: 5,  follows: 2, stories: 8,  comments: 0 },
  3:  { likes: 8,  follows: 3, stories: 10, comments: 1 },
  4:  { likes: 10, follows: 4, stories: 12, comments: 1 },
  5:  { likes: 12, follows: 5, stories: 15, comments: 2 },
  6:  { likes: 15, follows: 6, stories: 15, comments: 2 },
  7:  { likes: 18, follows: 8, stories: 18, comments: 3 },
  8:  { likes: 20, follows: 10, stories: 20, comments: 3 },
  9:  { likes: 22, follows: 12, stories: 22, comments: 4 },
  10: { likes: 25, follows: 14, stories: 25, comments: 4 },
  11: { likes: 28, follows: 16, stories: 28, comments: 5 },
  12: { likes: 30, follows: 18, stories: 30, comments: 5 },
  13: { likes: 33, follows: 20, stories: 30, comments: 6 },
  14: { likes: 35, follows: 22, stories: 30, comments: 6 },
};

const processingProfiles = new Set();

let intervalRef = null;
let dbGetter = null;
let eventCallback = null;

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function emitWarmup(profileId, event, data) {
  if (eventCallback) {
    eventCallback(profileId, event, { ...data, source: 'warmup-auto' });
  }
}

// ─── Helper: get page safely ─────────────────────────────────────

function getPage(profileId) {
  const browsers = getActiveBrowsers();
  const entry = browsers.get(profileId);
  if (!entry) return null;
  const pages = entry.context.pages();
  return pages[0] || null;
}

// ─── Helper: wait until page is ready (loaded + logged in) ───────

async function waitForPageReady(profileId, maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const page = getPage(profileId);
    if (page) {
      try {
        const url = page.url();
        // Instagram: check we're on a real page (not about:blank, not login)
        if (url.includes('instagram.com') && !url.includes('/accounts/login') && !url.includes('challenge')) {
          return page;
        }
      } catch { /* page not ready yet */ }
    }
    await sleep(2000);
  }
  return null;
}

// ─── Day Advancement & Reset ─────────────────────────────────────

function checkAndAdvanceDay(db, warmup) {
  const lastActionDate = warmup.last_action
    ? warmup.last_action.slice(0, 10)
    : null;
  const today = todayDateStr();

  if (lastActionDate && lastActionDate < today) {
    const newDay = warmup.day + 1;

    if (newDay > 14) {
      db.prepare(
        'UPDATE warmup_status SET active = 0, day = 14 WHERE profile_id = ?'
      ).run(warmup.profile_id);
      emitWarmup(warmup.profile_id, 'done', { type: 'warmup', message: 'Warm-up de 14 dias completado' });
      return null;
    }

    db.prepare(`
      UPDATE warmup_status
      SET day = ?, today_likes = 0, today_follows = 0, today_stories = 0, today_comments = 0
      WHERE profile_id = ?
    `).run(newDay, warmup.profile_id);

    return { ...warmup, day: newDay, today_likes: 0, today_follows: 0, today_stories: 0, today_comments: 0 };
  }

  return warmup;
}

// ─── Direct Warmup Actions (no dependency on automations.js) ─────
// These run directly on the page to avoid conflicts with activeAutomations

async function warmupLikeFeed(page, maxLikes) {
  let liked = 0;
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(randomDelay(3000, 5000));

    for (let i = 0; i < maxLikes; i++) {
      try {
        // Scroll to find new posts
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(randomDelay(1500, 3000));

        // Find unliked heart buttons
        const likeBtn = page.locator('article section svg[aria-label="Like"], article section svg[aria-label="Me gusta"]').first();
        if (await likeBtn.isVisible({ timeout: 3000 })) {
          await likeBtn.click();
          liked++;
          console.log(`[Warmup] Liked post ${liked}/${maxLikes}`);
          await page.waitForTimeout(randomDelay(3000, 7000));
        }
      } catch { /* skip this post */ }
    }
  } catch (err) {
    console.log(`[Warmup] likeFeed error: ${err.message}`);
  }
  return liked;
}

async function warmupViewStories(page, maxStories) {
  let viewed = 0;
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Try to click first story in the tray
    const storySelectors = [
      'div[role="menu"] button',
      'canvas',
      'header + div button',
      '[role="presentation"] button',
    ];

    let clicked = false;
    for (const sel of storySelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          clicked = true;
          break;
        }
      } catch { /* try next */ }
    }

    if (!clicked) return viewed;

    await page.waitForTimeout(randomDelay(2000, 4000));

    // Watch stories
    for (let i = 0; i < maxStories; i++) {
      try {
        if (!page.url().includes('/stories/')) break;

        viewed++;
        console.log(`[Warmup] Viewed story ${viewed}/${maxStories}`);

        // Natural viewing time per story
        await page.waitForTimeout(randomDelay(3000, 6000));

        // Click right side to go to next story
        const viewportSize = page.viewportSize();
        if (viewportSize) {
          await page.mouse.click(viewportSize.width * 0.8, viewportSize.height * 0.5);
        } else {
          await page.keyboard.press('ArrowRight');
        }
        await page.waitForTimeout(randomDelay(500, 1500));
      } catch { break; }
    }

    // Go back to feed
    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 15000 }).catch(() => {});
  } catch (err) {
    console.log(`[Warmup] viewStories error: ${err.message}`);
  }
  return viewed;
}

async function warmupFollowSuggestions(page, maxFollows) {
  let followed = 0;
  try {
    // Go to explore or suggestions
    await page.goto('https://www.instagram.com/explore/people/', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(randomDelay(3000, 5000));

    // If explore/people doesn't work, try from feed
    if (!page.url().includes('explore')) {
      await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(randomDelay(2000, 4000));
    }

    for (let i = 0; i < maxFollows; i++) {
      try {
        const followBtn = page.locator('button').filter({ hasText: /^(Follow|Seguir)$/ }).first();
        if (await followBtn.isVisible({ timeout: 3000 })) {
          await followBtn.click();
          followed++;
          console.log(`[Warmup] Followed ${followed}/${maxFollows}`);
          await page.waitForTimeout(randomDelay(4000, 10000));
        } else {
          // Scroll to find more
          await page.evaluate(() => window.scrollBy(0, 400));
          await page.waitForTimeout(randomDelay(2000, 4000));
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    console.log(`[Warmup] followSuggestions error: ${err.message}`);
  }
  return followed;
}

async function warmupBrowseFeed(page) {
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Scroll through feed naturally
    const scrolls = randomDelay(5, 12);
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, randomDelay(300, 600)));
      await page.waitForTimeout(randomDelay(2000, 5000));
    }

    // Visit explore briefly
    await page.goto('https://www.instagram.com/explore/', { waitUntil: 'load', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(randomDelay(3000, 6000));

    console.log(`[Warmup] Feed browsing completed (${scrolls} scrolls)`);
  } catch (err) {
    console.log(`[Warmup] browseFeed error: ${err.message}`);
  }
}

// ─── Execute Warm-up for a Single Profile ────────────────────────

async function executeWarmupForProfile(db, warmup) {
  const profileId = warmup.profile_id;

  if (processingProfiles.has(profileId)) return;

  const dayPlan = WARMUP_PLAN[warmup.day];
  if (!dayPlan) return;

  const remainingLikes = Math.max(0, dayPlan.likes - (warmup.today_likes || 0));
  const remainingFollows = Math.max(0, dayPlan.follows - (warmup.today_follows || 0));
  const remainingStories = Math.max(0, dayPlan.stories - (warmup.today_stories || 0));

  if (remainingLikes === 0 && remainingFollows === 0 && remainingStories === 0) return;

  // Wait for page to be ready (logged in)
  const page = await waitForPageReady(profileId);
  if (!page) {
    console.log(`[Warmup] ${profileId}: browser not ready, skipping this tick`);
    return;
  }

  processingProfiles.add(profileId);

  try {
    emitWarmup(profileId, 'start', {
      type: 'warmup',
      day: warmup.day,
      plan: dayPlan,
      remaining: { likes: remainingLikes, follows: remainingFollows, stories: remainingStories },
    });

    console.log(`[Warmup] ${profileId}: Day ${warmup.day} — executing batch (likes: ${remainingLikes}, stories: ${remainingStories}, follows: ${remainingFollows})`);

    // ── Step 1: Browse feed naturally (always) ──
    await warmupBrowseFeed(page);
    await sleep(randomDelay(5000, 15000));

    // ── Step 2: Like feed posts ──
    if (remainingLikes > 0) {
      const batchLikes = Math.min(remainingLikes, randomDelay(3, 6));
      const actualLikes = await warmupLikeFeed(page, batchLikes);
      if (actualLikes > 0) {
        db.prepare(
          "UPDATE warmup_status SET today_likes = today_likes + ?, last_action = datetime('now') WHERE profile_id = ?"
        ).run(actualLikes, profileId);
        emitWarmup(profileId, 'progress', { type: 'warmup', action: 'likes', done: actualLikes, day: warmup.day });
      }
      await sleep(randomDelay(30000, 90000));
    }

    // ── Step 3: View stories ──
    if (remainingStories > 0) {
      const batchStories = Math.min(remainingStories, randomDelay(3, 8));
      const actualStories = await warmupViewStories(page, batchStories);
      if (actualStories > 0) {
        db.prepare(
          "UPDATE warmup_status SET today_stories = today_stories + ?, last_action = datetime('now') WHERE profile_id = ?"
        ).run(actualStories, profileId);
        emitWarmup(profileId, 'progress', { type: 'warmup', action: 'stories', done: actualStories, day: warmup.day });
      }
      await sleep(randomDelay(30000, 90000));
    }

    // ── Step 4: Follow from suggestions ──
    if (remainingFollows > 0) {
      const batchFollows = Math.min(remainingFollows, randomDelay(1, 3));
      const actualFollows = await warmupFollowSuggestions(page, batchFollows);
      if (actualFollows > 0) {
        db.prepare(
          "UPDATE warmup_status SET today_follows = today_follows + ?, last_action = datetime('now') WHERE profile_id = ?"
        ).run(actualFollows, profileId);
        emitWarmup(profileId, 'progress', { type: 'warmup', action: 'follows', done: actualFollows, day: warmup.day });
      }
    }

    // Update last_action
    db.prepare(
      "UPDATE warmup_status SET last_action = datetime('now') WHERE profile_id = ?"
    ).run(profileId);

    console.log(`[Warmup] ${profileId}: Day ${warmup.day} batch completed`);
    emitWarmup(profileId, 'done', {
      type: 'warmup-batch',
      day: warmup.day,
      message: `Batch de warm-up dia ${warmup.day} ejecutado`,
    });

  } catch (err) {
    console.log(`[Warmup] Error general para ${profileId}:`, err.message);
    emitWarmup(profileId, 'error', { type: 'warmup', error: err.message });
  } finally {
    processingProfiles.delete(profileId);
  }
}

// ─── Main Tick ───────────────────────────────────────────────────

async function warmupTick() {
  if (!dbGetter) return;

  try {
    const db = dbGetter();
    const activeWarmups = db.prepare('SELECT * FROM warmup_status WHERE active = 1').all();

    if (activeWarmups.length === 0) return;

    console.log(`[Warmup] Tick: ${activeWarmups.length} active warmups`);

    for (const warmup of activeWarmups) {
      const updated = checkAndAdvanceDay(db, warmup);
      if (!updated) continue;

      // Stagger between profiles (15-45 seconds)
      await sleep(randomDelay(15000, 45000));

      // Execute sequentially (not in parallel) to avoid overload
      await executeWarmupForProfile(db, updated);
    }
  } catch (err) {
    console.log('[Warmup] Error en tick general:', err.message);
  }
}

// ─── Start / Stop ────────────────────────────────────────────────

function startWarmupExecutor(getDbFn, onEventFn) {
  dbGetter = getDbFn;
  eventCallback = onEventFn || null;

  console.log('[Warmup] Executor iniciado - verificacion cada 5 minutos');
  // First tick after 30 seconds (give browsers time to start)
  setTimeout(() => warmupTick(), 30000);
  intervalRef = setInterval(warmupTick, 5 * 60 * 1000);
}

function stopWarmupExecutor() {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = null;
  }
  console.log('[Warmup] Executor detenido');
}

module.exports = {
  startWarmupExecutor,
  stopWarmupExecutor,
  WARMUP_PLAN,
};
