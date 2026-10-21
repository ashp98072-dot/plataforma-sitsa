import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CONCURRENCIA REAL DEL SERVICIO DE ENTREGAS CONTRA UNA BASE DESECHABLE (corrección del deadlock hallado en PR #446).
 *
 * Se OMITE por defecto. Solo corre con `ENTREGAS_DB_PORT` apuntando a una MariaDB LOCAL y DESECHABLE (127.0.0.1) con el esquema
 * `u611730801_Plataforma`, las tablas de Fondos/Gastos/Compras, firmas_electronicas y sql/migrate-2026-10-documento-entregas.sql.
 * Nunca lee .env ni usa credenciales reales (root sin contraseña, fijo a 127.0.0.1). Los archivos de firma se simulan.
 *
 * La concurrencia es REAL: cada petición toma su propia conexión del pool y se lanzan con Promise.all. Ejecutar SIN paralelismo
 * entre archivos (`--no-file-parallelism`) para no mezclar este trabajo con el de otros archivos de BD.
 *
 * Qué demuestran:
 *  A/B  emisiones simultáneas de documentos DISTINTOS (misma empresa / empresas distintas): 0 deadlocks y todas se crean;
 *  C    el MISMO documento con claves distintas: una sola pendiente, el resto recibe 409;
 *  D    la MISMA clave: una sola entrega y una sola firma; todas devuelven la original;
 *  E    cerrar (recibir) vs una nueva emisión del mismo documento: nunca dos pendientes ni custodia futura incorrecta.
 */
const PUERTO = process.env.ENTREGAS_DB_PORT;
const ESQUEMA = process.env.ENTREGAS_DB_SCHEMA ?? "u611730801_Plataforma";
/** Rondas por escenario: suficientes para reproducir el deadlock anterior de forma consistente. */
const RONDAS = Number(process.env.ENTREGAS_RONDAS ?? 30);

vi.mock("@/lib/db", async () => {
  const mysql = await import("mysql2/promise");
  let pool: ReturnType<typeof mysql.createPool> | null = null;
  const obtener = () => {
    if (!pool) {
      pool = mysql.createPool({
        host: "127.0.0.1", port: Number(process.env.ENTREGAS_DB_PORT), user: "root", password: "",
        database: process.env.ENTREGAS_DB_SCHEMA ?? "u611730801_Plataforma", connectionLimit: 30, timezone: "local",
      });
    }
    return pool;
  };
  return {
    getPool: obtener,
    query: async (sql: string, params: unknown[] = []) => (await obtener().query(sql, params as never))[0],
    execute: async (sql: string, params: unknown[] = []) => (await obtener().execute(sql, params as never))[0],
  };
});
const archivos = vi.hoisted(() => ({ guardados: [] as string[], borrados: [] as string[], n: 0 }));
vi.mock("@/lib/uploads", () => ({
  guardarUpload: vi.fn(async (empresaId: number, _s: string, prefijo: string, f: { name: string; size: number }) => {
    const relative = `empresas/${empresaId}/firmas/${prefijo}_${++archivos.n}.png`;
    archivos.guardados.push(relative);
    return { relative, original: f.name, size: f.size };
  }),
  borrarUpload: vi.fn((r: string) => { archivos.borrados.push(r); }),
}));

import { getPool } from "@/lib/db";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { VERSION_PERMISOS } from "@/lib/permisos-catalogo";
import { MENSAJES_ENTREGA, confirmarRecepcion, listarEntregasDocumento, registrarEntrega, type FirmaEntregaInput } from "./entregas";
import type { AreaEntrega } from "./catalogo";
import type { ActorEntrega } from "./reglas";

const EMPRESA_A = 9901;
const EMPRESA_B = 9902;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).buffer;
const firma = (): FirmaEntregaInput => ({ origen: "GUARDADA", imagen: { bytes: PNG, original: "firma.png" } });
const fila = (modulo: string): PermisoModulo => ({ modulo, puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false });
const matriz = (...m: string[]): PermisoModulo[] => [
  { modulo: VERSION_PERMISOS, puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false }, ...m.map(fila),
];
const U = { ops: 9911, ops2: 9912, tes: 9913, tes2: 9914, cont: 9915 };
const actor = (id: number, username: string, ...permisos: string[]): ActorEntrega =>
  ({ usuarioId: id, username, nombre: `Usuario ${username}`, rol: "Operaciones", esAdmin: false, permisos: matriz(...permisos) });
