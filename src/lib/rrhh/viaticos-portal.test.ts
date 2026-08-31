import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { listarHistorialViaticosPropios } from "./viaticos-portal";

type MockedQuery = Awaited<ReturnType<typeof query>>;
it("filtra por empresa/empleado y no expone detalles administrativos", async () => {
  vi.mocked(query).mockResolvedValue([]);
  expect(await listarHistorialViaticosPropios(3, 7, 2)).toEqual({ items: [], hayMas: false });
  const [sql, params] = vi.mocked(query).mock.calls[0];
  expect(params).toEqual([3, 7, 50]);
  expect(sql).toContain("v.empresa_id = ? AND tp.id_empleado = ? AND tp.tipo IN ('Piloto', 'Auxiliar')");
  expect(sql).not.toMatch(/referencia_pago|cuenta_bancaria|autorizado_por|motivo_cambio|tarifa/);
});

it("VIATICOS-RECHAZADO-1 (29/30) — sin filtro de estado (no oculta RECHAZADO) y expone fecha/motivo de rechazo", async () => {
  vi.mocked(query).mockResolvedValue([{
    id: 10, plan_id: 1, codigo: "PLAN-1", fecha: "2026-08-01", monto_asignado: "500", estado: "RECHAZADO",
    entregado: null, liquidado: null, rechazado: "31/08/2026 09:00", motivo_rechazo: "No corresponde: viaje cancelado.",
  }] as unknown as MockedQuery);
  const r = await listarHistorialViaticosPropios(3, 7, 1);
  expect(r.items[0]).toMatchObject({ estado: "RECHAZADO", rechazado: "31/08/2026 09:00", motivoRechazo: "No corresponde: viaje cancelado." });
  const [sql] = vi.mocked(query).mock.calls[0];
  expect(sql).not.toContain("WHERE v.estado");
});
