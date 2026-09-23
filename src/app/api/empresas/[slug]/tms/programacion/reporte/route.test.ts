import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantModulo: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));
vi.mock("@/lib/rrhh/export-files", () => ({
  tablaAExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx"))),
  tablaAPdf: vi.fn(() => Promise.resolve(Buffer.from("pdf"))),
}));

import { query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";
import { tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

/**
 * PROGRAMACION-REPORTES-FILTROS-1 — el reporte tradicional de
 * Programación (Excel/PDF) SOLO aceptaba fecha/fechaDesde/fechaHasta:
 * cualquier otro filtro activo en el tablero (Estado, Piloto, Unidad,
 * Cliente) se ignoraba al exportar. Estas pruebas cubren la corrección —
 * mismo criterio SQL que ya usa `visibles` en programacion-client.tsx.
 */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantModulo).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantModulo>>,
  );
  vi.mocked(query).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/programacion/reporte — exige permiso y rango de fechas", () => {
  it("exige el permiso de módulo TMS antes de consultar nada", async () => {
    vi.mocked(requireTenantModulo).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantModulo>>);
    const res = await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08"), ctx);
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("sin fecha/rango y sin estado=PendienteCierre, responde 400 (nunca exporta todo el histórico sin acotar)", async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("GET /tms/programacion/reporte — respeta estado (mismo criterio que el filtro rápido del tablero)", () => {
  it("estado=Cerrado exporta SOLO viajes cerrados", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Cerrado"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado = ?");
    expect(params).toContain("Cerrado");
  });

  it("estado=Programado exporta SOLO viajes programados", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Programado"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado = ?");
    expect(params).toContain("Programado");
  });

  it("un valor de estado no soportado se ignora (nunca se concatena texto arbitrario en el WHERE)", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=algo-invalido"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).not.toContain("p.estado = ?");
    expect(params).not.toContain("algo-invalido");
  });

  it("estado=PendienteCierre usa el MISMO criterio SQL que tms/planes?pendienteCierre=1 y reportes-viajes.ts, e ignora el rango de fechas", async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx&estado=PendienteCierre"), ctx);
    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado NOT IN ('Cerrado', 'Cancelado')");
    expect(sql).toContain("fv.estado = 'cerrado'");
    expect(sql).not.toContain("p.fecha_plan BETWEEN");
    expect(params).toEqual([7]);
  });
});

describe("GET /tms/programacion/reporte — respeta fechaDesde/fechaHasta", () => {
  it("aplica el rango exacto recibido", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.fecha_plan BETWEEN ? AND ?");
    expect(params).toEqual([7, "2026-09-01", "2026-09-08"]);
  });

  it("fecha=X (día específico) equivale a fechaDesde=fechaHasta=X", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fecha=2026-09-03"), ctx);
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toEqual([7, "2026-09-03", "2026-09-03"]);
  });
});

describe("GET /tms/programacion/reporte — respeta piloto/unidad/cliente (match exacto, igual que el tablero)", () => {
  it("filtra por piloto exacto", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&piloto=Carlos+Ruiz"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("pil.nombre = ?");
    expect(params).toContain("Carlos Ruiz");
  });

  it("filtra por unidad (placa) exacta", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&unidad=P123ABC"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("u.placa = ?");
    expect(params).toContain("P123ABC");
  });

  it("filtra por cliente exacto", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&cliente=Cliente+X"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("c.nombre = ?");
    expect(params).toContain("Cliente X");
  });

  it("combina fecha + estado + piloto + unidad + cliente en una sola consulta (AND, todos aplican a la vez)", async () => {
    await GET(new Request(
      "http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Cerrado&piloto=Carlos+Ruiz&unidad=P123ABC&cliente=Cliente+X",
    ), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.fecha_plan BETWEEN ? AND ?");
    expect(sql).toContain("p.estado = ?");
    expect(sql).toContain("pil.nombre = ?");
    expect(sql).toContain("u.placa = ?");
    expect(sql).toContain("c.nombre = ?");
    expect(params).toEqual([7, "2026-09-01", "2026-09-08", "Cerrado", "Carlos Ruiz", "P123ABC", "Cliente X"]);
  });
});

