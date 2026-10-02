import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));
vi.mock("@/lib/rrhh/export-files", () => ({ tablaAExcel: vi.fn(async () => Buffer.from("xlsx")), tablaAPdf: vi.fn(async () => Buffer.from("pdf")) }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));

import { query } from "@/lib/db";
import { tablaAExcel } from "@/lib/rrhh/export-files";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { obtenerReporteViajes, type PlanReporte } from "./reportes-viajes";
import { filaOperativa, HEADERS_OPERATIVOS, reporteViajesHistorialPdf } from "./reporte-viajes-historial-pdf";
import { reporteViajePdf } from "./reporte-viaje-pdf";
import { camposTocados } from "./programacion-validacion-recursos";
import {
  cambioVehiculoSolicitado,
  opcionesVehiculoSolicitado,
  textoUnidadUtilizada,
  textoVehiculoSolicitado,
} from "./vehiculo-solicitado";
import { listarVehiculosSolicitables, resolverVehiculoSolicitado } from "./vehiculo-solicitado-db";
import { resumenCierre } from "../../app/e/[slug]/planes/planes-viajes-client";
import { GET as exportar } from "../../app/api/empresas/[slug]/tms/reportes/viajes/export/route";

/**
 * PROGRAMACION-VEHICULO-SOLICITADO — "Vehículo solicitado por el cliente": helpers, catálogo reutilizado (perfiles de
 * costeo de Cotizaciones, por empresa), Planes/Viajes, reportes, cierre y migración. Dato COMERCIAL independiente de la
 * unidad real y de la tarifa; los viajes históricos sin dato se muestran como "—" (nunca se infiere de la unidad).
 */
const fila = (over: Record<string, unknown> = {}) => ({
  id: 1, codigo: "PLAN-1", fecha_plan: "2026-12-15", estado: "En ruta", pendiente_cierre: 1, evidencias: 0,
  placa: "C-123ABC", unidad_tipo: "Camion", unidad_capacidad: "5 toneladas", tarifa_comercial: 1250,
  vehiculo_solicitado_perfil_id: 11, vehiculo_solicitado_nombre: "Camión 2.5 toneladas", ...over,
});
let filasBD: Record<string, unknown>[];
beforeEach(() => {
  vi.resetAllMocks();
  filasBD = [];
  vi.mocked(query).mockImplementation((async (sql: string) => (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("LEFT JOIN tms_clientes") ? filasBD : [])) as never);
});

const plan = (over: Partial<PlanReporte> = {}): PlanReporte => ({
  id: 1, codigo: "PLAN-1", fechaPlan: "2026-12-15", horaCarga: null, estado: "En ruta", pendienteCierre: true, cerradoPor: null, cerradoEn: null,
  clienteId: null, cliente: "Cliente X", rutaCodigo: null, lugarDescargaHistorico: null, referenciaCliente: null, tipoTraslado: null,
  regresoEstimado: null, tarifaComercial: 1250, tarifaId: null, tarifaNombre: null, tarifaMontoSnapshot: null, tarifaMoneda: null,
  placa: "C-123ABC", unidadTipo: "Camion", unidadCapacidad: "5 toneladas", pilotoId: null, piloto: "Juan", auxiliares: [], paradas: [],
  evidencias: 0, horaSalida: null, horaLlegada: null, kmSalida: null, kmLlegada: null, kmRecorridos: null, diasRuta: null,
  estadoFacturacion: "No aplica", facturaId: null, numeroFactura: null, estadoAdminFactura: null, estadoFinancieroFactura: null,
  montoFacturadoViaje: null, montoBorradorViaje: null, totalFactura: null, totalPagadoFactura: null, saldoFactura: null,
  vehiculoSolicitado: "Camión 2.5 toneladas", ...over,
});

