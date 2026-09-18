import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query, execute: m.execute }));
import {
  ETIQUETAS_TIPO_LINEA_DOCUMENTO,
  lineaPerteneceARequerimiento,
  listarDocumentosLinea,
  obtenerDocumentoLinea,
  registrarDocumentoLinea,
  retirarDocumentoLinea,
  TIPOS_LINEA_DOCUMENTO,
} from "./linea-documentos";

/**
 * COMPRAS-FASE-3-DOCUMENTOS-LINEA — capa de modelo. Mismo patrón de mocking
 * que multas/documentos.ts hubiera usado (query/execute de @/lib/db) y
 * consistente con requerimientos.test.ts (mock de @/lib/db en este módulo).
 */

const filaDoc = {
  id: 55,
  empresa_id: 1,
  requerimiento_id: 12,
  linea_id: 21,
  tipo: "FACTURA",
  ruta_relativa: "empresas/1/compras/req12_linea21_x.pdf",
  nombre_original: "factura-123.pdf",
  mime: "application/pdf",
  tamano: 12345,
  subido_por_usuario_id: 8,
  subido_en: "2026-09-18 10:00:00",
};

beforeEach(() => {
  vi.resetAllMocks();
  m.execute.mockResolvedValue({ insertId: 55, affectedRows: 1 });
  m.query.mockResolvedValue([]);
});

describe("catálogo de tipos", () => {
  it("expone los 6 tipos pedidos con etiquetas legibles", () => {
    expect(TIPOS_LINEA_DOCUMENTO).toEqual(["FACTURA", "COTIZACION", "ORDEN_COMPRA", "COMPROBANTE", "NOTA_CREDITO", "OTRO"]);
    expect(ETIQUETAS_TIPO_LINEA_DOCUMENTO.FACTURA).toBe("Factura");
    expect(ETIQUETAS_TIPO_LINEA_DOCUMENTO.COTIZACION).toBe("Cotización");
    expect(ETIQUETAS_TIPO_LINEA_DOCUMENTO.ORDEN_COMPRA).toBe("Orden de compra");
    expect(ETIQUETAS_TIPO_LINEA_DOCUMENTO.COMPROBANTE).toBe("Comprobante de pago");
    expect(ETIQUETAS_TIPO_LINEA_DOCUMENTO.NOTA_CREDITO).toBe("Nota de crédito");
    expect(ETIQUETAS_TIPO_LINEA_DOCUMENTO.OTRO).toBe("Otro");
  });
});

describe("lineaPerteneceARequerimiento — tenant isolation", () => {
  it("true cuando existe con ese empresa_id/requerimiento_id/id exactos", async () => {
    m.query.mockResolvedValue([{ id: 21 }]);
    expect(await lineaPerteneceARequerimiento(1, 12, 21)).toBe(true);
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("FROM compras_requerimiento_lineas"), [1, 12, 21]);
  });

  it("false si la línea es de otra empresa aunque el id coincida", async () => {
    m.query.mockResolvedValue([]);
    expect(await lineaPerteneceARequerimiento(2, 12, 21)).toBe(false);
    expect(m.query).toHaveBeenCalledWith(expect.any(String), [2, 12, 21]);
  });

  it("false si la línea pertenece a otro requerimiento de la misma empresa", async () => {
    m.query.mockResolvedValue([]);
    expect(await lineaPerteneceARequerimiento(1, 99, 21)).toBe(false);
  });
});

