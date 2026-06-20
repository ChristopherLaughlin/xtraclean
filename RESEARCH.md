# Deep Research: X / Twitter Activity Deleter Apps (2026)

This is the competitive research that XtraClean is built on top of. The goal:
understand what the best deletion tools do, where they fall short, and how to be
dramatically better.

---

## 1. The landscape

| Tool | Model | Price (2026) | How it works | Notable |
|------|-------|--------------|--------------|---------|
| **Redact.dev** | Desktop + mobile app | Free tier (X/Reddit/Discord/FB); Premium/Ultimate paid | Logs into your accounts, mass-deletes across 25+ platforms | Preview mode, local archive, biggest scope (324M+ tweets deleted) |
| **TweetDelete.net** | Web (OAuth) | $6.99–$19.99/mo | Twitter API + archive upload | Strong **scheduled auto-delete** ("delete anything older than 30 days") |
| **TweetDeleter.com** | Web (OAuth) | Tiered subscription | API + archive | "Official X partner", advanced search |
| **TweetEraser.com** | Web (OAuth) | $6.99–$9.99/mo | API + archive upload | Good filters (age, type, word, source), auto-delete |
| **Circleboom** | Web (OAuth) | Free daily + $17–$94/mo | API + archive upload | Archive cleanup beyond the 3,200 cap; uses official OAuth |
| **TweetXer / DeleteTweets (OSS)** | Userscript / console | Free | Browser **GraphQL** in your own session | No server, no OAuth grant; technical to run |
| **Various Chrome extensions** | Extension | Free/freemium | DOM clicking or GraphQL | Quality varies wildly; many abandoned |

### Common feature set of the "best" tools
- Delete **posts, replies, reposts, quotes, likes** (some also DMs).
- **Filters**: date range, keyword/hashtag, tweet type, media, engagement count.
- **Protect** rules: pinned, sponsored, specific IDs, popular tweets.
- **Preview / dry-run** before deleting.
- **Archive upload** to get past Twitter's 3,200-tweet retrieval limit.
- **Scheduled / continuous auto-delete** (delete anything older than N days).
- **Local backup / archiver** of deleted content (Redact).

---

## 2. The hard technical constraints (what every tool must deal with)

1. **The 3,200-tweet API ceiling.** Twitter's timeline API only returns your
   most recent ~3,200 tweets. To delete *everything* you must feed the tool your
   official **data archive** (`tweets.js`, `like.js`), which lists every ID.
2. **The X API is now paid & write-restricted.** Since 2023 the free tier lost
   write access; the Basic tier is ~$100/mo. This is why SaaS tools charge
   subscriptions — they're paying X, or working around it.
3. **Rate limits.** Deleting through the web app is throttled (~50 actions per
   15–30 min windows; `429` responses with `x-rate-limit-reset`). Big accounts
   take days; tools must pause/resume and respect the reset headers.
4. **The web GraphQL endpoints.** The X web app itself deletes via
   `DeleteTweet` and `UnfavoriteTweet` GraphQL mutations, authenticated with the
   public web **bearer token** + the **`ct0` cookie** (sent as `x-csrf-token`).
   Running these *in your own logged-in session* needs **no API key and no
   third-party OAuth grant** — this is the key unlock.

---

## 3. What users actually complain about (the gaps to beat)

From reviews (Trustpilot, Reddit, product blogs):

- **💸 Subscriptions for a one-time job.** People want to wipe their account
  *once* but are forced into $7–$94/month plans.
- **🔓 Privacy fear.** Granting a third-party app write-access via OAuth, or
  *uploading your archive to someone's cloud*, makes people nervous — and rightly
  so (tools store OAuth tokens, logs, tweet IDs, timestamps server-side).
- **🐞 Incomplete deletions.** Repeated reports of "no more tweets to delete"
  while thousands remain; the 3,200 limit silently capping free tiers.
- **↩️ No undo / lost memories.** Tools don't keep a copy, so people accidentally
  erase sentimental posts with no recovery.
- **🐌 Slow + opaque.** Long jobs with little feedback; unclear rate-limit waits.
- **🙅 Support & billing problems.** Refund issues, slow/no support.

