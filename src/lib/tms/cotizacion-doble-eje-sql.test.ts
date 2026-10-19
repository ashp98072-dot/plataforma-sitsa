import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { perfilAjustesCrearSchema } from "./cotizacion-costeo-ajustes";

const leer = (nombre: string) => readFileSync(`sql/${nombre}-2026-10-cotizaciones-doble-eje.sql`, "utf8");
const preflight = leer("preflight"), migracion = leer("migrate");
const sinComentarios = (s: string) => s.replace(/^--.*$/gm, "");
function proyeccion(sql: string): Record<string, string> {
  const bloque = sql.match(/SELECT\s*\n([\s\S]*?)\nFROM tms_cotizacion_costeo_perfiles c/)![1];
  return Object.fromEntries(bloque.split(",\n").map(linea => {
    const [, valor, columna] = linea.trim().match(/^(.+) AS (\w+)$/)!;
    return [columna, valor];
  }).filter(([columna]) => columna !== "creado_por"));
}
function proyectar(base: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(proyeccion(migracion)).map(([columna, valor]) =>
    [columna, valor.startsWith("c.") ? base[valor.slice(2)] : valor.startsWith("'") ? valor.slice(1, -1) : Number(valor)]));
}
const cabezal = {
  empresa_id: 17, codigo: "CABEZAL", nombre: "Cabezal", activo: 1,
  costo_adquisicion: null, dias_operacion_mes: 20, gps_mensual: 99,
  seguro_vehiculo_mensual: 99, costo_aceite_servicio: 99, vida_util_aceite_km: 7777,
  costo_juego_llantas: 99, vida_util_llantas_km: 67890, rendimiento_km_galon: 7.321,
  deprec_valor_base: 99, deprec_anios: 3, deprec_dias_operacion_mes: 26,
  refrig_valor_base: null, refrig_anios: null, refrig_dias_operacion_mes: null,
  viajes_mes: null, precio_llanta: null, cantidad_llantas: null,
  salario_piloto_mensual: null, salario_auxiliar_mensual: null, viaticos_hotel_viaje: null,
  auxiliar_multiplica_dias: 0, viaticos_hotel_multiplica_dias: null,
};

describe("DOBLE_EJE: alta propuesta basada en CABEZAL, sin cambiar el motor", () => {
  it("preview y alta usan exactamente la misma proyección completa", () => {
    expect(proyeccion(preflight)).toEqual(proyeccion(migracion));
    const columnas = migracion.match(/INSERT INTO tms_cotizacion_costeo_perfiles \(([\s\S]*?)\)\s*SELECT/)![1]
      .split(",").map(s => s.trim()).filter(c => c !== "creado_por");
    expect(columnas).toEqual(Object.keys(proyeccion(migracion)));
    expect(new Set(columnas).size).toBe(columnas.length);
    expect(columnas).toHaveLength(27);
  });
  it("aplica únicamente los importes autorizados, sin dividir el valor del camión por IVA", () => {
    expect(proyectar(cabezal)).toMatchObject({
      codigo: "DOBLE_EJE", nombre: "Doble eje", gps_mensual: 100,
      seguro_vehiculo_mensual: 1250, costo_aceite_servicio: 2400,
      precio_llanta: 1490, cantidad_llantas: 18, costo_juego_llantas: 26820,
      costo_adquisicion: 275000, deprec_valor_base: 275000, deprec_anios: 5,
      salario_piloto_mensual: 9388.59, salario_auxiliar_mensual: 6046.73, viaticos_hotel_viaje: 250,
    });
  });
  it("mantiene 18 llantas como CABEZAL y el juego equivale a precio por cantidad", () => {
    const resultado = proyectar(cabezal);
    expect(resultado.precio_llanta).toBe(1490);
    expect(resultado.cantidad_llantas).toBe(18);
    expect(resultado.costo_juego_llantas).toBe(Number(resultado.precio_llanta) * Number(resultado.cantidad_llantas));
  });
  it.each([null, 0, 1])("conserva banderas incluso cuando son %s, y todos los parámetros heredados", bandera => {
    const fuente = { ...cabezal, auxiliar_multiplica_dias: bandera, viaticos_hotel_multiplica_dias: bandera };
    const copia = structuredClone(fuente), salida = proyectar(fuente);
    for (const [columna, expresion] of Object.entries(proyeccion(migracion))) {
      if (expresion.startsWith("c.")) expect(salida[columna]).toEqual(fuente[columna as keyof typeof fuente]);
    }
    expect(salida.empresa_id).toBe(17);
    expect(salida.viajes_mes).toBeNull();
    expect(fuente).toEqual(copia);
  });
  it("los valores propuestos pasan el contrato de creación existente", () => {
    const r = proyectar(cabezal);
    const camel = Object.fromEntries(Object.entries(r).filter(([k]) => k !== "empresa_id").map(([k,v]) =>
      [k.replace(/_([a-z])/g, (_, letra: string) => letra.toUpperCase()), k === "activo" ? Boolean(v) :
        k.endsWith("multiplica_dias") ? v == null ? null : Boolean(v) : v]));
    expect(perfilAjustesCrearSchema.safeParse(camel).success).toBe(true);
  });
  it("preflight solo lee, no usa information_schema y distingue APLICAR/NOOP/DETENER", () => {
    expect(sinComentarios(preflight)).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|REPLACE)\b/im);
    expect(preflight).not.toContain("information_schema");
    for (const estado of ["APLICAR","NOOP","DETENER"]) expect(preflight).toContain(`'${estado}'`);
    for (const columna of Object.keys(proyeccion(migracion))) expect(preflight).toContain(`p.${columna} <=> x.${columna}`);
  });
  it("alta requiere tenant, actor, aprobación y base activa válida; no sobrescribe al repetir", () => {
    expect(migracion).toContain("SET @doble_eje_aplicar = 0");
    expect(migracion).toContain("@doble_eje_aplicar = 1");
    expect(migracion).toContain("e.slug = @doble_eje_slug");
    expect(migracion).toContain("@doble_eje_actor <> 'REEMPLAZAR_USUARIO'");
    expect(migracion).toContain("c.deprec_dias_operacion_mes > 0");
    expect(migracion).toContain("c.codigo = 'CABEZAL'");
    expect(migracion).toContain("NOT EXISTS");
    expect(migracion).toContain("p.empresa_id = c.empresa_id AND p.codigo = 'DOBLE_EJE'");
    expect(sinComentarios(migracion)).not.toMatch(/\b(UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|REPLACE)\b/i);
    expect(migracion).not.toMatch(/tms_cotizacion_costeo_parametros|tms_cotizacion_costeos|iva_tasa|margen_objetivo/);
  });
});
