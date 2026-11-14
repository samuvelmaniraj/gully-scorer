# Gully Scorer: guide for Claude

Full background, decisions and roadmap: `docs/PROJECT_NOTES.md`. Read it before larger changes.

## Golden rules
- Privacy first: never add analytics, outside scripts, fonts or servers. Scores stay end-to-end encrypted and signed.
- Edit `src/gully-scorer.html`, never `index.html` by hand. Then run `python3 tools/build.py` and commit both.
  `index.html` pins the inline script's SHA-256 in its Content-Security-Policy; skipping the build breaks the live site.
- The page may load only itself and `qrcode.min.js` (pinned with an integrity hash), and connect only to the relay in `OWN_RELAY`.
- Changing the link format (`#watch-…`, `#score-…`) or the message format (`g2.` + signature + ciphertext) breaks existing match links. Call it out to the user.
- Keep the scorer UI fast and one-handed: big buttons, few taps.

## Checks before pushing
- `node --check` on the inline script (the build prints the hash; extract the script to check syntax).
- `node tests/relay.test.mjs` when `worker/relay.js` changes.
- `node tests/e2e.js` for page changes (needs Playwright with Chromium).

## Deploys
- Page: push to `main`; GitHub Pages publishes in about a minute.
- Relay: pushing changes under `worker/` runs the "Deploy relay" workflow, which deploys to Cloudflare and checks the relay works. Secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are in the repo settings; the token expires 13 Nov 2027.

## Commits
End commit messages with the co-author lines the session provides.
