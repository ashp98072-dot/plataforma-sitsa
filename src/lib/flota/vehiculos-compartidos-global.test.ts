import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasActivas: vi.fn() }));

import { query } from "@/lib/db";
import {
  listarVehiculosActivosAccesibles, obtenerVehiculoAccesible, obtenerVehiculoAccesibleTx, predicadoVehiculoAccesible,
} from "@/lib/flota/acceso";
import { vehiculoPorPlaca } from "@/lib/flota/pilotos";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { catalogosRequerimientoViatico } from "@/lib/tms/viaticos-requerimientos";
import {
  EMPRESA_A, EMPRESA_B, EMPRESA_Z, ID, VEHICULOS, esConsultaAccesible, filaAccesibleTx, filasListado,
} from "./vehiculos-compartidos.fixture";

const leer = (ruta: string) => readFileSync(ruta, "utf8").split("\r\n").join("\n");
const conn = () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (esConsultaAccesible(sql)) return [filaAccesibleTx(params ?? [])];
    return [[]];
  }),
});
const placas = (rows: readonly { [k: string]: unknown }[]) => rows.map((r) => String(r.placa));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
    if (esConsultaAccesible(sql) && sql.includes("ORDER BY")) return filasListado(params ?? []);
    return [];
  }) as never);
});

describe("fuente única de la regla de acceso", () => {
  it("el predicado es propio OR compartido (flota_vehiculo_acceso), parametrizable por columna", () => {
    expect(predicadoVehiculoAccesible("v", "?")).toBe("(v.empresa_id = ? OR EXISTS (SELECT 1 FROM flota_vehiculo_acceso fva WHERE fva.vehiculo_id = v.id AND fva.empresa_id = ?))");
    expect(predicadoVehiculoAccesible("fv", "p.empresa_id")).toContain("fva.empresa_id = p.empresa_id");
  });

  it("nadie más reimplementa la condición de acceso inline: todo pasa por predicadoVehiculoAccesible", () => {
    const inline = /flota_vehiculo_acceso\s+(a|fva)\b/;
    const permitidos = new Set(["src/lib/flota/acceso.ts"]);
    const archivos = [
      "src/lib/operaciones/disponibilidad.ts", "src/lib/flota/pilotos.ts", "src/lib/compras/requerimientos.ts", "src/lib/tms/viaticos-requerimientos.ts",
      "src/lib/tms/cliente-rutas.ts", "src/lib/tms/gastos.ts", "src/lib/tms/fondos.ts", "src/app/api/empresas/[slug]/flota/viajes/route.ts",
      "src/app/api/empresas/[slug]/flota/reportes/route.ts", "src/app/api/empresas/[slug]/tms/gastos/catalogos/route.ts", "src/app/api/empresas/[slug]/tms/catalogos/route.ts",
    ];
    for (const f of archivos) if (!permitidos.has(f)) expect(leer(f), f).not.toMatch(inline);
  });
});

describe("catálogo seleccionable (altas): propios + compartidos, activos, sin duplicados — empresa B = Mónaco", () => {
  it("1/2) aparece el vehículo propio y el compartido (C-091BXF de Frescofresh)", async () => {
    expect(placas(await listarVehiculosActivosAccesibles(EMPRESA_B))).toEqual(["C-091BXF", "M-001MON"]);
  });
  it("3/4) no aparece el no compartido ni el de otro tenant", async () => {
    const p = placas(await listarVehiculosActivosAccesibles(EMPRESA_B));
    expect(p).not.toContain("C-777NOC");
    expect(p).not.toContain("X-999OTR");
  });
  it("5) un inactivo no se ofrece para altas nuevas (aunque esté compartido)", async () => {
    expect(placas(await listarVehiculosActivosAccesibles(EMPRESA_B))).not.toContain("C-INACT");
  });
  it("10) sin duplicados aunque la consulta devuelva el mismo vehículo dos veces", async () => {
    vi.mocked(query).mockResolvedValueOnce([...filasListado([EMPRESA_B]), ...filasListado([EMPRESA_B])] as never);
    const ids = (await listarVehiculosActivosAccesibles(EMPRESA_B)).map((r) => Number(r.id));
    expect(ids).toEqual([...new Set(ids)]);
  });
  it("cada fila trae la empresa dueña y `compartido` para rotular «Frescofresh · Compartido»", async () => {
    const fila = (await listarVehiculosActivosAccesibles(EMPRESA_B)).find((r) => r.placa === "C-091BXF")!;
    expect(fila).toMatchObject({ compartido: 1, empresa_duena_nombre: "Frescofresh", empresa_id: EMPRESA_A });
    expect((await listarVehiculosActivosAccesibles(EMPRESA_B)).find((r) => r.placa === "M-001MON")).toMatchObject({ compartido: 0 });
  });
  it("la empresa propietaria sigue viendo sus unidades y NO ve las de Mónaco", async () => {
    expect(placas(await listarVehiculosActivosAccesibles(EMPRESA_A))).toEqual(["C-091BXF", "C-777NOC"]);
  });
  it("otro tenant (sin accesos) solo ve lo suyo", async () => {
    expect(placas(await listarVehiculosActivosAccesibles(EMPRESA_Z))).toEqual(["X-999OTR"]);
  });
});

