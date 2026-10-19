import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => state.pool,
  query: async (sql: string, params: (string | number | boolean | Date | null)[] = []) => (await state.pool!.query(sql, params))[0],
}));
import { anularFactura, listarFacturas, obtenerFactura, previsualizarFactura, registrarFactura } from "./facturas";
import { guardarConfigFiscal, listarProveedoresCxp, obtenerConfigFiscal } from "./proveedor-fiscal";

/**
 * CxP M-3A contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407): aplica la migración REAL sobre un esquema mínimo y ejecuta los servicios.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxp/cxp-m3a.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const db = `cxp_m3a_${randomUUID().replaceAll("-", "")}`;
const actor = { id: 91, username: "conta" };
let admin: mysql.Connection;
const q = async (s: string, p: unknown[] = []) => (await state.pool!.query<RowDataPacket[]>(s, p))[0];

function sentencias(texto: string) {
  let delimiter = ";", buffer = "";
  const out: string[] = [];
  for (const line of texto.split(/\r?\n/)) {
    const d = line.trim().match(/^DELIMITER (.+)$/);
    if (d) { delimiter = d[1]; continue; }
    buffer += `${line}\n`;
    if (line.trimEnd().endsWith(delimiter)) {
      const stmt = buffer.slice(0, buffer.lastIndexOf(delimiter)).trim();
      if (stmt.replace(/--[^\n]*/g, "").trim()) out.push(stmt);
      buffer = "";
    }
  }
  return out;
}
const base = { proveedorId: 3, serie: "A", numero: "100", fechaDocumento: "2026-11-02", fechaVencimiento: "2026-12-02", baseNeto: "10000.00", ivaMonto: "1200.00" };
const E1 = 5, E1B = 6;