describe("GET /tms/programacion/reporte — aislamiento multiempresa", () => {
  it("siempre filtra por el empresa_id resuelto por requireTenantModulo, nunca por uno enviado por el cliente", async () => {
    vi.mocked(requireTenantModulo).mockResolvedValue(
      { empresa: { id: 42, nombre: "Otra Empresa" }, session: { id: 1, username: "x" } } as Awaited<ReturnType<typeof requireTenantModulo>>,
    );
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&empresaId=999"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.empresa_id = ?");
    expect(params?.[0]).toBe(42);
  });
});

describe("GET /tms/programacion/reporte — columnas del reporte tradicional sin cambios", () => {
  it("el Excel sigue sin incluir costo operativo de referencia, referencia de cliente ni observaciones (nunca los tuvo)", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08"), ctx);
    const headers = vi.mocked(tablaAExcel).mock.calls[0][0].headers;
    expect(headers).toEqual([
      "Mes", "Día", "Placa", "TC", "Piloto", "Auxiliar 1", "Auxiliar 2",
      "Código", "Cliente", "Lugar de Carga", "Hora", "Lugar de Descarga",
    ]);
  });

  it("formato=pdf sigue generando PDF (tablaAPdf) sin romper el flujo existente", async () => {
    const res = await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Cerrado"), ctx);
    expect(res.status).toBe(200);
    expect(tablaAPdf).toHaveBeenCalledTimes(1);
    const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
    expect(llamada.subtitle).toContain("Estado: Cerrado");
  });
});

/**
 * PROGRAMACION-EXPORT-PROGRAMADOS-FIX-1 (punto 2) — Operaciones pidió que
 * la columna "Código" (ruta_codigo_historico) desaparezca del reporte
 * ÚNICAMENTE cuando estado=Programado, sin afectar ningún otro estado.
 */
describe("GET /tms/programacion/reporte — columna Código SOLO se oculta para Programado", () => {
  it("estado=Programado: el Excel NO incluye la columna Código", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Programado"), ctx);
    const headers = vi.mocked(tablaAExcel).mock.calls[0][0].headers;
    expect(headers).toEqual([
      "Mes", "Día", "Placa", "TC", "Piloto", "Auxiliar 1", "Auxiliar 2",
      "Cliente", "Lugar de Carga", "Hora", "Lugar de Descarga",
    ]);
    expect(headers).not.toContain("Código");
  });

  it("estado=Programado: el PDF tampoco incluye la columna Código", async () => {
    await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Programado"), ctx);
    const headers = vi.mocked(tablaAPdf).mock.calls[0][0].headers;
    expect(headers).toEqual([
      "Mes", "Día", "Placa", "TC", "Piloto", "Auxiliar 1", "Auxiliar 2",
      "Cliente", "Lugar de Carga", "Hora", "Lugar de Descarga",
    ]);
    expect(headers).not.toContain("Código");
  });

  it("estado=Programado: las filas de datos tampoco traen la celda de Código (una columna menos, no una celda vacía)", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tms_plan_auxiliares")) return [];
      if (sql.includes("FROM tms_planes_viaje p")) {
        return [
          { id: 1, fecha_plan: "2026-09-01", hora_carga: "08:00:00", ruta_codigo_historico: "RUTA-9", lugar_descarga_historico: "Destino", cliente: "Acme", placa: "P123ABC", piloto: "Carlos Ruiz" },
        ];
      }
      return [];
    }) as typeof query);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Programado"), ctx);
    const fila = vi.mocked(tablaAExcel).mock.calls[0][0].rows[0];
    expect(fila).toHaveLength(11); // sin Código (12 columnas normales con TC - 1)
    expect(fila).not.toContain("RUTA-9"); // el código de ruta nunca aparece, ni en otra posición
  });

  it("estado=Cerrado: CONSERVA la columna Código (el recorte es solo para Programado)", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Cerrado"), ctx);
    const headers = vi.mocked(tablaAExcel).mock.calls[0][0].headers;
    expect(headers).toContain("Código");
  });

  it("sin estado (Todos): CONSERVA la columna Código", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08"), ctx);
    const headers = vi.mocked(tablaAExcel).mock.calls[0][0].headers;
    expect(headers).toContain("Código");
  });

  it("estado=En ruta: CONSERVA la columna Código", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=En+ruta"), ctx);
    const headers = vi.mocked(tablaAExcel).mock.calls[0][0].headers;
    expect(headers).toContain("Código");
  });
});

