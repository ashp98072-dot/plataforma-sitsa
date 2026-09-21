import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import {
  ESTADOS_QUE_RESERVAN_RECURSOS,
  intervaloOcupacionReal,
  mensajeConflicto,
  primerConflictoTraslape,
  seSolapaConOcupacionReal,
  type IntervaloConsulta,
} from "./disponibilidad-traslapes";

/**
 * Regreso estimado OPCIONAL — regla de ocupación:
 *  - CON regreso estimado: exactamente la validación de siempre.
 *  - SIN regreso estimado: ocupa desde fecha_plan+hora_carga hasta la llegada REAL (flota_viajes.hora_llegada)
 *    o, si el plan ya está Cerrado sin llegada, hasta el cierre administrativo (cerrado_en); mientras no haya
 *    ninguno, sigue abierto (fin = null). Nunca se inventa un fin.
 */
const INICIO = "2026-09-30 08:00:00";
const base = { inicio: INICIO, llegadaTecnica: false, regresoEstimado: null as string | null };

describe("intervaloOcupacionReal — planes CON regreso estimado (sin cambios)", () => {
  const conRegreso = { ...base, regresoEstimado: "2026-09-30 17:00:00" };
  it("Programado: intervalo planificado [inicio, regreso]", () => {
    expect(intervaloOcupacionReal({ ...conRegreso, estado: "Programado" })).toEqual({ inicio: INICIO, fin: "2026-09-30 17:00:00" });
  });
  it("En ruta / Cargado sin llegada: abierto aunque el regreso estimado ya venció", () => {
    for (const estado of ["En ruta", "Cargado"]) expect(intervaloOcupacionReal({ ...conRegreso, estado })).toEqual({ inicio: INICIO, fin: null });
  });
  it("En ruta / Cargado con llegada técnica: ya no ocupa (aunque exista hora de llegada)", () => {
    expect(intervaloOcupacionReal({ ...conRegreso, estado: "En ruta", llegadaTecnica: true, horaLlegada: "2026-09-30 12:00:00" })).toBeNull();
  });
  it("Cerrado / Cancelado / Descargado nunca ocupan, aunque tengan cerrado_en o llegada", () => {
    for (const estado of ["Cerrado", "Cancelado", "Descargado"]) {
      expect(intervaloOcupacionReal({ ...conRegreso, estado, horaLlegada: "2026-09-30 12:00:00", cerradoEn: "2026-10-01 09:00:00" })).toBeNull();
    }
  });
});

describe("intervaloOcupacionReal — planes SIN regreso estimado", () => {
  it("Programado / En ruta / Cargado sin llegada: ocupa desde el inicio sin fin conocido (abierto)", () => {
    for (const estado of ["Programado", "En ruta", "Cargado"]) {
      expect(intervaloOcupacionReal({ ...base, estado })).toEqual({ inicio: INICIO, fin: null });
    }
  });

  it("con llegada física registrada: ocupa [inicio, hora_llegada] (la terminación real preferida)", () => {
    expect(intervaloOcupacionReal({ ...base, estado: "En ruta", llegadaTecnica: true, horaLlegada: "2026-09-30 14:20:00" }))
      .toEqual({ inicio: INICIO, fin: "2026-09-30 14:20:00" });
  });

  it("llegada técnica sin hora de llegada guardada (cierre manual de Flota): no hay ventana que reservar", () => {
    expect(intervaloOcupacionReal({ ...base, estado: "En ruta", llegadaTecnica: true, horaLlegada: null })).toBeNull();
  });

  it("Cerrado con llegada real: termina en hora_llegada, NO en cerrado_en", () => {
    expect(intervaloOcupacionReal({ ...base, estado: "Cerrado", llegadaTecnica: true, horaLlegada: "2026-09-30 14:20:00", cerradoEn: "2026-10-02 10:00:00" }))
      .toEqual({ inicio: INICIO, fin: "2026-09-30 14:20:00" });
  });

  it("Cerrado sin llegada física: cerrado_en es el final ADMINISTRATIVO, solo para disponibilidad", () => {
    expect(intervaloOcupacionReal({ ...base, estado: "Cerrado", cerradoEn: "2026-10-02 10:00:00" }))
      .toEqual({ inicio: INICIO, fin: "2026-10-02 10:00:00" });
  });

  it("Cerrado sin llegada ni cierre registrado: no reserva nada (no se inventa un fin)", () => {
    expect(intervaloOcupacionReal({ ...base, estado: "Cerrado" })).toBeNull();
  });

  it("una terminación anterior o igual al inicio (viaje futuro cerrado antes de salir) no ocupa", () => {
    expect(intervaloOcupacionReal({ ...base, estado: "Cerrado", cerradoEn: "2026-09-29 10:00:00" })).toBeNull();
    expect(intervaloOcupacionReal({ ...base, estado: "Cerrado", cerradoEn: INICIO })).toBeNull();
  });

  it("Cancelado / Descargado no ocupan", () => {
    for (const estado of ["Cancelado", "Descargado"]) expect(intervaloOcupacionReal({ ...base, estado })).toBeNull();
  });

  it("no cambia qué estados reservan recursos al GUARDAR un plan", () => {
    expect([...ESTADOS_QUE_RESERVAN_RECURSOS]).toEqual(["Programado", "En ruta", "Cargado"]);
  });
});