describe("helpers puros", () => {
  it("10) histórico sin dato => '—' (nunca se infiere de la unidad)", () => {
    expect(textoVehiculoSolicitado(null)).toBe("—");
    expect(textoVehiculoSolicitado(undefined)).toBe("—");
    expect(textoVehiculoSolicitado("  ")).toBe("—");
    expect(textoVehiculoSolicitado("Camión 2.5 toneladas")).toBe("Camión 2.5 toneladas");
  });
  it("unidad utilizada = placa + capacidad REAL de Flota", () => {
    expect(textoUnidadUtilizada("C-123ABC", "5 toneladas")).toBe("C-123ABC — 5 toneladas");
    expect(textoUnidadUtilizada("C-123ABC", null)).toBe("C-123ABC");
    expect(textoUnidadUtilizada(null, null)).toBe("—");
  });
  it("opciones: perfiles activos + el valor actual aunque ya no esté activo (no se pierde al editar)", () => {
    const cat = [{ id: 11, codigo: "CAMION_2_5T", nombre: "Camión 2.5 toneladas" }];
    expect(opcionesVehiculoSolicitado(cat, { id: null, nombre: null })).toEqual([{ id: 11, etiqueta: "Camión 2.5 toneladas" }]);
    expect(opcionesVehiculoSolicitado(cat, { id: 13, nombre: "Panel" })[0]).toEqual({ id: 13, etiqueta: "Panel (no activo en el catálogo)" });
    expect(opcionesVehiculoSolicitado(cat, { id: 11, nombre: "Camión 2.5 toneladas" })).toHaveLength(1);
  });
  it("PATCH: solo se envía si cambió; 0 => null (quitar)", () => {
    expect(cambioVehiculoSolicitado(11, 11)).toBeUndefined();
    expect(cambioVehiculoSolicitado(null, 0)).toBeUndefined();
    expect(cambioVehiculoSolicitado(undefined, 0)).toBeUndefined();
    expect(cambioVehiculoSolicitado(11, 12)).toBe(12);
    expect(cambioVehiculoSolicitado(11, 0)).toBeNull();
    expect(cambioVehiculoSolicitado(null, 12)).toBe(12);
  });
  it("14) para las reglas por estado es un dato COMERCIAL (mismo trato que tarifa/referencia), no un recurso", () => {
    expect(camposTocados({ vehiculoSolicitadoPerfilId: 12 })).toMatchObject({ comercial: true, unidad: false, piloto: false, auxiliares: false });
    expect(camposTocados({ vehiculoSolicitadoPerfilId: null }).comercial).toBe(true);
    expect(camposTocados({}).comercial).toBe(false);
  });
});

describe("catálogo reutilizado: perfiles de costeo por empresa", () => {
  it("11) lista solo los ACTIVOS de la empresa (id/código/nombre, sin datos de costo)", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ id: 11, codigo: "CAMION_2_5T", nombre: "Camión 2.5 toneladas" }] as never);
    expect(await listarVehiculosSolicitables(7)).toEqual([{ id: 11, codigo: "CAMION_2_5T", nombre: "Camión 2.5 toneladas" }]);
    const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM tms_cotizacion_costeo_perfiles");
    expect(sql).toContain("WHERE empresa_id = ? AND activo = 1");
    expect(sql).not.toMatch(/costo|gps|seguro|deprec/i);
    expect(params).toEqual([7]);
  });
  it("sin la tabla (Cotizaciones no migrado) el selector queda vacío, sin romper el formulario", async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error("no such table"));
    expect(await listarVehiculosSolicitables(7)).toEqual([]);
  });
  it("11) resolver para asignar exige empresa + id + activo", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    expect(await resolverVehiculoSolicitado(7, 99)).toBeNull();
    const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE empresa_id = ? AND id = ? AND activo = 1");
    expect(params).toEqual([7, 99]);
  });
  it("GET /tms/catalogos lo expone (aditivo) con la empresa de la sesión", () => {
    const src = readFileSync("src/app/api/empresas/[slug]/tms/catalogos/route.ts", "utf8");
    expect(src).toContain("listarVehiculosSolicitables(eid)");
    expect(src).toMatch(/personal,\n\s+vehiculosSolicitables,/);
  });
});

describe("Planes / Viajes (contrato del reporte)", () => {
  it("4) el reporte trae el vehículo solicitado junto a la unidad real (independientes)", async () => {
    filasBD = [fila()];
    const [p] = await obtenerReporteViajes(7, {});
    expect(p).toMatchObject({ vehiculoSolicitado: "Camión 2.5 toneladas", vehiculoSolicitadoPerfilId: 11, placa: "C-123ABC", unidadCapacidad: "5 toneladas", tarifaComercial: 1250 });
    const sql = String(vi.mocked(query).mock.calls.find((c) => String(c[0]).includes("LEFT JOIN tms_clientes"))![0]);
    expect(sql).toContain("p.vehiculo_solicitado_perfil_id, p.vehiculo_solicitado_nombre");
  });
  it("10) histórico NULL => null (la UI muestra '—')", async () => {
    filasBD = [fila({ vehiculo_solicitado_perfil_id: null, vehiculo_solicitado_nombre: null })];
    const [p] = await obtenerReporteViajes(7, {});
    expect(p.vehiculoSolicitado).toBeNull();
    expect(textoVehiculoSolicitado(p.vehiculoSolicitado)).toBe("—");
  });
  it("sin la migración: reintenta sin las columnas nuevas pero CONSERVA el TC", async () => {
    const sqls: string[] = [];
    vi.mocked(query).mockImplementation((async (sql: string) => {
      const s = String(sql);
      if (!s.includes("LEFT JOIN tms_clientes")) return [];
      sqls.push(s);
      if (s.includes("vehiculo_solicitado")) throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 });
      return [fila({ vehiculo_solicitado_perfil_id: undefined, vehiculo_solicitado_nombre: undefined, tc_placa_historica: "TC-1" })];
    }) as never);
    const [p] = await obtenerReporteViajes(7, {});
    expect(sqls).toHaveLength(2);
    expect(sqls[1]).toContain("p.tc_placa_historica");
    expect(p).toMatchObject({ vehiculoSolicitado: null, tcPlaca: "TC-1" });
  });
  it("pantalla: tabla (bajo la placa), expediente y confirmación de cierre lo muestran", () => {
    const src = readFileSync("src/app/e/[slug]/planes/planes-viajes-client.tsx", "utf8");
    expect(src).toContain("Solicitado: {textoVehiculoSolicitado(p.vehiculoSolicitado)}");
    expect(src).toContain("<li>{ETIQUETA_VEHICULO_SOLICITADO}: {textoVehiculoSolicitado(p.vehiculoSolicitado)}</li>");
    expect(src).toContain("<li>{ETIQUETA_VEHICULO_SOLICITADO}: {r.vehiculoSolicitado}</li>");
    expect(src).toContain("<li>Unidad utilizada: {r.unidadUtilizada}</li>");
  });
});

