# Chrome Web Store — Listing Copy & Submission Answers

Copy/paste these into the Developer Dashboard fields.

---

## Name
XtraClean — Bulk Delete X / Twitter Activity

## Summary (132 chars max)
Privately bulk-delete your X/Twitter posts, replies, reposts, likes & DMs. 100% local — your data never leaves your browser. Free.

## Category
Productivity (alt: Social & Communication)

## Description
Take back control of your X/Twitter history. XtraClean bulk-deletes your posts,
replies, reposts, likes, and DM conversations — privately, completely, and for free.

Unlike subscription web tools, XtraClean runs entirely inside your own logged-in
browser session. Your data never touches a server (there isn't one). It does
exactly what you'd do by hand — click "Delete" — just thousands of times, with
smart filters and rate-limit handling.

★ One-tap Quick Actions — "Delete all posts," "Unlike everything," "Older than 30
days," or "Wipe everything."
★ Powerful filters — date range, keyword/regex, type (post/reply/repost/quote),
media, and "keep anything with ≥ N likes."
★ Auto-Clean — set a rule once ("delete anything older than 30 days") and it runs
automatically.
★ Direct Messages — scan your inbox and wipe whole conversations.
★ Back up before you delete — export matched items to JSON in one click.
★ Beats the 3,200 limit — import your official X archive for a complete wipe.
★ Smart & resilient — auto-pauses on rate limits, resumes after reloads, and only
counts a deletion when X actually confirms it.

100% local. No account. No servers. No subscription. Free and open.

Not affiliated with or endorsed by X Corp.

---

## Single purpose (required field)
XtraClean has one purpose: to let a user bulk-delete their own activity (posts,
replies, reposts, likes, and DM conversations) on X / Twitter, from within their
own browser session.

## Permission justifications (required, per item)
- **storage**: Persist the user's filter settings and Auto-Clean rules, and save
  deletion-job progress locally so large jobs can resume after a page reload.
- **alarms**: Schedule the optional Auto-Clean feature to run on an interval.
- **notifications**: Notify the user when a deletion job completes.
- **host permission — x.com / twitter.com**: Required to read the user's own
  timeline and call X's delete/unrepost/unlike endpoints within the user's
  authenticated session. This is the core function.
- **host permission — abs.twimg.com**: Read X's public JavaScript bundle to
  resolve X's current API operation identifiers (which X rotates). Data is only
  read, never executed.
- **host permission — christopherlaughlin.github.io**: Fetch a tiny public
  configuration file (the current API operation identifiers) so the extension
  keeps working when X changes its endpoints — no reinstall needed. Only a small
  static JSON is read; no user data is ever sent.

## Data usage disclosures (check these in the dashboard)
- Does your item collect user data? **No.**
- The extension does not transmit any user data off the device.
- It does not sell or transfer user data; no use for creditworthiness/lending.
- Certify compliance with the Developer Program Policies: **Yes.**

## Privacy policy URL
Host PRIVACY.md somewhere public and paste the URL here. Easiest options:
- A GitHub repo → enable GitHub Pages, or link the raw PRIVACY.md.
- A public GitHub Gist.

---

## Assets checklist
- [x] Store icon 128×128 (icons/icon128.png)
- [ ] At least 1 screenshot, 1280×800 or 640×400 (PNG/JPEG)
- [ ] (Optional) Small promo tile 440×280
- [ ] Privacy policy hosted at a public URL

## ⚠️ Review notes / risks to expect
- Tools that automate another website can draw extra review scrutiny. Keep the
  single-purpose description tight and the permission justifications specific.
- Automating X may conflict with **X's Terms of Service** (separate from Chrome's
  policies). X could file a complaint that leads to takedown. This is a real risk
  for any tool in this category, including the paid ones.
- If a reviewer flags the broad host permission, the justifications above are your
  answer: the host access IS the product.
