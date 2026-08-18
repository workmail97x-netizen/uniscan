import { DurableObject } from "cloudflare:workers";

const ROOM_RE = /^[A-Z2-9]{8}$/;
const ROLES = new Set(["desktop", "mobile", "browser"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }
      const room = (url.searchParams.get("room") || "").toUpperCase();
      const role = (url.searchParams.get("role") || "").toLowerCase();
      if (!ROOM_RE.test(room) || !ROLES.has(role)) {
        return new Response("Invalid room or role", { status: 400 });
      }
      const id = env.SESSIONS.idFromName(room);
      return env.SESSIONS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class UniScanSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = (url.searchParams.get("role") || "").toLowerCase();
    if (!ROLES.has(role)) return new Response("Invalid role", { status: 400 });

    // Only one active endpoint per role. A new connection replaces the old one.
    for (const old of this.ctx.getWebSockets(role)) {
      try { old.close(4001, "Replaced by a newer UniScan connection"); } catch {}
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, joinedAt: Date.now() });

    try { server.send(JSON.stringify({ type: "ready", role })); } catch {}
    this.broadcastState();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    if (message === "ping") return; // normally handled without waking the object

    const meta = ws.deserializeAttachment() || {};
    let data;
    try { data = JSON.parse(message); } catch { return; }

    if (meta.role === "mobile" && data.type === "scan") {
      const value = String(data.value || "").trim();
      const suffix = ["ENTER", "TAB", "NONE"].includes(data.suffix) ? data.suffix : "ENTER";
      const id = String(data.id || crypto.randomUUID()).slice(0, 80);
      if (!value || [...value].length > 4096) {
        this.safeSend(ws, { type: "ack", id, ok: false, error: "invalid_barcode" });
        return;
      }
      const targets = [
        ...this.ctx.getWebSockets("desktop"),
        ...this.ctx.getWebSockets("browser"),
      ];
      if (!targets.length) {
        this.safeSend(ws, { type: "ack", id, ok: false, error: "no_receiver" });
        return;
      }
      const payload = JSON.stringify({ type: "scan", id, value, suffix, at: Date.now() });
      for (const target of targets) {
        try { target.send(payload); } catch {}
      }
      return;
    }

    if ((meta.role === "desktop" || meta.role === "browser") && data.type === "ack") {
      const payload = JSON.stringify({
        type: "ack",
        id: String(data.id || "").slice(0, 80),
        ok: !!data.ok,
        via: meta.role,
        error: data.error ? String(data.error).slice(0, 120) : undefined,
      });
      for (const mobile of this.ctx.getWebSockets("mobile")) {
        try { mobile.send(payload); } catch {}
      }
      return;
    }
  }

  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
    this.broadcastState();
  }

  webSocketError(ws) {
    try { ws.close(1011, "WebSocket error"); } catch {}
    this.broadcastState();
  }

  broadcastState() {
    const state = {
      type: "state",
      desktop: this.ctx.getWebSockets("desktop").length > 0,
      mobile: this.ctx.getWebSockets("mobile").length > 0,
      browser: this.ctx.getWebSockets("browser").length > 0,
    };
    const raw = JSON.stringify(state);
    for (const client of this.ctx.getWebSockets()) {
      try { client.send(raw); } catch {}
    }
  }

  safeSend(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}