describe("validación de escritura: obtenerVehiculoAccesibleTx (id que manda el cliente)", () => {
  it.each([
    ["propio", ID.PROPIO, true], ["compartido", ID.COMPARTIDO, true], ["inactivo compartido (la regla de acceso lo reconoce; el módulo decide `activo`)", ID.INACTIVO, true],
    ["NO compartido", ID.NO_COMPARTIDO, false], ["otro tenant", ID.OTRO_TENANT, false], ["id manipulado / inexistente", ID.INEXISTENTE, false],
  ])("6) Mónaco + %s => %s", async (_n, id, esperado) => {
    expect(Boolean(await obtenerVehiculoAccesibleTx(conn() as never, EMPRESA_B, id))).toBe(esperado);
  });
  it("la consulta exige propio OR compartido con los parámetros [empresa, id, empresa, empresa] — nunca `WHERE id = ?` a secas", async () => {
    const c = conn();
    await obtenerVehiculoAccesibleTx(c as never, EMPRESA_B, ID.COMPARTIDO);
    const [sql, params] = c.query.mock.calls[0];
    expect(sql).toContain(predicadoVehiculoAccesible("v", "?"));
    expect(params).toEqual([EMPRESA_B, ID.COMPARTIDO, EMPRESA_B, EMPRESA_B]);
  });
  it("`bloquear` agrega LOCK IN SHARE MODE (Compras) y un error de bloqueo NO se enmascara como «no accesible»", async () => {
    const c = conn();
    await obtenerVehiculoAccesibleTx(c as never, EMPRESA_B, ID.COMPARTIDO, "v.id", true);
    expect(c.query.mock.calls[0][0]).toContain("LOCK IN SHARE MODE");
    const falla = { query: vi.fn(async () => { throw Object.assign(new Error("Lock wait timeout"), { errno: 1205 }); }) };
    await expect(obtenerVehiculoAccesibleTx(falla as never, EMPRESA_B, ID.COMPARTIDO)).rejects.toThrow("Lock wait timeout");
  });
  it("solo la tabla de accesos ausente (1146) cae al comportamiento de unidades propias", async () => {
    let n = 0;
    const sinTabla = { query: vi.fn(async (_sql: string, params?: unknown[]) => {
      if (n++ === 0) throw Object.assign(new Error("no such table"), { errno: 1146 });
      const v = VEHICULOS.find((x) => x.id === (params as number[])[0] && x.empresa_id === (params as number[])[1]);
      return [v ? [v] : []];
    }) };
    expect(await obtenerVehiculoAccesibleTx(sinTabla as never, EMPRESA_B, ID.PROPIO)).toMatchObject({ placa: "M-001MON" });
  });
  it("7) la selección no escribe en flota: ningún UPDATE/INSERT/DELETE sobre flota_vehiculos ni flota_vehiculo_acceso", async () => {
    const c = conn();
    await obtenerVehiculoAccesibleTx(c as never, EMPRESA_B, ID.COMPARTIDO);
    expect(c.query.mock.calls.every(([s]) => !/(UPDATE|INSERT|DELETE)/i.test(String(s)))).toBe(true);
  });
  it("obtenerVehiculoAccesible (sin transacción) usa la misma regla", async () => {
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => (esConsultaAccesible(sql) ? filaAccesibleTx(params ?? []) : [])) as never);
    expect(await obtenerVehiculoAccesible(EMPRESA_B, ID.COMPARTIDO, "v.id, v.placa")).toMatchObject({ placa: "C-091BXF" });
    expect(await obtenerVehiculoAccesible(EMPRESA_B, ID.NO_COMPARTIDO, "v.id, v.placa")).toBeNull();
    expect(await obtenerVehiculoAccesible(EMPRESA_B, ID.OTRO_TENANT, "v.id, v.placa")).toBeNull();
  });
});

