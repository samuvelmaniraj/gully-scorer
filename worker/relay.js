/* Gully Scorer relay (deployed by GitHub Actions): passes encrypted, signed score updates from the scorer's phone to viewers.
   It never sees the score: messages are encrypted on the phone and the key stays in the link.
   Each match keeps only its latest message, deleted 12 hours after the last update.
   Groups keep one encrypted stats file (all matches of a group). Only phones with the group's scorer
   link can change it (they prove it with a secret token; the relay keeps only its SHA-256 hash).
   A group is deleted after 12 months with no new matches. */
import { DurableObject } from "cloudflare:workers";

const ORIGINS = ["https://turfcricscore.com", "https://samuvelmaniraj.github.io"];
const TOPIC = /^gullyscorer-[a-z0-9]{10,24}$/;
const MAX_BYTES = 16384, TTL_MS = 12 * 3600 * 1000, MIN_GAP_MS = 250;
const GROUP = /^grp-[a-z0-9]{20,32}$/, TOKEN = /^[A-Za-z0-9_-]{43}$/;
const GROUP_MAX = 1000000, GROUP_TTL_MS = 365 * 24 * 3600 * 1000, GROUP_GAP_MS = 1000;

const corsFor = origin => ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = corsFor(origin);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "X-Token, X-Base", "Access-Control-Max-Age": "86400" } });
    }
    /* only the Gully Scorer site may use this relay */
    if (!ORIGINS.includes(origin)) return new Response("Forbidden", { status: 403 });
    const path = new URL(req.url).pathname;
    const g = path.match(/^\/g\/([^/]+)\/(get|put|del)$/);
    let res;
    if (g) {
      if (!GROUP.test(g[1])) return new Response("Not found", { status: 404, headers: cors });
      res = await env.GROUP.get(env.GROUP.idFromName(g[1])).fetch(req);
    } else {
      const m = path.match(/^\/t\/([^/]+)\/(ws|latest|send)$/);
      if (!m || !TOPIC.test(m[1])) return new Response("Not found", { status: 404, headers: cors });
      res = await env.MATCH.get(env.MATCH.idFromName(m[1])).fetch(req);
    }
    if (res.status === 101) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};

export class Match extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lastAt = 0;
    /* answer keep-alive pings without waking the object */
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  async fetch(req) {
    const kind = new URL(req.url).pathname.split("/").pop();
    if (kind === "ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const last = await this.ctx.storage.get("last");
      if (last) server.send(last);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (kind === "send" && req.method === "POST") {
      const body = await req.text();
      if (!body.startsWith("g2.") || body.length > MAX_BYTES) return new Response("Bad message", { status: 400 });
      const now = Date.now();
      if (now - this.lastAt < MIN_GAP_MS) return new Response("Too fast", { status: 429 });
      this.lastAt = now;
      await this.ctx.storage.put("last", body);
      await this.ctx.storage.setAlarm(now + TTL_MS);
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(body); } catch (e) {} }
      return new Response("ok", { headers: { "Cache-Control": "no-store" } });
    }
    if (kind === "latest" && req.method === "GET") {
      const last = await this.ctx.storage.get("last");
      return new Response(last || "", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
    return new Response("Method not allowed", { status: 405 });
  }
  async webSocketMessage() { /* viewers only listen */ }
  async webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code, "closed"); } catch (e) {} }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "match expired"); } catch (e) {} }
    await this.ctx.storage.deleteAll();
  }
}

/* One group's shared stats: a single encrypted file with a version number.
   Writes need the scorer token and the version the phone last saw, so two scorers saving at the
   same moment can't overwrite each other: the second gets 409 and merges again. */
const sha256 = async t => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))));
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export class Group extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.lastAt = 0; }
  async fetch(req) {
    const kind = new URL(req.url).pathname.split("/").pop(), nc = { "Cache-Control": "no-store" };
    const gone = await this.ctx.storage.get("gone");
    if (kind === "get" && req.method === "GET") {
      if (gone) return new Response("-1\n", { headers: { "Content-Type": "text/plain", ...nc } }); /* deleted by a scorer */
      const v = (await this.ctx.storage.get("v")) || 0, data = (await this.ctx.storage.get("data")) || "";
      return new Response(`${v}\n${data}`, { headers: { "Content-Type": "text/plain", ...nc } });
    }
    /* delete everything; keep only a "deleted" marker for 12 months so other scorer phones
       don't quietly upload their old matches again */
    if (kind === "del" && req.method === "POST") {
      const token = req.headers.get("X-Token") || "";
      if (!TOKEN.test(token)) return new Response("Bad request", { status: 400 });
      if (gone) return new Response("Deleted", { headers: nc });
      const hash = await this.ctx.storage.get("hash");
      if (!hash || !same(hash, await sha256(token))) return new Response("Not allowed", { status: 403 });
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.put("gone", true);
      await this.ctx.storage.setAlarm(Date.now() + GROUP_TTL_MS);
      return new Response("Deleted", { headers: nc });
    }
    if (kind === "put" && req.method === "POST") {
      if (gone) return new Response("Deleted", { status: 410 });
      const token = req.headers.get("X-Token") || "", base = Number(req.headers.get("X-Base"));
      if (!TOKEN.test(token) || !Number.isInteger(base) || base < 0) return new Response("Bad request", { status: 400 });
      const body = await req.text();
      if (!body.startsWith("gs1.") || body.length > GROUP_MAX) return new Response("Bad data", { status: 400 });
      const now = Date.now();
      if (now - this.lastAt < GROUP_GAP_MS) return new Response("Too fast", { status: 429 });
      const hash = await this.ctx.storage.get("hash"), v = (await this.ctx.storage.get("v")) || 0;
      if (hash ? !same(hash, await sha256(token)) : base !== 0) return new Response("Not allowed", { status: 403 });
      if (base !== v) return new Response(String(v), { status: 409, headers: nc });
      this.lastAt = now;
      await this.ctx.storage.put({ hash: hash || await sha256(token), v: v + 1, data: body });
      await this.ctx.storage.setAlarm(now + GROUP_TTL_MS);
      return new Response(String(v + 1), { headers: nc });
    }
    return new Response("Method not allowed", { status: 405 });
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
