import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViajesCerrar: vi.fn() }));
vi.mock("@/lib/tms/reportes-viajes", () => ({ obtenerCandidatosCierre: vi.fn() }));

import { requireTenantViajesCerrar } from "@/lib/tenant";
import { obtenerCandidatosCierre } from "@/lib/tms/reportes-viajes";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const get = (qs: string) => GET(new Request(`http://x/api?${qs}`), ctx);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViajesCerrar).mockResolvedValue({ session: { username: "jefe" }, empresa: { id: 7 } } as never);
  vi.mocked(obtenerCandidatosCierre).mockResolvedValue([]);
});

describe("GET /tms/planes/candidatos-cierre — seguridad", () => {
  it("19) exige viajes_cerrar:editar; sin permiso devuelve el error del guard y no consulta nada", async () => {
    vi.mocked(requireTenantViajesCerrar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await get("agrupacion=DIA&valor=2026-09-30");
    expect(res.status).toBe(403);
    expect(requireTenantViajesCerrar).toHaveBeenCalledWith("acme", "editar");
    expect(obtenerCandidatosCierre).not.toHaveBeenCalled();
  });

  it("empresa_id siempre sale del guard (nunca del query string)", async () => {
    await get("agrupacion=DIA&valor=2026-09-30&empresaId=999");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, expect.anything());
  });
});

describe("GET /tms/planes/candidatos-cierre — validación de período (20)", () => {
  it("sin ?agrupacion -> 400", async () => {
    const res = await get("valor=2026-09-30");
    expect(res.status).toBe(400);
    expect(obtenerCandidatosCierre).not.toHaveBeenCalled();
  });

  it("?agrupacion no reconocida -> 400", async () => {
    const res = await get("agrupacion=ANIO&valor=2026");
    expect(res.status).toBe(400);
  });

  it("?valor con formato inválido para la agrupación -> 400", async () => {
    expect((await get("agrupacion=DIA&valor=30-09-2026")).status).toBe(400);
    expect((await get("agrupacion=SEMANA&valor=2026-40")).status).toBe(400);
    expect((await get("agrupacion=MES&valor=2026-13")).status).toBe(400);
    expect(obtenerCandidatosCierre).not.toHaveBeenCalled();
  });
});

const SIN_VISTA = { soloPendientesCierre: false, soloCerrados: false, soloSinCerrar: false };

describe("GET /tms/planes/candidatos-cierre — resolución (16/17/18)", () => {
  it("DIA: fechaDesde = fechaHasta = la fecha exacta", async () => {
    await get("agrupacion=DIA&valor=2026-09-30");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, { fechaDesde: "2026-09-30", fechaHasta: "2026-09-30", ...SIN_VISTA });
  });

  it("SEMANA: fechaDesde/fechaHasta = lunes/domingo de esa semana ISO", async () => {
    await get("agrupacion=SEMANA&valor=2026-W40");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, { fechaDesde: "2026-09-28", fechaHasta: "2026-10-04", ...SIN_VISTA });
  });

  it("MES: fechaDesde/fechaHasta = primer/último día del mes", async () => {
    await get("agrupacion=MES&valor=2026-09");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, { fechaDesde: "2026-09-01", fechaHasta: "2026-09-30", ...SIN_VISTA });
  });

  it("19) reenvía los filtros activos (cliente/piloto/unidad/estado/ruta/facturación/cobro)", async () => {
    await get("agrupacion=MES&valor=2026-09&clienteId=5&pilotoId=9&unidadId=3&estado=Descargado&ruta=Xela&estadoFacturacion=Facturado&estadoCobro=Cobrado");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, {
      fechaDesde: "2026-09-01", fechaHasta: "2026-09-30",
      clienteId: 5, pilotoId: 9, unidadId: 3, estado: "Descargado", ruta: "Xela",
      estadoFacturacion: "Facturado", estadoCobro: "Cobrado",
      ...SIN_VISTA,
    });
  });

  it("filtros ausentes/no reconocidos se omiten (undefined), nunca se envían strings vacíos o valores inválidos", async () => {
    await get("agrupacion=MES&valor=2026-09&estadoFacturacion=NoExiste&clienteId=abc");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, { fechaDesde: "2026-09-01", fechaHasta: "2026-09-30", ...SIN_VISTA });
  });
});

/**
 * Corrección pre-merge PR #386 (bloqueo 1, ítems 4/8) — soloPendientesCierre/soloCerrados/soloSinCerrar se
 * aceptan como booleano REAL (`=== "1"`, nunca un string arbitrario confiado directamente) y se reenvían,
 * manteniendo SIEMPRE fechaDesde/fechaHasta = periodo.desde/hasta (el período nunca se ignora, ver caso A).
 */
