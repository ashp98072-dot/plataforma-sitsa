import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * COMPENSACIÓN DEL ARCHIVO ESCANEADO de una recepción presencial (con mocks, sin base de datos): una vez copiada la constancia
 * firmada a disco, cualquier salida que no termine en commit usando ese archivo lo borra; tras un commit exitoso NO se borra.
 * Además comprueba que la firma queda como ESCANEADA, con el mime real y vinculada a la entrega.
 */
const m = vi.hoisted(() => ({
  getConnection: vi.fn(), query: vi.fn(), guardarUpload: vi.fn(), borrarUpload: vi.fn(), crearFirmaInterna: vi.fn(), auditoria: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.getConnection }), query: m.query, execute: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: m.guardarUpload, borrarUpload: m.borrarUpload }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: m.crearFirmaInterna }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditoria }));
vi.mock("./adaptadores", () => ({ bloquearDocumento: vi.fn() }));

import type { PermisoModulo } from "@/lib/permisos-shared";
import { registrarRecepcionPresencial } from "./entregas";
import type { ActorEntrega } from "./reglas";

const matriz = (...modulos: string[]): PermisoModulo[] => [
  { modulo: "permisos_acciones_v2", puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false },
  ...modulos.map((modulo) => ({ modulo, puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false })),
];
const operador: ActorEntrega = { usuarioId: 9, username: "u9", nombre: "Pedro Presencial", rol: "Operaciones", esAdmin: false, permisos: matriz("entregas_presencial") };
const bytesDe = (cabecera: number[]) => { const u = new Uint8Array(64); u.set(cabecera); return u.buffer; };
const PDF = bytesDe([0x25, 0x50, 0x44, 0x46, 0x2d]);
const JPEG = bytesDe([0xff, 0xd8, 0xff, 0xe0]);
const RELATIVA = "empresas/1/evidencias/constancia_firmada_5.pdf";

const fila = (extra: Record<string, unknown> = {}) => ({
  id: 5, empresa_id: 1, modulo: "FONDOS", entidad_id: 10, documento_codigo: "SF-1", etapa_origen: "OPERACIONES", etapa_destino: "TESORERIA",
  modo: "PRESENCIAL", estado: "EMITIDA", emitido_por_usuario_id: 7, emitido_por_nombre: "Usuario 7", emitido_por_rol: "Operaciones",
  emitido_en: new Date("2026-10-13T10:00:00"), firma_emision_id: 100, observaciones_emision: null,
  recibido_por_usuario_id: null, recibido_por_nombre: null, recibido_por_rol: null, recibido_en: null, firma_recepcion_id: null,
  observaciones_recepcion: null, recepcion_operada_por_usuario_id: null, recepcion_operada_por_nombre: null,
  cerrado_por_usuario_id: null, cerrado_por_nombre: null, cerrado_en: null, motivo_cierre: null, huella_idempotencia: "h".repeat(64), ...extra,
});

function conexion(opciones: { filaBloqueada?: Record<string, unknown>; affectedRows?: number } = {}) {
  const conn = {
    beginTransaction: vi.fn(async () => undefined), commit: vi.fn(async () => undefined), rollback: vi.fn(async () => undefined), release: vi.fn(),
    query: vi.fn(async () => [[opciones.filaBloqueada ?? fila()]]),
    execute: vi.fn(async () => [{ insertId: 0, affectedRows: opciones.affectedRows ?? 1 }]),
  };
  m.getConnection.mockResolvedValueOnce(conn);
  return conn;
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.guardarUpload.mockImplementation(async (_e: number, subdir: string, prefijo: string, f: { name: string; size: number }) => {
    const extension = f.name.slice(f.name.lastIndexOf("."));
    return { relative: `empresas/1/${subdir}/${prefijo}${extension}`, original: f.name, size: f.size };
  });
  m.crearFirmaInterna.mockResolvedValue({ id: 200, codigoFirma: "SIG-X", fechaHoraServidor: new Date(), hashPayload: "h", nombreFirmante: "x", rolFirmante: "", tieneImagen: true });
  m.auditoria.mockResolvedValue(undefined);
});

const base = { empresaId: 1, actor: operador, entregaId: 5, nombreReceptor: "Juan Pérez" };

