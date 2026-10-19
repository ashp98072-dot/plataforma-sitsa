/** Rollout SQL de CxP M-3B1 (pagos) contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407). Una BD nueva por caso; nunca usa DB_* ni credenciales de la app. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const sql = (archivo: string) => readFileSync(`sql/${archivo}-2026-11-cxp-m3b1-pagos.sql`, "utf8");
const sqlM3a = () => readFileSync("sql/migrate-2026-11-cxp-m3a-base.sql", "utf8");

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
  if (buffer.replace(/--[^\n]*/g, "").trim()) throw new Error("SQL final sin delimitador");
  return out;
}

describe.skipIf(!port)("CxP M-3B1 rollout SQL / MariaDB 11.8.9 SOLO LOCAL", { timeout: 90_000 }, () => {
  let admin: Connection;
  let db: Connection;
  const creadas: string[] = [];
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true, dateStrings: true });
    expect(String((await admin.query<RowDataPacket[]>("SELECT VERSION() v"))[0][0].v)).toContain("11.8.9");
  });
  afterAll(async () => {
    if (db) await db.end();
    for (const n of creadas) if (/^cxp_roll3b_[a-f0-9]{32}$/.test(n)) await admin.query(`DROP DATABASE IF EXISTS ${n}`);
    await admin?.end();
  });

  async function script(texto: string) { for (const s of sentencias(texto)) await db.query(s); }
  async function correr(archivo: string) {
    let ultimo: RowDataPacket[] = [];
    for (const s of sentencias(sql(archivo))) { const [r] = await db.query(s); if (Array.isArray(r) && r.length && !("affectedRows" in (r as object))) ultimo = r as RowDataPacket[]; }
    return ultimo;
  }
  async function estado() { await correr("preflight"); return String((await db.query<RowDataPacket[]>("SELECT @cxpp_estado e"))[0][0].e); }
  /** Esquema mínimo + (opcional) CxP M-3A aplicada con su migración REAL. */
  async function fixture(conM3a = true) {
    const nombre = `cxp_roll3b_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${nombre} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    creadas.push(nombre);
    if (db) await db.end();
    db = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", database: nombre, multipleStatements: true, dateStrings: true });
    await db.query(`CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO usuarios VALUES(8);
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY,empresa_id INT NOT NULL,UNIQUE KEY uq_p(empresa_id,id)) ENGINE=InnoDB; INSERT INTO compras_proveedores VALUES(3,1),(4,1);
      CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT NOT NULL,UNIQUE KEY uq_e(empresa_id,id)) ENGINE=InnoDB; INSERT INTO cont_entidades VALUES(5,1);
      CREATE TABLE cont_cuentas(id INT PRIMARY KEY,empresa_id INT NOT NULL,entidad_id INT NULL,tipo VARCHAR(40) NOT NULL,UNIQUE KEY uq_c(empresa_id,entidad_id,id)) ENGINE=InnoDB;
      CREATE TABLE cont_cxp(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT NOT NULL,proveedor VARCHAR(200) NOT NULL,monto DECIMAL(14,2) NOT NULL,saldo DECIMAL(14,2) NOT NULL) ENGINE=InnoDB;`);
    if (conM3a) await script(sqlM3a());
  }
  async function snapshot() {
    const out: unknown[] = [];
    for (const t of ["compras_proveedores", "cont_entidades", "cont_cuentas", "usuarios", "cxp_proveedor_fiscal", "cxp_facturas"]) {
      try { out.push((await db.query(`SELECT * FROM ${t}`))[0]); } catch { out.push(null); }
    }
    return out;
  }
  const migrarFalla = async (patron: RegExp) => { const antes = await snapshot(); await expect(script(sql("migrate"))).rejects.toThrow(patron); expect(await snapshot()).toEqual(antes); };
  const tablasPagos = async () => Number((await db.query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('cxp_pagos','cxp_pago_aplicaciones')"))[0][0].n);

  it("CLEAN → migrate → FINAL (43/43 objetos); M-3A y tablas existentes intactas; postcheck OK; la migración no contiene ALTER ni DML", async () => {
    await fixture(); expect(await estado()).toBe("CLEAN");
    await db.query(`INSERT INTO cxp_proveedor_fiscal(empresa_id,entidad_id,proveedor_id,regimen_fiscal,sujeto_isr,creado_por,actualizado_por) VALUES(1,5,3,'GENERAL',1,8,8)`);
    const antes = await snapshot();
    const r = (await correr("migrate"))[0];
    expect(r).toMatchObject({ estado_inicial: "CLEAN", estado_final: "FINAL", resultado: "APLICADO", objetos_presentes: "43", objetos_correctos: "43" });
    expect(await estado()).toBe("FINAL");
    expect(await snapshot()).toEqual(antes);
    expect((await correr("postcheck"))[0]).toMatchObject({ estado_cxp_pagos: "FINAL", pagos_cxp: 0, aplicaciones_cxp: 0, facturas_isr_fuera_de_tramo: 0 });
    const texto = sql("migrate").replace(/--.*$/gm, "");
    expect(texto).not.toMatch(/ALTER TABLE|DROP TABLE|TRUNCATE|UPDATE\s+\w+\s+SET|DELETE FROM|INSERT INTO|IF NOT EXISTS/i);
  });

  it("FINAL → migrate → NOOP", async () => {
    await fixture(); await script(sql("migrate"));
    const antes = await snapshot();
    expect((await correr("migrate"))[0]).toMatchObject({ estado_inicial: "FINAL", estado_final: "FINAL", resultado: "NOOP" });
    expect(await snapshot()).toEqual(antes);
  });

  it("M-3A ausente (prerrequisito) → DIVERGENTE y DETENER antes de cualquier DDL", async () => {
    await fixture(false);
    expect(await estado()).toBe("DIVERGENTE");
    await migrarFalla(/DIVERGENTE/);
    expect(await tablasPagos()).toBe(0);
  });

  it("una sola tabla preexistente → DIVERGENTE y DETENER antes de cualquier DDL", async () => {
    await fixture(); await db.query("CREATE TABLE cxp_pagos (id INT PRIMARY KEY) ENGINE=InnoDB");
    expect(await estado()).toBe("DIVERGENTE");
    await migrarFalla(/DIVERGENTE/);
    expect(await tablasPagos()).toBe(1);
  });

  it.each([
    ["columna de tipo distinto", "ALTER TABLE cxp_pagos MODIFY referencia VARCHAR(121) NOT NULL DEFAULT ''"],
    ["monto con precisión distinta", "ALTER TABLE cxp_pago_aplicaciones MODIFY monto DECIMAL(15,2) NOT NULL"],
    ["default distinto", "ALTER TABLE cxp_pagos ALTER COLUMN estado SET DEFAULT 'REVERSADO'"],
    ["collation distinta", "ALTER TABLE cxp_pagos MODIFY clave_idempotencia VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL"],
    ["UNIQUE de idempotencia degradado a no único", "ALTER TABLE cxp_pagos DROP INDEX uq_cxpp_clave, ADD KEY uq_cxpp_clave (empresa_id, entidad_id, clave_idempotencia)"],
    ["UNIQUE de aplicación sin factura", "ALTER TABLE cxp_pago_aplicaciones DROP INDEX uq_cxpa_pago_factura, ADD UNIQUE KEY uq_cxpa_pago_factura (empresa_id, entidad_id, pago_id)"],
    ["CHECK de monto distinto", "ALTER TABLE cxp_pago_aplicaciones DROP CONSTRAINT ck_cxpa_monto, ADD CONSTRAINT ck_cxpa_monto CHECK (monto >= 0)"],
    ["CHECK de reversión ausente", "ALTER TABLE cxp_pagos DROP CONSTRAINT ck_cxpp_reversion"],
    ["FK con ON DELETE CASCADE", "ALTER TABLE cxp_pago_aplicaciones DROP FOREIGN KEY fk_cxpa_factura; ALTER TABLE cxp_pago_aplicaciones ADD CONSTRAINT fk_cxpa_factura FOREIGN KEY (empresa_id, entidad_id, factura_id) REFERENCES cxp_facturas(empresa_id, entidad_id, id) ON DELETE CASCADE ON UPDATE RESTRICT"],
  ])("%s → DIVERGENTE y migrate/postcheck se detienen", async (_caso, ddl) => {
    await fixture(); await script(sql("migrate"));
    await db.query(ddl);
    expect(await estado()).toBe("DIVERGENTE");
    await migrarFalla(/DIVERGENTE/);
    await expect(script(sql("postcheck"))).rejects.toThrow(/FINAL/);
  });

  describe("postcheck: integridad lógica falla con SIGNAL y siempre muestra conteos", () => {
    const factura = (id: number, prov: number, base: string, pct: string, isr: string, regla: string, extra = "") => db.query(
      `INSERT INTO cxp_facturas(id,empresa_id,entidad_id,proveedor_id,tipo_documento,serie,numero,serie_norm,numero_norm,fecha_documento,base_neto,iva_monto,total_documento,isr_porcentaje,isr_monto,total_neto_pagar,regla_isr,regimen_fiscal_snapshot,sujeto_isr_snapshot,creado_por${extra ? ",estado_admin,anulado_por,anulado_en,motivo_anulacion" : ""})
       VALUES(?,1,5,?, 'FACTURA','A',?, 'A',?,'2026-11-02',?,0,?,?,?,?,?, 'GENERAL',1,8${extra ? ",'ANULADA',8,'2026-11-03 10:00:00','x'" : ""})`,
      [id, prov, String(id), String(id), base, base, pct, isr, (Number(base) - Number(isr)).toFixed(2), regla]);
    const pago = (id: number, prov: number, total: string, estado = "REGISTRADO") => db.query(
      `INSERT INTO cxp_pagos(id,empresa_id,entidad_id,proveedor_id,fecha_pago,monto_total,clave_idempotencia,huella,estado,creado_por${estado === "REVERSADO" ? ",reversado_por,reversado_en,motivo_reversion" : ""})
       VALUES(?,1,5,?,'2026-11-10',?,?,REPEAT('a',64),?,8${estado === "REVERSADO" ? ",8,'2026-11-11 10:00:00','x'" : ""})`, [id, prov, total, `clave-${id}-12345`, estado]);
    const aplic = (pagoId: number, facturaId: number, monto: string) => db.query("INSERT INTO cxp_pago_aplicaciones(empresa_id,entidad_id,pago_id,factura_id,monto) VALUES(1,5,?,?,?)", [pagoId, facturaId, monto]);
    const base = async () => {
      await fixture(); await script(sql("migrate"));
      await db.query(`INSERT INTO cxp_proveedor_fiscal(empresa_id,entidad_id,proveedor_id,regimen_fiscal,sujeto_isr,creado_por,actualizado_por) VALUES(1,5,3,'GENERAL',1,8,8),(1,5,4,'GENERAL',1,8,8)`);
    };

    it("estado sano (los cinco tramos, pagos, reversados y anuladas) pasa y muestra los conteos", async () => {
      await base();
      await factura(1, 3, "2000.00", "0.00", "0.00", "M3B1_V1:BAJO_MINIMO_SIN_RETENCION");
      await factura(2, 3, "10000.00", "5.00", "500.00", "M3B1_V1:TRAMO_5_PCT");
      await factura(3, 3, "31250.00", "7.00", "1587.50", "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE");
      await factura(4, 3, "30000.00", "7.00", "1500.00", "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE");
      await factura(5, 3, "50000.00", "0.00", "0.00", "M3B1_V1:NO_SUJETO_ISR");
      await factura(6, 3, "10000.00", "5.00", "500.00", "M3A_V2:TRAMO_5_PCT_EXACTO"); // factura M-3A histórica: no se reevalúa
      await factura(7, 3, "1000.00", "0.00", "0.00", "M3B1_V1:BAJO_MINIMO_SIN_RETENCION", "anulada");
      // Redondeo confirmado (2 decimales, mitad hacia arriba): 140.005 → 140.01; 1,499.9995 → 1,500.00; 1,500.014 → 1,500.01; 1,587.535 → 1,587.54.
      await factura(8, 3, "2800.10", "5.00", "140.01", "M3B1_V1:TRAMO_5_PCT");
      await factura(9, 3, "29999.99", "5.00", "1500.00", "M3B1_V1:TRAMO_5_PCT");
      await factura(10, 3, "30000.20", "7.00", "1500.01", "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE");
      await factura(11, 3, "31250.50", "7.00", "1587.54", "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE");
      await pago(1, 3, "1587.50"); await aplic(1, 3, "1000.00"); await aplic(1, 4, "587.50");
      await pago(2, 3, "9500.00", "REVERSADO"); await aplic(2, 2, "9500.00"); // reversado: no cuenta aunque sea alto
      await pago(3, 3, "9500.00"); await aplic(3, 2, "9500.00");
      const r = (await correr("postcheck"))[0];
      expect(r).toMatchObject({ pagos_cxp: 3, aplicaciones_cxp: 4, facturas_cxp: 11, pagos_total_distinto_de_aplicaciones: 0, aplicaciones_proveedor_distinto: 0, pagos_vigentes_sobre_facturas_anuladas: 0, facturas_sobreaplicadas: 0, facturas_isr_fuera_de_tramo: 0 });
    });
    it("pago cuyo total no es la suma de sus aplicaciones (o sin aplicaciones)", async () => {
      await base(); await factura(1, 3, "2000.00", "0.00", "0.00", "M3B1_V1:BAJO_MINIMO_SIN_RETENCION");
      await pago(1, 3, "100.00"); await aplic(1, 1, "99.99");
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
      await db.query("DELETE FROM cxp_pago_aplicaciones"); // sin aplicaciones
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
    });
    it("aplicación a una factura de OTRO proveedor", async () => {
      await base(); await factura(1, 4, "2000.00", "0.00", "0.00", "M3B1_V1:BAJO_MINIMO_SIN_RETENCION");
      await pago(1, 3, "100.00"); await aplic(1, 1, "100.00");
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
    });
    it("pago vigente sobre una factura anulada", async () => {
      await base(); await factura(1, 3, "2000.00", "0.00", "0.00", "M3B1_V1:BAJO_MINIMO_SIN_RETENCION", "anulada");
      await pago(1, 3, "100.00"); await aplic(1, 1, "100.00");
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
    });
    it("factura sobreaplicada (pagos vigentes > monto pagadero)", async () => {
      await base(); await factura(1, 3, "2000.00", "0.00", "0.00", "M3B1_V1:BAJO_MINIMO_SIN_RETENCION");
      await pago(1, 3, "1500.00"); await aplic(1, 1, "1500.00"); await pago(2, 3, "500.01"); await aplic(2, 1, "500.01");
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
    });
    it.each([
      ["redondeo truncado: 5 % de 2,800.10 = 140.00 (debe ser 140.01)", "M3B1_V1:TRAMO_5_PCT", "2800.10", "5.00", "140.00"],
      ["redondeo truncado: 5 % de 29,999.99 = 1,499.99 (debe ser 1,500.00)", "M3B1_V1:TRAMO_5_PCT", "29999.99", "5.00", "1499.99"],
      ["tramo alto sin aproximar: 30,000.20 → 1,500.02 (debe ser 1,500.01)", "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE", "30000.20", "7.00", "1500.02"],
      ["tramo alto truncado: 31,250.50 → 1,587.53 (debe ser 1,587.54)", "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE", "31250.50", "7.00", "1587.53"],
      ["5 % mal calculado", "M3B1_V1:TRAMO_5_PCT", "10000.00", "5.00", "499.99"],
      ["tramo alto con 5 % en vez de fijo + 7 %", "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE", "31250.00", "7.00", "1562.50"],
      ["tramo alto sin la parte fija", "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE", "31250.00", "7.00", "87.50"],
      ["base bajo el mínimo con retención", "M3B1_V1:BAJO_MINIMO_SIN_RETENCION", "2000.00", "0.00", "100.00"],
      ["base sobre el mínimo clasificada como «bajo mínimo»", "M3B1_V1:BAJO_MINIMO_SIN_RETENCION", "3000.00", "0.00", "0.00"],
      ["tramo 5 % con base ≥ Q30,000", "M3B1_V1:TRAMO_5_PCT", "30000.00", "5.00", "1500.00"],
      ["no sujeto con retención", "M3B1_V1:NO_SUJETO_ISR", "10000.00", "0.00", "50.00"],
    ])("ISR fuera de tramo: %s", async (_caso, regla, baseNeto, pct, isr) => {
      await base(); await factura(1, 3, baseNeto, pct, isr, regla);
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
    });
  });

  describe("rollback", () => {
    it("FINAL con tablas vacías → elimina SOLO las dos tablas nuevas; M-3A y datos intactos; se puede volver a migrar", async () => {
      await fixture(); await script(sql("migrate"));
      await db.query(`INSERT INTO cxp_proveedor_fiscal(empresa_id,entidad_id,proveedor_id,regimen_fiscal,sujeto_isr,creado_por,actualizado_por) VALUES(1,5,3,'GENERAL',1,8,8)`);
      const antes = await snapshot();
      expect((await correr("rollback")).at(-1)).toMatchObject({ resultado: "ROLLBACK_APLICADO" });
      expect(await tablasPagos()).toBe(0);
      expect(await snapshot()).toEqual(antes);
      expect(await estado()).toBe("CLEAN");
      await script(sql("migrate")); expect(await estado()).toBe("FINAL");
    });
    it("con CUALQUIER pago (aunque reversado) → DETENER; no se borra nada", async () => {
      await fixture(); await script(sql("migrate"));
      await db.query(`INSERT INTO cxp_proveedor_fiscal(empresa_id,entidad_id,proveedor_id,regimen_fiscal,sujeto_isr,creado_por,actualizado_por) VALUES(1,5,3,'GENERAL',1,8,8)`);
      await db.query(`INSERT INTO cxp_pagos(empresa_id,entidad_id,proveedor_id,fecha_pago,monto_total,clave_idempotencia,huella,estado,creado_por,reversado_por,reversado_en,motivo_reversion) VALUES(1,5,3,'2026-11-10',10,'clave-12345678',REPEAT('b',64),'REVERSADO',8,8,'2026-11-11 10:00:00','x')`);
      await expect(script(sql("rollback"))).rejects.toThrow(/existen pagos registrados/);
      expect(await tablasPagos()).toBe(2);
    });
    it("fuera del estado FINAL (CLEAN o DIVERGENTE) → DETENER", async () => {
      await fixture();
      await expect(script(sql("rollback"))).rejects.toThrow(/FINAL/);
      await db.query("CREATE TABLE cxp_pagos (id INT PRIMARY KEY) ENGINE=InnoDB");
      await expect(script(sql("rollback"))).rejects.toThrow(/FINAL/);
      expect(await tablasPagos()).toBe(1);
    });
  });

  it("el bloque de auditoría es idéntico en preflight, migrate, postcheck y rollback", () => {
    const b = (t: string) => t.replace(/\r\n/g, "\n").split("-- BEGIN CXP M3B1 CONTRACT AUDIT")[1].split("-- END CXP M3B1 CONTRACT AUDIT")[0];
    for (const otro of ["migrate", "postcheck", "rollback"]) expect(b(sql(otro))).toBe(b(sql("preflight")));
  });
});