describe("GET /tms/planes/candidatos-cierre — filtros de vista (bloqueo 1)", () => {
  it("4) soloPendientesCierre=1 se traduce a boolean true y se reenvía", async () => {
    await get("agrupacion=MES&valor=2026-09&soloPendientesCierre=1");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, {
      fechaDesde: "2026-09-01", fechaHasta: "2026-09-30",
      soloPendientesCierre: true, soloCerrados: false, soloSinCerrar: false,
    });
  });

  it("soloCerrados=1 se traduce a boolean true y se reenvía", async () => {
    await get("agrupacion=MES&valor=2026-09&soloCerrados=1");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, {
      fechaDesde: "2026-09-01", fechaHasta: "2026-09-30",
      soloPendientesCierre: false, soloCerrados: true, soloSinCerrar: false,
    });
  });

  it("soloSinCerrar=1 se traduce a boolean true y se reenvía", async () => {
    await get("agrupacion=MES&valor=2026-09&soloSinCerrar=1");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, {
      fechaDesde: "2026-09-01", fechaHasta: "2026-09-30",
      soloPendientesCierre: false, soloCerrados: false, soloSinCerrar: true,
    });
  });

  it("valores distintos de '1' (string arbitrario) NUNCA se interpretan como true", async () => {
    await get("agrupacion=MES&valor=2026-09&soloPendientesCierre=true&soloCerrados=yes&soloSinCerrar=0");
    expect(obtenerCandidatosCierre).toHaveBeenCalledWith(7, { fechaDesde: "2026-09-01", fechaHasta: "2026-09-30", ...SIN_VISTA });
  });
});

describe("GET /tms/planes/candidatos-cierre — respuesta mínima (8)", () => {
  it("cuenta elegibles NORMAL y MANUAL por separado, con el criterio puro compartido (todos CON tarifa)", async () => {
    vi.mocked(obtenerCandidatosCierre).mockResolvedValue([
      { id: 1, codigo: "VJ-1", estado: "Descargado", llegadaRegistrada: false, tarifaComercial: 500 }, // normal
      { id: 2, codigo: "VJ-2", estado: "Programado", llegadaRegistrada: false, tarifaComercial: 500 }, // manual
      { id: 3, codigo: "VJ-3", estado: "Cerrado", llegadaRegistrada: false, tarifaComercial: 500 }, // ninguno
    ]);
    const res = await get("agrupacion=MES&valor=2026-09");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      periodo: { agrupacion: "MES", valor: "2026-09", etiqueta: "Septiembre 2026", desde: "2026-09-01", hasta: "2026-09-30" },
      total: 3,
      normal: { elegibles: 1, ids: [1] },
      manual: { elegibles: 1, ids: [2] },
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("no expone cliente/piloto/tarifa/facturación de los candidatos (solo ids y conteos)", async () => {
    vi.mocked(obtenerCandidatosCierre).mockResolvedValue([{ id: 1, codigo: "VJ-1", estado: "Descargado", llegadaRegistrada: false, tarifaComercial: 500 }]);
    const body = await (await get("agrupacion=DIA&valor=2026-09-30")).json();
    const texto = JSON.stringify(body);
    expect(texto).not.toContain("cliente");
    expect(texto).not.toContain("tarifa");
    expect(texto).not.toContain("VJ-1"); // ni siquiera el código — solo el id numérico
  });

  it("21) sin candidatos en el período -> total/elegibles en 0, nunca un error", async () => {
    const res = await get("agrupacion=MES&valor=2026-09");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total: 0, normal: { elegibles: 0, ids: [] }, manual: { elegibles: 0, ids: [] } });
  });
});

/**
 * PLANES-TARIFA-CIERRE-1 (22-25) — la vista previa ya informa la cantidad REAL que podrá cerrarse: un
 * candidato sin tarifa nunca cuenta como elegible (ni normal ni manual), aunque sí sigue contando en `total`
 * (total = "viajes encontrados en el período", no "viajes cerrables").
 */
describe("GET /tms/planes/candidatos-cierre — tarifa (PLANES-TARIFA-CIERRE-1)", () => {
  it("23/24/25) un candidato sin tarifa (null) se excluye de normal.elegibles Y manual.elegibles, pero sigue contando en total", async () => {
    vi.mocked(obtenerCandidatosCierre).mockResolvedValue([
      { id: 1, codigo: "VJ-1", estado: "Descargado", llegadaRegistrada: false, tarifaComercial: 500 }, // normal, CON tarifa
      { id: 2, codigo: "VJ-2", estado: "Descargado", llegadaRegistrada: false, tarifaComercial: null }, // sería normal, pero SIN tarifa
      { id: 3, codigo: "VJ-3", estado: "Programado", llegadaRegistrada: false, tarifaComercial: null }, // sería manual, pero SIN tarifa
    ]);
    const res = await get("agrupacion=MES&valor=2026-09");
    const body = await res.json();
    expect(body).toMatchObject({
      total: 3, // total = encontrados en el período, no "cerrables"
      normal: { elegibles: 1, ids: [1] },
      manual: { elegibles: 0, ids: [] },
    });
  });

  it("Q0.00 (tarifaComercial = 0, no null) SÍ cuenta como elegible", async () => {
    vi.mocked(obtenerCandidatosCierre).mockResolvedValue([{ id: 1, codigo: "VJ-1", estado: "Descargado", llegadaRegistrada: false, tarifaComercial: 0 }]);
    const res = await get("agrupacion=MES&valor=2026-09");
    expect(await res.json()).toMatchObject({ normal: { elegibles: 1, ids: [1] } });
  });
});
