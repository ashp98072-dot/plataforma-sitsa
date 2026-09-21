import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));

import { query } from "@/lib/db";
import { planesConCierreManual } from "./cierre-manual-planes";
import { reporteViajePdf } from "./reporte-viaje-pdf";
import { obtenerReporteViajes, type PlanReporte } from "./reportes-viajes";
import {
  TEXTO_CIERRE_MANUAL,
  TEXTO_REGRESO_REAL_NO_REGISTRADO,
  TEXTO_SIN_REGRESO_ESTIMADO,
  regresoUnico,
  resumenRegreso,
} from "./regreso-viaje";

const fmt = (v: string | null) => (v ? v.replace("T", " ") : "—");
const ENTRADA = { estado: "En ruta", regresoEstimado: null, regresoReal: null, cerradoEn: null } as const;

describe("resumenRegreso — tres datos distintos que nunca se mezclan", () => {
  it("sin regreso estimado: «No indicado» (no se inventa una fecha) y sin regreso real mientras el viaje siga abierto", () => {
    expect(resumenRegreso({ ...ENTRADA }, fmt)).toEqual({ estimado: TEXTO_SIN_REGRESO_ESTIMADO, real: null, cierreAdministrativo: null, notaCierreManual: null });
  });

  it("con regreso estimado: se muestra tal cual, aparte del real", () => {
    const r = resumenRegreso({ ...ENTRADA, regresoEstimado: "2026-09-30T17:00" }, fmt);
    expect(r.estimado).toBe("2026-09-30 17:00");
    expect(r.real).toBeNull();
  });

  it("la llegada registrada por Flota se muestra como «Regreso real» (viaje aún no cerrado)", () => {
    const r = resumenRegreso({ ...ENTRADA, regresoReal: "2026-09-30T15:40", regresoEstimado: "2026-09-30T17:00" }, fmt);
    expect(r).toMatchObject({ estimado: "2026-09-30 17:00", real: "2026-09-30 15:40", cierreAdministrativo: null, notaCierreManual: null });
  });

  it("viaje sin regreso estimado con llegada real: el real aparece y el estimado sigue «No indicado»", () => {
    const r = resumenRegreso({ ...ENTRADA, estado: "Cerrado", regresoReal: "2026-09-30T15:40", cerradoEn: "2026-10-01T08:00" }, fmt);
    expect(r).toMatchObject({ estimado: "No indicado", real: "2026-09-30 15:40", cierreAdministrativo: null });
  });

  it("Cerrado SIN llegada física: «Regreso real: No registrado» + cierre administrativo; cerrado_en NO se presenta como llegada", () => {
    const r = resumenRegreso({ ...ENTRADA, estado: "Cerrado", cerradoEn: "2026-10-01T08:00" }, fmt);
    expect(r.real).toBe(TEXTO_REGRESO_REAL_NO_REGISTRADO);
    expect(r.cierreAdministrativo).toBe("2026-10-01 08:00");
    expect(r.real).not.toContain("2026-10-01");
  });

  it("cierre manual sin llegada: agrega «Cierre manual / sin llegada física registrada»", () => {
    const r = resumenRegreso({ ...ENTRADA, estado: "Cerrado", cerradoEn: "2026-10-01T08:00", cierreManual: true }, fmt);
    expect(r.notaCierreManual).toBe(TEXTO_CIERRE_MANUAL);
    expect(TEXTO_CIERRE_MANUAL).toBe("Cierre manual / sin llegada física registrada");
  });

  it("cierre manual pero con llegada real ya registrada: se muestra la llegada y no se rotula como «sin llegada»", () => {
    const r = resumenRegreso({ ...ENTRADA, estado: "Cerrado", regresoReal: "2026-09-30T15:40", cerradoEn: "2026-10-01T08:00", cierreManual: true }, fmt);
    expect(r.real).toBe("2026-09-30 15:40");
    expect(r.notaCierreManual).toBeNull();
    expect(r.cierreAdministrativo).toBeNull();
  });

  it("un viaje no cerrado nunca muestra cierre administrativo ni nota de cierre manual", () => {
    const r = resumenRegreso({ ...ENTRADA, cerradoEn: "2026-10-01T08:00", cierreManual: true }, fmt);
    expect(r.cierreAdministrativo).toBeNull();
    expect(r.notaCierreManual).toBeNull();
  });
});

