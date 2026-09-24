import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(async (ids: number[]) => new Map(ids.map((i) => [i, []]))) }));
vi.mock("@/lib/tms/programacion-lote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tms/programacion-lote")>()),
  validarLote: vi.fn(),
  confirmarLote: vi.fn(),
}));

import { query } from "@/lib/db";
import { requireTenantProgramacion, requireTenantProgramacionOTms } from "@/lib/tenant";
import { confirmarLote, validarLote } from "@/lib/tms/programacion-lote";
import { GET as cargar } from "./route";
import { POST as validar } from "./validar/route";
import { POST as confirmar } from "./confirmar/route";

/**
 * TMS-PROGRAMACION-LOTE-1 (PR A) — la regla "el ORIGEN no puede estar Cancelado" se exige en el BACKEND (validar y
 * confirmar) con la función REAL `borradoresDesdeCliente`, no solo en la pantalla: una llamada HTTP manual con un plan
 * Cancelado como origen debe rechazarse. Un Cerrado sigue siendo origen válido. (Distinto de la regla del plan
 * DESTINO cancelado, que sí permite volver a copiar.)
 */
const ctx = { params: Promise.resolve({ slug: "acme" }) };
const ORIGEN = "2026-09-24";
const planes = [
  { id: 900, empresa_id: 7, fecha: ORIGEN, estado: "Programado" },
  { id: 901, empresa_id: 7, fecha: ORIGEN, estado: "Cerrado" },
  { id: 902, empresa_id: 7, fecha: ORIGEN, estado: "Cancelado" },
  { id: 903, empresa_id: 7, fecha: "2026-09-20", estado: "Programado" }, // otra fecha
  { id: 904, empresa_id: 8, fecha: ORIGEN, estado: "Programado" }, // otra empresa
];
const fila = (origenPlanId: number, n = 1) => ({ fila: n, origenPlanId, rutaId: 10, clienteId: 3, horaCarga: "03:00", tipoTraslado: null, tipoViaje: "Propio", unidadPlaca: null, tcVehiculoId: null, pilotoEmpleadoId: null, auxiliarEmpleadoIds: [], tarifaId: null, externo: null });
const cuerpo = (ids: number[]) => ({ fechaOrigen: ORIGEN, fechaDestino: "2026-09-25", filas: ids.map((id, i) => fila(id, i + 1)) });
const post = (fn: typeof validar, body: unknown) => fn(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const MENSAJE = "Algún viaje origen no existe, está cancelado o no pertenece a la fecha/empresa indicada.";

beforeEach(() => {
  vi.resetAllMocks();
  const sesion = { session: { username: "jefe" }, empresa: { id: 7 } };
  vi.mocked(requireTenantProgramacion).mockResolvedValue(sesion as never);
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue(sesion as never);
  vi.mocked(validarLote).mockResolvedValue([]);
  vi.mocked(confirmarLote).mockResolvedValue({ ok: true, planIds: [1000], codigos: ["PLAN-1"] });
  // Emula el SELECT de la base HONRANDO los predicados presentes en el SQL: si se quitara `estado <> 'Cancelado'` de
  // la consulta, el Cancelado volvería a colarse y estas pruebas fallarían.
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
    const s = String(sql);
    if (s.includes("FROM tms_planes_viaje") && s.includes("p.fecha_plan = ?")) {
      const [emp, fecha] = params as [number, string];
      return planes.filter((p) => p.empresa_id === emp && p.fecha === fecha && p.estado !== "Cancelado").map((p) => ({ id: p.id, codigo: `P${p.id}`, estado: p.estado }));
    }
    if (s.includes("FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ?") && s.includes("DATE_FORMAT(regreso_estimado")) {
      const [emp, fecha, ...ids] = params as [number, string, ...number[]];
      return planes.filter((p) => p.empresa_id === emp && p.fecha === fecha && (!s.includes("estado <> 'Cancelado'") || p.estado !== "Cancelado") && ids.includes(p.id)).map((p) => ({ id: p.id, regreso_estimado: null }));
    }
    return [];
  }) as never);
});