describe("cierre", () => {
  it("7/12) la revisión previa al cierre muestra solicitado vs. utilizado; la diferencia es válida (informativa)", () => {
    const r = resumenCierre(plan());
    expect(r.vehiculoSolicitado).toBe("Camión 2.5 toneladas");
    expect(r.unidadUtilizada).toBe("C-123ABC — 5 toneladas");
    expect(r.tarifa).toContain("1,250");
    expect(resumenCierre(plan({ vehiculoSolicitado: null })).vehiculoSolicitado).toBe("—");
  });
  it("12/13) el cierre (normal, manual, masivo y por período) NO depende del dato: ningún endpoint de cierre lo lee ni lo valida", () => {
    for (const f of [
      "src/app/api/empresas/[slug]/tms/planes/[id]/cerrar/route.ts",
      "src/app/api/empresas/[slug]/tms/planes/cerrar-masivo/route.ts",
      "src/app/api/empresas/[slug]/tms/planes/cerrar-masivo-periodo/route.ts",
    ]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/vehiculo_?solicitado/i);
    }
  });
});

describe("reportes / exportaciones", () => {
  it("5) Excel de Planes/Viajes: 'Vehículo solicitado' al FINAL, separado de Equipo asignado/Identificación vehículo", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" } } as never);
    vi.mocked(query).mockImplementation((async (sql: string) => {
      const s = String(sql);
      if (s.includes("LEFT JOIN tms_clientes")) return [fila(), fila({ id: 2, codigo: "PLAN-2", vehiculo_solicitado_perfil_id: null, vehiculo_solicitado_nombre: null })];
      if (s.includes("COUNT(")) return [{ total: 2 }];
      return [];
    }) as never);
    const r = await exportar(new Request("http://x/api/x/export?formato=xlsx&fechaDesde=2026-12-01&fechaHasta=2026-12-31"), { params: Promise.resolve({ slug: "kt" }) });
    expect(r.status).toBe(200);
    const arg = vi.mocked(tablaAExcel).mock.calls[0][0] as { headers: string[]; rows: string[][] };
    expect(arg.headers.at(-1)).toBe("Vehículo solicitado");
    expect(arg.headers.slice(0, 4)).toEqual(["Fecha", "Cliente", "Equipo asignado", "Identificación vehículo"]);
    expect(arg.rows.map((f) => [f[3], f.at(-1)])).toEqual([["C-123ABC", "Camión 2.5 toneladas"], ["C-123ABC", "—"]]);
    expect(arg.rows.every((f) => f.length === arg.headers.length)).toBe(true);
  });
  it("5) PDF historial: columna nueva al final del arreglo (índice 17), en el renglón de la unidad; no mueve las demás", () => {
    expect(HEADERS_OPERATIVOS[17]).toBe("Vehículo solicitado");
    expect(HEADERS_OPERATIVOS[4]).toBe("Unidad / placa");
    expect(HEADERS_OPERATIVOS[16]).toBe("TC / Caja / Remolque");
    expect(filaOperativa(plan())[17]).toBe("Camión 2.5 toneladas");
    expect(filaOperativa(plan({ vehiculoSolicitado: null }))[17]).toBe("—");
    expect(readFileSync("src/lib/tms/reporte-viajes-historial-pdf.ts", "utf8")).toContain("label: HEADERS_OPERATIVOS[17], valor: v[17]");
  });
  it("5) los generadores reales de PDF (historial y por viaje) siguen produciendo un PDF válido con y sin dato", async () => {
    const hist = await reporteViajesHistorialPdf({ empresaNombre: "KT", generadoEn: "hoy", filtros: {}, kpis: { totalViajes: 2 } as never, planes: [plan(), plan({ id: 2, vehiculoSolicitado: null })] });
    expect(hist.subarray(0, 4).toString()).toBe("%PDF");
    const uno = await reporteViajePdf("KT", plan());
    expect(uno.subarray(0, 4).toString()).toBe("%PDF");
    expect(readFileSync("src/lib/tms/reporte-viaje-pdf.ts", "utf8")).toContain("campo(ETIQUETA_VEHICULO_SOLICITADO, textoVehiculoSolicitado(p.vehiculoSolicitado));");
  });
});

