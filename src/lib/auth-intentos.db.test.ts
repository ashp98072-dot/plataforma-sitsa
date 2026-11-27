// A4 contra MariaDB 11.8.9 REAL y desechable (tubería con nombre, sin red). Se omite sin AUTH_INTENTOS_DB_PIPE.
// Aplica la MIGRACIÓN REAL (dos veces: idempotente), ejecuta el POSTCHECK real y ejercita el módulo REAL con varias conexiones y dos «instancias» (dos pools).
import { readFileSync } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const pipe = process.env.AUTH_INTENTOS_DB_PIPE ?? "";
const LAB = "auth_intentos_lab";
const B = String.fromCharCode(92);
const socketPath = `${B}${B}.${B}pipe${B}${pipe}`;

const pools = vi.hoisted(() => ({ actual: null as import("mysql2/promise").Pool | null }));
/** «Instancia» de la aplicación por contexto asíncrono: cada intento usa SU pool de principio a fin (dos instancias = dos pools independientes). */
const instancia = new AsyncLocalStorage<Pool>();   // solo se lee al LLAMAR a getPool (después de inicializarse)
vi.mock("@/lib/db", () => ({ getPool: () => { const p = instancia.getStore() ?? pools.actual; if (!p) throw new Error("sin pool"); return p; } }));

import { bloqueoVigente, claveHmac, ErrorProteccionLogin, leerConfigIntentos, limpiarIntentos, llavesDe, protegerLogin, type ConfigIntentos } from "./auth-intentos";

const nuevaInstancia = (limite = 10) => mysql.createPool({ socketPath, user: "root", password: "", database: LAB, connectionLimit: limite, waitForConnections: true });
const SECRETO = "s".repeat(16) + "-secreto-de-prueba-a4-0123456789";
const cfg = (extra: Partial<ConfigIntentos> = {}): ConfigIntentos => ({ ...leerConfigIntentos({ AUTH_INTENTOS_PROTECCION: "1", AUTH_INTENTOS_SECRETO: SECRETO }), probabilidadLimpieza: 0, ...extra });
const hdr = (ip?: string) => new Headers(ip ? { "x-forwarded-for": `203.0.113.250, ${ip}` } : {});
let admin: mysql.Connection;
const R = async (sql: string, args: unknown[] = []) => (await admin.query<RowDataPacket[]>(sql, args))[0];
const migracion = readFileSync(path.join("sql", "migrate-2026-12-auth-intentos-login.sql"), "utf8");
const postcheck = readFileSync(path.join("sql", "postcheck-2026-12-auth-intentos-login.sql"), "utf8");

/** Intento de login como lo hace la ruta: `ok` decide si la contraseña es correcta; cuenta cuántas veces se llegó a verificar. */
let verificaciones = 0;
const intento = (identificador: string, ok: boolean, ip?: string, c = cfg(), alcance: "staff" | "colaborador" | "cliente" = "cliente") =>
  protegerLogin({ alcance, identificador, headers: hdr(ip) }, async () => { verificaciones++; return ok ? { id: 1 } : null; }, c);
const filaId = async (identificador: string, alcance = "cliente") =>
  (await R(`SELECT * FROM ${LAB}.auth_intentos_login WHERE alcance = ? AND tipo = 'ID' AND clave = ?`, [alcance, claveHmac(SECRETO, ["login-id", alcance, identificador.trim().toLowerCase()])]))[0];
const expirarBloqueos = () => admin.query(`UPDATE ${LAB}.auth_intentos_login SET bloqueado_hasta = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE bloqueado_hasta IS NOT NULL`);