describe("GET: la carga inicial no devuelve orígenes Cancelados", () => {
  it("excluye el Cancelado y conserva el Cerrado y el Programado", async () => {
    const r = await cargar(new Request(`http://x/api?fechaOrigen=${ORIGEN}&fechaDestino=2026-09-25`), ctx);
    // (la pantalla no tiene filas de estos ids porque el catálogo/paradas son mínimos; lo relevante es el SQL de origen)
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("p.estado <> 'Cancelado'");
    expect(r.status).toBe(200);
  });
});

describe("POST /validar con orígenes enviados a mano", () => {
  it("origen CANCELADO -> 400 con mensaje claro; no se valida nada", async () => {
    const r = await post(validar, cuerpo([902]));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: MENSAJE });
    expect(validarLote).not.toHaveBeenCalled();
  });
  it("un lote con un origen válido y uno Cancelado se rechaza completo", async () => {
    expect((await post(validar, cuerpo([900, 902]))).status).toBe(400);
    expect(validarLote).not.toHaveBeenCalled();
  });
  it("origen CERRADO sigue permitido", async () => {
    expect((await post(validar, cuerpo([901]))).status).toBe(200);
    expect((await post(validar, cuerpo([900, 901]))).status).toBe(200);
    expect(validarLote).toHaveBeenCalledTimes(2);
  });
  it("origen de OTRA FECHA -> 400; origen de OTRA EMPRESA -> 400", async () => {
    expect((await post(validar, cuerpo([903]))).status).toBe(400);
    expect((await post(validar, cuerpo([904]))).status).toBe(400);
    expect(validarLote).not.toHaveBeenCalled();
  });
});

describe("POST /confirmar con orígenes enviados a mano", () => {
  it("origen CANCELADO -> 400 y NO se crea nada", async () => {
    const r = await post(confirmar, cuerpo([902]));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: MENSAJE });
    expect(confirmarLote).not.toHaveBeenCalled();
  });
  it("un lote con un origen válido y uno Cancelado se rechaza completo (no se crea el válido)", async () => {
    expect((await post(confirmar, cuerpo([900, 902]))).status).toBe(400);
    expect(confirmarLote).not.toHaveBeenCalled();
  });
  it("origen CERRADO sigue permitido y llega al motor de lote", async () => {
    const r = await post(confirmar, cuerpo([901]));
    expect(r.status).toBe(200);
    expect(confirmarLote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmarLote).mock.calls[0][4].map((b) => b.origenPlanId)).toEqual([901]);
  });
  it("origen de OTRA FECHA o de OTRA EMPRESA -> 400 y no se crea nada", async () => {
    expect((await post(confirmar, cuerpo([903]))).status).toBe(400);
    expect((await post(confirmar, cuerpo([904]))).status).toBe(400);
    expect(confirmarLote).not.toHaveBeenCalled();
  });
  it("la empresa de la sesión manda: con otra empresa en sesión el plan 900 (empresa 7) no es origen válido", async () => {
    vi.mocked(requireTenantProgramacion).mockResolvedValue({ session: { username: "otro" }, empresa: { id: 8 } } as never);
    expect((await post(confirmar, cuerpo([900]))).status).toBe(400);
    expect(confirmarLote).not.toHaveBeenCalled();
  });
});

describe("ORIGEN cancelado ≠ DESTINO anterior cancelado", () => {
  it("la regla del destino vive en el motor (no aquí): el anti-duplicado sigue ignorando planes destino Cancelados", async () => {
    const { readFileSync } = await import("node:fs");
    const motor = readFileSync("src/lib/tms/programacion-lote.ts", "utf8");
    expect(motor).toContain("p.estado <> 'Cancelado'");
    expect(motor).toContain("Este viaje ya fue copiado para esta fecha");
  });
});
