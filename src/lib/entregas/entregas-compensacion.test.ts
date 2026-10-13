import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * COMPENSACIÓN DE LOS ARCHIVOS DE FIRMA (con mocks, sin base de datos).
 *
 * La imagen se escribe en disco ANTES de abrir la transacción. Garantía bajo prueba: una vez guardada, cualquier salida que no
 * termine en commit usando esa imagen (error al obtener la conexión, error de lectura previa, rollback, commit fallido,
 * repetición, 404/409) la borra; y tras un commit exitoso que la usa, NUNCA se borra.
 */
const m = vi.hoisted(() => ({
  getConnection: vi.fn(),
  query: vi.fn(),
  guardarUpload: vi.fn(),
  borrarUpload: vi.fn(),
  bloquearDocumento: vi.fn(),
  crearFirmaInterna: vi.fn(),
  auditoria: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  getPool: () => ({ getConnection: m.getConnection }),
  query: m.query,
  execute: vi.fn(),
}));
vi.mock("@/lib/uploads", () => ({ guardarUpload: m.guardarUpload, borrarUpload: m.borrarUpload }));
vi.mock("./adaptadores", () => ({ bloquearDocumento: m.bloquearDocumento }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: m.crearFirmaInterna }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditoria }));

import type { PermisoModulo } from "@/lib/permisos-shared";
import {
  MENSAJES_ENTREGA,
  anularEntrega,
  confirmarRecepcion,
  huellaEntrega,
  registrarEntrega,
  registrarRecepcionPresencial,
  type FirmaEntregaInput,
} from "./entregas";
import type { ActorEntrega } from "./reglas";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).buffer;
const firma = (origen: "GUARDADA" | "DIBUJADA" = "DIBUJADA"): FirmaEntregaInput => ({ origen, imagen: { bytes: PNG, original: "firma.png" } });
const matriz = (...modulos: string[]): PermisoModulo[] => [
  { modulo: "permisos_acciones_v2", puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false },
  ...modulos.map((modulo) => ({ modulo, puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false })),
];
const actor = (usuarioId: number, ...permisos: string[]): ActorEntrega =>
  ({ usuarioId, username: `u${usuarioId}`, nombre: `Usuario ${usuarioId}`, rol: "Operaciones", esAdmin: false, permisos: matriz(...permisos) });
const emisor = actor(7, "fondos_entrega_emitir");
const receptor = actor(8, "entregas_area_tesoreria");
const operadorPresencial = actor(9, "entregas_presencial");

const fila = (extra: Record<string, unknown> = {}) => ({
  id: 5, empresa_id: 1, modulo: "FONDOS", entidad_id: 10, documento_codigo: "SF-1", etapa_origen: "OPERACIONES", etapa_destino: "TESORERIA",
  modo: "SISTEMA", estado: "EMITIDA", emitido_por_usuario_id: 7, emitido_por_nombre: "Usuario 7", emitido_por_rol: "Operaciones",
  emitido_en: new Date("2026-10-13T10:00:00"), firma_emision_id: 100, observaciones_emision: null,
  recibido_por_usuario_id: null, recibido_por_nombre: null, recibido_por_rol: null, recibido_en: null, firma_recepcion_id: null,
  observaciones_recepcion: null, recepcion_operada_por_usuario_id: null, recepcion_operada_por_nombre: null,
  cerrado_por_usuario_id: null, cerrado_por_nombre: null, cerrado_en: null, motivo_cierre: null, huella_idempotencia: "h".repeat(64),
  ...extra,
});

type OpcionesConexion = { commitError?: Error; executeError?: unknown; affectedRows?: number; queryTx?: unknown[][] };
function conexion(op: OpcionesConexion = {}) {
  const colaQuery = [...(op.queryTx ?? [])];
  const conn = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => { if (op.commitError) throw op.commitError; }),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    query: vi.fn(async () => [colaQuery.shift() ?? []]),
    execute: vi.fn(async () => {
      if (op.executeError) throw op.executeError;
      return [{ insertId: 55, affectedRows: op.affectedRows ?? 1 }];
    }),
  };
  m.getConnection.mockResolvedValueOnce(conn);
  return conn;
}

