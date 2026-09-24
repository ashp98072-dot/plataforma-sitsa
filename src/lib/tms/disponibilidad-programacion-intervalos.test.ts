import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { ESTADOS_ASIGNACION_DIARIA, type RecursoDia } from "./disponibilidad-programacion-dia";
import { intervaloProgramacion, primerConflictoProgramacionIntervalo } from "./disponibilidad-programacion-intervalos";

type Fila = {
  categoria: "personal" | "unidad" | "tc";
  recurso_id: number;
  nombre: string;
  plan_id: number;
  codigo: string;
  empresa_id: number;
  estado: string;
  fecha_plan: string;
  hora_carga: string | null;
  regreso_estimado: string | null;
};

const ventana = (horaCarga: string | null, regresoEstimado: string | null, fechaPlan = "2026-09-24") =>
  ({ fechaPlan, horaCarga, regresoEstimado });
const recurso = (tipo: RecursoDia["tipo"]): RecursoDia => ({ tipo, id: tipo === "unidad" ? 50 : tipo === "tc" ? 60 : 10 });
const fila = (tipo: RecursoDia["tipo"], horaCarga: string | null, regresoEstimado: string | null, extras: Partial<Fila> = {}): Fila => ({
  categoria: tipo === "unidad" ? "unidad" : tipo === "tc" ? "tc" : "personal",
  recurso_id: recurso(tipo).id,
  nombre: tipo === "unidad" ? "C-123" : tipo === "tc" ? "TC-55" : "Juan Pérez",
  plan_id: 9, codigo: "PLAN-9", empresa_id: 7, estado: "Programado",
  fecha_plan: "2026-09-24", hora_carga: horaCarga, regreso_estimado: regresoEstimado,
  ...extras,
});

let candidatos: Fila[];
beforeEach(() => {
  vi.clearAllMocks();
  candidatos = [];
  vi.mocked(query).mockImplementation(async (sql, params) => {
    const texto = String(sql);
    const categoria = texto.includes("FROM tms_personal tp") ? "personal"
      : texto.includes("FROM tms_unidades u") ? "unidad" : "tc";
    const valores = params as unknown[];
    const empresaId = Number(valores[0]);
    const fechaFin = String(valores[1 + ESTADOS_ASIGNACION_DIARIA.length]);
    const fechaInicio = String(valores[2 + ESTADOS_ASIGNACION_DIARIA.length]);
    const inicio = String(valores[3 + ESTADOS_ASIGNACION_DIARIA.length]);
    const ids = valores.slice(categoria === "personal" ? 5 + ESTADOS_ASIGNACION_DIARIA.length : 4 + ESTADOS_ASIGNACION_DIARIA.length)
      .filter((x): x is number => typeof x === "number");
    return candidatos.filter((x) => x.categoria === categoria && x.empresa_id === empresaId
      && ESTADOS_ASIGNACION_DIARIA.includes(x.estado as typeof ESTADOS_ASIGNACION_DIARIA[number])
      && x.fecha_plan <= fechaFin
      && (x.fecha_plan >= fechaInicio || (x.regreso_estimado != null && x.regreso_estimado > inicio))
      && ids.includes(x.recurso_id)) as never;
  });
});

describe("intervalo de planificación compartido", () => {
  it("usa intervalos semiabiertos y timestamps completos", () => {
    expect(intervaloProgramacion(ventana("05:00", "2026-09-24T08:00")))
      .toEqual({ inicio: "2026-09-24 05:00:00", fin: "2026-09-24 08:00:00" });
  });

  it("cruza medianoche y año sin inventar duración", () => {
    expect(intervaloProgramacion(ventana("22:00", "2026-09-25T02:00")))
      .toEqual({ inicio: "2026-09-24 22:00:00", fin: "2026-09-25 02:00:00" });
    expect(intervaloProgramacion(ventana(null, null, "2026-12-31")))
      .toEqual({ inicio: "2026-12-31 00:00:00", fin: "2027-01-01 00:00:00" });
  });

  it.each([
    [null, null], ["05:00", null], [null, "2026-09-24T08:00"],
  ])("sin ventana completa reserva solo el día de fecha_plan (%s, %s)", (hora, regreso) => {
    expect(intervaloProgramacion(ventana(hora, regreso)))
      .toEqual({ inicio: "2026-09-24 00:00:00", fin: "2026-09-25 00:00:00" });
  });

  it("rechaza mismo inicio/fin, regreso anterior y valores imposibles", () => {
    expect(() => intervaloProgramacion(ventana("05:00", "2026-09-24T05:00"))).toThrow("posterior");
    expect(() => intervaloProgramacion(ventana("22:00", "2026-09-24T02:00"))).toThrow("posterior");
    expect(() => intervaloProgramacion(ventana("25:00", null))).toThrow("Hora de carga");
    expect(() => intervaloProgramacion(ventana("05:00", "2026-09-24T29:00"))).toThrow("Regreso estimado");
    expect(() => intervaloProgramacion(ventana("05:00", "2026-02-30T08:00"))).toThrow("Regreso estimado");
  });
});

