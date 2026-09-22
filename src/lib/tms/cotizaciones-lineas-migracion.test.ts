import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("migración y preflight — varias rutas/destinos por cotización (tms_cotizacion_lineas)", () => {
  const migracion = leer("sql/migrate-2026-09-cotizaciones-lineas.sql");
  const preflight = leer("sql/preflight-2026-09-cotizaciones-lineas.sql");

  it("la migración es aditiva: solo un CREATE TABLE IF NOT EXISTS (tabla nueva, ninguna existente se toca)", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(sentencias).toMatch(/CREATE TABLE IF NOT EXISTS tms_cotizacion_lineas\b/);
    expect(sentencias).not.toMatch(/ALTER TABLE tms_cotizaciones\b/);
  });

  it("no destruye ni reescribe nada: sin DROP/UPDATE/INSERT/DELETE/ALTER fuera de las cláusulas declarativas ON DELETE/ON UPDATE de las FK", () => {
    const sentencias = sinComentarios(migracion).replace(/ON (DELETE|UPDATE) \w+/gi, "");
    expect(sentencias).not.toMatch(/\b(DROP|UPDATE|INSERT|DELETE|TRUNCATE|MODIFY|CHANGE|RENAME|ALTER|GRANT)\b/i);
  });

  it("aísla por empresa_id con el mismo patrón que el resto del esquema: FK simple + FK compuesta (empresa_id, cotizacion_id) -> tms_cotizaciones(empresa_id, id)", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias).toContain("empresa_id INT NOT NULL");
    expect(sentencias).toContain("FOREIGN KEY (empresa_id) REFERENCES empresas(id)");
    expect(sentencias).toContain("FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id)");
    expect(sentencias).toContain("UNIQUE KEY uq_cotizacion_lineas_empresa_id (empresa_id, id)");
  });

  it("orden único por cotización (empresa_id, cotizacion_id, orden): nunca dos líneas con el mismo orden en la misma cotización", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias).toContain("UNIQUE KEY uq_cotizacion_lineas_orden (empresa_id, cotizacion_id, orden)");
  });

  it("columnas de línea: mismos nombres/tipos que sus homólogas en tms_cotizaciones (origen_texto, destino_texto, unidad_descripcion VARCHAR(160), tarifa_cotizada)", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias).toContain("origen_texto VARCHAR(300) NULL");
    expect(sentencias).toContain("destino_texto VARCHAR(300) NULL");
    expect(sentencias).toContain("unidad_descripcion VARCHAR(160) NULL");
    expect(sentencias).toContain("tarifa_cotizada DECIMAL(12,2) NOT NULL");
  });

  it("InnoDB/utf8mb4, igual que el resto del esquema", () => {
    expect(sinComentarios(migracion)).toContain("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
  });

  it("el preflight usa SHOW TABLES + SHOW CREATE TABLE, sin metadatos del sistema ni escritura", () => {
    const sentencias = sinComentarios(preflight);
    expect(sentencias).toContain("SHOW TABLES LIKE 'tms_cotizacion_lineas';");
    expect(preflight).not.toMatch(/information_schema/i);
    expect(sentencias).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/i);
    expect(sentencias).not.toMatch(/^\s*CREATE TABLE/im);
  });

  it("el preflight documenta APLICAR / NOOP / DETENER", () => {
    for (const palabra of ["APLICAR", "NOOP", "DETENER"]) expect(preflight).toContain(palabra);
  });

  it("sql/schema.sql (instalaciones nuevas) declara la misma tabla, justo después de tms_cotizaciones", () => {
    const schema = leer("sql/schema.sql");
    const inicioCotizaciones = schema.indexOf("CREATE TABLE IF NOT EXISTS tms_cotizaciones (");
    const finCotizaciones = schema.indexOf(") ENGINE=InnoDB", inicioCotizaciones);
    const inicioLineas = schema.indexOf("CREATE TABLE IF NOT EXISTS tms_cotizacion_lineas (");
    expect(inicioLineas).toBeGreaterThan(finCotizaciones);
    const finLineas = schema.indexOf(") ENGINE=InnoDB", inicioLineas);
    const tabla = schema.slice(inicioLineas, finLineas);
    expect(tabla).toContain("origen_texto VARCHAR(300) NULL");
    expect(tabla).toContain("destino_texto VARCHAR(300) NULL");
    expect(tabla).toContain("unidad_descripcion VARCHAR(160) NULL");
    expect(tabla).toContain("tarifa_cotizada DECIMAL(12,2) NOT NULL");
    expect(tabla).toContain("FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id)");
  });

  it("el código lee y escribe exactamente tms_cotizacion_lineas con las mismas columnas", () => {
    const fuente = leer("src/lib/tms/cotizaciones.ts");
    expect(fuente).toContain("FROM tms_cotizacion_lineas");
    expect(fuente).toContain("INSERT INTO tms_cotizacion_lineas");
    expect(fuente).toContain("DELETE FROM tms_cotizacion_lineas WHERE empresa_id = ? AND cotizacion_id = ?");
  });

  it("la línea principal (columnas propias de tms_cotizaciones) NUNCA se mueve a la tabla nueva: el costeo interno sigue leyendo solo la cotización", () => {
    const fuenteCosteo = leer("src/lib/tms/cotizacion-costeo-servicio.ts");
    expect(fuenteCosteo).not.toMatch(/lineasAdicionales|tms_cotizacion_lineas/);
  });
});
