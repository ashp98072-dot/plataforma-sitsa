import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codigoGasto } from "./gastos";

/** Migración del código persistido de Gastos: solo se crea (NO se ejecuta). Pruebas de texto sobre el SQL. */
const leer = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const migracion = leer("sql/migrate-2026-09-gastos-codigo.sql");
const preflight = leer("sql/preflight-2026-09-gastos-codigo.sql");
const sinComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const m = sinComentarios(migracion);
const p = sinComentarios(preflight);

describe("migrate-2026-09-gastos-codigo.sql", () => {
  it("estrategia por pasos: ADD nullable → backfill → validar → NOT NULL → UNIQUE (empresa_id, codigo)", () => {
    const orden = [
      "ADD COLUMN codigo VARCHAR(30) NULL AFTER id",
      "UPDATE tms_gastos_operativos SET codigo = CONCAT(''GASTO-'', LPAD(id, 6, ''0'')), actualizado_en = actualizado_en WHERE codigo IS NULL",
    ];
    expect(m).toContain(orden[0]);
    expect(m).toContain(orden[1]);
    expect(migracion).toContain("PASO 3: validar antes de endurecer");
    expect(m).toContain("MODIFY COLUMN codigo VARCHAR(30) NOT NULL");
    expect(m).toContain("ADD UNIQUE KEY uq_gastos_empresa_codigo (empresa_id, codigo)");
    const posiciones = [orden[0], orden[1], "MODIFY COLUMN codigo VARCHAR(30) NOT NULL", "ADD UNIQUE KEY uq_gastos_empresa_codigo"].map((t) => m.indexOf(t));
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
  });
  it("backfill histórico: id 55 → GASTO-000055, con la MISMA regla que la aplicación (codigoGasto)", () => {
    expect(m).toContain("CONCAT(''GASTO-'', LPAD(id, 6, ''0''))");
    expect(codigoGasto(55)).toBe("GASTO-000055");
    // emulación de la expresión SQL para ids de hasta 6 dígitos (LPAD): igual a padStart
    const lpad = (id: number) => `GASTO-${String(id).padStart(6, "0").slice(0, 6)}`;
    for (const id of [1, 55, 723, 999999]) expect(lpad(id)).toBe(codigoGasto(id));
  });
  it("el backfill no toca la fecha de actualización y solo rellena donde codigo IS NULL", () => {
    expect(m).toContain("actualizado_en = actualizado_en");
    expect(m).toContain("WHERE codigo IS NULL");
  });
  it("guardas: tabla existe, ids válidos, ids ≤ 999999 (LPAD trunca), longitud del código, sin sin-código ni duplicados", () => {
    for (const t of ["@tabla <> 1", "SUM(id <= 0)", "SUM(id > 999999)", "CHAR_LENGTH(CONCAT(''GASTO-'', LPAD(id, 6, ''0''))) > 30", "GROUP BY empresa_id, codigo HAVING COUNT(*) > 1", "codigo IS NULL OR codigo = ''''"]) expect(m).toContain(t);
    expect(m).toContain("DETENER: ");
    expect(migracion).toContain("LPAD trunca");
  });
  it("cada paso es idempotente: solo corre si falta (columna, nullable, índice) y si el precheck/validación pasaron", () => {
    expect(m).toContain("COLUMN_NAME = 'codigo') = 0");
    expect(m).toContain("IS_NULLABLE FROM information_schema.COLUMNS");
    expect(m).toContain("INDEX_NAME = 'uq_gastos_empresa_codigo') = 0");
    expect(m).toContain("IF(@motivo IS NULL");
    expect(m).toContain("IF(@motivo2 IS NULL");
  });
  it("no destruye nada: sin DROP / DELETE / TRUNCATE / INSERT, y solo altera tms_gastos_operativos", () => {
    expect(m).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|RENAME)\b/i);
    expect(m.match(/ALTER TABLE (\w+)/g)?.every((a) => a === "ALTER TABLE tms_gastos_operativos")).toBe(true);
    expect(m.match(/UPDATE (\w+)/g)).toEqual(["UPDATE tms_gastos_operativos"]);
    expect(m).not.toMatch(/SET id\s*=|\bid\s*=\s*id\s*\+/i); // no cambia ids
  });
  it("postcheck: SHOW COLUMNS, SHOW INDEX y resumen (sin código / distinto de GASTO-id / distintos por empresa)", () => {
    expect(m).toContain("SHOW COLUMNS FROM tms_gastos_operativos LIKE 'codigo';");
    expect(m).toContain("SHOW INDEX FROM tms_gastos_operativos WHERE Key_name = 'uq_gastos_empresa_codigo';");
    for (const t of ["sin_codigo", "distintos_de_gasto_id", "codigos_distintos_por_empresa"]) expect(m).toContain(t);
  });
});

describe("preflight-2026-09-gastos-codigo.sql", () => {
  it("es de SOLO LECTURA", () => {
    expect(p).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|SET)\b/im);
  });
  it("revisa tabla/columna/índice, volumen, bloqueantes (ids, > 6 dígitos, longitud) y duplicados resultantes", () => {
    for (const t of ["tabla_existe", "columna_codigo_existe", "indice_existe", "uq_gastos_empresa_codigo", "gastos_totales", "ids_no_validos", "ids_de_mas_de_6_digitos", "codigos_de_mas_de_30_caracteres", "HAVING COUNT(*) > 1", "colacion_tabla", "VERSION()"]) expect(p).toContain(t);
  });
});
