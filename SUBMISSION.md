# XtraClean — Chrome Web Store submission checklist

Everything that can be prepared ahead of time is done and lives in this repo.
The remaining steps require your Google account / payment, so only you can do them.

## Assets (ready, in `dist/`)
- **Extension package:** `dist/xtraclean-v1.1.3.zip` ← upload this
- **Store icon (128×128):** `dist/store-assets/icon128.png`
- **Screenshots (1280×800):**
  - `dist/store-assets/screenshot-clean.png`
  - `dist/store-assets/screenshot-auto.png`
  - `dist/store-assets/screenshot-dm.png`
- **Small promo tile (440×280):** `dist/store-assets/promo-tile-440x280.png`
- **Privacy policy page:** `docs/privacy.html` (host it — see below)
- **Listing copy & permission justifications:** `STORE_LISTING.md`

## Steps only you can do
1. **Host the privacy policy.** Push this repo to GitHub → Settings → Pages →
   deploy from `/docs`. Your URL becomes
   `https://<user>.github.io/<repo>/privacy.html`. (Or paste `docs/privacy.html`
   into a public Gist / any web host.)
2. **Register** at https://chrome.google.com/webstore/devconsole — pay the one-time
   **$5** fee and complete identity verification.
3. **Add new item** → upload `dist/xtraclean-v1.1.3.zip`.
4. **Fill the listing** using `STORE_LISTING.md` (name, summary, description,
   category). Upload the 3 screenshots + promo tile + icon.
5. **Privacy tab** → paste your hosted privacy URL, set the single-purpose text,
   add each permission justification, and complete the data-use disclosures
   (answer: does NOT collect user data). Certify policy compliance.
6. **Submit for review.** Expect a few days; tools that automate another site can
   take longer or get follow-up questions — the justifications cover the common ones.

## To rebuild the package after any code change
```
./build.sh          # regenerates dist/xtraclean-v<version>.zip
```

## Reminder
Automating X may conflict with X's own Terms of Service (independent of Chrome's
policies). Listing publicly invites a possible complaint/takedown — true for every
tool in this category. Distributing the zip via GitHub for "load unpacked" avoids
store review entirely if you prefer to stay low-profile.
