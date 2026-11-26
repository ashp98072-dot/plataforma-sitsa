import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), instalado: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => ({ query: mock.query, beginTransaction: mock.begin, commit: mock.commit, rollback: mock.rollback, release: mock.release }) }) }));
vi.mock("./pilotos-reportados", () => ({ esquemaPilotosReportados: mock.instalado }));
import { csvPilotos, reportePilotos } from "./pilotos-reporte";
beforeEach(() => { vi.clearAllMocks(); mock.instalado.mockResolvedValue(true); mock.query.mockResolvedValue([[], []]); });
describe("reporte de pilotos", () => {
 it("agrupa consumos filtrados por mes, identidad y moneda sin agregar facturas", async () => {
  await reportePilotos(7, { desde: "2026-10-01", hasta: "2026-10-31", proveedorId: 3 }, 0, 50);
  const consulta = mock.query.mock.calls.find(([sql]) => String(sql).includes(" AS piloto_reportado_id") || String(sql).includes("periodo,c.moneda"));
  expect(consulta).toBeDefined(); const [sql, args] = consulta!;
  expect(sql).toContain("c.empresa_id=?"); expect(sql).toContain("c.moneda"); expect(sql).toContain("GROUP BY c.empleado_id,c.piloto_externo_id");
  expect(sql).not.toContain("flota_cb2_facturas"); expect(sql).toContain("LIMIT ?"); expect(args).toEqual([7, 3, "2026-10-01", "2026-10-31", 501]);
  expect(mock.commit).toHaveBeenCalled();
 });
 it("limita grupos y advierte sin modificar los totales generales", async () => {
  const totales = [{ moneda: "GTQ", galones: "501.000000", importe: "1002.000000" }];
  mock.query.mockResolvedValueOnce([[],[]]).mockResolvedValueOnce([totales,[]]).mockResolvedValueOnce([Array.from({length:501},(_,i)=>({ piloto_informado:`Piloto ${i}` })),[]]).mockResolvedValueOnce([[],[]]);
  const r=await reportePilotos(7,{});
  expect(r.porPiloto).toHaveLength(500); expect(r.porPilotoIncompleto).toBe(true); expect(r.totales).toEqual(totales);
 });
 it("escapa valores de CSV que podrían ejecutarse como fórmulas", () => {
  expect(csvPilotos([{ piloto_informado: "=1+1", galones: "1.234567", monto: "10", moneda: "GTQ" }])).toContain('"\'=1+1"');
 });
});
