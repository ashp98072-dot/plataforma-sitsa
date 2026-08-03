import { existsSync, readFileSync } from "fs";
import { join } from "path";

let loadedFromFile: string | null = null;

function applyEnvFile(filePath: string, override: boolean): boolean {
  if (!existsSync(filePath)) return false;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^\uFEFF/, "");
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
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  loadedFromFile = filePath;
  console.log(`[env] Loaded ${filePath}`);
  return true;
}

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    join(cwd, "..", "..", "..", "config", ".env"),
    join(cwd, "..", "..", "config", ".env"),
    join(cwd, "..", "config", ".env"),
    join(cwd, "..", "..", "..", "config", "app.env"),
    join(cwd, "..", "..", "config", "app.env"),
    join(cwd, ".env.production"),
    join(cwd, ".env"),
  ];
}

/** Carga .builds/config/.env (Hostinger) con prioridad sobre el panel. */
export function loadRuntimeEnv(): void {
  if (loadedFromFile) {
    applyEnvFile(loadedFromFile, true);
    return;
  }
  for (const file of candidatePaths()) {
    const isPersistent = /[/\\]config[/\\]/.test(file);
    if (applyEnvFile(file, isPersistent)) return;
  }
}
