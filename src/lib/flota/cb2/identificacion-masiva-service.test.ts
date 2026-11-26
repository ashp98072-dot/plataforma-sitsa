import { beforeEach, describe, expect, it, vi } from "vitest";
import { registrarAuditoriaTx } from "@/lib/auditoria";

const db = vi.hoisted(() => ({ filas: [] as Record<string, unknown>[], registro: new Map<string, string>(), fallar: 0 }));
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(async (sql: string, args: number[]) => sql.includes("FROM empleados") ? [{ id: args[1], nombre: "Jayme Calderón" }] : db.filas.filter(f => f.empresa_id === args[0] && Number(f.id) > args[1] && (args.length < 3 || f.id === args[2])).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, 1000)) }));
vi.mock("@/lib/db-plazo", () => ({ conPlazo: async (_pool: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn(), ErrorPlazoOperacion: class extends Error {} }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn(async () => {}) }));
vi.mock("./pilotos-reportados", () => ({ esquemaPilotosReportados: vi.fn(async () => false) }));
vi.mock("./asignaciones", () => ({ validarEmpleadoCorreccion: vi.fn(async (_c, empresa, empleado) => { if (empresa !== 1 || empleado !== 8) throw new Error("Empleado ajeno"); }) }));
vi.mock("./repository", () => ({
  rows: vi.fn(async (_c, sql: string, args: (string | number)[]) => {
    if (sql.includes("flota_cb2_asignaciones")) { const digest = db.registro.get(String(args[2])); return digest ? [{ digest }] : []; }
    return db.filas.filter(f => f.empresa_id === args[0] && f.proveedor_id === args[1] && f.id === args[2]);
  }),
  insert: vi.fn(async (_c, _table, data) => { db.registro.set(String(data.clave), String(data.digest)); }),
  tx: vi.fn(async (_ctx, fn) => {
    const copia = structuredClone(db.filas), registro = new Map(db.registro);
    try {
      return await fn({ execute: async (_sql: string, args: number[]) => {
        if (args[3] === db.fallar) throw new Error("fallo simulado");
        const fila = db.filas.find(f => f.empresa_id === args[1] && f.proveedor_id === args[2] && f.id === args[3] && f.empleado_id === null && f.revision_asignacion === args[4]);
        if (!fila) return [{ affectedRows: 0 }];
        fila.empleado_id = args[0]; fila.revision_asignacion = Number(fila.revision_asignacion) + 1;
        return [{ affectedRows: 1 }];
      } });
    } catch (e) { db.filas = copia; db.registro = registro; throw e; }
  }),
}));
const { vistaIdentificacion, confirmarIdentificacion } = await import("./identificacion-masiva-service");
const ctx = { empresaId: 1, proveedorId: 3, actor: { id: 4, username: "test" }, autorizar: async () => {} };
const op = { proveedorId: 3, nombre: "Jaime Calderon", empleadoId: 8, motivo: "Identificación confirmada", clave: "1234567890123456", items: [{ id: 1, revision: 0 }, { id: 2, revision: 0 }] };
beforeEach(() => {
  vi.clearAllMocks();
  db.filas = [1, 2, 3, 4, 5].map(id => ({ id, empresa_id: id === 5 ? 2 : 1, proveedor_id: id === 4 ? 4 : 3, piloto_informado: "JAIME CALDERON", empleado_id: id === 3 ? 9 : null, revision_asignacion: 0 }));
  db.registro = new Map(); db.fallar = 0;
});
describe("identificación por proveedor", () => {
  it("agrupa pendientes y conflictos sin incluir otra empresa", async () => {
    const r = await vistaIdentificacion(1, { nombre: "Jaime Calderon", empleadoId: 8 });
    expect(r.proveedores).toEqual([{ proveedorId: 3, pendientes: op.items, identificados: 0, conflictos: 1, conflictoIds: [3] }, { proveedorId: 4, pendientes: [{ id: 4, revision: 0 }], identificados: 0, conflictos: 0, conflictoIds: [] }]);
  });
  it("recorre más de diez mil consumos sin truncar coincidencias", async () => {
    db.filas = Array.from({ length: 12010 }, (_, i) => ({ id: i + 1, empresa_id: 1, proveedor_id: 3, piloto_informado: i === 12009 ? "Jaime Calderon" : "Persona distinta", empleado_id: null, revision_asignacion: 0 }));
    const r = await vistaIdentificacion(1, { nombre: "Jaime Calderon", empleadoId: 8 });
    expect(r.proveedores[0].pendientes).toEqual([{ id: 12010, revision: 0 }]);
    db.filas.forEach(f => { f.piloto_informado = "Jaime Calderon"; });
    expect((await vistaIdentificacion(1, { nombre: "Jaime Calderon", empleadoId: 8 })).proveedores[0].pendientes).toHaveLength(12010);
  });
  it("detiene la vista sin devolver resultados parciales al alcanzar el límite", async () => {
    db.filas = Array.from({ length: 25000 }, (_, i) => ({ id: i + 1, empresa_id: 1, proveedor_id: 3, piloto_informado: "Persona distinta", empleado_id: null, revision_asignacion: 0 }));
    await expect(vistaIdentificacion(1, { nombre: "Jaime Calderon", empleadoId: 8 })).rejects.toMatchObject({ status: 413 });
  });
  it("corrige varios y un reintento devuelve el resultado sin repetir escrituras", async () => {
    expect(await confirmarIdentificacion(ctx, op)).toMatchObject({ actualizados: 2, repetidos: 0 });
    expect(await confirmarIdentificacion(ctx, op)).toMatchObject({ actualizados: 0, repetidos: 2 });
    expect(db.filas.map(f => f.empleado_id)).toEqual([8, 8, 9, null, null]);
  });
  it("más de 5000 coincidencias se procesan en lotes idempotentes y auditables", async () => {
    db.filas = Array.from({ length: 5001 }, (_, i) => ({ id: i + 1, empresa_id: 1, proveedor_id: 3, piloto_informado: "Jaime Calderon", empleado_id: null, revision_asignacion: 0 }));
    const vista = await vistaIdentificacion(1, { nombre: op.nombre, empleadoId: 8 });
    const items = vista.proveedores[0].pendientes;
    for (let i = 0; i < items.length; i += 250) {
      const lote = { ...op, clave: `clave-de-lote-${String(i).padStart(5, "0")}`, items: items.slice(i, i + 250) };
      expect((await confirmarIdentificacion(ctx, lote)).actualizados).toBe(lote.items.length);
      expect((await confirmarIdentificacion(ctx, lote)).repetidos).toBe(lote.items.length);
    }
    expect(db.registro.size).toBe(5001);
    expect(registrarAuditoriaTx).toHaveBeenCalledTimes(5001);
    expect(db.filas.every(f => f.empleado_id === 8)).toBe(true);
  });
  it("revierte el primer cambio si falla el segundo", async () => {
    db.fallar = 2;
    await expect(confirmarIdentificacion(ctx, op)).rejects.toThrow("fallo simulado");
    expect(db.filas.map(f => f.empleado_id)).toEqual([null, null, 9, null, null]);
    expect(db.registro.size).toBe(0);
  });
  it("rechaza una revisión concurrente o una identidad conflictiva", async () => {
    db.filas[1].empleado_id = 10;
    await expect(confirmarIdentificacion(ctx, op)).rejects.toThrow("ya no es elegible");
    expect(db.filas[0].empleado_id).toBeNull();
  });
});
