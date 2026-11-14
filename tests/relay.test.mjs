// Unit test for the Cloudflare relay logic, run with plain Node (no Cloudflare needed):
//   node tests/relay.test.mjs
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../worker/relay.js"), "utf8")
  .replace(/^import .*$/m, "class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}\nclass WebSocketRequestResponsePair{}")
  .replace("export default", "const worker =").replace("export class Match", "class Match") + "\nexport { worker, Match };";
const tmp = path.join(os.tmpdir(), `relay-${process.pid}.mjs`); fs.writeFileSync(tmp, src);
const { worker, Match } = await import(tmp); fs.unlinkSync(tmp);

const objs = {};
const ctx = () => { const st = new Map(); let alarm = null; return { storage: { get: async k => st.get(k), put: async (k, v) => st.set(k, v), setAlarm: async t => { alarm = t; }, deleteAll: async () => st.clear(), alarm: () => alarm }, getWebSockets: () => [], setWebSocketAutoResponse() {}, acceptWebSocket() {} }; };
const env = { MATCH: { idFromName: n => n, get: id => { objs[id] ??= new Match(ctx(), {}); return { fetch: r => objs[id].fetch(r) }; } } };
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
console.log(failed ? `\n${failed} failed` : "\nall passed"); process.exit(failed ? 1 : 0);
