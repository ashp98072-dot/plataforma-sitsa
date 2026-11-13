import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as Pool | null, filas: [] as Record<string, unknown>[], admin: false }));
vi.mock("@/lib/db", () => ({ getPool: () => state.pool, query: async (s: string,p: unknown[]=[]) => (await state.pool!.query(s,p))[0], execute: async(s:string,p:unknown[]=[]) => (await state.pool!.execute(s,p as never))[0] }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("ENV_PROHIBIDO"); } }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: async()=>{}, asegurarSchemaFlotaLectura: async()=>{} }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlota: async(slug:string) => slug === "denied" ? { error: Response.json({error:"denied"},{status:403}) } : { empresa:{id:slug==="e2"?2:1,nombre:slug},session:{id:1,username:"LAB",rol:state.admin?"Admin":"Operador"} }, requireTenantFlotaCombustible: async(slug:string) => slug === "denied" ? {error:Response.json({error:"denied"},{status:403})} : {empresa:{id:slug==="e2"?2:1},session:{id:1}}, sesionPuedeEditarVehiculosOtrasEmpresas: async()=>false }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasActivas: async()=>[{id:1,codigo:"E1",slug:"e1",nombre:"E1"},{id:2,codigo:"E2",slug:"e2",nombre:"E2"}], obtenerEmpresaPorId: async()=>null }));
vi.mock("@/lib/flota/import-excel", () => ({ parsearExcelFlota: async()=>state.filas, parsearFiltrosTexto: ()=>[] }));
vi.mock("@/lib/flota/empresas-alias", () => ({ resolverEmpresaFlotaExcel: (s:string)=>({etiqueta:s,slugs:s==="E2"?["e2"]:[],codigos:[],grupoCompartido:false}) }));
import { POST, PATCH } from "@/app/api/empresas/[slug]/flota/vehiculos/route";
import { POST as importar } from "@/app/api/empresas/[slug]/flota/import/route";
import { GET as catalogosHTTP } from "@/app/api/empresas/[slug]/flota/combustible/catalogos/route";
import { guardarPropiedad } from "./propiedad";
import { catalogoSinAlias } from "./vehiculos-alias";
import { escribirVehiculos, exigirPlacaLibreTx } from "./vehiculos-escritura";
import { inspeccionarIdentidadFisica, proponerIdentidadFisica, consultarIdentidadFisica, aprobarIdentidadFisica } from "./identidad-fisica";
import { identidadFisicaHttp } from "./identidad-fisica-http";
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
 it("identidad fisica multiempresa: aprobaciones, concurrencia, acceso e historicos intactos",async()=>{
  await q("CREATE TABLE usuarios(id INT PRIMARY KEY,activo INT,rol_global VARCHAR(30))");
  await q("INSERT INTO usuarios VALUES(1,1,'Admin'),(2,1,'Admin')");
  const sql=readFileSync("sql/migrate-2026-11-flota-identidad-fisica.sql","utf8");
  const connection=await state.pool!.getConnection();
  try{for(const part of sql.split(/DELIMITER\s+\/\//i)[0].split(';'))if(part.trim())await connection.query(part);
   for(const part of sql.split(/DELIMITER\s+\/\//i)[1].split(/DELIMITER\s+;/i)[0].split('//'))if(part.trim())await connection.query(part);
  }finally{connection.release();}
  await q("INSERT INTO flota_vehiculos(id,empresa_id,placa,tipo_unidad,chasis,empresa_propietaria_id) VALUES(651,1,'C-092BXF','TC','LABVIN092BXF01',1),(1300,2,'C 092 BXF','TC','LABVIN092BXF01',2),(684,1,'C-558BSJ','TC','LABVIN558BSJ01',1),(1301,2,'C558BSJ','TC','LABVIN558BSJ01',2)");
  await q("INSERT INTO flota_vehiculo_acceso VALUES(651,2),(1300,1),(684,2),(1301,1)");
  for(const t of ['flota_combustible_lab','flota_mantenimientos_lab','flota_multas_lab','flota_documentos_lab']){
   await q(`CREATE TABLE ${t}(id INT PRIMARY KEY,empresa_id INT,vehiculo_id INT,detalle VARCHAR(80),FOREIGN KEY(vehiculo_id) REFERENCES flota_vehiculos(id))`);
   await q(`INSERT INTO ${t} VALUES(1,1,651,'historia E1'),(2,2,1300,'historia E2')`);
  }
  await q("CREATE TABLE flota_viajes(id INT PRIMARY KEY,empresa_id INT,vehiculo_id INT,estado VARCHAR(30),hora_llegada DATETIME,FOREIGN KEY(vehiculo_id) REFERENCES flota_vehiculos(id))");
  await q("INSERT INTO flota_viajes VALUES(1,1,651,'cerrado',NOW()),(2,2,1300,'cerrado',NOW())");
  const originales=await q("SELECT * FROM flota_vehiculos WHERE id IN (651,1300) ORDER BY id"),accesos=await q("SELECT * FROM flota_vehiculo_acceso ORDER BY vehiculo_id,empresa_id");
  const c1={empresaId:1,usuarioId:1,usuario:'LAB1',autorizar:async()=>{}},c2={empresaId:2,usuarioId:2,usuario:'LAB2',autorizar:async()=>{}};
  const inspect=await inspeccionarIdentidadFisica(c1,[651,1300]);expect(inspect.compatible).toBe(true);
  expect(inspect.vehiculos[0].referencias.some(r=>r.tabla==='flota_viajes'&&r.cantidad===1)).toBe(true);
  await expect(inspeccionarIdentidadFisica({...c1,empresaId:999},[651,1300])).rejects.toMatchObject({status:403});
  const op={ids:[651,1300],revisiones:Object.fromEntries(inspect.vehiculos.map(v=>[v.id,v.revision])),motivo:'Evidencia fisica sintetica, series y titularidades revisadas'};
  const proposed=await Promise.allSettled([proponerIdentidadFisica(c1,op),proponerIdentidadFisica(c1,op)]);
  expect(proposed.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const result=proposed.find(r=>r.status==='fulfilled');if(result?.status!=='fulfilled')throw Error('sin propuesta');const id=result.value.id;
  const visibles=()=>catalogoSinAlias(originales.map(v=>({...v,id:Number(v.id)})),1);
  expect(await visibles()).toHaveLength(2);
  await expect(q("UPDATE flota_identidades_fisicas SET estado='APROBADA' WHERE id=?",[id])).rejects.toThrow();
  const v1=await consultarIdentidadFisica(c1,id) as {revision:string};
  expect(await aprobarIdentidadFisica(c1,{id,revision:v1.revision,evidencia:'Revision empresa uno acreditada'})).toMatchObject({estado:'PROPUESTA',historicosReasignados:0});
  expect(await visibles()).toHaveLength(2);
  await expect(aprobarIdentidadFisica(c1,{id,revision:v1.revision,evidencia:'Repeticion no permitida'})).rejects.toThrow();
  const v2=await consultarIdentidadFisica(c2,id) as {revision:string};
  const approved=await Promise.allSettled([aprobarIdentidadFisica(c2,{id,revision:v2.revision,evidencia:'Revision empresa dos acreditada'}),aprobarIdentidadFisica(c2,{id,revision:v2.revision,evidencia:'Revision empresa dos acreditada'})]);
  expect(approved.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(await visibles()).toMatchObject([{id:651,identidadFisicaId:id}]);
  expect(await catalogoSinAlias(originales.map(v=>({...v,id:Number(v.id)})),2)).toMatchObject([{id:1300,identidadFisicaId:id}]);
  expect(await q("SELECT * FROM flota_vehiculos WHERE id IN (651,1300) ORDER BY id")).toEqual(originales);
  expect(await q("SELECT * FROM flota_vehiculo_acceso ORDER BY vehiculo_id,empresa_id")).toEqual(accesos);
  await q("INSERT INTO flota_vehiculos(empresa_id,placa) VALUES(2,'C888LAB')");const [shared]=await q("SELECT id FROM flota_vehiculos WHERE placa='C888LAB'");await q("INSERT INTO flota_vehiculo_acceso VALUES(?,1)",[shared.id]);
  expect((await alta('C-888LAB')).status).toBe(409);state.filas=[fila('c 888 lab')];expect((await (await importar(importRequest(),ctx())).json()).errores).toHaveLength(1);
  expect(await q("SELECT id FROM flota_vehiculos WHERE empresa_id=1 AND placa LIKE '%888%'")).toHaveLength(0);
  for(const t of ['flota_combustible_lab','flota_mantenimientos_lab','flota_multas_lab','flota_documentos_lab'])expect(await q(`SELECT * FROM ${t} ORDER BY id`)).toMatchObject([{id:1,empresa_id:1,vehiculo_id:651,detalle:'historia E1'},{id:2,empresa_id:2,vehiculo_id:1300,detalle:'historia E2'}]);
  expect(await q("SELECT id,vehiculo_id FROM flota_viajes ORDER BY id")).toMatchObject([{id:1,vehiculo_id:651},{id:2,vehiculo_id:1300}]);
  for(const statement of ["DELETE FROM flota_identidad_miembros WHERE vehiculo_id=651","DELETE FROM flota_identidad_aprobaciones","UPDATE flota_vehiculos SET chasis='OTRASERIE' WHERE id=651","UPDATE flota_vehiculos SET empresa_id=2 WHERE id=651"])await expect(q(statement)).rejects.toThrow();
  expect((await identidadFisicaHttp(new Request('http://localhost/lab?vehiculos=651,1300'),'denied')).status).toBe(403);
  // The session mock intentionally lacks Admin: HTTP cannot trust a valid DB actor alone.
  expect((await identidadFisicaHttp(new Request('http://localhost/lab?vehiculos=651,1300'),'e1')).status).toBe(403);
  state.admin=true;
  const scoped=await identidadFisicaHttp(new Request(`http://localhost/lab?id=${id}`),'e1');expect(scoped.status).toBe(200);const scopedData=await scoped.json();expect(scopedData.miembros.map((v:{id:number})=>v.id)).toEqual([651]);
  const forged=new Request('http://localhost/lab',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({...op,empresaId:2,confirmado:true})});expect((await identidadFisicaHttp(forged,'e1')).status).toBe(400);
  expect((await identidadFisicaHttp(new Request('http://localhost/lab',{method:'PATCH',headers:{Origin:'https://otro.invalid'},body:'{}'}),'e1')).status).toBe(403);
  const second=await inspeccionarIdentidadFisica(c1,[684,1301]);const secondOp={ids:[684,1301],revisiones:Object.fromEntries(second.vehiculos.map(v=>[v.id,v.revision])),motivo:'Segunda unidad sintetica revisada',confirmado:true};
  const created=await identidadFisicaHttp(new Request('http://localhost/lab',{method:'POST',headers:{Origin:'http://localhost'},body:JSON.stringify(secondOp)}),'e1');expect(created.status).toBe(200);const secondId=(await created.json()).id;
  const detail=await consultarIdentidadFisica(c1,secondId) as {revision:string};
  const patch=await identidadFisicaHttp(new Request('http://localhost/lab',{method:'PATCH',headers:{Origin:'http://localhost'},body:JSON.stringify({id:secondId,revision:detail.revision,evidencia:'Aprobacion HTTP primera empresa',confirmado:true})}),'e1');expect(patch.status).toBe(200);expect((await patch.json()).estado).toBe('PROPUESTA');
  await q("DROP TRIGGER fifi_nueva");expect((await identidadFisicaHttp(new Request('http://localhost/lab'),'e1')).status).toBe(503);await expect(visibles()).rejects.toThrow('parcial');
  // Restore exactly the missing guard for the final actor check.
  const nueva=sql.split(/DELIMITER\s+\/\//i)[1].split('//')[0];await q(nueva);
  await q("UPDATE usuarios SET activo=0 WHERE id=2");await expect(consultarIdentidadFisica(c2,id)).rejects.toMatchObject({status:403});
 },60000);
});