describe("regresoUnico — una sola columna «Regreso»: real > estimado > —", () => {
  it("prioriza el real e indica su tipo", () => {
    expect(regresoUnico("2026-09-30T15:40", "2026-09-30T17:00", fmt)).toEqual({ valor: "2026-09-30 15:40", tipo: "Real" });
  });
  it("sin real usa el estimado e indica «Estimado»", () => {
    expect(regresoUnico(null, "2026-09-30T17:00", fmt)).toEqual({ valor: "2026-09-30 17:00", tipo: "Estimado" });
  });
  it("sin ninguno: «—»", () => {
    expect(regresoUnico(null, null, fmt)).toEqual({ valor: "—", tipo: null });
  });
});

describe("planesConCierreManual — aislamiento y tolerancia", () => {
  beforeEach(() => vi.resetAllMocks());

  it("consulta por empresa_id y solo los ids pedidos; devuelve los que tienen cierre_manual = 1", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 5, cierre_manual: 1 }, { id: 6, cierre_manual: 0 }] as never);
    const ids = await planesConCierreManual(9, [5, 6, 5]);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("empresa_id = ?");
    expect(params).toEqual([9, 5, 6]);
    expect([...ids]).toEqual([5]);
  });

  it("sin ids no consulta; ids inválidos se descartan", async () => {
    expect((await planesConCierreManual(9, [])).size).toBe(0);
    expect((await planesConCierreManual(9, [0, -1, 1.5])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("si la consulta falla (columna inexistente) no rompe: ningún plan marcado", async () => {
    vi.mocked(query).mockRejectedValue(new Error("Unknown column"));
    expect((await planesConCierreManual(9, [5])).size).toBe(0);
  });

  it("es solo lectura", () => {
    const fuente = readFileSync("src/lib/tms/cierre-manual-planes.ts", "utf8");
    expect(fuente).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER)\b/);
  });
});

describe("obtenerReporteViajes — reportes históricos", () => {
  const filaReporte = (over: Record<string, unknown> = {}) => ({
    id: 1, codigo: "PLAN-1", fecha_plan: "2026-09-10", hora_carga: "08:00:00", estado: "Cerrado", cerrado_por: "hsitan",
    cerrado_en: "2026-09-11T09:00", pendiente_cierre: 0, cliente_id: 1, cliente: "Acme", regreso_estimado: null, evidencias: 0,
    hora_salida: "2026-09-10T08:00", hora_llegada: "2026-09-10T17:00", km_salida: 100, km_llegada: 250, ...over,
  });
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("mantiene regresoEstimado y agrega regresoReal (= hora_llegada) sin reemplazar una columna por otra", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("SELECT p.id, p.codigo") ? [filaReporte({ regreso_estimado: "2026-09-10T16:00" })] : [])) as never);
    const [plan] = await obtenerReporteViajes(7, {});
    expect(plan.regresoEstimado).toBe("2026-09-10T16:00");
    expect(plan.regresoReal).toBe("2026-09-10T17:00");
    expect(plan.horaLlegada).toBe("2026-09-10T17:00");
    expect(plan.cerradoEn).toBe("2026-09-11T09:00");
    expect(plan.cierreManual).toBe(false);
  });

  it("cierre manual sin llegada: regresoReal null, cerradoEn conservado y cierreManual true", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (String(sql).includes("SELECT p.id, p.codigo")) return [filaReporte({ hora_llegada: null, km_llegada: null })];
      if (String(sql).includes("cierre_manual")) return [{ id: 1, cierre_manual: 1 }];
      return [];
    }) as never);
    const [plan] = await obtenerReporteViajes(7, {});
    expect(plan).toMatchObject({ regresoEstimado: null, regresoReal: null, horaLlegada: null, cierreManual: true, cerradoEn: "2026-09-11T09:00" });
  });

  it("un reporte de planes sin Cerrado no hace la consulta de cierre manual", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => (String(sql).includes("SELECT p.id, p.codigo") ? [filaReporte({ estado: "En ruta", cerrado_en: null, hora_llegada: null })] : [])) as never);
    await obtenerReporteViajes(7, {});
    expect(vi.mocked(query).mock.calls.some((c) => String(c[0]).includes("cierre_manual"))).toBe(false);
  });
});

