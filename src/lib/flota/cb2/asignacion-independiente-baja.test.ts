import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import type { CatalogosCB2, FilaCB2 } from "@/components/flota/cb2/client";

const m = vi.hoisted(() => ({ empleados: [] as { id: number; empresa: number; nombre: string; estado: string }[], consultas: [] as string[] }));
vi.mock("./terceros-directos", () => ({ tercerosDirectosHabilitados: () => true }));
vi.mock("./terceros", () => ({ catalogosTercerosTx: async () => ({ pilotos: [], unidades: [], asociaciones: [] }) }));
vi.mock("./repository", () => ({
  vehiculos: async () => new Map([[1, "C-001ABC"]]),
  rows: async (_c: unknown, sql: string, args: unknown[]) => {
    m.consultas.push(sql);
    if (sql.includes("FROM empresas")) return [{ id: 7, activa: 1 }];
    if (sql.includes("FROM usuarios")) return [{ id: 9, activo: 1 }];
    if (sql.includes("information_schema")) return [{ CONSTRAINT_NAME: "ck_cb2_piloto_unico" }];
    if (sql.includes("FROM empleados")) {
      const base = m.empleados.filter(e => e.empresa === args[0] && ["Activo", "Baja"].includes(e.estado) && sql.includes("IN ('Activo','Baja')"));
      return sql.includes("AND id=?") ? base.filter(e => e.id === args[1]) : base;
    }
    return [];
  },
}));
const { validarAsignacionIndependiente } = await import("./asignacion-independiente");
const { pilotoIndependiente, seleccionPilotoIndependiente } = await import("@/components/flota/cb2/piloto-independiente");

const ctx = { empresaId: 7, proveedorId: 3, actor: { id: 9, username: "demo" }, autorizar: async () => {} };
const c = {} as PoolConnection;
const base = { vehiculoId: 1, pilotoTipo: "INTERNO" as const };
beforeEach(() => {
  m.consultas = [];
  m.empleados = [
    { id: 33, empresa: 7, nombre: "Edgar Palala", estado: "Activo" },
    { id: 50, empresa: 7, nombre: "Andres Norberto Taracena Mayen", estado: "Baja" },
    { id: 51, empresa: 99, nombre: "Otra Empresa Baja", estado: "Baja" },
    { id: 52, empresa: 7, nombre: "Persona Inactiva", estado: "Inactivo" },
  ];
});

describe("asignación independiente (HALEL/terceros directos) y empleados de baja — servidor", () => {
  it("baja de la empresa: aceptada solo con selección MANUAL; deja estadoEmpleado en la identidad guardada", async () => {
    const r = await validarAsignacionIndependiente(c, ctx, { ...base, empleadoId: 50, metodoPiloto: "MANUAL" }, "Andres Taracena", "C-001ABC");
    expect(r.piloto).toEqual({ tipo: "INTERNO", id: 50, nombre: "Andres Norberto Taracena Mayen", estadoEmpleado: "Baja" });
  });
  it("baja con método automático (explícito o por omisión): rechazada", async () => {
    await expect(validarAsignacionIndependiente(c, ctx, { ...base, empleadoId: 50, metodoPiloto: "AUTOMATICA" }, "Andres Norberto Taracena Mayen", "C-001ABC")).rejects.toThrow("manual");
    await expect(validarAsignacionIndependiente(c, ctx, { ...base, empleadoId: 50 }, "Andres Norberto Taracena Mayen", "C-001ABC")).rejects.toThrow("manual");
  });
  it("baja de otra empresa o estado distinto de Activo/Baja: 403, aunque sea MANUAL", async () => {
    for (const id of [51, 52, 999]) await expect(validarAsignacionIndependiente(c, ctx, { ...base, empleadoId: id, metodoPiloto: "MANUAL" }, "x", "C-001ABC")).rejects.toMatchObject({ status: 403 });
    expect(m.consultas.filter(s => s.includes("FROM empleados")).every(s => s.includes("empresa_id=?"))).toBe(true);
  });
  it("un homónimo de baja vuelve ambigua la propuesta automática de un empleado activo", async () => {
    m.empleados.push({ id: 60, empresa: 7, nombre: "Edgar Palala", estado: "Baja" });
    await expect(validarAsignacionIndependiente(c, ctx, { ...base, empleadoId: 33, metodoPiloto: "AUTOMATICA" }, "Edgar Palala", "C-001ABC")).rejects.toThrow("ambigua");
    expect((await validarAsignacionIndependiente(c, ctx, { ...base, empleadoId: 33, metodoPiloto: "MANUAL" }, "Edgar Palala", "C-001ABC")).piloto).toEqual({ tipo: "INTERNO", id: 33, nombre: "Edgar Palala" });
  });
  it("empleado activo único: la propuesta automática sigue funcionando sin cambios (sin estadoEmpleado)", async () => {
    expect((await validarAsignacionIndependiente(c, ctx, { ...base, empleadoId: 33, metodoPiloto: "AUTOMATICA" }, "Edgar Palala", "C-001ABC")).piloto).toEqual({ tipo: "INTERNO", id: 33, nombre: "Edgar Palala" });
  });
});

describe("asignación independiente — cliente", () => {
  const cat = { tercerosDirectos: true, identidadesIndependientes: true, empleados: [{ id: 33, nombre: "Edgar Palala", estado: "Activo" }, { id: 50, nombre: "Andres Norberto Taracena Mayen", estado: "Baja", fechaBaja: "2026-06-30" }], pilotosExternos: [], vehiculos: [] } as unknown as CatalogosCB2;
  const fila = (piloto: string) => ({ origen: { piloto }, perfil: "HALEL" }) as unknown as FilaCB2;
  it("un empleado de baja nunca se propone solo; sí se puede elegir manualmente", () => {
    expect(pilotoIndependiente(fila("Andres Taracena"), cat)).toBeNull();
    expect(pilotoIndependiente(fila("Andres Norberto Taracena Mayen"), cat)).toBeNull();
    expect(pilotoIndependiente(fila("Edgar Palala"), cat)).toMatchObject({ tipo: "INTERNO", id: 33, manual: false });
    expect(seleccionPilotoIndependiente(fila("Andres Taracena"), cat, { pilotoTipo: "INTERNO", empleadoId: 50 }, 1)).toMatchObject({ pilotoTipo: "INTERNO", empleadoId: 50, metodoPiloto: "MANUAL", metodoEmpleado: "MANUAL" });
    expect(seleccionPilotoIndependiente(fila("Andres Taracena"), cat, {}, 1)).toMatchObject({ empleadoId: null, metodoEmpleado: "SIN_ASIGNACION" });   // sin elección explícita nunca queda ligado a la baja
  });
});