describe("seSolapaConOcupacionReal — consulta CON y SIN fin", () => {
  const consultaConFin: IntervaloConsulta = { inicio: "2026-09-30 08:00:00", fin: "2026-09-30 12:00:00" };
  const consultaAbierta: IntervaloConsulta = { inicio: "2026-09-30 08:00:00", fin: null };

  it("consulta con fin: criterio de siempre (tocar el límite no es traslape)", () => {
    expect(seSolapaConOcupacionReal({ inicio: "2026-09-30 06:00:00", fin: "2026-09-30 08:00:00" }, consultaConFin)).toBe(false);
    expect(seSolapaConOcupacionReal({ inicio: "2026-09-30 06:00:00", fin: "2026-09-30 08:01:00" }, consultaConFin)).toBe(true);
    expect(seSolapaConOcupacionReal({ inicio: "2026-09-30 12:00:00", fin: null }, consultaConFin)).toBe(false);
    expect(seSolapaConOcupacionReal({ inicio: "2026-09-30 11:59:00", fin: null }, consultaConFin)).toBe(true);
  });

  it("consulta sin fin (viaje nuevo sin regreso): sin límite superior", () => {
    // ocupación abierta que ya empezó: choca
    expect(seSolapaConOcupacionReal({ inicio: "2026-09-29 06:00:00", fin: null }, consultaAbierta)).toBe(true);
    // ocupación planificada que empieza DESPUÉS del inicio de la consulta: choca (la consulta no termina)
    expect(seSolapaConOcupacionReal({ inicio: "2026-10-02 06:00:00", fin: "2026-10-02 18:00:00" }, consultaAbierta)).toBe(true);
    // ocupación que terminó antes de que empiece la consulta: no choca
    expect(seSolapaConOcupacionReal({ inicio: "2026-09-29 06:00:00", fin: "2026-09-30 07:59:00" }, consultaAbierta)).toBe(false);
    expect(seSolapaConOcupacionReal({ inicio: "2026-09-29 06:00:00", fin: "2026-09-30 08:00:00" }, consultaAbierta)).toBe(false);
    expect(seSolapaConOcupacionReal(null, consultaAbierta)).toBe(false);
  });
});

