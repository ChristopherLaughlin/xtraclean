/* ============================================================================
 * XtraClean — Bulk delete your X / Twitter activity, privately.
 *
 * Everything in this file runs inside YOUR browser, in YOUR logged-in x.com
 * session. No data is ever sent to any third-party server. Deletions use X's
 * own internal GraphQL endpoints with your own session — exactly what the X
 * web app does when you click "Delete" yourself, just automated and in bulk.
 * ========================================================================== */
(() => {
  'use strict';
  if (window.__xtracleanLoaded) return;
  window.__xtracleanLoaded = true;
  const VERSION = '1.6.0';
  console.log('%c[XtraClean] v' + VERSION + ' content script loaded on ' + location.host, 'color:#2dd4bf');

  // --- X web app constants ---------------------------------------------------
  // The public web bearer token shipped in X's own JS bundle (not a secret).
  let BEARER =
    'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  // Fallback query IDs. X rotates these, so at runtime we DISCOVER the current
  // ones from X's own JS bundle (see discoverQueryIds) and only fall back to
  // these if discovery fails.
  const QUERY = {
    DeleteTweet: 'VaenaVgh5q5ih7kvyVjgtg',
    UnfavoriteTweet: 'ZYKSe-w7KEslx3JhSIk5LA',
    DeleteRetweet: 'iQtK4dl5hBmXewYZuEOKVw',
    BookmarksAllDelete: 'Wlmlj2-xzyS1GN3a6cj-mQ',
  };

  // Self-healing adapter: a tiny config hosted on our GitHub Pages. If X rotates
  // endpoints or the bearer, we push a fix there and every user is healed within
  // hours — no reinstall, no store review. Precedence: remote > live bundle > fallback.
  const ADAPTER_URL = 'https://christopherlaughlin.github.io/xtraclean/adapter.json';
  let remoteQueries = null; // {DeleteTweet,...} from the hosted config, if any
  async function ensureAdapter() {
    if (remoteQueries) return;
    let cfg = null;
    try {
      const d = await chrome.storage.local.get('xtraclean_adapter');
      const c = d.xtraclean_adapter;
      if (c && Date.now() - c.at < 6 * 3600 * 1000) cfg = c.cfg; // 6h cache
    } catch (e) {}
    if (!cfg) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch(ADAPTER_URL, { credentials: 'omit', signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) { cfg = await r.json(); try { chrome.storage.local.set({ xtraclean_adapter: { at: Date.now(), cfg } }); } catch (e) {} }
      } catch (e) {}
    }
    remoteQueries = (cfg && cfg.queries) || {};
    if (cfg && cfg.bearer) BEARER = /^Bearer /.test(cfg.bearer) ? cfg.bearer : 'Bearer ' + cfg.bearer;
  }
  let resolvedQueries = null; // populated by discoverQueryIds()
  // precedence: live bundle (reads X's CURRENT code) > hosted adapter (our
  // maintained safety net) > frozen fallback. discoverQueryIds records what it
  // actually found live in resolvedQueries._discovered.
  function activeQuery(op) {
    const disc = resolvedQueries && resolvedQueries._discovered;
    if (disc && disc[op]) return disc[op];
    if (remoteQueries && remoteQueries[op]) return remoteQueries[op];
    return QUERY[op];
  }

  function extractQueryId(txt, op) {
    // X bundles list operations as {queryId:"X",operationName:"DeleteTweet",...}
    // — order varies, so try both directions within a small window.
    let m =
      txt.match(new RegExp('queryId:"([a-zA-Z0-9_-]{8,})"[^}]{0,80}?operationName:"' + op + '"')) ||
      txt.match(new RegExp('operationName:"' + op + '"[^}]{0,200}?queryId:"([a-zA-Z0-9_-]{8,})"')) ||
      txt.match(new RegExp('"' + op + '"[^}]{0,200}?queryId:"([a-zA-Z0-9_-]{8,})"'));
    return m ? m[1] : null;
  }

  async function discoverQueryIds(force = false) {
    if (resolvedQueries && !force) return resolvedQueries;
    const found = {};
    try {
      const srcs = [...document.querySelectorAll('script[src]')]
        .map((s) => s.src)
        .filter((u) => /(abs\.twimg\.com|twimg\.com).+\.js(\?|$)/.test(u));
      // Bundles most likely to hold the operation→queryId map come first.
      const rank = (u) => (/api[._]/.test(u) ? 3 : 0) + (/main[._]/.test(u) ? 2 : 0) + (/(client-web|responsive-web)/.test(u) ? 1 : 0);
      srcs.sort((a, b) => rank(b) - rank(a));
      let tried = 0;
      const deadline = Date.now() + 12000; // never block a run more than ~12s
      for (const url of srcs) {
        if (found.DeleteTweet && found.UnfavoriteTweet && found.DeleteRetweet) break;
        if (tried++ >= 16 || Date.now() > deadline) break;
        let txt;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 4000); // per-bundle timeout
          const resp = await fetch(url, { credentials: 'omit', signal: ctrl.signal });
          txt = await resp.text();
          clearTimeout(t);
        } catch (e) { continue; }
        for (const op of ['DeleteTweet', 'UnfavoriteTweet', 'DeleteRetweet', 'BookmarksAllDelete']) {
          if (!found[op]) { const id = extractQueryId(txt, op); if (id) found[op] = id; }
        }
      }
    } catch (e) {}
    resolvedQueries = {
      DeleteTweet: found.DeleteTweet || QUERY.DeleteTweet,
      UnfavoriteTweet: found.UnfavoriteTweet || QUERY.UnfavoriteTweet,
      DeleteRetweet: found.DeleteRetweet || QUERY.DeleteRetweet,
      BookmarksAllDelete: found.BookmarksAllDelete || QUERY.BookmarksAllDelete,
    };
    resolvedQueries._discovered = found;
    return resolvedQueries;
  }

  const STORAGE_KEY = 'xtraclean_state_v2'; // v2: drops pre-ownership-filter queues
  const SETTINGS_KEY = 'xtraclean_settings_v1';

  // --- tiny helpers ----------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => (n == null ? '0' : n.toLocaleString());
  const nowSec = () => Math.floor(Date.now() / 1000);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // X requires an x-client-transaction-id header; for these mutation endpoints
  // a well-formed random value is accepted (mirrors known-good open-source tools).
  function transactionId() {
    const bytes = new Uint8Array(70);
    crypto.getRandomValues(bytes);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/[+/=]/g, (c) => ({ '+': 'A', '/': 'B', '=': '' }[c])).slice(0, 95);
  }

  function detectHandle() {
    // Try the logged-in account from the cookie-bearing DOM, fall back to URL.
    const acct = $('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (acct) {
      const m = acct.textContent.match(/@(\w{1,15})/);
      if (m) return m[1];
    }
    const m = location.pathname.match(/^\/(\w{1,15})(?:\/|$)/);
    if (m && !['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings'].includes(m[1]))
      return m[1];
    return null;
  }

  // ===========================================================================
  // DELETION ENGINE
  // ===========================================================================
  function authHeaders(ct0, json = true) {
    const h = {
      authorization: BEARER,
      'x-csrf-token': ct0,
      'x-client-transaction-id': transactionId(),
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en',
    };
    if (json) h['content-type'] = 'application/json';
    return h;
  }

  function selfUserId() {
    // The "twid" cookie holds your own numeric user id as  u=1234567890
    const twid = getCookie('twid');
    if (!twid) return null;
    const m = twid.match(/(\d{3,})/);
    return m ? m[1] : null;
  }

  const Engine = {
    async call(op, variables) {
      const ct0 = getCookie('ct0');
      if (!ct0) throw new Error('NO_AUTH');
      const qid = activeQuery(op);
      return fetch(`https://${location.host}/i/api/graphql/${qid}/${op}`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(ct0),
        body: JSON.stringify({ variables, queryId: qid }),
      });
    },
    deleteTweet(id) {
      return this.call('DeleteTweet', { tweet_id: id, dark_request: false });
    },
    unlike(id) {
      return this.call('UnfavoriteTweet', { tweet_id: id });
    },
    unretweet(sourceId) {
      // Undo a repost — needs the ORIGINAL (source) tweet id, not your repost id.
      return this.call('DeleteRetweet', { source_tweet_id: sourceId, dark_request: false });
    },
  };

  // Interpret a GraphQL mutation response. X returns HTTP 200 even on failure
  // (with an `errors` array), so we MUST inspect the body — never trust the
  // status code alone. Returns: {state, msg, retry}
  //   state: 'ok' | 'gone' | 'rate' | 'auth' | 'fail' | 'neterr'
  async function interpret(res, op) {
    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON (e.g. 404 route) */ }

    if (res.status === 429) return { state: 'rate', retry: rateReset(res) };
    if (res.status === 401 || res.status === 403) return { state: 'auth', msg: 'HTTP ' + res.status };
    if (res.status === 404 && !body) return { state: 'fail', msg: 'Endpoint 404 — query ID for ' + op + ' is stale' };

    const errs = body && body.errors;
    if (Array.isArray(errs) && errs.length) {
      const msg = errs.map((e) => e.message || ('code ' + e.code)).join('; ');
      if (errs.some((e) => e.code === 88) || /rate limit/i.test(msg)) return { state: 'rate', retry: nowSec() + 900 };
      if (errs.some((e) => e.code === 32 || e.code === 89 || e.code === 215) || /authenticate|token|bad guest|transaction/i.test(msg))
        return { state: 'auth', msg };
      if (errs.some((e) => e.code === 183) || /another user'?s status|not delete another user/i.test(msg)) return { state: 'notmine', msg };
      if (/not found|no status found|does not exist|already|not authorized to/i.test(msg)) return { state: 'gone', msg };
      return { state: 'fail', msg };
    }

    if (res.ok && body && body.data) {
      const d = body.data;
      if (op === 'DeleteTweet' && !d.delete_tweet) return { state: 'fail', msg: 'No delete_tweet in response' };
      if (op === 'DeleteRetweet' && !d.unretweet) return { state: 'fail', msg: 'No unretweet in response' };
      if (op === 'UnfavoriteTweet' && d.unfavorite_tweet == null) return { state: 'fail', msg: 'No unfavorite_tweet in response' };
      return { state: 'ok' };
    }
    if (res.ok) return { state: 'fail', msg: 'Empty/HTML response (not logged in or wrong endpoint)' };
    return { state: 'fail', msg: 'HTTP ' + res.status };
  }

  function rateReset(res) {
    const reset = parseInt(res.headers.get('x-rate-limit-reset') || '0', 10);
    const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
    return reset > nowSec() ? reset : nowSec() + (retryAfter || 900);
  }

  async function deleteOne(item) {
    let op, p;
    if (item.kind === 'like') { op = 'UnfavoriteTweet'; p = Engine.unlike(item.id); }
    else if (item.action === 'unretweet') { op = 'DeleteRetweet'; p = Engine.unretweet(item.id); }
    else { op = 'DeleteTweet'; p = Engine.deleteTweet(item.id); }
    try {
      return await interpret(await p, op);
    } catch (e) {
      if (e.message === 'NO_AUTH') return { state: 'auth', msg: 'not logged in (no ct0 cookie)' };
      return { state: 'neterr', msg: e.message };
    }
  }

  // ===========================================================================
  // DIRECT MESSAGES ENGINE  (stable v1.1 endpoints)
  // ===========================================================================
  const DM = {
    async get(path) {
      const ct0 = getCookie('ct0');
      if (!ct0) throw new Error('NO_AUTH');
      const res = await fetch(`https://${location.host}${path}`, {
        credentials: 'include',
        headers: authHeaders(ct0),
      });
      if (!res.ok) throw new Error('DM_HTTP_' + res.status);
      return res.json();
    },
    async deleteConversation(id) {
      const ct0 = getCookie('ct0');
      return fetch(`https://${location.host}/i/api/1.1/dm/conversation/${id}/delete.json`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...authHeaders(ct0, false), 'content-type': 'application/x-www-form-urlencoded' },
        body: '',
      });
    },
  };

  function collectConvs(state, map, users) {
    if (!state) return;
    Object.assign(users, state.users || {});
    const convs = state.conversations || {};
    for (const id of Object.keys(convs)) {
      if (!map.has(id)) map.set(id, convs[id]);
    }
  }

  function convLabel(conv, users) {
    if (conv.name) return conv.name + (conv.type === 'GROUP_DM' ? ' (group)' : '');
    const me = selfUserId();
    const others = (conv.participants || [])
      .map((p) => users[p.user_id])
      .filter((u) => u && u.id_str !== me);
    if (others.length) return '@' + (others[0].screen_name || others[0].name || others[0].id_str);
    return 'Conversation ' + conv.conversation_id;
  }

  async function dmScanAll(onProgress) {
    State.abort = false;
    const map = new Map();
    const users = {};
    let j = await DM.get('/i/api/1.1/dm/inbox_initial_state.json?include_groups=true&filter_low_quality=false&include_quality=all');
    const initState = j.inbox_initial_state || {};
    collectConvs(initState, map, users);
    onProgress?.(map.size);
    let tl = initState.inbox_timelines?.trusted;
    let cursor = tl?.min_entry_id;
    let status = tl?.status;
    let guard = 0;
    while (cursor && status === 'HAS_MORE' && !State.abort && guard < 200) {
      guard++;
      let t = await DM.get(`/i/api/1.1/dm/inbox_timeline/trusted.json?max_id=${cursor}&include_groups=true`);
      const it = t.inbox_timeline || {};
      collectConvs(it, map, users);
      cursor = it.min_entry_id;
      status = it.status;
      onProgress?.(map.size);
      await sleep(450);
    }
    State._dmUsers = users;
    return [...map.values()].map((c) => ({
      id: c.conversation_id,
      label: convLabel(c, users),
      type: c.type,
      time: c.sort_timestamp ? new Date(parseInt(c.sort_timestamp, 10)).toISOString() : null,
    }));
  }

  // ===========================================================================
  // FOOTPRINT ENGINE — the rest of your trail: bookmarks (GraphQL one-shot),
  // mutes & blocks (stable v1.1 list + destroy).
  // ===========================================================================
  const FP = {
    async getJSON(path) {
      const ct0 = getCookie('ct0');
      if (!ct0) throw new Error('NO_AUTH');
      const r = await fetch(`https://${location.host}${path}`, { credentials: 'include', headers: authHeaders(ct0) });
      if (!r.ok) throw new Error('HTTP_' + r.status);
      return r.json();
    },
    post(path) {
      const ct0 = getCookie('ct0');
      return fetch(`https://${location.host}${path}`, {
        method: 'POST', credentials: 'include',
        headers: { ...authHeaders(ct0, false), 'content-type': 'application/x-www-form-urlencoded' }, body: '',
      });
    },
    async listIds(kind) { // kind: 'mutes/users' | 'blocks'
      let cursor = '-1'; const ids = []; let guard = 0;
      while (cursor && cursor !== '0' && guard < 200 && !State.abort) {
        guard++;
        const j = await this.getJSON(`/i/api/1.1/${kind}/ids.json?stringify_ids=true&count=5000&cursor=${cursor}`);
        (j.ids || []).forEach((x) => ids.push(String(x)));
        cursor = j.next_cursor_str || '0';
      }
      return ids;
    },
    bookmarksAllDelete() {
      const ct0 = getCookie('ct0');
      const qid = activeQuery('BookmarksAllDelete');
      return fetch(`https://${location.host}/i/api/graphql/${qid}/BookmarksAllDelete`, {
        method: 'POST', credentials: 'include', headers: authHeaders(ct0),
        body: JSON.stringify({ variables: {}, queryId: qid }),
      });
    },
  };

  async function wipeUsers(kind, label) {
    if (!getCookie('ct0')) { toast('Log in to X in this tab first.', 'err'); return; }
    if (!confirm(`Remove ALL ${label}? This can't be undone.`)) return;
    State.abort = false;
    toast(`Finding ${label}…`);
    let ids;
    try { ids = await FP.listIds(kind); } catch (e) { toast(`Couldn't list ${label} (${e.message}).`, 'err'); return; }
    if (!ids.length) { toast(`No ${label} found.`, 'ok'); return; }
    const ep = kind === 'mutes/users' ? 'mutes/users/destroy' : 'blocks/destroy';
    let done = 0;
    for (const id of ids) {
      if (State.abort) break;
      try {
        const r = await FP.post(`/i/api/1.1/${ep}.json?user_id=${id}`);
        if (r.ok || r.status === 404) done++;
        else if (r.status === 429) { toast('Rate limited — pausing 60s…', 'warn'); await sleep(60000); continue; }
      } catch (e) {}
      if (done % 5 === 0) { toast(`${label}: ${fmt(done)}/${fmt(ids.length)}`); renderFootprint(); }
      await sleep(450);
    }
    State.footprint[label] = (State.footprint[label] || 0) + done;
    toast(`Removed ${fmt(done)} ${label}.`, 'ok');
    if (done) confetti();
    renderFootprint();
  }

  async function clearBookmarks() {
    if (!getCookie('ct0')) { toast('Log in to X in this tab first.', 'err'); return; }
    if (!confirm('Delete ALL your bookmarks? This cannot be undone.')) return;
    toast('Clearing bookmarks…');
    await ensureAdapter(); await discoverQueryIds();
    try {
      const r = await FP.bookmarksAllDelete();
      let body = null; try { body = await r.json(); } catch (e) {}
      if (r.ok && body && body.data && !(body.errors && body.errors.length)) {
        State.footprint.bookmarks = 'all cleared';
        toast('All bookmarks cleared. 🎉', 'ok'); confetti();
      } else {
        const msg = body && body.errors && body.errors.length ? body.errors[0].message : 'HTTP ' + r.status;
        toast('Bookmark wipe failed: ' + msg, 'err');
      }
    } catch (e) { toast('Bookmark wipe error: ' + e.message, 'err'); }
    renderFootprint();
  }

  function downloadWipeReport() {
    const f = State.footprint || {};
    const lines = [
      'XtraClean — wipe report',
      'Account: @' + (State.handle || 'you'),
      'Generated: ' + new Date().toLocaleString(),
      '',
      'Removed via XtraClean (this session):',
      '· Posts / replies / reposts / likes deleted: ' + fmt(State.progress.done || 0),
    ];
    if (f.bookmarks) lines.push('· Bookmarks: ' + f.bookmarks);
    if (f.mutes) lines.push('· Unmuted accounts: ' + fmt(f.mutes));
    if (f.blocks) lines.push('· Unblocked accounts: ' + fmt(f.blocks));
    lines.push('', 'All actions ran locally in your own browser session. No data left your device.');
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `xtraclean-wipe-report-${State.handle || 'x'}-${Date.now()}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Wipe report saved.', 'ok');
  }

  // ===========================================================================
  // STATE
  // ===========================================================================
  const State = {
    handle: null,
    source: 'live', // 'live' | 'archive'
    items: [], // scanned/imported pool: {id,kind,type,text,time,likes,retweets,replies,media,pinned}
    queue: [], // filtered ids queued for deletion (subset of items by id)
    status: 'idle', // idle|scanning|running|paused|done
    progress: { done: 0, failed: 0, total: 0, startedAt: 0 },
    pauseUntil: 0, // epoch sec, when rate-limited
    log: [],
    abort: false,
  };

  const Settings = {
    delayMs: 900, // base delay between deletions
    dateFrom: '',
    dateTo: '',
    keyword: '',
    useRegex: false,
    types: { post: true, reply: true, repost: true, quote: true },
    deleteLikes: true,
    deleteTweets: true,
    keepAboveLikes: '', // protect popular posts: keep if likes >= N
    mediaFilter: 'all', // all | only | none
    protectIds: '', // comma separated ids to never delete
    protectPinned: true,
    maxScroll: 0, // 0 = unlimited
    onboarded: false,
    autoClean: {
      enabled: false,
      maxAgeDays: 30, // delete anything older than this
      posts: true,
      replies: true,
      reposts: true,
      likes: false,
      keepAboveLikes: '', // protect popular posts in auto mode too
      keyword: '',
      everyHours: 24, // minimum gap between auto runs
    },
    lastAutoRun: 0, // epoch sec
  };

  async function loadPersisted() {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY]);
      if (data[SETTINGS_KEY]) Object.assign(Settings, data[SETTINGS_KEY]);
      if (data[STORAGE_KEY]) {
        const s = data[STORAGE_KEY];
        if (s.queue?.length && (s.status === 'running' || s.status === 'paused')) {
          State.items = s.items || [];
          State.queue = s.queue || [];
          State.progress = s.progress || State.progress;
          State.status = 'paused'; // resume manually
          State.handle = s.handle;
          return true; // had a resumable job
        }
      }
    } catch (e) {}
    return false;
  }

  function persist() {
    try {
      chrome.storage.local.set({
        [STORAGE_KEY]: {
          handle: State.handle,
          items: State.items,
          queue: State.queue,
          progress: State.progress,
          status: State.status,
        },
        [SETTINGS_KEY]: Settings,
      });
    } catch (e) {}
  }

  function saveSettingsOnly() {
    try { chrome.storage.local.set({ [SETTINGS_KEY]: Settings }); } catch (e) {}
  }

  function clearPersisted() {
    try { chrome.storage.local.remove(STORAGE_KEY); } catch (e) {}
  }

  function logLine(msg, kind = 'info') {
    const t = new Date().toLocaleTimeString();
    State.log.unshift({ t, msg, kind });
    if (State.log.length > 400) State.log.pop();
    renderLog();
  }

  // ===========================================================================
  // LIVE DOM SCANNER  (no archive needed — works on your current profile tab)
  // ===========================================================================
  function parseCount(s) {
    if (!s) return 0;
    s = s.replace(/,/g, '').trim().toUpperCase();
    const m = s.match(/([\d.]+)\s*([KM]?)/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (m[2] === 'K') n *= 1e3;
    if (m[2] === 'M') n *= 1e6;
    return Math.round(n);
  }

  function scrapeArticle(article, kind) {
    // canonical status id + timestamp come from the <time>'s anchor
    const timeEl = article.querySelector('time[datetime]');
    let id = null,
      time = timeEl?.getAttribute('datetime') || null;
    const link =
      timeEl?.closest('a[href*="/status/"]') ||
      article.querySelector('a[href*="/status/"]');
    let author = null;
    if (link) {
      // href is /<authorHandle>/status/<id> — gives us BOTH the id and the author
      const m = link.getAttribute('href').match(/^\/([^/]+)\/status\/(\d+)/);
      if (m) { author = m[1]; id = m[2]; }
    }
    if (!id) return null;

    const textEl = article.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.textContent : '';
    const social = article.querySelector('[data-testid="socialContext"]')?.textContent || '';
    const isRepost = /repost|retweet/i.test(social);
    const isReply = /Replying to/i.test(article.textContent.slice(0, 400));
    const hasQuote = article.querySelectorAll('[data-testid="tweetText"]').length > 1 ||
      !!article.querySelector('div[role="link"] time');
    const media =
      !!article.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], video, [data-testid="card.layoutLarge.media"]');
    const pinned = /Pinned/i.test(social);

    // engagement from the action group aria-label e.g. "3 replies, 5 reposts, 12 likes"
    let likes = 0, retweets = 0, replies = 0;
    const group = article.querySelector('[role="group"][aria-label]');
    if (group) {
      const al = group.getAttribute('aria-label');
      const lk = al.match(/([\d,.]+[KM]?)\s+likes?/i);
      const rt = al.match(/([\d,.]+[KM]?)\s+reposts?/i);
      const rp = al.match(/([\d,.]+[KM]?)\s+repl(?:y|ies)/i);
      if (lk) likes = parseCount(lk[1]);
      if (rt) retweets = parseCount(rt[1]);
      if (rp) replies = parseCount(rp[1]);
    }

    let type = 'post';
    if (isRepost) type = 'repost';
    else if (hasQuote) type = 'quote';
    else if (isReply) type = 'reply';

    // action: reposts need un-repost (with the source id); everything else is a delete
    const action = isRepost ? 'unretweet' : 'delete';
    return { id, kind, type, text, time, likes, retweets, replies, media, pinned, author, action };
  }

  async function liveScan() {
    State.status = 'scanning';
    State.abort = false;
    const onLikes = /\/likes\/?$/.test(location.pathname);
    const kind = onLikes ? 'like' : 'tweet';
    // Guard: scanning anything other than YOUR OWN profile/likes will collect
    // tweets you can't delete — X will reject them. Warn loudly.
    if (!isOwnProfilePage()) {
      logLine('You’re not on your own profile/Likes page — scanning here collects posts you can’t delete. Open x.com/<you> first.', 'warn');
      toast('Open your own Profile or Likes page before scanning.', 'warn');
    }
    logLine(`Scanning ${onLikes ? 'Likes' : 'profile'} timeline…`);
    const me = (State.handle || detectHandle() || '').toLowerCase();
    const seen = new Map(State.items.map((i) => [i.id, i]));
    let stagnant = 0,
      iterations = 0,
      skipped = 0;
    const maxStagnant = 6;

    while (!State.abort) {
      const articles = document.querySelectorAll('article[data-testid="tweet"], article[role="article"]');
      let added = 0;
      for (const a of articles) {
        const item = scrapeArticle(a, kind);
        if (!item || seen.has(item.id)) continue;
        // Ownership filter: on the profile, only keep things you can actually act on.
        // - reposts (you can un-repost, even though the author shown is someone else)
        // - tweets/replies authored by YOU
        // Skip context tweets (the parent you replied to, others' quoted tweets, etc.).
        if (kind === 'tweet' && me) {
          const mine = item.author && item.author.toLowerCase() === me;
          if (item.action !== 'unretweet' && !mine) { skipped++; continue; }
        }
        seen.set(item.id, item);
        added++;
      }
      State.items = [...seen.values()];
      renderPool();
      if (added === 0) stagnant++;
      else stagnant = 0;
      if (stagnant >= maxStagnant) break;
      if (Settings.maxScroll && State.items.length >= Settings.maxScroll) break;
      window.scrollBy(0, window.innerHeight * 0.9);
      iterations++;
      await sleep(750);
      // nudge: sometimes X needs a tiny scroll-up to trigger loading
      if (iterations % 8 === 0) { window.scrollBy(0, -40); await sleep(200); }
    }
    window.scrollTo(0, 0);
    State.status = 'idle';
    logLine(`Scan complete — found ${fmt(State.items.length)} of yours${skipped ? ` (skipped ${fmt(skipped)} you can’t delete)` : ''}.`, 'ok');
    renderPool();
    applyFilters();
  }

  // ===========================================================================
  // ARCHIVE PARSER  (tweets.js / like.js from your official X data export)
  // ===========================================================================
  function parseArchiveFile(filename, text) {
    // Files look like:  window.YTD.tweets.part0 = [ ... ]
    const eq = text.indexOf('=');
    const json = eq >= 0 ? text.slice(eq + 1) : text;
    let data;
    try {
      data = JSON.parse(json);
    } catch (e) {
      throw new Error(`Couldn't parse ${filename}: ${e.message}`);
    }
    const out = [];
    const isLike = /like/i.test(filename);
    for (const row of data) {
      if (isLike) {
        const l = row.like || row;
        const id = l.tweetId || l.tweet_id;
        if (id) out.push({ id: String(id), kind: 'like', type: 'post', text: l.fullText || '', time: null, likes: 0, retweets: 0, replies: 0, media: false, pinned: false });
      } else {
        const t = row.tweet || row;
        const id = t.id_str || t.id || t.tweet_id;
        if (!id) continue;
        const text = t.full_text || t.text || '';
        const time = t.created_at ? new Date(t.created_at).toISOString() : null;
        const isReply = !!(t.in_reply_to_status_id_str || t.in_reply_to_user_id_str);
        const isRepost = /^RT @/.test(text);
        const isQuote = !!(t.is_quote_status);
        const media = !!(t.entities?.media || t.extended_entities?.media);
        out.push({
          id: String(id), kind: 'tweet',
          type: isRepost ? 'repost' : isQuote ? 'quote' : isReply ? 'reply' : 'post',
          text, time,
          likes: parseInt(t.favorite_count || 0, 10),
          retweets: parseInt(t.retweet_count || 0, 10),
          replies: 0, media, pinned: false,
          // archive doesn't carry the source-tweet id for reposts, so we can only
          // attempt a normal delete; live-scan handles un-reposting properly.
          action: 'delete',
        });
      }
    }
    return out;
  }

  async function importArchiveFiles(fileList) {
    State.source = 'archive';
    const seen = new Map(State.items.map((i) => [i.id, i]));
    let total = 0;
    // Expand any .zip into its relevant .js entries; pass .js straight through.
    const entries = [];
    for (const file of fileList) {
      const name = file.name.toLowerCase();
      if (name.endsWith('.zip')) {
        logLine(`Reading ${file.name}…`);
        try {
          const got = await extractArchiveZip(file);
          if (!got.length) logLine('No tweets/likes files found inside the .zip.', 'warn');
          entries.push(...got);
        } catch (e) {
          logLine(`Couldn't read ${file.name}: ${e.message}`, 'err');
        }
      } else {
        entries.push({ name, text: await file.text() });
      }
    }
    for (const { name, text } of entries) {
      try {
        const parsed = parseArchiveFile(name, text);
        for (const it of parsed) if (!seen.has(it.id)) { seen.set(it.id, it); total++; }
        logLine(`Imported ${fmt(parsed.length)} from ${name}`, 'ok');
      } catch (e) {
        logLine(e.message, 'err');
      }
    }
    State.items = [...seen.values()];
    logLine(`Archive pool: ${fmt(State.items.length)} item(s).`, 'ok');
    renderPool();
    applyFilters();
    return total;
  }

  // Dependency-free ZIP reader: pulls the tweets*/like .js entries out of the
  // raw X data-archive .zip and inflates them. No unzip step needed.
  async function extractArchiveZip(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer);
    const want = /(^|\/)(tweets?|like)(-part\d+)?\.js$/i;
    // locate End Of Central Directory (0x06054b50), scanning from the end
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a valid .zip');
    let cd = dv.getUint32(eocd + 16, true);
    const out = [];
    const td = new TextDecoder('utf-8');
    while (cd < buf.length && dv.getUint32(cd, true) === 0x02014b50) {
      const method = dv.getUint16(cd + 10, true);
      const compSize = dv.getUint32(cd + 20, true);
      const fnLen = dv.getUint16(cd + 28, true);
      const extraLen = dv.getUint16(cd + 30, true);
      const cmtLen = dv.getUint16(cd + 32, true);
      const lho = dv.getUint32(cd + 42, true);
      const name = td.decode(buf.subarray(cd + 46, cd + 46 + fnLen));
      if (want.test(name)) {
        // local header tells us the true data offset (its own fn/extra lengths)
        const lfn = dv.getUint16(lho + 26, true);
        const lex = dv.getUint16(lho + 28, true);
        const start = lho + 30 + lfn + lex;
        const comp = buf.subarray(start, start + compSize);
        const raw = method === 0 ? comp : await inflateRaw(comp);
        out.push({ name: name.toLowerCase(), text: td.decode(raw) });
      }
      cd += 46 + fnLen + extraLen + cmtLen;
    }
    return out;
  }

  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ===========================================================================
  // FILTERS  →  build the deletion queue
  // ===========================================================================
  function buildMatcher(cfg = Settings) {
    const from = cfg.dateFrom ? new Date(cfg.dateFrom + 'T00:00:00') : null;
    const to = cfg.dateTo ? new Date(cfg.dateTo + 'T23:59:59') : null;
    const keepAbove = cfg.keepAboveLikes !== '' && cfg.keepAboveLikes != null ? parseInt(cfg.keepAboveLikes, 10) : null;
    const protect = new Set(
      (cfg.protectIds || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    );
    let kw = null;
    if ((cfg.keyword || '').trim()) {
      kw = cfg.useRegex
        ? safeRegex(cfg.keyword)
        : { test: (s) => s.toLowerCase().includes(cfg.keyword.toLowerCase()) };
    }

    return (it) => {
      if (protect.has(it.id)) return false;
      if (it.pinned && cfg.protectPinned) return false;
      // kind gates
      if (it.kind === 'like' && !cfg.deleteLikes) return false;
      if (it.kind === 'tweet' && !cfg.deleteTweets) return false;
      // type gates (only for tweets)
      if (it.kind === 'tweet' && cfg.types && !cfg.types[it.type]) return false;
      // date
      if (it.time) {
        const d = new Date(it.time);
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      // protect popular
      if (keepAbove != null && it.likes >= keepAbove) return false;
      // media
      if (cfg.mediaFilter === 'only' && !it.media) return false;
      if (cfg.mediaFilter === 'none' && it.media) return false;
      // keyword
      if (kw && !kw.test(it.text || '')) return false;
      return true;
    };
  }

  function safeRegex(src) {
    try { return new RegExp(src, 'i'); } catch (e) { logLine('Invalid regex — ignoring.', 'warn'); return { test: () => true }; }
  }

  function applyFilters() {
    const match = buildMatcher();
    const matched = State.items.filter(match);
    State.queue = matched.map((i) => i.id);
    State._matchedItems = matched;
    renderPreview(matched);
    return matched;
  }

  // ===========================================================================
  // BACKUP  (download everything matched before you nuke it — solves "no undo")
  // ===========================================================================
  function downloadBackup() {
    const items = State._matchedItems || State.items;
    if (!items.length) { logLine('Nothing to back up — run a scan/import and apply filters first.', 'warn'); return; }
    const payload = {
      app: 'XtraClean',
      exportedAt: new Date().toISOString(),
      handle: State.handle,
      count: items.length,
      items: items.map((i) => ({
        id: i.id, kind: i.kind, type: i.type, date: i.time,
        text: i.text, likes: i.likes, retweets: i.retweets,
        url: State.handle ? `https://x.com/${State.handle}/status/${i.id}` : `https://x.com/i/status/${i.id}`,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xtraclean-backup-${State.handle || 'x'}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    logLine(`Backed up ${fmt(items.length)} item(s) to your downloads.`, 'ok');
  }

  // ===========================================================================
  // LOCAL ARCHIVE — "own it, then erase it." Export a self-contained, searchable
  // HTML copy of your history before deleting it from X. Opens offline forever.
  // ===========================================================================
  const ARCHIVE_CSS = `
    :root{color-scheme:dark}
    *{box-sizing:border-box;margin:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0e15;color:#e6edf3;line-height:1.5}
    header{padding:28px 24px 14px;max-width:820px;margin:0 auto}
    header h1{font-size:26px}header p{color:#8b95a5;font-size:13px;margin-top:4px}
    .bar{position:sticky;top:0;background:#0a0e15;border-bottom:1px solid #232a36;padding:12px 24px;display:flex;gap:10px;flex-wrap:wrap;max-width:820px;margin:0 auto}
    .bar input,.bar select{background:#0d1117;border:1px solid #2a3240;color:#e6edf3;border-radius:9px;padding:9px 11px;font-size:13px}
    .bar input{flex:1;min-width:180px}
    #wrap{max-width:820px;margin:0 auto;padding:16px 24px 60px}
    #count{color:#8b95a5;font-size:12px;margin:6px 2px 12px}
    .card{background:#0d1117;border:1px solid #232a36;border-radius:12px;padding:13px 15px;margin-bottom:10px}
    .card .m{display:flex;gap:10px;align-items:center;font-size:11px;color:#8b95a5;margin-bottom:6px}
    .card .tag{background:#1b2230;border-radius:10px;padding:2px 8px;color:#cdd6e0;text-transform:capitalize}
    .card .lk{color:#7ee3c7}.card a{margin-left:auto;color:#2dd4bf;text-decoration:none}
    .card .tx{white-space:pre-wrap;word-wrap:break-word;font-size:14px}
    .more{color:#8b95a5;text-align:center;padding:14px;font-size:12px}
  `;
  // No template literals inside — this function is embedded verbatim via .toString().
  function ARCHIVE_VIEWER() {
    var data = JSON.parse(document.getElementById('data').textContent);
    var list = document.getElementById('list'), q = document.getElementById('q'), sort = document.getElementById('sort'), ft = document.getElementById('ftype');
    document.getElementById('meta').textContent = data.length + ' items · exported ' + new Date().toLocaleString();
    function esc(s){ return (s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
    function render(){
      var term=q.value.toLowerCase(), tf=ft.value;
      var rows=data.filter(function(d){ return (!term||(d.text||'').toLowerCase().indexOf(term)>=0) && (tf==='all'||(tf==='like'?d.kind==='like':d.type===tf)); });
      rows.sort(function(a,b){ return sort.value==='likes'?(b.likes-a.likes):sort.value==='old'?(new Date(a.date)-new Date(b.date)):(new Date(b.date)-new Date(a.date)); });
      document.getElementById('count').textContent=rows.length+' shown';
      list.innerHTML=rows.slice(0,5000).map(function(d){
        var dt=d.date?new Date(d.date).toLocaleDateString():'';
        var tag=d.kind==='like'?'♥ like':d.type;
        return '<div class="card"><div class="m"><span class="tag">'+tag+'</span><span class="dt">'+dt+'</span>'+(d.likes?'<span class="lk">♥ '+d.likes+'</span>':'')+'<a href="'+d.url+'" target="_blank" rel="noopener">open ↗</a></div><div class="tx">'+esc(d.text||'(no text)')+'</div></div>';
      }).join('')+(rows.length>5000?'<p class="more">Showing first 5000 of '+rows.length+'</p>':'');
    }
    q.addEventListener('input',render); sort.addEventListener('change',render); ft.addEventListener('change',render); render();
  }
  function buildArchiveHTML(handle, data) {
    const json = JSON.stringify(data).replace(/</g, '\\u003c');
    const h = escapeHtml('@' + handle);
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + h + ' — XtraClean archive</title><style>' + ARCHIVE_CSS + '</style></head><body>' +
      '<header><h1>' + h + '</h1><p id="meta"></p></header>' +
      '<div class="bar"><input id="q" placeholder="Search your history…">' +
      '<select id="sort"><option value="new">Newest</option><option value="old">Oldest</option><option value="likes">Most liked</option></select>' +
      '<select id="ftype"><option value="all">All</option><option value="post">Posts</option><option value="reply">Replies</option><option value="repost">Reposts</option><option value="quote">Quotes</option><option value="like">Likes</option></select>' +
      '</div><div id="wrap"><div id="count"></div><div id="list"></div></div>' +
      '<script id="data" type="application/json">' + json + '<\/script>' +
      '<script>(' + ARCHIVE_VIEWER.toString() + ')()<\/script></body></html>';
  }
  function downloadArchiveHTML() {
    const items = State.items.length ? State.items : (State._matchedItems || []);
    if (!items.length) { toast('Nothing to archive yet — scan or import first.', 'warn'); return; }
    const handle = State.handle || 'you';
    const data = items.map((i) => ({
      id: i.id, kind: i.kind, type: i.type, date: i.time, text: i.text,
      likes: i.likes || 0, rt: i.retweets || 0,
      url: State.handle ? `https://x.com/${handle}/status/${i.id}` : `https://x.com/i/status/${i.id}`,
    }));
    const blob = new Blob([buildArchiveHTML(handle, data)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xtraclean-archive-${handle}-${Date.now()}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Saved a searchable archive of ${fmt(items.length)} item(s).`, 'ok');
    logLine(`Saved searchable .html archive (${fmt(items.length)} items).`, 'ok');
  }

  // ===========================================================================
  // AI TRIAGE — find the regrets, keep the gems. Runs 100% on your machine:
  // a transparent heuristic scorer everywhere, optionally refined by Chrome's
  // on-device model (Gemini Nano) when available. Nothing is sent anywhere.
  // ===========================================================================
  const RX = {
    profanity: /\b(f+u+c+k+|sh[i1]t|b[i1]tch|assh[o0]le|c[u*]nt|dick|piss|bastard|wtf|stfu)\b/i,
    hostile: /\b(idiot|stupid|moron|hate|kill|loser|trash|pathetic|shut ?up|dumb|clown|disgusting|worst)\b/i,
    political: /\b(trump|biden|maga|liberal|conservative|democrat|republican|election|abortion|vaccine|covid|guns?|immigration|woke|nazi|fascist|antifa|palestin|israel)\b/i,
    risky: /\b(drunk|wasted|hungover|high af|hate myself|depress|suicid|nsfw|nude|onlyfans|my address|my number)\b/i,
  };
  function scoreItem(it) {
    const t = it.text || '';
    const reasons = [];
    let s = 0;
    if (RX.profanity.test(t)) { s += 30; reasons.push('profanity'); }
    if (RX.hostile.test(t)) { s += 28; reasons.push('hostile / insulting'); }
    if (RX.political.test(t)) { s += 22; reasons.push('political / divisive'); }
    if (RX.risky.test(t)) { s += 32; reasons.push('personal / risky'); }
    const letters = t.replace(/[^a-zA-Z]/g, ''); const caps = t.replace(/[^A-Z]/g, '');
    if (letters.length > 15 && caps.length / letters.length > 0.6) { s += 14; reasons.push('all-caps shouting'); }
    if (it.time) { const h = new Date(it.time).getHours(); if (h <= 4) { s += 12; reasons.push('posted 12–4am'); } }
    if ((it.likes || 0) > 0 && (it.replies || 0) > it.likes * 3) { s += 20; reasons.push('possibly ratio’d'); }
    if ((it.likes || 0) === 0 && (it.retweets || 0) === 0 && it.type === 'post') { s += 8; reasons.push('no engagement'); }
    if (((t.match(/@\w+/g) || []).length) >= 3) { s += 8; reasons.push('mention pile-on'); }
    if (it.type === 'reply') { s += 4; }
    return { score: Math.min(s, 100), reasons };
  }

  // Detect Chrome's on-device model across the API shapes it has shipped under.
  async function getAIModel() {
    try {
      const LM = self.LanguageModel || (self.ai && self.ai.languageModel) || null;
      if (!LM) return null;
      let avail = null;
      if (LM.availability) avail = await LM.availability();
      else if (LM.capabilities) { const c = await LM.capabilities(); avail = c && (c.available === 'readily' ? 'available' : c.available); }
      if (avail === 'unavailable' || avail === 'no') return null;
      return LM;
    } catch (e) { return null; }
  }

  async function aiRefine(top, onProgress) {
    const LM = await getAIModel();
    if (!LM) { toast('On-device AI not available — using the built-in scorer.', 'warn'); return false; }
    let session;
    try {
      session = await LM.create({ initialPrompts: [{ role: 'system', content: 'You judge whether a past tweet could be embarrassing, offensive, or risky to keep public. Reply with ONLY compact JSON.' }] });
    } catch (e) { toast('Couldn’t start on-device AI — using the built-in scorer.', 'warn'); return false; }
    toast(`AI deep-scanning top ${top.length}…`);
    for (let i = 0; i < top.length; i++) {
      if (State.abort) break;
      const r = top[i];
      try {
        const out = await session.prompt(`Rate 0-100 how risky/regrettable this tweet is to keep public, plus a 2-4 word reason.\nTweet: """${(r.it.text || '').slice(0, 480)}"""\nReply JSON only: {"score":<0-100>,"reason":"..."}`);
        const m = out.match(/\{[\s\S]*?\}/);
        if (m) { const j = JSON.parse(m[0]); if (typeof j.score === 'number') { r.score = Math.round(j.score); r.reasons = [String(j.reason || 'AI flagged').slice(0, 40)]; r.ai = true; } }
      } catch (e) { /* keep heuristic score for this one */ }
      onProgress?.(i + 1, top.length);
    }
    try { session.destroy && session.destroy(); } catch (e) {}
    State.triage.results.sort((a, b) => b.score - a.score);
    return true;
  }

  function runTriage() {
    const tweets = State.items.filter((i) => i.kind === 'tweet');
    if (!tweets.length) { toast('Scan or import your posts first.', 'warn'); switchView('clean'); scrollToSection('sec-source'); return; }
    State.triage.results = tweets.map((it) => ({ it, ...scoreItem(it) })).sort((a, b) => b.score - a.score);
    State.triage.sel = new Set(); // review-first: nothing pre-selected
    renderTriage();
    const flagged = State.triage.results.filter((r) => r.score >= State.triage.threshold).length;
    toast(`Analyzed ${fmt(tweets.length)} posts — ${fmt(flagged)} flagged for review.`, 'ok');
  }

  function triageDeleteSelected() {
    const ids = [...State.triage.sel];
    if (!ids.length) { toast('Tick the posts you want gone first.', 'warn'); return; }
    const byId = new Map(State.items.map((i) => [i.id, i]));
    State._matchedItems = ids.map((id) => byId.get(id)).filter(Boolean);
    State.queue = ids.slice();
    if (confirm(`Delete ${ids.length} reviewed post(s)? This is permanent.`)) { switchView('clean'); runQueue(false); }
  }

  // ===========================================================================
  // QUEUE RUNNER — rate-limit aware, resumable
  // ===========================================================================
  async function runQueue(resuming = false) {
    if (!State.queue.length) { logLine('Queue is empty. Apply filters first.', 'warn'); return; }
    if (!getCookie('ct0')) { logLine('Not logged in to X in this tab. Log in and reload.', 'err'); return; }

    State.status = 'running';
    State.abort = false;
    if (!resuming) {
      State.progress = { done: 0, failed: 0, total: State.queue.length, startedAt: nowSec() };
    } else {
      State.progress.total = State.progress.done + State.progress.failed + State.queue.length;
      State.progress.startedAt = nowSec();
    }
    renderRun();
    persist();

    // Resolve CURRENT query IDs: hosted adapter first, then X's bundle, then fallback.
    logLine('Resolving X endpoints…');
    await ensureAdapter();
    await discoverQueryIds();
    const disc = resolvedQueries._discovered || {};
    const src = (op) => disc[op] ? 'live' : (remoteQueries && remoteQueries[op]) ? 'hosted' : 'fallback';
    const tag = (op) => `${op}=${activeQuery(op)} (${src(op)})`;
    logLine(`${tag('DeleteTweet')}, ${tag('DeleteRetweet')}, ${tag('UnfavoriteTweet')}`);
    logLine(`Starting deletion of ${fmt(State.queue.length)} item(s)…`, 'ok');

    const byId = new Map(State.items.map((i) => [i.id, i]));
    let consecFail = 0; // stop pretending — bail out if X rejects everything
    let lastErr = '';
    if (State.progress.skipped == null) State.progress.skipped = 0;
    const forceUnretweet = new Set(); // ids we'll retry as un-repost after a 183
    const triedUnretweet = new Set();

    while (State.queue.length && !State.abort) {
      // honour rate-limit pause
      if (State.pauseUntil > nowSec()) {
        State.status = 'paused';
        const wait = State.pauseUntil - nowSec();
        renderRun(`Rate limited by X — resuming in ${wait}s`);
        await sleep(1000);
        continue;
      } else if (State.status === 'paused' && !State.abort) {
        State.status = 'running';
      }

      const id = State.queue[0];
      const item = byId.get(id) || { kind: 'tweet', id };
      if (forceUnretweet.has(id)) item.action = 'unretweet';
      const r = await deleteOne(item);

      // 183 = "not your status". Most often a repost we should un-repost instead.
      // Try that once; if it still won't go, it's genuinely not yours → skip it
      // softly (don't count as a failure, don't trip the stop-everything guard).
      if (r.state === 'notmine') {
        if (item.kind !== 'like' && item.action !== 'unretweet' && !triedUnretweet.has(id)) {
          triedUnretweet.add(id);
          forceUnretweet.add(id);
          continue; // retry same id as an un-repost
        }
        State.queue.shift();
        State.progress.skipped++;
        consecFail = 0; // a skip is not a systemic failure
        logLine(`Skipped ${id} — not your post, can't delete.`, 'warn');
        State.items = State.items.filter((i) => i.id !== id);
        byId.delete(id);
        renderRun();
        await sleep(120);
        continue;
      }

      if (r.state === 'rate') {
        State.pauseUntil = r.retry;
        logLine(`Hit X rate limit. Auto-pausing until ${new Date(r.retry * 1000).toLocaleTimeString()}.`, 'warn');
        persist();
        continue; // do not pop — retry after pause
      }

      if (r.state === 'neterr') {
        logLine(`Network error on ${id} (${r.msg}) — retrying…`, 'warn');
        await sleep(3000);
        continue; // retry same id
      }

      if (r.state === 'auth') {
        logLine(`X rejected the request: ${r.msg}. Nothing deleted. Reload x.com (and confirm you're logged in), then resume.`, 'err');
        toast('X rejected the request — see log. Nothing was deleted.', 'err');
        pauseRun();
        break;
      }

      if (r.state === 'ok' || r.state === 'gone') {
        // VERIFIED removed (or confirmed already-gone by X) — only now count it
        State.queue.shift();
        State.progress.done++;
        State.items = State.items.filter((i) => i.id !== id);
        byId.delete(id);
        consecFail = 0;
      } else {
        // genuine failure — record the real reason, don't fake success
        State.queue.shift();
        State.progress.failed++;
        consecFail++;
        lastErr = r.msg || 'unknown';
        logLine(`Failed ${id}: ${lastErr}`, 'err');
        if (consecFail >= 5) {
          logLine(`Stopping — X rejected the last ${consecFail} deletions. Reason: ${lastErr}. Nothing further will be attempted.`, 'err');
          toast('Deletions are failing — stopped. See the log for the reason.', 'err');
          pauseRun();
          break;
        }
      }

      if (State.progress.done % 10 === 0) persist();
      renderRun();
      const jitter = Settings.delayMs * (0.75 + Math.random() * 0.5);
      await sleep(jitter);
    }

    const sk = State.progress.skipped || 0;
    if (State.abort) {
      State.status = 'paused';
      logLine('Paused.', 'warn');
    } else if (State.progress.done === 0 && State.progress.failed > 0) {
      // Everything failed — do NOT report success. Surface the real reason.
      State.status = 'done';
      clearPersisted();
      logLine(`Nothing was deleted — all ${fmt(State.progress.failed)} attempt(s) failed. Reason: ${lastErr || 'see errors above'}.`, 'err');
      toast('Nothing was deleted — X rejected every request. See the log.', 'err');
    } else if (State.progress.done === 0 && sk > 0) {
      // Everything was skipped as "not yours" — likely a stale/foreign queue.
      State.status = 'done';
      clearPersisted();
      logLine(`Nothing deleted — skipped ${fmt(sk)} item(s) that aren’t yours. Re-scan your own profile and try again.`, 'warn');
      toast(`Skipped ${fmt(sk)} item(s) that aren’t yours — re-scan your profile.`, 'warn');
    } else {
      State.status = 'done';
      logLine(`Done! Deleted ${fmt(State.progress.done)}, failed ${fmt(State.progress.failed)}${sk ? `, skipped ${fmt(sk)}` : ''}.`, 'ok');
      clearPersisted();
      if (State.progress.done > 0) {
        confetti();
        toast(`🎉 Deleted ${fmt(State.progress.done)} item(s). Your X is cleaner.`, 'ok');
        notify('XtraClean finished', `Deleted ${fmt(State.progress.done)} item(s) from @${State.handle || 'your account'}.`);
      }
    }
    persist();
    renderRun();
  }

  function pauseRun() { State.abort = true; State.status = 'paused'; persist(); }
  function stopRun() {
    State.abort = true;
    State.status = 'idle';
    State.queue = [];
    State.progress = { done: 0, failed: 0, total: 0, startedAt: 0 };
    clearPersisted();
    renderRun();
  }

  // ===========================================================================
  // QUICK ACTIONS — one tap to set up the most common jobs
  // ===========================================================================
  const PRESETS = {
    deleteAllPosts: {
      label: 'Delete all my posts',
      apply: (s) => { s.types = { post: true, reply: false, repost: true, quote: true }; s.deleteLikes = false; s.deleteTweets = true; s.dateFrom = ''; s.dateTo = ''; s.keyword = ''; s.keepAboveLikes = ''; },
    },
    deleteAllReplies: {
      label: 'Delete all my replies',
      apply: (s) => { s.types = { post: false, reply: true, repost: false, quote: false }; s.deleteLikes = false; s.deleteTweets = true; s.dateFrom = ''; s.dateTo = ''; s.keyword = ''; },
    },
    unlikeAll: {
      label: 'Unlike everything',
      needsLikes: true,
      apply: (s) => { s.types = { post: false, reply: false, repost: false, quote: false }; s.deleteLikes = true; s.deleteTweets = false; s.dateFrom = ''; s.dateTo = ''; s.keyword = ''; },
    },
    older1y: {
      label: 'Older than 1 year',
      apply: (s) => { s.types = { post: true, reply: true, repost: true, quote: true }; s.deleteTweets = true; s.deleteLikes = false; s.dateFrom = ''; s.dateTo = cutoffDate(365); s.keyword = ''; },
    },
    older30: {
      label: 'Older than 30 days',
      apply: (s) => { s.types = { post: true, reply: true, repost: true, quote: true }; s.deleteTweets = true; s.deleteLikes = false; s.dateFrom = ''; s.dateTo = cutoffDate(30); s.keyword = ''; },
    },
    wipeEverything: {
      label: 'Wipe EVERYTHING',
      danger: true,
      apply: (s) => { s.types = { post: true, reply: true, repost: true, quote: true }; s.deleteTweets = true; s.deleteLikes = true; s.dateFrom = ''; s.dateTo = ''; s.keyword = ''; s.keepAboveLikes = ''; },
    },
  };

  function cutoffDate(daysAgo) {
    return new Date(Date.now() - daysAgo * 86400 * 1000).toISOString().slice(0, 10);
  }

  async function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    p.apply(Settings);
    saveSettingsOnly();
    syncSettingsToUI();
    toast(`Preset: ${p.label}`);
    // make sure we have content to act on
    if (!State.items.length) {
      if (p.needsLikes && !/\/likes\/?$/.test(location.pathname)) {
        toast('Open your Likes page, then I’ll scan it.', 'warn');
        scrollToSection('sec-source');
        return;
      }
      if (isOwnProfilePage()) { await liveScan(); }
      else { toast('Open your profile (or import your archive), then Scan.', 'warn'); scrollToSection('sec-source'); return; }
    }
    applyFilters();
    scrollToSection('sec-preview');
  }

  // ===========================================================================
  // AUTO-CLEAN — set a rule once, XtraClean enforces it on a schedule
  // ===========================================================================
  function isOwnProfilePage() {
    const h = (State.handle || detectHandle() || '').toLowerCase();
    if (!h) return false;
    const p = location.pathname.toLowerCase().replace(/\/$/, '');
    return p === '/' + h || p === '/' + h + '/with_replies' || p === '/' + h + '/likes';
  }

  function autoCleanCfg() {
    const ac = Settings.autoClean;
    return {
      dateFrom: '', dateTo: cutoffDate(ac.maxAgeDays),
      keyword: ac.keyword || '', useRegex: false,
      types: { post: ac.posts, reply: ac.replies, repost: ac.reposts, quote: ac.posts },
      deleteLikes: ac.likes, deleteTweets: true,
      keepAboveLikes: ac.keepAboveLikes || '', mediaFilter: 'all',
      protectIds: Settings.protectIds || '', protectPinned: true,
    };
  }

  function autoCleanDue() {
    const ac = Settings.autoClean;
    if (!ac.enabled) return false;
    const gap = (ac.everyHours || 24) * 3600;
    return nowSec() - (Settings.lastAutoRun || 0) >= gap;
  }

  async function runAutoClean({ silent = true, navigate = false } = {}) {
    if (State.status === 'running') return; // never clobber a manual job
    State.handle = State.handle || detectHandle();
    if (!isOwnProfilePage()) {
      if (navigate && State.handle) {
        sessionStorage.setItem('xc_autorun', '1');
        location.assign(`https://${location.host}/${State.handle}/with_replies`);
        return;
      }
      try { chrome.storage.local.set({ xtraclean_autoclean_pending: true }); } catch (e) {}
      toast('Auto-Clean is ready — open your profile to let it sweep.', 'warn');
      return;
    }
    toast('Auto-Clean: scanning your profile…');
    await liveScan();
    const matched = State.items.filter(buildMatcher(autoCleanCfg()));
    State._matchedItems = matched;
    State.queue = matched.map((i) => i.id);
    Settings.lastAutoRun = nowSec();
    saveSettingsOnly();
    try { chrome.storage.local.remove('xtraclean_autoclean_pending'); } catch (e) {}
    renderAutoClean();
    if (!matched.length) { toast('Auto-Clean: nothing old to remove ✨', 'ok'); return; }
    toast(`Auto-Clean: removing ${matched.length} old item(s)…`);
    await runQueue(false); // runQueue handles its own completion toast + notification
  }

  // ===========================================================================
  // DM RUNNER
  // ===========================================================================
  async function dmDeleteSelected() {
    const ids = [...(State.dmSelected || [])];
    if (!ids.length) { toast('Select at least one conversation.', 'warn'); return; }
    if (!confirm(`Delete ${ids.length} conversation(s) from your inbox?\n\nThis removes them for you and cannot be undone.`)) return;
    State.abort = false;
    State.status = 'running';
    let done = 0, failed = 0;
    for (const id of ids) {
      if (State.abort) break;
      try {
        const res = await DM.deleteConversation(id);
        if (res.ok || res.status === 404) { done++; State.dmConvs = State.dmConvs.filter((c) => c.id !== id); State.dmSelected.delete(id); }
        else if (res.status === 429) { toast('Rate limited — pausing 60s…', 'warn'); await sleep(60000); continue; }
        else { failed++; }
      } catch (e) { failed++; }
      renderDM();
      toast(`Deleted ${done} conversation(s)…`, 'ok');
      await sleep(600);
    }
    State.status = 'idle';
    renderDM();
    toast(`Done — deleted ${done}, failed ${failed}.`, done ? 'ok' : 'warn');
    if (done) { confetti(); notify('DMs cleared', `Deleted ${done} conversation(s).`); }
  }

  // ===========================================================================
  // TOAST + CONFETTI + NOTIFY
  // ===========================================================================
  function toast(msg, kind = 'info') {
    logLine(msg, kind === 'info' ? 'info' : kind);
    if (!root) return;
    let host = $('#toast', root);
    if (!host) { host = document.createElement('div'); host.id = 'toast'; ($('.panel', root) || root).appendChild(host); }
    const el = document.createElement('div');
    el.className = 'toast-item ' + kind;
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
  }

  function notify(title, message) {
    try { chrome.runtime.sendMessage({ type: 'XC_NOTIFY', title, message }); } catch (e) {}
  }

  function confetti() {
    if (!root) return;
    const wrap = document.createElement('div');
    wrap.className = 'confetti';
    const colors = ['#2dd4bf', '#8b5cf6', '#f0c674', '#7ee3c7', '#ff8585'];
    for (let i = 0; i < 80; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.4 + 's';
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      wrap.appendChild(p);
    }
    root.appendChild(wrap);
    setTimeout(() => wrap.remove(), 3000);
  }

  // ===========================================================================
  // UI  (Shadow DOM so X's CSS can't touch us and ours can't leak)
  // ===========================================================================
  let root; // shadow root
  let panelOpen = false;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .fab {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
      width: 56px; height: 56px; border-radius: 16px; border: none; cursor: pointer;
      background: linear-gradient(135deg,#0d1117,#1f1c3a); color:#fff;
      box-shadow: 0 8px 24px rgba(0,0,0,.45); display:grid; place-items:center;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .fab:hover { transform: translateY(-2px) scale(1.04); box-shadow:0 12px 30px rgba(0,0,0,.55); }
    .fab svg { width: 30px; height: 30px; }
    .panel {
      position: fixed; right: 20px; bottom: 88px; z-index: 2147483647;
      width: 380px; max-height: 82vh; overflow:hidden; display:flex; flex-direction:column;
      background:#0d1117; color:#e6edf3; border:1px solid #232a36; border-radius:18px;
      box-shadow: 0 24px 60px rgba(0,0,0,.6); font-size:13px;
    }
    .hd { padding:14px 16px; background:linear-gradient(135deg,#141a26,#1c1838); display:flex; align-items:center; gap:10px; border-bottom:1px solid #232a36; }
    .hd .logo { width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#2dd4bf,#8b5cf6);display:grid;place-items:center;flex:none;}
    .hd .logo svg{width:18px;height:18px}
    .hd h1 { font-size:15px; margin:0; font-weight:700; letter-spacing:.2px; }
    .hd .sub { font-size:10.5px; color:#8b95a5; margin-top:1px;}
    .hd .x { margin-left:auto; background:none;border:none;color:#8b95a5;font-size:20px;cursor:pointer;line-height:1;padding:4px;}
    .hd .x:hover{color:#fff}
    .body { overflow-y:auto; padding:14px 16px; }
    .body::-webkit-scrollbar{width:8px} .body::-webkit-scrollbar-thumb{background:#2a3240;border-radius:4px}
    .priv { font-size:10.5px; color:#7ee3c7; background:rgba(45,212,191,.08); border:1px solid rgba(45,212,191,.2); padding:6px 9px; border-radius:8px; margin-bottom:12px; display:flex;gap:6px;align-items:center;}
    .sec { margin-bottom:16px; }
    .sec > .lbl { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:#8b95a5; font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;}
    .sec > .lbl .n { background:#232a36;border-radius:10px;padding:1px 7px;font-size:10px;color:#cdd6e0;}
    .row { display:flex; gap:8px; margin-bottom:8px; }
    .row.wrap{flex-wrap:wrap}
    button.btn { flex:1; background:#1b2230; border:1px solid #2a3240; color:#e6edf3; padding:9px 10px; border-radius:10px; cursor:pointer; font-size:12px; font-weight:600; transition:.12s; }
    button.btn:hover{ background:#222b3b; border-color:#3a4658; }
    button.btn.primary{ background:linear-gradient(135deg,#2dd4bf,#14b8a6); border:none; color:#04201b; }
    button.btn.primary:hover{ filter:brightness(1.08); }
    button.btn.danger{ background:linear-gradient(135deg,#ef4444,#dc2626); border:none; color:#fff;}
    button.btn.ghost{ background:transparent; }
    button.btn:disabled{ opacity:.45; cursor:not-allowed; }
    .seg{ display:flex; background:#161c28; border:1px solid #2a3240; border-radius:10px; padding:3px; gap:3px; }
    .seg button{ flex:1; background:none;border:none;color:#8b95a5;padding:7px;border-radius:7px;cursor:pointer;font-size:11.5px;font-weight:600;}
    .seg button.on{ background:#2a3346; color:#fff; }
    label.f{ display:block; font-size:11px; color:#9aa6b6; margin:8px 0 3px; }
    input[type=text],input[type=date],input[type=number],input[type=search]{
      width:100%; background:#0a0e15; border:1px solid #2a3240; color:#e6edf3; border-radius:8px; padding:7px 9px; font-size:12px; }
    input:focus{ outline:none; border-color:#2dd4bf; }
    .two{ display:flex; gap:8px;} .two>div{flex:1}
    .chk{ display:flex;align-items:center;gap:6px; font-size:12px; color:#cdd6e0; cursor:pointer; padding:4px 0;}
    .chk input{ accent-color:#2dd4bf; width:15px;height:15px; }
    .chips{ display:flex; flex-wrap:wrap; gap:6px; }
    .chip{ display:flex;align-items:center;gap:5px; background:#161c28; border:1px solid #2a3240; border-radius:20px; padding:5px 10px; font-size:11.5px; cursor:pointer; user-select:none;}
    .chip.on{ background:rgba(45,212,191,.14); border-color:#2dd4bf; color:#7ee3c7;}
    .preview{ background:#0a0e15; border:1px solid #2a3240; border-radius:10px; padding:10px; }
    .preview .big{ font-size:26px; font-weight:800; color:#fff; }
    .preview .big span{ font-size:13px; color:#8b95a5; font-weight:500; }
    .sample{ margin-top:8px; max-height:120px; overflow-y:auto; font-size:11px; color:#9aa6b6;}
    .sample div{ padding:3px 0; border-top:1px solid #1a2130; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
    .prog { height:10px; background:#0a0e15; border-radius:6px; overflow:hidden; border:1px solid #2a3240; }
    .prog > i{ display:block; height:100%; background:linear-gradient(90deg,#2dd4bf,#8b5cf6); width:0%; transition:width .3s; }
    .stats{ display:flex; gap:8px; margin-top:8px; }
    .stat{ flex:1; background:#0a0e15; border:1px solid #2a3240; border-radius:8px; padding:7px; text-align:center;}
    .stat b{ display:block; font-size:18px; color:#fff;} .stat small{ font-size:9.5px; color:#8b95a5; text-transform:uppercase; letter-spacing:.4px;}
    .runbar{ font-size:11px; color:#f0c674; margin-top:8px; min-height:14px; }
    .log{ margin-top:10px; max-height:120px; overflow-y:auto; font-size:10.5px; font-family:ui-monospace,Menlo,monospace; }
    .log div{ padding:2px 0; color:#7e8aa0;}
    .log .ok{color:#7ee3c7}.log .err{color:#ff8585}.log .warn{color:#f0c674}
    .hint{ font-size:10.5px; color:#7e8aa0; line-height:1.5; }
    a.link{ color:#2dd4bf; text-decoration:none;} a.link:hover{text-decoration:underline;}
    .danger-note{ font-size:10.5px; color:#ff9d9d; background:rgba(239,68,68,.08); border:1px solid rgba(239,68,68,.25); padding:7px 9px; border-radius:8px; margin:8px 0;}
    .hidden{ display:none !important; }
    select{ width:100%; background:#0a0e15; border:1px solid #2a3240; color:#e6edf3; border-radius:8px; padding:7px; font-size:12px; }
    /* tabs */
    .tabs{ display:flex; gap:2px; padding:8px 12px 0; background:#0d1117; border-bottom:1px solid #232a36;}
    .tabs button{ flex:1; background:none; border:none; color:#8b95a5; padding:9px 6px; border-radius:8px 8px 0 0; cursor:pointer; font-size:12px; font-weight:700; border-bottom:2px solid transparent; transition:.12s;}
    .tabs button:hover{ color:#cdd6e0;}
    .tabs button.on{ color:#fff; border-bottom-color:#2dd4bf;}
    .view{ display:none;} .view.on{ display:block;}
    /* quick actions */
    .qa{ display:grid; grid-template-columns:1fr 1fr; gap:8px;}
    .qa button{ text-align:left; background:#161c28; border:1px solid #2a3240; color:#e6edf3; border-radius:12px; padding:11px 12px; cursor:pointer; font-size:12px; font-weight:700; transition:.12s; display:flex; flex-direction:column; gap:3px;}
    .qa button:hover{ border-color:#2dd4bf; transform:translateY(-1px);}
    .qa button .ic{ font-size:17px;}
    .qa button small{ font-weight:500; color:#8b95a5; font-size:10px;}
    .qa button.full{ grid-column:1/-1; background:linear-gradient(135deg,rgba(239,68,68,.16),rgba(220,38,38,.07)); border-color:rgba(239,68,68,.35);}
    .qa button.full:hover{ border-color:#ef4444;}
    /* toggle switch */
    .switch{ position:relative; display:inline-block; width:44px; height:25px; flex:none;}
    .switch input{ display:none;}
    .switch .sl{ position:absolute; inset:0; background:#2a3240; border-radius:25px; transition:.2s; cursor:pointer;}
    .switch .sl:before{ content:''; position:absolute; width:19px; height:19px; left:3px; top:3px; background:#fff; border-radius:50%; transition:.2s;}
    .switch input:checked + .sl{ background:linear-gradient(135deg,#2dd4bf,#14b8a6);}
    .switch input:checked + .sl:before{ transform:translateX(19px);}
    .card{ background:#0a0e15; border:1px solid #2a3240; border-radius:12px; padding:12px;}
    .card .top{ display:flex; align-items:center; gap:10px;}
    .card .top h3{ font-size:13px; margin:0;} .card .top p{ font-size:10.5px; color:#8b95a5; margin:2px 0 0;}
    .statusdot{ display:inline-block; width:7px; height:7px; border-radius:50%; background:#3a4658; margin-right:5px; vertical-align:middle;}
    .statusdot.on{ background:#2dd4bf; box-shadow:0 0 6px #2dd4bf;}
    /* dm list */
    .dmlist{ max-height:210px; overflow-y:auto; border:1px solid #2a3240; border-radius:10px; margin-top:8px;}
    .dmrow{ display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid #1a2130; font-size:12px; cursor:pointer;}
    .dmrow:last-child{ border-bottom:none;} .dmrow:hover{ background:#131a26;}
    .dmrow input{ accent-color:#2dd4bf; width:15px; height:15px;}
    .dmrow .nm{ flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
    .dmrow .dt{ font-size:10px; color:#7e8aa0;}
    /* triage */
    .trow{ display:flex; gap:9px; padding:9px 10px; border-bottom:1px solid #1a2130; font-size:12px; cursor:pointer; align-items:flex-start;}
    .trow:last-child{ border-bottom:none;} .trow:hover{ background:#131a26;}
    .trow input{ accent-color:#2dd4bf; width:15px; height:15px; margin-top:2px; flex:none;}
    .trow .body{ flex:1; min-width:0;}
    .trow .txt{ color:#cdd6e0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
    .trow .why{ margin-top:4px; display:flex; flex-wrap:wrap; gap:4px;}
    .trow .why span{ font-size:9.5px; color:#9aa6b6; background:#161c28; border:1px solid #2a3240; border-radius:10px; padding:1px 6px;}
    .sbadge{ flex:none; width:34px; height:34px; border-radius:9px; display:grid; place-items:center; font-weight:800; font-size:13px; color:#fff;}
    .ai-on #aiBadge{ background:rgba(139,92,246,.2); color:#c4b5fd; border:1px solid rgba(139,92,246,.4);}
    /* toast */
    #toast{ position:absolute; left:12px; right:12px; bottom:12px; display:flex; flex-direction:column; gap:6px; pointer-events:none; z-index:9;}
    .toast-item{ background:#1b2230; border:1px solid #2a3240; color:#e6edf3; border-radius:10px; padding:9px 12px; font-size:11.5px; opacity:0; transform:translateY(8px); transition:.25s; box-shadow:0 8px 20px rgba(0,0,0,.45);}
    .toast-item.show{ opacity:1; transform:none;}
    .toast-item.ok{ border-color:rgba(45,212,191,.5);} .toast-item.warn{ border-color:rgba(240,198,116,.5);} .toast-item.err{ border-color:rgba(239,68,68,.5);}
    /* confetti */
    .confetti{ position:fixed; inset:0; pointer-events:none; z-index:2147483647; overflow:hidden;}
    .confetti i{ position:absolute; top:-12px; width:9px; height:14px; border-radius:2px; animation:xcfall 2.6s linear forwards;}
    @keyframes xcfall{ to{ transform:translateY(106vh) rotate(680deg); opacity:.15;} }
    /* onboarding */
    .ob{ background:linear-gradient(135deg,rgba(45,212,191,.1),rgba(139,92,246,.08)); border:1px solid rgba(45,212,191,.25); border-radius:12px; padding:13px; margin-bottom:14px;}
    .ob h3{ margin:0 0 5px; font-size:13.5px;} .ob p{ margin:0; font-size:11px; color:#aab4c2; line-height:1.55;}
  `;

  const BROOM_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M19.5 3.5l-7 7M21 9l-6 6-3-3 6-6a2.12 2.12 0 013 3z" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 13l-6 6m3-3l-3 3m6-3l-2.5 2.5" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const MARK_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="#04201b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function buildUI() {
    const host = document.createElement('div');
    host.id = 'xtraclean-root';
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.title = 'XtraClean — bulk delete your X activity';
    fab.innerHTML = BROOM_SVG;
    fab.onclick = togglePanel;
    root.appendChild(fab);

    const panel = document.createElement('div');
    panel.className = 'panel hidden';
    panel.innerHTML = PANEL_HTML;
    root.appendChild(panel);
    document.documentElement.appendChild(host);

    wireEvents();
    syncSettingsToUI();
    renderPool();
    renderRun();
  }

  const PANEL_HTML = `
    <div class="hd">
      <div class="logo">${MARK_SVG}</div>
      <div>
        <h1>XtraClean</h1>
        <div class="sub" id="acct">Detecting account…</div>
      </div>
      <button class="x" id="close">×</button>
    </div>
    <div class="tabs" id="tabs">
      <button data-view="clean" class="on">Clean</button>
      <button data-view="triage">Triage</button>
      <button data-view="auto">Auto</button>
      <button data-view="dm">DMs</button>
      <button data-view="fp">More</button>
    </div>
    <div class="body">
      <div class="priv">🔒 100% local. Nothing leaves your browser — no servers, no account.</div>

      <!-- ============================ CLEAN VIEW ============================ -->
      <div class="view on" id="view-clean">
      <div id="onboard"></div>

      <div class="sec">
        <div class="lbl">⚡ Quick actions</div>
        <div class="qa" id="qa">
          <button data-preset="deleteAllPosts"><span class="ic">🗑️</span>Delete all posts<small>posts, reposts &amp; quotes</small></button>
          <button data-preset="deleteAllReplies"><span class="ic">💬</span>Delete replies<small>every reply you made</small></button>
          <button data-preset="unlikeAll"><span class="ic">💔</span>Unlike everything<small>open your Likes page</small></button>
          <button data-preset="older1y"><span class="ic">📅</span>Older than 1 year<small>keep the recent stuff</small></button>
          <button data-preset="older30"><span class="ic">🧹</span>Older than 30 days<small>rolling fresh start</small></button>
          <button data-preset="wipeEverything" class="full"><span class="ic">☢️</span>Wipe EVERYTHING<small>posts, replies, reposts &amp; likes</small></button>
        </div>
      </div>

      <div class="sec" id="sec-source">
        <div class="lbl">1 · What to clean</div>
        <div class="seg" id="srcSeg">
          <button data-src="live" class="on">Scan this page</button>
          <button data-src="archive">Import archive</button>
        </div>
        <div id="liveBox" style="margin-top:10px;">
          <div class="hint">Open your <b>Profile</b> (Posts / Replies tab) or your <b>Likes</b> page, then scan. XtraClean auto-scrolls and collects everything it can see.</div>
          <div class="row" style="margin-top:8px;">
            <button class="btn primary" id="scanBtn">⟳ Scan this page</button>
            <button class="btn ghost" id="stopScanBtn" style="flex:0 0 auto;">Stop</button>
          </div>
        </div>
        <div id="archiveBox" class="hidden" style="margin-top:10px;">
          <div class="hint">Drop your whole X data-archive <b>.zip</b> here (Settings → Your account → Download an archive) — no unzipping needed. Or drop the <b>tweets.js</b> / <b>like.js</b> files directly. Reaches <b>every</b> post, beyond the 3,200 limit.</div>
          <input type="file" id="fileInput" multiple accept=".zip,.js,application/javascript,application/zip" style="margin-top:8px; font-size:11px; color:#9aa6b6;" />
        </div>
        <div class="hint" id="poolLine" style="margin-top:8px;"></div>
      </div>

      <div class="sec">
        <div class="lbl">2 · Filters <span class="n" id="matchN">0</span></div>
        <div class="chips" id="typeChips">
          <span class="chip on" data-type="post">Posts</span>
          <span class="chip on" data-type="reply">Replies</span>
          <span class="chip on" data-type="repost">Reposts</span>
          <span class="chip on" data-type="quote">Quotes</span>
          <span class="chip on" data-kind="like">Likes</span>
        </div>
        <div class="two" style="margin-top:8px;">
          <div><label class="f">From date</label><input type="date" id="dateFrom"></div>
          <div><label class="f">To date</label><input type="date" id="dateTo"></div>
        </div>
        <label class="f">Contains text <span style="color:#6b7688">(optional)</span></label>
        <input type="search" id="keyword" placeholder="word, phrase, or @handle">
        <label class="chk" style="margin-top:6px;"><input type="checkbox" id="useRegex"> Treat as regular expression</label>
        <div class="two" style="margin-top:6px;">
          <div>
            <label class="f">Keep posts with ≥ likes</label>
            <input type="number" id="keepAbove" placeholder="e.g. 100" min="0">
          </div>
          <div>
            <label class="f">Media</label>
            <select id="mediaFilter" style="width:100%;background:#0a0e15;border:1px solid #2a3240;color:#e6edf3;border-radius:8px;padding:7px;font-size:12px;">
              <option value="all">All</option>
              <option value="only">With media only</option>
              <option value="none">Text only</option>
            </select>
          </div>
        </div>
        <label class="chk" style="margin-top:6px;"><input type="checkbox" id="protectPinned" checked> Protect my pinned post</label>
        <label class="f">Never delete these IDs <span style="color:#6b7688">(comma-sep)</span></label>
        <input type="text" id="protectIds" placeholder="1234567890, 9876543210">
        <button class="btn" id="applyBtn" style="margin-top:10px;">Apply filters & preview</button>
      </div>

      <div class="sec" id="sec-preview">
        <div class="lbl">3 · Preview</div>
        <div class="preview">
          <div class="big"><span id="matchBig">0</span> <span>item(s) match</span></div>
          <div class="sample" id="sample"></div>
        </div>
        <div class="row" style="margin-top:8px;">
          <button class="btn" id="backupBtn">⤓ Back up matched (.json)</button>
          <button class="btn" id="archiveBtn">📦 Save archive (.html)</button>
        </div>
        <div class="hint" style="margin-top:2px;">Archive saves a searchable copy of <b>everything you collected</b> — keep your memories, then erase them from X.</div>
      </div>

      <div class="sec">
        <div class="lbl">4 · Delete</div>
        <label class="f">Speed — delay between deletions: <b id="delayVal">0.9s</b></label>
        <input type="range" id="delay" min="300" max="3000" step="100" value="900" style="width:100%; accent-color:#2dd4bf;">
        <div class="hint">Slower = safer against X's rate limits. XtraClean auto-pauses & resumes if X throttles you.</div>
        <div class="danger-note">⚠️ Deletion is permanent and cannot be undone by X. Back up first if unsure.</div>
        <div class="prog"><i id="bar"></i></div>
        <div class="stats">
          <div class="stat"><b id="sDone">0</b><small>Deleted</small></div>
          <div class="stat"><b id="sLeft">0</b><small>Remaining</small></div>
          <div class="stat"><b id="sFail">0</b><small>Failed</small></div>
          <div class="stat"><b id="sEta">–</b><small>ETA</small></div>
        </div>
        <div class="runbar" id="runbar"></div>
        <div class="row" style="margin-top:10px;">
          <button class="btn danger" id="startBtn">Start deleting</button>
          <button class="btn" id="pauseBtn" disabled>Pause</button>
          <button class="btn ghost" id="stopBtn" style="flex:0 0 auto;" disabled>Stop</button>
        </div>
        <div class="log" id="log"></div>
      </div>
      </div><!-- /view-clean -->

      <!-- ============================ TRIAGE VIEW ============================ -->
      <div class="view" id="view-triage">
        <div class="sec">
          <div class="lbl">🧠 Smart triage <span class="n" id="aiBadge">heuristic</span></div>
          <div class="hint">Finds your most likely-to-regret posts so you can review and delete just those — keeping the gems. Runs entirely on your machine. Scan or import your posts first (Clean tab).</div>
          <div class="row" style="margin-top:10px;">
            <button class="btn primary" id="triageRun">Analyze my posts</button>
            <button class="btn" id="triageAI" style="flex:0 0 auto;" title="Refine top results with Chrome's on-device AI">🧠 AI</button>
          </div>
          <div class="two" style="margin-top:6px;align-items:center;">
            <div><label class="f">Show score ≥ <b id="thVal">40</b></label>
              <input type="range" id="thresh" min="10" max="90" step="5" value="40" style="width:100%;accent-color:#2dd4bf;"></div>
            <div style="text-align:right;padding-top:14px;">
              <button class="btn" id="triageAll" style="flex:0 0 auto;">Select all shown</button>
            </div>
          </div>
          <div id="triageList" class="dmlist" style="max-height:300px;"><div class="hint" style="padding:12px;">No analysis yet — hit “Analyze my posts”.</div></div>
          <button class="btn danger" id="triageDelete" style="margin-top:10px;width:100%;" disabled>Delete selected</button>
        </div>
      </div><!-- /view-triage -->

      <!-- ============================ AUTO-CLEAN VIEW ============================ -->
      <div class="view" id="view-auto">
        <div class="sec">
          <div class="lbl">🤖 Auto-Clean</div>
          <div class="card">
            <div class="top">
              <div style="flex:1">
                <h3>Keep my X clean, automatically</h3>
                <p id="acStatus"><span class="statusdot"></span>Off</p>
              </div>
              <label class="switch"><input type="checkbox" id="acEnabled"><span class="sl"></span></label>
            </div>
            <label class="f" style="margin-top:10px;">Delete anything older than</label>
            <div class="chips" id="acAge">
              <span class="chip" data-days="1">24 hours</span>
              <span class="chip" data-days="7">7 days</span>
              <span class="chip on" data-days="30">30 days</span>
              <span class="chip" data-days="90">90 days</span>
              <span class="chip" data-days="365">1 year</span>
            </div>
            <label class="f" style="margin-top:8px;">Apply to</label>
            <div class="chips" id="acTypes">
              <span class="chip on" data-ac="posts">Posts</span>
              <span class="chip on" data-ac="replies">Replies</span>
              <span class="chip on" data-ac="reposts">Reposts</span>
              <span class="chip" data-ac="likes">Likes</span>
            </div>
            <div class="two" style="margin-top:8px;">
              <div><label class="f">Keep posts ≥ likes</label><input type="number" id="acKeepAbove" min="0" placeholder="e.g. 50"></div>
              <div><label class="f">Run at most every</label>
                <select id="acEvery">
                  <option value="6">6 hours</option>
                  <option value="24">24 hours</option>
                  <option value="168">Weekly</option>
                </select>
              </div>
            </div>
            <div class="hint" style="margin-top:10px;">Set it once. XtraClean sweeps old content whenever you open X — and reminds you daily so nothing piles up. Runs only on your machine.</div>
            <button class="btn primary" id="acRunNow" style="margin-top:10px;">Run a sweep now</button>
          </div>
          <div class="hint" id="acLast" style="margin-top:8px;"></div>
        </div>
      </div><!-- /view-auto -->

      <!-- ============================ DM VIEW ============================ -->
      <div class="view" id="view-dm">
        <div class="sec">
          <div class="lbl">✉️ Direct messages <span class="n" id="dmCount">0</span></div>
          <div class="hint">Scan your inbox, then wipe whole conversations. Deleting removes the conversation <b>for you</b> (the other person keeps their copy) and can't be undone.</div>
          <div class="row" style="margin-top:10px;">
            <button class="btn primary" id="dmScanBtn">⟳ Scan my inbox</button>
            <button class="btn ghost" id="dmStopBtn" style="flex:0 0 auto;">Stop</button>
          </div>
          <div class="row">
            <button class="btn" id="dmAll">Select all</button>
            <button class="btn" id="dmNone">Clear</button>
          </div>
          <div class="dmlist" id="dmList"><div class="hint" style="padding:12px;">No conversations yet — hit “Scan my inbox”.</div></div>
          <button class="btn danger" id="dmDelete" style="margin-top:10px;width:100%;" disabled>Delete selected</button>
        </div>
      </div><!-- /view-dm -->

      <!-- ============================ FOOTPRINT VIEW ============================ -->
      <div class="view" id="view-fp">
        <div class="sec">
          <div class="lbl">🧹 Footprint</div>
          <div class="hint">Clear the rest of your X trail. Runs through X's own endpoints in your session — permanent, can't be undone.</div>
          <button class="btn" id="fpBookmarks" style="width:100%;margin-top:10px;">🔖 Clear all bookmarks</button>
          <button class="btn" id="fpMutes" style="width:100%;margin-top:8px;">🔇 Unmute everyone</button>
          <button class="btn" id="fpBlocks" style="width:100%;margin-top:8px;">🚫 Unblock everyone</button>
          <div class="row" style="margin-top:8px;justify-content:flex-end;">
            <button class="btn ghost" id="fpStop" style="flex:0 0 auto;">Stop</button>
          </div>
          <div class="hint" id="fpStatus" style="margin-top:6px;"></div>
        </div>
        <div class="sec">
          <div class="lbl">📄 Wipe report</div>
          <div class="hint">A summary of everything XtraClean removed this session — handy proof you cleaned up.</div>
          <button class="btn primary" id="fpReport" style="width:100%;margin-top:10px;">⤓ Download wipe report</button>
        </div>
      </div><!-- /view-fp -->

      <div class="hint" style="text-align:center;margin-top:4px;">XtraClean · free &amp; open · your data stays yours</div>
    </div>
  `;

  // --- event wiring ----------------------------------------------------------
  function wireEvents() {
    $('#close', root).onclick = togglePanel;

    // source segmented control
    root.querySelectorAll('#srcSeg button').forEach((b) => {
      b.onclick = () => {
        root.querySelectorAll('#srcSeg button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        State.source = b.dataset.src;
        $('#liveBox', root).classList.toggle('hidden', State.source !== 'live');
        $('#archiveBox', root).classList.toggle('hidden', State.source !== 'archive');
      };
    });

    $('#scanBtn', root).onclick = () => liveScan();
    $('#stopScanBtn', root).onclick = () => { State.abort = true; };
    $('#fileInput', root).onchange = (e) => importArchiveFiles([...e.target.files]);

    // type chips
    root.querySelectorAll('#typeChips .chip').forEach((c) => {
      c.onclick = () => {
        c.classList.toggle('on');
        if (c.dataset.type) Settings.types[c.dataset.type] = c.classList.contains('on');
        if (c.dataset.kind === 'like') Settings.deleteLikes = c.classList.contains('on');
        // keep the tweet master-gate in sync with the per-type chips
        Settings.deleteTweets = Object.values(Settings.types).some(Boolean);
        saveSettingsOnly();
      };
    });

    const bind = (id, key, ev = 'input', transform = (v) => v) => {
      const el = $('#' + id, root);
      if (!el) return;
      el.addEventListener(ev, () => { Settings[key] = transform(el.type === 'checkbox' ? el.checked : el.value); saveSettingsOnly(); });
    };
    bind('dateFrom', 'dateFrom');
    bind('dateTo', 'dateTo');
    bind('keyword', 'keyword');
    bind('useRegex', 'useRegex', 'change');
    bind('keepAbove', 'keepAboveLikes');
    bind('mediaFilter', 'mediaFilter', 'change');
    bind('protectPinned', 'protectPinned', 'change');
    bind('protectIds', 'protectIds');

    $('#delay', root).addEventListener('input', (e) => {
      Settings.delayMs = parseInt(e.target.value, 10);
      $('#delayVal', root).textContent = (Settings.delayMs / 1000).toFixed(1) + 's';
      saveSettingsOnly();
    });

    $('#applyBtn', root).onclick = () => applyFilters();
    $('#backupBtn', root).onclick = () => downloadBackup();
    $('#archiveBtn', root).onclick = () => downloadArchiveHTML();

    $('#startBtn', root).onclick = () => {
      const matched = applyFilters();
      if (!matched.length) { logLine('No items match your filters.', 'warn'); return; }
      const ok = confirm(
        `XtraClean will permanently delete ${matched.length} item(s) from @${State.handle || 'your account'}.\n\nThis cannot be undone. Continue?`
      );
      if (ok) runQueue(false);
    };
    $('#pauseBtn', root).onclick = () => {
      if (State.status === 'paused' && State.queue.length) { State.pauseUntil = 0; runQueue(true); }
      else pauseRun();
    };
    $('#stopBtn', root).onclick = () => { if (confirm('Stop and clear this deletion job?')) stopRun(); };

    // tabs
    root.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => switchView(b.dataset.view); });

    // quick actions
    root.querySelectorAll('#qa button').forEach((b) => { b.onclick = () => applyPreset(b.dataset.preset); });

    // auto-clean controls
    $('#acEnabled', root).addEventListener('change', (e) => {
      Settings.autoClean.enabled = e.target.checked;
      saveSettingsOnly(); renderAutoClean();
      toast(e.target.checked ? 'Auto-Clean is ON — I’ll sweep when you open X.' : 'Auto-Clean turned off.', e.target.checked ? 'ok' : 'info');
    });
    root.querySelectorAll('#acAge .chip').forEach((c) => {
      c.onclick = () => { root.querySelectorAll('#acAge .chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); Settings.autoClean.maxAgeDays = parseInt(c.dataset.days, 10); saveSettingsOnly(); renderAutoClean(); };
    });
    root.querySelectorAll('#acTypes .chip').forEach((c) => {
      c.onclick = () => { c.classList.toggle('on'); Settings.autoClean[c.dataset.ac] = c.classList.contains('on'); saveSettingsOnly(); };
    });
    $('#acKeepAbove', root).addEventListener('input', (e) => { Settings.autoClean.keepAboveLikes = e.target.value; saveSettingsOnly(); });
    $('#acEvery', root).addEventListener('change', (e) => { Settings.autoClean.everyHours = parseInt(e.target.value, 10); saveSettingsOnly(); });
    $('#acRunNow', root).onclick = () => runAutoClean({ silent: false, navigate: true });

    // DM controls
    $('#dmScanBtn', root).onclick = async () => {
      State.dmConvs = State.dmConvs || []; State.dmSelected = State.dmSelected || new Set();
      toast('Scanning your inbox…');
      try {
        State.dmConvs = await dmScanAll((n) => { const el = $('#dmCount', root); if (el) el.textContent = fmt(n); });
        renderDM();
        toast(`Found ${State.dmConvs.length} conversation(s).`, 'ok');
      } catch (e) {
        toast(e.message === 'NO_AUTH' ? 'Log in to X first.' : 'Inbox scan failed (' + e.message + ').', 'err');
      }
    };
    $('#dmStopBtn', root).onclick = () => { State.abort = true; };
    $('#dmAll', root).onclick = () => { State.dmSelected = new Set((State.dmConvs || []).map((c) => c.id)); renderDM(); };
    $('#dmNone', root).onclick = () => { State.dmSelected = new Set(); renderDM(); };
    $('#dmDelete', root).onclick = () => dmDeleteSelected();

    // Triage controls
    $('#triageRun', root).onclick = () => runTriage();
    $('#thresh', root).addEventListener('input', (e) => { State.triage.threshold = parseInt(e.target.value, 10); $('#thVal', root).textContent = State.triage.threshold; renderTriage(); });
    $('#triageAll', root).onclick = () => {
      const shown = State.triage.results.filter((r) => r.score >= State.triage.threshold);
      shown.forEach((r) => State.triage.sel.add(r.it.id));
      renderTriage();
    };
    $('#triageDelete', root).onclick = () => triageDeleteSelected();
    $('#triageAI', root).onclick = async () => {
      if (!State.triage.results.length) { toast('Analyze first.', 'warn'); return; }
      State.abort = false;
      const top = State.triage.results.slice(0, 50);
      const ok = await aiRefine(top, (i, n) => { const b = $('#triageAI', root); if (b) b.textContent = `🧠 ${i}/${n}`; });
      const b = $('#triageAI', root); if (b) b.textContent = '🧠 AI';
      if (ok) { toast('AI deep-scan complete.', 'ok'); renderTriage(); }
    };

    // Footprint controls
    $('#fpBookmarks', root).onclick = () => clearBookmarks();
    $('#fpMutes', root).onclick = () => wipeUsers('mutes/users', 'mutes');
    $('#fpBlocks', root).onclick = () => wipeUsers('blocks', 'blocks');
    $('#fpStop', root).onclick = () => { State.abort = true; toast('Stopping…', 'warn'); };
    $('#fpReport', root).onclick = () => downloadWipeReport();
  }

  function switchView(name) {
    root.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
    root.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'view-' + name));
    if (name === 'auto') renderAutoClean();
    if (name === 'dm') renderDM();
    if (name === 'triage') renderTriage();
    if (name === 'fp') renderFootprint();
  }

  function renderFootprint() {
    if (!root) return;
    const el = $('#fpStatus', root); if (!el) return;
    const f = State.footprint || {};
    const bits = [];
    if (f.bookmarks) bits.push(`Bookmarks: ${f.bookmarks}`);
    if (f.mutes) bits.push(`Unmuted: ${fmt(f.mutes)}`);
    if (f.blocks) bits.push(`Unblocked: ${fmt(f.blocks)}`);
    el.innerHTML = bits.length ? 'Cleared this session — ' + bits.join(' · ') : '';
  }

  function scrollToSection(id) {
    switchView('clean');
    const el = $('#' + id, root);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function syncSettingsToUI() {
    const set = (id, v) => { const el = $('#' + id, root); if (el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };
    set('dateFrom', Settings.dateFrom); set('dateTo', Settings.dateTo);
    set('keyword', Settings.keyword); set('useRegex', Settings.useRegex);
    set('keepAbove', Settings.keepAboveLikes); set('mediaFilter', Settings.mediaFilter);
    set('protectPinned', Settings.protectPinned); set('protectIds', Settings.protectIds);
    set('delay', Settings.delayMs);
    $('#delayVal', root).textContent = (Settings.delayMs / 1000).toFixed(1) + 's';
    root.querySelectorAll('#typeChips .chip').forEach((c) => {
      if (c.dataset.type) c.classList.toggle('on', !!Settings.types[c.dataset.type]);
      if (c.dataset.kind === 'like') c.classList.toggle('on', Settings.deleteLikes);
    });
    renderAutoClean();
    renderOnboard();
  }

  // --- renderers -------------------------------------------------------------
  function renderPool() {
    if (!root) return;
    const el = $('#poolLine', root);
    if (el) el.innerHTML = State.items.length
      ? `Pool: <b style="color:#e6edf3">${fmt(State.items.length)}</b> item(s) collected.`
      : '';
  }
  function renderPreview(matched) {
    if (!root) return;
    $('#matchN', root).textContent = fmt(matched.length);
    $('#matchBig', root).textContent = fmt(matched.length);
    const s = $('#sample', root);
    s.innerHTML = matched.slice(0, 40).map((i) => {
      const d = i.time ? new Date(i.time).toLocaleDateString() : '—';
      const tag = i.kind === 'like' ? '♥ like' : i.type;
      const txt = (i.text || '(no text)').replace(/\n/g, ' ').slice(0, 60);
      return `<div>· [${tag}] ${d} — ${escapeHtml(txt)}</div>`;
    }).join('') + (matched.length > 40 ? `<div>…and ${fmt(matched.length - 40)} more</div>` : '');
  }
  function renderRun(msg) {
    if (!root) return;
    const p = State.progress;
    const totalForBar = p.total || (p.done + State.queue.length) || 1;
    const pct = clamp(((p.done + p.failed) / totalForBar) * 100, 0, 100);
    $('#bar', root).style.width = pct + '%';
    $('#sDone', root).textContent = fmt(p.done);
    $('#sLeft', root).textContent = fmt(State.queue.length);
    $('#sFail', root).textContent = fmt(p.failed);
    $('#sEta', root).textContent = etaText();
    const running = State.status === 'running';
    const paused = State.status === 'paused';
    $('#startBtn', root).disabled = running || paused;
    $('#pauseBtn', root).disabled = !(running || (paused && State.queue.length));
    $('#pauseBtn', root).textContent = paused ? 'Resume' : 'Pause';
    $('#stopBtn', root).disabled = !(running || paused);
    const rb = $('#runbar', root);
    if (msg) rb.textContent = msg;
    else if (State.status === 'done') rb.textContent = '✓ Finished.';
    else if (paused) rb.textContent = '⏸ Paused — press Resume to continue.';
    else rb.textContent = '';
  }
  function renderLog() {
    if (!root) return;
    const el = $('#log', root);
    if (el) el.innerHTML = State.log.slice(0, 60).map((l) => `<div class="${l.kind}">${l.t} ${escapeHtml(l.msg)}</div>`).join('');
  }
  function etaText() {
    const p = State.progress;
    if (State.status !== 'running' || !p.startedAt || p.done === 0) return '–';
    const elapsed = nowSec() - p.startedAt;
    const rate = p.done / Math.max(elapsed, 1); // per sec
    if (rate <= 0) return '–';
    const secLeft = Math.round(State.queue.length / rate);
    if (secLeft > 3600) return Math.round(secLeft / 3600) + 'h';
    if (secLeft > 60) return Math.round(secLeft / 60) + 'm';
    return secLeft + 's';
  }
  function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderAutoClean() {
    if (!root) return;
    const ac = Settings.autoClean;
    const en = $('#acEnabled', root); if (en) en.checked = ac.enabled;
    const st = $('#acStatus', root);
    if (st) st.innerHTML = `<span class="statusdot ${ac.enabled ? 'on' : ''}"></span>${ac.enabled ? `On — removing anything older than ${ac.maxAgeDays} days` : 'Off'}`;
    root.querySelectorAll('#acAge .chip').forEach((c) => c.classList.toggle('on', parseInt(c.dataset.days, 10) === ac.maxAgeDays));
    root.querySelectorAll('#acTypes .chip').forEach((c) => c.classList.toggle('on', !!ac[c.dataset.ac]));
    const ka = $('#acKeepAbove', root); if (ka) ka.value = ac.keepAboveLikes || '';
    const ev = $('#acEvery', root); if (ev) ev.value = String(ac.everyHours || 24);
    const last = $('#acLast', root);
    if (last) last.textContent = Settings.lastAutoRun ? `Last sweep: ${new Date(Settings.lastAutoRun * 1000).toLocaleString()}` : 'No sweeps yet.';
  }

  function renderDM() {
    if (!root) return;
    const list = $('#dmList', root);
    const convs = State.dmConvs || [];
    const sel = State.dmSelected || new Set();
    const cnt = $('#dmCount', root); if (cnt) cnt.textContent = fmt(convs.length);
    if (!list) return;
    if (!convs.length) {
      list.innerHTML = '<div class="hint" style="padding:12px;">No conversations yet — hit “Scan my inbox”.</div>';
    } else {
      list.innerHTML = convs.map((c) => {
        const d = c.time ? new Date(c.time).toLocaleDateString() : '';
        return `<label class="dmrow"><input type="checkbox" data-id="${escapeHtml(c.id)}" ${sel.has(c.id) ? 'checked' : ''}><span class="nm">${escapeHtml(c.label)}</span><span class="dt">${d}</span></label>`;
      }).join('');
      list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        cb.onchange = () => { if (cb.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id); State.dmSelected = sel; updateDmDeleteBtn(); };
      });
    }
    State.dmSelected = sel;
    updateDmDeleteBtn();
  }

  function updateDmDeleteBtn() {
    const btn = $('#dmDelete', root); if (!btn) return;
    const n = (State.dmSelected || new Set()).size;
    btn.disabled = !n;
    btn.textContent = n ? `Delete ${n} conversation(s)` : 'Delete selected';
  }

  function scoreColor(s) {
    if (s >= 70) return '#dc2626';
    if (s >= 45) return '#d97706';
    if (s >= 25) return '#ca8a04';
    return '#4b5563';
  }
  function renderTriage() {
    if (!root) return;
    const list = $('#triageList', root); if (!list) return;
    const results = State.triage.results || [];
    const sel = State.triage.sel || (State.triage.sel = new Set());
    const th = State.triage.threshold;
    const shown = results.filter((r) => r.score >= th);
    if (!results.length) {
      list.innerHTML = '<div class="hint" style="padding:12px;">No analysis yet — hit “Analyze my posts”.</div>';
    } else if (!shown.length) {
      list.innerHTML = `<div class="hint" style="padding:12px;">Nothing scores ≥ ${th}. Lower the threshold, or your posts look clean ✨</div>`;
    } else {
      list.innerHTML = shown.slice(0, 300).map((r) => {
        const d = r.it.time ? new Date(r.it.time).toLocaleDateString() : '';
        const txt = escapeHtml((r.it.text || '(no text)').replace(/\n/g, ' ').slice(0, 180));
        const why = r.reasons.map((x) => `<span>${escapeHtml(x)}</span>`).join('');
        return `<label class="trow"><input type="checkbox" data-id="${escapeHtml(r.it.id)}" ${sel.has(r.it.id) ? 'checked' : ''}>
          <div class="sbadge" style="background:${scoreColor(r.score)}">${r.score}</div>
          <div class="body"><div class="txt">${txt}</div><div class="why">${why}${d ? `<span>${d}</span>` : ''}${r.ai ? '<span style="color:#c4b5fd">AI</span>' : ''}</div></div></label>`;
      }).join('') + (shown.length > 300 ? `<div class="hint" style="padding:8px 10px;">Showing first 300 of ${fmt(shown.length)}.</div>` : '');
      list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        cb.onchange = () => { if (cb.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id); updateTriageBtn(); };
      });
    }
    updateTriageBtn();
  }
  function updateTriageBtn() {
    const btn = $('#triageDelete', root); if (!btn) return;
    const n = (State.triage.sel || new Set()).size;
    btn.disabled = !n;
    btn.textContent = n ? `Delete ${n} selected post(s)` : 'Delete selected';
  }

  function renderOnboard() {
    if (!root) return;
    const el = $('#onboard', root); if (!el) return;
    if (Settings.onboarded) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="ob"><h3>👋 Wipe your X — safely, privately, free.</h3>
      <p>1. Open your <b>Profile</b> or <b>Likes</b> page on X.<br>2. Tap a <b>Quick action</b> below — or set your own filters.<br>3. <b>Back up</b>, preview, then delete. Nothing ever leaves your device.</p>
      <button class="btn primary" id="obDone" style="margin-top:9px;">Got it — let’s go</button></div>`;
    const done = el.querySelector('#obDone');
    if (done) done.addEventListener('click', () => { Settings.onboarded = true; saveSettingsOnly(); renderOnboard(); });
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    $('.panel', root).classList.toggle('hidden', !panelOpen);
    if (panelOpen) {
      State.handle = detectHandle();
      $('#acct', root).innerHTML = State.handle ? `@${State.handle}` : 'No profile detected — open your profile';
    }
  }

  // ===========================================================================
  // BOOT
  // ===========================================================================
  async function boot() {
    try {
      buildUI();
    } catch (e) {
      console.error('[XtraClean] Failed to build UI:', e);
      return;
    }
    State.handle = detectHandle();
    State.dmConvs = [];
    State.dmSelected = new Set();
    State.triage = { results: [], sel: new Set(), threshold: 40 };
    State.footprint = {};
    // light up the AI badge if Chrome's on-device model is present
    getAIModel().then((lm) => {
      if (lm && root) { const b = $('#aiBadge', root); if (b) { b.textContent = 'AI ready'; const p = $('.panel', root); if (p) p.classList.add('ai-on'); } }
    }).catch(() => {});
    let resumable = false;
    try { resumable = await loadPersisted(); } catch (e) { console.warn('[XtraClean] loadPersisted failed:', e); }
    syncSettingsToUI();
    if (resumable) {
      togglePanel();
      logLine(`Resumable job found: ${fmt(State.queue.length)} item(s) left. Press Resume.`, 'warn');
      renderRun('⏸ Resume your previous job');
    }

    // Background alarm can ask us to run an Auto-Clean sweep.
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === 'XC_AUTOCLEAN_RUN' && autoCleanDue()) runAutoClean({ silent: true });
      });
    } catch (e) {}

    // Auto-Clean: run a sweep if a rule is enabled, due, and we're on the profile.
    setTimeout(async () => {
      if (State.status === 'running') return;
      const flagged = sessionStorage.getItem('xc_autorun');
      if (flagged) { sessionStorage.removeItem('xc_autorun'); if (isOwnProfilePage()) { runAutoClean({ silent: true }); return; } }
      if (Settings.autoClean.enabled && autoCleanDue() && isOwnProfilePage()) {
        runAutoClean({ silent: true });
      }
    }, 3500);
  }
  boot().catch((e) => console.error('[XtraClean] boot error:', e));
})();