/**
 * PROGRAMACION-EXPORT-PROGRAMADOS-FIX-1 (punto 1) — reproduce el bug real:
 * la pantalla mostraba 2 viajes Programados y el Excel devolvía otro
 * conjunto. La causa era que el CLIENTE armaba fechaDesde/fechaHasta
 * desde un eje de fecha independiente del rango realmente visible (ver
 * programacion-client.tsx) — este endpoint en sí ya aplicaba fecha+estado
 * correctamente si se le pasaban los valores correctos. Estas pruebas
 * fijan el contrato exacto que el cliente corregido debe cumplir: mismos
 * query params (fecha+estado+piloto+unidad+cliente) => exactamente el
 * mismo conjunto de filas que el listado.
 */
describe("GET /tms/programacion/reporte — Programado: exporta EXACTAMENTE lo que se ve en pantalla", () => {
  const dosPlanesProgramados = [
    {
      id: 1, fecha_plan: "2026-09-10", hora_carga: "07:00:00", ruta_codigo_historico: null,
      lugar_descarga_historico: "Xela", cliente: "Cliente A", placa: "P111AAA", piloto: "Piloto Uno",
    },
    {
      id: 2, fecha_plan: "2026-09-10", hora_carga: "09:30:00", ruta_codigo_historico: null,
      lugar_descarga_historico: "Retalhuleu", cliente: "Cliente B", placa: "P222BBB", piloto: "Piloto Dos",
    },
  ];

  it("2 Programados en el rango visible -> el export devuelve EXACTAMENTE esos mismos 2, sin datos de otro viaje", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tms_plan_auxiliares")) return [];
      if (sql.includes("FROM tms_planes_viaje p")) return dosPlanesProgramados;
      return [];
    }) as typeof query);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-10&fechaHasta=2026-09-10&estado=Programado"), ctx);
    const filas = vi.mocked(tablaAExcel).mock.calls[0][0].rows;
    expect(filas).toHaveLength(2);
    // Placa/piloto/lugar de descarga de CADA fila deben corresponder a SU
    // PROPIO plan — nunca al del otro (placa index 2, piloto index 3, lugar
    // de descarga la última posición del arreglo, ver dataRows en route.ts).
    expect(filas[0]).toEqual(["SEP", "10", "P111AAA", "", "Piloto Uno", "", "", "Cliente A", "", "07:00", "Xela"]);
    expect(filas[1]).toEqual(["SEP", "10", "P222BBB", "", "Piloto Dos", "", "", "Cliente B", "", "09:30", "Retalhuleu"]);
  });

  it("respeta fechaDesde/fechaHasta también combinado con estado=Programado (no solo estado por separado)", async () => {
    vi.mocked(query).mockResolvedValue([]);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-10&fechaHasta=2026-09-12&estado=Programado"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.fecha_plan BETWEEN ? AND ?");
    expect(sql).toContain("p.estado = ?");
    expect(params).toEqual([7, "2026-09-10", "2026-09-12", "Programado"]);
  });

  it("respeta piloto combinado con estado=Programado", async () => {
    vi.mocked(query).mockResolvedValue([]);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-10&fechaHasta=2026-09-10&estado=Programado&piloto=Piloto+Uno"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado = ?");
    expect(sql).toContain("pil.nombre = ?");
    expect(params).toEqual([7, "2026-09-10", "2026-09-10", "Programado", "Piloto Uno"]);
  });

  it("respeta unidad combinado con estado=Programado", async () => {
    vi.mocked(query).mockResolvedValue([]);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-10&fechaHasta=2026-09-10&estado=Programado&unidad=P111AAA"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado = ?");
    expect(sql).toContain("u.placa = ?");
    expect(params).toEqual([7, "2026-09-10", "2026-09-10", "Programado", "P111AAA"]);
  });

  it("respeta cliente combinado con estado=Programado", async () => {
    vi.mocked(query).mockResolvedValue([]);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-10&fechaHasta=2026-09-10&estado=Programado&cliente=Cliente+A"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado = ?");
    expect(sql).toContain("c.nombre = ?");
    expect(params).toEqual([7, "2026-09-10", "2026-09-10", "Programado", "Cliente A"]);
  });

  it("no mezcla datos entre planes: auxiliares de un plan nunca aparecen en la fila de otro", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tms_plan_auxiliares")) {
        return [
          { plan_id: 1, nombre: "Aux Plan 1", orden: 1 },
          { plan_id: 2, nombre: "Aux Plan 2", orden: 1 },
        ];
      }
      if (sql.includes("FROM tms_planes_viaje p")) return dosPlanesProgramados;
      return [];
    }) as typeof query);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-10&fechaHasta=2026-09-10&estado=Programado"), ctx);
    const filas = vi.mocked(tablaAExcel).mock.calls[0][0].rows;
    // Auxiliar 1 (índice 4) de cada fila debe ser el auxiliar de SU plan.
    expect(filas[0][5]).toBe("Aux Plan 1");
    expect(filas[1][5]).toBe("Aux Plan 2");
  });

  it("multiempresa: el filtro estado=Programado nunca reemplaza la condición de empresa_id", async () => {
    vi.mocked(requireTenantModulo).mockResolvedValue(
      { empresa: { id: 42, nombre: "Otra Empresa" }, session: { id: 1, username: "x" } } as Awaited<ReturnType<typeof requireTenantModulo>>,
    );
    vi.mocked(query).mockResolvedValue([]);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-10&fechaHasta=2026-09-10&estado=Programado"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.empresa_id = ?");
    expect(sql).toContain("p.estado = ?");
    expect(params).toEqual([42, "2026-09-10", "2026-09-10", "Programado"]);
  });
});

