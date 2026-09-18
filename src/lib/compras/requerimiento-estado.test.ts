import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  queryPublico: vi.fn(),
  audit: vi.fn(),
  crearFirma: vi.fn(),
  guardarUpload: vi.fn(),
  borrarUpload: vi.fn(),
  getConnection: vi.fn(),
  conn: { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ query: m.queryPublico, getPool: () => ({ getConnection: m.getConnection }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: m.crearFirma }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: m.guardarUpload, borrarUpload: m.borrarUpload }));
import {
  autorizarRequerimientoCompra,
  CONFLICTO_COMPRA,
  MENSAJE_AUTOAUTORIZACION_COMPRA,
  MENSAJE_FIRMA_REQUERIDA_AUTORIZAR,
  rechazarRequerimientoCompra,
} from "./requerimientos";

/**
 * COMPRAS-FASE-4-AUTORIZACION — capa de modelo: transición de estado,
 * firma, autoautorización, concurrencia. Archivo dedicado (no
 * requerimientos.test.ts) para no interferir con el mock/fixture ya
 * afinado de guardarRequerimiento().
 */

const FIRMA = { bytes: new ArrayBuffer(3), original: "firma.png" };

let fila: Record<string, unknown> | null;
beforeEach(() => {
  vi.resetAllMocks();
  fila = {
    codigo: "RC-2026-000012",
    total: "20.50",
    estado: "Pendiente",
    version: 2,
    requirente_usuario_id: 30,
    solicitante_usuario_id: 31,
    creado_por: 32,
  };
  m.getConnection.mockResolvedValue(m.conn);
  m.conn.query.mockImplementation(async () => [fila ? [fila] : []]);
  m.conn.execute.mockResolvedValue([{ affectedRows: 1 }]);
  m.crearFirma.mockResolvedValue({
    id: 1, codigoFirma: "F-1", fechaHoraServidor: new Date("2026-09-18T12:00:00Z"),
    hashPayload: "hash", nombreFirmante: "Autorizante", rolFirmante: "Admin", tieneImagen: true,
  });
  m.guardarUpload.mockResolvedValue({ relative: "empresas/1/firmas/firma_compra_autorizar_12_x.png", original: "firma.png", size: 3 });
  m.queryPublico.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM compras_requerimientos")) {
      return [{
        id: 12, codigo: "RC-2026-000012", fecha_requerimiento: "2026-09-17",
        entidad_requirente_id: 4, entidad_requirente_nombre: "Entidad", requirente_usuario_id: 30, requirente_nombre: "Requirente",
        solicitante_usuario_id: 31, solicitante_nombre: "Solicitante", encargado_compras_usuario_id: null, encargado_compras_nombre: null,
        observaciones: null, total: "20.50", estado: "Autorizada", version: 3,
        autorizante_usuario_id: 8, autorizante_nombre: "Autorizante", autorizado_en: "2026-09-18 12:00:00",
        rechazado_en: null, motivo_rechazo: null,
      }];
    }
    if (sql.includes("FROM compras_requerimiento_lineas")) return [];
    throw new Error(`SQL inesperado: ${sql}`);
  });
});

const autorizarOpts = () => ({
  usuario: "admin1", autorizanteUsuarioId: 8, autorizanteNombre: "Autorizante", autorizanteRol: "Admin", firmaImagen: FIRMA,
});

