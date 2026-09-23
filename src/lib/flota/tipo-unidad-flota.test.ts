import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
import { query } from "@/lib/db";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarVehiculosAccesibles } from "./acceso";

/**
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — la clasificación `tipo_unidad` en Flota:
 * lectura tolerante a la migración pendiente y edición solo por la empresa
 * dueña. Sin UPDATE masivo: los TC existentes se clasifican uno a uno.
 */
const raiz = join(__dirname, "..", "..", "..");
const fuente = (...ruta: string[]) => readFileSync(join(raiz, ...ruta), "utf-8").replace(/\r\n/g, "\n");

const FILA = { id: 1, placa: "TC-045", marca: "Great Dane", modelo: "2020", descripcion: "Caja seca", activo: 1, en_taller: 0, estado: "Activo", km_actual: 0, empresa_id: 7, compartido: 0 };

beforeEach(() => vi.resetAllMocks());

describe("listarDisponibilidadVehiculos — tipoUnidad con fallback", () => {
  it("con la columna migrada: expone tipoUnidad normalizado (TC / CABEZAL / VEHICULO)", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (String(sql).includes("FROM flota_viajes")) return [];
      return [{ ...FILA, tipo_unidad: "TC" }, { ...FILA, id: 2, placa: "C-123ABC", tipo_unidad: "cabezal" }, { ...FILA, id: 3, placa: "P-1", tipo_unidad: null }];
    }) as never);
    const r = await listarDisponibilidadVehiculos(7);
    expect(r.vehiculos.map((v) => [v.placa, v.tipoUnidad])).toEqual([["TC-045", "TC"], ["C-123ABC", "CABEZAL"], ["P-1", "VEHICULO"]]);
  });

  it("SIN la columna (migración pendiente): reintenta con la consulta de siempre — conserva las unidades compartidas y todo cae a VEHICULO", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      const s = String(sql);
      if (s.includes("FROM flota_viajes")) return [];
      if (s.includes("v.tipo_unidad")) throw new Error("Unknown column 'v.tipo_unidad'");
      if (s.includes("flota_vehiculo_acceso")) return [{ ...FILA }, { ...FILA, id: 9, placa: "COMPARTIDA", compartido: 1, empresa_id: 8 }];
      throw new Error("no debería caer al fallback de solo-propias");
    }) as never);
    const r = await listarDisponibilidadVehiculos(7);
    expect(r.vehiculos).toHaveLength(2);
    expect(r.vehiculos.find((v) => v.placa === "COMPARTIDA")?.compartido).toBe(true);
    expect(r.vehiculos.every((v) => v.tipoUnidad === "VEHICULO")).toBe(true);
  });

  it("aísla por empresa: la consulta va acotada por empresa_id / flota_vehiculo_acceso de la sesión", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarDisponibilidadVehiculos(7);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("v.empresa_id = ?");
    expect(String(sql)).toContain("a.empresa_id = ?");
    expect(params).toEqual([7, 7, 7]);
  });
});

describe("listarVehiculosAccesibles (Flota) — tipo_unidad con fallback", () => {
  it("incluye tipo_unidad en la consulta principal", async () => {
    vi.mocked(query).mockResolvedValue([{ ...FILA, tipo_unidad: "TC" }] as never);
    const filas = await listarVehiculosAccesibles(7);
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain("v.tipo_unidad");
    expect(filas[0].tipo_unidad).toBe("TC");
  });

  it("sin la columna: segundo intento IDÉNTICO al de siempre (con accesos compartidos), nunca el SELECT * solo-propias", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (String(sql).includes("v.tipo_unidad")) throw new Error("Unknown column");
      return [{ ...FILA }];
    }) as never);
    const filas = await listarVehiculosAccesibles(7);
    expect(filas).toHaveLength(1);
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(query).mock.calls[1][0])).toContain("flota_vehiculo_acceso");
  });
});