describe("Requerimientos de viáticos (mismo catálogo y validación)", () => {
  it("el catálogo ofrece propios + compartidos activos con empresa dueña y `compartido`", async () => {
    const cat = await catalogosRequerimientoViatico(EMPRESA_B);
    expect(placas(cat.vehiculos)).toEqual(["C-091BXF", "M-001MON"]);
    expect(cat.vehiculos.find((v) => v.placa === "C-091BXF")).toMatchObject({ compartido: true, empresaDuenaNombre: "Frescofresh" });
    expect(cat.vehiculos.find((v) => v.placa === "M-001MON")).toMatchObject({ compartido: false });
  });
  it("valida la unidad con obtenerVehiculoAccesibleTx (no `empresa_id=? AND id=?`) y congela la placa", () => {
    const f = leer("src/lib/tms/viaticos-requerimientos.ts");
    expect(f).toContain("obtenerVehiculoAccesibleTx(conn, empresaId, Number(l.vehiculoId)");
    expect(f).not.toContain("flota_vehiculos WHERE empresa_id=? AND id=?");
    expect(f).toContain("placa:v[0]?.placa ?? null");
  });
});

describe("Rutas: unidad recurrente", () => {
  it("el catálogo de rutas (tms/catalogos) usa el helper de accesibles y expone `compartido`/empresa dueña", () => {
    const f = leer("src/app/api/empresas/[slug]/tms/catalogos/route.ts");
    expect(f).toContain("listarVehiculosActivosAccesibles(eid)");
    expect(f).toContain("compartido: Number(v.compartido ?? 0) === 1");
    expect(f).not.toContain("FROM flota_vehiculos WHERE empresa_id = ? AND activo = 1");
  });
  it("el backend valida con obtenerVehiculoAccesibleTx y el JOIN de la placa es histórico (por id)", () => {
    const f = leer("src/lib/tms/cliente-rutas.ts");
    expect(f).toContain("obtenerVehiculoAccesibleTx(conn, empresaId, vehiculoId");
    expect(f).toContain("LEFT JOIN flota_vehiculos fvr ON fvr.id = r.unidad_recurrente_id\n");
    expect(f).not.toContain("fvr.empresa_id = r.empresa_id");
  });
});

describe("Flota y Programación: la fuente única ya se usa (sin condición duplicada)", () => {
  it("Disponibilidad de flota lista las unidades compartidas con la regla única", async () => {
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
      if (esConsultaAccesible(sql) && sql.includes("ORDER BY")) return filasListado(params ?? []).map((r) => ({ ...r, en_taller: 0, estado: "Activo", km_actual: 0 }));
      return [];
    }) as never);
    const payload = await listarDisponibilidadVehiculos(EMPRESA_B);
    const compartido = payload.vehiculos.find((v) => v.placa === "C-091BXF");
    expect(compartido).toBeTruthy();
    expect(payload.vehiculos.map((v) => v.placa)).not.toContain("C-777NOC");
    expect(payload.vehiculos.map((v) => v.placa)).not.toContain("X-999OTR");
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain(predicadoVehiculoAccesible("v", "?"));
  });
  it("vehiculoPorPlaca (viajes de piloto / programación) usa la regla única y encuentra la compartida por placa", async () => {
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
      if (!esConsultaAccesible(sql)) return [];
      const [, , , empresaId] = [0, 0, 0, (params as number[]).at(-2)];
      const v = VEHICULOS.find((x) => x.placa === "C-091BXF")!;
      return (params as unknown[]).includes("C-091BXF") || (params as unknown[]).includes("C091BXF")
        ? (empresaId === EMPRESA_B ? [v] : []) : [];
    }) as never);
    expect(await vehiculoPorPlaca(EMPRESA_B, "c-091bxf")).toMatchObject({ placa: "C-091BXF" });
    expect(await vehiculoPorPlaca(EMPRESA_Z, "c-091bxf")).toBeNull();
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain(predicadoVehiculoAccesible("v", "?"));
  });
});