describe("Programación (formulario y tablero)", () => {
  const form = readFileSync("src/app/e/[slug]/programacion/plan-form.tsx", "utf8");
  const tablero = readFileSync("src/app/e/[slug]/programacion/programacion-client.tsx", "utf8");
  it("Nuevo viaje / Ajustar: campo propio con ayuda, separado de Unidad, para Propio y Tercerizado", () => {
    expect(form).toContain("{ETIQUETA_VEHICULO_SOLICITADO_LARGA}");
    expect(form).toContain("{AYUDA_VEHICULO_SOLICITADO}");
    // el campo va fuera del bloque `form.tipoViaje === "Propio" ? (` (aplica también a Tercerizado)
    const campo = form.indexOf("{ETIQUETA_VEHICULO_SOLICITADO_LARGA}");
    expect(campo).toBeLessThan(form.indexOf('{form.tipoViaje === "Propio" ? ('));
  });
  it("POST manda el id elegido; PATCH solo si cambió, con el mismo gate pre-cierre que la tarifa", () => {
    expect(form).toContain("vehiculoSolicitadoPerfilId: form.vehiculoSolicitadoPerfilId > 0 ? form.vehiculoSolicitadoPerfilId : undefined,");
    expect(form).toContain("cambioVehiculoSolicitado(plan?.vehiculo_solicitado_perfil_id, form.vehiculoSolicitadoPerfilId)");
    expect(form).toMatch(/vehiculoSolicitadoPerfilId: bloqueadoParaPreCierre\s*\?\s*undefined/);
  });
  it("6/8) cambiar la unidad o la tarifa en el formulario NO toca el vehículo solicitado (y viceversa)", () => {
    const onChangeVs = form.slice(form.indexOf("value={form.vehiculoSolicitadoPerfilId}"), form.indexOf("{AYUDA_VEHICULO_SOLICITADO}"));
    expect(onChangeVs).toContain("setForm((f) => ({ ...f, vehiculoSolicitadoPerfilId: Number(e.target.value) }))");
    expect(onChangeVs).not.toMatch(/placa|tarifa/i);
    expect((form.match(/vehiculoSolicitadoPerfilId:/g) ?? []).length).toBe(4); // estado inicial, setForm, POST, PATCH
  });
  it("3) el tablero de Programación muestra el dato ('—' si no hay)", () => {
    expect(tablero).toContain("{textoVehiculoSolicitado(p.vehiculo_solicitado_nombre)}");
  });
});

describe("migración SQL (preparada, NO ejecutada)", () => {
  const sql = readFileSync("sql/migrate-2026-10-programacion-vehiculo-solicitado.sql", "utf8");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("aditiva e idempotente: columnas NULL, índice y FK compuesta por empresa, todo IF NOT EXISTS", () => {
    expect(codigo).toContain("ADD COLUMN IF NOT EXISTS vehiculo_solicitado_perfil_id INT NULL");
    expect(codigo).toContain("ADD COLUMN IF NOT EXISTS vehiculo_solicitado_nombre VARCHAR(120) NULL");
    expect(codigo).toContain("ADD INDEX IF NOT EXISTS idx_tmsplan_vehiculo_solicitado (empresa_id, vehiculo_solicitado_perfil_id)");
    expect(codigo).toMatch(/FOREIGN KEY IF NOT EXISTS \(empresa_id, vehiculo_solicitado_perfil_id\)\s+REFERENCES tms_cotizacion_costeo_perfiles\(empresa_id, id\)/);
  });
  it("sin backfill ni operaciones destructivas (históricos quedan NULL)", () => {
    const sinAccionesFk = codigo.replace(/ON (DELETE|UPDATE) RESTRICT/g, "");
    expect(sinAccionesFk).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i);
    expect(codigo).not.toMatch(/NOT NULL DEFAULT/);
  });
  it("schema.sql queda alineado", () => {
    const schema = readFileSync("sql/schema.sql", "utf8");
    expect(schema).toContain("vehiculo_solicitado_perfil_id INT NULL,");
    expect(schema).toContain("fk_tmsplan_vehiculo_solicitado");
  });
});
