/** Utilidades exclusivas de QA. No se importan desde módulos productivos. */
import { createHash, randomUUID } from "node:crypto";
import type { Connection, Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export function laboratorio(env: Record<string, string | undefined>) {
  const port = Number(env.LIQ_TEST_DB_PORT);
  const alias = env.MIL_CXP05_LAB_ID ?? "";
  const fingerprint = env.MIL_CXP05_DATADIR_SHA256 ?? "";
  if (![3399, 3407].includes(port)) throw Error("Solo laboratorio loopback 3399/3407");
  if (!/^qa-desechable-[a-z0-9-]{1,40}$/.test(alias)) throw Error("Falta identificar y autorizar el laboratorio desechable");
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw Error("Falta huella del datadir autorizado");
  return { host: "127.0.0.1", port, alias, fingerprint, user: env.MIL_CXP05_DB_USER ?? "root", password: env.MIL_CXP05_DB_PASSWORD ?? "" };
}
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export function validarServidor(version: string, port: number, datadir: string, cfg: ReturnType<typeof laboratorio>) {
  if (!/^11\.8\.9-MariaDB(?:[-+.]|$)/.test(version) || port !== cfg.port || sha256(datadir) !== cfg.fingerprint) {
    throw Error("Identidad de MariaDB desechable no coincide; no crear base");
  }
}
export const nuevaIdentidad = () => ({ db: `cxp_qa05_${randomUUID().replaceAll("-", "")}`, token: randomUUID() });
export function identificador(db: string) {
  if (!/^cxp_qa05_[a-f0-9]{32}$/.test(db)) throw Error("Nombre fuera del espacio temporal de esta suite");
  return `\`${db}\``;
}
/** Nunca adoptar una base existente: CREATE sin IF NOT EXISTS y marcador secreto de esta ejecución. */
export async function eliminarPropia(admin: Connection, identity: ReturnType<typeof nuevaIdentidad>, created: boolean) {
  const name = identificador(identity.db);
  if (!created) return false;
  const [r] = await admin.query<RowDataPacket[]>(`SELECT token FROM ${name}.qa_ownership`);
  if (r.length !== 1 || r[0].token !== identity.token) throw Error("Identidad temporal perdida; eliminación bloqueada");
  await admin.query(`DROP DATABASE ${name}`);
  return true;
}
/** Parser restringido al formato DELIMITER de las dos migraciones versionadas. */
export function sentencias(texto: string) {
  let delimiter = ";", buffer = "";
  const out: string[] = [];
  for (const line of texto.split(/\r?\n/)) {
    const d = line.trim().match(/^DELIMITER (.+)$/);
    if (d) { if (buffer.replace(/--[^\n]*/g, "").trim()) throw Error("DELIMITER dentro de sentencia"); delimiter = d[1]; continue; }
    buffer += `${line}\n`;
    if (line.trimEnd().endsWith(delimiter)) {
      const stmt = buffer.slice(0, buffer.lastIndexOf(delimiter)).trim();
      if (stmt.replace(/--[^\n]*/g, "").trim()) out.push(stmt);
      buffer = "";
    }
  }
  if (buffer.replace(/--[^\n]*/g, "").trim()) throw Error("Migración incompleta");
  return out;
}
export function barrera() {
  let abrir!: () => void;
  const esperar = new Promise<void>(resolve => { abrir = resolve; });
  return { esperar, abrir };
}
/** Observa consultas REALES después del motor; jamás sustituye resultados SQL. */
export function observarPool(pool: Pool, after: (c: PoolConnection, sql: string) => Promise<void>, released: () => void, before?: (c: PoolConnection) => Promise<void>): Pool {
  return new Proxy(pool, { get(target, key) {
    if (key === "getConnection") return async () => {
      const c = await target.getConnection();
      try { await before?.(c); } catch (e) { c.release(); throw e; }
      return new Proxy(c, { get(conn, prop) {
        if (prop === "query") return async (...args: Parameters<PoolConnection["query"]>) => {
          const result = await conn.query(...args);
          await after(conn, typeof args[0] === "string" ? args[0] : args[0].sql);
          return result;
        };
        if (prop === "release") return () => { conn.release(); released(); };
        const value = Reflect.get(conn, prop);
        return typeof value === "function" ? value.bind(conn) : value;
      } });
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
