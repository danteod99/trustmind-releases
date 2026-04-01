const { getActiveBrowsers } = require('./manager');

let scraperCallback = null;

function onScraperEvent(callback) {
  scraperCallback = callback;
}

function emit(profileId, event, data) {
  if (scraperCallback) scraperCallback(profileId, event, data);
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getPage(profileId) {
  const entry = getActiveBrowsers().get(profileId);
  if (!entry) throw new Error('Navegador no esta abierto');
  return entry.context.pages()[0] || null;
}

// Email regex — catches emails with special chars, subdomains, long TLDs
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9](?:[a-zA-Z0-9\-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9\-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,15}/g;

// Phone regex — catches international formats, parentheses, dots, dashes, spaces
const PHONE_REGEX = /(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,6}(?:[-.\s]?\d{1,4})?/g;

// Additional phone patterns for IG bios (people write phones creatively with emojis, labels, WhatsApp links)
const PHONE_EXTRAS = /(?:wa\.me\/|whatsapp[:\s]*|tel[:\s]*|call[:\s]*|phone[:\s]*|cel[:\s]*|celular[:\s]*|fono[:\s]*|movil[:\s]*|móvil[:\s]*|telefono[:\s]*|teléfono[:\s]*|número[:\s]*|numero[:\s]*|📞\s*|📱\s*|☎\s*|☎️\s*|📲\s*|🤙\s*)(\+?\d[\d\s\-().]{6,18})/gi;

// URL regex
const URL_REGEX = /https?:\/\/[^\s"'<>]+/g;

// System emails to filter out
const SYSTEM_EMAILS = [
  'support@instagram.com', 'noreply@instagram.com', 'security@instagram.com',
  'info@instagram.com', 'help@instagram.com', 'no-reply@instagram.com',
  'noreply@facebookmail.com', 'security@facebookmail.com',
  'notification@facebookmail.com', 'noreply@mail.instagram.com',
];

// False positive patterns for phone numbers (years, postal codes, IDs)
function isPhoneFalsePositive(phone) {
  const digits = phone.replace(/\D/g, '');
  // Too short or too long
  if (digits.length < 7 || digits.length > 15) return true;
  // Year-like numbers (2020-2030)
  if (/^20[12]\d$/.test(digits)) return true;
  // Common postal/zip codes that are just 5 digits starting with 0
  if (digits.length === 5 && digits.startsWith('0')) return true;
  // All same digit
  if (/^(\d)\1+$/.test(digits)) return true;
  // Sequential ascending/descending
  if (/^(?:012345|123456|234567|345678|456789|987654|876543|765432|654321|543210)/.test(digits)) return true;
  return false;
}

// Filter out false positive emails
function isEmailFalsePositive(email) {
  const lower = email.toLowerCase();
  if (SYSTEM_EMAILS.includes(lower)) return true;
  // Dummy/placeholder emails
  if (/^(test|example|email|correo|usuario|user|admin|info)@(example|test|mail)\./i.test(email)) return true;
  // Too short local part
  if (email.split('@')[0].length < 2) return true;
  return false;
}

// ─── Scrape Profile Data ───────────────────────────────────────────

async function scrapeProfiles(profileId, config) {
  const { usernames = [], scrapeEmails = true, scrapePhones = true, scrapeBios = true } = config;
  let cancelled = false;
  const results = [];

  const task = { type: 'scrape', running: true, cancel: () => { cancelled = true; } };

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');

    console.log(`[Scraper] Starting scrape of ${usernames.length} profiles...`);
    emit(profileId, 'start', { type: 'scrape', total: usernames.length });

    for (let i = 0; i < usernames.length; i++) {
      if (cancelled) break;
      const user = usernames[i].trim().replace(/^@/, '');
      if (!user) continue;

      console.log(`[Scraper] Scraping @${user} (${i + 1}/${usernames.length})...`);
      emit(profileId, 'progress', { type: 'scrape', current: i + 1, total: usernames.length, currentUser: user });

      let retries = 0;
      const MAX_RETRIES = 1;

      while (retries <= MAX_RETRIES) {
        try {
          await page.goto(`https://www.instagram.com/${user}/`, {
            waitUntil: 'load',
            timeout: 20000,
          });
          await page.waitForTimeout(randomDelay(2000, 4000));

          // Check if page actually loaded (not a 404 or error page)
          const pageTitle = await page.title().catch(() => '');
          const isError = await page.evaluate(() => {
            const body = document.body?.innerText || '';
            return body.includes("Sorry, this page isn't available") ||
                   body.includes('Lo sentimos, esta página no está disponible') ||
                   body.length < 100;
          }).catch(() => false);

          if (isError && retries < MAX_RETRIES) {
            retries++;
            console.log(`[Scraper] @${user}: page did not load correctly, retrying (${retries}/${MAX_RETRIES})...`);
            await page.waitForTimeout(randomDelay(3000, 5000));
            continue;
          }

          // ─── Bio extraction via page.evaluate (most reliable for React DOM) ───
          const bioData = await page.evaluate(() => {
            // Method 1: meta description (most reliable, always present)
            const metaDesc = document.querySelector('meta[property="og:description"]')?.content || '';

            // Method 2: Get all text from header section
            const header = document.querySelector('header');
            const headerText = header ? header.innerText : '';

            // Method 3: Bio text - look for spans with actual bio content (not stats)
            const spans = document.querySelectorAll('header span');
            let bioText = '';
            spans.forEach(s => {
              const text = s.innerText || '';
              if (text.length > 10 && !text.match(/^\d/) &&
                  !text.includes('followers') && !text.includes('following') &&
                  !text.includes('posts') && !text.includes('seguidores') &&
                  !text.includes('seguidos') && !text.includes('publicaciones')) {
                if (text.length > bioText.length) bioText = text;
              }
            });

            // Method 4: Try -webkit-line-clamp spans (IG uses these for bio)
            const clampSpans = document.querySelectorAll('span[style*="line-clamp"], span[style*="-webkit-line-clamp"]');
            clampSpans.forEach(s => {
              const text = s.innerText || '';
              if (text.length > bioText.length) bioText = text;
            });

            // Method 5: dir="auto" spans in header (common IG pattern)
            const autoSpans = document.querySelectorAll('header span[dir="auto"]');
            autoSpans.forEach(s => {
              const text = s.innerText || '';
              if (text.length > 15 && text.length > bioText.length &&
                  !text.match(/^\d/) && !text.includes('followers')) {
                bioText = text;
              }
            });

            return { metaDesc, headerText, bioText };
          }).catch(() => ({ metaDesc: '', headerText: '', bioText: '' }));

          // Combine all bio sources for searching
          let bioText = [bioData.bioText, bioData.headerText, bioData.metaDesc].filter(Boolean).join(' ');

          // ─── Full page text for deep search ───
          let fullPageText = '';
          try {
            fullPageText = await page.evaluate(() => document.body.innerText);
          } catch {}

          // ─── External link extraction via page.evaluate ───
          let externalLink = '';
          try {
            externalLink = await page.evaluate(() => {
              const header = document.querySelector('header');
              if (!header) return '';

              // Look for external links in header
              const links = header.querySelectorAll('a');
              for (const a of links) {
                const href = a.href || '';
                const text = a.innerText || '';
                // External redirect links
                if (href.includes('l.instagram.com/') || href.includes('linktr.ee') ||
                    href.includes('linkin.bio') || href.includes('beacons.ai') ||
                    href.includes('linkr.bio') || href.includes('bio.link') ||
                    href.includes('tap.bio') || href.includes('campsite.bio') ||
                    href.includes('lnk.to') || href.includes('hoo.be') ||
                    href.includes('bit.ly') || href.includes('snipfeed.co')) {
                  return text || href;
                }
                // Any link with rel="nofollow" or target="_blank" in header
                if (a.rel?.includes('nofollow') || (a.target === '_blank' && !href.includes('instagram.com'))) {
                  return text || href;
                }
              }

              // Also check outside header for link-in-bio sections
              const allLinks = document.querySelectorAll('a[href*="linktr.ee"], a[href*="beacons.ai"], a[href*="linkin.bio"], a[href*="bio.link"]');
              for (const a of allLinks) {
                return a.innerText || a.href || '';
              }

              return '';
            }).catch(() => '');
          } catch {}

          // ─── Business category extraction ───
          let businessCategory = '';
          try {
            businessCategory = await page.evaluate(() => {
              // IG business profiles show category under the name
              const header = document.querySelector('header');
              if (!header) return '';

              // Look for category text — usually a div/span with category info
              // It's often in a div right after the name, with muted/gray text
              const allDivs = header.querySelectorAll('div');
              for (const div of allDivs) {
                const text = (div.innerText || '').trim();
                // Category is usually short text, not containing @, numbers, or "follow"
                if (text.length > 3 && text.length < 60 &&
                    !text.includes('@') && !text.includes('follow') &&
                    !text.includes('seguid') && !text.includes('publicaci') &&
                    !text.includes('posts') && !text.match(/^\d/) &&
                    div.children.length === 0) {
                  // Check if this looks like a category (has specific styling or position)
                  const style = window.getComputedStyle(div);
                  const color = style.color;
                  // Categories are usually in muted/secondary color
                  if (color && color !== 'rgb(0, 0, 0)' && color !== 'rgb(255, 255, 255)') {
                    return text;
                  }
                }
              }

              // Alternative: look for the category link pattern IG uses
              const categoryLinks = header.querySelectorAll('a[href*="/directory/"]');
              for (const a of categoryLinks) {
                const text = (a.innerText || '').trim();
                if (text.length > 2) return text;
              }

              // Alternative: look in meta description — format: "X Followers, Y Following, Z Posts - See Instagram photos and videos from Name (@user)"
              // Sometimes includes category
              const metaDesc = document.querySelector('meta[property="og:description"]')?.content || '';
              const catMatch = metaDesc.match(/^(.+?)\.\s*[\d,]+\s*(?:Followers|seguidores)/i);
              if (catMatch && catMatch[1].length < 50) return catMatch[1];

              return '';
            }).catch(() => '');
          } catch {}

          // ─── Email extraction via page.evaluate (mailto links, buttons) ───
          let mailtoEmails = [];
          try {
            mailtoEmails = await page.evaluate(() => {
              const emails = [];
              // Get all mailto: links on the page
              const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
              mailtoLinks.forEach(a => {
                const email = a.href.replace('mailto:', '').split('?')[0].trim();
                if (email && email.includes('@')) emails.push(email);
              });
              return emails;
            }).catch(() => []);
          } catch {}

          // Try clicking Email/Contact business buttons to reveal email
          let buttonEmails = [];
          try {
            const emailBtnVisible = await page.evaluate(() => {
              const buttons = document.querySelectorAll('header button, header div[role="button"], header a');
              for (const btn of buttons) {
                const text = (btn.innerText || '').trim().toLowerCase();
                if (text === 'email' || text === 'correo' || text === 'correo electrónico' || text === 'e-mail') {
                  return true;
                }
              }
              return false;
            }).catch(() => false);

            if (emailBtnVisible) {
              // Try to find and click email button
              for (const label of ['Email', 'Correo', 'Correo electrónico', 'E-mail']) {
                try {
                  const btn = page.locator(`header button:has-text("${label}"), header div[role="button"]:has-text("${label}"), header a:has-text("${label}")`).first();
                  if (await btn.isVisible({ timeout: 800 })) {
                    const href = await btn.getAttribute('href').catch(() => '');
                    if (href && href.startsWith('mailto:')) {
                      const email = href.replace('mailto:', '').split('?')[0].trim();
                      if (email) buttonEmails.push(email);
                      console.log(`[Scraper] @${user}: email from mailto button: ${email}`);
                    }
                    break;
                  }
                } catch {}
              }
            }
          } catch {}

          // ─── Phone extraction from tel: links via page.evaluate ───
          let telPhones = [];
          try {
            telPhones = await page.evaluate(() => {
              const phones = [];
              const telLinks = document.querySelectorAll('a[href^="tel:"]');
              telLinks.forEach(a => {
                const num = a.href.replace('tel:', '').trim();
                if (num.replace(/\D/g, '').length >= 7) phones.push(num);
              });
              // Also check wa.me links
              const waLinks = document.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp.com/send"], a[href*="api.whatsapp"]');
              waLinks.forEach(a => {
                const href = a.href || '';
                const match = href.match(/(?:wa\.me\/|phone=)(\+?\d{7,15})/);
                if (match) phones.push(match[1]);
              });
              return phones;
            }).catch(() => []);
          } catch {}

          // ─── Get follower/following counts via page.evaluate ───
          let followerCount = '';
          let followingCount = '';
          try {
            const stats = await page.evaluate(() => {
              const header = document.querySelector('header');
              if (!header) return { followers: '', following: '' };

              // Try to find stats section — look for the list or section with numbers
              const lists = header.querySelectorAll('ul li, section > div > div');
              let numbers = [];
              lists.forEach(li => {
                const text = li.innerText || '';
                const numMatch = text.match(/([\d,.]+[KkMm]?)/);
                if (numMatch) numbers.push(numMatch[1]);
              });

              // Also try from the meta description
              if (numbers.length < 2) {
                const metaDesc = document.querySelector('meta[property="og:description"]')?.content || '';
                const metaNums = metaDesc.match(/([\d,.]+[KkMm]?)\s*(?:Followers|seguidores)/i);
                const metaFollowing = metaDesc.match(/([\d,.]+[KkMm]?)\s*(?:Following|seguidos)/i);
                if (metaNums) numbers[0] = metaNums[1];
                if (metaFollowing) numbers[1] = metaFollowing[1];
              }

              return {
                followers: numbers[1] || numbers[0] || '',
                following: numbers[2] || numbers[1] || '',
              };
            }).catch(() => ({ followers: '', following: '' }));
            followerCount = stats.followers;
            followingCount = stats.following;
          } catch {}

          const profileData = {
            username: user,
            bio: (bioData.bioText || bioData.headerText || '').trim(),
            externalLink: externalLink.trim(),
            businessCategory: businessCategory.trim(),
            followerCount,
            followingCount,
            emails: [],
            phones: [],
          };

          // ─── Collect all emails ───
          if (scrapeEmails) {
            const allEmails = [];

            // From bio text
            const bioEmails = bioText.match(EMAIL_REGEX) || [];
            allEmails.push(...bioEmails);

            // From full page text
            const pageEmails = fullPageText.match(EMAIL_REGEX) || [];
            allEmails.push(...pageEmails);

            // From external link text
            if (externalLink) {
              const linkEmails = externalLink.match(EMAIL_REGEX) || [];
              allEmails.push(...linkEmails);
            }

            // From mailto links
            allEmails.push(...mailtoEmails);

            // From business buttons
            allEmails.push(...buttonEmails);

            // Deduplicate and filter false positives
            profileData.emails = [...new Set(
              allEmails.map(e => e.trim().toLowerCase()).filter(e => !isEmailFalsePositive(e))
            )];
          }

          // ─── Collect all phones ───
          if (scrapePhones) {
            const allPhones = [];

            // From bio text
            const bioPhones = bioText.match(PHONE_REGEX) || [];
            allPhones.push(...bioPhones);

            // From full page text
            const pagePhones = fullPageText.match(PHONE_REGEX) || [];
            allPhones.push(...pagePhones);

            // From tel: and wa.me links
            allPhones.push(...telPhones);

            // Extra patterns: emojis, labels, WhatsApp prefixes
            const combinedText = bioText + ' ' + fullPageText + ' ' + externalLink;
            PHONE_EXTRAS.lastIndex = 0; // Reset regex state
            let extraMatch;
            while ((extraMatch = PHONE_EXTRAS.exec(combinedText)) !== null) {
              const num = extraMatch[1].replace(/\s/g, '');
              allPhones.push(num);
            }

            // ─── Business Contact buttons (Call, WhatsApp, Contact) ───

            // Call button
            const callSelectors = [
              'a[href^="tel:"]',
              'button:has-text("Call")',
              'button:has-text("Llamar")',
              'a:has-text("Call")',
              'a:has-text("Llamar")',
              'div[role="button"]:has-text("Call")',
              'div[role="button"]:has-text("Llamar")',
            ];

            for (const sel of callSelectors) {
              try {
                const btn = page.locator(sel).first();
                if (await btn.isVisible({ timeout: 1000 })) {
                  const href = await btn.getAttribute('href').catch(() => '');
                  if (href && href.startsWith('tel:')) {
                    const num = href.replace('tel:', '').replace(/\s/g, '');
                    if (num.replace(/\D/g, '').length >= 7) {
                      allPhones.push(num);
                      console.log(`[Scraper] @${user}: phone from Call button: ${num}`);
                    }
                  } else {
                    // Click button to reveal phone in popup
                    await btn.click();
                    await page.waitForTimeout(1500);

                    // Extract phone from popup via page.evaluate
                    const popupData = await page.evaluate(() => {
                      const dialog = document.querySelector('div[role="dialog"], div[role="presentation"]');
                      if (!dialog) return { text: '', telNums: [] };
                      const text = dialog.innerText || '';
                      const telLinks = dialog.querySelectorAll('a[href^="tel:"]');
                      const telNums = [];
                      telLinks.forEach(a => {
                        const num = a.href.replace('tel:', '').trim();
                        if (num.replace(/\D/g, '').length >= 7) telNums.push(num);
                      });
                      return { text, telNums };
                    }).catch(() => ({ text: '', telNums: [] }));

                    const popupPhones = popupData.text.match(PHONE_REGEX) || [];
                    allPhones.push(...popupPhones);
                    allPhones.push(...popupData.telNums);

                    // Close popup
                    await page.keyboard.press('Escape').catch(() => {});
                    await page.waitForTimeout(500);
                  }
                  break;
                }
              } catch { /* try next selector */ }
            }

            // WhatsApp button
            const waSelectors = [
              'a[href*="wa.me"]',
              'a[href*="whatsapp.com"]',
              'a[href*="api.whatsapp"]',
              'button:has-text("WhatsApp")',
              'div[role="button"]:has-text("WhatsApp")',
            ];

            for (const sel of waSelectors) {
              try {
                const waBtn = page.locator(sel).first();
                if (await waBtn.isVisible({ timeout: 1000 })) {
                  const waHref = await waBtn.getAttribute('href').catch(() => '');
                  if (waHref) {
                    const waMatch = waHref.match(/(?:wa\.me\/|phone=)(\+?\d{7,15})/);
                    if (waMatch) {
                      allPhones.push(waMatch[1]);
                      console.log(`[Scraper] @${user}: phone from WhatsApp: ${waMatch[1]}`);
                    }
                  }
                  break;
                }
              } catch { /* try next */ }
            }

            // Contact button — sometimes reveals phone too
            const contactSelectors = [
              'button:has-text("Contact")',
              'button:has-text("Contacto")',
              'button:has-text("Contactar")',
              'a:has-text("Contact")',
              'div[role="button"]:has-text("Contact")',
              'div[role="button"]:has-text("Contacto")',
            ];

            for (const sel of contactSelectors) {
              try {
                const cBtn = page.locator(sel).first();
                if (await cBtn.isVisible({ timeout: 1000 })) {
                  await cBtn.click();
                  await page.waitForTimeout(1500);

                  // Extract from contact popup via page.evaluate
                  const contactData = await page.evaluate(() => {
                    const dialog = document.querySelector('div[role="dialog"]');
                    if (!dialog) return { text: '', emails: [], telNums: [] };
                    const text = dialog.innerText || '';

                    const emails = [];
                    const mailtoLinks = dialog.querySelectorAll('a[href^="mailto:"]');
                    mailtoLinks.forEach(a => {
                      const email = a.href.replace('mailto:', '').split('?')[0].trim();
                      if (email) emails.push(email);
                    });

                    const telNums = [];
                    const telLinks = dialog.querySelectorAll('a[href^="tel:"]');
                    telLinks.forEach(a => {
                      const num = a.href.replace('tel:', '').trim();
                      if (num.replace(/\D/g, '').length >= 7) telNums.push(num);
                    });

                    return { text, emails, telNums };
                  }).catch(() => ({ text: '', emails: [], telNums: [] }));

                  const contactPhones = contactData.text.match(PHONE_REGEX) || [];
                  allPhones.push(...contactPhones);
                  allPhones.push(...contactData.telNums);

                  // Also get emails from contact popup
                  if (scrapeEmails) {
                    const contactTextEmails = contactData.text.match(EMAIL_REGEX) || [];
                    profileData.emails.push(...contactTextEmails.filter(e => !isEmailFalsePositive(e.toLowerCase())));
                    profileData.emails.push(...contactData.emails.filter(e => !isEmailFalsePositive(e.toLowerCase())));
                    profileData.emails = [...new Set(profileData.emails)];
                  }

                  await page.keyboard.press('Escape').catch(() => {});
                  await page.waitForTimeout(500);
                  break;
                }
              } catch { /* try next */ }
            }

            // Deduplicate and filter false positives
            const cleanPhones = allPhones
              .map(p => (p || '').trim())
              .filter(p => p && !isPhoneFalsePositive(p));
            profileData.phones = [...new Set(cleanPhones)];
          }

          results.push(profileData);
          console.log(`[Scraper] @${user}: ${profileData.emails.length} emails, ${profileData.phones.length} phones${profileData.businessCategory ? ', category: ' + profileData.businessCategory : ''}`);

          // Success — break out of retry loop
          break;

        } catch (err) {
          if (retries < MAX_RETRIES) {
            retries++;
            console.log(`[Scraper] Error scraping @${user}, retrying (${retries}/${MAX_RETRIES}): ${err.message}`);
            await page.waitForTimeout(randomDelay(3000, 5000));
            continue;
          }
          console.log(`[Scraper] Error scraping @${user} (no more retries): ${err.message}`);
          results.push({ username: user, error: err.message });
          break;
        }
      } // end retry while

      await page.waitForTimeout(randomDelay(2000, 5000));
    }

    console.log(`[Scraper] Done! Scraped ${results.length} profiles`);
    const totalEmails = results.reduce((sum, r) => sum + (r.emails?.length || 0), 0);
    const totalPhones = results.reduce((sum, r) => sum + (r.phones?.length || 0), 0);
    console.log(`[Scraper] Total: ${totalEmails} emails, ${totalPhones} phones`);
    emit(profileId, 'done', { type: 'scrape', count: results.length, emails: totalEmails, phones: totalPhones });
  } catch (err) {
    console.log(`[Scraper] Fatal error: ${err.message}`);
    emit(profileId, 'error', { type: 'scrape', error: err.message });
  }

  return { results };
}

// ─── Scrape Hashtag Posts ──────────────────────────────────────────

async function scrapeHashtagEmails(profileId, config) {
  const { hashtag, maxProfiles = 20 } = config;
  let cancelled = false;
  const results = [];

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');
    const tag = hashtag.replace(/^#/, '');

    emit(profileId, 'start', { type: 'scrape-hashtag', target: `#${tag}` });

    await page.goto(`https://www.instagram.com/explore/tags/${tag}/`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(randomDelay(3000, 5000));

    // Get post links to find profile owners
    const postLinks = await page.locator('main a[href*="/p/"]').all();
    const postsToCheck = Math.min(postLinks.length, maxProfiles);
    const visitedUsers = new Set();

    for (let i = 0; i < postsToCheck; i++) {
      if (cancelled) break;

      try {
        await postLinks[i].click();
        await page.waitForTimeout(randomDelay(1500, 3000));

        // Get the post author
        const authorLink = page.locator('article header a[href^="/"]').first();
        const authorHref = await authorLink.getAttribute('href').catch(() => '');
        const author = authorHref.replace(/\//g, '');

        if (author && !visitedUsers.has(author)) {
          visitedUsers.add(author);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);

          // Visit the author profile
          await page.goto(`https://www.instagram.com/${author}/`, { waitUntil: 'load', timeout: 15000 });
          await page.waitForTimeout(randomDelay(2000, 3000));

          const bioText = await page.locator('header').textContent({ timeout: 3000 }).catch(() => '');
          const emails = bioText.match(EMAIL_REGEX) || [];
          const phones = bioText.match(PHONE_REGEX) || [];

          if (emails.length > 0 || phones.length > 0) {
            results.push({
              username: author,
              emails: [...new Set(emails)],
              phones: [...new Set(phones.filter(p => p.replace(/\D/g, '').length >= 7))],
              source: `#${tag}`,
            });
          }

          emit(profileId, 'progress', {
            type: 'scrape-hashtag',
            current: visitedUsers.size,
            total: postsToCheck,
            found: results.length,
          });

          // Go back to hashtag page
          await page.goto(`https://www.instagram.com/explore/tags/${tag}/`, { waitUntil: 'load', timeout: 15000 });
          await page.waitForTimeout(randomDelay(2000, 4000));
        } else {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        }
      } catch {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    emit(profileId, 'done', { type: 'scrape-hashtag', count: results.length, target: `#${tag}` });
  } catch (err) {
    emit(profileId, 'error', { type: 'scrape-hashtag', error: err.message });
  }

  return { results };
}

// ─── Scrape Followers of a Profile ─────────────────────────────────

async function scrapeFollowersData(profileId, config) {
  const { targetUser, maxFollowers = 100, scrapeEmails = true, scrapePhones = true, fastMode = false } = config;
  let cancelled = false;
  const followers = [];
  const results = [];

  try {
    const page = getPage(profileId);
    if (!page) throw new Error('No hay pagina abierta');
    const target = targetUser.replace(/^@/, '');

    console.log(`[Scraper] Starting follower scrape of @${target} (max ${maxFollowers})...`);
    emit(profileId, 'start', { type: 'scrape-followers', target, total: maxFollowers });

    // Step 1: Go to target profile and open followers list
    await page.goto(`https://www.instagram.com/${target}/`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(randomDelay(3000, 5000));

    // Click on followers count
    const followersLink = page.locator(`a[href="/${target}/followers/"]`);
    await followersLink.click();
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Wait for dialog
    await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
    await page.waitForTimeout(randomDelay(1500, 2500));

    const dialog = page.locator('div[role="dialog"]');

    // Step 2: Extract follower usernames by scrolling
    let previousCount = 0;
    let stuckCount = 0;

    console.log(`[Scraper] Extracting follower usernames...`);

    while (followers.length < maxFollowers && !cancelled) {
      const items = await dialog.locator('a[role="link"][href^="/"]').all();

      for (const item of items) {
        if (followers.length >= maxFollowers || cancelled) break;
        try {
          const href = await item.getAttribute('href');
          if (!href || href === `/${target}/`) continue;
          const username = href.replace(/\//g, '');
          if (!username || username.includes('/') || followers.includes(username)) continue;
          followers.push(username);
        } catch { /* skip */ }
      }

      if (followers.length === previousCount) {
        stuckCount++;
        if (stuckCount > 5) break;
      } else {
        stuckCount = 0;
        previousCount = followers.length;
      }

      // Scroll
      try {
        const scrollable = dialog.locator('div[style*="overflow"]').first();
        await scrollable.evaluate((el) => el.scrollBy(0, 600));
      } catch {
        await dialog.evaluate((el) => {
          const s = el.querySelector('[style*="overflow"]') || el;
          s.scrollBy(0, 600);
        });
      }
      await page.waitForTimeout(randomDelay(1500, 3000));

      if (followers.length % 20 === 0) {
        console.log(`[Scraper] Extracted ${followers.length} follower usernames...`);
        emit(profileId, 'progress', {
          type: 'scrape-followers',
          phase: 'extracting',
          current: followers.length,
          total: maxFollowers,
          target,
        });
      }
    }

    // Close dialog
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1000);

    console.log(`[Scraper] Got ${followers.length} followers.`);

    // Fast mode: save usernames directly to DB without visiting profiles
    if (fastMode) {
      console.log(`[Scraper] FAST MODE — saving ${followers.length} usernames directly (no profile visits)`);
      const { getDb } = require('../db/database');
      const db = getDb();
      const stmt = db.prepare('INSERT OR IGNORE INTO scraped_data (target_user, data_type, value, scraped_by) VALUES (?, ?, ?, ?)');
      let saved = 0;
      for (const user of followers) {
        try {
          stmt.run(target, 'username', user, profileId);
          saved++;
        } catch { /* duplicate */ }
      }
      console.log(`[Scraper] FAST MODE DONE! Saved ${saved} usernames from @${target}`);
      emit(profileId, 'done', {
        type: 'scrape-followers',
        target,
        followersScraped: followers.length,
        withData: saved,
        mode: 'fast',
      });
      return { followers: followers.length, results: followers.map(u => ({ username: u })) };
    }

    console.log(`[Scraper] Now scraping their profiles for emails/phones...`);

    // Step 3: Visit each follower and scrape their data
    for (let i = 0; i < followers.length; i++) {
      if (cancelled) break;
      const user = followers[i];

      emit(profileId, 'progress', {
        type: 'scrape-followers',
        phase: 'scraping',
        current: i + 1,
        total: followers.length,
        currentUser: user,
        target,
        found: results.length,
      });

      try {
        await page.goto(`https://www.instagram.com/${user}/`, {
          waitUntil: 'load', timeout: 12000,
        });
        await page.waitForTimeout(randomDelay(1500, 3000));

        // Get bio/header text
        const bioText = await page.locator('header').textContent({ timeout: 3000 }).catch(() => '');

        // Get external link
        let externalLink = '';
        try {
          const linkEl = page.locator('header a[href*="l.instagram.com"], header a[rel*="nofollow"]').first();
          if (await linkEl.isVisible({ timeout: 800 })) {
            externalLink = await linkEl.textContent() || await linkEl.getAttribute('href') || '';
          }
        } catch { /* no link */ }

        const allText = bioText + ' ' + externalLink;

        const profileData = {
          username: user,
          source: `@${target}`,
          emails: [],
          phones: [],
          bio: '',
        };

        // Emails
        if (scrapeEmails) {
          const emails = allText.match(EMAIL_REGEX) || [];
          profileData.emails = [...new Set(emails)];
        }

        // Phones from bio
        if (scrapePhones) {
          const phones = allText.match(PHONE_REGEX) || [];

          // Also check Call/WhatsApp buttons
          try {
            const telLink = page.locator('a[href^="tel:"]').first();
            if (await telLink.isVisible({ timeout: 800 })) {
              const href = await telLink.getAttribute('href').catch(() => '');
              if (href) phones.push(href.replace('tel:', ''));
            }
          } catch { /* no tel */ }

          try {
            const waLink = page.locator('a[href*="wa.me"], a[href*="whatsapp"]').first();
            if (await waLink.isVisible({ timeout: 800 })) {
              const href = await waLink.getAttribute('href').catch(() => '');
              const match = (href || '').match(/(?:wa\.me\/|phone=)(\+?\d{7,15})/);
              if (match) phones.push(match[1]);
            }
          } catch { /* no wa */ }

          profileData.phones = [...new Set(phones.filter(p => p.replace(/\D/g, '').length >= 7))];
        }

        // Only add if we found something
        if (profileData.emails.length > 0 || profileData.phones.length > 0) {
          results.push(profileData);
        }

        if ((i + 1) % 10 === 0) {
          console.log(`[Scraper] Progress: ${i + 1}/${followers.length} scraped, ${results.length} with data`);
        }

      } catch {
        // Skip failed profiles
      }

      await page.waitForTimeout(randomDelay(1500, 4000));
    }

    const totalEmails = results.reduce((sum, r) => sum + r.emails.length, 0);
    const totalPhones = results.reduce((sum, r) => sum + r.phones.length, 0);
    console.log(`[Scraper] DONE! ${followers.length} followers scraped, found ${totalEmails} emails, ${totalPhones} phones`);

    emit(profileId, 'done', {
      type: 'scrape-followers',
      target,
      followersScraped: followers.length,
      withData: results.length,
      emails: totalEmails,
      phones: totalPhones,
    });
  } catch (err) {
    console.log(`[Scraper] Fatal error: ${err.message}`);
    emit(profileId, 'error', { type: 'scrape-followers', error: err.message });
  }

  return { followers: followers.length, results };
}

module.exports = { scrapeProfiles, scrapeHashtagEmails, scrapeFollowersData, onScraperEvent };