describe("recepción presencial con constancia escaneada — archivo y compensación", () => {
  it("se guarda en «evidencias» con nombre generado y la extensión del formato REAL (no la que declara el cliente)", async () => {
    m.query.mockResolvedValue([fila()]);
    m.getConnection.mockRejectedValueOnce(new Error("pool agotado"));
    await expect(registrarRecepcionPresencial({ ...base, evidencia: { bytes: JPEG, original: "estafa.pdf" } })).rejects.toThrow("pool agotado");
    expect(m.guardarUpload).toHaveBeenCalledWith(1, "evidencias", "constancia_firmada_5", expect.objectContaining({ name: "constancia-firmada-5.jpg" }));
  });

  it("getConnection() falla tras guardar => el archivo se borra", async () => {
    m.query.mockResolvedValue([fila()]);
    m.getConnection.mockRejectedValueOnce(new Error("pool agotado"));
    await expect(registrarRecepcionPresencial({ ...base, evidencia: { bytes: PDF, original: "e.pdf" } })).rejects.toThrow("pool agotado");
    expect(m.borrarUpload.mock.calls.map((c) => c[0])).toEqual([RELATIVA]);
  });

  it("falla la BD dentro de la transacción (409 por carrera: el UPDATE no afecta filas) => rollback y archivo borrado", async () => {
    m.query.mockResolvedValue([fila()]);
    const conn = conexion({ affectedRows: 0 });
    await expect(registrarRecepcionPresencial({ ...base, evidencia: { bytes: PDF, original: "e.pdf" } })).rejects.toMatchObject({ status: 409 });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(m.borrarUpload.mock.calls.map((c) => c[0])).toEqual([RELATIVA]);
  });

  it("commit exitoso => el archivo NO se borra; la firma queda ESCANEADA con el mime real y la entrega vinculada", async () => {
    const recibida = fila({ estado: "RECIBIDA", recibido_por_nombre: "Juan Pérez", recibido_en: new Date(), firma_recepcion_id: 200,
      recepcion_operada_por_usuario_id: 9, recepcion_operada_por_nombre: "Pedro Presencial" });
    m.query.mockResolvedValueOnce([fila()]).mockResolvedValueOnce([fila()]).mockResolvedValueOnce([recibida]);
    const conn = conexion();
    const r = await registrarRecepcionPresencial({ ...base, evidencia: { bytes: PDF, original: "e.pdf" } });
    expect(r).toMatchObject({ estado: "RECIBIDA", recibidoPorUsuarioId: null, recibidoPorNombre: "Juan Pérez", recepcionOperadaPorUsuarioId: 9 });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(m.borrarUpload).not.toHaveBeenCalled();
    const datos = m.crearFirmaInterna.mock.calls[0][1];
    expect(datos).toMatchObject({
      usuarioId: null, nombreFirmante: "Juan Pérez", origenFirma: "ESCANEADA", metodo: "FIRMA_MANUSCRITA",
      entidadTipo: "SOLICITUD_FONDO", entidadId: 10, modulo: "FONDOS",
      imagen: { relative: RELATIVA, mime: "application/pdf" },
    });
    expect(datos.imagen.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(datos.valoresRelevantes).toMatchObject({
      entregaId: 5, operadorUsuarioId: 9, operadorNombre: "Pedro Presencial", evidencia: { tipo: "CONSTANCIA_FIRMADA_ESCANEADA", mime: "application/pdf" },
    });
  });

  it("alternativa con firma dibujada: origen DIBUJADA y sin marca de evidencia", async () => {
    const png = bytesDe([137, 80, 78, 71, 13, 10, 26, 10]);
    const recibida = fila({ estado: "RECIBIDA", recibido_por_nombre: "Juan Pérez", recibido_en: new Date(), firma_recepcion_id: 200,
      recepcion_operada_por_usuario_id: 9, recepcion_operada_por_nombre: "Pedro Presencial" });
    m.query.mockResolvedValueOnce([fila()]).mockResolvedValueOnce([fila()]).mockResolvedValueOnce([recibida]);
    conexion();
    await registrarRecepcionPresencial({ ...base, firma: { origen: "DIBUJADA", imagen: { bytes: png, original: "f.png" } } });
    const datos = m.crearFirmaInterna.mock.calls[0][1];
    expect(datos).toMatchObject({ origenFirma: "DIBUJADA", imagen: { mime: "image/png" } });
    expect(datos.valoresRelevantes.evidencia).toBeNull();
    expect(m.guardarUpload).toHaveBeenCalledWith(1, "firmas", "firma_recepcion_presencial_5", expect.anything());
  });

  it("repetición (ya registrada por el mismo operador con el mismo nombre) => el archivo copiado se borra", async () => {
    const yaRecibida = fila({ estado: "RECIBIDA", recibido_por_nombre: "Juan Pérez", recibido_en: new Date(), firma_recepcion_id: 200,
      recepcion_operada_por_usuario_id: 9, recepcion_operada_por_nombre: "Pedro Presencial" });
    m.query.mockResolvedValueOnce([fila()]).mockResolvedValueOnce([yaRecibida]);
    await registrarRecepcionPresencial({ ...base, evidencia: { bytes: PDF, original: "e.pdf" } });
    expect(m.getConnection).not.toHaveBeenCalled();
    expect(m.borrarUpload.mock.calls.map((c) => c[0])).toEqual([RELATIVA]);
  });
});
