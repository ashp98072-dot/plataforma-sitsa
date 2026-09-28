import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  requireTenantRrhh: vi.fn(), listarVacaciones: vi.fn(), calcularSaldoTotalDisponible: vi.fn(), obtenerPeriodosDisponibles: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones", () => ({
  listarVacaciones: m.listarVacaciones, calcularSaldoTotalDisponible: m.calcularSaldoTotalDisponible, obtenerPeriodosDisponibles: m.obtenerPeriodosDisponibles,
  contarDiasHabiles: vi.fn(), registrarIncidenciaSinSaldo: vi.fn(), registrarVacacionesFifo: vi.fn(),
}));
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "sitsa" }) };
const req = (qs = "") => new Request(`http://x/api${qs}`);

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 1 } });
  m.listarVacaciones.mockResolvedValue([{ id: 1 }]);
  m.calcularSaldoTotalDisponible.mockResolvedValue(10);
  m.obtenerPeriodosDisponibles.mockResolvedValue([]);
});

describe("GET vacaciones — filtros del historial, independientes de saldo/periodos", () => {
  it("1) sin filtros -> pasa {} (todos)", async () => {
    await GET(req(), ctx);
    expect(m.listarVacaciones).toHaveBeenCalledWith(1, {});
  });
  it("2) filtro empleado -> se pasa al modelo y activa saldo/periodos", async () => {
    const res = await GET(req("?empleadoId=55"), ctx);
    expect(m.listarVacaciones).toHaveBeenCalledWith(1, { empleadoId: 55 });
    expect(m.calcularSaldoTotalDisponible).toHaveBeenCalledWith(1, 55);
    const data = await res.json();
    expect(data.saldo).toBe(10);
  });
  it("3) filtro tipo", async () => {
    await GET(req("?tipo=Vacaciones"), ctx);
    expect(m.listarVacaciones).toHaveBeenCalledWith(1, { tipo: "Vacaciones" });
  });
  it("4-6) filtro desde/hasta/rango", async () => {
    await GET(req("?desde=2026-01-01&hasta=2026-06-30"), ctx);
    expect(m.listarVacaciones).toHaveBeenCalledWith(1, { desde: "2026-01-01", hasta: "2026-06-30" });
  });
  it("7-8) combinación empleado+tipo(+fechas)", async () => {
    await GET(req("?empleadoId=55&tipo=IGSS&desde=2026-01-01&hasta=2026-06-30"), ctx);
    expect(m.listarVacaciones).toHaveBeenCalledWith(1, { empleadoId: 55, tipo: "IGSS", desde: "2026-01-01", hasta: "2026-06-30" });
  });
  it("9) empresa/tenant: empresa_id sale del guard, nunca del query", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 9 } });
    await GET(req("?empleadoId=55"), ctx);
    expect(m.listarVacaciones).toHaveBeenCalledWith(9, { empleadoId: 55 });
  });
  it("10) empleadoId inválido -> 400", async () => {
    for (const v of ["0", "-1", "abc", "1.5"]) {
      const res = await GET(req(`?empleadoId=${v}`), ctx);
      expect(res.status).toBe(400);
    }
    expect(m.listarVacaciones).not.toHaveBeenCalled();
  });
  it("11) tipo inválido -> 400", async () => {
    const res = await GET(req("?tipo=Inventado"), ctx);
    expect(res.status).toBe(400);
    expect(m.listarVacaciones).not.toHaveBeenCalled();
  });
  it("12) desde > hasta -> 400", async () => {
    const res = await GET(req("?desde=2026-06-30&hasta=2026-01-01"), ctx);
    expect(res.status).toBe(400);
    expect(m.listarVacaciones).not.toHaveBeenCalled();
  });
  it("saldo/periodos NUNCA se calculan cuando el filtro no incluye empleadoId (Todos)", async () => {
    await GET(req("?tipo=Vacaciones"), ctx);
    expect(m.calcularSaldoTotalDisponible).not.toHaveBeenCalled();
  });
  it("sin permiso/tenant: se bloquea antes de tocar el modelo", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: new Response(JSON.stringify({ error: "Sin permiso" }), { status: 403 }) });
    const res = await GET(req(), ctx);
    expect(res.status).toBe(403);
    expect(m.listarVacaciones).not.toHaveBeenCalled();
  });
});

describe("UI (13-17): filtros del historial en la página", () => {
  const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const page = leer("src/app/e/[slug]/rrhh/vacaciones/page.tsx");

  it("13) 'Todos los colaboradores' presente en el filtro (EmpleadoPicker con emptyLabel)", () => {
    expect(page).toContain('emptyLabel="Todos los colaboradores"');
    expect(page).toContain("value={filtroEmpleadoId}");
  });
  it("14) Limpiar filtros no altera empleadoId/tipo/fechaInicio/fechaFin/dias del formulario", () => {
    const inicio = page.indexOf("function limpiarFiltrosHistorial()");
    const fin = page.indexOf("\n  }", inicio);
    const bloque = page.slice(inicio, fin);
    expect(bloque).toContain("setFiltroEmpleadoId(0)");
    expect(bloque).toContain("setFiltroTipo(\"\")");
    expect(bloque).toContain("setFiltroDesde(\"\")");
    expect(bloque).toContain("setFiltroHasta(\"\")");
    expect(bloque).not.toMatch(/setEmpleadoId|setTipo\(|setFechaInicio|setFechaFin|setDias/);
  });
  it("15) historial y saldo usan estados/funciones separados", () => {
    expect(page).toContain("cargarFormularioEmpleado");
    expect(page).toContain("cargarHistorial");
    expect(page).toContain("filtroEmpleadoId");
    expect(page).not.toContain("const qs = id ? `?empleadoId=${id}` : \"\";"); // acoplamiento viejo, eliminado
  });
  it("16) mensaje sin resultados", () => {
    expect(page).toContain("No hay registros que coincidan con los filtros.");
  });
  it("17) contador de registros", () => {
    expect(page).toContain("Mostrando {rows.length} registro(s)");
  });
  it("responsive: 1 columna en móvil, hasta 4 en desktop", () => {
    expect(page).toContain("grid gap-3 sm:grid-cols-2 lg:grid-cols-4");
  });
  it("frontend valida desde > hasta antes de hacer fetch", () => {
    expect(page).toContain("filtroDesde > filtroHasta");
  });
  it("no altera cálculo FIFO/saldo/periodos/creación/eliminación (no se tocaron esas funciones)", () => {
    const modelo = leer("src/lib/rrhh/vacaciones.ts");
    expect(modelo).toContain("registrarVacacionesFifo");
    expect(modelo).toContain("calcularSaldoTotalDisponible");
    expect(modelo).toContain("obtenerPeriodosDisponibles");
  });
});