describe("Pendiente -> Autorizada", () => {
  it("autoriza: UPDATE con estado/autorizante/autorizado_en, limpia rechazado_en/motivo_rechazo, incrementa version", async () => {
    const r = await autorizarRequerimientoCompra(1, 12, 2, autorizarOpts());
    expect(r).not.toBeNull();
    const [sql, params] = m.conn.execute.mock.calls[0];
    expect(sql).toContain("SET estado = 'Autorizada'");
    expect(sql).toContain("autorizante_usuario_id = ?");
    expect(sql).toContain("autorizado_en = NOW()");
    expect(sql).toContain("rechazado_en = NULL");
    expect(sql).toContain("motivo_rechazo = NULL");
    expect(sql).toContain("version = version + 1");
    expect(params).toEqual([8, "Autorizante", 1, 12]);
    expect(m.conn.commit).toHaveBeenCalledOnce();
    expect(m.borrarUpload).not.toHaveBeenCalled();
  });

  it("captura usuario/nombre de sesión reales (los que resolvió el caller), nunca inventados aquí", async () => {
    await autorizarRequerimientoCompra(1, 12, 2, { ...autorizarOpts(), autorizanteUsuarioId: 99, autorizanteNombre: "Otra Persona" });
    const [, params] = m.conn.execute.mock.calls[0];
    expect(params).toEqual([99, "Otra Persona", 1, 12]);
  });

  it("snapshot de firma queda asociado a REQUERIMIENTO_COMPRA/COMPRAS/AUTORIZAR_COMPRA, dentro de la misma transacción", async () => {
    await autorizarRequerimientoCompra(1, 12, 2, autorizarOpts());
    expect(m.crearFirma).toHaveBeenCalledWith(m.conn, expect.objectContaining({
      empresaId: 1, usuarioId: 8, nombreFirmante: "Autorizante", rolFirmante: "Admin",
      accion: "AUTORIZAR_COMPRA", modulo: "COMPRAS", entidadTipo: "REQUERIMIENTO_COMPRA", entidadId: 12,
      metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
    }));
    // Orden: firma antes del commit (misma transacción).
    expect(m.crearFirma.mock.invocationCallOrder[0]).toBeLessThan(m.conn.commit.mock.invocationCallOrder[0]);
  });

  it("registra auditoría autorizar_requerimiento_compras con detalle estructurado", async () => {
    await autorizarRequerimientoCompra(1, 12, 2, autorizarOpts());
    expect(m.audit).toHaveBeenCalledWith(m.conn, expect.objectContaining({
      empresaId: 1, usuario: "admin1", modulo: "compras_requerimientos", accion: "autorizar_requerimiento_compras",
    }));
    const detalle = JSON.parse(m.audit.mock.calls[0][1].detalle);
    expect(detalle).toMatchObject({
      requerimientoId: 12, codigo: "RC-2026-000012", estadoAnterior: "Pendiente", estadoNuevo: "Autorizada",
      total: "20.50", usuarioId: 8,
    });
  });

  it("firma requerida: sin firma -> 400, NUNCA abre transacción ni escribe archivo", async () => {
    await expect(autorizarRequerimientoCompra(1, 12, 2, { ...autorizarOpts(), firmaImagen: null }))
      .rejects.toMatchObject({ message: MENSAJE_FIRMA_REQUERIDA_AUTORIZAR, status: 400 });
    expect(m.conn.beginTransaction).not.toHaveBeenCalled();
    expect(m.guardarUpload).not.toHaveBeenCalled();
  });

  it("cleanup best-effort del archivo de firma si la transacción falla (p. ej. el UPDATE lanza)", async () => {
    m.conn.execute.mockRejectedValueOnce(new Error("fallo de conexión"));
    await expect(autorizarRequerimientoCompra(1, 12, 2, autorizarOpts())).rejects.toThrow("fallo de conexión");
    expect(m.conn.rollback).toHaveBeenCalledOnce();
    expect(m.conn.commit).not.toHaveBeenCalled();
    expect(m.borrarUpload).toHaveBeenCalledWith("empresas/1/firmas/firma_compra_autorizar_12_x.png");
  });

  it("REVISIÓN PRE-MERGE — getPool().getConnection() falla DESPUÉS de guardar la copia física: no queda huérfana, no crea firma ni auditoría, sin rollback (nunca hubo conexión/transacción)", async () => {
    m.getConnection.mockRejectedValue(new Error("pool agotado"));
    await expect(autorizarRequerimientoCompra(1, 12, 2, autorizarOpts())).rejects.toThrow("pool agotado");
    // La copia física SÍ se creó (guardarImagenFirmaCompra corre antes de
    // getConnection) — debe limpiarse igual que cualquier otro fallo
    // posterior, aunque nunca haya llegado a abrirse una transacción.
    expect(m.borrarUpload).toHaveBeenCalledWith("empresas/1/firmas/firma_compra_autorizar_12_x.png");
    expect(m.crearFirma).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    // No hay conexión que revertir ni liberar: conn nunca llegó a existir.
    expect(m.conn.rollback).not.toHaveBeenCalled();
    expect(m.conn.release).not.toHaveBeenCalled();
    expect(m.conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("requerimiento inexistente en esta empresa -> null (el caller responde 404), revierte sin escribir nada más, limpia la copia física", async () => {
    fila = null;
    const r = await autorizarRequerimientoCompra(1, 999, 2, autorizarOpts());
    expect(r).toBeNull();
    expect(m.conn.rollback).toHaveBeenCalledOnce();
    expect(m.crearFirma).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.borrarUpload).toHaveBeenCalledWith("empresas/1/firmas/firma_compra_autorizar_12_x.png");
  });

  describe("autoautorización bloqueada (comparación por ID, nunca por nombre)", () => {
    it("bloquea si el autorizante es el requirente, limpia la copia física de la firma", async () => {
      await expect(autorizarRequerimientoCompra(1, 12, 2, { ...autorizarOpts(), autorizanteUsuarioId: 30 }))
        .rejects.toMatchObject({ message: MENSAJE_AUTOAUTORIZACION_COMPRA, status: 403 });
      expect(m.conn.execute).not.toHaveBeenCalled();
      expect(m.borrarUpload).toHaveBeenCalledWith("empresas/1/firmas/firma_compra_autorizar_12_x.png");
    });
    it("bloquea si el autorizante es el solicitante", async () => {
      await expect(autorizarRequerimientoCompra(1, 12, 2, { ...autorizarOpts(), autorizanteUsuarioId: 31 }))
        .rejects.toMatchObject({ message: MENSAJE_AUTOAUTORIZACION_COMPRA, status: 403 });
    });
    it("bloquea si el autorizante es quien creó el registro (creado_por)", async () => {
      await expect(autorizarRequerimientoCompra(1, 12, 2, { ...autorizarOpts(), autorizanteUsuarioId: 32 }))
        .rejects.toMatchObject({ message: MENSAJE_AUTOAUTORIZACION_COMPRA, status: 403 });
    });
    it("permite si el autorizante NO coincide con ninguno de los tres", async () => {
      await expect(autorizarRequerimientoCompra(1, 12, 2, { ...autorizarOpts(), autorizanteUsuarioId: 8 })).resolves.not.toBeNull();
    });
  });

  it("versión desactualizada -> 409 CONFLICTO_COMPRA (mismo mensaje que guardarRequerimiento), limpia la copia física", async () => {
    await expect(autorizarRequerimientoCompra(1, 12, 99, autorizarOpts()))
      .rejects.toMatchObject({ message: CONFLICTO_COMPRA, status: 409 });
    expect(m.conn.execute).not.toHaveBeenCalled();
    expect(m.borrarUpload).toHaveBeenCalledWith("empresas/1/firmas/firma_compra_autorizar_12_x.png");
  });

  it("Autorizada no vuelve a cambiar: un segundo intento sobre un requerimiento ya Autorizada rechaza con 409", async () => {
    fila!.estado = "Autorizada";
    await expect(autorizarRequerimientoCompra(1, 12, 2, autorizarOpts())).rejects.toMatchObject({ status: 409 });
  });

  it("Rechazada no vuelve a cambiar: no se puede autorizar un requerimiento ya Rechazada", async () => {
    fila!.estado = "Rechazada";
    await expect(autorizarRequerimientoCompra(1, 12, 2, autorizarOpts())).rejects.toMatchObject({ status: 409 });
  });

  it("tenant isolation: el SELECT FOR UPDATE y el UPDATE filtran por empresa_id", async () => {
    await autorizarRequerimientoCompra(1, 12, 2, autorizarOpts());
    expect(m.conn.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), [1, 12]);
    const [, params] = m.conn.execute.mock.calls[0];
    expect(params.slice(-2)).toEqual([1, 12]);
  });
});

describe("Pendiente -> Rechazada", () => {
  const rechazarOpts = (motivo = "Presupuesto insuficiente") => ({ usuario: "admin1", usuarioId: 8, motivo });

  it("rechaza: UPDATE con estado/rechazado_en/motivo_rechazo, NUNCA toca autorizante_*", async () => {
    const r = await rechazarRequerimientoCompra(1, 12, 2, rechazarOpts());
    expect(r).not.toBeNull();
    const [sql, params] = m.conn.execute.mock.calls[0];
    expect(sql).toContain("SET estado = 'Rechazada'");
    expect(sql).toContain("rechazado_en = NOW()");
    expect(sql).toContain("motivo_rechazo = ?");
    expect(sql).not.toContain("autorizante");
    expect(sql).toContain("version = version + 1");
    expect(params).toEqual(["Presupuesto insuficiente", 1, 12]);
    expect(m.conn.commit).toHaveBeenCalledOnce();
  });

  it("rechazo no exige firma: nunca sube archivo ni crea firma interna", async () => {
    await rechazarRequerimientoCompra(1, 12, 2, rechazarOpts());
    expect(m.guardarUpload).not.toHaveBeenCalled();
    expect(m.crearFirma).not.toHaveBeenCalled();
  });

  it("registra auditoría rechazar_requerimiento_compras con motivoRechazo y usuarioId real de sesión", async () => {
    await rechazarRequerimientoCompra(1, 12, 2, rechazarOpts());
    expect(m.audit).toHaveBeenCalledWith(m.conn, expect.objectContaining({ accion: "rechazar_requerimiento_compras" }));
    const detalle = JSON.parse(m.audit.mock.calls[0][1].detalle);
    expect(detalle).toMatchObject({
      requerimientoId: 12, codigo: "RC-2026-000012", estadoAnterior: "Pendiente", estadoNuevo: "Rechazada",
      usuarioId: 8, motivoRechazo: "Presupuesto insuficiente",
    });
  });

  it("motivo obligatorio: vacío o solo espacios rechaza sin tocar la BD", async () => {
    await expect(rechazarRequerimientoCompra(1, 12, 2, rechazarOpts("   "))).rejects.toThrow("requiere un motivo");
    expect(m.conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("motivo máximo 1000 caracteres", async () => {
    await expect(rechazarRequerimientoCompra(1, 12, 2, rechazarOpts("x".repeat(1001)))).rejects.toThrow("1000 caracteres");
  });

  it("Rechazada no vuelve a cambiar: no se puede rechazar un requerimiento ya Rechazada", async () => {
    fila!.estado = "Rechazada";
    await expect(rechazarRequerimientoCompra(1, 12, 2, rechazarOpts())).rejects.toMatchObject({ status: 409 });
  });

  it("Autorizada no vuelve a cambiar: no se puede rechazar un requerimiento ya Autorizada", async () => {
    fila!.estado = "Autorizada";
    await expect(rechazarRequerimientoCompra(1, 12, 2, rechazarOpts())).rejects.toMatchObject({ status: 409 });
  });

  it("versión desactualizada -> 409 CONFLICTO_COMPRA", async () => {
    await expect(rechazarRequerimientoCompra(1, 12, 99, rechazarOpts())).rejects.toMatchObject({ message: CONFLICTO_COMPRA, status: 409 });
  });

  it("requerimiento inexistente -> null", async () => {
    fila = null;
    expect(await rechazarRequerimientoCompra(1, 999, 2, rechazarOpts())).toBeNull();
  });

  it("tenant isolation: el UPDATE filtra por empresa_id", async () => {
    await rechazarRequerimientoCompra(1, 12, 2, rechazarOpts());
    const [, params] = m.conn.execute.mock.calls[0];
    expect(params.slice(-2)).toEqual([1, 12]);
  });
});

describe("DetalleCompra expone el snapshot de la decisión (ticket sección 11)", () => {
  it("el SELECT de columnasCabecera incluye autorizante_usuario_id/autorizante_nombre/autorizado_en/rechazado_en/motivo_rechazo", async () => {
    await autorizarRequerimientoCompra(1, 12, 2, autorizarOpts());
    const llamadaCabecera = m.queryPublico.mock.calls.find((call: unknown[]) => String(call[0]).includes("FROM compras_requerimientos"));
    expect(llamadaCabecera).toBeDefined();
    const sql = String(llamadaCabecera![0]);
    for (const columna of ["autorizante_usuario_id", "autorizante_nombre", "autorizado_en", "rechazado_en", "motivo_rechazo"]) {
      expect(sql).toContain(columna);
    }
  });

  it("el resultado devuelto por autorizarRequerimientoCompra ya trae esos campos (re-fetch tras commit)", async () => {
    const r = await autorizarRequerimientoCompra(1, 12, 2, autorizarOpts());
    expect(r).toMatchObject({ autorizante_nombre: "Autorizante", autorizado_en: "2026-09-18 12:00:00" });
  });
});

describe("concurrencia: dos decisiones simultáneas no pueden completar ambas", () => {
  it("la segunda transacción, tras el FOR UPDATE, ve el estado ya cambiado por la primera y falla con 409", async () => {
    // Simula: la primera llamada "gana" la fila y la deja Autorizada;
    // cualquier llamada posterior que reintente el SELECT FOR UPDATE
    // (como haría una segunda transacción tras liberarse el lock) ve ese
    // nuevo estado — FOR UPDATE serializa, nunca deja pasar a ambas.
    const r1 = await autorizarRequerimientoCompra(1, 12, 2, autorizarOpts());
    expect(r1).not.toBeNull();
    fila!.estado = "Autorizada"; // lo que vería la segunda transacción tras esperar el lock
    await expect(autorizarRequerimientoCompra(1, 12, 2, autorizarOpts())).rejects.toMatchObject({ status: 409 });
  });
});