---

## 4. How XtraClean is 100× better

XtraClean is a **browser extension** that runs entirely inside your own logged-in
x.com session. It turns every one of the gaps above into a feature:

| Pain point in existing tools | XtraClean |
|------------------------------|-----------|
| 💸 $7–$94/month subscriptions | **Free.** No account, no paywall, no tiers. |
| 🔓 Upload archive to a cloud / OAuth grant | **100% local.** Nothing ever leaves your browser. No server exists to leak. Uses *your* session, like clicking Delete yourself — just in bulk. |
| 🐞 Silent 3,200-tweet cap | **Two complete sources:** live auto-scroll scan *and* full **archive import** (`tweets.js` / `like.js`) to reach **every** post ever. |
| ↩️ No undo, lost memories | **One-click JSON backup** of exactly what's about to be deleted, before you delete it. |
| 🐌 Opaque, gets stuck on rate limits | **Adaptive rate-limit engine:** reads `x-rate-limit-reset`, auto-pauses with a live countdown, and **auto-resumes**. Jobs **survive reloads** (checkpointed to local storage). |
| 🎛️ Basic filters | Filter by **date range, keyword/regex, type** (post/reply/repost/quote/like), **media**, and **engagement** ("keep anything with ≥ N likes"). **Protect** pinned + specific IDs. |
| 🤷 Trust the vendor | Open code you can read. The only network calls are to **x.com itself**. |

### The unfair advantages
1. **Zero trust required** — there is no backend, so there's nothing to log,
   breach, or monetize. The single best privacy posture possible.
2. **Free forever** — no API costs because it uses the web app's own endpoints in
   your session.
3. **Actually complete** — archive import defeats the 3,200 ceiling that quietly
   limits "free" competitors.
4. **Safe by default** — backup-before-delete + dry-run preview + protect rules +
   permanent-deletion confirmation.
5. **Resilient** — checkpoint/resume and rate-limit auto-handling mean a
   100k-tweet wipe just works, unattended, across days and browser restarts.

---

## 5. Sources

- [DeleteOldPosts — Best free bulk tweet deleter 2026](https://www.deleteoldposts.com/guide/bulk-tweet-deleter-free)
- [DeleteOldPosts — Twitter/X API changes 2024–2026](https://www.deleteoldposts.com/guide/twitter-api-changes-2026)
- [Redact — Twitter/X service](https://redact.dev/services/twitter) · [Features](https://redact.dev/features) · [Pricing](https://redact.dev/pricing)
- [TweetDelete — Auto delete tweets](https://tweetdelete.net/auto-delete-tweets/) · [FAQ](https://tweetdelete.net/faq/)
- [TweetEraser — FAQ](https://www.tweeteraser.com/faq/) · [Features](https://www.tweeteraser.com/features/mass-delete-tweets/)
- [Circleboom — Delete all tweets](https://circleboom.com/twitter-management-tool/delete-all-tweets) · [Archive cleanup](https://circleboom.com/twitter-management-tool/delete-old-tweets-archive)
- [TweetDeleter — Unlike tweets](https://tweetdeleter.com/features/unlike-tweets)
- [x-deleter — Delete 1,000+ tweets: rate limits & auto-resume](https://x-deleter.com/en/articles/delete-1000-tweets)
- [TweetDelete — Rate limit exceeded](https://tweetdelete.net/resources/twitter-rate-limit-exceeded/)
- [Delete My Tweets — Is TweetDelete safe? OAuth & server logs](https://www.deletemytweets.app/blog/is-tweet-delete-safe)
- [lucahammer/tweetXer (OSS reference)](https://github.com/lucahammer/tweetXer) · [McKenzieJDan/DeleteTweets](https://github.com/McKenzieJDan/DeleteTweets) · [Lyfhael/DeleteTweets](https://github.com/Lyfhael/DeleteTweets)
- [alkihis/twitter-archive-reader — archive file structures](https://github.com/alkihis/twitter-archive-reader/blob/master/Files_to_structures.md)
- [Twitter archive format explained](https://www.tweetarchivist.com/twitter-archive-format-explained)
