import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db",()=>({query:vi.fn()}));
import { query } from "@/lib/db";
import { obtenerResumenGerencial } from "./dashboard";
type Fixture={empresa:number;fecha:string;estado?:string;neto?:number;tipo?:string;costo?:number};
let altas:Fixture[], bajas:Fixture[], nomina:Fixture[], bitacora:Fixture[];
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date("2026-01-14T12:00:00Z"));
  altas=[{empresa:7,fecha:"2025-12-31"},{empresa:7,fecha:"2026-01-31"},{empresa:8,fecha:"2026-01-10"}];
  bajas=[{empresa:7,fecha:"2026-01-01",estado:"Baja"},{empresa:7,fecha:"2026-01-02",estado:"Activo"}];
  nomina=[{empresa:7,fecha:"2025-12-01",estado:"Cerrada",neto:100,costo:150},
    {empresa:7,fecha:"2026-01-31",estado:"Pagada",neto:50,costo:65},
    {empresa:7,fecha:"2026-01-10",estado:"Generada",neto:999,costo:999},
    {empresa:8,fecha:"2026-01-01",estado:"Pagada",neto:999,costo:999}];
  bitacora=[{empresa:7,fecha:"2025-12-31",tipo:"Suspension"},{empresa:7,fecha:"2026-01-01",tipo:"Despido"},
    {empresa:7,fecha:"2026-01-01",tipo:"Amonestacion"},{empresa:7,fecha:"2026-01-02",tipo:"Otro"}];
  vi.mocked(query).mockImplementation(async(sql,p=[])=>{
    const dataset=sql.includes("rrhh_planilla_lineas")?nomina:sql.includes("rrhh_bitacora_legal")?bitacora:sql.includes("fecha_egreso")?bajas:altas;
    const desde=String(p[p.length-2]),hasta=String(p[p.length-1]);
    const seleccion=dataset.filter(r=>r.empresa===p[0]&&r.fecha>=desde&&r.fecha<=hasta
      &&(dataset!==nomina||["Cerrada","Pagada"].includes(r.estado!))
      &&(dataset!==bajas||r.estado==="Baja")
      &&(dataset!==bitacora||["Amonestacion","Suspension","Despido"].includes(r.tipo!)));
    const grouped=new Map<string,{mes:string;tipo?:string;total:number;costo_registrado:number}>();
    for(const r of seleccion){
      const mes=r.fecha.slice(0,7),key=mes+(dataset===bitacora?r.tipo:"");
      const group=grouped.get(key)??{mes,tipo:r.tipo,total:0,costo_registrado:0};
      group.total+=dataset===nomina?r.neto??0:1;group.costo_registrado+=r.costo??0;grouped.set(key,group);
    }
    return [...grouped.values()] as RowDataPacket[];
  });
});
afterEach(()=>vi.useRealTimers());
// Referencia por mes: mismo rango y reglas del algoritmo anterior, sin agrupar seis meses.
function anterior(meses:string[]){return meses.map(mes=>{
  const registros=(xs:Fixture[])=>xs.filter(r=>r.empresa===7&&r.fecha.slice(0,7)===mes);
  const lineas=registros(nomina).filter(r=>["Cerrada","Pagada"].includes(r.estado!));
  const neto=lineas.reduce((s,r)=>s+(r.neto??0),0);
  const count=(tipo:string)=>registros(bitacora).filter(r=>r.tipo===tipo).length;
  return {mes,altas:registros(altas).length,bajas:registros(bajas).filter(r=>r.estado==="Baja").length,
    costoNomina:neto,netoNomina:neto,costoRegistrado:lineas.reduce((s,r)=>s+(r.costo??0),0),
    amonestaciones:count("Amonestacion"),suspensiones:count("Suspension"),despidos:count("Despido")};
});}
it("seis meses cruzando año, meses vacios y con datos: mismo DTO y cuatro SELECT",async()=>{
  const meses=["2025-08","2025-09","2025-10","2025-11","2025-12","2026-01"];
  expect(await obtenerResumenGerencial(7)).toEqual(anterior(meses));expect(query).toHaveBeenCalledTimes(4);
  for(const [sql,p] of vi.mocked(query).mock.calls){expect(sql).toContain("GROUP BY DATE_FORMAT");expect(p?.slice(-2)).toEqual(["2025-08-01","2026-01-31"]);}
});
it("conserva mes actual completo de main incluso estando a mitad de mes",async()=>{
  expect(await obtenerResumenGerencial(7,1)).toEqual(anterior(["2026-01"]));
  expect((await obtenerResumenGerencial(7,1))[0]).toMatchObject({altas:1,netoNomina:50});
});
it("mes sin datos rellena ceros, fallo de consulta conserva null",async()=>{
  altas=[];bajas=[];nomina=[];bitacora=[];
  expect(await obtenerResumenGerencial(7,1)).toEqual(anterior(["2026-01"]));
  vi.spyOn(console,"error").mockImplementation(()=>{});
  vi.mocked(query).mockRejectedValue(new Error("BD"));
  expect((await obtenerResumenGerencial(7,1))[0]).toEqual({mes:"2026-01",altas:null,bajas:null,
    costoNomina:0,netoNomina:null,costoRegistrado:null,amonestaciones:null,suspensiones:null,despidos:null});
});
