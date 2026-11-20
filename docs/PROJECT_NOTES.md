# TurfCricScore (formerly Gully Scorer): project notes

Live scoring for gully and box cricket. One phone scores, everyone else watches live through a link or QR code. Free to run, no sign-up, privacy first.

Last updated: 21 Nov 2026

## Links

| What | Where |
|---|---|
| Live site (start a match here) | https://turfcricscore.com (old address https://samuvelmaniraj.github.io/gully-scorer/ redirects there once the custom domain is on) |
| Domain | `turfcricscore.com`, bought 17 Nov 2026 at Cloudflare Registrar, US$11.17 a year, auto-renew on |
| Code | https://github.com/samuvelmaniraj/gully-scorer |
| Live relay (Cloudflare) | https://gully-relay.s-samuvelmaniraj.workers.dev |
| Cloudflare dashboard | dash.cloudflare.com → Workers & Pages → `gully-relay` |

## Goals and rules we set

- **Simple and fast for gully cricket.** Big tap buttons, works one-handed, starts in seconds.
- **No accounts, no database.** Nothing about players or matches is stored online for long, except group stats a group chooses to share (encrypted, deleted after 12 months with no new matches).
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
- **Addresses:** `tools/build.py` lists both site addresses in `SITES` for the security rules, and `worker/relay.js` accepts both in `ORIGINS`. Phones keep saved settings and stats per address, so moving address means Save backup on the old one and Merge a backup on the new one, and installing the app again.
- **The relay** (`worker/relay.js`, a Cloudflare Worker with a Durable Object) keeps only the latest message per match. It pushes updates live over a WebSocket and deletes the match 12 hours after its last update. It only accepts requests from the Gully Scorer site, refuses anything that isn't a score message, and limits sending speed.
- **Ordering:** each update carries a version number (`v`) that counts up, so phone clocks don't matter.
- **Ball times:** each match stores its start time (`t0`) and each ball stores `t`, the seconds since the start (set when the ball is tapped). Kept small on purpose: a full 12-over match still uses well under the relay's 16 KB limit. Groundwork for video highlights (cut clips around 4s, 6s and wickets). Older balls without `t` still work. After a handover the new phone's clock is used, so a few seconds of drift is possible.
- **Handover:** the new phone loads the latest state, then scores with a higher version. The old phone sees a newer version from another device and switches to watching.

## Features (all done)