const RELATIVA = (prefijo: string) => `empresas/1/firmas/${prefijo}.png`;
const borrados = () => m.borrarUpload.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.guardarUpload.mockImplementation(async (_e: number, _s: string, prefijo: string, f: { name: string; size: number }) =>
    ({ relative: RELATIVA(prefijo), original: f.name, size: f.size }));
  m.bloquearDocumento.mockResolvedValue({ id: 10, codigo: "SF-1", estado: "Autorizada", admiteEntrega: true });
  m.crearFirmaInterna.mockResolvedValue({ id: 200, codigoFirma: "SIG-X", fechaHoraServidor: new Date(), hashPayload: "h", nombreFirmante: "x", rolFirmante: "x", tieneImagen: true });
  m.auditoria.mockResolvedValue(undefined);
});

const entradaRegistrar = { empresaId: 1, actor: emisor, modulo: "FONDOS" as const, entidadId: 10, destino: "TESORERIA" as const,
  modo: "SISTEMA" as const, observaciones: null, claveIdempotencia: "clave_registrar_123456", firma: firma("GUARDADA") };
const huellaRegistrar = () => huellaEntrega({ modulo: "FONDOS", entidadId: 10, destino: "TESORERIA", modo: "SISTEMA", observaciones: null, emisorUsuarioId: 7 });

describe("registrarEntrega — la imagen guardada siempre se compensa", () => {
  it("getConnection() falla DESPUÉS de guardar la imagen → se borra, y no hay conexión que liberar", async () => {
    m.query.mockResolvedValueOnce([]); // sin entrega previa con esa clave
    m.getConnection.mockRejectedValueOnce(new Error("pool agotado"));
    await expect(registrarEntrega(entradaRegistrar)).rejects.toThrow("pool agotado");
    expect(m.guardarUpload).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual([RELATIVA("firma_entrega_fondos_10")]);
  });

  it("beginTransaction() falla → se borra, se libera la conexión y NO se intenta rollback", async () => {
    m.query.mockResolvedValueOnce([]);
    const conn = conexion();
    conn.beginTransaction.mockRejectedValueOnce(new Error("sin transacción"));
    await expect(registrarEntrega(entradaRegistrar)).rejects.toThrow("sin transacción");
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual([RELATIVA("firma_entrega_fondos_10")]);
  });

  it("commit exitoso → la imagen NO se borra (la firma la referencia)", async () => {
    m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([fila({ id: 55 })]);
    const conn = conexion({ queryTx: [[], []] });
    const r = await registrarEntrega(entradaRegistrar);
    expect(r).toMatchObject({ repetida: false, entrega: { id: 55 } });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(m.crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({ imagen: expect.objectContaining({ relative: RELATIVA("firma_entrega_fondos_10") }) }));
    expect(m.borrarUpload).not.toHaveBeenCalled();
  });

  it("error DESPUÉS del commit (lectura final) → la imagen se conserva: la firma ya existe", async () => {
    m.query.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("lectura final falló"));
    const conn = conexion({ queryTx: [[], []] });
    await expect(registrarEntrega(entradaRegistrar)).rejects.toThrow("lectura final falló");
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(m.borrarUpload).not.toHaveBeenCalled();
  });

  it("error dentro de la transacción (documento inexistente → 404) → rollback, conexión liberada, imagen borrada", async () => {
    m.query.mockResolvedValueOnce([]);
    const conn = conexion();
    m.bloquearDocumento.mockResolvedValueOnce(null);
    await expect(registrarEntrega(entradaRegistrar)).rejects.toMatchObject({ message: MENSAJES_ENTREGA.documentoNoEncontrado, status: 404 });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual([RELATIVA("firma_entrega_fondos_10")]);
  });

  it("commit que falla → rollback intentado, error original propagado, imagen borrada", async () => {
    m.query.mockResolvedValueOnce([]);
    const conn = conexion({ queryTx: [[], []], commitError: new Error("commit roto") });
    await expect(registrarEntrega(entradaRegistrar)).rejects.toThrow("commit roto");
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual([RELATIVA("firma_entrega_fondos_10")]);
  });

  it("rollback que también falla no tapa el error original ni impide borrar la imagen", async () => {
    m.query.mockResolvedValueOnce([]);
    const conn = conexion();
    conn.rollback.mockRejectedValueOnce(new Error("rollback roto"));
    m.bloquearDocumento.mockResolvedValueOnce(null);
    await expect(registrarEntrega(entradaRegistrar)).rejects.toMatchObject({ status: 404 });
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual([RELATIVA("firma_entrega_fondos_10")]);
  });

  it("repetición detectada dentro de la transacción (misma clave y huella) → devuelve la original y borra la imagen copiada", async () => {
    m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([fila({ id: 41 })]);
    const conn = conexion({ queryTx: [[{ id: 41, huella_idempotencia: huellaRegistrar() }]] });
    const r = await registrarEntrega(entradaRegistrar);
    expect(r).toMatchObject({ repetida: true, entrega: { id: 41 } });
    expect(m.crearFirmaInterna).not.toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual([RELATIVA("firma_entrega_fondos_10")]);
  });

  it("carrera por la clave (ER_DUP_ENTRY en el INSERT) → rollback, imagen borrada y se devuelve la original", async () => {
    m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([fila({ id: 41, huella_idempotencia: huellaRegistrar() })]);
    const conn = conexion({ queryTx: [[], []],
      executeError: Object.assign(new Error("Duplicate entry 'x' for key 'uq_de_empresa_clave'"), { code: "ER_DUP_ENTRY", errno: 1062 }) });
    const r = await registrarEntrega(entradaRegistrar);
    expect(r).toMatchObject({ repetida: true, entrega: { id: 41 } });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual([RELATIVA("firma_entrega_fondos_10")]);
  });

  it("si guardarUpload falla no hay imagen que compensar", async () => {
    m.query.mockResolvedValueOnce([]);
    m.guardarUpload.mockRejectedValueOnce(new Error("disco lleno"));
    await expect(registrarEntrega(entradaRegistrar)).rejects.toThrow("disco lleno");
    expect(m.borrarUpload).not.toHaveBeenCalled();
    expect(m.getConnection).not.toHaveBeenCalled();
  });
});

