import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VERIFICACIÓN CONTRA UNA BASE REAL DESECHABLE — control de entrega de documentos (PR 1, base común).
 *
 * Se OMITE por defecto (no corre en CI ni en `npm test`). Solo se ejecuta si `ENTREGAS_DB_PORT` apunta a una MariaDB LOCAL y
 * DESECHABLE (127.0.0.1) con el esquema `u611730801_Plataforma`, las tablas de Fondos/Gastos/Compras, firmas_electronicas (con
 * columnas de imagen) y sql/migrate-2026-10-documento-entregas.sql aplicada. Nunca lee .env ni usa credenciales reales: el pool
 * se crea aquí, fijo a 127.0.0.1 con usuario `root` sin contraseña. Los archivos de firma se simulan (no se escribe en disco).
 *
 * Ejecuta el servicio REAL con transacciones y peticiones CONCURRENTES verdaderas, y comprueba las restricciones de la tabla
 * escribiendo SQL directo.
 */
const PUERTO = process.env.ENTREGAS_DB_PORT;
const ESQUEMA = process.env.ENTREGAS_DB_SCHEMA ?? "u611730801_Plataforma";

vi.mock("@/lib/db", async () => {
  const mysql = await import("mysql2/promise");
  let pool: ReturnType<typeof mysql.createPool> | null = null;
  const obtener = () => {
    if (!pool) {
      pool = mysql.createPool({
        host: "127.0.0.1", port: Number(process.env.ENTREGAS_DB_PORT), user: "root", password: "",
        database: process.env.ENTREGAS_DB_SCHEMA ?? "u611730801_Plataforma", connectionLimit: 20, timezone: "local",
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
  guardarUpload: vi.fn(async (empresaId: number, _subdir: string, prefix: string, f: { name: string; size: number }) => {
    const relative = `empresas/${empresaId}/firmas/${prefix}_${++archivos.n}.png`;
    archivos.guardados.push(relative);
    return { relative, original: f.name, size: f.size };
  }),
  borrarUpload: vi.fn((relative: string) => { archivos.borrados.push(relative); }),
}));

import type { RowDataPacket } from "mysql2";
import { getPool } from "@/lib/db";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { VERSION_PERMISOS } from "@/lib/permisos-catalogo";
import {
  MENSAJES_ENTREGA,
  anularEntrega,
  confirmarRecepcion,
  custodiaDocumento,
  listarEntregasDocumento,
  listarEntregasPorRecibir,
  rechazarRecepcion,
  registrarEntrega,
  registrarRecepcionPresencial,
  type FirmaEntregaInput,
} from "./entregas";
import type { AreaEntrega, ModoEntrega, ModuloEntrega } from "./catalogo";
import type { ActorEntrega } from "./reglas";
import { MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/lib/tms/idempotencia-envio";

const EMPRESA_A = 9601;
const EMPRESA_B = 9602;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).buffer;
const firma = (origen: "GUARDADA" | "DIBUJADA" = "GUARDADA"): FirmaEntregaInput => ({ origen, imagen: { bytes: PNG, original: "firma.png" } });

const fila = (modulo: string): PermisoModulo => ({ modulo, puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false });
const matriz = (...modulos: string[]): PermisoModulo[] =>
  [{ modulo: VERSION_PERMISOS, puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false }, ...modulos.map(fila)];

/** Usuarios de prueba (ids fijos, nunca reales). */
const U = { ops: 9701, ops2: 9702, tes: 9703, tes2: 9704, cont: 9705, compras: 9706, sinPermisos: 9707, anulador: 9708, operadorPresencial: 9709 };
const actores: Record<keyof typeof U, ActorEntrega> = {
  ops: { usuarioId: U.ops, username: "e_ops", nombre: "Olga Operaciones", rol: "JefeOperaciones", esAdmin: false, permisos: matriz("fondos_entrega_emitir", "gastos_entrega_emitir") },
  ops2: { usuarioId: U.ops2, username: "e_ops2", nombre: "Oscar Operaciones", rol: "AuxiliarOperaciones", esAdmin: false, permisos: matriz("fondos_entrega_emitir", "gastos_entrega_emitir") },
  tes: { usuarioId: U.tes, username: "e_tes", nombre: "Tere Tesorería", rol: "Contabilidad", esAdmin: false, permisos: matriz("entregas_area_tesoreria") },
  tes2: { usuarioId: U.tes2, username: "e_tes2", nombre: "Tomás Tesorería", rol: "Contabilidad", esAdmin: false, permisos: matriz("entregas_area_tesoreria") },
  cont: { usuarioId: U.cont, username: "e_cont", nombre: "Carla Contabilidad", rol: "Contabilidad", esAdmin: false, permisos: matriz("entregas_area_contabilidad") },
  compras: { usuarioId: U.compras, username: "e_compras", nombre: "Ciro Compras", rol: "CoordinadorCompras", esAdmin: false, permisos: matriz("compras_entrega_emitir") },
  sinPermisos: { usuarioId: U.sinPermisos, username: "e_nada", nombre: "Nadia Nada", rol: "Operaciones", esAdmin: false,
    // Permisos amplios de los MÓDULOS, ninguno de entrega.
    permisos: matriz("gastos", "gastos_autorizar", "gastos_operativos_autorizar", "compras_requerimientos", "compras_autorizar", "tms", "contabilidad") },
  anulador: { usuarioId: U.anulador, username: "e_anula", nombre: "Ana Anula", rol: "GerenteOperaciones", esAdmin: false, permisos: matriz("entregas_anular") },
  operadorPresencial: { usuarioId: U.operadorPresencial, username: "e_pres", nombre: "Pedro Presencial", rol: "JefeOperaciones", esAdmin: false,
    permisos: matriz("fondos_entrega_emitir", "entregas_presencial") },
};

const doc = { fondo: { A: 0, B: 0 }, fondoPendiente: 0, fondoLiquidada: 0, gasto: 0, gastoHistorico: 0, gastoInactivo: 0, compra: 0, compraRechazada: 0 };
let claveN = 0;
const clave = () => `clave_entrega_${process.pid}_${++claveN}`.slice(0, 64);

const emitir = (actor: ActorEntrega, modulo: ModuloEntrega, entidadId: number, destino: AreaEntrega, extra: { modo?: ModoEntrega; observaciones?: string; claveIdempotencia?: string; empresaId?: number } = {}) =>
  registrarEntrega({ empresaId: extra.empresaId ?? EMPRESA_A, actor, modulo, entidadId, destino, modo: extra.modo ?? "SISTEMA",
    observaciones: extra.observaciones ?? null, claveIdempotencia: extra.claveIdempotencia ?? clave(), firma: firma() });
const recibir = (actor: ActorEntrega, entregaId: number, empresaId = EMPRESA_A) =>
  confirmarRecepcion({ empresaId, actor, entregaId, firma: firma("DIBUJADA") });

async function filas<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await getPool().query(sql, params as never);
  return r as T[];
}
const contar = async (sql: string, params: unknown[] = []) => Number((await filas<{ n: number }>(sql, params))[0].n);
const esperar = async (p: Promise<unknown>, mensaje: string, status: number) => expect(p).rejects.toMatchObject({ message: mensaje, status });

async function limpiarEntregas() {
  const pool = getPool();
  await pool.query("DELETE FROM documento_entregas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  await pool.query("DELETE FROM firmas_electronicas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  await pool.query("DELETE FROM auditoria WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
}

async function crearFondo(empresa: number, codigo: string, estado: string) {
  const [r] = await getPool().query("INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado) VALUES (?, ?, '2026-10-01', ?)", [empresa, codigo, estado]);
  return Number((r as { insertId: number }).insertId);
}
async function crearGasto(codigo: string, estado: string | null, activo = 1) {
  const [r] = await getPool().query(
    "INSERT INTO tms_gastos_operativos (empresa_id, codigo, fecha_solicitud, categoria, monto, estado, activo) VALUES (?, ?, '2026-10-01', 'Otros', 10, ?, ?)",
    [EMPRESA_A, codigo, estado, activo]);
  return Number((r as { insertId: number }).insertId);
}
async function crearCompra(codigo: string, estado: string) {
  const [r] = await getPool().query("INSERT INTO compras_requerimientos (empresa_id, codigo, fecha_requerimiento, estado) VALUES (?, ?, '2026-10-01', ?)", [EMPRESA_A, codigo, estado]);
  return Number((r as { insertId: number }).insertId);
}

describe.skipIf(!PUERTO)(`BD real desechable (${ESQUEMA}) — control de entrega`, () => {
  beforeAll(async () => {
    const pool = getPool();
    for (const e of [EMPRESA_A, EMPRESA_B]) {
      await pool.query("INSERT IGNORE INTO empresas (id, codigo, nombre, slug) VALUES (?, ?, ?, ?)", [e, `E${e}`, `Prueba ${e}`, `prueba-entregas-${e}`]);
    }
    for (const [clave, id] of Object.entries(U)) {
      const a = actores[clave as keyof typeof U];
      await pool.query("INSERT IGNORE INTO usuarios (id, username, password_hash, salt, nombre, rol_global) VALUES (?, ?, 'x', 'x', ?, ?)", [id, a.username, a.nombre, a.rol]);
    }
    await limpiarEntregas();
    for (const t of ["tms_solicitudes_fondo", "tms_gastos_operativos", "compras_requerimientos"]) {
      await pool.query(`DELETE FROM ${t} WHERE empresa_id IN (?, ?)`, [EMPRESA_A, EMPRESA_B]);
    }
    doc.fondo.A = await crearFondo(EMPRESA_A, "SF-A-1", "Autorizada");
    doc.fondo.B = await crearFondo(EMPRESA_B, "SF-B-1", "Autorizada");
    doc.fondoPendiente = await crearFondo(EMPRESA_A, "SF-A-PEND", "Pendiente");
    doc.fondoLiquidada = await crearFondo(EMPRESA_A, "SF-A-LIQ", "Liquidada");
    doc.gasto = await crearGasto("GO-A-1", "Autorizada");
    doc.gastoHistorico = await crearGasto("GO-A-HIST", null);
    doc.gastoInactivo = await crearGasto("GO-A-INACT", "Autorizada", 0);
    doc.compra = await crearCompra("RC-A-1", "Autorizada");
    doc.compraRechazada = await crearCompra("RC-A-RECH", "Rechazada");
  });
  beforeEach(async () => {
    await limpiarEntregas();
    archivos.guardados.length = 0;
    archivos.borrados.length = 0;
  });
  afterAll(async () => {
    await limpiarEntregas();
    await getPool().end();
  });

  /** Cada imagen escrita queda referenciada por exactamente una firma o fue compensada (borrada). */
  async function imagenesConsistentes() {
    const rutas = (await filas<{ imagen_ruta: string }>("SELECT imagen_ruta FROM firmas_electronicas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B])).map((f) => f.imagen_ruta);
    const vivas = archivos.guardados.filter((r) => !archivos.borrados.includes(r));
    expect([...vivas].sort()).toEqual([...rutas].sort());
  }

  it("cadena completa de Fondos: OPS→TES→CONT→OPS, custodia, firmas y auditoría; el documento no cambia", async () => {
    const antes = (await filas("SELECT estado, actualizado_en FROM tms_solicitudes_fondo WHERE id = ?", [doc.fondo.A]))[0];
    expect((await custodiaDocumento(EMPRESA_A, "FONDOS", doc.fondo.A)).area).toBe("OPERACIONES");

    const e1 = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA", { observaciones: "Expediente completo" })).entrega;
    expect(e1).toMatchObject({ estado: "EMITIDA", etapaOrigen: "OPERACIONES", etapaDestino: "TESORERIA", documentoCodigo: "SF-A-1",
      emitidoPorUsuarioId: U.ops, emitidoPorNombre: "Olga Operaciones", emitidoPorRol: "JefeOperaciones", observacionesEmision: "Expediente completo" });
    expect((await custodiaDocumento(EMPRESA_A, "FONDOS", doc.fondo.A)).pendiente?.id).toBe(e1.id);

    const r1 = await recibir(actores.tes, e1.id);
    expect(r1).toMatchObject({ estado: "RECIBIDA", recibidoPorUsuarioId: U.tes, recibidoPorNombre: "Tere Tesorería", recibidoPorRol: "Contabilidad" });
    expect((await custodiaDocumento(EMPRESA_A, "FONDOS", doc.fondo.A)).area).toBe("TESORERIA");

    const e2 = (await emitir(actores.tes, "FONDOS", doc.fondo.A, "CONTABILIDAD")).entrega;
    expect(e2.etapaOrigen).toBe("TESORERIA");
    await recibir(actores.cont, e2.id);
    const e3 = (await emitir(actores.cont, "FONDOS", doc.fondo.A, "OPERACIONES", { observaciones: "Falta factura" })).entrega;
    await recibir(actores.ops2, e3.id);
    expect((await custodiaDocumento(EMPRESA_A, "FONDOS", doc.fondo.A)).area).toBe("OPERACIONES");

    const firmas = await filas<{ accion: string; usuario_id: number; modulo: string; entidad_tipo: string; entidad_id: number; metodo: string; imagen_ruta: string; payload_canonico: string }>(
      "SELECT accion, usuario_id, modulo, entidad_tipo, entidad_id, metodo, imagen_ruta, payload_canonico FROM firmas_electronicas WHERE empresa_id = ? ORDER BY id", [EMPRESA_A]);
    expect(firmas.map((f) => `${f.accion}:${f.usuario_id}`)).toEqual([
      `ENTREGAR_DOCUMENTO:${U.ops}`, `RECIBIR_DOCUMENTO:${U.tes}`, `ENTREGAR_DOCUMENTO:${U.tes}`, `RECIBIR_DOCUMENTO:${U.cont}`,
      `ENTREGAR_DOCUMENTO:${U.cont}`, `RECIBIR_DOCUMENTO:${U.ops2}`]);
    for (const f of firmas) {
      expect([f.modulo, f.entidad_tipo, f.entidad_id, f.metodo]).toEqual(["FONDOS", "SOLICITUD_FONDO", doc.fondo.A, "FIRMA_MANUSCRITA"]);
      expect(f.imagen_ruta).toBeTruthy();
    }
    expect(JSON.parse(firmas[0].payload_canonico)).toMatchObject({ origenFirma: "GUARDADA", valoresRelevantes: { origen: "OPERACIONES", destino: "TESORERIA" } });
    expect(JSON.parse(firmas[1].payload_canonico)).toMatchObject({ origenFirma: "DIBUJADA", valoresRelevantes: { entregaId: e1.id } });
    const entregas = await listarEntregasDocumento(EMPRESA_A, "FONDOS", doc.fondo.A);
    expect(entregas.map((e) => e.firmaEmisionId)).toEqual(await filas<{ id: number }>("SELECT id FROM firmas_electronicas WHERE empresa_id = ? AND accion = 'ENTREGAR_DOCUMENTO' ORDER BY id", [EMPRESA_A]).then((r) => r.map((x) => x.id)));
    expect(await contar("SELECT COUNT(*) AS n FROM auditoria WHERE empresa_id = ? AND modulo = 'documento_entregas'", [EMPRESA_A])).toBe(6);
    expect((await filas("SELECT estado, actualizado_en FROM tms_solicitudes_fondo WHERE id = ?", [doc.fondo.A]))[0]).toEqual(antes);
    await imagenesConsistentes();
  });

  it("Gastos y Compras: solo sus pares; Liquidada admite en Fondos", async () => {
    await esperar(emitir(actores.ops, "GASTOS", doc.gasto, "TESORERIA"), MENSAJES_ENTREGA.parNoPermitido, 409);
    const g = (await emitir(actores.ops, "GASTOS", doc.gasto, "CONTABILIDAD")).entrega;
    expect(g).toMatchObject({ modulo: "GASTOS", etapaOrigen: "OPERACIONES", documentoCodigo: "GO-A-1" });
    const c = (await emitir(actores.compras, "COMPRAS", doc.compra, "TESORERIA")).entrega;
    expect(c.etapaOrigen).toBe("COMPRAS");
    await recibir(actores.tes, c.id);
    await esperar(emitir(actores.tes, "COMPRAS", doc.compra, "COMPRAS"), MENSAJES_ENTREGA.parNoPermitido, 409);
    expect((await emitir(actores.ops, "FONDOS", doc.fondoLiquidada, "CONTABILIDAD")).entrega.estado).toBe("EMITIDA");
    await imagenesConsistentes();
  });

  it("estados no admitidos (Pendiente, histórico sin estado, gasto inactivo, compra Rechazada) → 409 sin escribir nada", async () => {
    await esperar(emitir(actores.ops, "FONDOS", doc.fondoPendiente, "TESORERIA"), MENSAJES_ENTREGA.estadoNoAdmitido, 409);
    await esperar(emitir(actores.ops, "GASTOS", doc.gastoHistorico, "CONTABILIDAD"), MENSAJES_ENTREGA.estadoNoAdmitido, 409);
    await esperar(emitir(actores.ops, "GASTOS", doc.gastoInactivo, "CONTABILIDAD"), MENSAJES_ENTREGA.estadoNoAdmitido, 409);
    await esperar(emitir(actores.compras, "COMPRAS", doc.compraRechazada, "TESORERIA"), MENSAJES_ENTREGA.estadoNoAdmitido, 409);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ?", [EMPRESA_A])).toBe(0);
    expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ?", [EMPRESA_A])).toBe(0);
    expect(archivos.guardados.length).toBe(4);
    await imagenesConsistentes();
  });

  it("permisos: sin permiso del área de origen/destino → 403; nadie recibe ni rechaza su propia entrega", async () => {
    await esperar(emitir(actores.sinPermisos, "FONDOS", doc.fondo.A, "TESORERIA"), MENSAJES_ENTREGA.sinPermisoArea, 403);
    await esperar(emitir(actores.tes, "FONDOS", doc.fondo.A, "CONTABILIDAD"), MENSAJES_ENTREGA.sinPermisoArea, 403);
    const e = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA")).entrega;
    await esperar(recibir(actores.cont, e.id), MENSAJES_ENTREGA.sinPermisoArea, 403);
    await esperar(recibir(actores.sinPermisos, e.id), MENSAJES_ENTREGA.sinPermisoArea, 403);
    // Emisor que además tiene permiso de Tesorería: tampoco puede confirmar su propia entrega.
    const ambos = { ...actores.ops, permisos: matriz("fondos_entrega_emitir", "entregas_area_tesoreria") };
    await esperar(recibir(ambos, e.id), MENSAJES_ENTREGA.propiaEntrega, 403);
    await esperar(rechazarRecepcion({ empresaId: EMPRESA_A, actor: ambos, entregaId: e.id, motivo: "x" }), MENSAJES_ENTREGA.propiaEntrega, 403);
    expect((await listarEntregasDocumento(EMPRESA_A, "FONDOS", doc.fondo.A))[0].estado).toBe("EMITIDA");
    await imagenesConsistentes();
  });

  it("aislamiento por empresa: documento o entrega de otra empresa → 404; consultas no se mezclan", async () => {
    await esperar(emitir(actores.ops, "FONDOS", doc.fondo.B, "TESORERIA"), MENSAJES_ENTREGA.documentoNoEncontrado, 404);
    const eb = (await emitir(actores.ops, "FONDOS", doc.fondo.B, "TESORERIA", { empresaId: EMPRESA_B })).entrega;
    expect(eb.empresaId).toBe(EMPRESA_B);
    await esperar(recibir(actores.tes, eb.id, EMPRESA_A), MENSAJES_ENTREGA.entregaNoEncontrada, 404);
    await esperar(anularEntrega({ empresaId: EMPRESA_A, actor: actores.ops, entregaId: eb.id, motivo: "x" }), MENSAJES_ENTREGA.entregaNoEncontrada, 404);
    await esperar(rechazarRecepcion({ empresaId: EMPRESA_A, actor: actores.tes, entregaId: eb.id, motivo: "x" }), MENSAJES_ENTREGA.entregaNoEncontrada, 404);
    await esperar(registrarRecepcionPresencial({ empresaId: EMPRESA_A, actor: actores.operadorPresencial, entregaId: eb.id, nombreReceptor: "X", firma: firma("DIBUJADA") }),
      MENSAJES_ENTREGA.entregaNoEncontrada, 404);
    expect(await listarEntregasDocumento(EMPRESA_A, "FONDOS", doc.fondo.B)).toEqual([]);
    expect(await listarEntregasPorRecibir(EMPRESA_A, actores.tes)).toEqual([]);
    expect((await listarEntregasPorRecibir(EMPRESA_B, actores.tes)).map((e) => e.id)).toEqual([eb.id]);
    // La firma quedó en la empresa B.
    const f = await filas<{ empresa_id: number }>("SELECT empresa_id FROM firmas_electronicas WHERE id = ?", [eb.firmaEmisionId]);
    expect(f[0].empresa_id).toBe(EMPRESA_B);
    await imagenesConsistentes();
  });

  it("idempotencia: misma clave + mismo contenido devuelve la original; contenido distinto → 409; otra empresa es independiente", async () => {
    const k = clave();
    const a = await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA", { claveIdempotencia: k, observaciones: "uno" });
    const b = await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA", { claveIdempotencia: k, observaciones: "uno" });
    expect(a.repetida).toBe(false);
    expect(b).toMatchObject({ repetida: true, entrega: { id: a.entrega.id } });
    await esperar(emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA", { claveIdempotencia: k, observaciones: "dos" }), MENSAJE_CONFLICTO_IDEMPOTENCIA, 409);
    await esperar(emitir(actores.ops2, "FONDOS", doc.fondo.A, "TESORERIA", { claveIdempotencia: k, observaciones: "uno" }), MENSAJE_CONFLICTO_IDEMPOTENCIA, 409);
    const otra = await emitir(actores.ops, "FONDOS", doc.fondo.B, "TESORERIA", { claveIdempotencia: k, observaciones: "uno", empresaId: EMPRESA_B });
    expect(otra.repetida).toBe(false);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE clave_idempotencia = ?", [k])).toBe(2);
    expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ?", [EMPRESA_A])).toBe(1);
    // Los reintentos no copian imagen (se responden antes de escribir nada).
    expect(archivos.guardados.length).toBe(2);
    await imagenesConsistentes();
  });

  it("concurrencia: 8 envíos simultáneos con la MISMA clave → 1 entrega, 1 firma; todos reciben la misma", async () => {
    const k = clave();
    const r = await Promise.allSettled(Array.from({ length: 8 }, () => emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA", { claveIdempotencia: k })));
    const ok = r.filter((x): x is PromiseFulfilledResult<Awaited<ReturnType<typeof emitir>>> => x.status === "fulfilled");
    expect(ok.length).toBe(8);
    expect(new Set(ok.map((x) => x.value.entrega.id)).size).toBe(1);
    expect(ok.filter((x) => !x.value.repetida).length).toBe(1);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ?", [EMPRESA_A])).toBe(1);
    expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ?", [EMPRESA_A])).toBe(1);
    expect(await contar("SELECT COUNT(*) AS n FROM auditoria WHERE empresa_id = ? AND modulo = 'documento_entregas'", [EMPRESA_A])).toBe(1);
    await imagenesConsistentes();
  });

  it("concurrencia: 8 emisiones simultáneas con claves DISTINTAS del mismo documento → solo 1; el resto 409 pendiente", async () => {
    const r = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
      emitir(i % 2 ? actores.ops : actores.ops2, "FONDOS", doc.fondo.A, i % 3 ? "TESORERIA" : "CONTABILIDAD")));
    const ok = r.filter((x) => x.status === "fulfilled");
    const ko = r.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(ok.length).toBe(1);
    for (const x of ko) expect(x.reason).toMatchObject({ message: MENSAJES_ENTREGA.pendienteExistente, status: 409 });
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND estado = 'EMITIDA'", [EMPRESA_A])).toBe(1);
    expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ?", [EMPRESA_A])).toBe(1);
    await imagenesConsistentes();
  });

  it("concurrencia: dos receptores confirman a la vez → una sola recepción; confirmar vs anular → gana uno", async () => {
    const e = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA")).entrega;
    const r = await Promise.allSettled([recibir(actores.tes, e.id), recibir(actores.tes2, e.id), recibir(actores.tes, e.id), recibir(actores.tes2, e.id)]);
    const final = (await listarEntregasDocumento(EMPRESA_A, "FONDOS", doc.fondo.A))[0];
    expect(final.estado).toBe("RECIBIDA");
    for (const x of r) {
      if (x.status === "fulfilled") expect(x.value.recibidoPorUsuarioId).toBe(final.recibidoPorUsuarioId);
      else expect(x.reason).toMatchObject({ message: MENSAJES_ENTREGA.noPendiente, status: 409 });
    }
    expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ? AND accion = 'RECIBIR_DOCUMENTO'", [EMPRESA_A])).toBe(1);

    const e2 = (await emitir(actores.tes, "FONDOS", doc.fondo.A, "CONTABILIDAD")).entrega;
    const r2 = await Promise.allSettled([recibir(actores.cont, e2.id), anularEntrega({ empresaId: EMPRESA_A, actor: actores.tes, entregaId: e2.id, motivo: "error" })]);
    expect(r2.filter((x) => x.status === "fulfilled").length).toBe(1);
    const estado = (await listarEntregasDocumento(EMPRESA_A, "FONDOS", doc.fondo.A))[1].estado;
    expect(["RECIBIDA", "ANULADA"]).toContain(estado);
    await imagenesConsistentes();
  });

  it("reintento de confirmación por el mismo receptor devuelve la recepción sin otra firma", async () => {
    const e = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA")).entrega;
    const a = await recibir(actores.tes, e.id);
    const b = await recibir(actores.tes, e.id);
    expect(b).toEqual(a);
    await esperar(recibir(actores.tes2, e.id), MENSAJES_ENTREGA.noPendiente, 409);
    expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ? AND accion = 'RECIBIR_DOCUMENTO'", [EMPRESA_A])).toBe(1);
    await imagenesConsistentes();
  });

  it("rechazar: solo el receptor del área destino, con motivo; la custodia no se mueve y se puede volver a emitir", async () => {
    const e = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA")).entrega;
    await esperar(rechazarRecepcion({ empresaId: EMPRESA_A, actor: actores.cont, entregaId: e.id, motivo: "No me corresponde" }), MENSAJES_ENTREGA.sinPermisoArea, 403);
    const r = await rechazarRecepcion({ empresaId: EMPRESA_A, actor: actores.tes, entregaId: e.id, motivo: "Falta la firma del autorizante" });
    expect(r).toMatchObject({ estado: "RECHAZADA", cerradoPorUsuarioId: U.tes, motivoCierre: "Falta la firma del autorizante", recibidoEn: null, firmaRecepcionId: null });
    expect(await rechazarRecepcion({ empresaId: EMPRESA_A, actor: actores.tes, entregaId: e.id, motivo: "Falta la firma del autorizante" })).toEqual(r);
    await esperar(recibir(actores.tes, e.id), MENSAJES_ENTREGA.noPendiente, 409);
    await esperar(anularEntrega({ empresaId: EMPRESA_A, actor: actores.ops, entregaId: e.id, motivo: "x" }), MENSAJES_ENTREGA.noPendiente, 409);
    const custodia = await custodiaDocumento(EMPRESA_A, "FONDOS", doc.fondo.A);
    expect(custodia).toMatchObject({ area: "OPERACIONES", pendiente: null });
    expect((await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA")).entrega.estado).toBe("EMITIDA");
    await imagenesConsistentes();
  });

  it("anular: el emisor o quien tenga entregas_anular; nunca una RECIBIDA", async () => {
    const e = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA")).entrega;
    await esperar(anularEntrega({ empresaId: EMPRESA_A, actor: actores.ops2, entregaId: e.id, motivo: "x" }), MENSAJES_ENTREGA.sinPermisoAnular, 403);
    await esperar(anularEntrega({ empresaId: EMPRESA_A, actor: actores.tes, entregaId: e.id, motivo: "x" }), MENSAJES_ENTREGA.sinPermisoAnular, 403);
    expect((await anularEntrega({ empresaId: EMPRESA_A, actor: actores.ops, entregaId: e.id, motivo: "Destino equivocado" })).estado).toBe("ANULADA");
    const e2 = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA")).entrega;
    expect((await anularEntrega({ empresaId: EMPRESA_A, actor: actores.anulador, entregaId: e2.id, motivo: "Emisor ausente" })).cerradoPorUsuarioId).toBe(U.anulador);
    const e3 = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA")).entrega;
    await recibir(actores.tes, e3.id);
    await esperar(anularEntrega({ empresaId: EMPRESA_A, actor: actores.ops, entregaId: e3.id, motivo: "x" }), MENSAJES_ENTREGA.noPendiente, 409);
    await esperar(anularEntrega({ empresaId: EMPRESA_A, actor: actores.anulador, entregaId: e3.id, motivo: "x" }), MENSAJES_ENTREGA.noPendiente, 409);
    expect((await custodiaDocumento(EMPRESA_A, "FONDOS", doc.fondo.A)).area).toBe("TESORERIA");
    await imagenesConsistentes();
  });

  it("presencial: firma dibujada de quien recibe (sin usuario), operador registrado; solo con permiso y solo en entregas presenciales", async () => {
    const sis = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA")).entrega;
    await esperar(registrarRecepcionPresencial({ empresaId: EMPRESA_A, actor: actores.operadorPresencial, entregaId: sis.id, nombreReceptor: "Juan Pérez", firma: firma("DIBUJADA") }),
      MENSAJES_ENTREGA.modoSistema, 409);
    await anularEntrega({ empresaId: EMPRESA_A, actor: actores.ops, entregaId: sis.id, motivo: "cambia a presencial" });

    const p = (await emitir(actores.operadorPresencial, "FONDOS", doc.fondo.A, "TESORERIA", { modo: "PRESENCIAL" })).entrega;
    expect(p.modo).toBe("PRESENCIAL");
    expect((await listarEntregasPorRecibir(EMPRESA_A, actores.tes)).map((x) => x.id)).not.toContain(p.id);
    await esperar(recibir(actores.tes, p.id), MENSAJES_ENTREGA.modoPresencial, 409);
    await esperar(rechazarRecepcion({ empresaId: EMPRESA_A, actor: actores.tes, entregaId: p.id, motivo: "x" }), MENSAJES_ENTREGA.modoPresencial, 409);
    await esperar(registrarRecepcionPresencial({ empresaId: EMPRESA_A, actor: actores.ops, entregaId: p.id, nombreReceptor: "Juan Pérez", firma: firma("DIBUJADA") }),
      MENSAJES_ENTREGA.sinPermisoPresencial, 403);

    const r = await registrarRecepcionPresencial({ empresaId: EMPRESA_A, actor: actores.operadorPresencial, entregaId: p.id, nombreReceptor: "Juan Pérez", observaciones: "Recibe en ventanilla", firma: firma("DIBUJADA") });
    expect(r).toMatchObject({ estado: "RECIBIDA", recibidoPorUsuarioId: null, recibidoPorNombre: "Juan Pérez", recibidoPorRol: null,
      recepcionOperadaPorUsuarioId: U.operadorPresencial, recepcionOperadaPorNombre: "Pedro Presencial", observacionesRecepcion: "Recibe en ventanilla" });
    // Reintento idéntico: misma recepción, sin otra firma. Otro nombre: 409.
    expect(await registrarRecepcionPresencial({ empresaId: EMPRESA_A, actor: actores.operadorPresencial, entregaId: p.id, nombreReceptor: "Juan Pérez", observaciones: "Recibe en ventanilla", firma: firma("DIBUJADA") })).toEqual(r);
    await esperar(registrarRecepcionPresencial({ empresaId: EMPRESA_A, actor: actores.operadorPresencial, entregaId: p.id, nombreReceptor: "Otra Persona", firma: firma("DIBUJADA") }),
      MENSAJES_ENTREGA.noPendiente, 409);
    const f = await filas<{ usuario_id: number | null; accion: string; payload_canonico: string }>("SELECT usuario_id, accion, payload_canonico FROM firmas_electronicas WHERE id = ?", [r.firmaRecepcionId]);
    expect(f[0]).toMatchObject({ usuario_id: null, accion: "RECIBIR_DOCUMENTO" });
    expect(JSON.parse(f[0].payload_canonico)).toMatchObject({ nombreFirmante: "Juan Pérez", origenFirma: "DIBUJADA",
      valoresRelevantes: { operadorUsuarioId: U.operadorPresencial, operadorNombre: "Pedro Presencial" } });
    expect((await custodiaDocumento(EMPRESA_A, "FONDOS", doc.fondo.A)).area).toBe("TESORERIA");
    await imagenesConsistentes();
  });

  it("modo PRESENCIAL al registrar exige entregas_presencial: sin él 403, sin entrega, sin firma y sin imagen", async () => {
    // `ops` tiene el permiso del área de origen (fondos_entrega_emitir) pero NO entregas_presencial.
    await esperar(emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA", { modo: "PRESENCIAL" }), MENSAJES_ENTREGA.sinPermisoPresencial, 403);
    await esperar(emitir(actores.sinPermisos, "FONDOS", doc.fondo.A, "TESORERIA", { modo: "PRESENCIAL" }), MENSAJES_ENTREGA.sinPermisoPresencial, 403);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ?", [EMPRESA_A])).toBe(0);
    expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ?", [EMPRESA_A])).toBe(0);
    expect(await contar("SELECT COUNT(*) AS n FROM auditoria WHERE empresa_id = ? AND modulo = 'documento_entregas'", [EMPRESA_A])).toBe(0);
    expect(archivos.guardados).toEqual([]); // ni siquiera se copió la imagen
    // El mismo documento sigue disponible: SISTEMA con ese mismo actor funciona sin entregas_presencial.
    const sis = await emitir(actores.ops, "FONDOS", doc.fondo.A, "TESORERIA", { modo: "SISTEMA" });
    expect(sis.entrega).toMatchObject({ modo: "SISTEMA", estado: "EMITIDA" });
    await anularEntrega({ empresaId: EMPRESA_A, actor: actores.ops, entregaId: sis.entrega.id, motivo: "prueba" });
    // Con entregas_presencial (además del área de origen) se permite; sin el área de origen sigue siendo 403.
    const presencial = await emitir(actores.operadorPresencial, "FONDOS", doc.fondo.A, "TESORERIA", { modo: "PRESENCIAL" });
    expect(presencial.entrega).toMatchObject({ modo: "PRESENCIAL", estado: "EMITIDA", emitidoPorUsuarioId: U.operadorPresencial });
    await anularEntrega({ empresaId: EMPRESA_A, actor: actores.operadorPresencial, entregaId: presencial.entrega.id, motivo: "prueba" });
    const soloPresencial = { ...actores.operadorPresencial, permisos: matriz("entregas_presencial") };
    await esperar(emitir(soloPresencial, "FONDOS", doc.fondo.A, "TESORERIA", { modo: "PRESENCIAL" }), MENSAJES_ENTREGA.sinPermisoArea, 403);
    // Admin conserva el bypass.
    const admin: ActorEntrega = { ...actores.ops, usuarioId: U.ops2, username: "e_ops2", permisos: [], esAdmin: true, rol: "Admin" };
    expect((await emitir(admin, "FONDOS", doc.fondo.A, "TESORERIA", { modo: "PRESENCIAL" })).entrega.modo).toBe("PRESENCIAL");
    await imagenesConsistentes();
  });

  it("identidad incompleta (sin nombre o rol) → 403 antes de tocar archivos o base", async () => {
    await esperar(emitir({ ...actores.ops, nombre: "  " }, "FONDOS", doc.fondo.A, "TESORERIA"), MENSAJES_ENTREGA.identidadIncompleta, 403);
    await esperar(emitir({ ...actores.ops, rol: "" }, "FONDOS", doc.fondo.A, "TESORERIA"), MENSAJES_ENTREGA.identidadIncompleta, 403);
    expect(archivos.guardados).toEqual([]);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ?", [EMPRESA_A])).toBe(0);
  });

  it("bandeja «por recibir»: solo SISTEMA, de sus áreas, no emitidas por él", async () => {
    const f = (await emitir(actores.ops, "FONDOS", doc.fondo.A, "CONTABILIDAD")).entrega;
    const g = (await emitir(actores.ops, "GASTOS", doc.gasto, "CONTABILIDAD")).entrega;
    const c = (await emitir(actores.compras, "COMPRAS", doc.compra, "TESORERIA")).entrega;
    expect((await listarEntregasPorRecibir(EMPRESA_A, actores.cont)).map((e) => e.id)).toEqual([f.id, g.id]);
    expect((await listarEntregasPorRecibir(EMPRESA_A, actores.tes)).map((e) => e.id)).toEqual([c.id]);
    expect(await listarEntregasPorRecibir(EMPRESA_A, actores.sinPermisos)).toEqual([]);
    const contYOps = { ...actores.ops, permisos: matriz("fondos_entrega_emitir", "entregas_area_contabilidad") };
    expect(await listarEntregasPorRecibir(EMPRESA_A, contYOps)).toEqual([]);
  });

  describe("restricciones de la tabla (SQL directo, sin pasar por la aplicación)", () => {
    let firmaId = 0;
    let firma2 = 0;
    const base = () => ({
      empresa_id: EMPRESA_A, modulo: "FONDOS", entidad_tipo: "SOLICITUD_FONDO", entidad_id: doc.fondo.A, etapa_origen: "OPERACIONES",
      etapa_destino: "TESORERIA", modo: "SISTEMA", estado: "EMITIDA", emitido_por_usuario_id: U.ops, emitido_por_nombre: "x",
      emitido_por_rol: "JefeOperaciones", emitido_en: new Date(), firma_emision_id: firmaId, clave_idempotencia: clave(), huella_idempotencia: "a".repeat(64),
    } as Record<string, unknown>);
    const insertar = (datos: Record<string, unknown>) =>
      getPool().query(`INSERT INTO documento_entregas (${Object.keys(datos).join(", ")}) VALUES (${Object.keys(datos).map(() => "?").join(", ")})`, Object.values(datos) as never);

    beforeEach(async () => {
      const e = (await emitir(actores.ops, "FONDOS", doc.fondoLiquidada, "TESORERIA")).entrega;
      firmaId = e.firmaEmisionId;
      await recibir(actores.tes, e.id);
      firma2 = (await listarEntregasDocumento(EMPRESA_A, "FONDOS", doc.fondoLiquidada))[0].firmaRecepcionId!;
    });

    it("válida pasa; segunda pendiente del mismo documento choca con uq_de_pendiente", async () => {
      await insertar(base());
      await expect(insertar(base())).rejects.toMatchObject({ code: "ER_DUP_ENTRY", message: expect.stringContaining("uq_de_pendiente") });
    });
    it("misma clave en la misma empresa choca con uq_de_empresa_clave", async () => {
      const b = base();
      await insertar({ ...b, estado: "ANULADA", cerrado_por_usuario_id: U.ops, cerrado_por_nombre: "x", cerrado_en: new Date(), motivo_cierre: "x" });
      await expect(insertar({ ...b, estado: "ANULADA", cerrado_por_usuario_id: U.ops, cerrado_por_nombre: "x", cerrado_en: new Date(), motivo_cierre: "x" }))
        .rejects.toMatchObject({ code: "ER_DUP_ENTRY", message: expect.stringContaining("uq_de_empresa_clave") });
    });
    it.each([
      ["módulo desconocido", "chk_de_modulo", { modulo: "VIATICOS" }],
      ["entidad_tipo incoherente", "chk_de_entidad_tipo", { entidad_tipo: "GASTO_OPERATIVO" }],
      ["origen = destino", "chk_de_etapas", { etapa_destino: "OPERACIONES" }],
      ["área desconocida", "chk_de_etapas", { etapa_destino: "GERENCIA" }],
      ["modo desconocido", "chk_de_modo", { modo: "CORREO" }],
      ["estado desconocido", "chk_de_estado", { estado: "PERDIDA" }],
      ["RECIBIDA sin firma de recepción", "chk_de_recepcion", { estado: "RECIBIDA", recibido_por_usuario_id: U.tes, recibido_por_nombre: "x", recibido_en: new Date() }],
      ["datos de recepción en una EMITIDA", "chk_de_recepcion", { recibido_en: new Date() }],
      ["receptor = emisor", "chk_de_receptor_no_emisor", { estado: "RECIBIDA", recibido_por_usuario_id: U.ops, recibido_por_nombre: "x", recibido_por_rol: "JefeOperaciones", recibido_en: new Date(), firma_recepcion_id: -1 }],
      ["PRESENCIAL recibida con usuario receptor", "chk_de_recepcion", { modo: "PRESENCIAL", estado: "RECIBIDA", recibido_por_usuario_id: U.tes, recibido_por_nombre: "x", recibido_en: new Date(), firma_recepcion_id: -1, recepcion_operada_por_usuario_id: U.ops }],
      ["PRESENCIAL recibida sin operador", "chk_de_recepcion", { modo: "PRESENCIAL", estado: "RECIBIDA", recibido_por_nombre: "x", recibido_en: new Date(), firma_recepcion_id: -1 }],
      ["RECHAZADA sin motivo", "chk_de_cierre", { estado: "RECHAZADA", cerrado_por_usuario_id: U.tes, cerrado_por_nombre: "x", cerrado_en: new Date() }],
      ["RECHAZADA presencial", "chk_de_rechazo_sistema", { modo: "PRESENCIAL", estado: "RECHAZADA", cerrado_por_usuario_id: U.tes, cerrado_por_nombre: "x", cerrado_en: new Date(), motivo_cierre: "x" }],
      ["cierre en una EMITIDA", "chk_de_cierre", { motivo_cierre: "x" }],
      ["huella corta", "chk_de_huella", { huella_idempotencia: "abc" }],
      ["misma firma para emitir y recibir", "chk_de_firmas_distintas", { estado: "RECIBIDA", recibido_por_usuario_id: U.tes, recibido_por_nombre: "x", recibido_por_rol: "Contabilidad", recibido_en: new Date(), firma_recepcion_id: 0 }],
    ] as [string, string, Record<string, unknown>][])("CHECK rechaza: %s (%s)", async (_n, restriccion, cambio) => {
      const datos = { ...base(), ...cambio } as Record<string, unknown>;
      if (datos.firma_recepcion_id === -1) datos.firma_recepcion_id = firma2;
      if (datos.firma_recepcion_id === 0) datos.firma_recepcion_id = firmaId;
      // MariaDB: errno 4025 «CONSTRAINT `x` failed» (mysql2 no tiene nombre propio para ese código).
      await expect(insertar(datos)).rejects.toMatchObject({ errno: 4025, message: expect.stringContaining(`CONSTRAINT \`${restriccion}\` failed`) });
    });
    /** Cierre completo válido para RECHAZADA/ANULADA. */
    const cierre = (): Record<string, unknown> => ({ cerrado_por_usuario_id: U.tes, cerrado_por_nombre: "Tere", cerrado_en: new Date(), motivo_cierre: "motivo" });
    /** Recepción completa válida por modo (para RECIBIDA). */
    const recepcion = (modo: "SISTEMA" | "PRESENCIAL"): Record<string, unknown> => modo === "SISTEMA"
      ? { modo, estado: "RECIBIDA", recibido_por_usuario_id: U.tes, recibido_por_nombre: "Tere", recibido_por_rol: "Contabilidad", recibido_en: new Date(), firma_recepcion_id: firma2 }
      : { modo, estado: "RECIBIDA", recibido_por_nombre: "Juan Pérez", recibido_en: new Date(), firma_recepcion_id: firma2,
          recepcion_operada_por_usuario_id: U.operadorPresencial, recepcion_operada_por_nombre: "Pedro" };
    const rechaza = (datos: Record<string, unknown>, restriccion: string) =>
      expect(insertar({ ...base(), ...datos })).rejects.toMatchObject({ errno: 4025, message: expect.stringContaining(`CONSTRAINT \`${restriccion}\` failed`) });

    it("estados válidos completos se aceptan (las restricciones no son más estrictas de la cuenta)", async () => {
      await insertar({ ...base(), ...recepcion("SISTEMA") });
      await insertar({ ...base(), ...recepcion("PRESENCIAL") }); // sin recibido_por_rol: no se exige en presencial
      await insertar({ ...base(), ...recepcion("SISTEMA"), observaciones_recepcion: "con observaciones" });
      await insertar({ ...base(), estado: "RECHAZADA", ...cierre() });
      await insertar({ ...base(), estado: "ANULADA", ...cierre() });
      await insertar({ ...base(), modo: "PRESENCIAL", estado: "ANULADA", ...cierre() });
      expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND entidad_id = ?", [EMPRESA_A, doc.fondo.A])).toBe(6);
    });

    const CAMPOS_RECEPCION = ["recibido_por_usuario_id", "recibido_por_nombre", "recibido_por_rol", "recibido_en", "firma_recepcion_id",
      "observaciones_recepcion", "recepcion_operada_por_usuario_id", "recepcion_operada_por_nombre"] as const;
    const VALOR_RECEPCION = (): Record<(typeof CAMPOS_RECEPCION)[number], unknown> => ({
      recibido_por_usuario_id: U.tes, recibido_por_nombre: "Tere", recibido_por_rol: "Contabilidad", recibido_en: new Date(), firma_recepcion_id: firma2,
      observaciones_recepcion: "obs", recepcion_operada_por_usuario_id: U.operadorPresencial, recepcion_operada_por_nombre: "Pedro",
    });
    it.each(
      (["EMITIDA", "RECHAZADA", "ANULADA"] as const).flatMap((estado) => CAMPOS_RECEPCION.map((campo) => [estado, campo] as const)),
    )("fuera de RECIBIDA (%s) NINGÚN campo de recepción admite valor: %s", async (estado, campo) => {
      const cerrado = estado === "EMITIDA" ? {} : cierre();
      await rechaza({ estado, ...cerrado, [campo]: VALOR_RECEPCION()[campo] }, "chk_de_recepcion");
    });

    it.each([
      ["SISTEMA sin recibido_por_usuario_id", "SISTEMA", { recibido_por_usuario_id: null }],
      ["SISTEMA sin recibido_por_nombre", "SISTEMA", { recibido_por_nombre: null }],
      ["SISTEMA sin recibido_por_rol", "SISTEMA", { recibido_por_rol: null }],
      ["SISTEMA sin recibido_en", "SISTEMA", { recibido_en: null }],
      ["SISTEMA sin firma de recepción", "SISTEMA", { firma_recepcion_id: null }],
      ["SISTEMA con operador (id)", "SISTEMA", { recepcion_operada_por_usuario_id: U.operadorPresencial }],
      ["SISTEMA con operador (nombre)", "SISTEMA", { recepcion_operada_por_nombre: "Pedro" }],
      ["PRESENCIAL con usuario receptor", "PRESENCIAL", { recibido_por_usuario_id: U.tes }],
      ["PRESENCIAL sin nombre del receptor", "PRESENCIAL", { recibido_por_nombre: null }],
      ["PRESENCIAL sin recibido_en", "PRESENCIAL", { recibido_en: null }],
      ["PRESENCIAL sin firma de recepción", "PRESENCIAL", { firma_recepcion_id: null }],
      ["PRESENCIAL sin operador (id)", "PRESENCIAL", { recepcion_operada_por_usuario_id: null }],
      ["PRESENCIAL sin operador (nombre)", "PRESENCIAL", { recepcion_operada_por_nombre: null }],
    ] as [string, "SISTEMA" | "PRESENCIAL", Record<string, unknown>][])("RECIBIDA incompleta o incoherente: %s", async (_n, modo, cambio) => {
      await rechaza({ ...recepcion(modo), ...cambio }, "chk_de_recepcion");
    });

    it.each([
      ...(["RECHAZADA", "ANULADA"] as const).flatMap((estado) =>
        (["cerrado_por_usuario_id", "cerrado_por_nombre", "cerrado_en", "motivo_cierre"] as const).map((campo) =>
          [`${estado} sin ${campo}`, estado, { [campo]: null }] as [string, string, Record<string, unknown>])),
      ...(["EMITIDA", "RECIBIDA"] as const).flatMap((estado) =>
        (["cerrado_por_usuario_id", "cerrado_por_nombre", "cerrado_en", "motivo_cierre"] as const).map((campo) =>
          [`${estado} con ${campo}`, estado, { [campo]: cierre()[campo] }] as [string, string, Record<string, unknown>])),
    ])("cierre completo o ausente: %s", async (_n, estado, cambio) => {
      const datos = estado === "RECIBIDA" ? recepcion("SISTEMA") : estado === "EMITIDA" ? {} : { estado, ...cierre() };
      await rechaza({ ...datos, ...cambio }, "chk_de_cierre");
    });

    it("el snapshot del emisor es obligatorio (nombre y rol)", async () => {
      await expect(insertar({ ...base(), emitido_por_rol: null })).rejects.toMatchObject({ errno: 1048 });
      await expect(insertar({ ...base(), emitido_por_nombre: null })).rejects.toMatchObject({ errno: 1048 });
    });

    it("FK: empresa, usuario y firma deben existir; la firma no se puede borrar mientras la use una entrega", async () => {
      await expect(insertar({ ...base(), empresa_id: 999999 })).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      await expect(insertar({ ...base(), emitido_por_usuario_id: 999999 })).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      await expect(insertar({ ...base(), firma_emision_id: 999999999 })).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      await expect(getPool().query("DELETE FROM firmas_electronicas WHERE id = ?", [firmaId])).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });
    });
  });
});
