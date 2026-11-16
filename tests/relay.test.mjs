// Unit test for the Cloudflare relay logic, run with plain Node (no Cloudflare needed):
//   node tests/relay.test.mjs
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../worker/relay.js"), "utf8")
  .replace(/^import .*$/m, "class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}\nclass WebSocketRequestResponsePair{}")
  .replace("export default", "const worker =").replace("export class Match", "class Match").replace("export class Group", "class Group") + "\nexport { worker, Match, Group };";
const tmp = path.join(os.tmpdir(), `relay-${process.pid}.mjs`); fs.writeFileSync(tmp, src);
const { worker, Match, Group } = await import(tmp); fs.unlinkSync(tmp);

const objs = {};
const ctx = () => { const st = new Map(); let alarm = null; return { storage: { get: async k => st.get(k), put: async (k, v) => { if (typeof k === "object") for (const [a, b] of Object.entries(k)) st.set(a, b); else st.set(k, v); }, setAlarm: async t => { alarm = t; }, deleteAll: async () => st.clear(), alarm: () => alarm }, getWebSockets: () => [], setWebSocketAutoResponse() {}, acceptWebSocket() {} }; };
const env = { MATCH: { idFromName: n => n, get: id => { objs[id] ??= new Match(ctx(), {}); return { fetch: r => objs[id].fetch(r) }; } },
  GROUP: { idFromName: n => "g:" + n, get: id => { objs[id] ??= new Group(ctx(), {}); return { fetch: r => objs[id].fetch(r) }; } } };
const O = "https://samuvelmaniraj.github.io", T = "gullyscorer-abcdefghjk2345";
const call = (p, o = {}) => worker.fetch(new Request("https://relay.test" + p, o), env);
let failed = 0;
const expect = async (label, res, status, body) => {
  const text = await res.text(), ok = res.status === status && (body === undefined || text === body);
  if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (${res.status} ${text.slice(0, 20)})`);
};
await expect("our site can send", await call(`/t/${T}/send`, { method: "POST", body: "g2.a.b", headers: { Origin: O } }), 200);
await expect("sending too fast is refused", await call(`/t/${T}/send`, { method: "POST", body: "g2.a.c", headers: { Origin: O } }), 429);
await expect("latest returns the last message", await call(`/t/${T}/latest`, { headers: { Origin: O } }), 200, "g2.a.b");
await expect("other websites are blocked", await call(`/t/${T}/send`, { method: "POST", body: "g2.x", headers: { Origin: "https://evil.example" } }), 403);
await expect("requests without an origin are blocked", await call(`/t/${T}/send`, { method: "POST", body: "g2.x" }), 403);
await expect("non-score messages are refused", await call("/t/gullyscorer-zzzzzzzzzzzz/send", { method: "POST", body: "hello", headers: { Origin: O } }), 400);
await expect("oversized messages are refused", await call("/t/gullyscorer-yyyyyyyyyyyy/send", { method: "POST", body: "g2." + "a".repeat(20000), headers: { Origin: O } }), 400);
await expect("unknown topics are not found", await call("/t/other/latest", { headers: { Origin: O } }), 404);
const hours = Math.round((objs[T].ctx.storage.alarm() - Date.now()) / 3600000);
if (hours !== 12) failed++; console.log(`${hours === 12 ? "PASS" : "FAIL"}  match expires after 12 hours (${hours}h)`);
await objs[T].alarm();
await expect("expired match is empty", await call(`/t/${T}/latest`, { headers: { Origin: O } }), 200, "");

/* groups: shared stats */
const G = "grp-abcdefghjk2345mnpqrs", TK = "A".repeat(43), BAD = "B".repeat(43);
const put = (body, token, base) => call(`/g/${G}/put`, { method: "POST", body, headers: { Origin: O, "X-Token": token, "X-Base": String(base) } });
const wait = () => new Promise(r => setTimeout(r, 1050));
await expect("new group is empty", await call(`/g/${G}/get`, { headers: { Origin: O } }), 200, "0\n");
await expect("creating a group needs version 0", await put("gs1.x", TK, 3), 403);
await expect("scorer creates the group", await put("gs1.one", TK, 0), 200, "1");
await expect("group returns version and data", await call(`/g/${G}/get`, { headers: { Origin: O } }), 200, "1\ngs1.one");
await wait();
await expect("wrong token can't change stats", await put("gs1.evil", BAD, 1), 403);
await wait();
await expect("stale version is refused (merge first)", await put("gs1.old", TK, 0), 409, "1");
await wait();
await expect("scorer adds a match", await put("gs1.two", TK, 1), 200, "2");
await expect("saving too fast is refused", await put("gs1.three", TK, 2), 429);
await expect("non-stats data is refused", await put("hello", TK, 2), 400);
await expect("missing token is refused", await call(`/g/${G}/put`, { method: "POST", body: "gs1.x", headers: { Origin: O, "X-Base": "2" } }), 400);
await expect("other websites can't read groups", await call(`/g/${G}/get`, { headers: { Origin: "https://evil.example" } }), 403);
await expect("bad group ids are not found", await call(`/g/grp-x/get`, { headers: { Origin: O } }), 404);
const days = Math.round((objs["g:" + G].ctx.storage.alarm() - Date.now()) / 86400000);
if (days !== 365) failed++; console.log(`${days === 365 ? "PASS" : "FAIL"}  group is deleted after 12 months without new matches (${days} days)`);
const pre = await call(`/g/${G}/put`, { method: "OPTIONS", headers: { Origin: O } });
const okPre = pre.status === 204 && /X-Token/.test(pre.headers.get("Access-Control-Allow-Headers") || "");
if (!okPre) failed++; console.log(`${okPre ? "PASS" : "FAIL"}  browsers may send the token header`);
await objs["g:" + G].alarm();
await expect("deleted group is empty", await call(`/g/${G}/get`, { headers: { Origin: O } }), 200, "0\n");

console.log(failed ? `\n${failed} failed` : "\nall passed"); process.exit(failed ? 1 : 0);
