# Gully Scorer: project notes

Live scoring for gully and box cricket. One phone scores, everyone else watches live through a link or QR code. Free to run, no sign-up, privacy first.

Last updated: 16 Nov 2026

## Links

| What | Where |
|---|---|
| Live site (start a match here) | https://samuvelmaniraj.github.io/gully-scorer/ |
| Code | https://github.com/samuvelmaniraj/gully-scorer |
| Live relay (Cloudflare) | https://gully-relay.s-samuvelmaniraj.workers.dev |
| Cloudflare dashboard | dash.cloudflare.com → Workers & Pages → `gully-relay` |

## Goals and rules we set

- **Simple and fast for gully cricket.** Big tap buttons, works one-handed, starts in seconds.
- **No accounts, no database.** Nothing about players or matches is stored online for long.
- **Privacy is very important.** Scores are end-to-end encrypted; the relay can't read them.
- **Free to run.** GitHub Pages and Cloudflare free plans.
- Typical use: Quick score, 12 overs a side, 6 or 7 players a side, 4 to 5 matches a day.

## How it works

```
Scorer's phone ──encrypted + signed update──▶ Cloudflare relay ──▶ Viewers' phones
      ▲                                       (keeps only the latest
      └── page loaded from GitHub Pages         update, 12 hours)
```

- **The page** is one HTML file (`index.html`) on GitHub Pages. It loads only itself and `qrcode.min.js` from the same site, plus its app files (`manifest.webmanifest`, icons, `sw.js`).
- **Install as an app:** `sw.js` is a service worker that keeps a copy of the site's own files on the phone. It tries the network first (waits up to 3.5 s), then uses the saved copy, so new versions show up on the next open when online. It never touches relay traffic or any other site.
- **Each match** gets a random ID, a secret encryption key (AES-GCM) and a signing key pair (ECDSA P-256).
- **Watch link:** `…/#watch-<id>.<key>.<publicKey>`. Anyone with it can read the score. Browsers never send the `#` part to any server, so the relay never sees the key.
- **Handover link:** `…/#score-<id>.<key>.<publicKey>.<privateKey>`. Anyone with it can change the score; send it privately.
- **Every update is signed.** Viewers ignore anything not signed by the scorer, so a watch link can't be used to fake a score.
- **The relay** (`worker/relay.js`, a Cloudflare Worker with a Durable Object) keeps only the latest message per match. It pushes updates live over a WebSocket and deletes the match 12 hours after its last update. It only accepts requests from the Gully Scorer site, refuses anything that isn't a score message, and limits sending speed.
- **Ordering:** each update carries a version number (`v`) that counts up, so phone clocks don't matter.
- **Handover:** the new phone loads the latest state, then scores with a higher version. The old phone sees a newer version from another device and switches to watching.

## Features (all done)

**Scoring**
- Quick score (players a side) or Full scorecard (player lists, batters, bowlers, figures)
- 0–6 runs, Wd, Nb, Wicket + runs (run outs), Undo
- Run rate, target, required rate, innings break, result with balls left
- Strike rotation; One-side batting (single batter); Last man bats alone
- Toggles: wide gives 1 run, no-ball gives 1 run, one-tap wide and wicket (off by default), free hit (on by default)
- Coin toss with bat or bowl choice; Swap batting order

**Sharing**
- Watch link, QR code, WhatsApp button
- Scorer handover by QR, link or WhatsApp; it also passes the match settings
- Viewers keep the last score if the scorer goes away, and catch up when it's back
- Ball-by-ball commentary for viewers (both modes): latest first, grouped by over with an end-of-over summary (runs, score, bowler in Full, runs needed in a chase), free hits, milestones (batter 25/50, team 50s), innings and result lines, switch between innings, last 3 overs with "Show all". Built from the balls already in each update, so no format change. Not shown on the scorer's phone.
- Match end: TV-style summary image (1920×1080) with team bars, top 4 batters and bowlers (Full) or fours/sixes/extras/run rate (Quick), overs played / overs a side, team size, toss and result
- WhatsApp text table sent with the image; Send as text and Copy text

