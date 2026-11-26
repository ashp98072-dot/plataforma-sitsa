import { randomUUID } from "node:crypto";
import mysql, { type Pool, type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({ getPool: () => state.pool }));
vi.mock("./pilotos-reportados", () => ({ esquemaPilotosReportados: async () => true }));
import { reportePilotos, csvPilotos } from "./pilotos-reporte";
import { historialConsumos } from "./historial-consumos";

const pipe = process.env.CB2_TEST_PIPE ?? "";
let admin: Connection;
describe.skipIf(!pipe)("reportes en MariaDB aislada", () => {
 beforeAll(async () => {
  if (!/^cb2-508-[0-9a-f-]{36}$/.test(pipe)) throw new Error("PIPE aislada requerida");
  admin = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", multipleStatements: true });
  const [[env]] = await admin.query<mysql.RowDataPacket[]>("SELECT VERSION() v,@@skip_networking net,@@socket pipe");
  expect(String(env.v)).toMatch(/^11\.8\.9-MariaDB/); expect(Number(env.net)).toBe(1); expect(env.pipe).toBe(pipe);
  const db=`reportes_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE \`${db}\`; USE \`${db}\`;
   CREATE TABLE flota_cb2_consumos (id INT PRIMARY KEY,empresa_id INT,proveedor_id INT,importacion_origen_id INT,fecha_consumo DATE,numero_vale VARCHAR(20),piloto_informado VARCHAR(100),vehiculo_id INT,unidad_externa_id INT,placa_original VARCHAR(20),producto VARCHAR(30),producto_clasificado VARCHAR(30),galones DECIMAL(18,6),precio DECIMAL(18,6),monto DECIMAL(18,6),moneda CHAR(3),empleado_id INT,piloto_externo_id INT,factura_id INT,estado_factura VARCHAR(30));
   CREATE TABLE flota_cb2_consumo_piloto_reportado (empresa_id INT,proveedor_id INT,consumo_id INT,piloto_reportado_id INT,PRIMARY KEY(empresa_id,proveedor_id,consumo_id));
   CREATE TABLE flota_cb2_importaciones (id INT,empresa_id INT,proveedor_id INT,archivo_nombre VARCHAR(30),perfil VARCHAR(10));
   CREATE TABLE compras_proveedores (id INT,empresa_id INT,nombre_comercial VARCHAR(30));
   CREATE TABLE flota_vehiculos (id INT,placa VARCHAR(20)); CREATE TABLE empleados (id INT,empresa_id INT,nombre VARCHAR(30));
   CREATE TABLE flota_cb2_facturas (id INT,empresa_id INT,proveedor_id INT,serie VARCHAR(20),numero VARCHAR(20));
   INSERT INTO flota_cb2_importaciones VALUES (1,1,1,'sintetico.xlsx','SHELL'); INSERT INTO compras_proveedores VALUES (1,1,'Proveedor');
   INSERT INTO empleados VALUES (1,1,'Ana'),(2,1,'Ana'); INSERT INTO flota_vehiculos VALUES (1,'P001'); INSERT INTO flota_cb2_facturas VALUES (1,1,1,'A','001');
   INSERT INTO flota_cb2_consumos VALUES
    (1,1,1,1,'2026-10-01','001','Ana',1,NULL,'P001','Diesel','DIESEL',1.25,2,2.50,'GTQ',1,NULL,1,'FACTURADO'),
    (2,1,1,1,'2026-10-02','002','Ana',1,NULL,'P001','Diesel','DIESEL',2.5,2,5,'GTQ',2,NULL,1,'FACTURADO'),
    (3,1,1,1,'2026-10-02','003','Ana',1,NULL,'P001','Gasolina','GASOLINA_REGULAR',3,3,9,'USD',NULL,NULL,NULL,'PENDIENTE_FACTURA'),
    (4,1,1,1,'2026-11-01','004','Ana',1,NULL,'P001','Diesel','DIESEL',4,2,8,'GTQ',1,NULL,NULL,'PENDIENTE_FACTURA'),
    (5,2,1,1,'2026-11-01','005','Ana',1,NULL,'P001','Diesel','DIESEL',99,2,198,'GTQ',1,NULL,NULL,'PENDIENTE_FACTURA');
   INSERT INTO flota_cb2_consumo_piloto_reportado VALUES (1,1,3,7);`);
  state.pool=mysql.createPool({socketPath:`\\\\.\\pipe\\${pipe}`,user:"root",database:db,dateStrings:true});
 });
 afterAll(async()=>{ await state.pool?.end(); await admin?.end(); });
 it("totales, filtros y CSV conservan moneda, identidad y valores",async()=>{
  const r=await reportePilotos(1,{desde:"2026-10-01",hasta:"2026-10-31"},0,50);
  expect(r.items).toHaveLength(3); expect(r.porPiloto).toHaveLength(3);
  expect(r.totales.map(t=>[t.moneda,String(t.galones),String(t.importe)])).toEqual([["GTQ","3.750000","7.500000"],["USD","3.000000","9.000000"]]);
  const uno=await reportePilotos(1,{empleadoId:1},0,50); expect(uno.items.map(i=>i.id)).toEqual([1,4]);
  const csv=csvPilotos(r.items), lineas=csv.replace(/^\uFEFF/,"").split("\r\n").map(l=>l.split(",").map(v=>v.slice(1,-1)));
  const col=(n:string)=>lineas[0].indexOf(n);
  expect(lineas.slice(1).map(l=>[l[col("numero_vale")],l[col("galones")],l[col("monto")],l[col("moneda")]])).toEqual([["001","1.250000","2.500000","GTQ"],["002","2.500000","5.000000","GTQ"],["003","3.000000","9.000000","USD"]]);
  const diesel=await reportePilotos(1,{producto:"DIESEL",desde:"2026-10-02",hasta:"2026-10-31"}); expect(diesel.items.map(i=>i.id)).toEqual([2]); expect(String(diesel.totales[0].galones)).toBe("2.500000");
 });
 it("pagina fechas empatadas y excluye otra empresa",async()=>{
  const a=await historialConsumos(1,{},undefined,2); expect(a.items.map(i=>i.id)).toEqual([4,3]);
  const b=await historialConsumos(1,{},a.siguiente!,2); expect(b.items.map(i=>i.id)).toEqual([2,1]); expect(b.siguiente).toBeNull();
 });
});
