import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { loadRuntimeEnv } from "./load-env";

let pool: Pool | null = null;

export type SqlValue = string | number | boolean | Date | null;
export type SqlParams = SqlValue[];

export function getPool(): Pool {
  if (pool) return pool;
  loadRuntimeEnv();
  const user = process.env.DB_USER;
  const database = process.env.DB_NAME;
  if (!user || !database) {
    throw new Error("Faltan DB_USER / DB_NAME en variables de entorno.");
  }
  // Hostinger: localhost/@'%' falla; forzar IPv4
  let host = (process.env.DB_HOST ?? "127.0.0.1").trim();
  if (host === "localhost") host = "127.0.0.1";
  pool = mysql.createPool({
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
  return pool;
}

export async function query<T extends RowDataPacket[]>(
  sql: string,
  params: SqlParams = [],
): Promise<T> {
  const [rows] = await getPool().query<T>(sql, params);
  return rows;
}

export async function execute(
  sql: string,
  params: SqlParams = [],
): Promise<ResultSetHeader> {
  const [result] = await getPool().execute<ResultSetHeader>(sql, params);
  return result;
}
