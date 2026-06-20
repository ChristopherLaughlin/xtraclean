# XtraClean — Privacy Policy

_Last updated: 2026-06-20_

XtraClean is a browser extension that helps you bulk-delete your own X / Twitter
posts, replies, reposts, likes, and direct-message conversations.

## The short version

**XtraClean does not collect, transmit, sell, or share any of your data.**
There is no XtraClean server. Everything runs locally, inside your own browser,
using your existing logged-in X session.

## What data XtraClean handles, and where it goes

- **Your X content and session** (posts, likes, DM list, and the session cookies
  your browser already holds for x.com) are read **only within your browser** to
  perform the deletions you request. This data is **never sent to us or any third
  party** — the only network requests XtraClean makes are to **x.com / twitter.com
  / abs.twimg.com**, i.e. X's own servers, which is exactly what the X website
  itself does when you click "Delete."
- **Your settings and job progress** (filters, Auto-Clean rules, resume state) are
  stored locally on your device via the browser's extension storage
  (`chrome.storage.local`). They never leave your machine.
- **Backups** you choose to export are written directly to your own computer's
  Downloads folder. They are not uploaded anywhere.

## What XtraClean does NOT do

- No analytics, no telemetry, no tracking, no advertising.
- No remote code execution.
- No accounts, no sign-up, no third-party OAuth grant.
- No transmission of your content to any server operated by XtraClean (none exists).

## Permissions, and why they're needed

- **storage** — save your settings and let long deletion jobs resume locally.
- **alarms** — schedule optional Auto-Clean sweeps.
- **notifications** — show a desktop notification when a job finishes.
- **Host access to x.com / twitter.com / abs.twimg.com** — required to read your
  timeline and call X's own delete endpoints in your session. No other sites are
  accessed.

## Data retention & deletion

XtraClean stores nothing remotely, so there is nothing for us to retain or delete.
To remove all local data, uninstall the extension (or clear its storage from your
browser's extension settings).

## Contact

For questions about this policy, open an issue on the project's repository.