describe("PDF individual del viaje — regreso estimado / real / cierre", () => {
  afterEach(() => vi.restoreAllMocks());
  const plan = (over: Partial<PlanReporte> = {}): PlanReporte => ({
    id: 1, codigo: "PLAN-20260910-001", fechaPlan: "2026-09-10", horaCarga: "08:00:00", estado: "Cerrado", pendienteCierre: false,
    cerradoPor: "hsitan", cerradoEn: "2026-09-11T09:00", clienteId: 1, cliente: "Acme", rutaCodigo: "R-1", lugarDescargaHistorico: null,
    referenciaCliente: null, tipoTraslado: "Directo", regresoEstimado: null, tarifaComercial: 1500, tarifaId: null, tarifaNombre: null,
    tarifaMontoSnapshot: null, tarifaMoneda: null, placa: "C-001", unidadTipo: null, unidadCapacidad: null, pilotoId: 2, piloto: "Juan",
    auxiliares: [], paradas: [], evidencias: 0, horaSalida: "2026-09-10T08:00", horaLlegada: "2026-09-10T17:00", kmSalida: 100, kmLlegada: 250,
    kmRecorridos: 150, diasRuta: 1, estadoFacturacion: "No aplica", facturaId: null, numeroFactura: null, estadoAdminFactura: null,
    estadoFinancieroFactura: null, montoFacturadoViaje: null, montoBorradorViaje: null, totalFactura: null, totalPagadoFactura: null, saldoFactura: null,
    ...over,
  });
  async function textos(p: PlanReporte) {
    const espia = vi.spyOn(PDFDocument.prototype, "text");
    await reporteViajePdf("KT", p);
    return espia.mock.calls.map((c) => String(c[0]));
  }

  it("sin regreso estimado imprime «No indicado» y el regreso real de la llegada registrada", async () => {
    const t = (await textos(plan())).join("\n");
    expect(t).toContain("Regreso estimado: ");
    expect(t).toContain("No indicado");
    expect(t).toContain("Regreso real: ");
    expect(t).toContain("2026-09-10 17:00");
  });

  it("cierre manual sin llegada: «Regreso real: No registrado», cierre administrativo y la nota; cerrado_en nunca como llegada", async () => {
    const t = (await textos(plan({ horaLlegada: null, regresoReal: null, cierreManual: true, kmLlegada: null }))).join("\n");
    expect(t).toContain("No registrado");
    expect(t).toContain(TEXTO_CIERRE_MANUAL);
    const lineaReal = t.split("\n").filter((x) => x.startsWith("Regreso real"));
    expect(lineaReal.join("|")).not.toContain("2026-09-11");
  });

  it("con regreso estimado lo sigue mostrando junto al real", async () => {
    const t = (await textos(plan({ regresoEstimado: "2026-09-10T16:00" }))).join("\n");
    expect(t).toContain("2026-09-10 16:00");
    expect(t).toContain("2026-09-10 17:00");
  });
});

describe("Formulario de Programación — regreso estimado opcional", () => {
  const form = readFileSync("src/app/e/[slug]/programacion/plan-form.tsx", "utf8").replace(/\r\n/g, "\n");

  it("etiqueta «Regreso estimado (opcional)» con la ayuda pedida, sin required", () => {
    expect(form).toContain('label="Regreso estimado (opcional)"');
    expect(form).toContain("Si no se conoce todavía, puede dejarse vacío. El regreso real se registrará automáticamente cuando");
    expect(form).toContain("finalice el viaje.");
    const campo = form.slice(form.indexOf("<FechaHora12Input"), form.indexOf("/>", form.indexOf("<FechaHora12Input")));
    expect(campo).not.toContain("required");
  });

  it("ya no exige el regreso ni muestra «(obligatorio)» cuando hay piloto/auxiliares/unidad", () => {
    expect(form).not.toContain("requiereRegreso");
    expect(form).not.toContain("Regreso estimado (obligatorio)");
    expect(form).not.toContain("Indica el regreso estimado");
  });

  it("sigue validando que, si se indica, sea posterior a la salida; y crear/editar envían vacío como ausente/null", () => {
    expect(form).toContain("El regreso estimado debe ser posterior a la salida programada.");
    expect(form).toContain("regresoEstimado: form.regresoEstimado || undefined,"); // crear
    expect(form).toContain("regresoEstimado: bloqueadoParaPreCierre ? undefined : form.regresoEstimado || null,"); // editar (deja null)
  });
});

describe("Atrasados por regreso estimado", () => {
  it("la campana de notificaciones solo cuenta viajes con regreso estimado vencido (IS NOT NULL)", () => {
    const fuente = readFileSync("src/app/api/empresas/[slug]/notificaciones/route.ts", "utf8");
    expect(fuente).toContain("AND p.regreso_estimado IS NOT NULL");
    expect(fuente).toContain("AND p.regreso_estimado < ?");
  });
});