describe("candidatos y conflicto de recursos", () => {
  it.each(["piloto", "auxiliar", "unidad", "tc"] as const)("%s: viajes secuenciales no chocan; solapados sí", async (tipo) => {
    candidatos.push(fila(tipo, "05:00", "2026-09-24 08:00:00"));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso(tipo)], ventana("08:00", "2026-09-24T11:00"), null)).toBeNull();
    expect((await primerConflictoProgramacionIntervalo(7, [recurso(tipo)], ventana("07:59", "2026-09-24T10:00"), null))?.codigoConflicto).toBe("PLAN-9");
  });

  it("auxiliar adicional usa la misma identidad de tms_personal y tms_plan_auxiliares", async () => {
    candidatos.push(fila("auxiliar", "05:00", "2026-09-24 08:00:00"));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("auxiliar")], ventana("07:00", "2026-09-24T09:00"), null)).not.toBeNull();
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("tms_plan_auxiliares");
    expect(sql).toContain("eq.id_empleado = tp.id_empleado");
  });

  it("viaje del día anterior que cruza medianoche bloquea 01:00 pero libera 02:00", async () => {
    candidatos.push(fila("piloto", "22:00", "2026-09-25 02:00:00"));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("piloto")], ventana("01:00", "2026-09-25T04:00", "2026-09-25"), null)).not.toBeNull();
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("piloto")], ventana("02:00", "2026-09-25T05:00", "2026-09-25"), null)).toBeNull();
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("p.regreso_estimado > ?");
    expect(sql).not.toContain("p.fecha_plan = ?");
  });

  it("sin regreso estimado bloquea su día y no el día siguiente", async () => {
    candidatos.push(fila("unidad", "05:00", null));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("unidad")], ventana("09:00", "2026-09-24T12:00"), null)).not.toBeNull();
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("unidad")], ventana("01:00", "2026-09-25T03:00", "2026-09-25"), null)).toBeNull();
  });

  it("legado sin hora de carga conserva la reserva diaria", async () => {
    candidatos.push(fila("piloto", null, null));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("piloto")], ventana("01:00", "2026-09-24T03:00"), null)).not.toBeNull();
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("piloto")], ventana("01:00", "2026-09-25T03:00", "2026-09-25"), null)).toBeNull();
  });

  it("viaje que cruza medianoche también detecta una reserva sin fin del día siguiente", async () => {
    candidatos.push(fila("unidad", "09:00", null, { fecha_plan: "2026-09-25" }));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("unidad")], ventana("22:00", "2026-09-25T02:00"), null)).not.toBeNull();
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("unidad")], ventana("22:00", "2026-09-25T00:00"), null)).toBeNull();
  });

  it("nuevo sin regreso ocupa el día completo, incluso antes de su hora de carga", async () => {
    candidatos.push(fila("tc", "05:00", "2026-09-24 08:00:00"));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("tc")], ventana("09:00", null), null)).not.toBeNull();
  });

  it.each(["Programado", "Cargado", "En ruta", "Descargado", "Cerrado"])("%s conserva la reserva de la política diaria", async (estado) => {
    candidatos.push(fila("unidad", "05:00", "2026-09-24 08:00:00", { estado }));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("unidad")], ventana("07:00", "2026-09-24T09:00"), null)).not.toBeNull();
  });

  it("Cancelado no ocupa", async () => {
    candidatos.push(fila("unidad", "05:00", "2026-09-24 08:00:00", { estado: "Cancelado" }));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("unidad")], ventana("07:00", "2026-09-24T09:00"), null)).toBeNull();
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain("p.estado IN");
  });

  it("empresa ajena y recursos de otro tipo nunca bloquean", async () => {
    candidatos.push(fila("unidad", "05:00", "2026-09-24 08:00:00", { empresa_id: 8 }));
    candidatos.push(fila("tc", "05:00", "2026-09-24 08:00:00"));
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("unidad")], ventana("07:00", "2026-09-24T09:00"), null)).toBeNull();
    expect((vi.mocked(query).mock.calls[0][1] as unknown[])[0]).toBe(7);
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain("p.empresa_id = ?");
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain("COALESCE(p.tipo_viaje, 'Propio') <> 'Tercerizado'");
  });

  it("TC tiene su propia columna y los cuatro recursos se consultan en tres lotes", async () => {
    await primerConflictoProgramacionIntervalo(7, [recurso("piloto"), recurso("auxiliar"), recurso("unidad"), recurso("tc")], ventana("07:00", "2026-09-24T09:00"), null);
    expect(query).toHaveBeenCalledTimes(3);
    expect(vi.mocked(query).mock.calls.some(([sql]) => String(sql).includes("p.tc_vehiculo_id = v.id"))).toBe(true);
  });

  it("excluye el propio plan y la lectura bajo transacción usa FOR UPDATE", async () => {
    const conn = { query: vi.fn().mockResolvedValue([[]]) };
    expect(await primerConflictoProgramacionIntervalo(7, [recurso("unidad")], ventana("07:00", "2026-09-24T09:00"), 9, conn as never)).toBeNull();
    expect(String(conn.query.mock.calls[0][0])).toMatch(/p.id <> \?[\s\S]*FOR UPDATE$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("sin recursos internos no consulta BD (tercerizado)", async () => {
    expect(await primerConflictoProgramacionIntervalo(7, [], ventana("07:00", "2026-09-24T09:00"), null)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
