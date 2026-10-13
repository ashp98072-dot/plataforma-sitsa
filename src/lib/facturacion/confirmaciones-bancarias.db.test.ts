import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import mysql,{ type Pool,type RowDataPacket } from "mysql2/promise";
import { afterAll,beforeAll,describe,it,expect,vi } from "vitest";
const holder=vi.hoisted(()=>({pool:null as Pool|null}));
vi.mock("@/lib/db",()=>({getPool:()=>{if(!holder.pool)throw new Error("Sin conexión local fixture");return holder.pool;}}));
import { confirmarIngresoBancario,anularConfirmacionBancaria,listarConfirmacionesBancarias,evidenciaConfirmacionBancaria } from "./confirmaciones-bancarias";
const port=Number(process.env.CONTA_B_TEST_PORT??0);
const database="conta_b_test_"+randomUUID().replaceAll("-","");
const actor={empresaId:7,usuarioId:4,usuario:"fixture"};
const input=(monto="10000")=>({pagoId:null,cuentaBancariaId:1,monto,fechaAcreditacion:"2026-10-13",referencia:"REF",observaciones:null,idempotencyKey:randomUUID()});
let next=10;
async function factura(delta:Record<string,string|number|undefined>={}) {
  const id=next++;
  await holder.pool!.execute("INSERT INTO fact_facturas(id,empresa_id,entidad_id,monto_total,moneda,estado_admin,retencion_iva_pct,retencion_iva_monto) VALUES (?,?,?,?,?,?,?,?)",[id,delta.empresa??7,delta.entidad??9,delta.total??"10000",delta.moneda??"GTQ",delta.estado??"Emitida",delta.pct??0,delta.retencion??"0"]);
  return id;
}
describe.skipIf(!port)("PR B / MariaDB 11.8.9 SOLO LOCAL",()=>{
  beforeAll(async()=>{
    if(port!==3407)throw new Error("Solo puerto local desechable 3407");
    const c=await mysql.createConnection({host:"127.0.0.1",port,user:"root",password:"",multipleStatements:true});
    try {
      const [v]=await c.query<RowDataPacket[]>("SELECT VERSION() AS v");expect(v[0].v).toContain("11.8.9");
      await c.query("CREATE DATABASE "+database+" CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci");await c.query("USE "+database);
      await c.query(`CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE usuarios(id INT PRIMARY KEY,username VARCHAR(100)) ENGINE=InnoDB;
        CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT,activa TINYINT,UNIQUE(empresa_id,id)) ENGINE=InnoDB;
        CREATE TABLE cont_cuentas(id INT PRIMARY KEY,empresa_id INT,entidad_id INT,activa TINYINT,UNIQUE(empresa_id,entidad_id,id)) ENGINE=InnoDB;
        CREATE TABLE cont_cuentas_bancarias(id INT PRIMARY KEY,empresa_id INT,entidad_id INT,cuenta_id INT,activa TINYINT,moneda CHAR(3),banco VARCHAR(120),alias VARCHAR(120),UNIQUE(empresa_id,entidad_id,id)) ENGINE=InnoDB;
        CREATE TABLE fact_facturas(id INT PRIMARY KEY,empresa_id INT,entidad_id INT,monto_total DECIMAL(14,2),moneda CHAR(3),estado_admin VARCHAR(20),retencion_iva_pct TINYINT,retencion_iva_monto DECIMAL(14,2)) ENGINE=InnoDB;
        CREATE TABLE fact_pagos(id INT PRIMARY KEY,empresa_id INT,factura_id INT,monto DECIMAL(14,2),referencia VARCHAR(120)) ENGINE=InnoDB;
        CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT,usuario VARCHAR(100),accion VARCHAR(100),modulo VARCHAR(100),detalle TEXT) ENGINE=InnoDB;
        CREATE TABLE cont_asientos(id INT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE cont_eventos(id INT PRIMARY KEY) ENGINE=InnoDB;
        INSERT INTO empresas VALUES(7),(8); INSERT INTO usuarios VALUES(4,'fixture');
        INSERT INTO cont_entidades VALUES(9,7,1),(10,7,1),(11,8,1);
        INSERT INTO cont_cuentas VALUES(1,7,9,1),(2,7,10,1),(3,8,11,1),(4,7,9,0);
        INSERT INTO cont_cuentas_bancarias VALUES(1,7,9,1,1,'GTQ','Banco','Alias'),(2,7,10,2,1,'GTQ','Banco','Otra entidad'),(3,8,11,3,1,'GTQ','Banco','Otra empresa'),(4,7,9,1,0,'GTQ','Banco','Inactiva'),(5,7,9,4,1,'GTQ','Banco','Contable inactiva'),(6,7,9,1,1,'USD','Banco','USD');`);
      await c.query(readFileSync("sql/migrate-2026-10-confirmaciones-bancarias.sql","utf8"));
      await c.query(readFileSync("sql/migrate-2026-10-confirmaciones-bancarias.sql","utf8"));
    }finally{await c.end();}
    holder.pool=mysql.createPool({host:"127.0.0.1",port,user:"root",password:"",database,connectionLimit:6});
  });
  afterAll(async()=>{await holder.pool?.end();}); // No DROP, datos sintéticos recuperables.
  it("total, pago NULL y sin asientos/eventos",async()=>{
    const f=await factura();await confirmarIngresoBancario(actor,f,input());
    const d=await listarConfirmacionesBancarias(7,f);expect(d.totalConfirmadoActivo).toBe("10000.00");expect(d.saldoPendiente).toBe("0.00");expect(d.confirmaciones[0].pago_id).toBeNull();
    for(const table of ["cont_asientos","cont_eventos"]) {const [r]=await holder.pool!.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM "+table);expect(r[0].n).toBe(0);}
  });
  it("parciales 4000+3000+3000 y sobreconfirmación bloqueada",async()=>{
    const f=await factura();for(const m of ["4000","3000"])await confirmarIngresoBancario(actor,f,input(m));
    expect((await listarConfirmacionesBancarias(7,f)).saldoPendiente).toBe("3000.00");
    await expect(confirmarIngresoBancario(actor,f,input("3000.01"))).rejects.toThrow("saldo");
    await confirmarIngresoBancario(actor,f,input("3000"));
  });
  it("pagos informados no reducen límite, vínculo opcional no modifica pago",async()=>{
    const f=await factura();await holder.pool!.execute("INSERT INTO fact_pagos VALUES(1,7,?,'10000','administrativo')",[f]);
    const [antes]=await holder.pool!.query("SELECT * FROM fact_pagos");
    await confirmarIngresoBancario(actor,f,{...input(),pagoId:1});expect((await listarConfirmacionesBancarias(7,f)).saldoPendiente).toBe("0.00");
    const [despues]=await holder.pool!.query("SELECT * FROM fact_pagos");expect(despues).toEqual(antes);
  });
  it("factura ajena bloqueada",async()=>{const f=await factura({empresa:8,entidad:11});await expect(confirmarIngresoBancario(actor,f,input())).rejects.toThrow("no encontrada");});
  it.each([2,3,4,5,6])("cuenta inválida %s bloqueada",async cuentaBancariaId=>{const f=await factura();await expect(confirmarIngresoBancario(actor,f,{...input(),cuentaBancariaId})).rejects.toThrow();});
  it("pago de otra factura/empresa bloqueado",async()=>{const f=await factura();await expect(confirmarIngresoBancario(actor,f,{...input(),pagoId:1})).rejects.toThrow("pago informado");});
  it.each([{pct:15},{retencion:"1"},{moneda:"USD"},{estado:"Borrador"},{estado:"Anulada"}])("restricción inicial %j",async delta=>{const f=await factura(delta);await expect(confirmarIngresoBancario(actor,f,input())).rejects.toThrow();});
  it("same key/same payload idempotente; diferente conflicto",async()=>{const f=await factura();const i=input("100");const a=await confirmarIngresoBancario(actor,f,i);expect(await confirmarIngresoBancario(actor,f,i)).toMatchObject({id:a.id,idempotente:true});await expect(confirmarIngresoBancario(actor,f,{...i,monto:"200"})).rejects.toThrow("idempotencia");});
  it("anular libera saldo, doble anulación sin segunda auditoría",async()=>{const f=await factura();const a=await confirmarIngresoBancario(actor,f,input());await anularConfirmacionBancaria(actor,f,a.id,"Error");expect(await anularConfirmacionBancaria(actor,f,a.id,"Otra razón")).toMatchObject({idempotente:true});const d=await listarConfirmacionesBancarias(7,f);expect(d.totalConfirmadoActivo).toBe("0.00");expect(d.confirmaciones[0].motivo_anulacion).toBe("Error");await expect(anularConfirmacionBancaria({...actor,empresaId:8},f,a.id,"Error")).rejects.toThrow();});
  it("concurrencia dos parciales exceden saldo: solo uno gana",async()=>{const f=await factura();const r=await Promise.allSettled([confirmarIngresoBancario(actor,f,input("7000")),confirmarIngresoBancario(actor,f,input("7000"))]);expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect((await listarConfirmacionesBancarias(7,f)).totalConfirmadoActivo).toBe("7000.00");});
  it("concurrencia same/same crea una fila",async()=>{const f=await factura();const i=input();const r=await Promise.all([confirmarIngresoBancario(actor,f,i),confirmarIngresoBancario(actor,f,i)]);expect(r[0].id).toBe(r[1].id);expect(r.filter(x=>x.idempotente)).toHaveLength(1);});
  it("concurrencia same/different da conflicto",async()=>{const f=await factura();const i=input("100");const r=await Promise.allSettled([confirmarIngresoBancario(actor,f,i),confirmarIngresoBancario(actor,f,{...i,monto:"200"})]);expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);});
  it("anulación concurrente una transición efectiva",async()=>{const f=await factura();const a=await confirmarIngresoBancario(actor,f,input());const r=await Promise.all([anularConfirmacionBancaria(actor,f,a.id,"A"),anularConfirmacionBancaria(actor,f,a.id,"B")]);expect(r.filter(x=>x.idempotente)).toHaveLength(1);});
  it("cambio de total bajo lock se observa antes de confirmar",async()=>{const f=await factura();const c=await holder.pool!.getConnection();try{await c.beginTransaction();await c.query("SELECT id FROM fact_facturas WHERE id=? FOR UPDATE",[f]);const pendiente=confirmarIngresoBancario(actor,f,input("7000"));await c.execute("UPDATE fact_facturas SET monto_total=5000 WHERE id=?",[f]);await c.commit();await expect(pendiente).rejects.toThrow("saldo");}finally{c.release();}});
  it("evidencia tenant-scoped y metadata sin ruta en listado",async()=>{const f=await factura();const a=await confirmarIngresoBancario(actor,f,input(),{ruta:"empresas/7/evidencias/fixture.pdf",nombre:"fixture.pdf",mime:"application/pdf",tamano:100,sha256:"a".repeat(64)});expect((await evidenciaConfirmacionBancaria(7,f,a.id)).evidencia_ruta).toContain("empresas/7/");await expect(evidenciaConfirmacionBancaria(8,f,a.id)).rejects.toThrow("no encontrada");expect((await listarConfirmacionesBancarias(7,f)).confirmaciones[0]).not.toHaveProperty("evidencia_ruta");});
  it("segunda migración NOOP conserva datos y cuenta de pagos",async()=>{const [antes]=await holder.pool!.query("SELECT * FROM fact_pago_confirmaciones ORDER BY id");const [p]=await holder.pool!.query("SELECT * FROM fact_pagos");await holder.pool!.query(readFileSync("sql/migrate-2026-10-confirmaciones-bancarias.sql","utf8"));const [despues]=await holder.pool!.query("SELECT * FROM fact_pago_confirmaciones ORDER BY id");expect(despues).toEqual(antes);expect((await holder.pool!.query("SELECT * FROM fact_pagos"))[0]).toEqual(p);});
  it.skipIf(!process.env.CONTA_B_TEST_PHP)("mysqli repetición sin resultados pendientes/#2014",()=>{
    const ddl=Buffer.from(readFileSync("sql/migrate-2026-10-confirmaciones-bancarias.sql","utf8")).toString("base64");
    const php=`mysqli_report(MYSQLI_REPORT_ERROR|MYSQLI_REPORT_STRICT);$c=new mysqli("127.0.0.1","root","","${database}",3407);$q=base64_decode("${ddl}");$c->query($q);if($c->more_results())throw new Exception("pendientes");$c->query($q);if($c->more_results())throw new Exception("pendientes");$r=$c->query("SELECT COUNT(*) AS n FROM fact_pago_confirmaciones");echo json_encode($r->fetch_assoc());$c->close();`;
    const result=JSON.parse(execFileSync(process.env.CONTA_B_TEST_PHP!,["-r",php],{encoding:"utf8"}));
    expect(Number(result.n)).toBeGreaterThan(0);
  });
});
