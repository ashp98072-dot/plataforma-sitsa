// Ejecutar desde la raíz del worktree después del build y npm prune --omit=dev.
// No usa credenciales reales ni permite archivos de entorno persistentes.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const output = "docs/evidence/pr512-dependencies/";
const envFiles = ["../../../config/.env", "../../config/.env", "../config/.env", "../../../config/app.env", "../../config/app.env", "../config/app.env", ".env.production.local", ".env.local", ".env.production", ".env"];
if (envFiles.some(p => existsSync(path.resolve(p)))) throw new Error("Smoke cancelado: hay archivos de entorno que podrían contener credenciales reales.");
const devPackages = ["vitest", "vite", "@vitest/mocker", "eslint", "eslint-config-next", "typescript", "happy-dom"];
for (const name of devPackages) if (existsSync(path.join("node_modules", name))) throw new Error(`Ejecuta npm prune --omit=dev antes del smoke: sigue instalado ${name}`);

const probe = net.createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const server = spawn(process.execPath, ["--import", pathToFileURL(path.resolve(output, "runtime-isolation.mjs")).href, "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_OPTIONS: "", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", AUTH_SECRET: randomBytes(32).toString("hex"), DB_HOST: "127.0.0.1", DB_PORT: "1", DB_USER: "", DB_NAME: "", DB_PASSWORD: "" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let log = "";
server.stdout.on("data", chunk => { log = (log + chunk).slice(-20000); });
server.stderr.on("data", chunk => { log = (log + chunk).slice(-20000); });
const checks = [];
try {
  for (let i = 0; !log.includes("Ready in"); i++) {
    if (server.exitCode !== null || i >= 120) throw new Error("El servidor local no arrancó; revisar runtime-server.log");
    await delay(500);
  }
  const cases = [
    ["/login", "GET", 200], ["/portal/login", "GET", 200], ["/cliente-portal/login", "GET", 200],
    ["/select-empresa", "GET", 307], ["/e/demo/dashboard-rrhh", "GET", 307], ["/e/demo/flota", "GET", 307], ["/e/demo/predios", "GET", 307],
    ["/api/auth/me", "GET", 401], ["/api/auth/login", "POST", 400],
    ["/api/empresas/demo/flota/combustible/cb2/consumos", "GET", 401],
    ["/api/empresas/demo/flota/combustible/cb2/preview", "POST", 401],
  ];
  for (const [url, method, expected] of cases) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, redirect: "manual", signal: AbortSignal.timeout(15000), headers: { cookie: "sitsa_session=invalid-test-token", "content-type": "application/json", origin: "https://invalid-origin.example" }, ...(method === "POST" ? { body: "{}" } : {}) });
    await response.arrayBuffer();
    const result = { path: url, method, expected, status: response.status, cacheControl: response.headers.get("cache-control"), location: response.headers.get("location")?.replace(`http://127.0.0.1:${port}`, "") ?? null };
    checks.push(result);
    if (response.status !== expected) throw new Error(`Respuesta inesperada ${method} ${url}: ${response.status} != ${expected}`);
    if (url.endsWith("/login") && method === "GET" && !result.cacheControl?.includes("no-store")) throw new Error("El login perdió no-store");
  }
  writeFileSync(output + "runtime-results.json", JSON.stringify({ node: process.version, mode: "production", host: "127.0.0.1", devDependenciesAbsent: devPackages, databaseConfigured: false, externalModuleFallback: false, checks }, null, 2) + "\n");
  console.log(`Runtime smoke: ${checks.length} comprobaciones correctas sin dependencias de desarrollo ni BD.`);
} finally {
  writeFileSync(output + "runtime-server.log", log);
  server.kill();
  await Promise.race([once(server, "exit"), delay(5000)]);
}