/**
 * PROGRAMACION-VIAJES-TERCERIZADOS-1 (sección 20) — un viaje Tercerizado
 * nunca tiene placa/piloto/auxiliares internos (unidad_id/piloto_id/
 * tms_plan_auxiliares quedan vacíos a propósito): el reporte tradicional
 * debe completar esas celdas con el snapshot de texto, nunca dejarlas
 * vacías solo porque no hay id interno, y marcar "(Tercerizado)" en Piloto.
 */
describe("GET /tms/programacion/reporte — viajes Tercerizados usan el snapshot de texto", () => {
  const planTercerizado = {
    id: 5, fecha_plan: "2026-09-15", hora_carga: "08:00:00", ruta_codigo_historico: null,
    lugar_descarga_historico: "Puerto Barrios", cliente: "Cliente T",
    placa: null, piloto: null,
    tipo_viaje: "Tercerizado",
    piloto_externo_nombre: "Juan Externo",
    auxiliares_externos: "Aux Externo 1\nAux Externo 2",
    unidad_externa_placa: "EXT-999",
  };

  it("sustituye placa/piloto/auxiliares por el snapshot externo y marca (Tercerizado) en Piloto", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tms_plan_auxiliares")) return [];
      if (sql.includes("FROM tms_planes_viaje p")) return [planTercerizado];
      return [];
    }) as typeof query);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const filas = vi.mocked(tablaAExcel).mock.calls[0][0].rows;
    expect(filas[0]).toEqual([
      "SEP", "15", "EXT-999", "", "Juan Externo (Tercerizado)", "Aux Externo 1", "Aux Externo 2",
      "", "Cliente T", "", "08:00", "Puerto Barrios",
    ]);
  });

  it("un plan Propio en la misma consulta conserva su placa/piloto/auxiliares internos sin marca", async () => {
    const planPropio = {
      id: 6, fecha_plan: "2026-09-15", hora_carga: "10:00:00", ruta_codigo_historico: null,
      lugar_descarga_historico: "Zacapa", cliente: "Cliente P", placa: "P333CCC", piloto: "Piloto Interno",
      tipo_viaje: "Propio", piloto_externo_nombre: null, auxiliares_externos: null, unidad_externa_placa: null,
    };
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tms_plan_auxiliares")) return [];
      if (sql.includes("FROM tms_planes_viaje p")) return [planTercerizado, planPropio];
      return [];
    }) as typeof query);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const filas = vi.mocked(tablaAExcel).mock.calls[0][0].rows;
    expect(filas[1]).toEqual([
      "SEP", "15", "P333CCC", "", "Piloto Interno", "", "", "", "Cliente P", "", "10:00", "Zacapa",
    ]);
    expect(filas[1][4]).not.toContain("Tercerizado");
  });

  it("un piloto externo vacío no arrastra la marca (Tercerizado) sobre una celda vacía", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tms_plan_auxiliares")) return [];
      if (sql.includes("FROM tms_planes_viaje p")) return [{ ...planTercerizado, piloto_externo_nombre: null }];
      return [];
    }) as typeof query);
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const filas = vi.mocked(tablaAExcel).mock.calls[0][0].rows;
    expect(filas[0][4]).toBe("");
  });
});

