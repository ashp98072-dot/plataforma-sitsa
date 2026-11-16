import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { validateSandboxConfig } from "../../scripts/sandbox-config.mjs";

const verifiedPools = new WeakSet<object>();
export function isSandboxVerifiedPool(pool: object): boolean { return verifiedPools.has(pool); }

/** Never expose a connection to application SQL before the read-only identity check. */
export function sandboxPool(raw: Pool): Pool {
  const snapshot = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]
    .map((key) => process.env[key]);
  // API-26: `validateSandboxConfig` hace lecturas de disco y un SHA-256 SÍNCRONOS (~18 ms por llamada) y se invocaba en CADA sentencia SQL: un GET (~100 sentencias) bloqueaba el event loop más de 1 s y una ráfaga
  // de 30–40 solicitudes superaba el límite de la solicitud (503). Ahora la validación COMPLETA se repite como máximo cada CONFIG_REVALIDATE_MS por pool y se vuelve a ejecutar de inmediato si cambia CUALQUIER
  // variable de entorno que la validación lee. La identidad de la BASE se sigue verificando antes de CADA sentencia (consulta a novalvion_environment); solo la relectura de archivos del manifiesto se espacia.
  const CONFIG_REVALIDATE_MS = 2000;
  const WATCHED_ENV = ["NOVALVION_ENV", "SANDBOX_ID", "SANDBOX_ROOT", "NEXT_TELEMETRY_DISABLED", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
    "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "AUTH_SECRET", "PORTAL_CREDENTIALS_KEY", "FEL_CREDENTIALS_KEY", "CB2_DOCUMENTOS_FASE2", "FLOTA_PROPIEDAD_EXTERNA", "CB2_PUBLIC_ORIGIN", "EMPRESA_DOMINIOS", "UPLOAD_DIR"];
  let validated: { key: string; at: number; config: NonNullable<ReturnType<typeof validateSandboxConfig>> } | null = null;
  function configIdentity() {
    const key = JSON.stringify(WATCHED_ENV.map((name) => process.env[name]));
    const now = Date.now();
    let config: ReturnType<typeof validateSandboxConfig>;
    if (validated && validated.key === key && now - validated.at >= 0 && now - validated.at < CONFIG_REVALIDATE_MS) config = validated.config;
    else {
      validated = null; config = validateSandboxConfig();   // lanza si algo no cumple
      if (config) validated = { key, at: now, config };
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
