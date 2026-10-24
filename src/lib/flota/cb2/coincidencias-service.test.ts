import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt, SignJWT } from "jose";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), insert: vi.fn(), diario: vi.fn(), guardar: vi.fn(), leer: vi.fn(), compensar: vi.fn(), release: vi.fn(), empresaVehiculo: 7 }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => ({ query: m.query, execute: m.execute, release: m.release }) }) }));
vi.mock("./repository", async original => ({ ...await original<typeof import("./repository")>(),
    tx: async (_ctx: unknown, fn: (c: unknown, p: unknown) => unknown) => fn({ query: m.query, execute: m.execute }, { nombre_comercial: "Proveedor sintético" }),
    insert: m.insert, diario: m.diario, anterior: async () => null,
}));
vi.mock("./storage", () => ({ guardar: m.guardar, leer: m.leer, compensar: m.compensar }));
import { preview, confirmarArchivo, reanudarArchivo } from "./service";
import { analizar } from "./model";
import { libro, row } from "./fixture";
import { getAuthSecretBytes } from "@/lib/auth-secret";
import type { Seleccion } from "./model";
const ctx = { empresaId: 7, proveedorId: 3, actor: { id: 9, username: "demo" }, autorizar: async () => {} };
beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "synthetic-only-no-real-db-service-511"); m.empresaVehiculo = 7;
    m.query.mockImplementation(async (sql: string) => [sql.includes("FROM compras_proveedores") ? [{ id: 3 }]
        : sql.includes("FROM flota_vehiculos") ? [{ id: 1, empresa_id: m.empresaVehiculo, placa: "C-001ABC", estado: "Activo", activo: 1 }] : [], []]);
    m.insert.mockResolvedValue(10); m.guardar.mockResolvedValue("solo-memoria"); m.compensar.mockResolvedValue(undefined);
    m.diario.mockImplementation(async (_c, _ctx, _tipo, _clave, _digest, eventos) => eventos);
});
afterEach(() => vi.unstubAllEnvs());
async function preparar(placa: string, repetido = false, extra: Partial<Seleccion[number]> = {}, producto = "DIESEL", piloto = "DEMO", perfil: "HALEL" | "SHELL" = "HALEL") {
    const r = row(); r[2] = placa;
    r[9] = producto;
    r[8] = piloto;
    const file = await libro(repetido ? [r, r] : [r]);
    const lineas = await analizar(file, perfil, "GTQ");
    const entrada = { perfil, moneda: "GTQ" as const, seleccion: [{ candidato: lineas[1].clave!, vehiculoId: 1, ...extra }] };
    return { file, entrada, recibo: await preview(ctx, file, entrada) };
}
describe("confirmación real del servicio con BD y almacenamiento simulados", () => {
    it.each(["HALEL","SHELL"] as const)("%s reanuda evidencia antigua o nueva sin reemplazar originales",async perfil=>{
        const {file,entrada}=await preparar("C-001ABC",false,{empleadoId:77},"DIESEL","Alvaro Pinto",perfil);
        const lineas=await analizar(file,perfil,"GTQ");
        const originalQuery=m.query.getMockImplementation()!;
        for (const nueva of [false,true]) {
            m.insert.mockClear(); m.diario.mockClear();
            const origenes=lineas.map((l,i)=>({id:i+1,empresa_id:7,proveedor_id:3,importacion_id:10,tipo:"ORIGEN",revision:1,marca_origen:1,origen_fila_id:null,operacion_tipo:"CONFIRMAR",hoja_indice:l.hoja,hoja_nombre:l.fila.hoja,fila_excel:l.fila.fila,datos_origen:JSON.stringify(l.fila),decision:JSON.stringify({version:1,moneda:"GTQ",candidato:l.clave,vehiculoId:null,errores:l.errores,...(nueva?{metodoEmpleadoValidado:"SIN_ASIGNACION",asignacion:null}:{})}),resultado:l.fila.estado==="IGNORADA"?"IGNORADA":"OMITIDA",consumo_id:null}));
            m.leer.mockResolvedValue(file);
            m.query.mockImplementation(async(...args)=>{
                const sql=String(args[0]);
                if(sql.startsWith("SELECT * FROM flota_cb2_importaciones"))return [[{id:10,revision:1,version_contrato:2,version_parser:2,perfil,archivo_ruta:"privado-original",archivo_sha256:"sha-original"}],[]];
                if(sql.includes("FROM flota_cb2_filas"))return [origenes,[]];
                if(sql.includes("FROM empleados"))return [[{id:77,nombre:"Alvaro Antonio León Pinto"}],[]];
                return originalQuery(...args);
            });
            const antes=JSON.stringify(origenes);
            const result=await reanudarArchivo(ctx,{importacionId:10,revision:1,seleccion:entrada.seleccion,clave:`reanudar-${perfil}-${nueva}`,motivo:"Verificado en el Excel privado"});
            expect(result.repetida).toBe(false);
            expect(m.leer).toHaveBeenLastCalledWith(7,"privado-original","sha-original");
            expect(JSON.stringify(origenes)).toBe(antes);
            const eventos=m.diario.mock.calls[0][5];
            expect(eventos.some((e:{resultado:string;decision:string;datos_origen:unknown})=>e.resultado==="CREADA"&&e.datos_origen===null&&JSON.parse(e.decision).metodoEmpleadoValidado==="NO_DECLARADO")).toBe(true);
            expect(m.insert.mock.calls.filter(([,table])=>table==="flota_cb2_consumos")).toHaveLength(1);
            expect(m.insert.mock.calls.some(([,table])=>table==="flota_cb2_importaciones")).toBe(false);
        }
    });
    it.each(["HALEL","SHELL"] as const)("%s revalida tokens y registra método sin reemplazar el piloto original",async perfil=>{
        const original=m.query.getMockImplementation()!;
        m.query.mockImplementation(async(...args)=>String(args[0]).includes("FROM empleados")?[[{id:77,nombre:"Alvaro Antonio León Pinto"}],[]]:original(...args));
        const piloto="  Álvaro, Pinto. ",extra={empleadoId:77,metodoEmpleado:"TOKENS_COMPLETOS_UNICOS" as const};
        const {file,entrada,recibo}=await preparar("C-001ABC",true,extra,"DIESEL",piloto,perfil);
        await confirmarArchivo(ctx,file,"sintetico.xlsx",entrada,"piloto-tokens-unicos",recibo.token);
        const creados=m.insert.mock.calls.filter(([,table])=>table==="flota_cb2_consumos");expect(creados).toHaveLength(1);expect(creados[0][2]).toMatchObject({empleado_id:77,piloto_informado:piloto.trim()});
        expect(m.query.mock.calls.filter(([sql])=>String(sql).includes("FROM empleados"))).toHaveLength(2);
        expect(m.insert.mock.calls.find(([,table])=>table==="flota_cb2_importaciones")![2].archivo_nombre).toBe("sintetico.xlsx");
        const eventos=m.diario.mock.calls[0][5],evento=eventos.find((e:{resultado:string})=>e.resultado==="CREADA");expect(JSON.parse(evento.decision)).toMatchObject({metodoEmpleadoValidado:"TOKENS_COMPLETOS_UNICOS",asignacion:extra});expect(JSON.parse(evento.datos_origen).textos.piloto).toBe(piloto);
    });
    it("homónimo aparecido tras preview impide confirmar una asignación automática",async()=>{
        const original=m.query.getMockImplementation()!,catalogo=[{id:77,nombre:"Alvaro Antonio León Pinto"}];
        m.query.mockImplementation(async(...args)=>String(args[0]).includes("FROM empleados")?[catalogo,[]]:original(...args));
        const {file,entrada,recibo}=await preparar("C-001ABC",false,{empleadoId:77,metodoEmpleado:"TOKENS_COMPLETOS_UNICOS"},"DIESEL","Alvaro Pinto");
        catalogo.push({id:78,nombre:"Alvaro Pinto"});await expect(confirmarArchivo(ctx,file,"sintetico.xlsx",entrada,"piloto-ambiguo-nuevo",recibo.token)).rejects.toThrow("ambigua");expect(m.insert.mock.calls.filter(([,table])=>table==="flota_cb2_consumos")).toHaveLength(0);
    });
    it("reutilizar un consumo confirmado no modifica su empleado previo",async()=>{
        const original=m.query.getMockImplementation()!;
        const {file,entrada,recibo}=await preparar("C-001ABC",false,{empleadoId:77,metodoEmpleado:"TOKENS_COMPLETOS_UNICOS"},"DIESEL","Alvaro Pinto");
        const l=(await analizar(file,"HALEL","GTQ"))[1];
        const previo={id:45,empresa_id:7,proveedor_id:3,vehiculo_id:1,empleado_id:42,version_clave:1,version_huella:1,payload_operacion:l.payload,huella_operacion:l.huella,clave_candidata:l.clave,vale_norm:l.fila.vale,factura_id:null};
        m.query.mockImplementation(async(...args)=>String(args[0]).includes("FROM empleados")?[[{id:77,nombre:"Alvaro Antonio León Pinto"}],[]]:String(args[0]).startsWith("SELECT * FROM flota_cb2_consumos")?[[previo],[]]:original(...args));
        await confirmarArchivo(ctx,file,"sintetico.xlsx",entrada,"piloto-previo-intacto",recibo.token);
        expect(m.insert.mock.calls.filter(([,table])=>table==="flota_cb2_consumos")).toHaveLength(0);expect(m.execute.mock.calls.some(([sql])=>String(sql).startsWith("UPDATE flota_cb2_consumos"))).toBe(false);expect(previo.empleado_id).toBe(42);
        expect(m.diario.mock.calls[0][5].some((e:{resultado:string;consumo_id:number})=>e.resultado==="REUTILIZADA"&&e.consumo_id===45)).toBe(true);
    });
    it("empleado ajeno o inactivo no se persiste", async () => {
        const {file,entrada,recibo}=await preparar("C-001ABC",false,{empleadoId:77});
        await expect(confirmarArchivo(ctx,file,"sintetico.xlsx",entrada,"empleado-ajeno-514",recibo.token)).rejects.toThrow("Empleado no autorizado");
        expect(m.query.mock.calls.find(([sql])=>String(sql).includes("FROM empleados"))).toEqual([expect.stringContaining("ORDER BY id LOCK IN SHARE MODE"),[7,77]]);
        expect(m.insert.mock.calls.filter(([,table])=>table==="flota_cb2_consumos")).toHaveLength(0);
    });
    it("persiste clasificación y empleado por separado del texto original", async () => {
        const original=m.query.getMockImplementation()!;
        m.query.mockImplementation(async(...args)=>String(args[0]).includes("FROM empleados")?[[{id:77}],[]]:original(...args));
        const {file,entrada,recibo}=await preparar("C-001ABC",true,{empleadoId:77,productoClasificado:"NO_DETERMINADO"},"");
        await confirmarArchivo(ctx,file,"sintetico.xlsx",entrada,"empleado-propio-514",recibo.token);
        const creados=m.insert.mock.calls.filter(([,table])=>table==="flota_cb2_consumos");expect(creados).toHaveLength(1);
        expect(creados[0][2]).toMatchObject({empleado_id:77,piloto_informado:"DEMO",producto:null,producto_clasificado:"NO_DETERMINADO"});
        const eventos=m.diario.mock.calls[0][5];expect(JSON.stringify(eventos)).toContain("empleadoId");
    });
    it("producto ausente y V-Power sin variante exigen clasificación explícita", async () => {
        for(const producto of ["","V-POWER"]){const {file,entrada,recibo}=await preparar("C-001ABC",false,{},producto);await expect(confirmarArchivo(ctx,file,"sintetico.xlsx",entrada,"producto-pendiente-514",recibo.token)).rejects.toThrow("Clasifica el combustible");}
        expect(m.insert.mock.calls.filter(([,table])=>table==="flota_cb2_consumos")).toHaveLength(0);
    });
    it("corrección manual justificada acepta otra unidad autorizada conservando la placa original", async () => {
        const {file,entrada,recibo}=await preparar("P-001ABC",false,{motivoUnidad:"Verificado por Operaciones con el vale original"});
        await confirmarArchivo(ctx,file,"sintetico.xlsx",entrada,"unidad-manual-514",recibo.token);
        expect(m.insert.mock.calls.find(([,table])=>table==="flota_cb2_consumos")![2]).toMatchObject({vehiculo_id:1,placa_original:"P-001ABC"});
    });
    it("acepta abreviada única y consulta únicamente el catálogo autorizado bajo bloqueo", async () => {
        const { file, entrada, recibo } = await preparar("001 ABC");
        await confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "abreviada-unica-513", recibo.token);
        expect(m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos")).toHaveLength(1);
        const consulta = m.query.mock.calls.find(([sql]) => String(sql).includes("REGEXP_REPLACE"));
        expect(consulta).toBeDefined();
        expect(consulta![0]).toContain("FOR UPDATE");
        expect(consulta![0]).toContain("empresa_id");
        expect(consulta![1]).toEqual([7, 7, "001ABC"]);
    });
    it("rechaza abreviada ambigua aunque el cliente fuerce un ID", async () => {
        const { file, entrada, recibo } = await preparar("001 ABC");
        const original = m.query.getMockImplementation()!;
        m.query.mockImplementation(async (...args) => String(args[0]).includes("REGEXP_REPLACE")
            ? [[{ id: 1, placa: "C-001ABC" }, { id: 2, placa: "P-001ABC" }], []] : original(...args));
        await expect(confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "abreviada-ambigua-513", recibo.token)).rejects.toThrow("no coincide con la placa");
        expect(m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos")).toHaveLength(0);
    });
    it("acepta separadores conservadores, conserva original y crea un consumo por candidato", async () => {
        const { file, entrada, recibo } = await preparar("C 001 ABC", true);
        await confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "clave-sintetica-511", recibo.token);
        const consumos = m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos");
        expect(consumos).toHaveLength(1); expect(consumos[0][2]).toMatchObject({ empresa_id: 7, proveedor_id: 3, placa_original: "C 001 ABC", placa_normalizada: "C 001 ABC", vehiculo_id: 1 });
        expect(m.insert.mock.calls.find(([, table]) => table === "flota_cb2_importaciones")![2].version_parser).toBe(2);
    });
    it.each(["P-001ABC", "C-001AB7"])("selección manual no permite placa diferente: %s", async placa => {
        const { file, entrada, recibo } = await preparar(placa);
        await expect(confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "clave-sintetica-511", recibo.token)).rejects.toThrow("no coincide con la placa");
        expect(m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos")).toHaveLength(0);
    });
    it("revalida acceso de empresa aunque el cliente envíe el ID", async () => {
        const { file, entrada, recibo } = await preparar("C-001ABC"); m.empresaVehiculo = 99;
        await expect(confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "clave-sintetica-511", recibo.token)).rejects.toThrow("sin acceso vigente");
        expect(m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos")).toHaveLength(0);
    });
    it("un recibo firmado de parser anterior exige preview nuevo antes de escribir", async () => {
        const { file, entrada, recibo } = await preparar("C-001ABC");
        const token = await new SignJWT({ ...decodeJwt(recibo.token) as Record<string, unknown>, parser: 1 }).setProtectedHeader({ alg: "HS256" }).sign(getAuthSecretBytes());
        await expect(confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "clave-sintetica-511", token)).rejects.toThrow("Recibo invalido");
        expect(m.guardar).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
    });
});
