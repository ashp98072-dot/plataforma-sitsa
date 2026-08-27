import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { listarHistorialViaticosPropios } from "./viaticos-portal";
it("filtra por empresa/empleado y no expone detalles administrativos", async () => {
  vi.mocked(query).mockResolvedValue([]);
  expect(await listarHistorialViaticosPropios(3, 7, 2)).toEqual({ items: [], hayMas: false });
  const [sql, params] = vi.mocked(query).mock.calls[0];
  expect(params).toEqual([3, 7, 50]);
  expect(sql).toContain("v.empresa_id = ? AND tp.id_empleado = ? AND tp.tipo IN ('Piloto', 'Auxiliar')");
  expect(sql).not.toMatch(/referencia_pago|cuenta_bancaria|autorizado_por|motivo_cambio|tarifa/);
});
