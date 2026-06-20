/* ============================================================================
 * XtraClean — background service worker
 *
 * Pure scheduler. It owns no data and talks to no server. Its only jobs:
 *   1. Keep a daily alarm so Auto-Clean rules get a chance to run.
 *   2. When the alarm fires, nudge an open x.com tab to run the rule (the actual
 *      deletion happens in the content script, inside your real session).
 *   3. Show a desktop notification when a job finishes (nice touch, optional).
 *
 * All deletion logic lives in the content script so it runs with your real
 * cookies — the background never touches your account directly.
 * ========================================================================== */

const SETTINGS_KEY = 'xtraclean_settings_v1';
const ALARM = 'xtraclean-autoclean';

chrome.runtime.onInstalled.addListener(() => {
  // fire ~every 6h; the content script decides if a rule is actually "due"
  chrome.alarms.create(ALARM, { periodInMinutes: 360, delayInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 360, delayInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== ALARM) return;
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const s = data[SETTINGS_KEY];
  if (!s || !s.autoClean || !s.autoClean.enabled) return;
  await nudgeOpenTab();
});

// Find an open x.com/twitter.com tab and ask its content script to run.
async function nudgeOpenTab() {
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
  if (!tabs.length) {
    // No tab open — leave a breadcrumb; content script runs next time you open X.
    chrome.storage.local.set({ xtraclean_autoclean_pending: true });
    return;
  }
  for (const t of tabs) {
    try { await chrome.tabs.sendMessage(t.id, { type: 'XC_AUTOCLEAN_RUN', source: 'alarm' }); break; }
    catch (e) { /* tab not ready; try next */ }
  }
}

// Content script reports results → surface a desktop notification.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'XC_NOTIFY') {
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: msg.title || 'XtraClean',
        message: msg.message || '',
        priority: 1,
      });
    } catch (e) {}
  }
});
