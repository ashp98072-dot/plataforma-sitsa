import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { validarEmpleadosImportacion } from "./empleados-validacion";
import { seleccion, monedaOriginal, type Linea } from "./model";
const ctx={empresaId:7,proveedorId:3,actor:{id:9,username:"demo"},autorizar:async()=>{}};
let catalogo: {id:number;nombre:string;empresa:number;estado:string}[];
const query=vi.fn(),c={query} as unknown as PoolConnection;
const linea=(clave="a".repeat(64),piloto="Alvaro Pinto")=>({clave,fila:{textos:{piloto}}} as unknown as Linea);
const choice={candidato:"a".repeat(64),vehiculoId:1,empleadoId:77,metodoEmpleado:"TOKENS_COMPLETOS_UNICOS" as const};
beforeEach(()=>{
    catalogo=[{id:77,nombre:"Alvaro Antonio León Pinto",empresa:7,estado:"Activo"},{id:88,nombre:"Alvaro Manuel Pinto",empresa:99,estado:"Activo"},{id:89,nombre:"Alvaro René Pinto",empresa:7,estado:"Inactivo"}];
    query.mockImplementation(async(sql:string,args:number[])=>{
        expect(sql).toContain("WHERE empresa_id=? AND estado='Activo'");expect(sql).toContain("ORDER BY id FOR UPDATE");
        return [catalogo.filter(e=>e.empresa===args[0]&&e.estado==="Activo"),[]];
    });
});
describe("revalidación de empleados del Excel bajo transacción",()=>{
    it("solo el catálogo activo de la empresa del contexto determina unicidad",async()=>{
        const r=await validarEmpleadosImportacion(c,ctx,[choice],[linea()]);expect(r.get(choice.candidato)).toBe("TOKENS_COMPLETOS_UNICOS");expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("SELECT id,nombre FROM empleados"),[7]);
        await expect(validarEmpleadosImportacion(c,ctx,[{...choice,empleadoId:88}],[linea()])).rejects.toMatchObject({status:403});await expect(validarEmpleadosImportacion(c,ctx,[{...choice,empleadoId:89}],[linea()])).rejects.toMatchObject({status:403});
    });
    it("homónimo nuevo, cambio de nombre o baja tras preview invalidan la propuesta automática",async()=>{
        catalogo.push({id:90,nombre:"Alvaro Pinto",empresa:7,estado:"Activo"});await expect(validarEmpleadosImportacion(c,ctx,[choice],[linea()])).rejects.toThrow("ambigua");
        catalogo=catalogo.filter(p=>p.id!==90);catalogo[0].nombre="Alberto Pinto";await expect(validarEmpleadosImportacion(c,ctx,[choice],[linea()])).rejects.toThrow("coincidencia automática");
        catalogo[0].estado="Inactivo";await expect(validarEmpleadosImportacion(c,ctx,[choice],[linea()])).rejects.toMatchObject({status:403});
    });
    it("no acepta método exacto falso ni usa nombres enviados por el cliente",async()=>{
        await expect(validarEmpleadosImportacion(c,ctx,[{...choice,metodoEmpleado:"EXACTA_NORMALIZADA"}],[linea()])).rejects.toThrow("coincidencia automática");
        await expect(validarEmpleadosImportacion(c,ctx,[choice],[linea(undefined,"Otra Persona")])).rejects.toThrow("coincidencia automática");
        await expect(validarEmpleadosImportacion(c,ctx,[choice],[linea(),linea(undefined,"Alvaro Manual")])).rejects.toThrow("coincidencia automática");
    });
    it("una corrección manual válida es independiente de coincidencias; borrado no se repone",async()=>{
        const r=await validarEmpleadosImportacion(c,ctx,[{...choice,metodoEmpleado:"MANUAL"}],[linea(undefined,"Nombre distinto")]);expect(r.get(choice.candidato)).toBe("MANUAL");query.mockClear();
        const borrado=await validarEmpleadosImportacion(c,ctx,[{...choice,empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"}],[linea()]);expect(borrado.get(choice.candidato)).toBe("SIN_ASIGNACION");expect(query).not.toHaveBeenCalled();
    });
    it("10.000 consumos hacen una sola consulta de empleados",async()=>{
        const filas=Array.from({length:10000},(_,i)=>linea(i.toString(16).padStart(64,"0")));
        const choices=filas.map(l=>({...choice,candidato:l.clave!}));const r=await validarEmpleadosImportacion(c,ctx,choices,filas);expect(r.size).toBe(10000);expect(query).toHaveBeenCalledOnce();
    });
    it("conserva compatibilidad de decisiones antiguas sin inventar el método",async()=>{const {metodoEmpleado:_,...antigua}=choice;void _;const r=await validarEmpleadosImportacion(c,ctx,[antigua],[linea()]);expect(r.get(choice.candidato)).toBe("NO_DECLARADO");});
    it("schema impide marcadores desconocidos o contradictorios",()=>{for(const extra of [{metodoEmpleado:"SIMILITUD"},{empleadoId:null},{metodoEmpleado:"SIN_ASIGNACION"}])expect(seleccion.safeParse([{...choice,...extra}]).success).toBe(false);expect(seleccion.safeParse([choice]).success).toBe(true);});
    it("el diario nuevo y el antiguo siguen siendo legibles para reanudar sin reescribir evidencia",()=>{
        const base={empresa_id:7,proveedor_id:3,importacion_id:5,tipo:"ORIGEN",revision:1,marca_origen:1,origen_fila_id:null,operacion_tipo:"CONFIRMAR",hoja_indice:1,hoja_nombre:"DEMO",fila_excel:2,datos_origen:JSON.stringify({hoja:"DEMO",fila:2})};
        const decision={version:1,moneda:"GTQ",candidato:choice.candidato,vehiculoId:1,errores:[]};
        for(const extra of [{},{asignacion:choice,metodoEmpleadoValidado:"TOKENS_COMPLETOS_UNICOS"},{asignacion:{candidato:choice.candidato,vehiculoId:1,empleadoId:77},metodoEmpleadoValidado:"NO_DECLARADO"}])expect(monedaOriginal([{...base,decision:JSON.stringify({...decision,...extra})}],7,3,5)).toBe("GTQ");
    });
});
