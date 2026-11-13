import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as Pool | null, filas: [] as Record<string, unknown>[] }));
vi.mock("@/lib/db", () => ({ getPool: () => state.pool, query: async (s: string,p: unknown[]=[]) => (await state.pool!.query(s,p))[0], execute: async(s:string,p:unknown[]=[]) => (await state.pool!.execute(s,p as never))[0] }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("ENV_PROHIBIDO"); } }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: async()=>{}, asegurarSchemaFlotaLectura: async()=>{} }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlota: async(slug:string) => slug === "denied" ? { error: Response.json({error:"denied"},{status:403}) } : { empresa:{id:slug==="e2"?2:1,nombre:slug},session:{id:1,username:"LAB"} }, requireTenantFlotaCombustible: async(slug:string) => slug === "denied" ? {error:Response.json({error:"denied"},{status:403})} : {empresa:{id:slug==="e2"?2:1},session:{id:1}}, sesionPuedeEditarVehiculosOtrasEmpresas: async()=>false }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasActivas: async()=>[{id:1,codigo:"E1",slug:"e1",nombre:"E1"},{id:2,codigo:"E2",slug:"e2",nombre:"E2"}], obtenerEmpresaPorId: async()=>null }));
vi.mock("@/lib/flota/import-excel", () => ({ parsearExcelFlota: async()=>state.filas, parsearFiltrosTexto: ()=>[] }));
vi.mock("@/lib/flota/empresas-alias", () => ({ resolverEmpresaFlotaExcel: (s:string)=>({etiqueta:s,slugs:s==="E2"?["e2"]:[],codigos:[],grupoCompartido:false}) }));
import { POST, PATCH } from "@/app/api/empresas/[slug]/flota/vehiculos/route";
import { POST as importar } from "@/app/api/empresas/[slug]/flota/import/route";
import { GET as catalogosHTTP } from "@/app/api/empresas/[slug]/flota/combustible/catalogos/route";
import { guardarPropiedad } from "./propiedad";
import { catalogoSinAlias } from "./vehiculos-alias";
import { escribirVehiculos, exigirPlacaLibreTx } from "./vehiculos-escritura";
const pipe=process.env.CB2_587_PIPE??"";
const q=async(s:string,p:unknown[]=[]) => (await state.pool!.query<RowDataPacket[]>(s,p))[0];
const ctx=(slug="e1")=>({params:Promise.resolve({slug})});
const req=(data:unknown,method="POST")=>new Request("http://localhost/lab",{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
const alta=(placa:string,slug="e1")=>POST(req({placa}),ctx(slug));
function fila(placa:string,empresaActivo="E1") {
 const f:Record<string,unknown>={}; for(const k of ["marca","modelo","descripcion","color","credito","nit","condicionPropiedad","seguros","notas","kmActual","kmIntervalo","kmUltimoServicio","rinLlanta","medidaLlanta","tipoAceite","tipoCombustible","chasis","capacidad"])f[k]=null;
 return {...f,placa,empresaActivo,activo:true,filaExcel:2};
}
function importRequest(){const f=new FormData();f.append("file",new File(["synthetic"],"lab.xlsx"));return new Request("http://localhost/lab",{method:"POST",body:f});}
describe.skipIf(!pipe)("escritores HTTP reales / MariaDB aislada",()=>{
 beforeAll(async()=>{
  if(!/^cb2-587-[0-9a-f-]{36}$/.test(pipe))throw Error("PIPE no autorizado");
  const c=await mysql.createConnection({socketPath:`\\\\.\\pipe\\${pipe}`,user:"root",multipleStatements:true});
  try{
   const [[env]]=await c.query<RowDataPacket[]>("SELECT VERSION() v,@@skip_networking net,@@socket pipe,@@datadir dir");
   expect(env.v).toMatch(/^11\.8\.9-MariaDB/);expect(Number(env.net)).toBe(1);expect(env.pipe).toBe(pipe);
   expect(path.resolve(env.dir).toLowerCase()).toBe(path.resolve(process.env.CB2_587_DATA??"").toLowerCase());
   const db="flota_writers_"+randomUUID().replaceAll("-","");await c.query(`CREATE DATABASE ${db}; USE ${db}`);
   await c.query("CREATE TABLE empresas(id INT PRIMARY KEY,activa INT,nombre VARCHAR(40),codigo VARCHAR(40));INSERT INTO empresas VALUES(1,1,'E1','E1'),(2,1,'E2','E2')");
   const ddl=readFileSync("sql/schema.sql","utf8").match(/CREATE TABLE IF NOT EXISTS flota_vehiculos \([\s\S]*?ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/)![0];await c.query(ddl);
   await c.query("ALTER TABLE flota_vehiculos ADD rin_llanta VARCHAR(80), ADD medida_llanta VARCHAR(80), ADD tipo_aceite VARCHAR(80), ADD filtro_servicio_mayor VARCHAR(120), ADD filtro_servicio_menor VARCHAR(120), ADD tipo_propiedad VARCHAR(20) DEFAULT 'EMPRESA',ADD empresa_propietaria_id INT NULL,ADD propietario_externo VARCHAR(120),ADD tipo_vehiculo VARCHAR(80),ADD revision_propiedad INT DEFAULT 0");
   await c.query("CREATE TABLE flota_vehiculo_acceso(vehiculo_id INT,empresa_id INT,PRIMARY KEY(vehiculo_id,empresa_id));CREATE TABLE flota_vehiculos_fusiones(origen_id INT PRIMARY KEY,destino_id INT,empresa_id INT);CREATE TABLE flota_vehiculo_filtros(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT,vehiculo_id INT,tipo VARCHAR(80),codigo VARCHAR(120),notas VARCHAR(300));CREATE TABLE auditoria(empresa_id INT,usuario VARCHAR(80),accion VARCHAR(80),modulo VARCHAR(80),detalle LONGTEXT)");
   await c.query("CREATE TABLE compras_proveedores(id INT,empresa_id INT,activo INT,nombre_comercial VARCHAR(80));CREATE TABLE flota_combustible_estaciones(id INT,empresa_id INT,proveedor_id INT,activo INT,nombre VARCHAR(80),direccion VARCHAR(80))");
   state.pool=mysql.createPool({socketPath:`\\\\.\\pipe\\${pipe}`,user:"root",database:db,connectionLimit:8});
  }finally{await c.end();}
 },60000);
 afterAll(async()=>{vi.unstubAllEnvs();await state.pool?.end();});
 it("altas concurrentes por variantes crean una sola unidad y permiten otra empresa",async()=>{
  const gate=await state.pool!.getConnection();await gate.beginTransaction();await gate.query("SELECT id FROM empresas WHERE id=1 FOR UPDATE");
  const pending=Promise.all([alta("C-900LAB"),alta("c 900 lab"),alta("C\u2013900LAB")]);
  try{for(let i=0;i<100;i++){const rows=await q("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND INFO LIKE 'SELECT id FROM empresas%FOR UPDATE'");if(rows.length>=3)break;if(i===99)throw Error("writers did not contend");await new Promise(r=>setTimeout(r,10));}}finally{await gate.commit();gate.release();}
  const responses=await pending;expect(responses.map(r=>r.status).sort()).toEqual([200,409,409]);
  expect(await alta("C900LAB","e2")).toHaveProperty("status",200);
  expect(await alta("C999XXX","denied")).toHaveProperty("status",403);
 });
 it("edicion rechaza colision y revierte cualquier otro cambio",async()=>{
  const r=await alta("C901LAB"),{id}=await r.json();const before=await q("SELECT * FROM flota_vehiculos WHERE id=?",[id]);
  expect((await PATCH(req({id,placa:"C 900 LAB",tipoUnidad:"TC",marca:"NO GUARDAR"},"PATCH"),ctx())).status).toBe(409);
  expect(await q("SELECT * FROM flota_vehiculos WHERE id=?",[id])).toEqual(before);
  expect((await PATCH(req({id,placa:"C999LAB"},"PATCH"),ctx("e2"))).status).toBe(404);
  expect((await PATCH(req({id,placa:"c-901lab",marca:"LAB"},"PATCH"),ctx())).status).toBe(200);
 });
 it("importacion y alta simultaneas no duplican; otra empresa no se busca ni modifica",async()=>{
  state.filas=[fila("C-902LAB")];const responses=await Promise.all([alta("C 902 LAB"),importar(importRequest(),ctx())]);
  expect([200,409]).toContain(responses[0].status);expect((await responses[1].json()).errores).toEqual([]);
  expect(await q("SELECT id FROM flota_vehiculos WHERE empresa_id=1 AND placa LIKE '%902%'")).toHaveLength(1);
  state.filas=[fila("C900LAB","E2")];expect((await (await importar(importRequest(),ctx())).json()).errores).toHaveLength(1);
 });
 it("duplicados previos requieren revision; alias dirige importacion solo al principal",async()=>{
  await q("INSERT INTO flota_vehiculos(empresa_id,placa) VALUES(1,'C903LAB'),(1,'C-903LAB')");state.filas=[fila("C 903 LAB")];
  const before=await q("SELECT * FROM flota_vehiculos WHERE placa LIKE '%903%'");expect((await (await importar(importRequest(),ctx())).json()).errores).toHaveLength(1);expect(await q("SELECT * FROM flota_vehiculos WHERE placa LIKE '%903%'")).toEqual(before);
  const [a,b]=before;await q("UPDATE flota_vehiculos SET activo=0 WHERE id=?",[a.id]);await q("INSERT INTO flota_vehiculos_fusiones VALUES(?,?,1)",[a.id,b.id]);
  vi.stubEnv("FLOTA_FUSIONES_APROBADAS","");
  const body=await (await catalogosHTTP(new Request("http://localhost/lab"),ctx())).json();
  expect(body.vehiculos.some((v:{id:number})=>v.id===a.id)).toBe(false);expect(body.vehiculos.find((v:{id:number})=>v.id===b.id).descripcion).toContain("Principal #"+b.id);
  expect((await catalogosHTTP(new Request("http://localhost/lab"),ctx("denied"))).status).toBe(403);
  const visible=await catalogoSinAlias(before.map(v => ({...v,id:Number(v.id)})));expect(visible).toHaveLength(1);expect(visible[0]).toMatchObject({id:b.id,principalFusion:true});
  expect((await (await importar(importRequest(),ctx())).json()).errores).toEqual([]);expect((await q("SELECT activo FROM flota_vehiculos WHERE id=?",[a.id]))[0].activo).toBe(0);
 });
 it("alta con propiedad comparte bloqueo; rollback deja la placa libre",async()=>{
  vi.stubEnv("FLOTA_PROPIEDAD_EXTERNA","1");
  const p=guardarPropiedad(1,"LAB",{tipoPropiedad:"EMPRESA",empresaPropietariaId:1,placa:"C-904LAB"},true);
  const result=await Promise.allSettled([p,alta("C 904 LAB")]);expect(result.some(r=>r.status==="fulfilled")).toBe(true);if(result[0].status==="rejected")expect(result[0].reason).toMatchObject({status:409});if(result[1].status==="fulfilled")expect([200,409]).toContain(result[1].value.status);expect(await q("SELECT id FROM flota_vehiculos WHERE placa LIKE '%904%'")).toHaveLength(1);
  await expect(escribirVehiculos(1,async c=>{await exigirPlacaLibreTx(c,1,"C905LAB");await c.query("INSERT INTO flota_vehiculos(empresa_id,placa) VALUES(1,'C905LAB')");throw Error("ROLLBACK_LAB");})).rejects.toThrow("ROLLBACK_LAB");
  expect((await alta("C-905LAB")).status).toBe(200);
 });
});