/**
 * PROGRAMACION-PDF-LEGIBILIDAD-1 — el PDF (no el Excel) recortaba "Hora"
 * ("07:00" → "07:0…") porque el ancho automático por longitud de texto
 * (dibujarTablaEnDoc) le daba un peso proporcional demasiado angosto
 * frente a columnas largas (Lugar de Carga/Descarga, Cliente, Piloto).
 * Ajuste ÚNICAMENTE de la salida PDF: Hora en 12h con AM/PM + `minWeight`/
 * `preserveSingleLine` para Placa y Hora. El Excel (`tablaAExcel`, mismo
 * `dataRows` de siempre) queda intacto — se prueba explícitamente que NO
 * cambió.
 */
describe("GET /tms/programacion/reporte — PDF: Hora en 12h + ancho garantizado (Excel intacto)", () => {
  const planConHora = (hora: string, over: Record<string, unknown> = {}) => ({
    id: 20, fecha_plan: "2026-09-15", hora_carga: hora, ruta_codigo_historico: null,
    lugar_descarga_historico: "Puerto Barrios", cliente: "Cliente H", placa: "P111AAA", piloto: "Piloto Uno",
    ...over,
  });
  const usarPlan = (fila: Record<string, unknown>) => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tms_plan_auxiliares")) return [];
      if (sql.includes("FROM tms_planes_viaje p")) return [fila];
      return [];
    }) as typeof query);
  };

  // Sin estado=Programado, los headers incluyen "Código" y "TC" -> Hora queda en el índice 10 (0-based).
  it("el Excel sigue mostrando Hora en 24h (HH:mm) — esta salida NO se tocó", async () => {
    usarPlan(planConHora("13:30:00"));
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const filas = vi.mocked(tablaAExcel).mock.calls[0][0].rows;
    expect(filas[0][10]).toBe("13:30");
  });

  it("el PDF muestra Hora en 12h con AM/PM (13:30 -> 01:30 PM)", async () => {
    usarPlan(planConHora("13:30:00"));
    await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const filas = vi.mocked(tablaAPdf).mock.calls[0][0].rows;
    expect(filas[0][10]).toBe("01:30 PM");
  });

  it.each([
    ["00:00:00", "12:00 AM"],
    ["08:00:00", "08:00 AM"],
    ["12:00:00", "12:00 PM"],
    ["23:59:00", "11:59 PM"],
  ])("PDF: %s (24h) -> %s (12h)", async (hora24, hora12) => {
    usarPlan(planConHora(hora24));
    await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const filas = vi.mocked(tablaAPdf).mock.calls[0][0].rows;
    expect(filas[0][10]).toBe(hora12);
  });

  it("un plan sin hora_carga: celda vacía en el PDF, nunca '—' (mismo criterio que el Excel)", async () => {
    usarPlan(planConHora("", { hora_carga: null }));
    await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const filas = vi.mocked(tablaAPdf).mock.calls[0][0].rows;
    expect(filas[0][10]).toBe("");
  });

  it("el PDF nunca modifica dataRows (el Excel, llamado con el mismo objeto en memoria, no ve el cambio a 12h)", async () => {
    usarPlan(planConHora("13:30:00"));
    await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const filasPdf = vi.mocked(tablaAPdf).mock.calls[0][0].rows;
    expect(filasPdf[0][10]).toBe("01:30 PM");
    // Reconsulta en formato Excel (mismo escenario): confirma que la fuente de datos original sigue en 24h.
    vi.mocked(tablaAExcel).mockClear();
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const filasXlsx = vi.mocked(tablaAExcel).mock.calls[0][0].rows;
    expect(filasXlsx[0][10]).toBe("13:30");
  });

  it("minWeight y preserveSingleLine del PDF cubren exactamente los índices de Placa y Hora (dinámico, no hardcodeado)", async () => {
    usarPlan(planConHora("13:30:00"));
    await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-15&fechaHasta=2026-09-15&estado=Cerrado"), ctx);
    const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
    const idxPlaca = llamada.headers.indexOf("Placa");
    const idxTc = llamada.headers.indexOf("TC");
    const idxHora = llamada.headers.indexOf("Hora");
    expect(idxPlaca).toBeGreaterThanOrEqual(0);
    expect(idxTc).toBe(idxPlaca + 1);
    expect(idxHora).toBeGreaterThanOrEqual(0);
    expect(llamada.minWeight).toEqual({ [idxPlaca]: 9, [idxTc]: 8, [idxHora]: 12 });
    expect(llamada.preserveSingleLine).toEqual([idxPlaca, idxTc, idxHora]);
  });

  it("estado=Programado (sin columna Código, los índices se corren): minWeight/preserveSingleLine siguen apuntando a Placa/Hora reales", async () => {
    usarPlan(planConHora("13:30:00"));
    await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-15&fechaHasta=2026-09-15&estado=Programado"), ctx);
    const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
    expect(llamada.headers).not.toContain("Código");
    const idxPlaca = llamada.headers.indexOf("Placa");
    const idxTc = llamada.headers.indexOf("TC");
    const idxHora = llamada.headers.indexOf("Hora");
    // Con Código oculto, Hora pasa del índice 10 al 9 — confirma que no se hardcodeó el índice anterior.
    expect(idxHora).toBe(9);
    expect(llamada.minWeight).toEqual({ [idxPlaca]: 9, [idxTc]: 8, [idxHora]: 12 });
    expect(llamada.preserveSingleLine).toEqual([idxPlaca, idxTc, idxHora]);
    expect(llamada.rows[0][idxHora]).toBe("01:30 PM");
  });

  it("el resto de las columnas del PDF no cambia (mismos valores que siempre, solo Hora se reformatea)", async () => {
    usarPlan(planConHora("13:30:00"));
    await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const fila = vi.mocked(tablaAPdf).mock.calls[0][0].rows[0];
    expect(fila).toEqual([
      "SEP", "15", "P111AAA", "", "Piloto Uno", "", "", "", "Cliente H", "", "01:30 PM", "Puerto Barrios",
    ]);
  });

  it("Tercerizado en PDF: Hora también se convierte a 12h (mismo ajuste, sin distinguir tipo de viaje)", async () => {
    usarPlan({
      id: 21, fecha_plan: "2026-09-15", hora_carga: "08:00:00", ruta_codigo_historico: null,
      lugar_descarga_historico: "Xela", cliente: "Cliente X", placa: null, piloto: null,
      tipo_viaje: "Tercerizado", piloto_externo_nombre: "Juan Externo", auxiliares_externos: null, unidad_externa_placa: "EXT-1",
    });
    await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-15&fechaHasta=2026-09-15"), ctx);
    const fila = vi.mocked(tablaAPdf).mock.calls[0][0].rows[0];
    expect(fila[10]).toBe("08:00 AM");
    expect(fila[4]).toBe("Juan Externo (Tercerizado)");
  });
});

