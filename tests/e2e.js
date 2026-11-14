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
        return route.fulfill({ status: 200, contentType: f.endsWith(".js") ? "application/javascript" : "text/html", body: fs.readFileSync(path.join(ROOT, f)) });
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
    const p = await ctx.newPage(); p.on("pageerror", e => errors.push(e.message)); return p;
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
  check("match summary image is made", await B.evaluate(() => !!sumBlob && sumBlob.size > 10000));
  check("summary text has the result", (await B.evaluate(() => scoreText())).includes(await B.evaluate(() => resultTxt().toUpperCase())));
  check("no page errors", errors.length === 0, errors.join("; "));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed"); process.exit(failed ? 1 : 0);
})();
