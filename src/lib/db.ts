import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { loadRuntimeEnv } from "./load-env";
import { sandboxMode } from "../../scripts/sandbox-config.mjs";
import { sandboxPool } from "./sandbox-db";
import { alcanceActual, registrarConfigControl } from "./db-plazo";

let pool: Pool | null = null;
let poolSandbox: boolean | null = null;

export type SqlValue = string | number | boolean | Date | null;
export type SqlParams = SqlValue[];

export function getPool(): Pool {
  if (pool) {
    if (sandboxMode() !== poolSandbox) throw new Error("No se puede cambiar el entorno de un pool activo.");
    if (sandboxMode()) loadRuntimeEnv();
    return pool;
  }
  loadRuntimeEnv();
  const user = process.env.DB_USER;
  const database = process.env.DB_NAME;
  if (!user || !database) {
    throw new Error("Faltan DB_USER / DB_NAME en variables de entorno.");
  }
  // Hostinger: localhost/@'%' falla; forzar IPv4
  let host = (process.env.DB_HOST ?? "127.0.0.1").trim();
  if (host === "localhost") host = "127.0.0.1";
  const raw = mysql.createPool({
    host,
    port: Number(process.env.DB_PORT ?? "3306"),
    user,
    password: process.env.DB_PASSWORD ?? "",
    database,
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 50,
    enableKeepAlive: true,
    timezone: "local",
  });
  poolSandbox = sandboxMode();
  pool = poolSandbox ? sandboxPool(raw) : raw;
  // Conexión de CONTROL (KILL QUERY) independiente del pool, solo para cancelar sentencias vencidas (db-plazo). Nunca en modo sandbox.
  registrarConfigControl(poolSandbox ? null : { host, port: Number(process.env.DB_PORT ?? "3306"), user, password: process.env.DB_PASSWORD ?? "", database });
  return pool;
}

export async function query<T extends RowDataPacket[]>(
  sql: string,
  params: SqlParams = [],
): Promise<T> {
  // Dentro de `conPlazo` (db-plazo.ts) la sentencia pasa por la conexión dedicada de esa operación (con plazo y cancelación); fuera, igual que siempre.
  const alcance = alcanceActual();
  if (alcance) return ((await alcance.consultar(sql, params, "query")) as [T, unknown])[0];
  const [rows] = await getPool().query<T>(sql, params);
  return rows;
}

export async function execute(
  sql: string,
  params: SqlParams = [],
): Promise<ResultSetHeader> {
  const alcance = alcanceActual();
  if (alcance) return ((await alcance.consultar(sql, params, "execute")) as [ResultSetHeader, unknown])[0];
  const [result] = await getPool().execute<ResultSetHeader>(sql, params);
  return result;
}
