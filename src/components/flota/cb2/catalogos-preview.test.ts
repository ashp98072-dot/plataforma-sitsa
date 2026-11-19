import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), query: vi.fn(), externos: vi.fn(), habilitados: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => { throw new Error("Catálogo no abre transacciones"); } }));
vi.mock("@/lib/flota/cb2/terceros", () => ({ listarCatalogosTerceros: m.externos, tercerosHabilitados: m.habilitados }));
import { GET } from "@/app/api/empresas/[slug]/flota/combustible/catalogos/route";
beforeEach(() => { m.guard.mockResolvedValue({ empresa: { id: 7 } }); m.query.mockResolvedValue([]); m.externos.mockResolvedValue({ pilotos: [], unidades: [], asociaciones: [] }); m.habilitados.mockReturnValue(false); });
describe("catálogo usado para sugerir vehículos en preview", () => {
    it("solo lista pilotos activos de la empresa autenticada y declara la limitación de CB2", async () => {
        m.query.mockImplementation(async (sql: string) => sql.includes("FROM empleados") ? [{ id: 1, nombre: "José Chay", estado: "Activo", fecha_egreso: null, fecha_alta: null }, { id: 2, nombre: "Andrés Taracena", estado: "Baja", fecha_egreso: new Date("2026-06-30T00:00:00Z"), fecha_alta: "2024-01-10" }] : []);
        const r = await GET(new Request("https://novalvion.com/api/catalogos?empresaId=99"), { params: Promise.resolve({ slug: "demo" }) });
        const data = await r.json();
        expect(data.pilotos).toEqual([{ id: 1, nombre: "José Chay", estado: "Activo", fechaBaja: null, fechaAlta: null }, { id: 2, nombre: "Andrés Taracena", estado: "Baja", fechaBaja: "2026-06-30", fechaAlta: "2024-01-10" }]); expect(data.empleados).toEqual(data.pilotos); expect(data.limitacionPilotos).toContain("empleados activos y de baja");
        const [sql, args] = m.query.mock.calls.find(([sql]) => sql.includes("FROM empleados"))!;
        expect(args).toEqual([7]); expect(sql).toContain("estado IN ('Activo','Baja')");
    });
    it("catálogo ausente declara indisponibilidad sin usar personal de otras empresas", async () => {
        m.query.mockImplementation(async (sql: string) => { if (sql.includes("FROM empleados")) throw new Error("Tabla no disponible"); return []; });
        const r = await GET(new Request("https://novalvion.com/api/catalogos"), { params: Promise.resolve({ slug: "demo" }) });
        expect(r.status).toBe(200); const data = await r.json();
        expect(data.empleados).toEqual([]); expect(data.empleadosDisponibles).toBe(false); expect(data.limitacionPilotos).toContain("no disponible");
        expect(m.query).toHaveBeenCalledTimes(5);   // un error que no es de columna inexistente NO se reintenta
    });
    it("deriva empresa del guard, no de parámetros controlados por el navegador", async () => {
        const r = await GET(new Request("https://novalvion.com/api/catalogos?empresaId=99"), { params: Promise.resolve({ slug: "demo" }) });
        expect(r.status).toBe(200); expect(m.guard).toHaveBeenCalledWith("demo", "ver");
        expect(m.query).toHaveBeenCalledTimes(5);
        const vehiculos = m.query.mock.calls.find(([sql]) => sql.includes("FROM flota_vehiculos"))!;
        expect(vehiculos[1]).toEqual([7, 7, 7]); // propia + predicado de acceso (propio o compartido); todos derivados de la empresa del guard
        expect(vehiculos[0]).toContain("empresa_id");
        for (const [sql, params] of m.query.mock.calls) { expect(sql).toMatch(/^SELECT/); expect(params.every((p: number) => p === 7)).toBe(true); }
        expect(r.headers.get("cache-control")).toBe("private, no-store");
    });
    it.each([401, 403, 404])("sin acceso (%s) no devuelve unidades ni consulta catálogos", async status => {
        m.guard.mockResolvedValue({ error: new Response(null, { status }) });
        expect((await GET(new Request("https://novalvion.com/api/catalogos"), { params: Promise.resolve({ slug: "otra" }) })).status).toBe(status);
        expect(m.query).not.toHaveBeenCalled();
    });
});

it("catálogo CB2 incluye identidades independientes sin aprobar consumos ni mezclar empleados", async () => {
  m.habilitados.mockReturnValue(true);
  const pilotos = [{ id: 11, nombre: "Luis Escobar", referencia: "lab-19955-p" }];
  const unidades = [{ id: 21, placa: "M-060KHK", tipo: "MOTOCICLETA", descripcion: "Ficticia", referencia: "lab-19955-u" }];
  m.externos.mockResolvedValue({ pilotos, unidades, asociaciones: [] });
  const r = await GET(new Request("https://example.test/catalogos?empresaId=99"), { params: Promise.resolve({ slug: "demo" }) });
  const data = await r.json();
  expect(m.externos).toHaveBeenCalledWith(7);
  expect(data.pilotosExternos).toEqual(pilotos); expect(data.unidadesExternas).toEqual(unidades);
  expect(data.vehiculos).toEqual([{ id: -21, placa: "M-060KHK", descripcion: "Tercerizado #21 · Ficticia", tipo_unidad: "MOTOCICLETA" }]);
  expect(data.empleados).toEqual([]); expect(data.terceros).toEqual([]);
});
