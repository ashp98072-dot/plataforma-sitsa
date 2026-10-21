import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(async () => ({ affectedRows: 0 })), getPool: vi.fn() }));
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
import { query } from "@/lib/db";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { listarPeriodos, listarLineas, listarLineasEmpleadoPorPeriodos } from "@/lib/rrhh/planillas";
import { GET } from "./route";
import { GET as DETALLE } from "./[id]/route";
let periodos: Record<string, unknown>[];
let lineas: Record<string, unknown>[];
function seed(n: number) {
  periodos = Array.from({ length: n }, (_, i) => ({ id: i+1, empresa_id: 7, codigo: `P${i+1}`,
    fecha_inicio: "2026-09-01", fecha_fin: "2026-09-15", estado: i % 3 === 0 ? "Generada" : i % 3 === 1 ? "Cerrada" : "Pagada" }));
  lineas = periodos.flatMap(p => [10,20].map(emp => ({ id: Number(p.id)*100+emp, empresa_id: 7,
    periodo_id: p.id, id_empleado: emp, nombre_empleado: `E${emp}`, sueldo_base: 100,
    sueldo_mensual: 150, neto: Number(p.id)*10, estado_pago: "Pendiente" })));
  periodos.push({ id: 9999, empresa_id: 8, codigo: "AJENO", fecha_inicio: "2026-10-01", estado: "Cerrada" });
  lineas.push({ id: 9999, empresa_id: 8, periodo_id: 9999, id_empleado: 10, neto: 999 });
}
beforeEach(() => {
  vi.clearAllMocks(); seed(0);
  vi.mocked(getColaboradorSession).mockResolvedValue({ empresaId: 7, empleadoId: 10 } as never);
  vi.mocked(query).mockImplementation(async (sql, p = []) => {
    if (sql.includes("FROM rrhh_planilla_periodos")) {
      const own = periodos.filter(r => r.empresa_id === p[sql.includes("WHERE id = ?") ? 1 : 0]);
      const result = sql.includes("WHERE id = ?") ? own.filter(r => r.id === p[0]) : own.sort((a,b) => Number(b.id)-Number(a.id)).slice(0,100);
      return result as RowDataPacket[];
    }
    if (sql.includes("FROM rrhh_planilla_lineas")) {
      expect(sql).toContain("e.empresa_id = l.empresa_id");
      expect(sql).toContain("COALESCE(e.sueldo_base, l.sueldo_base)");
      const own = lineas.filter(r => r.empresa_id === p[0]);
      const result = sql.includes("l.id_empleado = ?") ? own.filter(r => r.id_empleado === p[1] && p.slice(2).includes(Number(r.periodo_id))) : own.filter(r => r.periodo_id === p[1]);
      return result.sort((a,b) => String(a.nombre_empleado).localeCompare(String(b.nombre_empleado))) as RowDataPacket[];
    }
    throw new Error(sql);
  });
});
async function respuestaAnterior() {
  const bolet = [];
  for (const p of (await listarPeriodos(7)).filter(p => ["Cerrada","Pagada"].includes(p.estado))) {
    const propia = (await listarLineas(7,p.id)).find(l => l.empleadoId === 10);
    if (propia) bolet.push({ periodoId: p.id, codigo: p.codigo, fechaInicio: p.fechaInicio,
      fechaFin: p.fechaFin, estado: p.estado, estadoPago: propia.estadoPago, neto: propia.neto });
  }
  bolet.sort((a,b) => a.fechaInicio < b.fechaInicio ? 1 : -1);
  return { boletas: bolet };
}
describe("boletas portal batch", () => {
  it.each([0,1,7,100,110])("mismo DTO y maximo dos SELECT con %i periodos y estados mezclados", async n => {
    seed(n);
    if (n===1) periodos[0].estado="Cerrada";
    const esperado = await respuestaAnterior();
    vi.mocked(query).mockClear();
    expect(await (await GET()).json()).toEqual(esperado);
    expect(query).toHaveBeenCalledTimes(esperado.boletas.length ? 2 : 1);
    const batch=vi.mocked(query).mock.calls.find(([sql])=>sql.includes("rrhh_planilla_lineas"));
    if (batch) {
      expect(batch[0]).toContain("l.empresa_id = ? AND l.id_empleado = ?");
      expect(batch[1]?.slice(0,2)).toEqual([7,10]);
      expect(batch[1]).not.toContain(9999);
      if (n===110) expect(batch[1]!.slice(2).every(id => Number(id)>=11)).toBe(true);
    }
  });
  it("P=0 no emite IN vacio ni consulta lineas", async () => {
    seed(1);
    expect(await listarLineasEmpleadoPorPeriodos(7,10,[])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    expect(await (await GET()).json()).toEqual({ boletas: [] });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("detalle consulta solo empleado autenticado; mismo DTO del mapper", async () => {
    seed(2);
    const p=(await listarPeriodos(7)).find(p=>p.id===2)!;
    const propia=(await listarLineas(7,2)).find(l=>l.empleadoId===10)!;
    vi.mocked(query).mockClear();
    const res=await DETALLE(new Request("http://x"),{params:Promise.resolve({id:"2"})});
    expect(await res.json()).toEqual({periodo:{codigo:p.codigo,fechaInicio:p.fechaInicio,fechaFin:p.fechaFin,estado:p.estado},linea:propia});
    expect(query).toHaveBeenCalledTimes(2);
    expect(vi.mocked(query).mock.calls[1][1]).toEqual([7,10,2]);
  });
  it("sin sesion no consulta; periodo ajeno devuelve 404", async () => {
    seed(3); vi.mocked(getColaboradorSession).mockResolvedValue(null);
    expect((await GET()).status).toBe(401); expect(query).not.toHaveBeenCalled();
    vi.mocked(getColaboradorSession).mockResolvedValue({empresaId:7,empleadoId:10} as never);
    expect((await DETALLE(new Request("http://x"),{params:Promise.resolve({id:"9999"})})).status).toBe(404);
  });
  it("otro empleado y otra empresa usan exclusivamente los valores de su sesion", async () => {
    seed(3);
    vi.mocked(getColaboradorSession).mockResolvedValue({empresaId:7,empleadoId:20} as never);
    const propias=await listarLineasEmpleadoPorPeriodos(7,20,[2,3]);
    expect(propias.every(l=>l.empleadoId===20)).toBe(true);
    vi.mocked(getColaboradorSession).mockResolvedValue({empresaId:8,empleadoId:10} as never);
    vi.mocked(query).mockClear();
    expect((await (await GET()).json()).boletas.map((b:{periodoId:number})=>b.periodoId)).toEqual([9999]);
    expect(vi.mocked(query).mock.calls[1][1]).toEqual([8,10,9999]);
  });
  it("esquema legado duplicado conserva primera linea del orden devuelto, igual que find", async () => {
    seed(2);
    lineas.push({...lineas.find(l=>l.periodo_id===2 && l.id_empleado===10)!,id:543,neto:999});
    expect(await (await GET()).json()).toEqual(await respuestaAnterior());
  });
});
