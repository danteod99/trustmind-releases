const { getActiveBrowsers } = require('./manager');
const fs = require('fs');
const path = require('path');

// Elige una imagen AL AZAR de una carpeta (para foto de perfil distinta por cuenta).
function pickRandomImage(folder) {
  try {
    if (!folder || !fs.existsSync(folder)) return null;
    const files = fs.readdirSync(folder).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
    if (!files.length) return null;
    return path.join(folder, files[Math.floor(Math.random() * files.length)]);
  } catch { return null; }
}

// Active automation tasks: Map<profileId, { type, running, cancel }>
const activeAutomations = new Map();

// Event callback to notify renderer
let automationCallback = null;

function onAutomationEvent(callback) {
  automationCallback = callback;
}

function emit(profileId, event, data) {
  if (automationCallback) {
    automationCallback(profileId, event, data);
  }
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getPage(profileId) {
  const entry = getActiveBrowsers().get(profileId);
  if (!entry) throw new Error('Navegador no esta abierto');
  try {
    const pages = entry.context.pages();
    if (!pages || pages.length === 0) return null;
    return pages[0];
  } catch {
    return null;
  }
}

// ─── Auto Like ─────────────────────────────────────────────────────

async function autoLike(profileId, config) {
  const { targetUser, maxLikes = 10 } = config;
  let cancelled = false;
  let likesGiven = 0;

  const task = {
    type: 'auto-like',
    running: true,
    cancel: () => { cancelled = true; },
  };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'auto-like', target: targetUser });

    // Go to target profile
    await page.goto(`https://www.instagram.com/${targetUser}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Get post links
    const postLinks = await page.locator('main article a[href*="/p/"], main a[href*="/p/"]').all();
    const postsToLike = Math.min(postLinks.length, maxLikes);

    for (let i = 0; i < postsToLike; i++) {
      if (cancelled) break;

      emit(profileId, 'progress', {
        type: 'auto-like',
        current: i + 1,
        total: postsToLike,
        target: targetUser,
      });

      // Click on post
      try {
        await postLinks[i].click();
        await page.waitForTimeout(randomDelay(1500, 3000));

        // Find like button (not already liked)
        const likeBtn = page.locator('section svg[aria-label="Like"], section svg[aria-label="Me gusta"]').first();
        const isVisible = await likeBtn.isVisible().catch(() => false);

        if (isVisible) {
          await likeBtn.click();
          likesGiven++;
          await page.waitForTimeout(randomDelay(800, 1500));
        }

        // Close post modal
        await page.keyboard.press('Escape');
        await page.waitForTimeout(randomDelay(2000, 5000));
      } catch {
        // Post might have different structure, skip
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(randomDelay(1000, 2000));
      }
    }

    emit(profileId, 'done', { type: 'auto-like', likesGiven, target: targetUser });
  } catch (err) {
    emit(profileId, 'error', { type: 'auto-like', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }

  return { likesGiven };
}

// ─── Auto Follow ───────────────────────────────────────────────────

async function autoFollow(profileId, config) {
  const { targetUser, maxFollows = 10, source = 'followers' } = config;
  let cancelled = false;
  let followed = 0;

  const task = {
    type: 'auto-follow',
    running: true,
    cancel: () => { cancelled = true; },
  };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'auto-follow', target: targetUser });

    // Go to target profile
    await page.goto(`https://www.instagram.com/${targetUser}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Click on followers/following link
    const listLink = page.locator(`a[href="/${targetUser}/${source}/"]`);
    await listLink.click();
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Wait for the modal/list to appear
    await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
    await page.waitForTimeout(randomDelay(1000, 2000));

    // Scroll and collect follow buttons
    for (let i = 0; i < maxFollows; i++) {
      if (cancelled) break;

      emit(profileId, 'progress', {
        type: 'auto-follow',
        current: i + 1,
        total: maxFollows,
        target: targetUser,
      });

      try {
        // Find "Follow" / "Seguir" buttons in the dialog
        const followBtns = page.locator('div[role="dialog"] button').filter({
          hasText: /^(Follow|Seguir)$/,
        });

        const count = await followBtns.count();
        if (count === 0) {
          // Scroll down in the list to load more
          const dialog = page.locator('div[role="dialog"] div[style*="overflow"]').first();
          await dialog.evaluate((el) => el.scrollBy(0, 400));
          await page.waitForTimeout(randomDelay(1500, 3000));
          continue;
        }

        await followBtns.first().click();
        followed++;
        await page.waitForTimeout(randomDelay(3000, 7000));
      } catch {
        await page.waitForTimeout(randomDelay(2000, 4000));
      }
    }

    // Close dialog
    await page.keyboard.press('Escape').catch(() => {});

    emit(profileId, 'done', { type: 'auto-follow', followed, target: targetUser });
  } catch (err) {
    emit(profileId, 'error', { type: 'auto-follow', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }

  return { followed };
}

// ─── Auto Unfollow ─────────────────────────────────────────────────

async function autoUnfollow(profileId, config) {
  const { maxUnfollows = 10 } = config;
  let cancelled = false;
  let unfollowed = 0;

  const task = {
    type: 'auto-unfollow',
    running: true,
    cancel: () => { cancelled = true; },
  };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'auto-unfollow' });

    // Go to own profile
    await page.goto('https://www.instagram.com/accounts/activity/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(randomDelay(1000, 2000));

    // Navigate to own profile to get following list
    const profileLink = page.locator('a[href*="/following"]').first();
    await profileLink.click().catch(async () => {
      // Fallback: go to profile page
      const avatar = page.locator('img[data-testid="user-avatar"]').first();
      await avatar.click();
      await page.waitForTimeout(randomDelay(1500, 3000));
      const followingLink = page.locator('a[href*="/following"]').first();
      await followingLink.click();
    });
    await page.waitForTimeout(randomDelay(2000, 4000));

    await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });

    for (let i = 0; i < maxUnfollows; i++) {
      if (cancelled) break;

      emit(profileId, 'progress', {
        type: 'auto-unfollow',
        current: i + 1,
        total: maxUnfollows,
      });

      try {
        // Find "Following" / "Siguiendo" buttons
        const followingBtns = page.locator('div[role="dialog"] button').filter({
          hasText: /^(Following|Siguiendo)$/,
        });

        const count = await followingBtns.count();
        if (count === 0) {
          const dialog = page.locator('div[role="dialog"] div[style*="overflow"]').first();
          await dialog.evaluate((el) => el.scrollBy(0, 400));
          await page.waitForTimeout(randomDelay(1500, 3000));
          continue;
        }

        await followingBtns.first().click();
        await page.waitForTimeout(randomDelay(500, 1000));

        // Confirm unfollow in the popup
        const confirmBtn = page.locator('button:has-text("Unfollow"), button:has-text("Dejar de seguir")');
        await confirmBtn.click({ timeout: 3000 });
        unfollowed++;
        await page.waitForTimeout(randomDelay(3000, 7000));
      } catch {
        await page.waitForTimeout(randomDelay(2000, 4000));
      }
    }

    await page.keyboard.press('Escape').catch(() => {});

    emit(profileId, 'done', { type: 'auto-unfollow', unfollowed });
  } catch (err) {
    emit(profileId, 'error', { type: 'auto-unfollow', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }

  return { unfollowed };
}

// ─── Auto View Stories ─────────────────────────────────────────────

async function autoViewStories(profileId, config) {
  const { targetUser } = config;
  let storiesViewed = 0;

  const task = {
    type: 'auto-stories',
    running: true,
    cancel: () => {},
  };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'auto-stories', target: targetUser });

    if (targetUser) {
      // View specific user's stories
      await page.goto(`https://www.instagram.com/stories/${targetUser}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
    } else {
      // View stories from feed
      await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForTimeout(randomDelay(2000, 4000));

      // Click first story in the tray
      const storyBtn = page.locator('div[role="menu"] button, canvas').first();
      await storyBtn.click({ timeout: 5000 }).catch(async () => {
        // Try clicking story ring
        const storyRing = page.locator('header + div button, [role="presentation"] button').first();
        await storyRing.click();
      });
    }

    await page.waitForTimeout(randomDelay(3000, 5000));

    // Watch stories - keep clicking next
    for (let i = 0; i < 30; i++) {
      try {
        // Check if we're still on a story page
        const isStory = page.url().includes('/stories/');
        if (!isStory) break;

        storiesViewed++;
        emit(profileId, 'progress', {
          type: 'auto-stories',
          current: storiesViewed,
          target: targetUser || 'feed',
        });

        // Wait 3-6 seconds per story (natural viewing time)
        await page.waitForTimeout(randomDelay(3000, 6000));

        // Click next story
        const nextBtn = page.locator('button[aria-label="Next"], button[aria-label="Siguiente"]').first();
        const hasNext = await nextBtn.isVisible().catch(() => false);
        if (hasNext) {
          await nextBtn.click();
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    emit(profileId, 'done', { type: 'auto-stories', storiesViewed, target: targetUser || 'feed' });
  } catch (err) {
    emit(profileId, 'error', { type: 'auto-stories', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }

  return { storiesViewed };
}

// ─── Auto Visit Profiles ──────────────────────────────────────────

async function autoVisitProfiles(profileId, config) {
  const { usernames = [] } = config;
  let visited = 0;
  let cancelled = false;

  const task = {
    type: 'auto-visit',
    running: true,
    cancel: () => { cancelled = true; },
  };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'auto-visit', total: usernames.length });

    for (let i = 0; i < usernames.length; i++) {
      if (cancelled) break;
      const user = usernames[i].trim().replace(/^@/, '');
      if (!user) continue;

      emit(profileId, 'progress', {
        type: 'auto-visit',
        current: i + 1,
        total: usernames.length,
        currentUser: user,
      });

      try {
        await page.goto(`https://www.instagram.com/${user}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });

        // Stay on profile for a natural amount of time
        await page.waitForTimeout(randomDelay(3000, 8000));

        // Scroll down a bit to simulate browsing
        await page.evaluate(() => window.scrollBy(0, 300));
        await page.waitForTimeout(randomDelay(1000, 3000));

        visited++;
      } catch {
        // Profile might not exist or timeout
      }

      // Delay between profile visits
      await page.waitForTimeout(randomDelay(2000, 5000));
    }

    emit(profileId, 'done', { type: 'auto-visit', visited });
  } catch (err) {
    emit(profileId, 'error', { type: 'auto-visit', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }

  return { visited };
}

// ─── Auto Comment ──────────────────────────────────────────────────

async function autoComment(profileId, config) {
  const { targetUser, comments = [], maxComments = 5 } = config;
  let commented = 0;
  let cancelled = false;

  const task = {
    type: 'auto-comment',
    running: true,
    cancel: () => { cancelled = true; },
  };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    if (comments.length === 0) throw new Error('Se necesita al menos un comentario');

    // Escribe UN comentario en el post/reel que esté abierto actualmente
    const commentBoxSel = 'textarea[aria-label*="coment" i], textarea[aria-label*="comment" i], textarea[placeholder*="coment" i], textarea[placeholder*="comment" i], textarea[aria-label*="Agrega" i], textarea[aria-label*="Add a comment" i]';
    const postCommentOnCurrent = async () => {
      const comment = comments[Math.floor(Math.random() * comments.length)];
      let commentInput = page.locator(commentBoxSel).first();
      // Si no está visible, click en el ícono de comentar para abrir la caja
      if (!(await commentInput.isVisible({ timeout: 3000 }).catch(() => false))) {
        await page.locator('svg[aria-label="Comentario"], svg[aria-label="Comment"]').first().click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1500);
        commentInput = page.locator(commentBoxSel).first();
      }
      await commentInput.click({ timeout: 6000 });
      await page.waitForTimeout(randomDelay(500, 1000));
      for (const char of comment) {
        await commentInput.pressSequentially(char, { delay: randomDelay(30, 100) });
      }
      await page.waitForTimeout(randomDelay(500, 1500));
      // Publicar: botón "Publicar"/"Post" o Enter como respaldo
      const postBtn = page.locator('div[role="button"]:has-text("Publicar"), div[role="button"]:has-text("Post"), button:has-text("Publicar"), button:has-text("Post")').first();
      if (await postBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await postBtn.click().catch(() => {});
      } else {
        await commentInput.press('Enter').catch(() => {});
      }
    };

    // ── MODO POST ESPECÍFICO: si pegan el link de un post/reel, comentar UNA vez ahí ──
    let postUrl = (config.postUrl || '').trim();
    // Acepta posts (/p/), reels (/reel/ y /reels/) e IGTV (/tv/)
    const isPostUrl = /instagram\.com\/(p|reel|reels|tv)\//i.test(postUrl);
    // Los reels NO tienen caja de comentario inline; se abren como /p/ (misma publicación)
    postUrl = postUrl.replace(/instagram\.com\/(reels?|tv)\//i, 'instagram.com/p/');
    if (isPostUrl) {
      emit(profileId, 'start', { type: 'auto-comment', target: postUrl });
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(randomDelay(3000, 4500));
      try {
        await postCommentOnCurrent();
        commented = 1;
        await page.waitForTimeout(randomDelay(2000, 4000));
      } catch (e) {
        emit(profileId, 'error', { type: 'auto-comment', error: 'No se pudo comentar en el post: ' + e.message });
      }
      emit(profileId, 'done', { type: 'auto-comment', commented, target: postUrl });
      return { commented };
    }

    if (!targetUser) throw new Error('Pega el link de un post o pon un perfil objetivo (@usuario)');

    emit(profileId, 'start', { type: 'auto-comment', target: targetUser });

    await page.goto(`https://www.instagram.com/${targetUser}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(randomDelay(2000, 4000));

    const postLinks = await page.locator('main a[href*="/p/"]').all();
    const postsToComment = Math.min(postLinks.length, maxComments);

    for (let i = 0; i < postsToComment; i++) {
      if (cancelled) break;

      emit(profileId, 'progress', {
        type: 'auto-comment',
        current: i + 1,
        total: postsToComment,
        target: targetUser,
      });

      try {
        await postLinks[i].click();
        await page.waitForTimeout(randomDelay(2000, 4000));

        // Pick a random comment
        const comment = comments[Math.floor(Math.random() * comments.length)];

        // Find comment input
        const commentInput = page.locator('textarea[aria-label*="comment"], textarea[aria-label*="comentario"], textarea[placeholder*="comment"], textarea[placeholder*="comentario"]').first();
        await commentInput.click();
        await page.waitForTimeout(randomDelay(500, 1000));

        // Type comment with human-like speed
        for (const char of comment) {
          await commentInput.pressSequentially(char, { delay: randomDelay(30, 100) });
        }

        await page.waitForTimeout(randomDelay(500, 1500));

        // Submit comment
        const postBtn = page.locator('button:has-text("Post"), button:has-text("Publicar"), div[role="button"]:has-text("Post")').first();
        await postBtn.click();
        commented++;

        await page.waitForTimeout(randomDelay(2000, 4000));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(randomDelay(5000, 15000));
      } catch {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(randomDelay(2000, 4000));
      }
    }

    emit(profileId, 'done', { type: 'auto-comment', commented, target: targetUser });
  } catch (err) {
    emit(profileId, 'error', { type: 'auto-comment', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }

  return { commented };
}

// ─── Extract Followers ─────────────────────────────────────────────

async function extractFollowers(profileId, config) {
  const { targetUser, maxFollowers = 200 } = config;
  let cancelled = false;
  const followers = [];

  const task = {
    type: 'extract-followers',
    running: true,
    cancel: () => { cancelled = true; },
  };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'extract-followers', target: targetUser });

    // Navigate to target profile
    await page.goto(`https://www.instagram.com/${targetUser}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Click on followers count to open the list
    const followersLink = page.locator(`a[href="/${targetUser}/followers/"]`);
    await followersLink.click();
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Wait for the followers dialog
    await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
    await page.waitForTimeout(randomDelay(1500, 2500));

    // Find the scrollable container inside the dialog
    const dialog = page.locator('div[role="dialog"]');

    let previousCount = 0;
    let stuckCount = 0;

    while (followers.length < maxFollowers && !cancelled) {
      // Extract visible follower items from the dialog
      const items = await dialog.locator('div[role="dialog"] a[role="link"][href^="/"]').all();

      for (const item of items) {
        if (followers.length >= maxFollowers || cancelled) break;

        try {
          const href = await item.getAttribute('href');
          if (!href || href === `/${targetUser}/`) continue;

          const username = href.replace(/\//g, '');
          if (!username || username.includes('/') || followers.find((f) => f.username === username)) continue;

          // Try to get full name from sibling/parent
          let fullName = '';
          try {
            const parent = item.locator('..').locator('..');
            const nameSpan = parent.locator('span').filter({ hasNotText: username }).first();
            fullName = await nameSpan.textContent({ timeout: 500 }).catch(() => '');
            // Clean up - don't use strings that look like button text
            if (['Follow', 'Seguir', 'Following', 'Siguiendo', 'Requested'].includes(fullName?.trim())) {
              fullName = '';
            }
          } catch {
            // No name found
          }

          followers.push({ username, fullName: fullName?.trim() || '' });

          if (followers.length % 10 === 0) {
            emit(profileId, 'progress', {
              type: 'extract-followers',
              current: followers.length,
              total: maxFollowers,
              target: targetUser,
            });
          }
        } catch {
          // Skip problematic elements
        }
      }

      // Check if we're making progress
      if (followers.length === previousCount) {
        stuckCount++;
        if (stuckCount > 5) break; // Stop if no new followers after 5 scroll attempts
      } else {
        stuckCount = 0;
        previousCount = followers.length;
      }

      // Scroll down in the dialog to load more
      try {
        const scrollable = dialog.locator('div[style*="overflow"]').first();
        await scrollable.evaluate((el) => el.scrollBy(0, 600));
      } catch {
        // Try scrolling the dialog itself
        await dialog.evaluate((el) => {
          const scrollEl = el.querySelector('[style*="overflow"]') || el;
          scrollEl.scrollBy(0, 600);
        });
      }

      await page.waitForTimeout(randomDelay(1500, 3000));
    }

    // Close dialog
    await page.keyboard.press('Escape').catch(() => {});

    emit(profileId, 'done', {
      type: 'extract-followers',
      count: followers.length,
      target: targetUser,
    });
  } catch (err) {
    emit(profileId, 'error', { type: 'extract-followers', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }

  return { followers, target: targetUser };
}

// ─── Like por Hashtag ──────────────────────────────────────────────

async function likeByHashtag(profileId, config) {
  const { hashtag, maxLikes = 15 } = config;
  let cancelled = false;
  let likesGiven = 0;

  const task = { type: 'like-hashtag', running: true, cancel: () => { cancelled = true; } };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');
    const tag = hashtag.replace(/^#/, '');

    emit(profileId, 'start', { type: 'like-hashtag', target: `#${tag}` });

    await page.goto(`https://www.instagram.com/explore/tags/${tag}/`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(randomDelay(3000, 5000));

    const posts = await page.locator('main a[href*="/p/"]').all();
    const total = Math.min(posts.length, maxLikes);

    for (let i = 0; i < total; i++) {
      if (cancelled) break;
      emit(profileId, 'progress', { type: 'like-hashtag', current: i + 1, total, target: `#${tag}` });

      try {
        await posts[i].click();
        await page.waitForTimeout(randomDelay(1500, 3000));

        const likeBtn = page.locator('section svg[aria-label="Like"], section svg[aria-label="Me gusta"]').first();
        if (await likeBtn.isVisible({ timeout: 2000 })) {
          await likeBtn.click();
          likesGiven++;
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(randomDelay(2000, 5000));
      } catch {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    emit(profileId, 'done', { type: 'like-hashtag', likesGiven, target: `#${tag}` });
  } catch (err) {
    emit(profileId, 'error', { type: 'like-hashtag', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { likesGiven };
}

// ─── Like en Feed ──────────────────────────────────────────────────

async function likeFeed(profileId, config) {
  const { maxLikes = 15 } = config;
  let cancelled = false;
  let likesGiven = 0;

  const task = { type: 'like-feed', running: true, cancel: () => { cancelled = true; } };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'like-feed' });

    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(randomDelay(3000, 5000));

    for (let i = 0; i < maxLikes; i++) {
      if (cancelled) break;
      emit(profileId, 'progress', { type: 'like-feed', current: i + 1, total: maxLikes });

      try {
        const likeBtn = page.locator('article section svg[aria-label="Like"], article section svg[aria-label="Me gusta"]').nth(i);
        if (await likeBtn.isVisible({ timeout: 3000 })) {
          await likeBtn.click();
          likesGiven++;
          await page.waitForTimeout(randomDelay(2000, 5000));
        }

        // Scroll to load more posts
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(randomDelay(1500, 3000));
      } catch {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(randomDelay(1000, 2000));
      }
    }

    emit(profileId, 'done', { type: 'like-feed', likesGiven });
  } catch (err) {
    emit(profileId, 'error', { type: 'like-feed', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { likesGiven };
}

// ─── Like en Explorar ──────────────────────────────────────────────

async function likeExplore(profileId, config) {
  const { maxLikes = 15 } = config;
  let cancelled = false;
  let likesGiven = 0;

  const task = { type: 'like-explore', running: true, cancel: () => { cancelled = true; } };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'like-explore' });

    await page.goto('https://www.instagram.com/explore/', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(randomDelay(3000, 5000));

    const posts = await page.locator('main a[href*="/p/"]').all();
    const total = Math.min(posts.length, maxLikes);

    for (let i = 0; i < total; i++) {
      if (cancelled) break;
      emit(profileId, 'progress', { type: 'like-explore', current: i + 1, total });

      try {
        await posts[i].click();
        await page.waitForTimeout(randomDelay(1500, 3000));

        const likeBtn = page.locator('section svg[aria-label="Like"], section svg[aria-label="Me gusta"]').first();
        if (await likeBtn.isVisible({ timeout: 2000 })) {
          await likeBtn.click();
          likesGiven++;
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(randomDelay(2000, 5000));
      } catch {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    emit(profileId, 'done', { type: 'like-explore', likesGiven });
  } catch (err) {
    emit(profileId, 'error', { type: 'like-explore', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { likesGiven };
}

// ─── Ver Reels ─────────────────────────────────────────────────────

async function watchReels(profileId, config) {
  const { maxReels = 20, likeReels = false } = config;
  let cancelled = false;
  let watched = 0;
  let liked = 0;

  const task = { type: 'watch-reels', running: true, cancel: () => { cancelled = true; } };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'watch-reels' });

    await page.goto('https://www.instagram.com/reels/', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(randomDelay(3000, 5000));

    // Click first reel if available
    const firstReel = page.locator('main a[href*="/reel/"]').first();
    try {
      await firstReel.click({ timeout: 5000 });
      await page.waitForTimeout(randomDelay(2000, 3000));
    } catch {
      // May already be in reel view
    }

    for (let i = 0; i < maxReels; i++) {
      if (cancelled) break;
      watched++;
      emit(profileId, 'progress', { type: 'watch-reels', current: watched, total: maxReels });

      // Watch reel for 4-10 seconds
      await page.waitForTimeout(randomDelay(4000, 10000));

      // Like if enabled
      if (likeReels) {
        try {
          const likeBtn = page.locator('svg[aria-label="Like"], svg[aria-label="Me gusta"]').first();
          if (await likeBtn.isVisible({ timeout: 1000 })) {
            await likeBtn.click();
            liked++;
          }
        } catch { /* already liked or not found */ }
        await page.waitForTimeout(randomDelay(500, 1500));
      }

      // Scroll down to next reel
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(randomDelay(1000, 2000));
    }

    emit(profileId, 'done', { type: 'watch-reels', watched, liked });
  } catch (err) {
    emit(profileId, 'error', { type: 'watch-reels', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { watched, liked };
}

// ─── Buscar y Seguir por Hashtag ───────────────────────────────────

async function followByHashtag(profileId, config) {
  const { hashtag, maxFollows = 10 } = config;
  let cancelled = false;
  let followed = 0;

  const task = { type: 'follow-hashtag', running: true, cancel: () => { cancelled = true; } };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');
    const tag = hashtag.replace(/^#/, '');

    emit(profileId, 'start', { type: 'follow-hashtag', target: `#${tag}` });

    await page.goto(`https://www.instagram.com/explore/tags/${tag}/`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(randomDelay(3000, 5000));

    const posts = await page.locator('main a[href*="/p/"]').all();
    const total = Math.min(posts.length, maxFollows);

    for (let i = 0; i < total; i++) {
      if (cancelled) break;
      emit(profileId, 'progress', { type: 'follow-hashtag', current: i + 1, total, target: `#${tag}` });

      try {
        await posts[i].click();
        await page.waitForTimeout(randomDelay(1500, 3000));

        // Find the follow button inside the post modal
        const followBtn = page.locator('header button:has-text("Follow"), header button:has-text("Seguir")').first();
        if (await followBtn.isVisible({ timeout: 2000 })) {
          await followBtn.click();
          followed++;
          await page.waitForTimeout(randomDelay(1000, 2000));
        }

        await page.keyboard.press('Escape');
        await page.waitForTimeout(randomDelay(3000, 7000));
      } catch {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    emit(profileId, 'done', { type: 'follow-hashtag', followed, target: `#${tag}` });
  } catch (err) {
    emit(profileId, 'error', { type: 'follow-hashtag', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { followed };
}

// ─── Enviar DM ─────────────────────────────────────────────────────

async function sendDM(profileId, config) {
  const { targetUsers = [], message = '' } = config;
  let cancelled = false;
  let sent = 0;

  const task = { type: 'send-dm', running: true, cancel: () => { cancelled = true; } };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');
    if (!message.trim()) throw new Error('El mensaje no puede estar vacio');

    emit(profileId, 'start', { type: 'send-dm', total: targetUsers.length });

    for (let i = 0; i < targetUsers.length; i++) {
      if (cancelled) break;
      const user = targetUsers[i].trim().replace(/^@/, '');
      if (!user) continue;

      emit(profileId, 'progress', { type: 'send-dm', current: i + 1, total: targetUsers.length, currentUser: user });

      try {
        // Go to the user profile
        await page.goto(`https://www.instagram.com/${user}/`, { waitUntil: 'load', timeout: 15000 });
        await page.waitForTimeout(randomDelay(2000, 4000));

        // Click "Message" button
        const msgBtn = page.locator('button:has-text("Message"), button:has-text("Enviar mensaje"), div[role="button"]:has-text("Message")').first();
        await msgBtn.click({ timeout: 5000 });
        await page.waitForTimeout(randomDelay(2000, 4000));

        // Type message in the DM input
        const dmInput = page.locator('textarea[placeholder*="Message"], textarea[placeholder*="Escribe un mensaje"], div[role="textbox"]').first();
        await dmInput.waitFor({ state: 'visible', timeout: 5000 });
        await dmInput.click();
        await page.waitForTimeout(300);
        await dmInput.fill(message);
        await page.waitForTimeout(randomDelay(500, 1000));

        // Send
        await dmInput.press('Enter');
        sent++;
        console.log(`[DM] Sent to @${user}`);

        await page.waitForTimeout(randomDelay(5000, 15000));
      } catch (err) {
        console.log(`[DM] Failed for @${user}: ${err.message}`);
      }
    }

    emit(profileId, 'done', { type: 'send-dm', sent });
  } catch (err) {
    emit(profileId, 'error', { type: 'send-dm', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { sent };
}

// ─── Subir Foto/Video ──────────────────────────────────────────────

async function uploadPost(profileId, config) {
  const { imagePath = '', caption = '' } = config;
  const task = { type: 'upload-post', running: true, cancel: () => {} };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'upload-post' });

    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(randomDelay(2000, 3000));

    // Click the create/new post button (+ icon)
    const createSelectors = [
      'svg[aria-label="New post"], svg[aria-label="Nueva publicación"]',
      'a[href="/create/style/"]',
      'div[role="menuitem"] svg[aria-label="New post"]',
      'span:has-text("Create"), span:has-text("Crear")',
    ];

    let createClicked = false;
    for (const sel of createSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          createClicked = true;
          break;
        }
      } catch { /* next */ }
    }

    if (!createClicked) {
      // Try sidebar create button
      const sidebarCreate = page.locator('[aria-label="New post"], [aria-label="Nueva publicación"]').first();
      await sidebarCreate.click({ timeout: 3000 });
    }

    await page.waitForTimeout(randomDelay(2000, 3000));

    // Upload file
    if (imagePath) {
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(imagePath);
      console.log(`[Upload] File selected: ${imagePath}`);
      await page.waitForTimeout(randomDelay(3000, 5000));

      // Click Next buttons
      for (let step = 0; step < 3; step++) {
        try {
          const nextBtn = page.locator('button:has-text("Next"), button:has-text("Siguiente"), div[role="button"]:has-text("Next")').first();
          if (await nextBtn.isVisible({ timeout: 3000 })) {
            await nextBtn.click();
            await page.waitForTimeout(randomDelay(1500, 2500));
          }
        } catch { break; }
      }

      // Write caption
      if (caption) {
        const captionInput = page.locator('textarea[aria-label*="caption"], textarea[aria-label*="pie de foto"], div[role="textbox"]').first();
        try {
          await captionInput.waitFor({ state: 'visible', timeout: 3000 });
          await captionInput.click();
          await captionInput.fill(caption);
          await page.waitForTimeout(randomDelay(500, 1000));
        } catch { /* caption field not found */ }
      }

      // Click Share/Compartir
      const shareBtn = page.locator('button:has-text("Share"), button:has-text("Compartir")').first();
      try {
        await shareBtn.click({ timeout: 3000 });
        await page.waitForTimeout(randomDelay(5000, 8000));
        console.log(`[Upload] Post shared successfully`);
      } catch { /* share button not found */ }
    }

    emit(profileId, 'done', { type: 'upload-post' });
  } catch (err) {
    emit(profileId, 'error', { type: 'upload-post', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { success: true };
}

// ─── Editar Bio/Nombre Masivo ──────────────────────────────────────

async function editProfile(profileId, config) {
  let { newName = '', newBio = '', newWebsite = '' } = config;
  // Nombre y bio pueden venir como LISTA (una por línea) → cada cuenta agarra una
  // distinta al azar, para que los perfiles no queden todos iguales.
  const pickLine = (txt) => {
    const arr = String(txt || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : '';
  };
  if (config.names) newName = pickLine(config.names);
  if (config.bios) newBio = pickLine(config.bios);
  const task = { type: 'edit-profile', running: true, cancel: () => {} };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'edit-profile' });

    await page.goto('https://www.instagram.com/accounts/edit/', { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(randomDelay(3000, 5000));

    // Cambiar foto de perfil (una foto distinta por cuenta, tomada al azar de la carpeta)
    if (config.photoFolder) {
      const img = pickRandomImage(config.photoFolder);
      if (img) {
        try {
          // Abrir el selector de foto (botón "Cambiar la foto del perfil")
          const changeBtn = page.locator(
            'button:has-text("Cambiar la foto"), button:has-text("Change profile photo"), button:has-text("Cambiar foto")'
          ).first();
          await changeBtn.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(1200);
          // Subir el archivo al input file (aparece tras click, o ya existe oculto)
          const fileInput = page.locator('input[type="file"]').first();
          await fileInput.setInputFiles(img, { timeout: 5000 });
          await page.waitForTimeout(randomDelay(3000, 5000));
          console.log(`[EditProfile] Foto de perfil cambiada: ${path.basename(img)}`);
        } catch (e) {
          console.log(`[EditProfile] No se pudo cambiar la foto: ${e.message}`);
        }
      }
    }

    // Edit name
    if (newName) {
      const nameInput = page.locator('input[name="fullName"], input[aria-label*="Name"], input[aria-label*="Nombre"]').first();
      try {
        await nameInput.waitFor({ state: 'visible', timeout: 3000 });
        await nameInput.click({ clickCount: 3 });
        await nameInput.fill(newName);
        console.log(`[EditProfile] Name set: ${newName}`);
      } catch { console.log(`[EditProfile] Name field not found`); }
    }

    // Edit bio
    if (newBio) {
      const bioInput = page.locator('textarea[name="biography"], textarea[aria-label*="Bio"], textarea[aria-label*="Presentación"]').first();
      try {
        await bioInput.waitFor({ state: 'visible', timeout: 3000 });
        await bioInput.click({ clickCount: 3 });
        await bioInput.fill(newBio);
        console.log(`[EditProfile] Bio set`);
      } catch { console.log(`[EditProfile] Bio field not found`); }
    }

    // Edit website
    if (newWebsite) {
      const webInput = page.locator('input[name="website"], input[aria-label*="Website"], input[aria-label*="Sitio web"]').first();
      try {
        await webInput.waitFor({ state: 'visible', timeout: 3000 });
        await webInput.click({ clickCount: 3 });
        await webInput.fill(newWebsite);
        console.log(`[EditProfile] Website set: ${newWebsite}`);
      } catch { console.log(`[EditProfile] Website field not found`); }
    }

    // Submit
    await page.waitForTimeout(500);
    const submitBtn = page.locator('button:has-text("Submit"), button:has-text("Enviar"), button[type="submit"]').first();
    try {
      await submitBtn.click({ timeout: 3000 });
      await page.waitForTimeout(randomDelay(3000, 5000));
      console.log(`[EditProfile] Profile updated`);
    } catch { /* no submit button */ }

    emit(profileId, 'done', { type: 'edit-profile' });
  } catch (err) {
    emit(profileId, 'error', { type: 'edit-profile', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { success: true };
}

// ─── Compartir Post ────────────────────────────────────────────────

async function sharePost(profileId, config) {
  const { postUrl = '', targetUsers = [] } = config;
  let shared = 0;
  let cancelled = false;
  const task = { type: 'share-post', running: true, cancel: () => { cancelled = true; } };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'share-post', total: targetUsers.length });

    // Go to the post
    await page.goto(postUrl, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Click share button (paper plane icon)
    const shareBtn = page.locator('svg[aria-label="Share Post"], svg[aria-label="Compartir publicación"], svg[aria-label="Direct"], button[aria-label*="Share"]').first();
    await shareBtn.click({ timeout: 3000 });
    await page.waitForTimeout(randomDelay(1500, 2500));

    // Send to each user
    for (let i = 0; i < targetUsers.length; i++) {
      if (cancelled) break;
      const user = targetUsers[i].trim().replace(/^@/, '');
      if (!user) continue;

      emit(profileId, 'progress', { type: 'share-post', current: i + 1, total: targetUsers.length, currentUser: user });

      try {
        // Search for user in share dialog
        const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Buscar"]').first();
        await searchInput.fill(user);
        await page.waitForTimeout(randomDelay(1500, 2500));

        // Click on the user result
        const userResult = page.locator(`div[role="dialog"] button:has-text("${user}"), div[role="dialog"] div:has-text("${user}")`).first();
        await userResult.click({ timeout: 3000 });
        shared++;
        await page.waitForTimeout(randomDelay(500, 1000));

        // Clear search for next user
        await searchInput.fill('');
        await page.waitForTimeout(500);
      } catch { /* user not found */ }
    }

    // Click Send
    try {
      const sendBtn = page.locator('button:has-text("Send"), button:has-text("Enviar")').first();
      await sendBtn.click({ timeout: 3000 });
      await page.waitForTimeout(randomDelay(2000, 4000));
    } catch { /* send button not found */ }

    emit(profileId, 'done', { type: 'share-post', shared });
  } catch (err) {
    emit(profileId, 'error', { type: 'share-post', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { shared };
}

// ─── Buff Likes/Comments en Post Propio ────────────────────────────
// This runs on MULTIPLE profiles to like/comment a specific post

async function buffPost(profileId, config) {
  const { postUrl = '', action = 'like', comment = '' } = config;
  const task = { type: 'buff-post', running: true, cancel: () => {} };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'buff-post', target: postUrl });

    await page.goto(postUrl, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(randomDelay(2000, 4000));

    if (action === 'like' || action === 'both') {
      const likeBtn = page.locator('section svg[aria-label="Like"], section svg[aria-label="Me gusta"]').first();
      if (await likeBtn.isVisible({ timeout: 2000 })) {
        await likeBtn.click();
        console.log(`[Buff] Liked post`);
        await page.waitForTimeout(randomDelay(500, 1500));
      }
    }

    if ((action === 'comment' || action === 'both') && comment) {
      const commentInput = page.locator('textarea[aria-label*="comment"], textarea[aria-label*="comentario"], textarea[placeholder*="comment"], textarea[placeholder*="comentario"]').first();
      try {
        await commentInput.click();
        await page.waitForTimeout(300);
        await commentInput.fill(comment);
        await page.waitForTimeout(randomDelay(500, 1000));

        const postBtn = page.locator('button:has-text("Post"), button:has-text("Publicar"), div[role="button"]:has-text("Post")').first();
        await postBtn.click();
        console.log(`[Buff] Commented on post`);
        await page.waitForTimeout(randomDelay(2000, 4000));
      } catch { console.log(`[Buff] Comment failed`); }
    }

    emit(profileId, 'done', { type: 'buff-post' });
  } catch (err) {
    emit(profileId, 'error', { type: 'buff-post', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { success: true };
}

// ─── Follow por Sugerencias ────────────────────────────────────────

async function followSuggestions(profileId, config) {
  const { maxFollows = 10 } = config;
  let cancelled = false;
  let followed = 0;

  const task = { type: 'follow-suggestions', running: true, cancel: () => { cancelled = true; } };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'follow-suggestions' });

    await page.goto('https://www.instagram.com/explore/people/', { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(randomDelay(3000, 5000));

    for (let i = 0; i < maxFollows; i++) {
      if (cancelled) break;

      emit(profileId, 'progress', { type: 'follow-suggestions', current: i + 1, total: maxFollows });

      try {
        const followBtns = page.locator('button:has-text("Follow"), button:has-text("Seguir")').filter({ hasNotText: /Following|Siguiendo|Requested/ });
        const count = await followBtns.count();

        if (count > 0) {
          await followBtns.first().click();
          followed++;
          await page.waitForTimeout(randomDelay(3000, 7000));
        } else {
          // Scroll to load more suggestions
          await page.evaluate(() => window.scrollBy(0, 500));
          await page.waitForTimeout(randomDelay(2000, 4000));
        }
      } catch {
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(randomDelay(2000, 3000));
      }
    }

    emit(profileId, 'done', { type: 'follow-suggestions', followed });
  } catch (err) {
    emit(profileId, 'error', { type: 'follow-suggestions', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { followed };
}

// ─── Buscar por Keyword y Follow ───────────────────────────────────

async function searchAndFollow(profileId, config) {
  const { keyword = '', maxFollows = 10 } = config;
  let cancelled = false;
  let followed = 0;

  const task = { type: 'search-follow', running: true, cancel: () => { cancelled = true; } };
  activeAutomations.set(profileId, task);

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    emit(profileId, 'start', { type: 'search-follow', target: keyword });

    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(randomDelay(2000, 3000));

    // Click search
    const searchIcon = page.locator('svg[aria-label="Search"], svg[aria-label="Buscar"], a[href="/explore/"]').first();
    await searchIcon.click({ timeout: 3000 });
    await page.waitForTimeout(randomDelay(1000, 2000));

    // Type keyword
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Buscar"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });
    await searchInput.fill(keyword);
    await page.waitForTimeout(randomDelay(2000, 3000));

    // Click on account results and follow them
    const results = await page.locator('a[href^="/"][role="link"]').all();
    const toVisit = Math.min(results.length, maxFollows);

    for (let i = 0; i < toVisit; i++) {
      if (cancelled) break;

      emit(profileId, 'progress', { type: 'search-follow', current: i + 1, total: toVisit, target: keyword });

      try {
        const href = await results[i].getAttribute('href').catch(() => '');
        if (!href || href.includes('/explore/') || href.includes('/p/')) continue;
        const username = href.replace(/\//g, '');

        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'load', timeout: 10000 });
        await page.waitForTimeout(randomDelay(1500, 3000));

        const followBtn = page.locator('header button:has-text("Follow"), header button:has-text("Seguir")').first();
        if (await followBtn.isVisible({ timeout: 2000 })) {
          await followBtn.click();
          followed++;
          console.log(`[Search&Follow] Followed @${username}`);
        }

        await page.waitForTimeout(randomDelay(3000, 7000));
      } catch { /* skip */ }
    }

    emit(profileId, 'done', { type: 'search-follow', followed, target: keyword });
  } catch (err) {
    emit(profileId, 'error', { type: 'search-follow', error: err.message });
  } finally {
    task.running = false;
    activeAutomations.delete(profileId);
  }
  return { followed };
}

// ─── Cancel & Status ───────────────────────────────────────────────

function cancelAutomation(profileId) {
  const task = activeAutomations.get(profileId);
  if (task && task.running) {
    task.cancel();
    return true;
  }
  return false;
}

function getAutomationStatus(profileId) {
  const task = activeAutomations.get(profileId);
  if (!task) return null;
  return { type: task.type, running: task.running };
}

function getAllAutomationStatus() {
  const result = {};
  for (const [id, task] of activeAutomations) {
    result[id] = { type: task.type, running: task.running };
  }
  return result;
}

module.exports = {
  autoLike,
  autoFollow,
  autoUnfollow,
  autoViewStories,
  autoVisitProfiles,
  autoComment,
  extractFollowers,
  likeByHashtag,
  likeFeed,
  likeExplore,
  watchReels,
  followByHashtag,
  sendDM,
  uploadPost,
  editProfile,
  sharePost,
  buffPost,
  followSuggestions,
  searchAndFollow,
  cancelAutomation,
  getAutomationStatus,
  getAllAutomationStatus,
  onAutomationEvent,
};