const ops = actor(U.ops, "cc_ops", "fondos_entrega_emitir");
const ops2 = actor(U.ops2, "cc_ops2", "fondos_entrega_emitir");
const tes = actor(U.tes, "cc_tes", "entregas_area_tesoreria");
const tes2 = actor(U.tes2, "cc_tes2", "entregas_area_tesoreria");

let claveN = 0;
const clave = () => `clave_cc_${process.pid}_${++claveN}`.padEnd(20, "x").slice(0, 64);
let codigoN = 0;

async function fondos(empresa: number, cantidad: number, estado = "Autorizada"): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < cantidad; i++) {
    const [r] = await getPool().query(
      "INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado) VALUES (?, ?, '2026-10-01', ?)",
      [empresa, `CC-${process.pid}-${++codigoN}`, estado]);
    ids.push(Number((r as { insertId: number }).insertId));
  }
  return ids;
}
const emitir = (empresaId: number, quien: ActorEntrega, entidadId: number, destino: AreaEntrega = "TESORERIA", claveIdempotencia = clave()) =>
  registrarEntrega({ empresaId, actor: quien, modulo: "FONDOS", entidadId, destino, modo: "SISTEMA", observaciones: null, claveIdempotencia, firma: firma() });
const recibir = (empresaId: number, quien: ActorEntrega, entregaId: number) =>
  confirmarRecepcion({ empresaId, actor: quien, entregaId, firma: { origen: "DIBUJADA", imagen: { bytes: PNG, original: "f.png" } } });

type Resultado = PromiseSettledResult<unknown>;
const deadlocks = (rs: Resultado[]) => rs.filter((r) => r.status === "rejected" && ((r.reason as { code?: string; errno?: number })?.code === "ER_LOCK_DEADLOCK" || (r.reason as { errno?: number })?.errno === 1213)).length;
const rechazadasCon = (rs: Resultado[], status: number) => rs.filter((r) => r.status === "rejected" && (r.reason as { status?: number })?.status === status).length;
const cumplidas = (rs: Resultado[]) => rs.filter((r) => r.status === "fulfilled").length;

