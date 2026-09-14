import { createServer } from "node:http";
import { RULES } from "@voltage/shared";
import { loadConfig, type Config } from "./config.ts";
import { openDb, type Db } from "./db.ts";
import { SessionOrchestrator } from "./session.ts";
import { Hub } from "./hub.ts";
import { createHttp } from "./http.ts";

export interface VoltageServer {
  url: string;
  port: number;
  cfg: Config;
  db: Db;
  session: SessionOrchestrator;
  hub: Hub;
  close(): Promise<void>;
}

export async function startVoltageServer(overrides: Partial<Config> = {}): Promise<VoltageServer> {
  const cfg = loadConfig(overrides);
  const db = openDb(cfg.dbPath);
  const session = new SessionOrchestrator(cfg, db);
  const hub = new Hub(session);
  const app = createHttp(cfg, session, hub, db);
  const httpServer = createServer(app);
  hub.attach(httpServer);

  const timer = setInterval(() => {
    const assists = session.tick();
    if (assists.length) hub.broadcastAssist(assists);
    if (session.status === "live") hub.broadcastSnapshot();
  }, RULES.tickMs);
  timer.unref?.();

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(cfg.port, cfg.host, () => resolve());
    httpServer.on("error", reject);
  });
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : cfg.port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    cfg,
    db,
    session,
    hub,
    close: async () => {
      clearInterval(timer);
      await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
      db.close();
    },
  };
}
