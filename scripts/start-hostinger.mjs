/**
 * Arranque Hostinger: carga .builds/config/.env y ejecuta next start.
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return false;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  console.log(`[start] Loaded env from ${filePath}`);
  return true;
}

const candidates = [
  join(root, "..", "config", ".env"),
  join(root, "..", "..", "config", ".env"),
  join(root, "..", "config", "app.env"),
  join(root, "..", "..", "config", "app.env"),
  join(root, ".env.production"),
  join(root, ".env"),
];

for (const file of candidates) {
  if (loadEnvFile(file)) break;
}

if (!process.env.DB_USER) {
  console.warn(
    "[start] DB_USER no definido. Crea .builds/config/.env en File Manager.",
  );
}

const port = process.env.PORT || "3000";
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
