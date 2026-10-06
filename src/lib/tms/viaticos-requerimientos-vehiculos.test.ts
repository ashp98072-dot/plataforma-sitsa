import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  query: vi.fn(),
  conn: { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => ({ getConnection: async () => m.conn }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tms/identidad-administrativa", () => ({ resolverUsuarioDeEmpresaTx: vi.fn(async () => ({ nombre: "Requirente" })) }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn() }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));

import { guardarRequerimientoViatico } from "./viaticos-requerimientos";
import { guardarRequerimientoViaticoSchema } from "./viaticos-requerimientos-schema";
import { EMPRESA_B, ID, esConsultaAccesible, filaAccesibleTx } from "@/lib/flota/vehiculos-compartidos.fixture";

/**
 * Requerimientos de viáticos con unidad: misma regla única de Flota. Fixture estándar (C-091BXF de Frescofresh compartida con Mónaco = B).
 */
const datos = (vehiculoId: number) => guardarRequerimientoViaticoSchema.parse({
  fechaRequerimiento: "2026-09-24", empresaRequirente: "KUIQTRANS", requirenteUsuarioId: 5,
  lineas: [{ fechaSolicitud: "2026-09-22", fechaViaje: "2026-09-24", personalId: 1, vehiculoId, cantidad: "1", destino: "Destino", montoUnitario: "10" }],
});
const insertLinea = () => m.conn.execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tms_viatico_requerimiento_lineas"));

beforeEach(() => {
  vi.resetAllMocks();
  m.conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (esConsultaAccesible(sql)) return [filaAccesibleTx(params)];
    if (sql.includes("FROM tms_personal tp")) return [[{ id: 1, id_empleado: 2, nombre: "Piloto", cargo: "Piloto", cuenta_bancaria: null, banco: null, sugerido: 10 }]];
    if (sql.includes("FROM usuarios")) return [[{ nombre: "Solicitante" }]];
    return [[]];
  });
  m.conn.execute.mockResolvedValue([{ insertId: 31, affectedRows: 1 }]);
  m.query.mockResolvedValue([]);
});

describe("Requerimiento de viáticos con unidad compartida", () => {
  it("la unidad COMPARTIDA con la empresa activa se acepta y congela la placa (vehiculo_id real)", async () => {
    await guardarRequerimientoViatico(EMPRESA_B, 8, "Registrador", datos(ID.COMPARTIDO));
    expect(m.conn.commit).toHaveBeenCalledOnce();
    expect(insertLinea()![1]).toEqual(expect.arrayContaining([ID.COMPARTIDO, "C-091BXF"]));
  });
  it("la unidad PROPIA sigue funcionando", async () => {
    await guardarRequerimientoViatico(EMPRESA_B, 8, "Registrador", datos(ID.PROPIO));
    expect(insertLinea()![1]).toEqual(expect.arrayContaining([ID.PROPIO, "M-001MON"]));
  });
  it.each([["no compartida", ID.NO_COMPARTIDO], ["de otro tenant", ID.OTRO_TENANT], ["id manipulado", ID.INEXISTENTE]])("rechaza una unidad %s, con rollback y sin insertar", async (_n, id) => {
    await expect(guardarRequerimientoViatico(EMPRESA_B, 8, "Registrador", datos(id))).rejects.toThrow("La unidad no pertenece a esta empresa.");
    expect(insertLinea()).toBeUndefined();
    expect(m.conn.rollback).toHaveBeenCalledOnce(); expect(m.conn.commit).not.toHaveBeenCalled();
  });
  it("la propiedad no cambia: no se escribe en flota_vehiculos ni flota_vehiculo_acceso", async () => {
    await guardarRequerimientoViatico(EMPRESA_B, 8, "Registrador", datos(ID.COMPARTIDO));
    const sqls = [...m.conn.execute.mock.calls, ...m.conn.query.mock.calls].map((c) => String(c[0]));
    expect(sqls.some((s) => /(UPDATE|INSERT INTO|DELETE FROM)\s+flota_/i.test(s))).toBe(false);
  });
});
