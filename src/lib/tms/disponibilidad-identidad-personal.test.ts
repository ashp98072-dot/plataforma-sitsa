import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { mensajeConflicto, primerConflictoTraslape } from "./disponibilidad-traslapes";
import { emularConsultaConflictoPersonal, type ModeloPersonal } from "./personal-identidad.fixture";

/**
 * IDENTIDAD DE PERSONAL — la persona es el empleado (id_empleado), no su rol. La disponibilidad se valida por
 * TODAS las filas de tms_personal de la misma empresa con el mismo id_empleado, sin importar tipo; sin
 * id_empleado, por el personal_id exacto. Sin migración, sin fusionar ni actualizar registros.
 */
const EMPRESA = 7;
const INICIO_NUEVO = "2026-09-30 08:00:00";
const FIN_NUEVO = "2026-09-30 12:00:00";

// Juan Pérez (empleado 55) existe como Auxiliar (10) y como Piloto (22): dos personal_id, una sola persona.
const JUAN_AUX = { id: 10, empresa_id: EMPRESA, nombre: "Juan Pérez", tipo: "Auxiliar" as const, id_empleado: 55 };
const JUAN_PILOTO = { id: 22, empresa_id: EMPRESA, nombre: "Juan Pérez", tipo: "Piloto" as const, id_empleado: 55 };
const plan = (over: Record<string, unknown> = {}) => ({
  id: 900, empresa_id: EMPRESA, codigo: "PLAN-900", estado: "Programado", inicio: "2026-09-30 07:00:00", regreso_estimado: "2026-09-30 10:00:00", ...over,
});

let modelo: ModeloPersonal;
let consultas: { sql: string; params: unknown[] }[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  consultas = [];
  modelo = { personal: [], planes: [] };
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql: String(sql), params });
    return String(sql).includes("FROM tms_personal tp") ? emularConsultaConflictoPersonal(modelo, String(sql), params) : [];
  }) as never);
});

const validar = (personalId: number, opciones: { empresa?: number; fin?: string | null; excluir?: number | null; tipo?: "piloto" | "auxiliar" } = {}) =>
  primerConflictoTraslape(
    opciones.empresa ?? EMPRESA,
    [{ tipo: opciones.tipo ?? "piloto", id: personalId }],
    { inicio: INICIO_NUEVO, fin: opciones.fin === undefined ? FIN_NUEVO : opciones.fin },
    opciones.excluir ?? null,
  );

describe("el SQL identifica a la persona por id_empleado (sin importar tipo) y acota por empresa", () => {
  it("une tms_personal consigo misma por empresa + (misma fila O mismo id_empleado no nulo)", async () => {
    await validar(22);
    const { sql, params } = consultas[0];
    expect(sql).toContain("INNER JOIN tms_personal eq");
    expect(sql).toContain("ON eq.empresa_id = tp.empresa_id");
    expect(sql).toContain("(eq.id = tp.id OR (tp.id_empleado IS NOT NULL AND eq.id_empleado = tp.id_empleado))");
    // El equivalente NO se filtra por tipo: es la misma persona en cualquier rol.
    expect(sql).not.toMatch(/eq\.tipo/);
    expect(sql).not.toMatch(/tp\.tipo/);
    // Los viajes se buscan por CUALQUIER fila equivalente (piloto, auxiliar legado o tms_plan_auxiliares).
    expect(sql).toContain("p.piloto_id = eq.id OR p.auxiliar_id = eq.id");
    expect(sql).toContain("pa.personal_id = eq.id");
    // Mismos parámetros de siempre: [personalId, empresaId, ...].
    expect(params.slice(0, 2)).toEqual([22, EMPRESA]);
  });

  it("el plan candidato pertenece a la misma empresa que el personal validado", async () => {
    await validar(22);
    const { sql } = consultas[0];
    expect(sql).toContain("tp.id = ? AND tp.empresa_id = ?");
    expect(sql).toContain("p.empresa_id = tp.empresa_id");
    expect(sql).toContain("fv.empresa_id = p.empresa_id");
  });

  it("es solo lectura: la consulta no escribe ni cambia registros", () => {
    const fuente = readFileSync("src/lib/tms/disponibilidad-traslapes.ts", "utf8");
    expect(fuente).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER|CREATE)\s+(tms_|INTO|TABLE)/);
  });
});

