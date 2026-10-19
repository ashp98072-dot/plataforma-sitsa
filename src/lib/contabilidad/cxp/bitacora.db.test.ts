import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => state.pool,
  query: async (sql: string, params: (string | number | boolean | Date | null)[] = []) => (await state.pool!.query(sql, params))[0],
}));
import { anularFactura, registrarFactura } from "./facturas";
import { guardarConfigFiscal } from "./proveedor-fiscal";
import { registrarPago, reversarPago } from "./pagos";
import { listarBitacoraCxp } from "./bitacora";

/**
 * Bitácora de CxP contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407): migraciones REALES M-3A y M-3B1 y los servicios REALES.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxp/bitacora.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const db = `cxp_bit_${randomUUID().replaceAll("-", "")}`;
const conta = { id: 91, username: "conta" }, otro = { id: 92, username: "tesoreria" };
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
async function ejecutarArchivo(archivo: string) {
  const c = await state.pool!.getConnection();
  try { for (const s of sentencias(readFileSync(`sql/${archivo}`, "utf8"))) await c.query(s); } finally { c.release(); }
}
const E1 = 5, E1B = 6, E2 = 7;
const fac = { proveedorId: 3, serie: "A", fechaDocumento: "2026-11-02", fechaVencimiento: "2026-12-02" };
let n = 0;
const pago = (over: Record<string, unknown>) => ({ proveedorId: 3, fechaPago: "2026-11-10", medioPago: "Transferencia", referencia: "TR-1", claveIdempotencia: `k-${++n}-${randomUUID().slice(0, 8)}`, ...over });

describe.skipIf(!port)("Bitácora de CxP / MariaDB 11.8.9 SOLO LOCAL", { timeout: 60000 }, () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    expect(String((await admin.query<RowDataPacket[]>("SELECT VERSION() v"))[0][0].v)).toContain("11.8.9");
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    state.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database: db, multipleStatements: true, connectionLimit: 12, dateStrings: true });
    await state.pool.query(`
      CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO usuarios VALUES(91),(92);
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY,empresa_id INT NOT NULL,nombre_comercial VARCHAR(200) NOT NULL,nit VARCHAR(30) NULL,dias_credito INT NULL,activo TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_p(empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO compras_proveedores VALUES(3,1,'Repuestos Uno','111-1',30,1),(9,2,'Proveedor de otra empresa',NULL,NULL,1);
      CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT NOT NULL,activa TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_e(empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO cont_entidades VALUES(5,1,1),(6,1,1),(7,2,1);
      CREATE TABLE cont_cuentas(id INT PRIMARY KEY,empresa_id INT NOT NULL,entidad_id INT NULL,codigo VARCHAR(40) NOT NULL,nombre VARCHAR(200) NOT NULL,tipo VARCHAR(40) NOT NULL,activa TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_c(empresa_id,entidad_id,id)) ENGINE=InnoDB;
      CREATE TABLE cont_cxp(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT NOT NULL,proveedor VARCHAR(200) NOT NULL,monto DECIMAL(14,2) NOT NULL,saldo DECIMAL(14,2) NOT NULL) ENGINE=InnoDB;
      CREATE TABLE auditoria(id BIGINT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NULL, usuario VARCHAR(100) NULL, accion VARCHAR(80) NOT NULL, modulo VARCHAR(40) NULL, detalle TEXT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_aud_empresa (empresa_id)) ENGINE=InnoDB;`);
    await ejecutarArchivo("migrate-2026-11-cxp-m3a-base.sql");
    await ejecutarArchivo("migrate-2026-11-cxp-m3b1-pagos.sql");
  }, 90000);
  afterAll(async () => {
    await state.pool?.end();
    if (admin) { if (!/^cxp_bit_[a-f0-9]{32}$/.test(db)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${db}`); await admin.end(); }
  });

  it("ciclo completo con actores distintos: configuración → factura → pago → reversión → anulación, en orden y con todos los datos", async () => {
    await guardarConfigFiscal(1, E1, 3, conta, { regimenFiscal: "GENERAL", sujetoIsr: false });
    await guardarConfigFiscal(1, E1, 3, conta, { regimenFiscal: "GENERAL", sujetoIsr: true });
    const { factura } = await registrarFactura(1, E1, conta, { ...fac, numero: "100", baseNeto: "10000.00", ivaMonto: "1200.00" });
    const { pago: p } = await registrarPago(1, E1, otro, pago({ aplicaciones: [{ facturaId: factura.id, monto: "5000.00" }], referencia: "CH-77" }));
    await reversarPago(1, E1, p.id, otro, "Cheque rebotado");
    await anularFactura(1, E1, factura.id, conta, "Capturada por error");

    const r = await listarBitacoraCxp(1, E1);
    expect(r.totalReal).toBe(6);
    expect(r.eventos.map((e) => e.accion)).toEqual(["cxp_anular_factura", "cxp_reversar_pago", "cxp_registrar_pago", "cxp_registrar_factura", "cxp_actualizar_config_proveedor", "cxp_crear_config_proveedor"]);
    const [anular, reversar, regPago, regFactura, actualizar] = r.eventos;
    expect(anular).toMatchObject({ usuario: "conta", usuarioId: 91, proveedor: "Repuestos Uno", documento: "A-100", motivo: "Capturada por error" });
    expect(anular.resumen).toContain("Anuló factura A-100 · Repuestos Uno");
    expect(reversar).toMatchObject({ usuario: "tesoreria", usuarioId: 92, motivo: "Cheque rebotado", monto: "5000.00" });
    expect(reversar.resumen).toBe(`Reversó pago #${p.id} · Repuestos Uno · Q5,000.00 · Transferencia · Ref. CH-77 · Facturas: A-100 · Motivo: Cheque rebotado`);
    expect(regPago.resumen).toBe(`Registró pago #${p.id} · Repuestos Uno · Q5,000.00 · Transferencia · Ref. CH-77 · Facturas: A-100`);
    expect(regFactura).toMatchObject({ documento: "A-100", monto: "11200.00", proveedor: "Repuestos Uno" });
    expect(actualizar.cambios).toEqual([{ campo: "Sujeto a ISR", antes: "No", despues: "Sí" }]);
    for (const e of r.eventos) expect(e.fecha).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("filtros: acción, usuario, fechas y paginación", async () => {
    expect((await listarBitacoraCxp(1, E1, { accion: "cxp_registrar_pago" })).eventos).toHaveLength(1);
    expect((await listarBitacoraCxp(1, E1, { usuario: "tesoreria" })).totalReal).toBe(2);
    expect((await listarBitacoraCxp(1, E1, { fechaDesde: "2999-01-01" })).totalReal).toBe(0);
    expect((await listarBitacoraCxp(1, E1, { fechaDesde: "2000-01-01", fechaHasta: "2999-12-31" })).totalReal).toBe(6);
    const pag = await listarBitacoraCxp(1, E1, { pageSize: 4, page: 2 });
    expect(pag.eventos).toHaveLength(2);
    expect(pag.totalReal).toBe(6);
  });

  it("aislamiento: otro libro de la misma empresa y otra empresa NO ven estos eventos (ni al revés)", async () => {
    await guardarConfigFiscal(1, E1B, 3, conta, { regimenFiscal: "GENERAL", sujetoIsr: false });
    await guardarConfigFiscal(2, E2, 9, otro, { regimenFiscal: "GENERAL", sujetoIsr: true });
    expect((await listarBitacoraCxp(1, E1B)).eventos.map((e) => e.accion)).toEqual(["cxp_crear_config_proveedor"]);
    expect((await listarBitacoraCxp(2, E2)).eventos).toHaveLength(1);
    expect((await listarBitacoraCxp(2, E1)).totalReal).toBe(0); // empresa 2 con el libro de la empresa 1
    expect((await listarBitacoraCxp(1, E2)).totalReal).toBe(0);
    expect((await listarBitacoraCxp(1, E1)).totalReal).toBe(6);
  });

  it("transaccionalidad: si falla la bitácora el movimiento se deshace (sin movimiento sin evento ni evento huérfano)", async () => {
    const antes = Number((await q("SELECT COUNT(*) n FROM cxp_facturas"))[0].n), audAntes = Number((await q("SELECT COUNT(*) n FROM auditoria"))[0].n);
    await q("CREATE TRIGGER trg_fallo BEFORE INSERT ON auditoria FOR EACH ROW BEGIN IF NEW.detalle LIKE '%A-999%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fallo simulado'; END IF; END");
    await expect(registrarFactura(1, E1, conta, { ...fac, numero: "999", baseNeto: "100.00", ivaMonto: "12.00" })).rejects.toBeTruthy();
    await q("DROP TRIGGER trg_fallo");
    expect(Number((await q("SELECT COUNT(*) n FROM cxp_facturas"))[0].n)).toBe(antes);
    expect(Number((await q("SELECT COUNT(*) n FROM auditoria"))[0].n)).toBe(audAntes);
  });

  it("eventos anteriores a este cambio (sin documento/proveedor en el detalle) se completan al leer", async () => {
    const { factura } = await registrarFactura(1, E1, conta, { ...fac, numero: "200", baseNeto: "1000.00", ivaMonto: "120.00" });
    await q("INSERT INTO auditoria (empresa_id, usuario, accion, modulo, detalle) VALUES (1, 'viejo', 'cxp_anular_factura', 'contabilidad', ?)",
      [JSON.stringify({ entidadId: E1, facturaId: factura.id, usuarioId: 91, motivo: "Histórico", antes: "REGISTRADA", despues: "ANULADA" })]);
    const e = (await listarBitacoraCxp(1, E1, { usuario: "viejo" })).eventos[0];
    expect(e).toMatchObject({ documento: "A-200", proveedor: "Repuestos Uno", monto: "1120.00", motivo: "Histórico" });
  });

  it("detalles que no son JSON o de otras acciones no entran ni rompen la consulta", async () => {
    await q("INSERT INTO auditoria (empresa_id, usuario, accion, modulo, detalle) VALUES (1, 'x', 'cxp_anular_factura', 'contabilidad', 'texto libre')");
    await q("INSERT INTO auditoria (empresa_id, usuario, accion, modulo, detalle) VALUES (1, 'x', 'crear_cuenta', 'contabilidad', ?)", [JSON.stringify({ entidadId: E1 })]);
    const r = await listarBitacoraCxp(1, E1, { usuario: "x" });
    expect(r.totalReal).toBe(0);
  });
});
