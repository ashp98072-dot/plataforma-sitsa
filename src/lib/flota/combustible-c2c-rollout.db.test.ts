/** Rollout SQL de C-2C contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407). Una BD nueva por caso; nunca usa DB_* ni credenciales de la app. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const sql = (archivo: string) => readFileSync(`sql/${archivo}-2026-10-combustibles-c2c-conciliacion.sql`, "utf8");
const c2b = readFileSync("sql/migrate-2026-10-combustibles-c2b-importaciones.sql", "utf8");

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

describe.skipIf(!port)("C-2C rollout SQL / MariaDB 11.8.9 SOLO LOCAL", { timeout: 60_000 }, () => {
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
    for (const n of creadas) if (/^c2c_roll_[a-f0-9]{32}$/.test(n)) await admin.query(`DROP DATABASE IF EXISTS ${n}`);
    await admin?.end();
  });

  async function script(texto: string) { for (const s of sentencias(texto)) await db.query(s); }
  /** Ejecuta un script de una pieza y devuelve el último resultado SELECT. */
  async function correr(archivo: string) {
    let ultimo: RowDataPacket[] = [];
    for (const s of sentencias(sql(archivo))) { const [r] = await db.query(s); if (Array.isArray(r) && r.length && !("affectedRows" in (r as object))) ultimo = r as RowDataPacket[]; }
    return ultimo;
  }
  async function estado() { await correr("preflight"); return String((await db.query<RowDataPacket[]>("SELECT @c2c_estado e"))[0][0].e); }
  async function fixture() {
    const nombre = `c2c_roll_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${nombre} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    creadas.push(nombre);
    if (db) await db.end();
    db = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", database: nombre, multipleStatements: true, dateStrings: true });
    await db.query(`CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB; CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB;
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY,empresa_id INT NOT NULL,UNIQUE(empresa_id,id)) ENGINE=InnoDB; CREATE TABLE auditoria(id INT PRIMARY KEY) ENGINE=InnoDB;
      INSERT INTO empresas VALUES(1); INSERT INTO usuarios VALUES(8); INSERT INTO compras_proveedores VALUES(3,1);`);
    const schema = readFileSync("src/lib/flota/schema.ts", "utf8");
    for (const t of ["flota_combustible_cargas", "flota_combustible_conciliaciones", "flota_combustible_conciliacion_filas"]) {
      await db.query(schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`))![0]);
    }
    await db.query("ALTER TABLE flota_combustible_cargas ADD proveedor_id INT NULL, ADD numero_vale VARCHAR(40) NULL");
    await script(c2b);
    await db.query(`INSERT INTO flota_combustible_cargas(id,empresa_id,vehiculo_id,tipo_combustible,galones,monto,ruta_relativa,nombre_original,creado_por,creado_at,proveedor_id,viaje_id,empleado_id,piloto_nombre) VALUES(1,1,1,'diesel',1,1,'x','x','u',NOW(),3,1,1,'p'),(2,1,1,'diesel',1,1,'x','x','u',NOW(),3,1,1,'p');
      INSERT INTO flota_combustible_conciliaciones(id,empresa_id,nombre_original,ruta_relativa,tamano,hoja,subido_por,creado_at,proveedor_id,proveedor_nombre,archivo_sha256,perfil_parser,version_parser,estado_importacion,resumen_importacion,subido_por_usuario_id)
        VALUES(10,1,'a','r',1,'H','op',NOW(),3,'P',REPEAT('a',64),'HALEL',1,'IMPORTADA','{}',8);
      INSERT INTO flota_combustible_conciliacion_filas(id,conciliacion_id,empresa_id,fila_excel,estado,motivo,creado_at,hoja_origen,estado_parseo,datos_importacion,origen_celdas,fingerprint,duplicado_previo)
        VALUES(21,10,1,2,'DESCARTADA','x',NOW(),'H','VALIDA','{}','[]',REPEAT('f',64),0);`);
  }
  async function snapshot() {
    const out: unknown[] = [];
    for (const t of ["flota_combustible_conciliacion_filas", "flota_combustible_conciliaciones", "flota_combustible_cargas", "usuarios"]) out.push((await db.query(`SELECT * FROM ${t} ORDER BY id`))[0]);
    return out;
  }
  const migrarFalla = async (patron: RegExp) => { const antes = await snapshot(); await expect(script(sql("migrate"))).rejects.toThrow(patron); expect(await snapshot()).toEqual(antes); };

  it("CLEAN → migrate → FINAL; legacy intacto; postcheck OK", async () => {
    await fixture(); expect(await estado()).toBe("CLEAN");
    const antes = await snapshot();
    await script(sql("migrate"));
    expect(await estado()).toBe("FINAL");
    const despues = await snapshot();
    // Las filas legacy conservan todas sus columnas originales (las nuevas nacen NULL).
    expect((despues[0] as Record<string, unknown>[]).map(r => ({ ...r, estado_c2c: undefined, modo_c2c: undefined, carga_vinculada_id: undefined, carga_sugerida_id: undefined, diferencias_c2c: undefined, calculado_en: undefined, confirmado_por_usuario_id: undefined, confirmado_en: undefined })))
      .toEqual((antes[0] as Record<string, unknown>[]).map(r => ({ ...r, estado_c2c: undefined, modo_c2c: undefined, carga_vinculada_id: undefined, carga_sugerida_id: undefined, diferencias_c2c: undefined, calculado_en: undefined, confirmado_por_usuario_id: undefined, confirmado_en: undefined })));
    expect(despues.slice(1)).toEqual(antes.slice(1));
    expect((despues[0] as Record<string, unknown>[])[0]).toMatchObject({ estado_c2c: null, carga_vinculada_id: null });
    const post = await correr("postcheck");
    expect(post.length).toBeGreaterThan(0);
  });

  it("FINAL → migrate → NOOP (sin cambios)", async () => {
    await fixture(); await script(sql("migrate"));
    const antes = await snapshot();
    const r = await correr("migrate");
    expect(r[0]).toMatchObject({ estado_inicial: "FINAL", estado_final: "FINAL", resultado: "NOOP" });
    expect(await snapshot()).toEqual(antes);
    await correr("postcheck");
  });

  it("migrate APLICADO informa el estado inicial CLEAN", async () => {
    await fixture();
    expect((await correr("migrate"))[0]).toMatchObject({ estado_inicial: "CLEAN", estado_final: "FINAL", resultado: "APLICADO", objetos_presentes: "18", objetos_correctos: "18" });
  });

  it("una sola columna creada previamente → DIVERGENTE y DETENER antes de cualquier DDL", async () => {
    await fixture(); await db.query("ALTER TABLE flota_combustible_conciliacion_filas ADD COLUMN estado_c2c VARCHAR(30) NULL");
    expect(await estado()).toBe("DIVERGENTE");
    await migrarFalla(/DIVERGENTE/);
    const [c] = await db.query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliacion_filas' AND COLUMN_NAME='modo_c2c'");
    expect(c[0].n).toBe(0); // no se reparó ni continuó
  });

  it("columna con tipo incorrecto → DIVERGENTE", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("ALTER TABLE flota_combustible_conciliacion_filas MODIFY estado_c2c VARCHAR(31) NULL");
    expect(await estado()).toBe("DIVERGENTE");
    await migrarFalla(/DIVERGENTE/); await expect(script(sql("postcheck"))).rejects.toThrow(/FINAL/);
  });

  it("índice con el mismo nombre pero columnas erróneas → DETENER", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("ALTER TABLE flota_combustible_conciliacion_filas DROP INDEX uq_fccif_vinculo, ADD UNIQUE INDEX uq_fccif_vinculo (carga_vinculada_id, empresa_id)");
    expect(await estado()).toBe("DIVERGENTE");
    await migrarFalla(/DIVERGENTE/);
  });

  it("índice no único donde debe ser UNIQUE → DETENER", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("ALTER TABLE flota_combustible_conciliacion_filas DROP INDEX uq_fccif_vinculo, ADD INDEX uq_fccif_vinculo (empresa_id, carga_vinculada_id)");
    expect(await estado()).toBe("DIVERGENTE");
  });

  it("FK con la misma denominación pero referencia incorrecta → DETENER", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("ALTER TABLE flota_combustible_conciliacion_filas DROP FOREIGN KEY fk_fccif_confirmo"); await db.query("ALTER TABLE flota_combustible_conciliacion_filas ADD CONSTRAINT fk_fccif_confirmo FOREIGN KEY (confirmado_por_usuario_id) REFERENCES empresas(id) ON UPDATE RESTRICT ON DELETE RESTRICT");
    expect(await estado()).toBe("DIVERGENTE"); await migrarFalla(/DIVERGENTE/);
  });

  it("FK con reglas distintas de RESTRICT → DETENER", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("ALTER TABLE flota_combustible_conciliacion_filas DROP FOREIGN KEY fk_fccif_vinculo"); await db.query("ALTER TABLE flota_combustible_conciliacion_filas ADD CONSTRAINT fk_fccif_vinculo FOREIGN KEY (carga_vinculada_id) REFERENCES flota_combustible_cargas(id) ON UPDATE RESTRICT ON DELETE CASCADE");
    expect(await estado()).toBe("DIVERGENTE");
  });

  it("CHECK incorrecto (mismo nombre, cláusula distinta) → DETENER", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("ALTER TABLE flota_combustible_conciliacion_filas DROP CONSTRAINT chk_fccif_modo_c2c, ADD CONSTRAINT chk_fccif_modo_c2c CHECK (modo_c2c IS NULL OR modo_c2c IN ('AUTO','MANUAL','OTRO'))");
    expect(await estado()).toBe("DIVERGENTE"); await migrarFalla(/DIVERGENTE/);
  });

  it("CHECK ausente en un estado casi final → DIVERGENTE", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("ALTER TABLE flota_combustible_conciliacion_filas DROP CONSTRAINT chk_fccif_vinculo_estado");
    expect(await estado()).toBe("DIVERGENTE");
  });

  it("C-2B no FINAL (falta la FK canónica) → DIVERGENTE", async () => {
    await fixture(); await db.query("ALTER TABLE flota_combustible_conciliacion_filas DROP FOREIGN KEY fk_fccif_canonica");
    expect(await estado()).toBe("DIVERGENTE");
  });

  it("C-2B con objeto del mismo nombre pero definición incorrecta (columna) → C-2C DIVERGENTE y migrate se detiene antes de DDL", async () => {
    await fixture();
    await db.query("ALTER TABLE flota_combustible_conciliaciones MODIFY version_parser INT NULL"); // C-2B: debía ser SMALLINT
    await correr("preflight");
    const [r] = await db.query<RowDataPacket[]>("SELECT @c2b_estado b, @c2c_estado c");
    expect(r[0]).toMatchObject({ b: "DIVERGENTE", c: "DIVERGENTE" });
    await migrarFalla(/DIVERGENTE/);
    const [c] = await db.query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliacion_filas' AND COLUMN_NAME LIKE '%c2c'");
    expect(c[0].n).toBe(0);
  });
  it("C-2B con índice del mismo nombre y columnas erróneas → C-2C DIVERGENTE", async () => {
    await fixture();
    await db.query("ALTER TABLE flota_combustible_conciliaciones DROP INDEX idx_fcci_perfil, ADD INDEX idx_fcci_perfil (empresa_id,id,perfil_parser)");
    expect(await estado()).toBe("DIVERGENTE"); await migrarFalla(/DIVERGENTE/);
  });
  it("C-2B con FK del mismo nombre y reglas distintas → C-2C DIVERGENTE (aun con C-2C FINAL)", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("ALTER TABLE flota_combustible_conciliaciones DROP FOREIGN KEY fk_fcci_usuario");
    await db.query("ALTER TABLE flota_combustible_conciliaciones ADD CONSTRAINT fk_fcci_usuario FOREIGN KEY (subido_por_usuario_id) REFERENCES usuarios(id) ON UPDATE RESTRICT ON DELETE CASCADE");
    expect(await estado()).toBe("DIVERGENTE");
    await expect(script(sql("postcheck"))).rejects.toThrow(/FINAL/);
  });
  it("el bloque C-2B del rollout C-2C es el de los scripts finales de C-2B", () => {
    const b2b = (t: string) => t.split("-- BEGIN C2B CONTRACT AUDIT")[1].split("-- END C2B CONTRACT AUDIT")[0];
    const lf = (t: string) => t.replace(/\r\n/g, "\n");
    expect(lf(b2b(sql("preflight")))).toBe(lf(b2b(c2b)));
  });

  describe("postcheck: integridad lógica falla con SIGNAL", () => {
    const vincular = (extra = "") => db.query(`UPDATE flota_combustible_conciliacion_filas SET carga_vinculada_id=1, estado_c2c='COINCIDENCIA_EXACTA', modo_c2c='AUTO'${extra} WHERE id=21`);
    const falla = async (patron = /integridad/) => { await expect(script(sql("postcheck"))).rejects.toThrow(patron); };
    it("estado sano (con vínculo válido) pasa y muestra los seis conteos", async () => {
      await fixture(); await script(sql("migrate")); await vincular();
      const r = (await correr("postcheck"))[0];
      for (const k of ["vinculos_duplicados", "vinculos_huerfanos", "vinculos_de_otro_proveedor", "vinculos_en_filas_no_canonicas", "sugeridas_huerfanas", "sugeridas_de_otro_proveedor"]) expect(Number(r[k])).toBe(0);
    });
    it("vínculo a un vale de otro proveedor", async () => {
      await fixture(); await script(sql("migrate")); await vincular();
      await db.query("UPDATE flota_combustible_cargas SET proveedor_id=4 WHERE id=1"); await falla();
    });
    it("vínculo en fila no canónica", async () => {
      await fixture(); await script(sql("migrate")); await vincular();
      await db.query("UPDATE flota_combustible_conciliacion_filas SET estado_parseo='INVALIDA' WHERE id=21"); await falla();
    });
    it("vínculo a un vale de otra empresa (huérfano de tenant)", async () => {
      await fixture(); await script(sql("migrate")); await vincular();
      await db.query("UPDATE flota_combustible_cargas SET empresa_id=2 WHERE id=1"); await falla();
    });
    it("sugerida a un vale de otra empresa", async () => {
      await fixture(); await script(sql("migrate"));
      await db.query("UPDATE flota_combustible_conciliacion_filas SET carga_sugerida_id=2, estado_c2c='COINCIDENCIA_CON_DIFERENCIAS' WHERE id=21");
      await db.query("UPDATE flota_combustible_cargas SET empresa_id=2 WHERE id=2"); await falla();
    });
    it("sugerida a un vale de otro proveedor", async () => {
      await fixture(); await script(sql("migrate"));
      await db.query("UPDATE flota_combustible_conciliacion_filas SET carga_sugerida_id=2, estado_c2c='COINCIDENCIA_CON_DIFERENCIAS' WHERE id=21");
      await db.query("UPDATE flota_combustible_cargas SET proveedor_id=4 WHERE id=2"); await falla();
    });
    it("vale vinculado dos veces: el UNIQUE lo impide en la base (el conteo de duplicados queda como defensa)", async () => {
      await fixture(); await script(sql("migrate")); await vincular();
      await db.query(`INSERT INTO flota_combustible_conciliacion_filas(id,conciliacion_id,empresa_id,fila_excel,estado,motivo,creado_at,hoja_origen,estado_parseo,datos_importacion,origen_celdas,fingerprint,duplicado_previo)
        VALUES(22,10,1,3,'DESCARTADA','x',NOW(),'H','VALIDA','{}','[]',REPEAT('e',64),0)`);
      await expect(db.query("UPDATE flota_combustible_conciliacion_filas SET carga_vinculada_id=1, estado_c2c='COINCIDENCIA_EXACTA' WHERE id=22")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    });
  });

  it("bloque de auditoría idéntico en preflight, migrate y postcheck", () => {
    const bloque = (t: string) => t.split("-- BEGIN C2C CONTRACT AUDIT")[1].split("-- END C2C CONTRACT AUDIT")[0];
    expect(bloque(sql("migrate"))).toBe(bloque(sql("preflight")));
    expect(bloque(sql("postcheck"))).toBe(bloque(sql("preflight")));
    expect(sql("migrate").replace(/--.*$/gm, "")).not.toMatch(/IF NOT EXISTS/i);
  });
});