describe("JOIN históricos: la placa del registro no desaparece si cambia la compartición", () => {
  it("Gastos (listado y reportes), Rutas y reporte de viáticos unen por id, acotados por la empresa del registro", () => {
    const g = leer("src/lib/tms/gastos.ts");
    expect(g).toContain("LEFT JOIN flota_vehiculos veh ON veh.id = g.vehiculo_id\n");
    const r = leer("src/lib/tms/reportes-gastos.ts");
    expect(r.match(/LEFT JOIN flota_vehiculos veh ON veh\.id = g\.vehiculo_id\n/g)).toHaveLength(2);
    expect(r).toContain("LEFT JOIN flota_vehiculos fv ON fv.id = u.flota_vehiculo_id\n");
    for (const f of [g, r]) {
      expect(f).not.toMatch(/veh\.empresa_id\s*=\s*g\.empresa_id/);
      expect(f).not.toContain("fv.empresa_id = p.empresa_id");
    }
  });
});

describe("Combustible: la conciliación de vales no pierde cargas de una unidad compartida", () => {
  it("el JOIN a la placa es por id (la carga ya está acotada por c.empresa_id), sin exigir que la dueña sea la misma empresa", () => {
    const f = leer("src/lib/flota/combustible.ts");
    expect(f).not.toContain("AND v.empresa_id = c.empresa_id");
    expect(f).toContain("WHERE c.empresa_id = ?");
  });
});

describe("Multas queda como estaba: solo la empresa propietaria (decisión explícita de MULTAS-2)", () => {
  it("el backend sigue exigiendo el vehículo propio y el esquema documenta que compartir NO comparte el historial", () => {
    expect(leer("src/lib/multas/backend.ts")).toContain("WHERE empresa_id = ? AND id = ? FOR UPDATE");
    expect(leer("sql/migrate-2026-08-operaciones-multas.sql")).toContain("Compartir una unidad mediante flota_vehiculo_acceso NO comparte este historial");
  });
});

describe("FK: solo se cambia la clase B (Compras); las demás no se tocan", () => {
  it("schema.sql: líneas de compra con FK simple + índice; Multas y las ya migradas intactas", () => {
    const s = leer("sql/schema.sql");
    expect(s).toMatch(/fk_cb_requerimiento_lineas_veh FOREIGN KEY \(vehiculo_id\) REFERENCES flota_vehiculos\(id\) ON DELETE RESTRICT/);
    expect(s).not.toMatch(/fk_cb_requerimiento_lineas_vehiculo FOREIGN KEY \(empresa_id, vehiculo_id\)/);
    expect(s).toContain("idx_compras_linea_vehiculo_id (vehiculo_id)");
    expect(s).toContain("fk_gasto_vehiculo FOREIGN KEY (vehiculo_id)");
    expect(s).toContain("fk_fondolin_vehiculo FOREIGN KEY (vehiculo_id)");
  });
  it("la migración es idempotente, agrega la FK nueva ANTES de quitar la vieja y no toca datos ni Multas", () => {
    const m = leer("sql/migrate-2026-10-vehiculos-compartidos-global.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(m.indexOf("ADD CONSTRAINT IF NOT EXISTS fk_cb_requerimiento_lineas_veh")).toBeGreaterThan(-1);
    expect(m.indexOf("ADD CONSTRAINT IF NOT EXISTS")).toBeLessThan(m.indexOf("DROP FOREIGN KEY IF EXISTS fk_cb_requerimiento_lineas_vehiculo"));
    expect(m).not.toMatch(/^\s*(UPDATE|DELETE|INSERT|TRUNCATE|DROP\s+TABLE)\b/im); // sin datos; «ON DELETE RESTRICT» es parte de la FK
    expect(m).not.toMatch(/\b(ops_multas|tms_gastos_operativos|tms_solicitud_fondo_lineas)\b/i);
  });
  it("el preflight es SOLO lectura", () => {
    const p = leer("sql/preflight-2026-10-vehiculos-compartidos-global.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(p).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/im); // statements de escritura/DDL (SHOW CREATE TABLE es lectura)
  });
});
