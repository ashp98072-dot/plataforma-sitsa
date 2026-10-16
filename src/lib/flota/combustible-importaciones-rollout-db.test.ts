/** Opt-in EXCLUSIVO para MariaDB local desechable del rollout; nunca usa DB_* ni credenciales de app. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const ejecutar = process.env.C2B_TEST_LOCAL_DB === "1";
const scripts = Object.fromEntries(["preflight", "migrate", "postcheck"].map(k => [k, readFileSync(`sql/${k}-2026-10-combustibles-c2b-importaciones.sql`, "utf8")]));
const region = (inicio: string, fin: string) => scripts.migrate.split(`-- BEGIN ${inicio}`)[1].split(`-- END ${fin}`)[0];
function sentencias(sql: string) {
  let delimiter = ";", buffer = "";
  const out: string[] = [];
  for (const line of sql.split(/\r?\n/)) {
    const d = line.trim().match(/^DELIMITER (.+)$/);
    if (d) { delimiter = d[1]; continue; }
    buffer += `${line}\n`;
    if (line.trimEnd().endsWith(delimiter)) {
      const pos = buffer.lastIndexOf(delimiter), stmt = buffer.slice(0, pos).trim();
      if (stmt.replace(/--[^\n]*/g, "").trim()) out.push(stmt);
      buffer = "";
    }
  }
  if (buffer.replace(/--[^\n]*/g, "").trim()) throw new Error("SQL final sin delimitador");
  return out;
}
describe.skipIf(!ejecutar)("rollout real MariaDB 11.8.9 local (sin producción)", { timeout: 60_000 }, () => {
  let db: Connection;
  const creadas = new Set<string>();
  beforeAll(async () => {
    db = await createConnection({ host: "127.0.0.1", port: 34079, user: "root", password: "", multipleStatements: true, dateStrings: true });
    const [meta] = await db.query("SELECT VERSION() version, @@datadir datadir");
    const fila = (meta as { version: string; datadir: string }[])[0];
    if (!fila.version.startsWith("11.8.9-MariaDB") || !fila.datadir.replace(/\\/g, "/").includes("/node_modules/.c2b-mariadb-data/")) throw new Error("Instancia local no autorizada: detener sin crear BD");
  });
  afterAll(async () => {
    if (!db) return;
    for (const nombre of creadas) if (/^c2b_test_[a-f0-9]+$/.test(nombre)) await db.query(`DROP DATABASE IF EXISTS \`${nombre}\``);
    await db.end();
  });
  async function script(tipo: string) { for (const sql of sentencias(scripts[tipo])) await db.query(sql); }
  async function estado() { await script("preflight"); const [rows] = await db.query("SELECT @c2b_estado estado,@c2b_h_correctos h,@c2b_f_correctos f"); return (rows as { estado: string; h: number; f: number }[])[0]; }
  async function fixture() {
    const nombre = `c2b_test_${randomUUID().replace(/-/g, "")}`;
    await db.query(`CREATE DATABASE \`${nombre}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    creadas.add(nombre);
    await db.query(`USE \`${nombre}\``);
    await db.query(`CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
      CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB;
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY,empresa_id INT NOT NULL,UNIQUE(empresa_id,id)) ENGINE=InnoDB;
      CREATE TABLE auditoria(id INT PRIMARY KEY) ENGINE=InnoDB;
      INSERT INTO empresas VALUES(1),(2); INSERT INTO usuarios VALUES(8); INSERT INTO compras_proveedores VALUES(3,1),(4,2);`);
    const schema = readFileSync("src/lib/flota/schema.ts", "utf8");
    for (const tabla of ["flota_combustible_conciliaciones", "flota_combustible_conciliacion_filas"]) {
      const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`))![0];
      await db.query(ddl);
    }
    await db.query(`INSERT INTO flota_combustible_conciliaciones(id,empresa_id,nombre_original,ruta_relativa,mime,tamano,hoja,subido_por,creado_at)
      VALUES(10,1,'legacy-a.xlsx','empresas/1/flota/a.xlsx',NULL,111,'Hoja1','demo','2026-10-01'),(11,2,'legacy-b.xlsx','empresas/2/flota/b.xlsx',NULL,222,'Hoja2','demo','2026-10-02');
      INSERT INTO flota_combustible_conciliacion_filas(id,conciliacion_id,empresa_id,fila_excel,estado,motivo,creado_at,vale_gasolinera,monto_gasolinera)
      VALUES(21,10,1,2,'COINCIDE','inmutable','2026-10-01','001',100.25),(22,11,2,3,'DESCARTADA','nota','2026-10-02',NULL,NULL);`);
  }
  async function snapshot() {
    const [h] = await db.query("SELECT * FROM flota_combustible_conciliaciones ORDER BY id");
    const [f] = await db.query("SELECT * FROM flota_combustible_conciliacion_filas ORDER BY id");
    return { h: h as Record<string, unknown>[], f: f as Record<string, unknown>[] };
  }
  async function definiciones() {
    const [h] = await db.query("SHOW CREATE TABLE flota_combustible_conciliaciones");
    const [f] = await db.query("SHOW CREATE TABLE flota_combustible_conciliacion_filas");
    return { h, f };
  }
  function igualLegacy(antes: Awaited<ReturnType<typeof snapshot>>, despues: Awaited<ReturnType<typeof snapshot>>) {
    for (const tabla of ["h", "f"] as const) expect(despues[tabla].map((r, i) => Object.fromEntries(Object.keys(antes[tabla][i]).map(k => [k, r[k]])))).toEqual(antes[tabla]);
  }
  it("reproduce errno 150 original y SHOW WARNINGS identifica índice de FK canónica", async () => {
    await fixture(); await db.query(region("HEADER DDL", "HEADER DDL"));
    const columnas = region("FILAS A COLUMNAS", "FILAS A COLUMNAS").trim().replace(/;$/, "");
    const indices = region("FILAS B INDICES", "FILAS B INDICES").trim().replace(/^ALTER TABLE flota_combustible_conciliacion_filas\s*/, "").replace(/;$/, "");
    const cabecera = region("FILAS C FK CABECERA", "FILAS C FK CABECERA").trim().replace(/^ALTER TABLE flota_combustible_conciliacion_filas\s*/, "").replace(/;$/, "");
    const canonica = region("FILAS D FK CANONICA", "FILAS D FK CANONICA").trim().replace(/^ALTER TABLE flota_combustible_conciliacion_filas\s*/, "").replace(/;$/, "");
    await expect(db.query(`${columnas},${indices},${cabecera},${canonica}`)).rejects.toMatchObject({ errno: 1005 });
    const [warnings] = await db.query("SHOW WARNINGS");
    expect(JSON.stringify(warnings)).toContain("fk_fccif_canonica"); expect(JSON.stringify(warnings)).toContain("no index");
    expect((await estado()).estado).toBe("PARTIAL_HEADER_COMPLETE");
  });
  it("CLEAN -> FINAL, preservación exacta legacy y segunda ejecución NOOP", async () => {
    await fixture(); const antes = await snapshot(); expect((await estado()).estado).toBe("CLEAN");
    await script("migrate"); expect((await estado()).estado).toBe("FINAL"); igualLegacy(antes, await snapshot());
    await script("postcheck"); const final = await snapshot(); await script("migrate"); expect(await snapshot()).toEqual(final);
    const [r] = await db.query("SELECT @c2b_inicial inicial"); expect((r as { inicial: string }[])[0].inicial).toBe("FINAL");
  });
  it("PARTIAL_HEADER_COMPLETE exacto -> continúa filas sin alterar cabecera ni legacy", async () => {
    await fixture(); await db.query(region("HEADER DDL", "HEADER DDL")); const antes = await snapshot(); const ddlAntes = await definiciones();
    expect((await estado()).estado).toBe("PARTIAL_HEADER_COMPLETE");
    await script("migrate"); expect((await estado()).estado).toBe("FINAL"); igualLegacy(antes, await snapshot());
    expect((await definiciones()).h).toEqual(ddlAntes.h);
  });
  it("rollout funciona con usuario local sin privilegio global PROCESS", async () => {
    await fixture(); const admin = db;
    const [actual] = await admin.query("SELECT DATABASE() nombre"); const nombre = (actual as { nombre: string }[])[0].nombre;
    if (!creadas.has(nombre)) throw new Error("BD no creada por este test");
    const usuario = `c2b_test_${randomUUID().replace(/-/g, "")}`;
    await admin.query(`CREATE USER '${usuario}'@'127.0.0.1' IDENTIFIED BY 'solo-local-desechable'`);
    try {
      await admin.query(`GRANT ALL PRIVILEGES ON \`${nombre}\`.* TO '${usuario}'@'127.0.0.1'`);
      db = await createConnection({ host: "127.0.0.1", port: 34079, user: usuario, password: "solo-local-desechable", database: nombre, dateStrings: true });
      await expect(db.query("SHOW ENGINE INNODB STATUS")).rejects.toMatchObject({ errno: 1227 });
      expect((await estado()).estado).toBe("CLEAN"); await script("migrate"); await script("postcheck");
      expect((await estado()).estado).toBe("FINAL");
    } finally {
      if (db !== admin) await db.end(); db = admin;
      await admin.query(`DROP USER '${usuario}'@'127.0.0.1'`);
    }
  });
  it.each(["columna", "indice", "fk", "columna_filas_sola", "columnas_filas", "solo_indices_filas"])("%s divergente -> SIGNAL sin reparación", async caso => {
    await fixture(); await db.query(region("HEADER DDL", "HEADER DDL"));
    if (caso === "columna") await db.query("ALTER TABLE flota_combustible_conciliaciones MODIFY version_parser INT NULL");
    if (caso === "indice") await db.query("ALTER TABLE flota_combustible_conciliaciones DROP INDEX idx_fcci_perfil, ADD INDEX idx_fcci_perfil(empresa_id,id,perfil_parser)");
    if (caso === "fk") {
      await db.query("ALTER TABLE flota_combustible_conciliaciones DROP FOREIGN KEY fk_fcci_usuario");
      await db.query("ALTER TABLE flota_combustible_conciliaciones ADD CONSTRAINT fk_fcci_usuario FOREIGN KEY(subido_por_usuario_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT");
    }
    if (caso === "columna_filas_sola") await db.query("ALTER TABLE flota_combustible_conciliacion_filas ADD hoja_origen VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL");
    if (caso === "columnas_filas") await db.query(region("FILAS A COLUMNAS", "FILAS A COLUMNAS"));
    if (caso === "solo_indices_filas") { await db.query(region("FILAS A COLUMNAS", "FILAS A COLUMNAS")); await db.query(region("FILAS B INDICES", "FILAS B INDICES")); }
    const antes = await snapshot(); const ddlAntes = await definiciones(); expect((await estado()).estado).toBe("DIVERGENTE");
    await expect(script("migrate")).rejects.toMatchObject({ sqlState: "45000" }); expect(await snapshot()).toEqual(antes);
    expect(await definiciones()).toEqual(ddlAntes);
  });
  it("JSON LONGTEXT bin se certifica, sin CHECK JSON_VALID se detiene", async () => {
    await fixture(); await db.query(region("HEADER DDL", "HEADER DDL"));
    expect((await estado()).estado).toBe("PARTIAL_HEADER_COMPLETE");
    // El CHECK de JSON inline no se quita como constraint de tabla en esta versión.
    // Simula una columna LONGTEXT bin sin el contrato JSON en esta BD desechable únicamente.
    await db.query("ALTER TABLE flota_combustible_conciliaciones MODIFY resumen_importacion LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL");
    expect((await estado()).estado).toBe("DIVERGENTE");
  });
  it("FKs físicas impiden tenant/canónica ajenos y postcheck detecta canónica huérfana", async () => {
    await fixture(); await script("migrate");
    await expect(db.query("UPDATE flota_combustible_conciliacion_filas SET empresa_id=2 WHERE id=21")).rejects.toMatchObject({ errno: 1452 });
    await expect(db.query("UPDATE flota_combustible_conciliacion_filas SET duplicado_de_linea_id=22 WHERE id=21")).rejects.toMatchObject({ errno: 1452 });
    await db.query("SET foreign_key_checks=0");
    try { await db.query("UPDATE flota_combustible_conciliacion_filas SET duplicado_de_linea_id=999 WHERE id=21"); }
    finally { await db.query("SET foreign_key_checks=1"); }
    expect((await estado()).estado).toBe("DIVERGENTE"); await expect(script("postcheck")).rejects.toMatchObject({ sqlState: "45000" });
  });
  it.each(["cabecera", "filas", "proveedor", "usuario"])("postcheck detecta huérfano %s sin reparar datos", async caso => {
    await fixture(); await script("migrate"); await db.query("SET foreign_key_checks=0");
    try {
      if (caso === "cabecera") await db.query("UPDATE flota_combustible_conciliaciones SET empresa_id=999 WHERE id=10");
      if (caso === "filas") await db.query("UPDATE flota_combustible_conciliacion_filas SET conciliacion_id=999 WHERE id=21");
      if (caso === "proveedor") await db.query("UPDATE flota_combustible_conciliaciones SET proveedor_id=999 WHERE id=10");
      if (caso === "usuario") await db.query("UPDATE flota_combustible_conciliaciones SET subido_por_usuario_id=999 WHERE id=10");
    } finally { await db.query("SET foreign_key_checks=1"); }
    const antes = await snapshot(); expect((await estado()).estado).toBe("DIVERGENTE");
    await expect(script("postcheck")).rejects.toMatchObject({ sqlState: "45000" }); expect(await snapshot()).toEqual(antes);
  });
});
