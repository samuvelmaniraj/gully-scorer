/* Gully Scorer relay: passes encrypted, signed score updates from the scorer's phone to viewers.
   It never sees the score: messages are encrypted on the phone and the key stays in the link.
   Each match keeps only its latest message, deleted 12 hours after the last update. */
import { DurableObject } from "cloudflare:workers";

const ORIGINS = ["https://samuvelmaniraj.github.io"];
const TOPIC = /^gullyscorer-[a-z0-9]{10,24}$/;
const MAX_BYTES = 16384, TTL_MS = 12 * 3600 * 1000, MIN_GAP_MS = 250;

const corsFor = origin => ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = corsFor(origin);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Max-Age": "86400" } });
    }
    /* only the Gully Scorer site may use this relay */
    if (!ORIGINS.includes(origin)) return new Response("Forbidden", { status: 403 });
    const m = new URL(req.url).pathname.match(/^\/t\/([^/]+)\/(ws|latest|send)$/);
    if (!m || !TOPIC.test(m[1])) return new Response("Not found", { status: 404, headers: cors });
    const res = await env.MATCH.get(env.MATCH.idFromName(m[1])).fetch(req);
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