/**
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — el TC/caja/remolque viaja en Excel y PDF
 * como una columna compacta "TC" justo después de "Placa". Mismo concepto
 * para Propio (TC interno) y Tercerizado (snapshot externo): el SQL ya lo
 * resuelve en el alias `tc`.
 */
describe("GET /tms/programacion/reporte — columna TC (Propio y Tercerizado bajo el mismo concepto)", () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    id: 30, fecha_plan: "2026-09-23", hora_carga: "08:00:00", ruta_codigo_historico: null, lugar_descarga_historico: "Xela",
    cliente: "Cliente A", placa: "C-123ABC", piloto: "Piloto Uno", tipo_viaje: "Propio", tc: null, ...over,
  });
  const usarPlanes = (filas: Record<string, unknown>[]) => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tms_plan_auxiliares")) return [];
      if (sql.includes("FROM tms_planes_viaje p")) return filas;
      return [];
    }) as typeof query);
  };
  const url = (formato: string, extra = "") => new Request(`http://localhost/x?formato=${formato}&fechaDesde=2026-09-23&fechaHasta=2026-09-23${extra}`);

  it("TC va inmediatamente después de Placa en Excel y PDF", async () => {
    usarPlanes([plan()]);
    await GET(url("xlsx"), ctx);
    await GET(url("pdf"), ctx);
    for (const headers of [vi.mocked(tablaAExcel).mock.calls[0][0].headers, vi.mocked(tablaAPdf).mock.calls[0][0].headers]) {
      expect(headers.indexOf("TC")).toBe(headers.indexOf("Placa") + 1);
    }
  });

  it("Propio: muestra el TC interno asignado junto a la Unidad (no sustituye la placa)", async () => {
    usarPlanes([plan({ tc: "TC-045" })]);
    await GET(url("xlsx"), ctx);
    const h = vi.mocked(tablaAExcel).mock.calls[0][0].headers;
    const fila = vi.mocked(tablaAExcel).mock.calls[0][0].rows[0];
    expect(fila[h.indexOf("Placa")]).toBe("C-123ABC");
    expect(fila[h.indexOf("TC")]).toBe("TC-045");
  });

  it("Tercerizado: muestra el snapshot del TC externo bajo la misma columna TC, junto a la placa externa", async () => {
    usarPlanes([plan({ placa: null, piloto: null, tipo_viaje: "Tercerizado", piloto_externo_nombre: "Juan Externo", unidad_externa_placa: "EXT-1", tc: "TC-778" })]);
    await GET(url("pdf"), ctx);
    const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
    const fila = llamada.rows[0];
    expect(fila[llamada.headers.indexOf("Placa")]).toBe("EXT-1");
    expect(fila[llamada.headers.indexOf("TC")]).toBe("TC-778");
  });

  it("un viaje sin TC deja la celda vacía (nunca '—' ni un valor inventado); Propio y Tercerizado no cambian de formato", async () => {
    usarPlanes([plan(), plan({ id: 31, tipo_viaje: "Tercerizado", placa: null, piloto: null, piloto_externo_nombre: "X", tc: null })]);
    await GET(url("xlsx"), ctx);
    const { headers, rows } = vi.mocked(tablaAExcel).mock.calls[0][0];
    expect(rows.map((r) => r[headers.indexOf("TC")])).toEqual(["", ""]);
    expect(rows[0]).toHaveLength(headers.length);
    expect(rows[1]).toHaveLength(headers.length);
  });

  it("el SQL resuelve `tc` por tipo de viaje y reutiliza flota_vehiculos (sin catálogo nuevo): Tercerizado = tc_externo_placa; Propio = placa del TC interno o su fotografía", async () => {
    await GET(url("xlsx"), ctx);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("LEFT JOIN flota_vehiculos tcv ON tcv.id = p.tc_vehiculo_id");
    expect(sql).toContain("CASE WHEN p.tipo_viaje = 'Tercerizado' THEN p.tc_externo_placa");
    expect(sql).toContain("COALESCE(tcv.placa, p.tc_placa_historica) END AS tc");
    expect(sql).toContain("p.empresa_id = ?");
  });

  it("PDF: TC recibe piso de ancho y una sola línea (legible) igual que Placa/Hora; con Código oculto los índices siguen correctos", async () => {
    usarPlanes([plan({ tc: "TC-045" })]);
    await GET(url("pdf", "&estado=Programado"), ctx);
    const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
    const idxTc = llamada.headers.indexOf("TC");
    expect(llamada.headers).not.toContain("Código");
    expect(llamada.minWeight?.[idxTc]).toBe(8);
    expect(llamada.preserveSingleLine).toContain(idxTc);
    expect(llamada.rows[0][idxTc]).toBe("TC-045");
  });

  it("el Excel no cambia de formato de Hora por el TC (24h) — regresión del ajuste anterior", async () => {
    usarPlanes([plan({ tc: "TC-045", hora_carga: "13:30:00" })]);
    await GET(url("xlsx"), ctx);
    const { headers, rows } = vi.mocked(tablaAExcel).mock.calls[0][0];
    expect(rows[0][headers.indexOf("Hora")]).toBe("13:30");
  });
});