async function contar(sql: string, params: unknown[] = []) {
  const [r] = await getPool().query(sql, params as never);
  return Number((r as { n: number }[])[0].n);
}
async function limpiar() {
  const pool = getPool();
  await pool.query("DELETE FROM documento_entregas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  await pool.query("DELETE FROM firmas_electronicas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  await pool.query("DELETE FROM auditoria WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
}

describe.skipIf(!PUERTO)(`Concurrencia del servicio de entregas contra BD real desechable (${ESQUEMA}) — ${RONDAS} rondas por escenario`, () => {
  beforeAll(async () => {
    const pool = getPool();
    for (const e of [EMPRESA_A, EMPRESA_B]) await pool.query("INSERT IGNORE INTO empresas (id, codigo, nombre, slug) VALUES (?, ?, ?, ?)", [e, `E${e}`, `Prueba ${e}`, `prueba-cc-${e}`]);
    for (const [k, id] of Object.entries(U)) {
      await pool.query("INSERT IGNORE INTO usuarios (id, username, password_hash, salt, nombre, rol_global) VALUES (?, ?, 'x', 'x', ?, 'Operaciones')", [id, `cc_${k}`, `Usuario ${k}`]);
    }
    await limpiar();
    await pool.query("DELETE FROM tms_solicitudes_fondo WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  });
  beforeEach(async () => {
    archivos.guardados.length = 0; archivos.borrados.length = 0;
    await limpiar(); // cada escenario parte limpio: las comprobaciones de firmas/archivos son por empresa
  });
  afterAll(async () => {
    await limpiar();
    await getPool().end();
  });

  it("A. DOCUMENTOS DISTINTOS, MISMA EMPRESA: emisiones simultáneas → 0 deadlocks y todas se crean", async () => {
    let observados = 0;
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const docs = await fondos(EMPRESA_A, 6);
      const rs = await Promise.allSettled(docs.map((d, i) => emitir(EMPRESA_A, i % 2 ? ops : ops2, d, i % 3 ? "TESORERIA" : "CONTABILIDAD")));
      observados += deadlocks(rs);
      expect(cumplidas(rs), `ronda ${ronda}`).toBe(6);
      const [filas] = await getPool().query(
        `SELECT entidad_id, COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND estado = 'EMITIDA' AND entidad_id IN (${docs.join(",")}) GROUP BY entidad_id`, [EMPRESA_A]);
      expect((filas as { n: number }[]).map((f) => Number(f.n))).toEqual([1, 1, 1, 1, 1, 1]);
    }
    console.info(`[A] rondas=${RONDAS} emisiones=${RONDAS * 6} deadlocks=${observados}`);
    expect(observados).toBe(0);
  });

  it("B. DOCUMENTOS DISTINTOS, EMPRESAS DISTINTAS: emisiones simultáneas → 0 deadlocks", async () => {
    let observados = 0;
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const [da, db] = [await fondos(EMPRESA_A, 3), await fondos(EMPRESA_B, 3)];
      const rs = await Promise.allSettled([
        ...da.map((d) => emitir(EMPRESA_A, ops, d)),
        ...db.map((d) => emitir(EMPRESA_B, ops2, d)),
      ]);
      observados += deadlocks(rs);
      expect(cumplidas(rs), `ronda ${ronda}`).toBe(6);
      expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE estado = 'EMITIDA' AND empresa_id = ? AND entidad_id IN (?)", [EMPRESA_A, da])).toBe(3);
      expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE estado = 'EMITIDA' AND empresa_id = ? AND entidad_id IN (?)", [EMPRESA_B, db])).toBe(3);
    }
    console.info(`[B] rondas=${RONDAS} emisiones=${RONDAS * 6} deadlocks=${observados}`);
    expect(observados).toBe(0);
  });

  it("C. MISMO DOCUMENTO, claves distintas: nunca dos pendientes; una gana y el resto recibe 409 (resultado verificado en BD)", async () => {
    let observados = 0;
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const [doc] = await fondos(EMPRESA_A, 1);
      const rs = await Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
        emitir(EMPRESA_A, i % 2 ? ops : ops2, doc, i % 3 ? "TESORERIA" : "CONTABILIDAD")));
      observados += deadlocks(rs);
      expect(cumplidas(rs), `ronda ${ronda}`).toBe(1);
      for (const r of rs) {
        if (r.status === "rejected") expect(r.reason).toMatchObject({ message: MENSAJES_ENTREGA.pendienteExistente, status: 409 });
      }
      expect(rechazadasCon(rs, 409)).toBe(5);
      // Resultado final en BD (no solo el UNIQUE): una EMITIDA, una firma de emisión, una auditoría.
      expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND modulo = 'FONDOS' AND entidad_id = ?", [EMPRESA_A, doc])).toBe(1);
      expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND entidad_id = ? AND estado = 'EMITIDA'", [EMPRESA_A, doc])).toBe(1);
      expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ? AND entidad_id = ? AND accion = 'ENTREGAR_DOCUMENTO'", [EMPRESA_A, doc])).toBe(1);
    }
    console.info(`[C] rondas=${RONDAS} deadlocks=${observados}`);
    expect(observados).toBe(0);
    // Las imágenes de las emisiones perdedoras se compensaron: solo quedan las de las firmas existentes.
    const [firmas] = await getPool().query("SELECT imagen_ruta FROM firmas_electronicas WHERE empresa_id = ?", [EMPRESA_A]);
    const rutas = (firmas as { imagen_ruta: string }[]).map((f) => f.imagen_ruta).sort();
    expect(archivos.guardados.filter((r) => !archivos.borrados.includes(r)).sort()).toEqual(rutas);
  });

  it("D. MISMA CLAVE: reintentos concurrentes devuelven la entrega original; una sola emisión y una sola firma", async () => {
    let observados = 0;
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const [doc] = await fondos(EMPRESA_A, 1);
      const k = clave();
      const rs = await Promise.allSettled(Array.from({ length: 6 }, () => emitir(EMPRESA_A, ops, doc, "TESORERIA", k)));
      observados += deadlocks(rs);
      expect(cumplidas(rs), `ronda ${ronda}`).toBe(6);
      const ok = rs.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof emitir>>> => r.status === "fulfilled").map((r) => r.value);
      expect(new Set(ok.map((v) => v.entrega.id)).size).toBe(1);
      expect(ok.filter((v) => !v.repetida)).toHaveLength(1);
      expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND entidad_id = ?", [EMPRESA_A, doc])).toBe(1);
      expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ? AND entidad_id = ? AND accion = 'ENTREGAR_DOCUMENTO'", [EMPRESA_A, doc])).toBe(1);
    }
    console.info(`[D] rondas=${RONDAS} deadlocks=${observados}`);
    expect(observados).toBe(0);
  });

  it("F. MISMA CLAVE EN DOCUMENTOS DISTINTOS (error de cliente): gana una sola, la otra recibe 409 y no queda nada huérfano", async () => {
    let observados = 0;
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const [d1, d2] = await fondos(EMPRESA_A, 2);
      const k = clave();
      const rs = await Promise.allSettled([emitir(EMPRESA_A, ops, d1, "TESORERIA", k), emitir(EMPRESA_A, ops2, d2, "TESORERIA", k)]);
      observados += deadlocks(rs);
      expect(cumplidas(rs), `ronda ${ronda}`).toBe(1);
      expect(rechazadasCon(rs, 409)).toBe(1);
      expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND clave_idempotencia = ?", [EMPRESA_A, k])).toBe(1);
      expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ? AND entidad_id IN (?, ?) AND accion = 'ENTREGAR_DOCUMENTO'", [EMPRESA_A, d1, d2])).toBe(1);
    }
    console.info(`[F] rondas=${RONDAS} deadlocks=${observados}`);
    expect(observados).toBe(0);
  });

  it("E. CIERRE vs NUEVA EMISIÓN del mismo documento: nunca dos pendientes ni una custodia futura incorrecta", async () => {
    let observados = 0, exitosas = 0, conflictos = 0, sinPermiso = 0, perdio403 = 0;
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const [doc] = await fondos(EMPRESA_A, 1);
      const e1 = (await emitir(EMPRESA_A, ops, doc, "TESORERIA")).entrega;

      // Tesorería recibe MIENTRAS (a) otra persona de Tesorería intenta emitir hacia Contabilidad y (b) Operaciones intenta
      // emitir de nuevo: (b) jamás puede tener éxito (la custodia nunca vuelve a Operaciones sin una devolución).
      const rs = await Promise.allSettled([
        recibir(EMPRESA_A, tes, e1.id),
        emitir(EMPRESA_A, tes2, doc, "CONTABILIDAD"),
        emitir(EMPRESA_A, ops, doc, "CONTABILIDAD"),
      ]);
      observados += deadlocks(rs);
      expect(rs[0].status, `ronda ${ronda}: la recepción debe completarse`).toBe("fulfilled");

      // (b) Operaciones: 409 (aún pendiente) o 403 (ya custodia de Tesorería); NUNCA éxito.
      expect(rs[2].status).toBe("rejected");
      expect([403, 409]).toContain((rs[2] as PromiseRejectedResult).reason.status);

      // (a) Tesorería: éxito (vio la recepción) o 409 (la vio pendiente); si tuvo éxito salió DESDE Tesorería.
      const entregas = await listarEntregasDocumento(EMPRESA_A, "FONDOS", doc);
      expect(entregas.filter((e) => e.estado === "EMITIDA").length).toBeLessThanOrEqual(1);
      if (rs[1].status === "fulfilled") {
        exitosas++;
        expect(entregas).toHaveLength(2);
        expect(entregas[1]).toMatchObject({ etapaOrigen: "TESORERIA", etapaDestino: "CONTABILIDAD", estado: "EMITIDA" });
        expect(entregas[0].estado).toBe("RECIBIDA");
      } else {
        conflictos++;
        // Perdió la carrera: vio la entrega todavía pendiente. Sin éxito y sin estado nuevo. Puede ser 409 (pendiente existente) o 403
        // (la custodia visible aún es Operaciones y la validación de permiso del área precede a la de pendiente): ambos son rechazos
        // correctos y ninguno crea nada.
        expect([403, 409]).toContain((rs[1] as PromiseRejectedResult).reason.status);
        if ((rs[1] as PromiseRejectedResult).reason.status === 403) perdio403++;
        expect(entregas).toHaveLength(1);
        // Tras la recepción confirmada, un nuevo intento válido SÍ emite desde la nueva custodia (Tesorería).
        const reintento = await emitir(EMPRESA_A, tes2, doc, "CONTABILIDAD");
        expect(reintento.entrega).toMatchObject({ etapaOrigen: "TESORERIA", etapaDestino: "CONTABILIDAD", estado: "EMITIDA" });
      }
      if ((rs[2] as PromiseRejectedResult).reason.status === 403) sinPermiso++;
      expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND entidad_id = ? AND estado = 'EMITIDA'", [EMPRESA_A, doc])).toBe(1);
      expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ? AND entidad_id = ? AND accion = 'RECIBIR_DOCUMENTO'", [EMPRESA_A, doc])).toBe(1);
    }
    console.info(`[E] rondas=${RONDAS} deadlocks=${observados} tesoreriaEmite=${exitosas} tesoreriaPierde=${conflictos} (409=${conflictos - perdio403}, 403=${perdio403}) operacionesRechazada=${RONDAS} (409=${RONDAS - sinPermiso}, 403=${sinPermiso})`);
    expect(observados).toBe(0);
  });
});
