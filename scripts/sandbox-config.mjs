import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

const fail = () => { throw new Error("Configuración sandbox inválida; revise el manifiesto privado y el aislamiento."); };

// No filesystem access on the legacy production path.
export function sandboxMode(env = process.env) {
  if (env.NOVALVION_ENV !== undefined && !["sandbox", "production"].includes(env.NOVALVION_ENV)) fail();
  if (env.NOVALVION_ENV !== "sandbox" && (env.SANDBOX_ROOT || env.SANDBOX_ID)) fail();
  return env.NOVALVION_ENV === "sandbox";
}

export function assertSandboxPath(root, target, mustExist = false) {
  if (!isAbsolute(root) || !isAbsolute(target)) fail();
  const base = resolve(root), path = resolve(target), rel = relative(base, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail();
  // Inspect ALL ancestors and the existing part of a future file path.
  let current = path;
  for (;;) {
    if (existsSync(current)) {
      if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) fail();
    } else if (mustExist && current === path) fail();
    else {
      try { if (lstatSync(current).isSymbolicLink()) fail(); } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path;
}

export function validateSandboxConfig(env = process.env, cwd = process.cwd()) {
  if (!sandboxMode(env)) return null;
  try {
    if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(env.SANDBOX_ID ?? "")) fail();
    const root = env.SANDBOX_ROOT;
    if (!root || !isAbsolute(root)) fail();
    assertSandboxPath(root, root, true);
    if (!lstatSync(root).isDirectory()) fail();
    // Next loads these itself: never permit a second source of runtime secrets.
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local"]) {
      if (existsSync(join(cwd, name))) fail();
    }
    const manifestPath = assertSandboxPath(root, join(root, "isolation.json"), true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.environment !== "sandbox" || manifest.id !== env.SANDBOX_ID) fail();
    if (env.NEXT_TELEMETRY_DISABLED !== "1" || ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].some((key) => env[key])) fail();
    if (env.DB_HOST !== "127.0.0.1" || !/^\d{1,5}$/.test(env.DB_PORT ?? "") || Number(env.DB_PORT) < 1 || Number(env.DB_PORT) > 65535) fail();
    for (const key of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER"]) {
      if (!env[key] || manifest.database?.[key] !== env[key]) fail();
    }
    for (const key of ["DB_NAME", "DB_USER"]) {
      if (!/^sandbox_[a-z0-9_]+$/.test(env[key])) fail();
    }
    const seen = new Set();
    for (const key of ["AUTH_SECRET", "DB_PASSWORD", "PORTAL_CREDENTIALS_KEY"]) {
      const value = env[key];
      if (!value || !value.startsWith(`sandbox:${env.SANDBOX_ID}:`) || !/^[a-f0-9]{64}$/.test(value.split(":")[2] ?? "") || value.split(":").length !== 3 || seen.has(value)) fail();
      seen.add(value);
      if (manifest.secretSha256?.[key] !== createHash("sha256").update(value).digest("hex")) fail();
    }
    if (env.FEL_CREDENTIALS_KEY || (env.CB2_DOCUMENTOS_FASE2 && env.CB2_DOCUMENTOS_FASE2 !== "0") || (env.FLOTA_PROPIEDAD_EXTERNA && env.FLOTA_PROPIEDAD_EXTERNA !== "0")) fail();
    const origin = new URL(env.CB2_PUBLIC_ORIGIN ?? "");
    if (origin.protocol !== "https:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || origin.origin !== env.CB2_PUBLIC_ORIGIN || manifest.origin !== origin.origin) fail();
    const domains = JSON.parse(env.EMPRESA_DOMINIOS ?? "null");
    if (!domains || Array.isArray(domains) || typeof domains !== "object" || Object.entries(domains).some(([host, slug]) => !["localhost", "127.0.0.1", "[::1]"].includes(host) || slug !== "kt-monaco")) fail();
    if (env.UPLOAD_DIR !== join(root, "uploads")) fail();
    const uploads = assertSandboxPath(root, env.UPLOAD_DIR, true);
    if (!lstatSync(uploads).isDirectory()) fail();
    return { id: manifest.id, root, uploads };
  } catch { fail(); }
}
