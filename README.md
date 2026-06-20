<div align="center">

# 🧹 XtraClean

### Bulk-delete your X / Twitter activity — privately, completely, for free.

Delete your **posts, replies, reposts, quotes, likes, and DMs** in bulk, straight
from your own browser. **Nothing ever leaves your machine** — no account, no
servers, no subscription, no API key.

**[⬇ Download the latest release](../../releases/latest)** · **[🌐 Website](https://USER.github.io/REPO/)** · **[🔒 Privacy](https://USER.github.io/REPO/privacy.html)**

</div>

---

## Why XtraClean

Every other tool either charges $7–$94/month, makes you grant a third party
write-access to your account, or quietly stops at Twitter's 3,200-tweet limit.
XtraClean is a browser extension that runs entirely inside *your* logged-in
x.com session — it does exactly what you'd do by hand (click "Delete"), just in
bulk and intelligently. See [RESEARCH.md](RESEARCH.md) for the full competitive
breakdown.

| | Typical SaaS deleters | **XtraClean** |
|---|---|---|
| Price | $7–$94 / month | **Free** |
| Your data | Uploaded to their cloud / OAuth grant | **Stays in your browser** |
| Completeness | Often capped at 3,200 | **Everything** (live scan + archive import) |
| Undo safety | Usually none | **One-click backup before deleting** |
| Rate limits | Job stalls / fails | **Auto-pause + auto-resume, survives reloads** |
| Trust | Trust the vendor | **Only ever talks to x.com** |

---

## Features

- **⚡ Quick Actions** — one tap for the jobs everyone wants: *Delete all posts*,
  *Delete all replies*, *Unlike everything*, *Older than 1 year / 30 days*, or the
  big red **Wipe EVERYTHING**. Each sets the filters and jumps you to preview.
- **🤖 Auto-Clean (set & forget)** — define a rule once ("delete anything older
  than 30 days") and XtraClean enforces it automatically whenever you open X,
  with a daily background reminder so nothing piles up. Choses types, age, and a
  "keep anything with ≥ N likes" safety net.
- **✉️ Direct Messages** — scan your whole inbox and wipe entire conversations
  in bulk (one-to-one *and* group DMs).
- **Two ways to find content**
  - **Scan this page** — auto-scrolls your Profile / Replies / Likes and collects
    everything visible. No download needed.
  - **Import archive** — drop your official `tweets.js` / `like.js` to reach
    **every post you've ever made**, past the 3,200 limit.
- **Powerful filters** — date range, keyword or **regex**, type
  (post / reply / repost / quote / like), media (only / none), and engagement
  (*keep anything with ≥ N likes*).
- **Protect rules** — never touch your **pinned** post or a list of specific IDs.
- **Dry-run preview** — see the exact count and a sample before anything happens.
- **Backup before you burn** — export matched items to JSON in one click (solves
  the "I accidentally deleted my memories" problem).
- **Smart rate-limit engine** — reads X's `x-rate-limit-reset`, auto-pauses with
  a countdown, and resumes on its own.
- **Resumable** — big jobs checkpoint to local storage and survive page reloads
  and browser restarts.
- **Live dashboard** — deleted / remaining / failed counts, progress bar, ETA,
  and an activity log.

---

## Install (Chrome / Edge / Brave / Arc — any Chromium browser)

1. Download / clone this folder.
2. Go to `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the `XtraClean` folder.
5. Pin the **XtraClean** icon to your toolbar (optional).

> Firefox: it's MV3-compatible; load via `about:debugging` → *This Firefox* →
> *Load Temporary Add-on* → pick `manifest.json`.

---

## How to use

1. Go to **[x.com](https://x.com)** and make sure you're logged in.
2. Open the page with what you want to clean:
   - Your **Profile** → *Posts* or *Replies* tab, or
   - Your **Likes** page (`x.com/<you>/likes`).
3. Click the **broom button** (bottom-right) to open the panel.
4. **What to clean:** click **Scan this page** *(or* **Import archive** *and drop
   your `tweets.js` / `like.js`)*.
5. **Filters:** pick types, dates, keywords, protections.
6. **Preview:** click *Apply filters & preview*. Optionally **back up** to JSON.
7. **Delete:** set the speed, hit **Start deleting**, confirm. Walk away — it
   auto-handles rate limits and resumes itself.

### The three tabs

- **Clean** — Quick Actions + manual filters for one-off bulk deletes.
- **Auto-Clean** — flip it on, pick "older than N days," choose what it applies
  to. It runs on its own whenever you're on X (open your profile to let it
  sweep), at most once per your chosen interval.
- **DMs** — *Scan my inbox* → select conversations (or *Select all*) → *Delete*.

### Getting your X archive (for a complete wipe)
On X: **Settings → Your account → Download an archive of your data**. X emails a
link (can take a day). Unzip it; inside the `data/` folder you'll find
`tweets.js` and `like.js` (and possibly `tweets-part1.js`, etc.). Drop those
into XtraClean's **Import archive**.

---

## Privacy

- **No backend.** There is no XtraClean server. There is nothing to log or leak.
- **No third-party auth.** It uses your existing x.com session cookies, exactly
  like the X website does. You never paste a password or grant OAuth.
- **The only network requests** XtraClean makes are to **x.com** (the same
  `DeleteTweet` / `UnfavoriteTweet` calls the site makes when you click Delete).
- **Local only.** Settings and resume-state are stored with the browser's
  extension storage on your device.

---

## How it works (technical)

XtraClean calls X's own internal GraphQL mutations in your authenticated session:

- `DeleteTweet` — removes posts, replies, reposts, and quotes (anything you authored).
- `UnfavoriteTweet` — removes likes.

Auth uses the public web **bearer token** plus your **`ct0`** cookie sent as
`x-csrf-token` — the standard X web-app pattern. Content is enumerated either by
scraping the rendered timeline (live scan) or by parsing your data archive
(`window.YTD.tweets.part0 = [...]`). The queue runner respects
`x-rate-limit-remaining` / `x-rate-limit-reset`, backs off on `429`, treats `404`
as already-deleted, and checkpoints progress so it can resume.

---

## Notes & limits

- **Deletion is permanent.** X cannot undo it. Use the backup button if unsure.
- X's deletion rate limits mean very large accounts can take hours or days — but
  XtraClean runs unattended and resumes itself, so just leave the tab open.
- XtraClean depends on X's current web endpoints. If X changes them, the GraphQL
  query IDs in `src/content.js` (`QUERY`) may need updating.
- This is an independent tool, not affiliated with or endorsed by X Corp.

## License

MIT — free to use, modify, and share.
