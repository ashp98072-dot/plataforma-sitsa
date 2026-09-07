import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { confirmarImportacionRutas, previsualizarImportacionRutas } from "./rutas-import";
import type { FilaRutaExcel } from "./rutas-import-excel";

function fila(overrides: Partial<FilaRutaExcel> = {}): FilaRutaExcel {
  return {
    filaExcel: 2, codigoExcel: "1001", clienteExcel: "Acme", lugarCargaExcel: "Bodega",
    horaExcel: "08:00", contactoExcel: "Ana", destinoExcel: "Destino", costoOperativoExcel: 80, tarifaReferenciaExcel: 100,
    pilotoCodigoExcel: "P-1", pilotoViaticoExcel: 50, auxiliaresCodigosExcel: ["A-1", "A-2"],
    auxiliaresViaticosExcel: [25, 30], erroresCamposExcel: [], ...overrides,
  };
}

function prepararPreview(empleados: Record<string, unknown>[]) {
  vi.mocked(query).mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes("FROM tms_clientes")) return [{ id: 5, nombre: "Acme" }] as never;
    if (text.includes("FROM empleados")) return empleados as never;
    return [] as never;
  });
}

const activos = [
  { id: 10, codigo: "p-1", nombre: "Piloto", estado: "Activo" },
  { id: 20, codigo: "a-1", nombre: "Aux 1", estado: "Activo" },
  { id: 21, codigo: "A-2", nombre: "Aux 2", estado: "Activo" },
];

describe("validación de personal en importación de rutas", () => {
  beforeEach(() => vi.resetAllMocks());

  it("acepta piloto y múltiples auxiliares con códigos equivalentes sin distinguir mayúsculas", async () => {
    prepararPreview(activos);
    const result = await previsualizarImportacionRutas(7, [fila()]);
    expect(result.filas[0].estado).toBe("nueva");
    const llamada = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes("FROM empleados"));
    expect(llamada?.[1]).toEqual([7]);
  });

  it("rechaza empleado repetido y piloto repetido como auxiliar", async () => {
    prepararPreview(activos);
    const result = await previsualizarImportacionRutas(7, [fila({ auxiliaresCodigosExcel: ["A-1", "P-1"] })]);
    expect(result.filas[0].estado).toBe("error");
    expect(result.filas[0].detalle).toContain("repetidos");
  });

  it("rechaza empleado inactivo", async () => {
    prepararPreview([{ id: 10, codigo: "P-1", estado: "Inactivo" }, ...activos.slice(1)]);
    const result = await previsualizarImportacionRutas(7, [fila()]);
    expect(result.filas[0].detalle).toContain("inactivo");
  });

  it("trata como inexistente al empleado de otra empresa porque solo consulta el tenant actual", async () => {
    prepararPreview(activos.slice(1));
    const result = await previsualizarImportacionRutas(7, [fila()]);
    expect(result.filas[0].estado).toBe("error");
    expect(result.filas[0].detalle.toLowerCase()).toContain("p-1");
  });

  it("revierte toda la importación ante un error inesperado", async () => {
    const conn = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tms_clientes")) return [[{ id: 5, nombre: "Acme" }]];
        if (sql.includes("FROM empleados")) return [activos];
        return [[]];
      }),
      execute: vi.fn().mockRejectedValue(new Error("fallo de BD")),
    };
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
    await expect(confirmarImportacionRutas(7, "admin", [fila()], [], [])).rejects.toThrow("fallo de BD");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("reimportar sin Actualizar omite sin crear contactos, ubicaciones ni personal", async () => {
    const conn = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tms_clientes")) return [[{ id: 5, nombre: "Acme" }]];
        if (sql.includes("FROM empleados")) return [activos];
        if (sql.includes("FROM tms_cliente_rutas")) return [[{ id: 77, codigo: "1001", cliente_id: 5 }]];
        return [[]];
      }),
    };
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
    const result = await confirmarImportacionRutas(7, "admin", [fila()], [], []);
    expect(result.omitidas).toBe(1);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it.each([
    ["informado", fila(), true],
    ["vacío", fila({ pilotoCodigoExcel: "", pilotoViaticoExcel: null, auxiliaresCodigosExcel: [], auxiliaresViaticosExcel: [], tarifaReferenciaExcel: null }), false],
  ] as const)("actualizar con personal %s %s defaults anteriores", async (_caso, entradaFila, reemplaza) => {
    let insertId = 100;
    const conn = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tms_clientes")) return [[{ id: 5, nombre: "Acme" }]];
        if (sql.includes("FROM empleados")) return [activos];
        if (sql.includes("FROM tms_cliente_rutas")) return [[{ id: 77, codigo: "1001", cliente_id: 5 }]];
        return [[]];
      }),
      execute: vi.fn(async (sql: string, params?: unknown[]) => {
        void sql;
        void params;
        return [{ insertId: insertId++, affectedRows: 1 }];
      }),
    };
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
    const result = await confirmarImportacionRutas(7, "admin", [entradaFila], [{ filaExcel: 2, actualizarExistente: true }], []);
    expect(result.actualizadas).toBe(1);
    const borroPersonal = conn.execute.mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM tms_cliente_ruta_personal"));
    expect(borroPersonal).toBe(reemplaza);
    expect(conn.commit).toHaveBeenCalledOnce();
  });
});