describe("confirmarRecepcion — la imagen guardada siempre se compensa", () => {
  const entrada = { empresaId: 1, actor: receptor, entregaId: 5, firma: firma("DIBUJADA") };
  const esperada = RELATIVA("firma_recepcion_5");

  it("la lectura posterior al guardado (dentro del cierre) lanza → se borra y no se abre transacción", async () => {
    m.query.mockResolvedValueOnce([fila()]) // precheck (antes de guardar)
      .mockRejectedValueOnce(new Error("error de infraestructura al leer"));
    await expect(confirmarRecepcion(entrada)).rejects.toThrow("error de infraestructura al leer");
    expect(m.guardarUpload).toHaveBeenCalledTimes(1);
    expect(m.getConnection).not.toHaveBeenCalled();
    expect(borrados()).toEqual([esperada]);
  });

  it("getConnection() falla después de guardar → se borra", async () => {
    m.query.mockResolvedValue([fila()]);
    m.getConnection.mockRejectedValueOnce(new Error("pool agotado"));
    await expect(confirmarRecepcion(entrada)).rejects.toThrow("pool agotado");
    expect(borrados()).toEqual([esperada]);
  });

  it("commit exitoso → la imagen NO se borra", async () => {
    m.query.mockResolvedValueOnce([fila()]).mockResolvedValueOnce([fila()]) // precheck y lectura del cierre
      .mockResolvedValueOnce([fila({ estado: "RECIBIDA", recibido_por_usuario_id: 8, recibido_por_nombre: "Usuario 8", firma_recepcion_id: 200 })]);
    const conn = conexion({ queryTx: [[fila()]] });
    const r = await confirmarRecepcion(entrada);
    expect(r.estado).toBe("RECIBIDA");
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(m.borrarUpload).not.toHaveBeenCalled();
  });

  it("repetición (ya recibida por el mismo actor) → la imagen temporal se borra y no hay transacción", async () => {
    const recibida = fila({ estado: "RECIBIDA", recibido_por_usuario_id: 8, recibido_por_nombre: "Usuario 8", firma_recepcion_id: 200 });
    m.query.mockResolvedValueOnce([fila()]) // el precheck aún la ve EMITIDA (carrera)
      .mockResolvedValueOnce([recibida]); // al leer dentro del cierre ya está recibida por él
    const r = await confirmarRecepcion(entrada);
    expect(r.estado).toBe("RECIBIDA");
    expect(m.getConnection).not.toHaveBeenCalled();
    expect(borrados()).toEqual([esperada]);
  });

  it("repetición detectada con la fila bloqueada dentro de la transacción → se borra", async () => {
    const recibida = fila({ estado: "RECIBIDA", recibido_por_usuario_id: 8, recibido_por_nombre: "Usuario 8", firma_recepcion_id: 200 });
    m.query.mockResolvedValueOnce([fila()]).mockResolvedValueOnce([fila()]).mockResolvedValueOnce([recibida]);
    const conn = conexion({ queryTx: [[recibida]] });
    const r = await confirmarRecepcion(entrada);
    expect(r.estado).toBe("RECIBIDA");
    expect(m.crearFirmaInterna).not.toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual([esperada]);
  });

  it("rollback: el UPDATE condicionado no afecta filas (409) → rollback y la imagen se borra", async () => {
    m.query.mockResolvedValue([fila()]);
    const conn = conexion({ queryTx: [[fila()]], affectedRows: 0 });
    await expect(confirmarRecepcion(entrada)).rejects.toMatchObject({ message: MENSAJES_ENTREGA.noPendiente, status: 409 });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(borrados()).toEqual([esperada]);
  });

  it("entrega inexistente al leer dentro del cierre (404) → se borra", async () => {
    m.query.mockResolvedValueOnce([fila()]).mockResolvedValueOnce([]);
    await expect(confirmarRecepcion(entrada)).rejects.toMatchObject({ message: MENSAJES_ENTREGA.entregaNoEncontrada, status: 404 });
    expect(borrados()).toEqual([esperada]);
  });

  it("validación de negocio dentro de la transacción (propia entrega → 403) → rollback y se borra", async () => {
    const propia = actor(7, "entregas_area_tesoreria", "fondos_entrega_emitir");
    m.query.mockResolvedValue([fila()]);
    const conn = conexion({ queryTx: [[fila()]] });
    await expect(confirmarRecepcion({ ...entrada, actor: propia })).rejects.toMatchObject({ message: MENSAJES_ENTREGA.propiaEntrega, status: 403 });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual([esperada]);
  });
});

