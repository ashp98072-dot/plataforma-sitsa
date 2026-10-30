import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { validateSandboxConfig } from "../../scripts/sandbox-config.mjs";

/** Never expose a connection to application SQL before the read-only identity check. */
export function sandboxPool(raw: Pool): Pool {
  const snapshot = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]
    .map((key) => process.env[key]);
  function configIdentity() {
    const config = validateSandboxConfig();
    if (!config || ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]
      .some((key, index) => process.env[key] !== snapshot[index])) {
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
  return new Proxy(Object.create(null) as Pool, {
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
}
