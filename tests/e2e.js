// End-to-end test with three simulated phones (scorer, new scorer, viewer).
// Serves this repo as if it were GitHub Pages and fakes the Cloudflare relay, so it runs offline:
//   npm i -D playwright && npx playwright install chromium   (once)
//   python3 tools/build.py && node tests/e2e.js
const { chromium } = require("playwright"); const fs = require("fs"); const path = require("path");
const ROOT = path.join(__dirname, ".."), SITE = "https://samuvelmaniraj.github.io/gully-scorer/";
let failed = 0;
const check = (label, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  (" + extra + ")" : ""}`); };

(async () => {
  const browser = await chromium.launch(), store = {}, sockets = [], errors = [];
  const phone = async () => {
    const ctx = await browser.newContext();
    await ctx.route(/.*/, async route => {
      const req = route.request(), u = new URL(req.url());
      if (u.host === "samuvelmaniraj.github.io") {
        const f = u.pathname.endsWith("/") ? "index.html" : u.pathname.split("/").pop();
        const type = { js: "application/javascript", png: "image/png", webmanifest: "application/manifest+json" }[f.split(".").pop()] || "text/html";
        return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(path.join(ROOT, f)) });
      }
      if (u.host.endsWith("workers.dev")) {
        const [, , topic, kind] = u.pathname.split("/"), cors = { "Access-Control-Allow-Origin": "*" };
        if (kind === "send") { const m = req.postData() || ""; store[topic] = m; sockets.filter(s => s.topic === topic).forEach(s => s.ws.send(m)); return route.fulfill({ status: 200, headers: cors, body: "ok" }); }
        return route.fulfill({ status: 200, headers: cors, body: store[topic] || "" });
      }
      return route.abort();
    });
    await ctx.routeWebSocket(/workers\.dev/, ws => {
      const s = { topic: new URL(ws.url()).pathname.split("/")[2], ws }; sockets.push(s);
      if (store[s.topic]) ws.send(store[s.topic]);
      ws.onMessage(m => { if (m === "ping") ws.send("pong"); });
      ws.onClose(() => sockets.splice(sockets.indexOf(s), 1));
    });
    const p = await ctx.newPage(); p.on("pageerror", e => errors.push(e.message));
    p.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push("CSP: " + m.text()); }); return p;
  };
  const tap = async (p, s) => { await p.click(s); await p.waitForTimeout(60); };
  const score = async p => (await p.textContent("#board")).match(/(\d+)\/(\d+)/)?.[0];
  const pick = async p => { for (const [id, ix] of [["#selStr", 1], ["#selNon", 2], ["#selBat", 1], ["#selBowl", 1]]) if (await p.$(id)) await p.selectOption(id, { index: ix }); await tap(p, "#pick .btn"); };

  // Scorer starts a Full match
  const A = await phone(); await A.goto(SITE);
  await A.check("#mFull"); await A.fill("#t1", "Lions"); await A.fill("#t2", "Tigers");
  await A.fill("#p1", "Sam\nRaj\nAli"); await A.fill("#p2", "Ben\nKumar\nDev"); await A.fill("#ov", "2");
  await A.click("button[type=submit]"); await A.waitForTimeout(500); await pick(A);
  check("QR code is drawn", await A.evaluate(() => !!document.querySelector("#qr canvas, #qr img")));
  await tap(A, '[data-r="4"]'); await tap(A, "#nbBtn"); await tap(A, '[data-r="1"]');
  check("free hit after a no-ball", await A.isVisible("#board .fh") && (await A.textContent("#wkBtn")) === "Run out");
  await A.waitForTimeout(1500);

  // Viewer
  const V = await phone(); await V.goto(await A.textContent("#linkTxt")); await V.waitForTimeout(1000);
  check("viewer sees the live score", (await score(V)) === (await score(A)), await score(V));
  const comm = await V.textContent("#commList").catch(() => "");
  check("viewer sees ball-by-ball commentary", /FOUR!/.test(comm) && /no-ball/i.test(comm) && /Free hit/.test(comm) && /Sam|Raj|Ali/.test(comm), comm.slice(0, 80));
  check("scorer's screen has no commentary", await A.isHidden("#commCard"));
  check("every ball has its time", await A.evaluate(() => S.t0 > 0 && S.innings[0].balls.every(b => Number.isInteger(b.t) && b.t >= 0)));
  check("viewer receives ball times", await V.evaluate(() => S.t0 > 0 && S.innings[0].balls.every(b => Number.isInteger(b.t))));
  // worst case: a 12-over Full match, 7 a side, every ball timed, must fit the relay's 16 KB limit
  const sizes = await A.evaluate(async () => {
    const one = k => ({ r: [0,1,4,6,2,1][k % 6], x: k % 9 === 0 ? "wd" : null, w: k % 13 === 0, s: k % 7, bw: k % 6, out: k % 13 === 0 ? k % 7 : null, wt: k % 13 === 0 ? "b" : null, pre: { str: k % 7, non: (k + 1) % 7, bw: k % 6, prev: (k + 1) % 6 }, t: 40 + k * 31 });
    const big = JSON.parse(JSON.stringify(S)); big.overs = 12; big.players = [["Sam","Raj","Ali","Kumar","Vijay","Arun","Mani"],["Ben","Dev","Hari","Siva","Prem","Ravi","John"]];
    big.innings = [0, 1].map(i => ({ done: i === 0, str: 1, non: 2, bw: 3, prev: 4, balls: Array.from({ length: 90 }, (_, k) => one(k + i * 90)) }));
    const withT = (await seal({ t: "state", s: clean(big), sid: SID })).length;
    big.innings.forEach(n => n.balls.forEach(b => delete b.t));
    const noT = (await seal({ t: "state", s: clean(big), sid: SID })).length;
    return { withT, noT };
  });
  check("biggest update still fits the relay", sizes.withT < 12000, `${sizes.noT} → ${sizes.withT} chars, limit 16384`);

  // Handover
  const B = await phone(); await B.goto(await A.textContent("#handTxt")); await B.waitForTimeout(1500);
  check("new phone takes over scoring", await B.isVisible("#pad"));
  await A.waitForTimeout(1500);
  check("old scorer switches to watching", A.url().includes("#watch-"));
  await tap(B, '[data-r="6"]'); await B.waitForTimeout(1500);
  check("viewer follows the new scorer", (await score(V)) === (await score(B)), await score(V));

  // Forged update from someone with only the watch link
  const before = await score(V);
  await V.evaluate(async () => { const real = verifyKey; await makeSigner(); verifyKey = real;
    const fake = JSON.parse(JSON.stringify(S)); fake.v = 9999; fake.innings[0].balls.push({ r: 6, x: null, w: false });
    await relaySend(PREFIX + S.id, await seal({ t: "state", s: fake, sid: "x" })); });
  await V.waitForTimeout(1000);
  check("forged update is ignored", (await score(V)) === before);

  // Finish the match on B and check the summary
  for (let k = 0; k < 80 && !(await B.isVisible("#finalCard")); k++) {
    if (await B.isVisible("#pick")) { if (await B.$("#pick select")) await pick(B); else await B.click("#pick .btn"); continue; }
    if (await B.isVisible("#breakBox")) { await tap(B, "#nextInn"); continue; }
    await tap(B, `[data-r="${["1", "6", "0", "4"][k % 4]}"]`);
  }
  await B.waitForTimeout(1200);
  check("commentary shows the result", (await V.textContent("#commList")).includes(await B.evaluate(() => resultTxt())));
  if (process.env.SHOT) { await V.waitForTimeout(500); await V.setViewportSize({ width: 390, height: 2200 }); await V.locator("#commCard").screenshot({ path: process.env.SHOT }); }
  check("match summary image is made", await B.evaluate(() => !!sumBlob && sumBlob.size > 10000));
  check("summary text has the result", (await B.evaluate(() => scoreText())).includes(await B.evaluate(() => resultTxt().toUpperCase())));
  // Player stats: saved on the scorer's phone when the match ends, merged on another phone without double counting
  check("match saved to player stats", await B.isVisible("#statsSaved") && await B.evaluate(() => loadStats().length === 1));
  check("viewer phone saves no stats", await V.evaluate(() => loadStats().length === 0));
  const backup = await B.evaluate(() => localStorage.getItem("gullyStats"));
  const D = await phone(); await D.goto(SITE); await D.click("#statsBtn");
  check("stats screen starts empty", (await D.textContent("#statsInfo")).startsWith("No matches"));
  const merge = async () => { await D.click("#statsSync summary").catch(() => {}); await D.setInputFiles("#statsFile", { name: "gully-stats.json", mimeType: "application/json", buffer: Buffer.from(backup) }); await D.waitForTimeout(300); return D.textContent("#statsMsg"); };
  check("merging a backup adds the match", (await merge()).startsWith("Added 1 new match") && /Sam|Raj|Ali/.test(await D.textContent("#statsTable")));
  check("merging again counts nothing twice", (await merge()).includes("Added 0 new matches. 1 already here") && await D.evaluate(() => loadStats().length === 1));
  const runsB = await B.evaluate(() => [0, 1].reduce((t, i) => t + battedList(S.innings[i]).reduce((u, p) => u + batFig(S.innings[i], p).r, 0), 0));
  check("stats totals match the scorecard", await D.evaluate(() => aggregate(loadStats()).bat.reduce((t, p) => t + p.r, 0)) === runsB);
  await D.click('#statsTab [data-t="bowl"]'); check("bowling table shows", /Ben|Kumar|Dev/.test(await D.textContent("#statsTable")));
  check("stats text for WhatsApp", (await D.textContent("#statsTxt")).includes("PLAYER STATS"));
  if (process.env.SHOT) { await D.setViewportSize({ width: 390, height: 1400 }); await D.click('#statsTab [data-t="bat"]'); await D.click("#statsMatches summary"); await D.locator("#statsCard").screenshot({ path: process.env.SHOT.replace(".png", "-stats.png") }); }

  // Install as an app: manifest, icons and offline copy all load under the security rules
  const C = await phone(); await C.goto(SITE); await C.waitForTimeout(1500);
  const am = await (await C.context().newCDPSession(C)).send("Page.getAppManifest");
  const m = (() => { try { return JSON.parse(am.data); } catch (e) { return null; } })();
  check("app manifest loads", !!m && !am.errors.length && m.display === "standalone" && m.icons.length === 3, am.errors.map(e => e.message).join("; "));
  check("offline helper is running", await C.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }));
  check("app files saved on the phone", await C.evaluate(async () => { const c = await caches.open("gully-v1"); return (await c.keys()).length >= 7; }));
  check("no page errors", errors.length === 0, errors.join("; "));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed"); process.exit(failed ? 1 : 0);
})();
