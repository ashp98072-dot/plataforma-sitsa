import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));

import { query } from "@/lib/db";
import { listarEntrevistadoresActivos } from "./entrevistas";

const EMPRESA = 7;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ATRACCION-TALENTO-1 (corrección post-revisión) — listarEntrevistadoresActivos", () => {
  it("4) filtra por estado = 'Activo' en el propio SQL", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    await listarEntrevistadoresActivos(EMPRESA);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toMatch(/estado = 'Activo'/);
  });

  it("3) siempre filtra por empresa_id, recibido como parámetro (nunca confiado del cliente)", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    await listarEntrevistadoresActivos(EMPRESA);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toMatch(/empresa_id = \?/);
    expect(params).toEqual([EMPRESA]);
  });

  it("5) el payload devuelto contiene únicamente id/codigo/nombre — nunca sueldo, DPI, NIT, banco, cuenta, teléfono, email", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      { id: 1, codigo: "E001", nombre: "Juan Pérez" },
    ] as never);
    const r = await listarEntrevistadoresActivos(EMPRESA);
    expect(r).toEqual([{ id: 1, codigo: "E001", nombre: "Juan Pérez" }]);
    expect(Object.keys(r[0]).sort()).toEqual(["codigo", "id", "nombre"]);
  });

  it("la propia consulta SQL no selecciona columnas sensibles", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    await listarEntrevistadoresActivos(EMPRESA);
    const [sql] = vi.mocked(query).mock.calls[0];
    const select = String(sql).split("FROM")[0].toLowerCase();
    for (const columna of ["sueldo", "dpi", "nit", "banco", "cuenta", "telefono", "email"]) {
      expect(select).not.toContain(columna);
    }
  });
});