describe("listarDocumentosLinea", () => {
  it("filtra por empresa/requerimiento/línea y excluye retirados", async () => {
    m.query.mockResolvedValue([filaDoc]);
    const docs = await listarDocumentosLinea(1, 12, 21);
    expect(docs).toEqual([{
      id: 55, empresaId: 1, requerimientoId: 12, lineaId: 21, tipo: "FACTURA",
      rutaRelativa: filaDoc.ruta_relativa, nombreOriginal: "factura-123.pdf", mime: "application/pdf",
      tamano: 12345, subidoPorUsuarioId: 8, subidoEn: "2026-09-18 10:00:00",
    }]);
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toContain("AND retirado = 0");
    expect(params).toEqual([1, 12, 21]);
  });

  it("múltiples documentos en la misma línea se listan todos", async () => {
    m.query.mockResolvedValue([filaDoc, { ...filaDoc, id: 56, tipo: "COTIZACION", nombre_original: "cotizacion-proveedor.pdf" }]);
    const docs = await listarDocumentosLinea(1, 12, 21);
    expect(docs).toHaveLength(2);
    expect(docs.map(d => d.tipo)).toEqual(["FACTURA", "COTIZACION"]);
  });

  it("líneas diferentes mantienen documentos separados (filtro por linea_id)", async () => {
    await listarDocumentosLinea(1, 12, 21);
    await listarDocumentosLinea(1, 12, 22);
    expect(m.query.mock.calls[0][1]).toEqual([1, 12, 21]);
    expect(m.query.mock.calls[1][1]).toEqual([1, 12, 22]);
  });

  it("histórico sin documentos: lista vacía, sin error", async () => {
    m.query.mockResolvedValue([]);
    expect(await listarDocumentosLinea(1, 12, 21)).toEqual([]);
  });
});

describe("obtenerDocumentoLinea", () => {
  it("filtra por empresa_id (tenant) y excluye retirados", async () => {
    m.query.mockResolvedValue([filaDoc]);
    const doc = await obtenerDocumentoLinea(1, 55);
    expect(doc?.rutaRelativa).toBe(filaDoc.ruta_relativa);
    expect(m.query.mock.calls[0][1]).toEqual([55, 1]);
  });

  it("null si no existe o pertenece a otra empresa", async () => {
    m.query.mockResolvedValue([]);
    expect(await obtenerDocumentoLinea(2, 55)).toBeNull();
  });
});

describe("registrarDocumentoLinea", () => {
  it("inserta con todos los campos pedidos por el ticket y devuelve el id", async () => {
    const id = await registrarDocumentoLinea({
      empresaId: 1, requerimientoId: 12, lineaId: 21, tipo: "FACTURA",
      rutaRelativa: "empresas/1/compras/x.pdf", nombreOriginal: "factura.pdf",
      mime: "application/pdf", tamano: 999, subidoPorUsuarioId: 8,
    });
    expect(id).toBe(55);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("INSERT INTO compras_linea_documentos");
    expect(params).toEqual([1, 12, 21, "FACTURA", "empresas/1/compras/x.pdf", "factura.pdf", "application/pdf", 999, 8]);
  });
});

describe("retirarDocumentoLinea — baja lógica, más restrictiva que subir", () => {
  it("retira (soft-delete) cuando el requerimiento está Pendiente", async () => {
    m.query.mockResolvedValue([filaDoc]);
    m.execute.mockResolvedValue({ affectedRows: 1 });
    const r = await retirarDocumentoLinea(1, 55, 9, "Duplicado");
    expect(r).toEqual({ ok: true, mensaje: "Documento eliminado." });
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).not.toMatch(/^\s*DELETE/i);
    expect(sql).toContain("SET d.retirado = 1");
    expect(sql).toContain("r.estado = 'Pendiente'");
    expect(params).toEqual([9, "Duplicado", 55, 1]);
  });

  it("409 cuando el requerimiento ya no está Pendiente (regla más restrictiva que subir)", async () => {
    m.query.mockResolvedValue([filaDoc]);
    m.execute.mockResolvedValue({ affectedRows: 0 });
    const r = await retirarDocumentoLinea(1, 55, 9, null);
    expect(r).toEqual({ ok: false, status: 409, mensaje: expect.stringContaining("Pendiente") });
  });

  it("404 si el documento no existe o pertenece a otra empresa", async () => {
    m.query.mockResolvedValue([]);
    const r = await retirarDocumentoLinea(1, 999, 9, null);
    expect(r).toEqual({ ok: false, status: 404, mensaje: "Documento no encontrado." });
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("nunca hace DELETE físico del registro (siempre UPDATE con retirado=1)", async () => {
    m.query.mockResolvedValue([filaDoc]);
    m.execute.mockResolvedValue({ affectedRows: 1 });
    await retirarDocumentoLinea(1, 55, 9, null);
    expect(m.execute.mock.calls[0][0]).toMatch(/^\s*UPDATE compras_linea_documentos/);
  });
});
