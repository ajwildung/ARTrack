import { startVoltageServer } from "./server.ts";

const server = await startVoltageServer();
console.log(`Voltage League M1  phase=0  visual-only`);
console.log(`API     ${server.url}/api/health`);
console.log(`Ops     ${server.url}/ops`);
console.log(`HUD     ${server.url}/hud`);
console.log(`Audit   ${server.url}/api/audit/phase0`);
console.log(`WS      ws://127.0.0.1:${server.port}/ws`);

process.on("SIGINT", () => void server.close().then(() => process.exit(0)));
process.on("SIGTERM", () => void server.close().then(() => process.exit(0)));