describe("API de vehículos de Flota — clasificar (código fuente)", () => {
  const ruta = fuente("src", "app", "api", "empresas", "[slug]", "flota", "vehiculos", "route.ts");

  it("alta y edición aceptan tipoUnidad solo del catálogo VEHICULO | CABEZAL | TC", () => {
    expect((ruta.match(/tipoUnidad: z\.enum\(TIPOS_UNIDAD\)\.optional\(\)/g) ?? []).length).toBe(2);
  });

  it("solo la empresa dueña puede reclasificar una unidad (403 para unidades compartidas)", () => {
    expect(ruta).toContain("Solo la empresa dueña puede cambiar el tipo de unidad.");
    expect(ruta).toMatch(/if \(d\.tipoUnidad !== undefined\) \{\s*\n\s*if \(!esDueno\)/);
  });

  it("el alta normal NO toca la columna (VEHICULO es el DEFAULT): solo se escribe al clasificar CABEZAL/TC — sigue funcionando sin migrar", () => {
    expect(ruta).toContain('if (d.tipoUnidad && d.tipoUnidad !== "VEHICULO") {');
  });

  it("un fallo al guardar el tipo (columna sin migrar) NO queda oculto por el fallback mínimo: responde 500 con el motivo", () => {
    expect(ruta).toContain("Verifica que la migración de tipo_unidad esté aplicada.");
  });

  it("el UPDATE del tipo siempre va acotado por empresa dueña (nunca por id a secas)", () => {
    expect(ruta).toContain("UPDATE flota_vehiculos SET tipo_unidad = ? WHERE id = ? AND empresa_id = ?");
  });
});

describe("Flota — formulario de vehículo (código fuente)", () => {
  const cliente = fuente("src", "app", "e", "[slug]", "flota", "flota-client.tsx");

  it("tiene el selector 'Tipo de unidad' con los tres valores y lo manda al guardar", () => {
    expect(cliente).toContain("Tipo de unidad");
    expect(cliente).toContain("TIPOS_UNIDAD.map((t) => (");
    expect(cliente).toContain("tipoUnidad: form.tipoUnidad,");
  });

  it("los vehículos nuevos arrancan como VEHICULO y al editar se precarga la clasificación existente", () => {
    expect(cliente).toContain('tipoUnidad: "VEHICULO" as TipoUnidad,');
    expect(cliente).toContain("tipoUnidad: normalizarTipoUnidad(v.tipo_unidad),");
  });
});

describe("Migración TC/caja/remolque — aditiva, sin UPDATE masivo, no ejecutada", () => {
  const migracion = fuente("sql", "migrate-2026-09-programacion-tc-caja-remolque.sql");
  // "ON DELETE SET NULL" (regla de la FK) no es una sentencia DELETE.
  const sinComentarios = migracion
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/ON DELETE SET NULL/gi, "");

  it("solo agrega columnas/índice/FK (ADD COLUMN, ADD INDEX, ADD CONSTRAINT); nunca DROP/TRUNCATE/DELETE/UPDATE/INSERT", () => {
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS tipo_unidad VARCHAR\(20\) NOT NULL DEFAULT 'VEHICULO'/);
    expect(sinComentarios).toContain("tc_vehiculo_id INT NULL");
    expect(sinComentarios).toContain("tc_placa_historica VARCHAR(40) NULL");
    expect(sinComentarios).toContain("tc_externo_placa VARCHAR(40) NULL");
    for (const prohibido of [/\bDROP\b/i, /\bTRUNCATE\b/i, /\bDELETE\b/i, /\bUPDATE\b/i, /\bINSERT\b/i, /MODIFY COLUMN/i, /CHANGE COLUMN/i]) {
      expect(sinComentarios).not.toMatch(prohibido);
    }
  });

  it("documenta cómo marcar los TC existentes SOLO como comentario (sin UPDATE masivo ejecutable)", () => {
    expect(migracion).toContain("CÓMO MARCAR LOS TC YA REGISTRADOS");
    expect(migracion).toMatch(/--\s*UPDATE flota_vehiculos SET tipo_unidad = 'TC'/);
  });

  it("schema.sql (instalaciones nuevas) refleja las mismas columnas", () => {
    const schema = fuente("sql", "schema.sql");
    expect(schema).toContain("tipo_unidad VARCHAR(20) NOT NULL DEFAULT 'VEHICULO'");
    expect(schema).toContain("tc_vehiculo_id INT NULL");
    expect(schema).toContain("fk_tmsplan_tc_vehiculo");
  });

  it("existe el preflight de solo lectura (SHOW COLUMNS, sin metadatos del sistema)", () => {
    const pre = fuente("sql", "preflight-2026-09-programacion-tc-caja-remolque.sql");
    expect(pre).toContain("SHOW COLUMNS FROM flota_vehiculos LIKE 'tipo_unidad';");
    expect(pre.toLowerCase()).not.toContain("information_schema");
  });
});