**Convenience**
- Remember last match settings on the phone (team names, players, overs, toggles); Clear and start fresh
- Install as an app on the home screen: icon, full screen, opens on weak signal. Android shows an "Install app" button (one tap, then confirm). iPhone can't do one-tap installs (Apple doesn't allow it), so it shows step-by-step instructions with icons for Safari or Chrome. Android falls back to menu steps if Chrome doesn't offer its install box. "Not now" hides the hint on that phone.
- Scorer's screen stays on during a match (screen wake lock)

## Main decisions and why

| Decision | Why |
|---|---|
| Single static page on GitHub Pages | Free, simple, nothing to maintain |
| PeerJS (phone to phone) → ntfy.sh relay → own Cloudflare relay | Phone to phone failed across different networks; ntfy.sh's free limit (~250 messages a day per sender) was too small for 4–5 twelve-over matches |
| End-to-end encryption, key in the link's `#` part | The relay and hosting never see scores or names |
| Signed updates | Viewers can't fake the score |
| QR library copied into the repo, pinned with an integrity hash | Page runs only our own code; no outside script server |
| Strict Content-Security-Policy in `index.html` | Blocks any script or connection not on the allow list |
| Settings saved on the phone only | Convenience without storing anything online |
| Network-first service worker, own files only | Opens at the ground on weak signal, updates still arrive straight away, relay traffic untouched |

## Accounts and secrets

- **GitHub repo** `samuvelmaniraj/gully-scorer`, public. Pages serves `main` from the root.
- **GitHub secrets** (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Values are never written anywhere else.
- **Cloudflare API token** "Gully Scorer": template "Edit Cloudflare Workers", own account only, **expires 13 Nov 2027**. The relay keeps running after expiry; a new token is only needed to deploy relay changes.
- **Cloudflare workers.dev subdomain:** `s-samuvelmaniraj.workers.dev`
- **Claude GitHub App:** installed for this repo only.

## How to change things

- **Edit the page:** change `src/gully-scorer.html`, then run `python3 tools/build.py` to make `index.html`. Commit both. Pages updates in about a minute.
  - The build is required: `index.html` pins the inline script by its hash, so an edited page without a rebuild won't run.
  - Installed phones get the new version the next time the app is opened with signal (the service worker checks the network first).
- **Edit the relay:** change `worker/relay.js` and push. GitHub Actions ("Deploy relay") deploys it, then checks send, latest, origin blocking and the live connection.
- **Tests:** `node tests/relay.test.mjs` (relay logic) and `node tests/e2e.js` (three simulated phones, needs Playwright).
- **Format changes:** if the link or message format changes, old match links stop working. Tell users to start a new match after updates.

## Known limits

- The scorer's page must stay open. If the phone sleeps or switches apps, viewers keep the last score until it's back.
- Cloudflare free plan: 100,000 requests a day (one 12-over match uses about 200).
- On some Android phones, WhatsApp drops the text when sharing an image. Use "Send as text" after.
- Anyone with the main site link can start their own match. They can't see or change other matches.

## Roadmap

**Planned next (ideas already in the plan)**
1. Player stats across matches (stored on the phone only, or on the relay, to decide)
2. Points table for a series or tournament (wins, losses, net run rate)

**Done:** Install as an app on the home screen; ball-by-ball commentary (16 Nov 2026)

**Optional, later**
- Custom domain (about US$10 a year)
- Reminder before the Cloudflare token expires (13 Nov 2027)

## Repo layout

```
index.html               built page that GitHub Pages serves (don't edit by hand)
qrcode.min.js            QR code library (qrcodejs 1.0.0, MIT), pinned by hash
qrcode.LICENSE.txt
manifest.webmanifest     app name, colours and icons for installing
sw.js                    service worker: keeps the app's own files on the phone
icon-*.png, apple-touch-icon.png   home-screen icons
src/gully-scorer.html    page source: edit this
tools/build.py           builds index.html with its security rules
tools/make_icons.py      draws the icons (needs Pillow)
worker/relay.js          Cloudflare relay
worker/wrangler.toml     relay config
.github/workflows/deploy-relay.yml   deploys and checks the relay
tests/relay.test.mjs     relay unit test
tests/e2e.js             end-to-end test with three simulated phones
docs/PROJECT_NOTES.md    this file
CLAUDE.md                short guide for Claude when working on this repo
_config.yml              tells Pages to publish only the app
```