describe.skipIf(!pipe)("A4 intentos de login (MariaDB 11.8.9 real)", () => {
  beforeAll(async () => {
    admin = await mysql.createConnection({ socketPath, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
    await admin.query(`DROP DATABASE IF EXISTS ${LAB}; CREATE DATABASE ${LAB}; USE ${LAB}`);
    await admin.query(migracion); await admin.query(migracion);   // idempotente
    pools.actual = nuevaInstancia();
  });
  afterAll(async () => { await pools.actual?.end(); await admin?.query(`DROP DATABASE IF EXISTS ${LAB}`).catch(() => undefined); await admin?.end(); });
  beforeEach(async () => { await admin.query(`DELETE FROM ${LAB}.auth_intentos_login`); verificaciones = 0; });

  it("MIGRACIÓN idempotente y POSTCHECK real: tabla InnoDB, 8 columnas, PK de 3 columnas, índice de limpieza y 2 CHECK; la tabla rechaza claves que no sean HMAC hex", async () => {
    const [res] = await admin.query<RowDataPacket[][]>(postcheck);
    expect(res[0][0]).toMatchObject({ tabla_innodb_esperado_1: 1, columnas_esperado_8: 8, columnas_pk_esperado_3: 3, indice_limpieza_esperado_1: 1, checks_esperado_2: 2 });
    await expect(admin.query(`INSERT INTO ${LAB}.auth_intentos_login (alcance, tipo, clave, ventana_inicio, actualizado) VALUES ('cliente', 'ID', 'juan@x.com', NOW(), NOW())`)).rejects.toThrow();
    await expect(admin.query(`INSERT INTO ${LAB}.auth_intentos_login (alcance, tipo, clave, ventana_inicio, actualizado) VALUES ('otro', 'ID', REPEAT('a', 64), NOW(), NOW())`)).rejects.toThrow();
  });

  it("CINCO fallos ⇒ bloqueo de 60 s con Retry-After; durante el bloqueo NO se verifica la contraseña (ni la correcta) y no se alarga; al vencer, el reintento legítimo entra y reinicia el contador", async () => {
    for (let i = 1; i <= 4; i++) expect(await intento("ana@cliente.com", false, "198.51.100.7")).toEqual({ tipo: "credenciales" });
    expect((await filaId("ana@cliente.com")).fallos).toBe(4);
    expect(await intento("ana@cliente.com", false, "198.51.100.7")).toEqual({ tipo: "credenciales" });   // 5.º: abre el bloqueo
    const r = await intento("ana@cliente.com", true, "198.51.100.7");
    expect(r.tipo).toBe("bloqueado"); expect((r as { retryAfterS: number }).retryAfterS).toBeGreaterThanOrEqual(55); expect((r as { retryAfterS: number }).retryAfterS).toBeLessThanOrEqual(60);
    expect(verificaciones).toBe(5);   // la 6.ª (con la contraseña correcta) no se verificó
    const antes = (await filaId("ana@cliente.com")).bloqueado_hasta; await intento("ana@cliente.com", false); expect((await filaId("ana@cliente.com")).bloqueado_hasta).toEqual(antes);
    await expirarBloqueos();
    expect((await intento("ana@cliente.com", true, "198.51.100.7")).tipo).toBe("ok");
    expect(await filaId("ana@cliente.com")).toBeUndefined();   // contador del identificador reiniciado
    expect(await R(`SELECT fallos FROM ${LAB}.auth_intentos_login WHERE tipo = 'IP'`)).toEqual([{ fallos: 5 }]);   // el de la IP NO se limpia con un éxito
  });

  it("BLOQUEO PROGRESIVO del identificador: 60, 120, 240, 480 y 900 s como máximo (nunca más de 15 min)", async () => {
    const duraciones: number[] = [];
    for (let n = 0; n < 6; n++) {
      for (let i = 0; i < 5; i++) await intento("beto", false, undefined, cfg(), "staff");
      const [f] = await R(`SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(6), bloqueado_hasta) AS s, bloqueos FROM ${LAB}.auth_intentos_login WHERE tipo = 'ID'`);
      duraciones.push(Math.round(Number(f.s) / 60)); await expirarBloqueos();
    }
    expect(duraciones).toEqual([1, 2, 4, 8, 15, 15]);
  });

  it("ENUMERACIÓN: un identificador INEXISTENTE se cuenta y se bloquea exactamente igual que uno existente; variantes de mayúsculas y espacios son el MISMO contador", async () => {
    for (let i = 0; i < 5; i++) await intento(i % 2 ? "  NoExiste@Cliente.COM " : "noexiste@cliente.com", false);
    expect((await intento("noexiste@cliente.com", false)).tipo).toBe("bloqueado");
    for (let i = 0; i < 5; i++) await intento("existe@cliente.com", false);
    expect((await intento("existe@cliente.com", false)).tipo).toBe("bloqueado");
    expect(await R(`SELECT bloqueos, fallos FROM ${LAB}.auth_intentos_login WHERE tipo = 'ID' ORDER BY clave`)).toEqual([{ bloqueos: 1, fallos: 0 }, { bloqueos: 1, fallos: 0 }]);
  });

  it("IP COMPARTIDA (NAT): 29 fallos de 29 personas distintas no bloquean a nadie; el usuario legítimo de esa oficina entra; el 30.º bloquea la IP solo 5 min y otra IP sigue sin afectación", async () => {
    const OFICINA = "192.0.2.10";
    for (let i = 0; i < 29; i++) await intento(`persona${i}@cliente.com`, false, OFICINA);
    expect((await intento("legitimo@cliente.com", true, OFICINA)).tipo).toBe("ok");
    await intento("persona29@cliente.com", false, OFICINA);   // 30.º fallo de la IP
    const r = await intento("legitimo@cliente.com", true, OFICINA);
    expect(r.tipo).toBe("bloqueado"); expect((r as { retryAfterS: number }).retryAfterS).toBeGreaterThan(240); expect((r as { retryAfterS: number }).retryAfterS).toBeLessThanOrEqual(300);
    expect((await intento("legitimo@cliente.com", true, "192.0.2.99")).tipo).toBe("ok");
    expect((await intento("legitimo@cliente.com", true)).tipo).toBe("ok");   // sin IP identificable: solo cuenta el identificador
    expect(await R(`SELECT COUNT(*) AS n FROM ${LAB}.auth_intentos_login WHERE tipo = 'ID' AND bloqueado_hasta IS NOT NULL`)).toEqual([{ n: 0 }]);   // ninguna cuenta individual bloqueada
  });

  it("CONCURRENCIA REAL con varias conexiones y DOS instancias: 60 fallos simultáneos sobre el mismo usuario e IP abren UN solo bloqueo de cada tipo, sin errores ni filas duplicadas", async () => {
    const otraInstancia = nuevaInstancia(10);
    try {
      const c = cfg();
      let usosOtra = 0;
      const tarea = (i: number) => (i % 2 ? instancia.run(otraInstancia, () => { usosOtra++; return intento("carla@cliente.com", false, "198.51.100.20", c); }) : intento("carla@cliente.com", false, "198.51.100.20", c));
      const res = await Promise.all(Array.from({ length: 60 }, (_, i) => tarea(i)));
      expect(res.every((r) => r.tipo === "credenciales" || r.tipo === "bloqueado")).toBe(true);
      const filas = await R(`SELECT tipo, bloqueos, bloqueado_hasta IS NOT NULL AS bloqueado FROM ${LAB}.auth_intentos_login ORDER BY tipo`);
      expect(filas).toEqual([{ tipo: "ID", bloqueos: 1, bloqueado: 1 }, { tipo: "IP", bloqueos: 1, bloqueado: 1 }]);
      expect((await intento("carla@cliente.com", true, "198.51.100.20")).tipo).toBe("bloqueado");
      expect(usosOtra).toBe(30);
      const [[conexiones]] = await admin.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE DB = ?", [LAB]); expect(Number(conexiones.n)).toBeGreaterThan(2);   // varias conexiones reales abiertas
    } finally { await otraInstancia.end(); }
  });

  it("CONCURRENCIA sin pérdidas: 40 fallos simultáneos (por debajo del umbral, dos instancias) quedan contados EXACTAMENTE 40 en el identificador y en la IP", async () => {
    const otraInstancia = nuevaInstancia(10);
    try {
      const c = cfg({ idMax: 50, ipMax: 100 });
      await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? instancia.run(otraInstancia, () => intento("diego@cliente.com", false, "198.51.100.40", c)) : intento("diego@cliente.com", false, "198.51.100.40", c))));
      expect(await R(`SELECT tipo, fallos, bloqueos FROM ${LAB}.auth_intentos_login ORDER BY tipo`)).toEqual([{ tipo: "ID", fallos: 40, bloqueos: 0 }, { tipo: "IP", fallos: 40, bloqueos: 0 }]);
    } finally { await otraInstancia.end(); }
  });

  it("REINICIO de la aplicación: el bloqueo vive en la base y sigue vigente con un pool nuevo (otra instancia/arranque)", async () => {
    for (let i = 0; i < 5; i++) await intento("dora", false, undefined, cfg(), "colaborador");
    await pools.actual!.end(); pools.actual = nuevaInstancia();
    expect((await intento("dora", true, undefined, cfg(), "colaborador")).tipo).toBe("bloqueado");
  });

  it("ALCANCES separados: los fallos en el portal de clientes no bloquean el mismo identificador en staff ni en colaboradores", async () => {
    for (let i = 0; i < 5; i++) await intento("eva", false, undefined, cfg(), "cliente");
    expect((await intento("eva", true, undefined, cfg(), "staff")).tipo).toBe("ok");
    expect((await intento("eva", true, undefined, cfg(), "colaborador")).tipo).toBe("ok");
  });

  it("PRIVACIDAD: la tabla solo contiene HMAC hex de 64; ni el correo ni la IP aparecen en claro, y otro secreto produce claves distintas", async () => {
    await intento("fernanda@cliente.com", false, "198.51.100.33");
    const filas = await R(`SELECT * FROM ${LAB}.auth_intentos_login`);
    const texto = JSON.stringify(filas); expect(texto).not.toMatch(/fernanda|cliente\.com|198\.51\.100\.33/);
    for (const f of filas) expect(String(f.clave)).toMatch(/^[0-9a-f]{64}$/);
    expect(llavesDe(cfg(), "cliente", "fernanda@cliente.com", null).id).not.toBe(llavesDe(cfg({ secreto: "x".repeat(40) }), "cliente", "fernanda@cliente.com", null).id);
  });

  it("FALLA CERRADO: con la protección activa, tabla AUSENTE o error SQL ⇒ ErrorProteccionLogin y NUNCA se verifica la contraseña; sin secreto válido ⇒ también; con la protección apagada el login funciona sin tabla", async () => {
    await admin.query(`RENAME TABLE ${LAB}.auth_intentos_login TO ${LAB}.auth_intentos_login_aparte`);
    try {
      await expect(intento("gina", true)).rejects.toMatchObject({ name: "ErrorProteccionLogin", codigo: "TABLA_INUTILIZABLE" });
      expect(verificaciones).toBe(0);
      expect((await intento("gina", true, undefined, cfg({ activa: false }))).tipo).toBe("ok");
      expect((await intento("gina", false, undefined, cfg({ activa: false }))).tipo).toBe("credenciales");
    } finally { await admin.query(`RENAME TABLE ${LAB}.auth_intentos_login_aparte TO ${LAB}.auth_intentos_login`); }
    await expect(intento("gina", true, undefined, cfg({ secreto: "corto" }))).rejects.toBeInstanceOf(ErrorProteccionLogin);
    // error SQL tras verificar (p. ej. la tabla desaparece entre la lectura y el registro): también es 503, no un éxito ni un 500 con detalles
    const c = cfg();
    await expect(protegerLogin({ alcance: "cliente", identificador: "gina", headers: hdr() }, async () => { await admin.query(`RENAME TABLE ${LAB}.auth_intentos_login TO ${LAB}.auth_intentos_login_aparte`); return null; }, c))
      .rejects.toMatchObject({ codigo: "TABLA_INUTILIZABLE" });
    await admin.query(`RENAME TABLE ${LAB}.auth_intentos_login_aparte TO ${LAB}.auth_intentos_login`);
  });

  it("LIMPIEZA acotada: borra lo inactivo más allá de la retención, conserva los bloqueos vigentes y recorta por encima del máximo de filas", async () => {
    await intento("hugo", false); for (let i = 0; i < 5; i++) await intento("ines", false);
    await admin.query(`UPDATE ${LAB}.auth_intentos_login SET actualizado = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 2 DAY)`);
    expect(await limpiarIntentos(cfg())).toBe(1);   // «hugo» se va; «ines» sigue bloqueada
    expect(await bloqueoVigente(llavesDe(cfg(), "cliente", "ines", null))).toBeGreaterThan(0);
    for (let i = 0; i < 12; i++) await intento(`masivo${i}`, false);
    expect(await limpiarIntentos(cfg({ maxFilas: 1000 }))).toBe(0);
    await admin.query(`INSERT INTO ${LAB}.auth_intentos_login (alcance, tipo, clave, ventana_inicio, actualizado) SELECT 'cliente', 'ID', SHA2(seq, 256), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) FROM seq_1_to_1100`);
    expect(await limpiarIntentos(cfg({ maxFilas: 1000 }))).toBe(1000);   // una pasada recorta como máximo 1000
    expect(await bloqueoVigente(llavesDe(cfg(), "cliente", "ines", null))).toBeGreaterThan(0);   // los bloqueos vigentes nunca se recortan
  });
});