describe("registrarRecepcionPresencial y cierres sin imagen", () => {
  it("presencial: la lectura posterior al guardado lanza → se borra la imagen dibujada", async () => {
    m.query.mockResolvedValueOnce([fila({ modo: "PRESENCIAL" })]).mockRejectedValueOnce(new Error("lectura falló"));
    await expect(registrarRecepcionPresencial({ empresaId: 1, actor: operadorPresencial, entregaId: 5, nombreReceptor: "Juan Pérez", firma: firma("DIBUJADA") }))
      .rejects.toThrow("lectura falló");
    expect(borrados()).toEqual([RELATIVA("firma_recepcion_presencial_5")]);
  });

  it("presencial: commit exitoso → no se borra", async () => {
    const presencial = fila({ modo: "PRESENCIAL" });
    m.query.mockResolvedValueOnce([presencial]).mockResolvedValueOnce([presencial])
      .mockResolvedValueOnce([fila({ modo: "PRESENCIAL", estado: "RECIBIDA", recibido_por_nombre: "Juan Pérez", firma_recepcion_id: 200,
        recepcion_operada_por_usuario_id: 9, recepcion_operada_por_nombre: "Usuario 9" })]);
    conexion({ queryTx: [[presencial]] });
    const r = await registrarRecepcionPresencial({ empresaId: 1, actor: operadorPresencial, entregaId: 5, nombreReceptor: "Juan Pérez", firma: firma("DIBUJADA") });
    expect(r.estado).toBe("RECIBIDA");
    expect(m.borrarUpload).not.toHaveBeenCalled();
  });

  it("anular (sin imagen): ante un fallo de infraestructura nunca se escribe ni se borra ningún archivo", async () => {
    m.query.mockResolvedValue([fila()]);
    m.getConnection.mockRejectedValueOnce(new Error("pool agotado"));
    await expect(anularEntrega({ empresaId: 1, actor: emisor, entregaId: 5, motivo: "error" })).rejects.toThrow("pool agotado");
    expect(m.guardarUpload).not.toHaveBeenCalled();
    expect(m.borrarUpload).not.toHaveBeenCalled();
  });
});
