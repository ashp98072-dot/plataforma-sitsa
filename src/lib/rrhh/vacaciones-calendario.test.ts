import { describe,it,expect,vi,afterEach } from "vitest";
import { readFileSync } from "fs";
import { contarDiasVacacionesCalendario as contar,diasCalendarioInclusivos,validarDiasCalculados,diasPreviewActual,puedeRegistrarRango } from "./vacaciones-calendario";
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe("vacaciones DATE seguro",()=>{
  it.each([
    ["2026-06-01","2026-06-01",1],["2026-06-01","2026-06-02",2],
    ["2026-06-06","2026-06-08",2],["2026-06-07","2026-06-07",0],
    ["2024-02-28","2024-03-01",3],["2026-01-31","2026-02-02",2],
    ["2026-12-31","2027-01-01",2],
  ])("%s a %s = %s",(a,b,n)=>expect(contar(a,b)).toBe(n));
  it.each(["01/06/2026","","2026-02-30","2026-13-01","2026-06-01T00:00:00Z","2026-6-1","0000-01-01"])("rechaza fecha %s",s=>expect(()=>contar(s,s)).toThrow());
  it("rango invertido rechaza",()=>expect(()=>contar("2026-06-02","2026-06-01")).toThrow());
  it("conserva feriados configurados y no duplica domingo",()=>expect(contar("2026-06-06","2026-06-08",new Set(["2026-06-07","2026-06-08"]))).toBe(1));
  it.each([NaN,Infinity,-1,0.5,571148])("defensa matemática rechaza %s",n=>expect(()=>validarDiasCalculados("2026-06-01","2026-06-01",n)).toThrow());
  it("invariante en varios años y meses, sin máximo arbitrario",()=>{
    for(let y=2024;y<2028;y++)for(let m=1;m<=12;m++){
      const a=`${y}-${String(m).padStart(2,"0")}-01`, b=`${y}-${String(m).padStart(2,"0")}-28`;
      const n=contar(a,b);expect(n).toBeLessThanOrEqual(diasCalendarioInclusivos(a,b));expect(Number.isSafeInteger(n)).toBe(true);
    }
  });
  it("reproduce número observado con rango antiguo, no con el mismo lunes",()=>{
    expect(contar("0202-01-16","2026-06-01")).toBe(571148);
    expect(contar("2026-06-01","2026-06-01")).toBe(1);
  });
  it("respuesta vieja no es utilizable al cambiar fechas; inválida tampoco",()=>{
    const a={clave:"antigua",dias:571148};
    expect(diasPreviewActual(a,"actual","2026-06-01","2026-06-01")).toBeNull();
    expect(diasPreviewActual({...a,clave:"actual"},"actual","2026-06-01","2026-06-01")).toBeNull();
    expect(diasPreviewActual({clave:"actual",dias:1},"actual","2026-06-01","2026-06-01")).toBe(1);
  });
  it("saldo 21.62 permite 1; bloquea 22, cero, pendiente y NaN",()=>{
    expect(puedeRegistrarRango(1,21.62,true)).toBe(true);
    for(const n of [22,0,null,NaN])expect(puedeRegistrarRango(n,21.62,true)).toBe(false);
  });
  it.each(["UTC","America/Guatemala","America/New_York","Asia/Tokyo"])("zona %s y medianoche no alteran DATE",tz=>{
    vi.stubEnv("TZ",tz);vi.useFakeTimers();
    for(const now of ["2026-06-01T00:00:01Z","2026-06-01T23:59:59Z"]) {vi.setSystemTime(new Date(now));expect(contar("2026-06-01","2026-06-02")).toBe(2);}
  });
  it("UI readonly, aborta y verifica pertenencia; registro no envía días",()=>{
    const s=readFileSync("src/app/e/[slug]/rrhh/vacaciones/page.tsx","utf8");
    expect(s).toContain("controller.abort()");expect(s).toContain("diasPreviewActual");expect(s).toContain("setCalculo(null);setPrevia(null);setFechaInicio");
    expect(s).not.toContain("diasHabiles: diasNum,");expect(s).toContain("readOnly");
  });
});