describe("primerConflictoTraslape — SQL y decisión con base simulada", () => {
  const consulta = (sql: string, params: unknown[]) => ({ sql, params });
  let llamadas: ReturnType<typeof consulta>[] = [];
  let filas: Record<string, unknown>[] = [];
  beforeEach(() => {
    vi.resetAllMocks();
    llamadas = []; filas = [];
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => { llamadas.push(consulta(String(sql), params)); return filas; }) as never);
  });
  const fila = (over: Record<string, unknown>) => ({
    recurso_nombre: "Piloto Uno", plan_id: 9, codigo: "PLAN-9", estado: "Programado", inicio: "2026-09-29 06:00:00",
    regreso_estimado: null, llegada_tecnica: 0, hora_llegada: null, cerrado_en: null, ...over,
  });
  const piloto = [{ tipo: "piloto" as const, id: 12 }];
  const unidad = [{ tipo: "unidad" as const, id: 4 }];

  it("los `?` del SQL coinciden con los parámetros enviados, con y sin fin (piloto y unidad)", async () => {
    for (const recursos of [piloto, unidad]) {
      for (const fin of ["2026-09-30 12:00:00", null]) {
        llamadas = [];
        await primerConflictoTraslape(7, recursos, { inicio: INICIO, fin }, null);
        const { sql, params } = llamadas[0];
        expect(sql.match(/\?/g)?.length ?? 0).toBe(params.length);
      }
    }
  });

  it("sin fin: el SQL no filtra por fin de la consulta; con fin, sí", async () => {
    await primerConflictoTraslape(7, piloto, { inicio: INICIO, fin: null }, null);
    expect(llamadas[0].sql).toContain("1 = 1");
    expect(llamadas[0].params).not.toContain("2026-09-30 12:00:00");
    llamadas = [];
    await primerConflictoTraslape(7, piloto, { inicio: INICIO, fin: "2026-09-30 12:00:00" }, null);
    expect(llamadas[0].sql).toContain("TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')) < ?");
    expect(llamadas[0].params).toContain("2026-09-30 12:00:00");
  });

  it("trae Cerrado como candidato SOLO para planes sin regreso estimado", async () => {
    await primerConflictoTraslape(7, piloto, { inicio: INICIO, fin: null }, null);
    const { sql, params } = llamadas[0];
    expect(params).toContain("Cerrado");
    expect(sql).toMatch(/p\.estado = 'Cerrado'\s+AND p\.regreso_estimado IS NULL/);
    expect(sql).toContain("COALESCE(");
  });

  it("aislamiento por empresa en piloto y unidad, y en el subselect de la llegada real", async () => {
    await primerConflictoTraslape(9, [...piloto, ...unidad], { inicio: INICIO, fin: null }, null);
    expect(llamadas).toHaveLength(2);
    for (const { sql, params } of llamadas) {
      expect(sql).toMatch(/(tp|u)\.empresa_id = \?/);
      expect(sql).toContain("fv.empresa_id = p.empresa_id");
      expect(params).toContain(9);
    }
    expect(llamadas[0].sql).toContain("p.empresa_id = tp.empresa_id");
    expect(llamadas[1].sql).toContain("p.empresa_id = u.empresa_id");
  });

  it("la hora de llegada real sale de flota_viajes cerrados con hora_llegada", async () => {
    await primerConflictoTraslape(7, piloto, { inicio: INICIO, fin: null }, null);
    expect(llamadas[0].sql).toContain("SELECT MAX(fv.hora_llegada) FROM flota_viajes fv");
    expect(llamadas[0].sql).toContain("fv.estado = 'cerrado' AND fv.hora_llegada IS NOT NULL");
  });

  it("excluye el propio plan al editar", async () => {
    await primerConflictoTraslape(7, piloto, { inicio: INICIO, fin: null }, 40);
    expect(llamadas[0].sql).toContain("p.id != ?");
    expect(llamadas[0].params).toContain(40);
  });

  it("viaje abierto sin regreso estimado: conflicto con fin = null y mensaje de «aún no registra llegada»", async () => {
    filas = [fila({})];
    const c = await primerConflictoTraslape(7, piloto, { inicio: INICIO, fin: "2026-09-30 12:00:00" }, null);
    expect(c).toMatchObject({ tipo: "piloto", planIdConflicto: 9, finConflicto: null });
    expect(mensajeConflicto(c!)).toContain("aún no registra llegada");
  });

  it("viaje sin regreso con llegada real: solo bloquea dentro de [inicio, hora_llegada]", async () => {
    filas = [fila({ estado: "En ruta", llegada_tecnica: 1, hora_llegada: "2026-09-30 09:00:00", inicio: "2026-09-30 06:00:00" })];
    // El nuevo viaje sale a las 10:00, ya con el viaje anterior terminado: sin conflicto.
    expect(await primerConflictoTraslape(7, piloto, { inicio: "2026-09-30 10:00:00", fin: "2026-09-30 12:00:00" }, null)).toBeNull();
    // Uno que empieza a las 08:00 se solapa con [06:00, 09:00]: conflicto con fin = hora_llegada.
    const c = await primerConflictoTraslape(7, piloto, { inicio: "2026-09-30 08:00:00", fin: "2026-09-30 12:00:00" }, null);
    expect(c?.finConflicto).toBe("2026-09-30 09:00:00");
    expect(mensajeConflicto(c!)).toContain("06:00 a 09:00");
  });

  it("viaje Cerrado sin llegada: bloquea hasta cerrado_en (final administrativo) y no después", async () => {
    filas = [fila({ estado: "Cerrado", inicio: "2026-09-30 06:00:00", cerrado_en: "2026-09-30 15:00:00" })];
    const dentro = await primerConflictoTraslape(7, piloto, { inicio: "2026-09-30 13:00:00", fin: null }, null);
    expect(dentro?.finConflicto).toBe("2026-09-30 15:00:00");
    expect(await primerConflictoTraslape(7, piloto, { inicio: "2026-09-30 15:00:00", fin: null }, null)).toBeNull();
  });

  it("viaje Cerrado CON regreso estimado nunca bloquea", async () => {
    filas = [fila({ estado: "Cerrado", inicio: "2026-09-30 06:00:00", regreso_estimado: "2026-09-30 20:00:00", cerrado_en: "2026-10-01 09:00:00" })];
    expect(await primerConflictoTraslape(7, piloto, { inicio: "2026-09-30 13:00:00", fin: null }, null)).toBeNull();
  });

  it("viaje CON regreso estimado: mismo mensaje y criterio de siempre", async () => {
    filas = [fila({ estado: "Programado", inicio: "2026-09-30 07:00:00", regreso_estimado: "2026-09-30 12:00:00" })];
    const c = await primerConflictoTraslape(7, piloto, { inicio: "2026-09-30 10:00:00", fin: "2026-09-30 14:00:00" }, null);
    expect(mensajeConflicto(c!)).toBe("El piloto Piloto Uno ya está asignado al viaje PLAN-9 de 07:00 a 12:00.");
    filas = [fila({ estado: "Programado", inicio: "2026-09-30 07:00:00", regreso_estimado: "2026-09-30 12:00:00" })];
    expect(await primerConflictoTraslape(7, piloto, { inicio: "2026-09-30 12:00:00", fin: "2026-09-30 14:00:00" }, null)).toBeNull();
  });
});