**Scoring**
- Quick score (players a side) or Full scorecard (player lists, batters, bowlers, figures)
- 0–6 runs, Wd, Nb, Wicket + runs (run outs), Undo
- Run rate, target, required rate, innings break, result with balls left
- Strike rotation; One-side batting (single batter); Last man bats alone
- Toggles: wide gives 1 run, no-ball gives 1 run, one-tap wide and wicket (off by default), free hit (on by default)
- Coin toss with bat or bowl choice; Swap batting order
- Change overs or players (collapsed section under the pad, scorer only, any time incl. after the match): change overs per side (not below overs already bowled in this innings; target stays the same), add a late player to either team in Full (max 15, no duplicate names), change Players a side in Quick. An innings that ended on overs or all out reopens if the change allows more play (not the 1st innings once the 2nd has started); cutting overs can end it. Not covered by Undo: change it back instead
- Retire batter (button under the pad): **Retired hurt** (not a wicket; player listed as "(retired hurt)" and can bat again) or **Retired out** (counts as a wicket; can't bat again). Quick score offers Retired out only. Stored as `inn.ret` entries `{p, k:"h"|"o", at, pre}` beside the balls (not a ball), with their own Undo; shown in commentary, scorecard ("retired hurt" / "retired out") and stats (retired out = dismissed). If the last batter retires hurt with nobody to come in, the partner bats alone when Last man bats alone is on, otherwise the innings ends.

**Sharing**
- Watch link, QR code, WhatsApp button
- Scorer handover by QR, link or WhatsApp; it also passes the match settings
- Viewers keep the last score if the scorer goes away, and catch up when it's back
- Ball-by-ball commentary for viewers (both modes): latest first, grouped by over with an end-of-over summary (runs, score, bowler in Full, runs needed in a chase), free hits, milestones (batter 25/50, team 50s), innings and result lines, switch between innings, last 3 overs with "Show all". Built from the balls already in each update, so no format change. Not shown on the scorer's phone.
- Match end (Full mode): two more images, a full scorecard per innings (every batter with how out, R, B, 4s, 6s, SR; extras; every bowler with O, R, W, Econ; target or result bar). "Share summary + scorecards" shares all three at once (falls back to the summary alone if a phone can't share several files); Save buttons for each when sharing isn't supported
- Match end: TV-style summary image (1920×1080) with team bars, top 4 batters and bowlers (Full) or fours/sixes/extras/run rate (Quick), overs played / overs a side, team size, toss and result
- WhatsApp text table sent with the image; Send as text and Copy text

**Player stats (across matches)**
- "Player stats" button on the New match screen: batting (M, R, HS, Avg, SR, 4s, 6s) and bowling (M, O, R, W, Best, Econ) tables, Share on WhatsApp / Copy text (top 10 each)
- Saved on the scorer's phone only (`gullyStats` in local storage), nothing online. Only Full scorecard matches count; default names like "Player 3" are skipped; names match ignoring capitals and spaces
- Each finished match is its own record keyed by match ID; Undo after the end updates or removes it. Viewer phones save nothing
- Several scorers: each taps Save backup (a .json file, shared or downloaded) and sends it to one phone, which taps Merge a backup. Matches already there are skipped, so nothing is counted twice
- Matches saved list with Remove; Delete all stats (tap twice)

**Group stats (shared, optional)**
- One tap, no "create group" step: **Share stats link on WhatsApp** (in Player stats, and on the match-end screen for Full matches). The first tap quietly sets up the online stats (named "Player stats") and opens WhatsApp so the user picks their existing WhatsApp group; later taps reuse the same link. Two links: **players' link** `#group-<id>.<key>` (view only) and **scorer link** `#gscore-<id>.<key>.<token>` (can add and remove matches; send privately)
- No accounts. The group's stats are one file on the relay, encrypted with the key from the link (AES-GCM); the relay only sees ciphertext and a SHA-256 hash of the scorer token
- Scorer phones add each finished Full match automatically; offline phones retry when back online or when Player stats is opened. Merge keeps the newest copy of each match by match ID, so nothing is counted twice
- Handover carries the stats link: when the phone has a scorer link, the handover link gets an optional suffix `.<groupId>.<key>.<token>` after the usual `#score-…` parts, so the new scorer joins the same online stats automatically and its finished matches are added. Old handover links without the suffix still work. Handover QR is drawn larger when the suffix is present
- Two scorers saving at once: the relay accepts only the version the phone last saw (409 otherwise) and the phone merges again
- Removing a match on a scorer phone removes it for the whole group (kept as a removed ID so other phones don't add it back)
- The link's key is cleared from the address bar after opening. "Leave group on this phone" forgets the group on that phone only
- A phone keeps one group. Viewers see a Group / This phone switch only if the phone also has its own stats
- Relay: `/g/grp-<id>/get` returns `version\ndata`; `/g/grp-<id>/put` needs headers `X-Token` and `X-Base`; up to 1 MB; one save a second; deleted 12 months after the last save

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
| Renamed to TurfCricScore, own domain turfcricscore.com | "Gully Scorer" / gullyscorer.com is an existing Play Store app (com.gullyscorer.app), and several "Gully Score" apps exist; .com chosen for a global audience. Hosting stays on GitHub Pages; the page's security rules and the relay accept both addresses during the move |
| Settings saved on the phone only | Convenience without storing anything online |
| Player stats on the phone, one record per match ID, backup and merge by file | Keeps the no-storage-online rule; works with several scorers without double counting. Shared stats on the relay is a possible later option |
| Group stats on the relay, encrypted, links instead of logins | Players wanted to see their own stats any time. Links keep it account-free; the relay can't read names or scores; scorer token separates view and add |
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
- **Edit the relay:** change `worker/relay.js` and push. GitHub Actions ("Deploy relay") deploys it, then checks send, latest, origin blocking, the live connection, group read and group token check. New Durable Object classes need a new `[[migrations]]` tag in `worker/wrangler.toml`.
- **Tests:** `node tests/relay.test.mjs` (relay logic) and `node tests/e2e.js` (three simulated phones, needs Playwright).
- **Format changes:** if the link or message format changes, old match links stop working. Tell users to start a new match after updates.

## Known limits

- The scorer's page must stay open. If the phone sleeps or switches apps, viewers keep the last score until it's back.
- Cloudflare free plan: 100,000 requests a day (one 12-over match uses about 200).
- On some Android phones, WhatsApp drops the text when sharing an image. Use "Send as text" after.
- Anyone with the main site link can start their own match. They can't see or change other matches.

## Roadmap

**Planned next (ideas already in the plan)**
1. Points table for a series or tournament (wins, losses, net run rate)

**Done:** Install as an app on the home screen; ball-by-ball commentary; player stats on the phone with backup and merge (16 Nov 2026); shared group stats with players' and scorer links (17 Nov 2026)

**Future (big project):** camera with scorecard overlay, YouTube live, and automatic highlight clips from ball times. Step 1 done: every ball is timed (16 Nov 2026). Next steps when ready: scoreboard overlay link for streaming apps, then an Android app.

**Optional, later**
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
