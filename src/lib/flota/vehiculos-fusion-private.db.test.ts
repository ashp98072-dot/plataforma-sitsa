import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import { afterAll, beforeAll, expect, it, vi, describe } from "vitest";
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({ getPool: () => state.pool }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("ENV_PROHIBIDO"); } }));
import { fusionarVehiculos } from "./vehiculos-fusion";
import { predicadoVehiculoAccesible } from "./acceso";
import { referencias } from "./vehiculos-duplicados";
import { placaComparable } from "./combustible-coincidencias";
const pipe = process.env.CB2_PRIVATE_PIPE ?? "";
const q = async (s: string, a: unknown[] = []) => (await state.pool!.query<RowDataPacket[]>(s,a))[0];
describe.skipIf(!pipe)("respaldo privado pre-CB2 restaurado: fusión real", () => {
 beforeAll(async () => {
  if (!/^cb2-audit-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
  state.pool=mysql.createPool({socketPath:'\\\\.\\pipe\\'+pipe,user:'root',database:'u611730801_Plataforma',connectionLimit:5});
  const [s]=await q("SELECT VERSION() version,@@skip_networking net,@@socket pipe");
  expect(s.version).toMatch(/^11\.8\.9-MariaDB/); expect(Number(s.net)).toBe(1); expect(s.pipe).toBe(pipe);
 });
 afterAll(async () => { vi.unstubAllEnvs(); await state.pool?.end(); });
 it("migraciones propuestas compatibles con esquema restaurado, sin reescribir consumos",async()=>{
  const before=await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
  const c=await state.pool!.getConnection();
  try{
   await c.query(readFileSync("sql/migrate-2026-11-cb2-identidades-independientes.sql","utf8"));
   const sql=readFileSync("sql/migrate-2026-11-flota-identidad-fisica.sql","utf8");
   for(const part of sql.split(/DELIMITER\s+\/\//i)[0].split(';'))if(part.trim())await c.query(part);
   for(const part of sql.split(/DELIMITER\s+\/\//i)[1].split(/DELIMITER\s+;/i)[0].split('//'))if(part.trim())await c.query(part);
   expect(await q("SELECT * FROM flota_cb2_consumos ORDER BY id")).toEqual(before);
   expect(await q("SELECT * FROM flota_identidades_fisicas")).toEqual([]);
  }finally{c.release();}
 });
 it("audita pares reportados solo en la copia privada, sin declararlos fusionables por placa", async () => {
  const c = await state.pool!.getConnection();
  try {
    const resumen = [];
    for (const ids of [[651,1300],[684,1301]]) {
      const rows = await q("SELECT id,empresa_id,placa,tipo_unidad,chasis,activo FROM flota_vehiculos WHERE id IN (?,?) ORDER BY id",ids);
      const serial = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s/g, "");
      const [a,b] = rows;
      resumen.push({ ids, encontrados: rows.length, empresaCoincide: !!a && !!b && a.empresa_id === b.empresa_id,
        placaCoincide: !!a && !!b && placaComparable(a.placa) === placaComparable(b.placa),
        tipoCoincide: !!a && !!b && a.tipo_unidad === b.tipo_unidad,
        chasisRealCoincide: !!a && !!b && /^[A-Z0-9]{6,32}$/.test(serial(a.chasis)) && !/^(.)\1+$/.test(serial(a.chasis)) && !["DESCONOCIDO","PENDIENTE","SINDATO","NOAPLICA"].includes(serial(a.chasis)) && serial(a.chasis) === serial(b.chasis),
        referencias: await Promise.all(rows.map(async v => ({ id: v.id, fuentes: (await referencias(c,Number(v.empresa_id),Number(v.id),false)).map(r => ({ tabla:r.tabla,campo:r.campo,cantidad:r.cantidad })) }))),
        dictamen: "REVISION_MANUAL; copia pre-CB2, no estado productivo actual" });
    }
    mkdirSync(".lab-runtime", { recursive: true });
    writeFileSync(".lab-runtime/pares-auditoria-privada.json", JSON.stringify(resumen,null,2));
  } finally { c.release(); }
 });
 it("conserva viajes, combustible y asignaciones; bloquea alias nuevos, eliminación y repetición", async () => {
  // Activación simulada solo dentro de Vitest; no se escribe configuración.
  vi.stubEnv("FLOTA_FUSIONES_APROBADAS","1");
  const [actor]=await q("SELECT id,username FROM usuarios WHERE activo=1 AND rol_global='Admin' ORDER BY id LIMIT 1");
  const [base]=await q("SELECT v.* FROM flota_vehiculos v JOIN empresas e ON e.id=v.empresa_id WHERE e.activa=1 ORDER BY v.id LIMIT 1");
  expect(actor).toBeTruthy(); expect(base).toBeTruthy();
  const cols=Object.keys(base).filter(k=>k!=='id');
  const copia: Record<string, unknown>={...base,placa:'C999LAB',chasis:'LABSERIAL99900001',activo:1,estado:'Activo',en_taller:0};
  const crear=async()=>{const [r]=await state.pool!.execute<ResultSetHeader>(`INSERT INTO flota_vehiculos (${cols.map(k=>'`'+k+'`').join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,cols.map(k=>copia[k]) as import("@/lib/db").SqlValue[]);return r.insertId;};
  const origen=await crear(); copia.placa='C-999LAB'; const destino=await crear(), empresa=Number(base.empresa_id);
  await q("INSERT INTO flota_viajes(empresa_id,vehiculo_id,piloto_nombre,hora_salida,hora_llegada,estado) VALUES(?,?,'LAB PRIVADO','2020-01-01','2020-01-02','cerrado')",[empresa,origen]);
  await q("INSERT INTO flota_combustible_cargas(empresa_id,vehiculo_id,tipo_combustible,numero_vale,galones,monto,ruta_relativa,nombre_original,creado_por,creado_at) VALUES(?,?,'diesel','LAB-FUSION',1,20,'lab','lab','LAB',NOW())",[empresa,origen]);
  await q("INSERT INTO flota_vehiculo_acceso(vehiculo_id,empresa_id) VALUES(?,?)",[origen,empresa]);
  const tablas=['flota_viajes','flota_combustible_cargas','flota_cb2_consumos','flota_cb2_filas','flota_cb2_asignaciones','flota_vehiculo_acceso'];
  const snapshot=()=>Promise.all(tablas.map(async t=>createHash('sha256').update(JSON.stringify(await q(`SELECT * FROM ${t}`))).digest('hex')));
  const antes=await snapshot();
  const firma=async(id:number)=>createHash('sha256').update(JSON.stringify((await q('SELECT * FROM flota_vehiculos WHERE id=?',[id]))[0])).digest('hex');
  const op={id:origen,conservarId:destino,revision:await firma(origen),destinoRevision:await firma(destino),motivo:'Duplicado sintético revisado en laboratorio privado'};
  const ctx={empresaId:empresa,usuarioId:Number(actor.id),usuario:String(actor.username),autorizar:async()=>{}};
  expect(await fusionarVehiculos(ctx,op)).toMatchObject({origen,destino,historicosReasignados:0});
  expect(await snapshot()).toEqual(antes);
  expect(await q(`SELECT id FROM flota_vehiculos v WHERE v.id=? AND ${predicadoVehiculoAccesible('v','?')}`,[origen,empresa,empresa])).toEqual([]);
  expect((await q('SELECT activo FROM flota_vehiculos WHERE id=?',[origen]))[0].activo).toBe(0);
  await expect(q("INSERT INTO flota_viajes(empresa_id,vehiculo_id,piloto_nombre,hora_salida) VALUES(?,?,'LAB',NOW())",[empresa,origen])).rejects.toThrow('fusionado');
  await expect(q('DELETE FROM flota_vehiculos_fusiones WHERE origen_id=?',[origen])).rejects.toThrow('eliminarse');
  await expect(fusionarVehiculos(ctx,op)).rejects.toThrow();
  await q("UPDATE flota_combustible_cargas SET observaciones='Historia accesible' WHERE vehiculo_id=?",[origen]);
  expect((await q('SELECT v.placa FROM flota_viajes t JOIN flota_vehiculos v ON v.id=t.vehiculo_id WHERE t.vehiculo_id=?',[origen]))[0].placa).toBe('C999LAB');
 });
});
