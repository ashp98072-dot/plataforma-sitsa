import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));

import { query, execute } from "@/lib/db";
import {
  HabilitacionError,
  fijarHabilitacion,
  listarHabilitacionesActivasDe,
  listarHabilitacionesEmpresa,
} from "./personal-habilitaciones";

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("listarHabilitacionesActivasDe", () => {
  it("lista vacía de empleados -> Map vacío, sin consultar BD", async () => {
    const r = await listarHabilitacionesActivasDe(7, []);
    expect(r.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("filtra por activo=1 en la query — una habilitación desactivada nunca aparece en el resultado", async () => {
    vi.mocked(query).mockResolvedValue([{ empleado_id: 1, rol: "PILOTO", estado: "HABILITADO" }] as never);
    await listarHabilitacionesActivasDe(7, [1, 2]);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("activo = 1");
  });

  it("agrupa correctamente por empleado_id (un empleado puede tener 2 filas, una por rol)", async () => {
    vi.mocked(query).mockResolvedValue([
      { empleado_id: 1, rol: "PILOTO", estado: "CAPACITACION" },
      { empleado_id: 1, rol: "AUXILIAR", estado: "HABILITADO" },
    ] as never);
    const r = await listarHabilitacionesActivasDe(7, [1]);
    expect(r.get(1)).toEqual([
      { rol: "PILOTO", estado: "CAPACITACION" },
      { rol: "AUXILIAR", estado: "HABILITADO" },
    ]);
  });

  it("acota SIEMPRE por empresa_id — nunca trae habilitaciones de otra empresa", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarHabilitacionesActivasDe(7, [1]);
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toContain(7);
  });
});

describe("listarHabilitacionesEmpresa", () => {
  it("lista TODAS (activas e inactivas) de la empresa — la UI de administración decide qué mostrar", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 1, empleado_id: 1, rol: "PILOTO", estado: "HABILITADO", activo: 1 },
      { id: 2, empleado_id: 1, rol: "AUXILIAR", estado: "CAPACITACION", activo: 0 },
    ] as never);
    const r = await listarHabilitacionesEmpresa(7);
    expect(r).toHaveLength(2);
    expect(r[1].activo).toBe(false);
  });
});

describe("fijarHabilitacion", () => {
  it("empleado inexistente/inactivo en esa empresa -> HabilitacionError 404, sin escribir", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await expect(fijarHabilitacion(7, 999, "PILOTO", "HABILITADO")).rejects.toThrow(HabilitacionError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("estado no-null -> upsert con ON DUPLICATE KEY UPDATE sobre la UNIQUE KEY (empresa,empleado,rol)", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 1 }] as never);
    await fijarHabilitacion(7, 1, "PILOTO", "CAPACITACION");
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("ON DUPLICATE KEY UPDATE"), [7, 1, "PILOTO", "CAPACITACION"]);
  });

  it("estado=null -> UPDATE activo=0 (desactiva), NUNCA DELETE — no borra historial", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 1 }] as never);
    await fijarHabilitacion(7, 1, "AUXILIAR", null);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("SET activo = 0"), [7, 1, "AUXILIAR"]);
    expect(vi.mocked(execute).mock.calls.some(([sql]) => /DELETE/i.test(String(sql)))).toBe(false);
  });

  it("nunca escribe en tms_personal — la habilitación no crea ni toca el catálogo operativo", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 1 }] as never);
    await fijarHabilitacion(7, 1, "PILOTO", "HABILITADO");
    for (const [sql] of vi.mocked(execute).mock.calls) {
      expect(String(sql)).not.toMatch(/tms_personal\b(?!_habilitaciones)/);
    }
  });

  it("la validación del empleado se hace SIEMPRE contra el empresa_id recibido — aislamiento multiempresa", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 1 }] as never);
    await fijarHabilitacion(42, 1, "PILOTO", "HABILITADO");
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("empresa_id = ?");
    expect(params).toEqual([42, 1]);
  });
});
