import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(()=>({pool:null as Pool|null}));
vi.mock('@/lib/db',()=>({getPool:()=>{if(!state.pool)throw Error('Pool normal prohibido');return state.pool;},query:async(s:string,p:unknown[]=[])=>{if(!state.pool)throw Error('Pool normal prohibido');return (await state.pool.query(s,p))[0];}}));
vi.mock('@/lib/clientes/repository',()=>({asegurarVinculosTmsClientes:()=>{throw Error('No inicializar clientes');}}));
vi.mock('@/lib/clientes/schema',()=>({asegurarSchemaClientes:()=>{throw Error('No inicializar clientes');}}));
import { guardarPerfilCredito, leerVencimiento, previsualizarVencimiento } from './credito';
import { emitirFactura } from './facturas';
const manifest=process.env.MIL04A_LAB_MANIFEST;
const actor={empresaId:7,usuarioId:3,usuario:'qa-sintetico'};
describe.skipIf(!manifest).sequential('MIL04A MariaDB exclusivamente datadir temporal / pipe sin TCP',{timeout:30000},()=>{
  let pool: Pool;
  async function query(s:string,p:unknown[]=[]){return pool.query<RowDataPacket[]>(s,p);}
  async function script(file:string){
    // Archivos generados del ticket, delimitador por línea; no acepta rutas de entrada externas.
    let delimiter=';',buffer='';
    for(const line of fs.readFileSync(path.join(process.cwd(),'sql/mil-imp04a',file),'utf8').split('\n')){
      if(line.startsWith('DELIMITER ')){delimiter=line.slice(10).trim();continue;}
      buffer+=line+'\n';
      if(line.trimEnd().endsWith(delimiter)){const sql=buffer.trimEnd().slice(0,-delimiter.length);await pool.query(sql);buffer='';}
    }
    if(buffer.trim())throw Error('SQL incompleto');
  }
  async function estado(){const [r]=await query(fs.readFileSync('sql/mil-imp04a/preflight.sql','utf8'));return r[0].estado;}
  beforeAll(async()=>{
    const file=path.resolve(manifest!);const m=JSON.parse(fs.readFileSync(file,'utf8'));
    if(path.dirname(m.dir)!==os.tmpdir()||!path.basename(m.dir).startsWith('mil04a-')||file!==path.join(m.dir,'manifest.json')||m.datadir!==path.join(m.dir,'data')||!/^mil04a_[a-f0-9]{32}$/.test(m.database)||m.pipe!==m.database.replace('_','-'))throw Error('Manifiesto inválido');
    pool=mysql.createPool({socketPath:`\\\\.\\pipe\\${m.pipe}`,user:'root',password:'',database:m.database,connectionLimit:5,multipleStatements:false,connectTimeout:3000});
    const [identity]=await pool.query<RowDataPacket[]>('SELECT @@datadir d,@@socket s,@@skip_networking n,DATABASE() db');
    if(path.resolve(identity[0].d)!==m.datadir||identity[0].s!==m.pipe||Number(identity[0].n)!==1||identity[0].db!==m.database)throw Error('Identidad inválida');
    state.pool=pool;
    for(const sql of [
      'CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB',
      'CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB',
      'CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT NOT NULL,activa INT NOT NULL,UNIQUE KEY uq(empresa_id,id)) ENGINE=InnoDB',
      'CREATE TABLE clientes(id INT PRIMARY KEY,empresa_id INT NOT NULL) ENGINE=InnoDB',
      `CREATE TABLE fact_facturas(id INT PRIMARY KEY,empresa_id INT NOT NULL,cliente_id INT NOT NULL,entidad_id INT NULL,condicion_pago VARCHAR(10),estado_admin VARCHAR(15),numero_factura VARCHAR(60),fecha_emision DATE,monto_total DECIMAL(14,2),actualizado_por INT,actualizado_en DATETIME,retencion_iva_pct DECIMAL(5,2),retencion_iva_monto DECIMAL(14,2),UNIQUE KEY uq(empresa_id,numero_factura)) ENGINE=InnoDB`,
      'CREATE TABLE tms_planes_viaje(id INT PRIMARY KEY,codigo VARCHAR(40),estado VARCHAR(20)) ENGINE=InnoDB',
      'CREATE TABLE fact_factura_viajes(factura_id INT,plan_id INT) ENGINE=InnoDB',
      'CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT,usuario VARCHAR(100),accion VARCHAR(100),modulo VARCHAR(100),detalle TEXT) ENGINE=InnoDB',
      'INSERT INTO empresas VALUES (7),(8)', 'INSERT INTO usuarios VALUES (3)',
      'INSERT INTO cont_entidades VALUES (9,7,1),(10,7,1),(11,8,1)', 'INSERT INTO clientes VALUES (20,7),(21,8)',
      "INSERT INTO fact_facturas(id,empresa_id,cliente_id,entidad_id,condicion_pago,estado_admin,numero_factura,fecha_emision,monto_total) VALUES (100,7,20,9,'CREDITO','Emitida','HISTORICA','2026-01-01','1000.00')",
    ])await pool.query(sql);
  });
  afterAll(async()=>{state.pool=null;await pool?.end();});
  it('migración CLEAN→FINAL, reaplicación sin datos ni cambios; DIVERGENTE no ejecuta DDL',async()=>{
    expect(await estado()).toBe('CLEAN');await script('migrate.sql');
    expect(await leerVencimiento(7,100)).toBeNull(); // Ningún backfill de emitidas históricas.
    expect(await estado()).toBe('FINAL');await script('migrate.sql');expect(await estado()).toBe('FINAL');
    await pool.query('ALTER TABLE fact_credito_perfiles ADD COLUMN ajena INT NULL');expect(await estado()).toBe('DIVERGENTE');
    await expect(script('migrate.sql')).rejects.toThrow('DIVERGENTE');
    await pool.query('ALTER TABLE fact_credito_perfiles DROP COLUMN ajena');expect(await estado()).toBe('FINAL');
  });
  async function factura(n:number,condicion='CREDITO',entidad:number|null=9){
    await pool.execute("INSERT INTO fact_facturas(id,empresa_id,cliente_id,entidad_id,condicion_pago,estado_admin,numero_factura,fecha_emision,monto_total) VALUES (?,7,20,?,?,'Borrador',?,'2026-07-15','999999999999.99')",[n,entidad,condicion,`QA-${n}`]);
    await pool.execute("INSERT INTO tms_planes_viaje VALUES (?,?,'Cerrado')",[n,`V-${n}`]);await pool.execute('INSERT INTO fact_factura_viajes VALUES (?,?)',[n,n]);
  }
  it('crédito sin perfil aprobado; ámbito empresa/entidad rechazado; legado no se inventa',async()=>{
    await factura(1);await expect(previsualizarVencimiento(actor,1,'2026-07-15')).rejects.toThrow('sin plazo explícito');
    await expect(guardarPerfilCredito(actor,11,20,{dias:30,aprobada:true,revision:0,motivo:'Prueba autorizada'})).rejects.toThrow('ámbito');
    await expect(guardarPerfilCredito(actor,9,21,{dias:30,aprobada:true,revision:0,motivo:'Prueba autorizada'})).rejects.toThrow('ámbito');
    expect(await leerVencimiento(7,1)).toBeNull();
    await factura(2,'CREDITO',null);const p=await previsualizarVencimiento(actor,2,'2026-07-15');expect(p.certificado).toBe(false);
    expect(await emitirFactura(actor,2,{})).toEqual({ok:true});expect(await leerVencimiento(7,2)).toBeNull();
  });
  it('perfil cambia 30→60 entre preview/emisión: reconfirmación, snapshot congelado y original monetario intacto',async()=>{
    await guardarPerfilCredito(actor,9,20,{dias:30,aprobada:true,revision:0,motivo:'Plazo aprobado inicial'});
    const old=await previsualizarVencimiento(actor,1,'2026-07-15');
    await guardarPerfilCredito(actor,9,20,{dias:60,aprobada:true,revision:1,motivo:'Cambio de plazo aprobado'});
    await expect(emitirFactura(actor,1,{vencimientoToken:old.token})).rejects.toThrow('confirma');expect(await leerVencimiento(7,1)).toBeNull();
    const nuevo=await previsualizarVencimiento(actor,1,'2026-07-15');
    expect(await emitirFactura(actor,1,{vencimientoToken:nuevo.token})).toEqual({ok:true});
    const snap=await leerVencimiento(7,1);expect(snap?.dias).toBe(60);expect(snap?.vencimiento).toBe('2026-09-13');
    await guardarPerfilCredito(actor,9,20,{dias:30,aprobada:true,revision:2,motivo:'Restaurar plazo aprobado'});
    expect(await leerVencimiento(7,1)).toEqual(snap);
    const [f]=await query('SELECT monto_total FROM fact_facturas WHERE id=1');expect(f[0].monto_total).toBe('999999999999.99');
    await expect(pool.query('UPDATE fact_vencimientos SET dias=1 WHERE factura_id=1')).rejects.toThrow('inmutable');
    await expect(pool.query('DELETE FROM fact_vencimientos WHERE factura_id=1')).rejects.toThrow('inmutable');
  });
  it('contado mismo día, token alterado rechazado, dos conexiones emiten una sola vez',async()=>{
    await factura(3,'CONTADO');const p=await previsualizarVencimiento(actor,3,'2026-07-15');
    await expect(emitirFactura(actor,3,{vencimientoToken:p.token.slice(0,-1)+'x'})).rejects.toThrow('confirma');
    const results=await Promise.all([emitirFactura(actor,3,{vencimientoToken:p.token}),emitirFactura(actor,3,{vencimientoToken:p.token})]);
    expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>!r.ok)).toHaveLength(1);
    expect((await leerVencimiento(7,3))?.vencimiento).toBe('2026-07-15');
    const [r]=await query('SELECT COUNT(*) n FROM fact_vencimientos WHERE factura_id=3');expect(Number(r[0].n)).toBe(1);
  });
  it('emite a 30 días y el cambio posterior a 60 no altera snapshot; rechaza plazo y cruces por FK',async()=>{
    await factura(5);
    const p=await previsualizarVencimiento(actor,5,'2026-07-15');
    await emitirFactura(actor,5,{vencimientoToken:p.token});
    expect((await leerVencimiento(7,5))?.vencimiento).toBe('2026-08-14');
    await guardarPerfilCredito(actor,9,20,{dias:60,aprobada:true,revision:3,motivo:'Cambio posterior autorizado'});
    expect((await leerVencimiento(7,5))?.vencimiento).toBe('2026-08-14');
    await expect(guardarPerfilCredito(actor,9,20,{dias:366,aprobada:true,revision:4,motivo:'Plazo fuera de rango'})).rejects.toThrow('inválido');
    await expect(previsualizarVencimiento({...actor,empresaId:8},5,'2026-07-15')).rejects.toThrow('no encontrada');
    await expect(pool.query('INSERT INTO fact_credito_perfiles VALUES (7,9,21,30,1,1,3,NOW())')).rejects.toThrow();
  });
  it('error al guardar snapshot revierte emisión y auditoría; no queda snapshot',async()=>{
    await factura(4,'CONTADO');const p=await previsualizarVencimiento(actor,4,'2026-07-15');
    await pool.query("CREATE TRIGGER qa_fallo BEFORE INSERT ON fact_vencimientos FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo QA snapshot'");
    try{await expect(emitirFactura(actor,4,{vencimientoToken:p.token})).rejects.toThrow('Fallo QA');}
    finally{await pool.query('DROP TRIGGER qa_fallo');}
    expect(await leerVencimiento(7,4)).toBeNull();const [f]=await query('SELECT estado_admin FROM fact_facturas WHERE id=4');expect(f[0].estado_admin).toBe('Borrador');
    const [a]=await query("SELECT COUNT(*) n FROM auditoria WHERE detalle LIKE '%\"facturaId\":4%' OR detalle LIKE 'Factura #4 %'");expect(Number(a[0].n)).toBe(0);
  });
  it('fallo de auditoría posterior al UPDATE revierte tanto factura como snapshot insertado',async()=>{
    await factura(6,'CONTADO');const p=await previsualizarVencimiento(actor,6,'2026-07-15');
    await pool.query("CREATE TRIGGER qa_auditoria BEFORE INSERT ON auditoria FOR EACH ROW BEGIN IF NEW.accion='emitir_factura' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo QA auditoria final'; END IF; END");
    try { await expect(emitirFactura(actor,6,{vencimientoToken:p.token})).rejects.toThrow('Fallo QA auditoria'); }
    finally { await pool.query('DROP TRIGGER qa_auditoria'); }
    expect(await leerVencimiento(7,6)).toBeNull();
    const [f]=await query('SELECT estado_admin FROM fact_facturas WHERE id=6');expect(f[0].estado_admin).toBe('Borrador');
  });
});
