import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { validateSandboxConfig } from "../../scripts/sandbox-config.mjs";

const verifiedPools = new WeakSet<object>();
export function isSandboxVerifiedPool(pool: object): boolean { return verifiedPools.has(pool); }

/** Never expose a connection to application SQL before the read-only identity check. */
export function sandboxPool(raw: Pool): Pool {
  const snapshot = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]
    .map((key) => process.env[key]);
  // API-26: `validateSandboxConfig` hace lecturas de disco y un SHA-256 SÍNCRONOS (~18 ms por llamada) y se invocaba en CADA sentencia SQL: un GET (~100 sentencias) bloqueaba el event loop más de 1 s y una ráfaga
  // de 30–40 solicitudes superaba el límite de la solicitud (503). La validación COMPLETA se reutiliza ahora con DOS niveles de detección, ambos antes de CADA sentencia:
  //  · INMEDIATO (sin ventana; ~0,3 ms): lo que decide A QUÉ BASE/CUENTA/ENTORNO se conecta y con qué secretos — NOVALVION_ENV, SANDBOX_ID, SANDBOX_ROOT, DB_HOST/PORT/NAME/USER/PASSWORD, AUTH_SECRET,
  //    PORTAL_CREDENTIALS_KEY — y la huella del MANIFIESTO (dispositivo, inodo, tamaño, mtime, ctime; un error al leerlo cuenta como cambio). Cualquier diferencia obliga a validar de nuevo en esa misma sentencia.
  //  · ACOTADO (≤ CONFIG_REVALIDATE_MS = 250 ms): el resto de lo que la validación comprueba — proxies, FEL/CB2/flota, origen y dominios, carpeta de cargas, raíz, `.env*` en el directorio de trabajo, enlaces
  //    simbólicos — se revalida de forma COMPLETA como máximo cada 250 ms (y siempre que cambie lo anterior). Es higiene del entorno que no cambia a qué base se conecta.
  // Si la validación lanza, la sentencia NO se ejecuta (falla cerrado) y un resultado fallido jamás se guarda. La caché es PRIVADA de cada pool (nunca se comparte entre pools ni entornos). La identidad de la BASE
  // (`novalvion_environment`) se verifica antes de CADA sentencia y la instantánea `DB_*` del pool rechaza siempre un cambio de destino, como antes.
  const CONFIG_REVALIDATE_MS = 250;
  const IMMEDIATE_ENV = ["NOVALVION_ENV", "SANDBOX_ID", "SANDBOX_ROOT", "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "AUTH_SECRET", "PORTAL_CREDENTIALS_KEY"];
  let validated: { key: string; manifest: string; at: number; config: NonNullable<ReturnType<typeof validateSandboxConfig>> } | null = null;
  function manifestFingerprint(): string {
    try { const st = lstatSync(join(process.env.SANDBOX_ROOT ?? "", "isolation.json")); return `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.isSymbolicLink()}`; }
    catch (error) { return `ERR:${(error as NodeJS.ErrnoException).code ?? "?"}`; }
  }
  function configIdentity() {
    const key = JSON.stringify(IMMEDIATE_ENV.map((name) => process.env[name]));
    const manifest = manifestFingerprint();
    const now = Date.now();
    let config: ReturnType<typeof validateSandboxConfig>;
    if (validated && validated.key === key && validated.manifest === manifest && now - validated.at >= 0 && now - validated.at < CONFIG_REVALIDATE_MS) config = validated.config;
    else {
      validated = null; config = validateSandboxConfig();   // lanza si algo no cumple (validación COMPLETA: archivos, hashes, rutas, entorno)
      if (config) validated = { key, manifest, at: now, config };
    }
    if (!config || ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]
      .some((name, index) => process.env[name] !== snapshot[index])) {
      validated = null;
      throw new Error("Configuración sandbox modificada durante la ejecución.");
    }
    return config;
  }
  async function verifiedConnection(): Promise<PoolConnection> {
    configIdentity();
    let conn: PoolConnection;
    try { conn = await raw.getConnection(); }
    catch { throw new Error("No se pudo conectar a la base sandbox."); }
    let closed = false;
    let busy = 0;
    async function verify() {
      if (closed) throw new Error("Conexión sandbox liberada.");
      try {
        const config = configIdentity();
        const [rows] = await conn.query<RowDataPacket[]>(
          "SELECT DATABASE() AS db, environment, sandbox_id FROM novalvion_environment WHERE id = 1",
        );
        if (rows.length !== 1 || rows[0].db !== process.env.DB_NAME ||
            rows[0].environment !== "sandbox" || rows[0].sandbox_id !== config.id) {
          throw new Error("identity");
        }
      } catch {
        closed = true;
        conn.destroy();
        throw new Error("No se pudo verificar la identidad de la base sandbox.");
      }
    }
    await verify();
    // Empty proxy target: descriptors/prototypes cannot expose the driver either.
    return new Proxy(Object.create(null) as PoolConnection, {
      get(_target, property) {
        if (property === "then") return undefined;
        if (property === "release" || property === "destroy") return () => {
          if (closed) return;
          closed = true;
          if (property === "destroy" || busy) conn.destroy();
          else conn.release();
        };
        if (["query", "execute", "beginTransaction", "commit", "rollback"].includes(String(property))) {
          return async (...args: unknown[]) => {
            if (closed) throw new Error("Conexión sandbox liberada.");
            busy++;
            try {
              await verify();
              if (closed) throw new Error("Conexión sandbox liberada.");
              return await Reflect.apply(conn[property as "query"], conn, args);
            } finally { busy--; }
          };
        }
        throw new Error("Operación de conexión no permitida en sandbox.");
      },
    });
  }
  // Restrict the facade to the API used by Novalvion. No raw pool escape hatch.
  const facade = new Proxy(Object.create(null) as Pool, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === "getConnection") return verifiedConnection;
      if (property === "end") return raw.end.bind(raw);
      if (property === "query" || property === "execute") {
        return async (...args: unknown[]) => {
          const conn = await verifiedConnection();
          try { return await Reflect.apply(conn[property], conn, args); }
          finally { conn.release(); }
        };
      }
      throw new Error("Operación de pool no permitida en sandbox.");
    },
  });
  verifiedPools.add(facade);
  return facade;
}
