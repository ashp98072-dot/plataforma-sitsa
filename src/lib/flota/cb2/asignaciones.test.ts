import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({rows:vi.fn(),execute:vi.fn(),insert:vi.fn(),vehiculos:vi.fn(),audit:vi.fn(),autorizar:vi.fn(),consumo:{id:10,vehiculo_id:1,empleado_id:null,producto_clasificado:null,revision_asignacion:0},empleado:true,previo:null as null|{digest:string;nuevo:string}}));
vi.mock("./repository",()=>({rows:m.rows,insert:m.insert,vehiculos:m.vehiculos,tx:async(ctx:{autorizar:()=>Promise<void>},fn:(c:unknown)=>unknown)=>{await ctx.autorizar();return fn({execute:m.execute});}}));
vi.mock("@/lib/auditoria",()=>({registrarAuditoriaTx:m.audit}));
import { corregirAsignacion, corregirSchema } from "./asignaciones";
const ctx={empresaId:7,proveedorId:3,actor:{id:9,username:"demo"},autorizar:m.autorizar};
const op={proveedorId:3,consumoId:10,revision:0,vehiculoId:2,empleadoId:77,productoClasificado:"DIESEL" as const,motivo:"Corregido contra evidencia revisada",clave:"clave-correccion-514"};
beforeEach(()=>{m.previo=null;m.empleado=true;m.consumo={id:10,vehiculo_id:1,empleado_id:null,producto_clasificado:null,revision_asignacion:0};m.vehiculos.mockResolvedValue(new Map([[2,"C-002ABC"]]));m.rows.mockImplementation(async(_c,sql)=>sql.includes("FROM flota_cb2_asignaciones")?(m.previo?[m.previo]:[]):sql.includes("FROM empleados")?(m.empleado?[{id:77}]:[]):[m.consumo]);});
describe("corrección explícita sin duplicar consumo ni tocar evidencia",()=>{
    it("actualiza la misma fila, aumenta revisión y audita anterior/nuevo/motivo/actor",async()=>{
        await corregirAsignacion(ctx,op);expect(m.autorizar).toHaveBeenCalled();expect(m.execute).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("revision_asignacion=revision_asignacion+1"),[2,77,"DIESEL",7,3,10]);
        expect(m.insert).toHaveBeenCalledTimes(1);expect(m.insert.mock.calls[0][1]).toBe("flota_cb2_asignaciones");expect(m.insert.mock.calls[0][2]).toMatchObject({empresa_id:7,proveedor_id:3,consumo_id:10,motivo:op.motivo,usuario_id:9});expect(m.audit).toHaveBeenCalledOnce();
        for(const [,sql,args]of m.rows.mock.calls){expect(sql).toContain("empresa_id=?");expect(args[0]).toBe(7);}
        expect(m.execute.mock.calls[0][0]).not.toMatch(/payload|placa_original|producto=|piloto_informado|datos_origen/);
    });
    it("reintento idéntico recupera; misma clave con otros datos se rechaza",async()=>{await corregirAsignacion(ctx,op);const guardado=m.insert.mock.calls[0][2];m.previo={digest:guardado.digest,nuevo:guardado.nuevo};m.execute.mockClear();m.insert.mockClear();expect((await corregirAsignacion(ctx,op)).repetida).toBe(true);expect(m.execute).not.toHaveBeenCalled();await expect(corregirAsignacion(ctx,{...op,vehiculoId:3})).rejects.toThrow("otra solicitud");expect(m.insert).not.toHaveBeenCalled();});
    it("revision obsoleta, empleado ajeno, vehículo sin acceso o permiso revocado impiden escribir",async()=>{
        m.consumo.revision_asignacion=1;await expect(corregirAsignacion(ctx,op)).rejects.toThrow("asignación cambió");m.consumo.revision_asignacion=0;m.empleado=false;await expect(corregirAsignacion(ctx,op)).rejects.toThrow("Empleado no autorizado");m.empleado=true;m.vehiculos.mockRejectedValueOnce(new Error("Sin acceso"));await expect(corregirAsignacion(ctx,op)).rejects.toThrow("Sin acceso");m.autorizar.mockRejectedValueOnce(new Error("Revocado"));await expect(corregirAsignacion(ctx,op)).rejects.toThrow("Revocado");expect(m.execute).not.toHaveBeenCalled();expect(m.insert).not.toHaveBeenCalled();
    });
    it("schema rechaza campos arbitrarios, IDs inválidos y motivos insuficientes",()=>{for(const cambio of [{empleadoId:0},{vehiculoId:0},{motivo:"ok"},{productoClasificado:"gasolina"},{empresaId:99}])expect(corregirSchema.safeParse({...op,...cambio}).success).toBe(false);});
});