describe.skipIf(!port)("CxP M-3A servicios / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    expect(String((await admin.query<RowDataPacket[]>("SELECT VERSION() v"))[0][0].v)).toContain("11.8.9");
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    state.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database: db, multipleStatements: true, connectionLimit: 8, dateStrings: true });
    await state.pool.query(`
      CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO usuarios VALUES(91);
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY,empresa_id INT NOT NULL,nombre_comercial VARCHAR(200) NOT NULL,nit VARCHAR(30) NULL,dias_credito INT NULL,activo TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_p(empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO compras_proveedores VALUES(3,1,'Repuestos Uno','111-1',30,1),(4,1,'Llantas Dos','222-2',NULL,1),(5,1,'Inactivo SA',NULL,NULL,0),(6,1,'No Sujeto SA','333-3',NULL,1),(9,2,'Proveedor de otra empresa',NULL,NULL,1);
      CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT NOT NULL,activa TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_e(empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO cont_entidades VALUES(5,1,1),(6,1,1),(7,2,1);
      CREATE TABLE cont_cuentas(id INT PRIMARY KEY,empresa_id INT NOT NULL,entidad_id INT NULL,codigo VARCHAR(40) NOT NULL,nombre VARCHAR(200) NOT NULL,tipo VARCHAR(40) NOT NULL,activa TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_c(empresa_id,entidad_id,id)) ENGINE=InnoDB;
      INSERT INTO cont_cuentas VALUES(10,1,5,'2.1.1','Proveedores','Pasivo',1),(11,1,5,'1.1.9','Anticipo proveedores','Activo',1),(12,1,5,'5.1.1','Gasto repuestos','Gasto',1),
        (13,1,5,'1.1.1','Caja','Activo',0),(20,1,6,'2.1.1','Proveedores B','Pasivo',1),(30,2,7,'2.1.1','Otra empresa','Pasivo',1);
      CREATE TABLE cont_cxp(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT NOT NULL,proveedor VARCHAR(200) NOT NULL,monto DECIMAL(14,2) NOT NULL,saldo DECIMAL(14,2) NOT NULL) ENGINE=InnoDB;
      INSERT INTO cont_cxp(empresa_id,proveedor,monto,saldo) VALUES(1,'LEGACY',100.00,100.00);
      CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;`);
    const c = await state.pool.getConnection();
    try { for (const s of sentencias(readFileSync("sql/migrate-2026-11-cxp-m3a-base.sql", "utf8"))) await c.query(s); } finally { c.release(); }
  }, 60000);
  afterAll(async () => {
    await state.pool?.end();
    if (admin) { if (!/^cxp_m3a_[a-f0-9]{32}$/.test(db)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${db}`); await admin.end(); }
  });

  describe("configuración fiscal del proveedor", () => {
    it("crea (régimen + ISR + cuentas válidas por tipo) y audita; el maestro de proveedores no cambia", async () => {
      const antes = await q("SELECT * FROM compras_proveedores ORDER BY id");
      const c = await guardarConfigFiscal(1, E1, 3, actor, { regimenFiscal: "GENERAL", sujetoIsr: true, cuentaProveedorId: 10, cuentaAnticipoId: 11, cuentaGastoId: 12 });
      expect(c).toMatchObject({ proveedorId: 3, entidadId: E1, regimenFiscal: "GENERAL", sujetoIsr: true, cuentaProveedorId: 10, cuentaAnticipoId: 11, cuentaGastoId: 12, activo: true });
      expect(await obtenerConfigFiscal(1, E1, 3)).toEqual(c);
      expect(await q("SELECT * FROM compras_proveedores ORDER BY id")).toEqual(antes);
      const aud = await q("SELECT * FROM auditoria WHERE accion='cxp_crear_config_proveedor'");
      expect(aud).toHaveLength(1); expect(JSON.parse(String(aud[0].detalle))).toMatchObject({ proveedorId: 3, usuarioId: 91, antes: null, despues: { regimenFiscal: "GENERAL" } });
    });
    it("rechaza: cuenta de tipo incorrecto, inactiva, de otra entidad/empresa, pequeño con ISR, proveedor ajeno, régimen inválido", async () => {
      const ok = { regimenFiscal: "GENERAL", sujetoIsr: false };
      await expect(guardarConfigFiscal(1, E1, 4, actor, { ...ok, cuentaProveedorId: 11 })).rejects.toMatchObject({ codigo: "CUENTA_TIPO_INVALIDO" });
      await expect(guardarConfigFiscal(1, E1, 4, actor, { ...ok, cuentaAnticipoId: 10 })).rejects.toMatchObject({ codigo: "CUENTA_TIPO_INVALIDO" });
      await expect(guardarConfigFiscal(1, E1, 4, actor, { ...ok, cuentaAnticipoId: 13 })).rejects.toMatchObject({ codigo: "CUENTA_INVALIDA" });
      await expect(guardarConfigFiscal(1, E1, 4, actor, { ...ok, cuentaProveedorId: 20 })).rejects.toMatchObject({ codigo: "CUENTA_INVALIDA" }); // cuenta de la entidad 6
      await expect(guardarConfigFiscal(1, E1, 4, actor, { ...ok, cuentaProveedorId: 30 })).rejects.toMatchObject({ codigo: "CUENTA_INVALIDA" }); // otra empresa
      await expect(guardarConfigFiscal(1, E1, 4, actor, { regimenFiscal: "PEQUENO_CONTRIBUYENTE", sujetoIsr: true })).rejects.toMatchObject({ codigo: "PEQUENO_SIN_RETENCION" });
      await expect(guardarConfigFiscal(1, E1, 9, actor, ok)).rejects.toMatchObject({ status: 404 }); // proveedor de la empresa 2
      await expect(guardarConfigFiscal(1, 7, 4, actor, ok)).rejects.toMatchObject({ status: 404 }); // entidad de la empresa 2
      await expect(guardarConfigFiscal(1, E1, 4, actor, { regimenFiscal: "X", sujetoIsr: false })).rejects.toMatchObject({ codigo: "REGIMEN_INVALIDO" });
      await expect(guardarConfigFiscal(1, E1, 4, actor, { regimenFiscal: "GENERAL" })).rejects.toMatchObject({ codigo: "SUJETO_ISR_REQUERIDO" });
      expect(await obtenerConfigFiscal(1, E1, 4)).toBeNull(); // nada se guardó
    });
    it("proveedor 4: pequeño contribuyente; proveedor 5 inactivo; entidad 6 para proveedor 3", async () => {
      await guardarConfigFiscal(1, E1, 4, actor, { regimenFiscal: "PEQUENO_CONTRIBUYENTE", sujetoIsr: false });
      await guardarConfigFiscal(1, E1, 5, actor, { regimenFiscal: "GENERAL", sujetoIsr: false });
      await guardarConfigFiscal(1, E1, 6, actor, { regimenFiscal: "GENERAL", sujetoIsr: false });
      await guardarConfigFiscal(1, E1B, 3, actor, { regimenFiscal: "GENERAL", sujetoIsr: false, cuentaProveedorId: 20 });
      const lista = await listarProveedoresCxp(1, E1);
      expect(lista.find(p => p.id === 3)?.fiscal).toMatchObject({ regimenFiscal: "GENERAL" });
      expect(lista.find(p => p.id === 9)).toBeUndefined(); // proveedor de otra empresa
      expect((await listarProveedoresCxp(1, E1B)).find(p => p.id === 4)?.fiscal).toBeNull();
    });
    it("actualizar conserva creador y audita antes/después", async () => {
      await guardarConfigFiscal(1, E1, 4, actor, { regimenFiscal: "PEQUENO_CONTRIBUYENTE", sujetoIsr: false, cuentaGastoId: 12 });
      const aud = await q("SELECT * FROM auditoria WHERE accion='cxp_actualizar_config_proveedor'");
      expect(JSON.parse(String(aud[0].detalle))).toMatchObject({ antes: { cuentaGastoId: null }, despues: { cuentaGastoId: 12 } });
    });
  });

  describe("factura de proveedor", () => {
    it("sin configuración fiscal para la entidad: 409 y no escribe", async () => {
      await expect(registrarFactura(1, E1B, actor, { ...base, proveedorId: 4 })).rejects.toMatchObject({ status: 409, codigo: "PROVEEDOR_SIN_CONFIG_FISCAL" });
      expect(await q("SELECT COUNT(*) n FROM cxp_facturas").then(r => r[0].n)).toBe(0);
    });
    it("sujeto a ISR: total, ISR 5 % sobre la base, neto a pagar y saldo derivado; auditada", async () => {
      const { factura, advertencias } = await registrarFactura(1, E1, actor, base);
      expect(advertencias).toEqual([]);
      expect(factura).toMatchObject({
        proveedorNombre: "Repuestos Uno", tipoDocumento: "FACTURA", baseNeto: "10000.00", ivaMonto: "1200.00", totalDocumento: "11200.00", isrPorcentaje: "5.00", isrMonto: "500.00",
        totalNetoPagar: "10700.00", estadoAdmin: "REGISTRADA", regimenFiscal: "GENERAL", sujetoIsr: true,
        reglaIsr: "M3B1_V1:TRAMO_5_PCT", fechaVencimiento: "2026-12-02", creadoPor: 91,
      });
      const aud = await q("SELECT * FROM auditoria WHERE accion='cxp_registrar_factura'");
      expect(JSON.parse(String(aud[0].detalle))).toMatchObject({ facturaId: factura.id, isr: "500.00", neto: "10700.00", usuarioId: 91, entidadId: E1 });
      expect((await q("SELECT saldo, monto FROM cont_cxp"))[0]).toMatchObject({ saldo: "100.00", monto: "100.00" }); // legacy intacto
    });
    it("el servidor ignora cálculos del cliente (los campos calculados ni se aceptan)", async () => {
      const { factura } = await registrarFactura(1, E1, actor, { ...base, numero: "101", isrMonto: "0.00", totalNetoPagar: "1.00", estadoAdmin: "ANULADA", empresaId: 2 } as never);
      expect(factura).toMatchObject({ isrMonto: "500.00", totalNetoPagar: "10700.00", estadoAdmin: "REGISTRADA", empresaId: 1 });
    });
    it("pequeño contribuyente: sin ISR (aun bajo Q2,800); no sujeto: sin ISR", async () => {
      expect((await registrarFactura(1, E1, actor, { ...base, proveedorId: 4, numero: "1", baseNeto: "50000.00", ivaMonto: "0.00" })).factura)
        .toMatchObject({ isrMonto: "0.00", totalNetoPagar: "50000.00", reglaIsr: "M3B1_V1:PEQUENO_CONTRIBUYENTE_SIN_RETENCION" });
      expect((await registrarFactura(1, E1, actor, { ...base, proveedorId: 4, numero: "2", baseNeto: "100.00", ivaMonto: "12.00" })).factura).toMatchObject({ isrMonto: "0.00" });
      expect((await registrarFactura(1, E1, actor, { ...base, proveedorId: 6, numero: "1" })).factura).toMatchObject({ isrMonto: "0.00", reglaIsr: "M3B1_V1:NO_SUJETO_ISR" });
    });
    it("advierte si el IVA no es el 12 % (sin bloquear)", async () => {
      const r = await registrarFactura(1, E1, actor, { ...base, numero: "103", baseNeto: "3000.00", ivaMonto: "100.00" });
      expect(r.advertencias).toHaveLength(1);
    });
    it("sujeto a ISR: fracción de centavo (redondeo NO confirmado) se BLOQUEA (422), sin escribir", async () => {
      const antes = await q("SELECT COUNT(*) n FROM cxp_facturas").then(r => r[0].n);
      for (const b of ["2800.10", "3333.33", "29999.99", "30000.01"]) {
        await expect(registrarFactura(1, E1, actor, { ...base, numero: `blk-${b}`, baseNeto: b, ivaMonto: "0.00" })).rejects.toMatchObject({ status: 422, codigo: "REGLA_ISR_PENDIENTE", message: expect.stringMatching(/redondeo/) });
      }
      expect(await q("SELECT COUNT(*) n FROM cxp_facturas").then(r => r[0].n)).toBe(antes);
    });
    it("sujeto a ISR: neto < Q2,800 → ISR Q0.00 (se paga todo); Q2,800.00 → 5 %; Q30,000.00 → Q1,500.00; ejemplo Q31,250 → Q1,587.50 / pagadero Q33,412.50", async () => {
      expect((await registrarFactura(1, E1, actor, { ...base, numero: "T-0", baseNeto: "2799.99", ivaMonto: "336.00" })).factura)
        .toMatchObject({ isrMonto: "0.00", isrPorcentaje: "0.00", totalNetoPagar: "3135.99", reglaIsr: "M3B1_V1:BAJO_MINIMO_SIN_RETENCION" });
      expect((await registrarFactura(1, E1, actor, { ...base, numero: "T-1", baseNeto: "2800.00", ivaMonto: "336.00" })).factura).toMatchObject({ isrMonto: "140.00", isrPorcentaje: "5.00" });
      expect((await registrarFactura(1, E1, actor, { ...base, numero: "T-2", baseNeto: "30000.00", ivaMonto: "3600.00" })).factura)
        .toMatchObject({ isrMonto: "1500.00", isrPorcentaje: "7.00", reglaIsr: "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE", totalNetoPagar: "32100.00" });
      const { factura } = await registrarFactura(1, E1, actor, { ...base, numero: "T-3", baseNeto: "31250.00", ivaMonto: "3750.00" });
      expect(factura).toMatchObject({ totalDocumento: "35000.00", isrMonto: "1587.50", retencionIsr: "1587.50", montoPagadero: "33412.50", totalNetoPagar: "33412.50", pagado: "0.00", saldo: "33412.50", estadoFinanciero: "PENDIENTE" });
      expect(JSON.parse(String((await q("SELECT detalle FROM auditoria WHERE accion='cxp_registrar_factura' ORDER BY id DESC LIMIT 1"))[0].detalle))).toMatchObject({ iva: "3750.00", isr: "1587.50", neto: "33412.50" });
    });
    it("factura especial: 422 pendiente de reglas", async () => {
      await expect(registrarFactura(1, E1, actor, { ...base, numero: "fe", tipoDocumento: "FACTURA_ESPECIAL" })).rejects.toMatchObject({ status: 422, codigo: "FACTURA_ESPECIAL_PENDIENTE" });
    });
    it("proveedor inactivo y entrada inválida", async () => {
      await db_inactivar(5);
      await expect(registrarFactura(1, E1, actor, { ...base, proveedorId: 5, numero: "9" })).rejects.toMatchObject({ codigo: "PROVEEDOR_INACTIVO" });
      await expect(registrarFactura(1, E1, actor, { ...base, numero: "x1", baseNeto: "10.123" })).rejects.toMatchObject({ status: 400 });
      await expect(registrarFactura(1, E1, actor, { ...base, numero: " " })).rejects.toMatchObject({ codigo: "NUMERO_OBLIGATORIO" });
      await expect(registrarFactura(1, E1, actor, { ...base, numero: "x2", fechaVencimiento: "2026-10-01" })).rejects.toMatchObject({ codigo: "VENCIMIENTO_INVALIDO" });
      await expect(registrarFactura(1, E1, actor, { ...base, numero: "x3", fechaDocumento: "2026-02-30" })).rejects.toMatchObject({ codigo: "FECHA_INVALIDA" });
    });
    it("anti-duplicado empresa+proveedor+serie+número (sin entidad): variantes de formato chocan; otro proveedor/serie/ceros no", async () => {
      await expect(registrarFactura(1, E1, actor, { ...base, serie: " a ", numero: "100" })).rejects.toMatchObject({ status: 409, codigo: "FACTURA_DUPLICADA" });
      await expect(registrarFactura(1, E1B, actor, { ...base })).rejects.toMatchObject({ codigo: "FACTURA_DUPLICADA" }); // misma factura en OTRA entidad de la misma empresa
      expect((await registrarFactura(1, E1, actor, { ...base, serie: "B" })).factura.id).toBeGreaterThan(0);
      expect((await registrarFactura(1, E1, actor, { ...base, numero: "0100" })).factura.id).toBeGreaterThan(0);
      expect((await registrarFactura(1, E1, actor, { ...base, proveedorId: 4, baseNeto: "500.00", ivaMonto: "60.00" })).factura.id).toBeGreaterThan(0);
    });
    it("concurrencia: dos registros simultáneos del mismo documento → uno gana, el otro 409 (nunca 500)", async () => {
      const res = await Promise.allSettled([1, 2, 3].map(() => registrarFactura(1, E1, actor, { ...base, numero: "CONC-1" })));
      expect(res.filter(r => r.status === "fulfilled")).toHaveLength(1);
      for (const r of res.filter(r => r.status === "rejected") as PromiseRejectedResult[]) expect(r.reason).toMatchObject({ status: 409 });
      expect(await q("SELECT COUNT(*) n FROM cxp_facturas WHERE numero='CONC-1'").then(r => r[0].n)).toBe(1);
    });
    it("cambiar la configuración fiscal NO altera facturas ya registradas (fotografía)", async () => {
      const { factura } = await registrarFactura(1, E1, actor, { ...base, numero: "SNAP-1" });
      await guardarConfigFiscal(1, E1, 3, actor, { regimenFiscal: "PEQUENO_CONTRIBUYENTE", sujetoIsr: false, cuentaProveedorId: 10, cuentaAnticipoId: 11, cuentaGastoId: 12 });
      expect(await obtenerFactura(1, E1, factura.id)).toMatchObject({ isrMonto: "500.00", regimenFiscal: "GENERAL", sujetoIsr: true });
      await expect(registrarFactura(1, E1, actor, { ...base, numero: "SNAP-2", baseNeto: "10000.00" })).resolves.toMatchObject({ factura: { isrMonto: "0.00", regimenFiscal: "PEQUENO_CONTRIBUYENTE" } });
      await guardarConfigFiscal(1, E1, 3, actor, { regimenFiscal: "GENERAL", sujetoIsr: true, cuentaProveedorId: 10, cuentaAnticipoId: 11, cuentaGastoId: 12 });
    });
    it("sin las tablas de pagos (M-3B1 sin aplicar) el listado funciona: pagado 0 y saldo = monto pagadero", async () => {
      const f = (await listarFacturas(1, E1, { pageSize: 1 })).facturas[0];
      expect(f).toMatchObject({ pagado: "0.00", estadoFinanciero: expect.stringMatching(/PENDIENTE|ANULADA/) });
      if (f.estadoAdmin === "REGISTRADA") expect(f.saldo).toBe(f.montoPagadero);
      expect(f).toHaveProperty("totalDocumento"); expect(f).toHaveProperty("totalNetoPagar"); expect(f).toHaveProperty("isrMonto"); expect(f).toHaveProperty("retencionIsr");
    });
    it("previsualizar calcula sin escribir", async () => {
      const antes = await q("SELECT COUNT(*) n FROM cxp_facturas").then(r => r[0].n);
      expect(await previsualizarFactura(1, E1, { ...base })).toMatchObject({ isrMonto: "500.00", totalNetoPagar: "10700.00", proveedorNombre: "Repuestos Uno" });
      expect(await q("SELECT COUNT(*) n FROM cxp_facturas").then(r => r[0].n)).toBe(antes);
    });
  });

  describe("aislamiento por empresa/entidad", () => {
    it("otra empresa/entidad no ve ni anula la factura", async () => {
      const id = Number((await q("SELECT id FROM cxp_facturas WHERE numero='100' AND serie='A' LIMIT 1"))[0].id);
      expect(await obtenerFactura(2, 7, id)).toBeNull();
      expect(await obtenerFactura(1, E1B, id)).toBeNull(); // misma empresa, otra entidad
      await expect(anularFactura(2, 7, id, { id: 91, username: "x" }, "intento ajeno")).rejects.toMatchObject({ status: 404 });
      await expect(anularFactura(1, E1B, id, actor, "otra entidad")).rejects.toMatchObject({ status: 404 });
      expect((await listarFacturas(2, 7)).total).toBe(0);
      await expect(registrarFactura(2, 7, actor, { ...base, proveedorId: 3 })).rejects.toMatchObject({ status: 409 }); // proveedor 3 es de la empresa 1: sin config en 2/7
      expect(await q("SELECT estado_admin FROM cxp_facturas WHERE id=?", [id]).then(r => r[0].estado_admin)).toBe("REGISTRADA");
    });
  });

  describe("anulación y listado", () => {
    it("exige motivo; anula con auditoría y estado ANULADA; la clave de documento NO se libera", async () => {
      const { factura } = await registrarFactura(1, E1, actor, { ...base, numero: "ANU-1" });
      await expect(anularFactura(1, E1, factura.id, actor, " ")).rejects.toMatchObject({ codigo: "MOTIVO_REQUERIDO" });
      const a = await anularFactura(1, E1, factura.id, actor, "Capturada por error");
      expect(a).toMatchObject({ estadoAdmin: "ANULADA", motivoAnulacion: "Capturada por error", anuladoPor: 91 });
      await expect(anularFactura(1, E1, factura.id, actor, "otra vez")).rejects.toMatchObject({ status: 409, codigo: "YA_ANULADA" });
      const aud = await q("SELECT * FROM auditoria WHERE accion='cxp_anular_factura'");
      expect(JSON.parse(String(aud.at(-1)!.detalle))).toMatchObject({ facturaId: factura.id, motivo: "Capturada por error", despues: "ANULADA" });
      // La anulada NO libera su serie+número (regla confirmada): sigue reservado y el mensaje lo dice.
      await expect(registrarFactura(1, E1, actor, { ...base, numero: "ANU-1" })).rejects.toMatchObject({ status: 409, codigo: "FACTURA_DUPLICADA", message: expect.stringContaining("ANULADA") });
      await expect(registrarFactura(1, E1B, actor, { ...base, numero: "ANU-1" })).rejects.toMatchObject({ codigo: "FACTURA_DUPLICADA" });
    });
    it("anular dos veces en paralelo: una sola gana", async () => {
      const { factura } = await registrarFactura(1, E1, actor, { ...base, numero: "ANU-2" });
      const res = await Promise.allSettled([anularFactura(1, E1, factura.id, actor, "motivo uno"), anularFactura(1, E1, factura.id, actor, "motivo dos")]);
      expect(res.filter(r => r.status === "fulfilled")).toHaveLength(1);
    });
    it("lista con filtros y paginación", async () => {
      const todas = await listarFacturas(1, E1, { pageSize: 5 });
      expect(todas.facturas).toHaveLength(5); expect(todas.total).toBeGreaterThan(5);
      const anuladas = await listarFacturas(1, E1, { estado: "ANULADA" });
      expect(anuladas.facturas.every(f => f.estadoAdmin === "ANULADA")).toBe(true);
      expect((await listarFacturas(1, E1, { proveedorId: 4 })).facturas.every(f => f.proveedorId === 4)).toBe(true);
      expect((await listarFacturas(1, E1, { q: "ANU-1" })).total).toBe(1);
      expect((await listarFacturas(1, E1, { desde: "2030-01-01" })).total).toBe(0);
    });
    it("cont_cxp (histórico) sigue exactamente igual", async () => {
      expect(await q("SELECT empresa_id, proveedor, monto, saldo FROM cont_cxp")).toEqual([{ empresa_id: 1, proveedor: "LEGACY", monto: "100.00", saldo: "100.00" }]);
    });
  });
});

async function db_inactivar(id: number) { await state.pool!.query("UPDATE compras_proveedores SET activo = 0 WHERE id = ?", [id]); }
