import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query }));
import { consolidarMes, resumenIntegrado, type OperacionResumen } from "./resumen-mensual";
const op: OperacionResumen = {id:1,origen:"HISTORICO",vehiculo_id:1,placa:"C-570BZT",proveedor_id:3,numero_vale:"001",fecha_consumo:"2026-10-01",creado_at:"2026-10-02",galones:"10.100",precio:"20",monto:"202",moneda:"GTQ",combustible:"DIESEL"};
const resumen = (ops:OperacionResumen[]) => consolidarMes(ops,"2026-10-01","2026-11-01");
beforeEach(()=>m.query.mockResolvedValue([]));
describe("resumen integrado sin alterar histórico",()=>{
    it("CB2 previo sin clasificación permanece NO DETERMINADO sin backfill ni divergencia con filtros",async()=>{m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{...op,producto:"Diesel",producto_clasificado:null}]);const r=await resumenIntegrado(7,"2026-10");expect(r.grupos[0].combustible).toBe("NO_DETERMINADO");});
    it("suma archivos grandes sin perder la precisión decimal admitida",()=>{const r=resumen(Array.from({length:10000},(_,i)=>({...op,id:i+1,numero_vale:String(i+1),origen:"CB2",monto:"999999999999.999999"})));expect(r.totalGTQ).toEqual({galones:"101000",monto:"9999999999999999.99"});});
    it("pareja exacta única se cuenta solo en histórico con evidencia verificable",()=>{const r=resumen([op,{...op,id:9,origen:"CB2",galones:"10.1",precio:"20.000",monto:"202.00"}]);expect(r.totalGTQ).toEqual({galones:"10.1",monto:"202"});expect(r.excluidas).toMatchObject([{consumoId:9,cargaId:1}]);expect(r.subtotales["CB2:GTQ"]).toBeUndefined();});
    it("no deduplica con diferencias ni claves incompletas",()=>{for(const cambio of [{proveedor_id:4},{vehiculo_id:2},{fecha_consumo:"2026-10-02"},{galones:"10.101"},{monto:"202.01"},{precio:null},{numero_vale:null},{proveedor_id:null}]){const r=resumen([op,{...op,...cambio,id:9,origen:"CB2"}]);expect(r.excluidas).toHaveLength(0);expect(r.grupos.reduce((a,g)=>a+g.operaciones,0)).toBe(2);}});
    it("ambigüedad conserva operaciones y etiqueta el total como provisional",()=>{const r=resumen([op,{...op,id:2},{...op,id:9,origen:"CB2"}]);expect(r.excluidas).toHaveLength(0);expect(r.ambiguas).toEqual([9]);expect(r.provisional).toBe(true);expect(r.totalGTQ.monto).toBe("606");});
    it("respeta registro histórico, consumo CB2 y separación monetaria/producto desconocido",()=>{const r=resumen([{...op,creado_at:"2026-09-30"},{...op,id:8,origen:"CB2"},{...op,id:9,origen:"CB2",numero_vale:"002",moneda:"USD",combustible:"NO_DETERMINADO"}]);expect(r.excluidas).toHaveLength(1);expect(r.totalGTQ.monto).toBe("0");expect(r.subtotales["CB2:USD"].monto).toBe("202");expect(r.grupos[0].combustible).toBe("NO_DETERMINADO");});
    it("consultas limitadas a empresa y aprobados, sin escrituras",async()=>{await resumenIntegrado(7,"2026-10");expect(m.query).toHaveBeenCalledTimes(2);for(const [sql,args]of m.query.mock.calls){expect(sql).toContain("c.empresa_id=?");expect(args[0]).toBe(7);expect(sql).toMatch(/^SELECT/);}expect(m.query.mock.calls[0][0]).toContain("c.estado='APROBADO'");});
    it("propaga fallo de CB2 sin presentar totales parciales como completos",async()=>{m.query.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("schema"));await expect(resumenIntegrado(7,"2026-10")).rejects.toThrow("schema");});
});
