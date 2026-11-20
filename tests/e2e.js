// End-to-end test with three simulated phones (scorer, new scorer, viewer).
// Serves this repo as if it were GitHub Pages and fakes the Cloudflare relay, so it runs offline:
//   npm i -D playwright && npx playwright install chromium   (once)
//   python3 tools/build.py && node tests/e2e.js
const { chromium } = require("playwright"); const fs = require("fs"); const path = require("path");
const ROOT = path.join(__dirname, ".."), SITE = process.env.SITE || "https://turfcricscore.com/";
const HOSTS = ["turfcricscore.com", "samuvelmaniraj.github.io"];
let failed = 0;
const check = (label, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  (" + extra + ")" : ""}`); };

(async () => {
  const browser = await chromium.launch(), store = {}, sockets = [], errors = [], groups = {};
  const phone = async () => {
    const ctx = await browser.newContext();
    await ctx.route(/.*/, async route => {
      const req = route.request(), u = new URL(req.url());
      if (HOSTS.includes(u.host)) {
        const f = u.pathname.endsWith("/") ? "index.html" : u.pathname.split("/").pop();
        const type = { js: "application/javascript", png: "image/png", webmanifest: "application/manifest+json" }[f.split(".").pop()] || "text/html";
        return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(path.join(ROOT, f)) });
      }
      if (u.host.endsWith("workers.dev")) {
        const [, area, topic, kind] = u.pathname.split("/"), cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "X-Token, X-Base" };
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" });
        if (area === "g") { /* same rules as worker/relay.js Group */
          const g = groups[topic] ||= { v: 0, data: "", token: null };
          if (kind === "get") return route.fulfill({ status: 200, headers: cors, body: `${g.v}\n${g.data}` });
          const h = req.headers(), token = h["x-token"], base = Number(h["x-base"]), body = req.postData() || "";
          if (!/^[A-Za-z0-9_-]{43}$/.test(token || "") || !body.startsWith("gs1.")) return route.fulfill({ status: 400, headers: cors, body: "Bad" });
          if (g.token ? g.token !== token : base !== 0) return route.fulfill({ status: 403, headers: cors, body: "Not allowed" });
          if (base !== g.v) return route.fulfill({ status: 409, headers: cors, body: String(g.v) });
          Object.assign(g, { v: g.v + 1, data: body, token: g.token || token });
          return route.fulfill({ status: 200, headers: cors, body: String(g.v) });
        }
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

  // Retired hurt and retired out
  const sc = async p => (await p.evaluate(() => { const t = stats(S.innings[S.cur]); return t.runs + "/" + t.wk; }));
  const R = await phone(); await R.goto(SITE); await R.evaluate(() => localStorage.clear()); await R.goto(SITE);
  await R.check("#mFull"); await R.fill("#t1", "Reds"); await R.fill("#t2", "Blues");
  await R.fill("#p1", "Ann\nBob\nCal\nDan"); await R.fill("#p2", "Xi\nYan"); await R.fill("#ov", "3");
  await R.click("button[type=submit]"); await R.waitForTimeout(400); await pick(R);
  const retire = async txt => { await tap(R, "#retBtn"); await R.click(`#pick button:has-text("${txt}")`); await R.waitForTimeout(150); };
  const newBat = async name => { await R.selectOption("#selBat", { label: name }); await tap(R, "#pick .btn"); };
  await tap(R, '[data-r="2"]');
  await retire("Ann retired hurt");
  check("retired hurt is not a wicket", (await sc(R)) === "2/0", await sc(R));
  const opts = await R.$$eval("#selBat option", o => o.map(x => x.textContent));
  check("retired hurt player can bat again", opts.includes("Ann (retired hurt)") && opts.includes("Cal"), opts.join(", "));
  await newBat("Cal");
  await retire("Bob retired out");
  check("retired out counts as a wicket", (await sc(R)) === "2/1", await sc(R));
  check("retired out player can't bat again", !(await R.$$eval("#selBat option", o => o.map(x => x.textContent))).some(t => t.startsWith("Bob")));
  await tap(R, "#undoBtn");
  check("undo brings back the retired-out batter", (await sc(R)) === "2/0" && await R.evaluate(() => S.innings[0].non === 1 || S.innings[0].str === 1));
  await retire("Bob retired out"); await newBat("Ann (retired hurt)");
  check("retired hurt player comes back in", await R.evaluate(() => [S.innings[0].str, S.innings[0].non].includes(0)));
  await tap(R, '[data-r="1"]'); await R.waitForTimeout(1500);
  const order = await R.evaluate(() => battedList(S.innings[0]).map(p => S.players[0][p]));
  check("batting order follows who came in, even without facing", order.join(",") === "Ann,Bob,Cal", order.join(","));
  const RV = await phone(); await RV.goto(await R.textContent("#linkTxt")); await RV.waitForTimeout(2500);
  const rc = await RV.textContent("#commList");
  check("viewer commentary shows both retirements", /Ann retires hurt on 2 \(1\)/.test(rc) && /RETIRED OUT! Bob 0 \(0\)/.test(rc), rc.slice(0, 120));
  check("viewer score counts the retired out", (await sc(RV)) === "3/1", await sc(RV));
  check("scorecard says retired out", (await RV.evaluate(() => document.body.textContent)).includes("retired out"));
  const Q = await phone(); await Q.goto(SITE); await Q.evaluate(() => localStorage.clear()); await Q.goto(SITE);
  await Q.click("button[type=submit]"); await Q.waitForTimeout(300);
  await tap(Q, "#retBtn"); await Q.click('#pick button:has-text("Retired out")'); await Q.waitForTimeout(150);
  check("Quick score: retired out adds a wicket", (await sc(Q)) === "0/1", await sc(Q));

  // Change overs and add players during a match
  const M = await phone(); await M.goto(SITE); await M.evaluate(() => localStorage.clear()); await M.goto(SITE);
  await M.check("#mFull"); await M.fill("#p1", "Ann\nBob"); await M.fill("#p2", "Xi\nYan"); await M.fill("#ov", "1");
  await M.click("button[type=submit]"); await M.waitForTimeout(300); await pick(M);
  await M.click("#editBox summary");
  await M.fill("#edName", "Karthik"); await M.click('#edTeams button >> nth=0'); await M.waitForTimeout(150);
  check("late player joins the batting team", await M.evaluate(() => S.players[0].includes("Karthik") && wkts(0) === 2));
  await tap(M, "#wkBtn"); await tap(M, '[data-r="0"]'); await M.click("#pick .btn >> nth=0"); await M.waitForTimeout(150);
  const late = await M.$$eval("#selBat option", o => o.map(x => x.textContent));
  check("late player can come in to bat", late.includes("Karthik"), late.join(", "));
  await M.selectOption("#selBat", { label: "Karthik" }); await tap(M, "#pick .btn");
  for (let k = 0; k < 5; k++) await tap(M, '[data-r="1"]');
  check("innings ends after 1 over", await M.evaluate(() => S.innings[0].done));
  await M.fill("#edOv", "2"); await M.click("#edOvBtn"); await M.waitForTimeout(150);
  check("adding overs reopens the innings", await M.evaluate(() => S.overs === 2 && !S.innings[0].done) && (await M.textContent("#edMsg")).includes("from 1 to 2"));
  await M.fill("#edOv", "0"); await M.click("#edOvBtn");
  check("overs can't go below what's been bowled", (await M.textContent("#edMsg")).includes("between 1 and 50"));
  await M.fill("#edOv", "1"); await M.click("#edOvBtn"); await M.waitForTimeout(150);
  check("cutting overs back ends the innings", await M.evaluate(() => S.overs === 1 && S.innings[0].done));
  const Q2 = await phone(); await Q2.goto(SITE); await Q2.evaluate(() => localStorage.clear()); await Q2.goto(SITE);
  await Q2.fill("#pa", "2"); await Q2.click("button[type=submit]"); await Q2.waitForTimeout(300);
  await tap(Q2, "#wkBtn"); await tap(Q2, '[data-r="0"]');
  check("Quick: all out with 2 a side", await Q2.evaluate(() => S.innings[0].done));
  await Q2.click("#editBox summary"); await Q2.fill("#edPa", "3"); await Q2.click("#edPaBtn"); await Q2.waitForTimeout(150);
  check("Quick: an extra player reopens the innings", await Q2.evaluate(() => S.size === 3 && S.wickets === 2 && !S.innings[0].done));
  // Scorecard images for each innings (Full)
  check("two innings scorecard images are made", await B.evaluate(() => !!innBlobs[0] && !!innBlobs[1] && innBlobs[0].size > 20000) && (await B.textContent("#shareImg")).includes("scorecards"));

  // Group stats: one shared encrypted table; players' link views, scorer link adds
  const rec = (id, who, runs) => ({ id, at: Date.now(), teams: ["Reds", "Blues"], res: "Reds won", ov: 2, pl: [who], bat: [{ n: who, r: runs, b: 10, f: 1, s: 1, o: false }], bowl: [{ n: "Yan", l: 12, r: 20, w: 2 }] });
  await D.click("#statsGroup summary"); await D.click("#gCreate"); await D.waitForTimeout(800);
  const gid = Object.keys(groups)[0], G0 = groups[gid] || {};
  check("one tap sets up the stats link and opens WhatsApp", G0.v === 1 && (await D.textContent("#gMsg")).includes("Pick your WhatsApp group") && await D.evaluate(() => !!GROUP.t), await D.textContent("#gMsg"));
  check("group stats are encrypted on the relay", G0.data.startsWith("gs1.") && !/Sam|Raj|Player stats/.test(G0.data));
  await D.click("#gInvite"); await D.waitForTimeout(300);
  check("sharing again keeps the same link", Object.keys(groups).length === 1);
  const viewLink = await D.evaluate(() => groupLink()), scoreLink = await D.evaluate(() => scorerLink());
  check("players' link has no scorer token", !viewLink.includes(await D.evaluate(() => GROUP.t)) && /#group-/.test(viewLink));
  const P = await phone(); await P.goto(viewLink); await P.waitForTimeout(1000);
  check("player opens the group's stats", (await P.textContent("#statsInfo")).startsWith("Player stats: 1 match") && /Sam|Raj|Ali/.test(await P.textContent("#statsTable")), await P.textContent("#statsInfo"));
  check("link key is cleared from the address bar", await P.evaluate(() => location.hash === ""));
  check("player can't add or remove matches", await P.isHidden("#gScorerBtns") && !(await P.$("#statsList [data-del]")));
  const E = await phone(); await E.goto(scoreLink); await E.waitForTimeout(800);
  check("second scorer joins with the scorer link", await E.evaluate(() => !!GROUP.t) && (await E.textContent("#gRole")).includes("scorer"));
  await D.evaluate(r => { saveStats([...loadStats(), r]); }, rec("dddddd1", "Dinesh", 30));
  await E.evaluate(r => { saveStats([...loadStats(), r]); }, rec("eeeeee1", "Elan", 44));
  await Promise.all([D.evaluate(() => groupSync()), E.evaluate(() => groupSync())]); await D.waitForTimeout(3000);
  await P.evaluate(() => groupSync()); await P.waitForTimeout(500);
  check("two scorers saving at once both count", (await P.textContent("#statsInfo")).startsWith("Player stats: 3 matches") && /Dinesh/.test(await P.textContent("#statsTable")) && /Elan/.test(await P.textContent("#statsTable")), await P.textContent("#statsInfo"));
  await E.click("#statsMatches summary").catch(() => {});
  await E.click('#statsList [data-del="eeeeee1"]'); await E.click('#statsList [data-del="eeeeee1"]'); await E.waitForTimeout(1500);
  await D.evaluate(r => { saveStats([...loadStats(), r]); return groupSync(); }, rec("eeeeee1", "Elan", 44)); await D.waitForTimeout(500);
  await P.evaluate(() => groupSync()); await P.waitForTimeout(500);
  check("a removed match stays removed", (await P.textContent("#statsInfo")).startsWith("Player stats: 2 matches") && !/Elan/.test(await P.textContent("#statsTable")), await P.textContent("#statsInfo"));
  const finished = await B.evaluate(() => JSON.parse(JSON.stringify(S)));
  await E.evaluate(st => { st.id = "eeefinish1"; S = clean(st); isViewer = false; syncStats(); }, finished); await E.waitForTimeout(1500);
  await P.evaluate(() => groupSync()); await P.waitForTimeout(500);
  check("a finished match on a scorer's phone goes to the group", (await P.textContent("#statsInfo")).startsWith("Player stats: 3 matches"), await P.textContent("#statsInfo"));
  if (process.env.SHOT) { await P.setViewportSize({ width: 390, height: 1500 }); await P.click("#statsGroup summary"); await P.locator("#statsCard").screenshot({ path: "/tmp/grp-player.png" });
    await D.setViewportSize({ width: 390, height: 1700 }); await D.evaluate(() => groupSync()); await D.waitForTimeout(600); await D.locator("#statsCard").screenshot({ path: "/tmp/grp-scorer.png" }); }
  // Handover carries the online stats link, so the new scorer adds to the same stats
  await D.goto(SITE); await D.click("button[type=submit]"); await D.waitForTimeout(400);
  const hl = await D.evaluate(() => handLink());
  check("handover link includes the stats link", hl.includes(await D.evaluate(() => GROUP.id)));
  const H = await phone(); await H.goto(hl); await H.waitForTimeout(1500);
  check("new scorer joins the online stats automatically", (await H.evaluate(() => GROUP && GROUP.t)) === (await D.evaluate(() => GROUP.t)) && await H.evaluate(() => !isViewer));
  const F = await phone(); await F.goto(scoreLink.replace(/\.[A-Za-z0-9_-]{43}$/, "." + "Z".repeat(43))); await F.waitForTimeout(400);
  await F.evaluate(r => { saveStats([r]); return groupSync(); }, rec("ffffff1", "Faker", 99)); await F.waitForTimeout(300);
  check("a fake scorer link can't add matches", (await F.textContent("#gMsg")).includes("didn't accept") && groups[gid].v === (await P.evaluate(() => readCache().v)));

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
