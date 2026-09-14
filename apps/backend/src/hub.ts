import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import type { ClientMessage, ServerMessage } from "@voltage/shared";
import type { SessionOrchestrator } from "./session.ts";
import type { AssistRecord } from "./assist.ts";

interface Client {
  id: string;
  ws: WebSocket;
  role: "ops" | "hud" | "kart" | "unknown";
  kartId?: string;
}

export class Hub {
  private clients = new Set<Client>();
  private seq = 0;

  constructor(private session: SessionOrchestrator) {}

  attach(server: Server): WebSocketServer {
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (ws) => {
      const client: Client = { id: `c-${++this.seq}`, ws, role: "unknown" };
      this.clients.add(client);
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as ClientMessage;
          this.onMessage(client, msg);
        } catch (err) {
          this.send(client, { type: "error", message: (err as Error).message });
        }
      });
      ws.on("close", () => {
        if (client.kartId) this.session.markDisconnected(client.kartId);
        this.clients.delete(client);
        this.broadcastSnapshot();
      });
    });
    return wss;
  }

  broadcastSnapshot(): void {
    const snapshot = this.session.snapshot();
    this.broadcast({ type: "snapshot", snapshot });
  }

  broadcastAssist(records: AssistRecord[]): void {
    for (const record of records) {
      this.broadcast({ type: "assist", record });
    }
  }

  private onMessage(client: Client, msg: ClientMessage): void {
    if (msg.type === "hello") {
      client.role = msg.role;
      if (msg.role === "hud" || msg.role === "kart") {
        const id = msg.kartId || `KART-${client.id}`;
        const kart = this.session.upsertKart(id, msg.name || id, false);
        client.kartId = kart.id;
      }
      this.send(client, { type: "hello_ok", clientId: client.id, snapshot: this.session.snapshot() });
      this.broadcastSnapshot();
      return;
    }

    if (msg.type === "ops") {
      let assists: AssistRecord[] = [];
      if (msg.action === "start") {
        const r = this.session.start();
        if (!r.ok) {
          this.send(client, { type: "error", message: r.error ?? "start failed" });
          return;
        }
        assists = r.assists;
      } else if (msg.action === "abort") {
        assists = this.session.abort().assists;
      } else if (msg.action === "safe_mode") {
        const r = this.session.safe();
        if (!r.ok) {
          this.send(client, { type: "error", message: r.error ?? "safe mode failed" });
          return;
        }
        assists = r.assists;
      } else if (msg.action === "seed_sims") {
        this.session.seedSims(3);
      } else if (msg.action === "reset") {
        this.session.reset();
      }
      this.broadcastAssist(assists);
      this.broadcastSnapshot();
      return;
    }

    if (msg.type === "steer") {
      const id = msg.kartId || client.kartId;
      if (id) this.session.applySteer(id, msg.throttle, msg.steer);
      return;
    }

    if (msg.type === "pose") {
      this.session.applyPose(msg.pose);
      return;
    }

    if (msg.type === "use_pickup" && (msg.kartId || client.kartId)) {
      const rec = this.session.usePickup(msg.kartId || client.kartId!, msg.slot);
      if (rec) this.broadcastAssist([rec]);
      this.broadcastSnapshot();
    }
  }

  private send(client: Client, msg: ServerMessage): void {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const raw = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(raw);
    }
  }
}
