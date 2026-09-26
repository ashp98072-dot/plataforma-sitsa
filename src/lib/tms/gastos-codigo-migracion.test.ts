import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codigoGasto } from "./gastos";

/**
 * Código persistido de Gastos: migración EXPAND/CONTRACT en dos fases (solo se crean; NO se ejecutan). Pruebas de texto sobre el SQL.
 *   fase A  sql/migrate-2026-09-gastos-codigo.sql            (antes del deploy: columna NULLABLE + backfill + UNIQUE)
 *   fase B  sql/migrate-2026-09-gastos-codigo-finalizar.sql  (después del deploy: re-backfill + validar + NOT NULL)
 */
const leer = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const quitarComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/\s--[^\n']*$/gm, "");
const faseAraw = leer("sql/migrate-2026-09-gastos-codigo.sql");
const faseBraw = leer("sql/migrate-2026-09-gastos-codigo-finalizar.sql");
const preraw = leer("sql/preflight-2026-09-gastos-codigo.sql");
const A = quitarComentarios(faseAraw);
const B = quitarComentarios(faseBraw);
const P = quitarComentarios(preraw);
// Las fases construyen el SQL con literales (comillas duplicadas); se normaliza para comparar con la forma "directa".
const plano = (s: string) => s.replace(/''/g, "'").replace(/\s+/g, " ");

/** La ÚNICA expresión del código, en su forma directa (preflight) — y la misma, con comillas escapadas, en las dos fases. */
const EXPRESION = "CONCAT('GASTO-', CASE WHEN CHAR_LENGTH(CAST(id AS CHAR)) < 6 THEN LPAD(CAST(id AS CHAR), 6, '0') ELSE CAST(id AS CHAR) END)";

/** Emulación literal de la expresión SQL (incluida la truncación de LPAD cuando el texto supera la longitud pedida). */
const sqlCodigo = (id: number) => {
  const texto = String(id);
  const lpad = (s: string, n: number, pad: string) => (s.length >= n ? s.slice(0, n) : pad.repeat(n - s.length) + s);
  return "GASTO-" + (texto.length < 6 ? lpad(texto, 6, "0") : texto);
};

describe("expresión del código: paridad TS/SQL, sin truncar ids de más de 6 dígitos", () => {
  it.each([[1, "GASTO-000001"], [55, "GASTO-000055"], [723, "GASTO-000723"], [99999, "GASTO-099999"], [123456, "GASTO-123456"], [999999, "GASTO-999999"], [1000000, "GASTO-1000000"], [1234567, "GASTO-1234567"]])(
    "id %i → %s (TS y SQL producen exactamente lo mismo)", (id, esperado) => {
      expect(codigoGasto(id)).toBe(esperado);
      expect(sqlCodigo(id)).toBe(esperado);
    });
  it("LPAD(id, 6, '0') directo TRUNCARÍA (por eso no se usa): 1234567 → GASTO-123456", () => {
    const lpadDirecto = (id: number) => `GASTO-${String(id).slice(0, 6).padStart(6, "0")}`;
    expect(lpadDirecto(1234567)).toBe("GASTO-123456");
    expect(lpadDirecto(1234567)).not.toBe(codigoGasto(1234567));
    for (const f of [A, B, P]) expect(f).not.toMatch(/LPAD\(id,/); // nadie usa LPAD sobre el id sin CAST/CASE
  });
  it("la MISMA expresión está en preflight, fase A y fase B (una sola variante)", () => {
    for (const f of [A, B, P]) expect(plano(f)).toContain(EXPRESION);
    // y ninguna otra forma de construir el código
    for (const f of [A, B, P]) expect((plano(f).match(/CONCAT\('GASTO-'/g) ?? []).length).toBeGreaterThan(0);
    expect(plano(A).match(/CONCAT\('GASTO-', CASE/g)?.length).toBe(1); // en las fases se define UNA vez (@cod) y se reutiliza
    expect(plano(B).match(/CONCAT\('GASTO-', CASE/g)?.length).toBe(1);
  });
  it("las fases reutilizan @cod en backfill, validaciones y postcheck", () => {
    for (const f of [A, B]) {
      expect(f.match(/@cod/g)!.length).toBeGreaterThanOrEqual(4);
      expect(f).toContain("SET @cod := ");
    }
  });
});

describe("FASE A — EXPAND (antes del merge/deploy)", () => {
  it("agrega la columna NULLABLE solo si no existe, y la deja NULLABLE: NO contiene NOT NULL", () => {
    expect(A).toContain("ADD COLUMN codigo VARCHAR(30) NULL AFTER id");
    expect(A).toContain("COLUMN_NAME = 'codigo') = 0");
    expect(A).not.toMatch(/(?<!IS )NOT NULL/i); // "IS NOT NULL" (filtros) sí puede aparecer; una columna NOT NULL no
    expect(A).not.toMatch(/MODIFY/i);
  });
  it("backfill de históricos (NULL o vacío) sin alterar actualizado_en", () => {
    expect(A).toContain("UPDATE tms_gastos_operativos SET codigo = ");
    expect(A).toContain("actualizado_en = actualizado_en WHERE codigo IS NULL OR codigo = ''''");
  });
  it("valida antes del UNIQUE: 0 códigos incorrectos entre los no nulos y 0 duplicados por empresa", () => {
    expect(A).toContain("WHERE codigo IS NOT NULL AND codigo <> ");
    expect(A).toContain("GROUP BY empresa_id, codigo HAVING COUNT(*) > 1");
    expect(A).toContain("SET @motivo2 := CASE");
    expect(A).toContain("IF(@motivo2 IS NULL");
  });
  it("agrega UNIQUE (empresa_id, codigo) solo si falta; el orden es columna → backfill → validar → UNIQUE", () => {
    expect(A).toContain("ADD UNIQUE KEY uq_gastos_empresa_codigo (empresa_id, codigo)");
    expect(A).toContain("INDEX_NAME = 'uq_gastos_empresa_codigo') = 0");
    const orden = ["ADD COLUMN codigo VARCHAR(30) NULL", "UPDATE tms_gastos_operativos SET codigo", "SET @motivo2 := CASE", "ADD UNIQUE KEY uq_gastos_empresa_codigo"].map((t) => A.indexOf(t));
    expect(orden.every((n) => n >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });
  it("guardas de precheck: tabla existe, ids > 0 y longitud final ≤ 30; SIN límite de 6 dígitos", () => {
    for (const t of ["@tabla <> 1", "SUM(id <= 0)", "@codigo_max_largo, 0) > 30", "DETENER: "]) expect(A).toContain(t);
    expect(A).not.toContain("999999");
    expect(A).not.toMatch(/ids_grandes|id > 9/);
  });
  it("postcheck: SHOW COLUMNS (Null = YES esperado), SHOW INDEX y resumen", () => {
    expect(A).toContain("SHOW COLUMNS FROM tms_gastos_operativos LIKE 'codigo';");
    expect(A).toContain("SHOW INDEX FROM tms_gastos_operativos WHERE Key_name = 'uq_gastos_empresa_codigo';");
    for (const t of ["sin_codigo", "inconsistentes", "codigos_distintos_por_empresa"]) expect(A).toContain(t);
  });
  it("documenta por qué la app vieja sigue funcionando (SELECT sin codigo, INSERT → NULL, UNIQUE con varios NULL)", () => {
    for (const t of ["su SELECT no pide `codigo`", "su INSERT no manda `codigo`", "VARIAS filas con codigo NULL", "SIN ventana de fallo"]) expect(faseAraw).toContain(t);
  });
});

describe("FASE B — CONTRACT (después del deploy de la app nueva)", () => {
  it("comprueba que existen la columna y el índice UNIQUE antes de hacer nada", () => {
    expect(B).toContain("@col_existe <> 1");
    expect(B).toContain("@idx_existe < 1");
    expect(B).toContain("DETENER: ");
  });
  it("vuelve a rellenar cualquier fila con NULL o vacío creada durante la ventana", () => {
    expect(B).toContain("UPDATE tms_gastos_operativos SET codigo = ");
    expect(B).toContain("actualizado_en = actualizado_en WHERE codigo IS NULL OR codigo = ''''");
  });
  it("valida antes del NOT NULL: 0 sin código, 0 duplicados, 0 códigos inconsistentes", () => {
    for (const t of ["@sin_codigo", "@inconsistentes", "@duplicados", "WHERE codigo IS NULL OR codigo = ''''", "codigo IS NOT NULL AND codigo <> ", "GROUP BY empresa_id, codigo HAVING COUNT(*) > 1"]) expect(B).toContain(t);
    const validar = B.indexOf("SET @motivo2 := CASE");
    const notNull = B.indexOf("MODIFY COLUMN codigo VARCHAR(30) NOT NULL");
    const backfill = B.indexOf("UPDATE tms_gastos_operativos SET codigo");
    expect(backfill).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(validar);
    expect(validar).toBeLessThan(notNull);
  });
  it("hace NOT NULL solo si pasó la validación y solo si todavía es nullable (re-ejecutable)", () => {
    expect(B).toContain("MODIFY COLUMN codigo VARCHAR(30) NOT NULL");
    expect(B).toContain("IF(@motivo2 IS NULL");
    expect(B).toContain("IS_NULLABLE FROM information_schema.COLUMNS");
    expect(B).toContain("= 'YES'");
  });
  it("postcheck final (Null = NO esperado)", () => {
    expect(B).toContain("SHOW COLUMNS FROM tms_gastos_operativos LIKE 'codigo';");
    expect(B).toContain("SHOW INDEX FROM tms_gastos_operativos WHERE Key_name = 'uq_gastos_empresa_codigo';");
    expect(B).toContain("sin_codigo");
  });
});

describe("ninguna fase destruye datos ni cambia ids", () => {
  it("sin DROP / DELETE / TRUNCATE / INSERT / RENAME, solo se altera tms_gastos_operativos, un único UPDATE (el backfill) por fase", () => {
    for (const f of [A, B]) {
      expect(f).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|RENAME)\b/i);
      expect(f.match(/ALTER TABLE (\w+)/g)?.every((a) => a === "ALTER TABLE tms_gastos_operativos")).toBe(true);
      expect(f.match(/UPDATE (\w+)/g)).toEqual(["UPDATE tms_gastos_operativos"]);
      expect(f).not.toMatch(/SET id\s*=|\bid\s*=\s*id\s*\+/i);
    }
  });
  it("solo la fase B agrega NOT NULL", () => {
    expect(A).not.toMatch(/(?<!IS )NOT NULL/i);
    expect(B).toMatch(/MODIFY COLUMN codigo VARCHAR\(30\) NOT NULL/);
  });
});

describe("preflight-2026-09-gastos-codigo.sql", () => {
  it("es de SOLO LECTURA (SELECT + variables/PREPARE de consulta)", () => {
    expect(P).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER)\b/im);
    expect(P).not.toMatch(/ALTER TABLE|ADD COLUMN|MODIFY/i);
  });
  it("ya NO bloquea ids de más de 6 dígitos; conserva ids ≤ 0, longitud ≤ 30, duplicados, muestra y estado parcial", () => {
    expect(P).not.toContain("999999");
    expect(P).not.toMatch(/ids_de_mas_de_6_digitos/);
    for (const t of ["ids_no_validos", "SUM(id <= 0)", "codigos_de_mas_de_30_caracteres", "> 30", "HAVING COUNT(*) > 1", "ORDER BY id ASC", "ORDER BY id DESC", "columna_codigo_existe", "columna_codigo_nullable", "indice_existe", "uq_gastos_empresa_codigo", "estado_parcial", "colacion_tabla"]) expect(P).toContain(t);
  });
});