describe("mismo empleado", () => {
  it("mismo tipo, personal_id distinto (duplicado histórico) y viaje distinto: CONFLICTO", async () => {
    const otroAux = { ...JUAN_AUX, id: 11 };
    modelo = { personal: [JUAN_AUX, otroAux], planes: [plan({ auxiliares: [11] })] };
    const c = await validar(10, { tipo: "auxiliar" });
    expect(c).toMatchObject({ tipo: "auxiliar", id: 10, planIdConflicto: 900, codigoConflicto: "PLAN-900" });
  });

  it("Auxiliar (existente) vs Piloto (nuevo): CONFLICTO aunque sean personal_id distintos", async () => {
    modelo = { personal: [JUAN_AUX, JUAN_PILOTO], planes: [plan({ auxiliares: [10] })] };
    const c = await validar(22);
    expect(c).toMatchObject({ tipo: "piloto", id: 22, nombre: "Juan Pérez", planIdConflicto: 900 });
    expect(mensajeConflicto(c!)).toBe("El piloto Juan Pérez ya está asignado al viaje PLAN-900 de 07:00 a 10:00.");
  });

  it("Piloto (existente) vs Auxiliar (nuevo): CONFLICTO también en el otro sentido", async () => {
    modelo = { personal: [JUAN_AUX, JUAN_PILOTO], planes: [plan({ piloto_id: 22 })] };
    const c = await validar(10, { tipo: "auxiliar" });
    expect(c).toMatchObject({ tipo: "auxiliar", id: 10, planIdConflicto: 900 });
  });

  it("el viaje existente puede usar el auxiliar legado (tms_planes_viaje.auxiliar_id) y aun así choca", async () => {
    modelo = { personal: [JUAN_AUX, JUAN_PILOTO], planes: [plan({ auxiliar_id: 10 })] };
    expect(await validar(22)).not.toBeNull();
  });

  it("sin solape horario no hay conflicto aunque sea la misma persona", async () => {
    modelo = { personal: [JUAN_AUX, JUAN_PILOTO], planes: [plan({ auxiliares: [10], inicio: "2026-09-30 05:00:00", regreso_estimado: "2026-09-30 08:00:00" })] };
    expect(await validar(22)).toBeNull();
  });

  it("viaje existente abierto sin regreso estimado de la misma persona con otro rol: conflicto sin fin", async () => {
    modelo = { personal: [JUAN_AUX, JUAN_PILOTO], planes: [plan({ auxiliares: [10], regreso_estimado: null })] };
    const c = await validar(22, { fin: null });
    expect(c?.finConflicto).toBeNull();
    expect(mensajeConflicto(c!)).toContain("aún no registra llegada");
  });

  it("al editar, el propio plan se excluye aunque use otra fila del mismo empleado", async () => {
    modelo = { personal: [JUAN_AUX, JUAN_PILOTO], planes: [plan({ id: 40, auxiliares: [10] })] };
    expect(await validar(22, { excluir: 40 })).toBeNull();
    expect(await validar(22)).not.toBeNull();
  });
});

describe("fallback por personal_id cuando no hay id_empleado (sin vínculo RRHH)", () => {
  const AUX_SIN = { id: 30, empresa_id: EMPRESA, nombre: "Pedro Sin Vínculo", tipo: "Auxiliar" as const, id_empleado: null };
  const PILOTO_SIN = { id: 31, empresa_id: EMPRESA, nombre: "Pedro Sin Vínculo", tipo: "Piloto" as const, id_empleado: null };

  it("la misma fila sí choca", async () => {
    modelo = { personal: [AUX_SIN, PILOTO_SIN], planes: [plan({ auxiliares: [30] })] };
    expect(await validar(30, { tipo: "auxiliar" })).toMatchObject({ planIdConflicto: 900 });
  });

  it("otra fila de tipo distinto SIN id_empleado NO se toma por la misma persona (aunque el nombre coincida)", async () => {
    modelo = { personal: [AUX_SIN, PILOTO_SIN], planes: [plan({ auxiliares: [30] })] };
    expect(await validar(31)).toBeNull();
  });

  it("un personal SIN id_empleado tampoco se une a filas con id_empleado", async () => {
    modelo = { personal: [AUX_SIN, JUAN_PILOTO], planes: [plan({ piloto_id: 22 })] };
    expect(await validar(30, { tipo: "auxiliar" })).toBeNull();
  });
});

describe("empleados distintos", () => {
  it("dos empleados diferentes con el MISMO nombre NO generan conflicto", async () => {
    const otroJuan = { id: 40, empresa_id: EMPRESA, nombre: "Juan Pérez", tipo: "Auxiliar" as const, id_empleado: 77 };
    modelo = { personal: [JUAN_PILOTO, otroJuan], planes: [plan({ auxiliares: [40] })] };
    expect(await validar(22)).toBeNull();
    // ...y el mismo empleado del viaje sí choca consigo mismo.
    expect(await validar(40, { tipo: "auxiliar" })).not.toBeNull();
  });
});

describe("aislamiento por empresa", () => {
  it("un empleado con el mismo id numérico en OTRA empresa no es la misma persona", async () => {
    const juanOtraEmpresa = { id: 50, empresa_id: 8, nombre: "Juan Pérez", tipo: "Auxiliar" as const, id_empleado: 55 };
    modelo = { personal: [JUAN_PILOTO, juanOtraEmpresa], planes: [plan({ id: 901, empresa_id: 8, codigo: "PLAN-OTRA", auxiliares: [50] })] };
    expect(await validar(22)).toBeNull();
  });

  it("un personal_id de otra empresa no se puede validar desde esta (no se encuentra)", async () => {
    modelo = { personal: [{ id: 50, empresa_id: 8, nombre: "Ajeno", tipo: "Piloto", id_empleado: 99 }], planes: [plan({ id: 901, empresa_id: 8, piloto_id: 50 })] };
    expect(await validar(50, { empresa: EMPRESA })).toBeNull();
    expect(consultas[0].params.slice(0, 2)).toEqual([50, EMPRESA]);
  });

  it("los viajes de otra empresa con la misma persona no bloquean", async () => {
    modelo = { personal: [JUAN_AUX, JUAN_PILOTO], planes: [plan({ empresa_id: 8, auxiliares: [10] })] };
    expect(await validar(22)).toBeNull();
  });
});

describe("no cambia roles ni registros", () => {
  it("la resolución de personal (personalDesdeEmpleado) no se modificó: sigue por empresa + código + tipo", () => {
    const fuente = readFileSync("src/lib/tms/personal-resolucion.ts", "utf8");
    expect(fuente).toContain("WHERE empresa_id = ? AND codigo = ? AND tipo = ? LIMIT 1");
  });

  it("no se agregó ningún SQL de migración ni UNIQUE sobre id_empleado", () => {
    const fuente = readFileSync("src/lib/tms/disponibilidad-traslapes.ts", "utf8");
    expect(fuente).not.toMatch(/UNIQUE/i);
    expect(fuente).not.toMatch(/ALTER TABLE/i);
  });
});
