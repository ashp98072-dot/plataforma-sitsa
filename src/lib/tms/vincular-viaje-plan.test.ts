import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { buscarPlanCandidatoUnicoParaViaje, listarViajesCandidatosParaPlan, vincularViajeAPlan } from "./vincular-viaje-plan";

const conn = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  destroy: vi.fn(),
};
const getConnection = vi.fn();

const PLAN_BASE = {
  id: 30, codigo: "PLAN-20260827-001", estado: "Programado", fecha_plan: "2026-08-27",
  piloto_id: 4, unidad_id: 9, piloto_empleado_id: 501, flota_vehiculo_id: 15,
};
const VIAJE_BASE = { id: 5, empleado_id: 501, vehiculo_id: 15, hora_salida: "2026-08-27 07:00:00", plan_id: null };

/** Despacha conn.query() según el SQL, para no depender del orden exacto de llamadas. */
function mockConnQuery(overrides: {
  plan?: Record<string, unknown> | null;
  viaje?: Record<string, unknown> | null;
  otroViaje?: Record<string, unknown> | null;
  evidencias?: Record<string, unknown>[];
  yaSincronizada?: (ruta: string) => boolean;
}) {
  conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM tms_planes_viaje p")) {
      return [overrides.plan === undefined ? [PLAN_BASE] : overrides.plan ? [overrides.plan] : []];
    }
    if (sql.includes("FROM flota_viajes v WHERE v.id = ?")) {
      return [overrides.viaje === undefined ? [VIAJE_BASE] : overrides.viaje ? [overrides.viaje] : []];
    }
    if (sql.includes("id <> ?")) {
      return [overrides.otroViaje ? [overrides.otroViaje] : []];
    }
    if (sql.includes("FROM flota_viaje_evidencias WHERE viaje_id")) {
      return [overrides.evidencias ?? []];
    }
    if (sql.includes("FROM tms_evidencias WHERE empresa_id = ? AND plan_id = ? AND ruta_archivo")) {
      const ruta = String((params as unknown[])[2]);
      const yaExiste = overrides.yaSincronizada?.(ruta) ?? false;
      return [yaExiste ? [{ id: 1 }] : []];
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.execute.mockResolvedValue([{ affectedRows: 1, insertId: 1 }, []]);
  mockConnQuery({});
});
afterEach(() => vi.restoreAllMocks());

describe("PORTAL-HARDENING-2 (corrección final) — vincularViajeAPlan: solo vínculo estricto y verificable", () => {
  it("1) vínculo válido (piloto+unidad+fecha+estado coinciden, sin otro viaje en curso) → éxito", async () => {
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.planCodigo).toBe("PLAN-20260827-001");
      expect(r.evidenciasSincronizadas).toBe(0);
    }
    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE flota_viajes SET plan_id"),
      [30, 5, 7],
    );
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("2) plan/viaje de otra empresa → no se encuentra (404), rechazado", async () => {
    // Las consultas ya filtran por empresa_id = ? en el propio SQL; si la
    // fila pertenece a otra empresa, MySQL real simplemente no la
    // devuelve — se simula ese caso (plan no encontrado para esta empresa).
    mockConnQuery({ plan: null });
    const r = await vincularViajeAPlan(999, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.error).toContain("Plan no encontrado");
    }
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("3) piloto del plan distinto al del viaje → rechazo 409", async () => {
    mockConnQuery({ plan: { ...PLAN_BASE, piloto_empleado_id: 999 } });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.error).toContain("piloto");
    }
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("4) unidad del plan distinta a la del viaje → rechazo 409", async () => {
    mockConnQuery({ plan: { ...PLAN_BASE, flota_vehiculo_id: 999 } });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.error).toContain("unidad");
    }
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("5) fecha del plan distinta a la fecha real del viaje → rechazo 409", async () => {
    mockConnQuery({ plan: { ...PLAN_BASE, fecha_plan: "2026-08-20" } });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.error).toContain("fecha");
    }
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("6) viaje ya vinculado a un plan → 409", async () => {
    mockConnQuery({ viaje: { ...VIAJE_BASE, plan_id: 999 } });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.error).toContain("ya está vinculado");
    }
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it('6b) [P1] el plan ya tiene OTRO viaje técnico ABIERTO → 409 "ya está vinculado a otro viaje técnico"', async () => {
    mockConnQuery({ otroViaje: { id: 100, estado: "abierto" } });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.error).toBe("Este plan ya está vinculado a otro viaje técnico.");
    }
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it('6c) [P1] el plan ya tiene OTRO viaje técnico CERRADO (no solo abierto) → también 409', async () => {
    // Antes de esta corrección, un viaje CERRADO no bloqueaba — permitía
    // que el mismo plan quedara apuntado por dos flota_viajes distintos.
    mockConnQuery({ otroViaje: { id: 100, estado: "cerrado" } });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.error).toBe("Este plan ya está vinculado a otro viaje técnico.");
    }
    expect(conn.execute).not.toHaveBeenCalled();
    // La consulta de exclusividad ya NO filtra por estado = 'abierto'.
    const otroViajeCall = conn.query.mock.calls.find((c) => String(c[0]).includes("id <> ?"));
    expect(String(otroViajeCall?.[0])).not.toContain("estado = 'abierto'");
  });

  it("6d) [P1] ningún otro viaje vinculado al plan → permitido (no bloquea el vínculo)", async () => {
    mockConnQuery({ otroViaje: null });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(true);
  });

  it("7) doble envío concurrente: el segundo pierde la carrera (UPDATE afecta 0 filas) → 409, no duplica ni sincroniza", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE flota_viajes SET plan_id")) return [{ affectedRows: 0 }, []];
      return [{ affectedRows: 1, insertId: 1 }, []];
    });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("8) nunca cambia el estado del plan TMS ni del viaje técnico (ninguna escritura toca esas columnas)", async () => {
    mockConnQuery({
      evidencias: [{ id: 1, tipo: "tablero_salida", ruta_relativa: "flota/e1.jpg", nombre_original: "e1.jpg", latitud: 14.6, longitud: -90.5, capturado_en: "2026-08-27 07:05:00", subido_por: "portal:E001", parada_id: null }],
    });
    await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    for (const call of conn.execute.mock.calls) {
      const sql = String(call[0]);
      expect(sql).not.toMatch(/SET\s+estado/i);
    }
  });

  it("9) registra auditoría con plan, viaje, piloto, unidad y fecha", async () => {
    await vincularViajeAPlan(7, 30, 5, "jefe.operaciones", "MANUAL_OPERACIONES");
    expect(registrarAuditoriaTx).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(payload.accion).toBe("vincular_viaje_plan");
    expect(payload.modulo).toBe("tms");
    expect(payload.detalle).toContain("Plan #30 PLAN-20260827-001");
    expect(payload.detalle).toContain("viaje técnico #5");
    expect(payload.detalle).toContain("piloto empleado #501");
    expect(payload.detalle).toContain("unidad vehículo #15");
    expect(payload.detalle).toContain("2026-08-27");
    expect(payload.usuario).toBe("jefe.operaciones");
  });

  it('9b) [P1] origen "AUTO_PORTAL" audita distinto de "MANUAL_OPERACIONES" — nunca dice "vinculado manualmente" para algo que decidió el sistema', async () => {
    const r = await vincularViajeAPlan(7, 30, 5, "portal:E001", "AUTO_PORTAL");
    expect(r.ok).toBe(true);
    const [, payload] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(payload.accion).toBe("vincular_viaje_plan_auto");
    expect(payload.detalle).toContain("vinculado automáticamente por el sistema al subir evidencia");
    expect(payload.detalle).not.toContain("vinculado manualmente");
  });

  it("10) backfill de evidencia existente: una fila NUEVA se sincroniza una sola vez, una YA sincronizada no se duplica", async () => {
    mockConnQuery({
      evidencias: [
        { id: 1, tipo: "tablero_salida", ruta_relativa: "flota/nueva.jpg", nombre_original: "n.jpg", latitud: 14.6, longitud: -90.5, capturado_en: "2026-08-27 07:05:00", subido_por: "portal:E001", parada_id: null },
        { id: 2, tipo: "producto", ruta_relativa: "flota/ya-sincronizada.jpg", nombre_original: "y.jpg", latitud: 14.6, longitud: -90.5, capturado_en: "2026-08-27 08:00:00", subido_por: "portal:E001", parada_id: 3 },
      ],
      yaSincronizada: (ruta) => ruta === "flota/ya-sincronizada.jpg",
    });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.evidenciasSincronizadas).toBe(1);
    const insertsTms = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_evidencias"));
    expect(insertsTms).toHaveLength(1);
    expect(insertsTms[0][1]).toEqual(
      expect.arrayContaining(["flota/nueva.jpg"]),
    );
  });

  it("11) [P0] si falla la lectura de flota_viaje_evidencias, NO se asume cero evidencias: se relanza y hace rollback completo (el UPDATE de plan_id ya se había intentado)", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM tms_planes_viaje p")) return [[PLAN_BASE]];
      if (sql.includes("FROM flota_viajes v WHERE v.id = ?")) return [[VIAJE_BASE]];
      if (sql.includes("id <> ?")) return [[]];
      if (sql.includes("FROM flota_viaje_evidencias WHERE viaje_id")) {
        throw new Error("Conexión perdida");
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    });
    await expect(vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES")).rejects.toThrow("Conexión perdida");
    // El UPDATE de plan_id ya se había ejecutado ANTES de leer evidencias
    // — por eso el rollback es indispensable, no un simple "no hacer nada".
    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE flota_viajes SET plan_id"),
      [30, 5, 7],
    );
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("12) [P0/P1] si el INSERT completo en tms_evidencias falla con un error QUE NO es 'columna desconocida', se relanza sin segundo INSERT — rollback completo, nada de vínculo parcial", async () => {
    mockConnQuery({
      evidencias: [{ id: 1, tipo: "tablero_salida", ruta_relativa: "flota/e1.jpg", nombre_original: "e1.jpg", latitud: 14.6, longitud: -90.5, capturado_en: "2026-08-27 07:05:00", subido_por: "portal:E001", parada_id: null }],
    });
    conn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE flota_viajes SET plan_id")) return [{ affectedRows: 1 }, []];
      if (sql.includes("INSERT INTO tms_evidencias")) {
        const err = new Error("Cannot add or update a child row: a foreign key constraint fails");
        (err as { code?: string }).code = "ER_NO_REFERENCED_ROW_2";
        throw err;
      }
      return [{ affectedRows: 1, insertId: 1 }, []];
    });
    await expect(vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES")).rejects.toThrow(/foreign key/);
    const insertsTms = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_evidencias"));
    expect(insertsTms).toHaveLength(1); // nunca un segundo INSERT "reducido" ocultando el error real
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("13) [P0/P1] si el INSERT completo falla por columna desconocida (ER_BAD_FIELD_ERROR), SÍ degrada a un segundo INSERT reducido — único caso permitido", async () => {
    mockConnQuery({
      evidencias: [{ id: 1, tipo: "tablero_salida", ruta_relativa: "flota/e1.jpg", nombre_original: "e1.jpg", latitud: 14.6, longitud: -90.5, capturado_en: "2026-08-27 07:05:00", subido_por: "portal:E001", parada_id: null }],
    });
    let intentos = 0;
    conn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE flota_viajes SET plan_id")) return [{ affectedRows: 1 }, []];
      if (sql.includes("INSERT INTO tms_evidencias")) {
        intentos++;
        if (intentos === 1) {
          const err = new Error("Unknown column 'parada_id' in 'field list'");
          (err as { code?: string }).code = "ER_BAD_FIELD_ERROR";
          throw err;
        }
        return [{ affectedRows: 1, insertId: 1 }, []];
      }
      return [{ affectedRows: 1, insertId: 1 }, []];
    });
    const r = await vincularViajeAPlan(7, 30, 5, "ops1", "MANUAL_OPERACIONES");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.evidenciasSincronizadas).toBe(1);
    const insertsTms = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_evidencias"));
    expect(insertsTms).toHaveLength(2); // completo (falla) + reducido (éxito)
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
});

describe("PORTAL-HARDENING-2 (corrección final) — listarViajesCandidatosParaPlan: sin heurística de texto", () => {
  it("solo devuelve viajes sin plan_id que coinciden exactamente en piloto/unidad/fecha del plan", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ estado: "Programado", fecha_plan: "2026-08-27", piloto_empleado_id: 501, flota_vehiculo_id: 15 }] as unknown as Awaited<ReturnType<typeof query>>)
      .mockResolvedValueOnce([{ id: 5, hora_salida: "2026-08-27 07:00:00", placa: "C-034BXR" }] as unknown as Awaited<ReturnType<typeof query>>);
    const candidatos = await listarViajesCandidatosParaPlan(7, 30);
    expect(candidatos).toEqual([{ viajeId: 5, horaSalida: "2026-08-27 07:00:00", placa: "C-034BXR" }]);
    const [sql, params] = vi.mocked(query).mock.calls[1];
    expect(sql).toContain("v.plan_id IS NULL");
    expect(sql).toContain("v.empleado_id = ?");
    expect(sql).toContain("v.vehiculo_id = ?");
    expect(sql).toContain("DATE(v.hora_salida) = ?");
    expect(params).toEqual([7, 501, 15, "2026-08-27"]);
  });

  it("si el plan no tiene piloto/unidad resolubles, no devuelve candidatos (evita falsos positivos)", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      [{ estado: "Programado", fecha_plan: "2026-08-27", piloto_empleado_id: null, flota_vehiculo_id: null }] as unknown as Awaited<ReturnType<typeof query>>,
    );
    const candidatos = await listarViajesCandidatosParaPlan(7, 30);
    expect(candidatos).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each(["Cerrado", "Cancelado", "Descargado"])(
    "[P2] plan en estado %s → [] (no ofrece en UI algo que POST rechazaría de inmediato)",
    async (estado) => {
      vi.mocked(query).mockResolvedValueOnce(
        [{ estado, fecha_plan: "2026-08-27", piloto_empleado_id: 501, flota_vehiculo_id: 15 }] as unknown as Awaited<ReturnType<typeof query>>,
      );
      const candidatos = await listarViajesCandidatosParaPlan(7, 30);
      expect(candidatos).toEqual([]);
      // No debió ni intentar buscar viajes técnicos candidatos.
      expect(query).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["Programado", "Cargado", "En ruta"])(
    "[P2] plan en estado %s sí puede tener candidatos",
    async (estado) => {
      vi.mocked(query)
        .mockResolvedValueOnce([{ estado, fecha_plan: "2026-08-27", piloto_empleado_id: 501, flota_vehiculo_id: 15 }] as unknown as Awaited<ReturnType<typeof query>>)
        .mockResolvedValueOnce([{ id: 5, hora_salida: "2026-08-27 07:00:00", placa: "C-034BXR" }] as unknown as Awaited<ReturnType<typeof query>>);
      const candidatos = await listarViajesCandidatosParaPlan(7, 30);
      expect(candidatos).toHaveLength(1);
    },
  );
});

// ÚLTIMA CORRECCIÓN P1 (unificación de autoridad de vínculo) — la
// búsqueda que antes vivía embebida en
// api/portal/viajes/[id]/evidencias/route.ts, ahora aquí como pieza
// reutilizable. Es solo la mitad "búsqueda best-effort" del auto-vínculo
// — la autoridad real de exclusividad/concurrencia sigue siendo
// vincularViajeAPlan (probado arriba), a la que el Portal debe delegar.
describe("PORTAL-HARDENING-2 (última corrección) — buscarPlanCandidatoUnicoParaViaje: mitad 'búsqueda' del auto-vínculo del Portal", () => {
  it("candidato único (piloto+unidad+fecha+estado coinciden) → devuelve su id", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ empleado_id: 501, vehiculo_id: 15, hora_salida: "2026-08-27 07:00:00" }] as unknown as Awaited<ReturnType<typeof query>>)
      .mockResolvedValueOnce([{ id: 30 }] as unknown as Awaited<ReturnType<typeof query>>);
    const planId = await buscarPlanCandidatoUnicoParaViaje(7, 5);
    expect(planId).toBe(30);
    const [sql, params] = vi.mocked(query).mock.calls[1];
    expect(sql).toContain("pil.id_empleado = ?");
    expect(sql).toContain("u.flota_vehiculo_id = ?");
    expect(sql).toContain("p.fecha_plan = ?");
    expect(params).toEqual([7, 501, 15, "2026-08-27", "Programado", "Cargado", "En ruta"]);
  });

  it("0 candidatos → null", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ empleado_id: 501, vehiculo_id: 15, hora_salida: "2026-08-27 07:00:00" }] as unknown as Awaited<ReturnType<typeof query>>)
      .mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    expect(await buscarPlanCandidatoUnicoParaViaje(7, 5)).toBeNull();
  });

  it("2+ candidatos (ambigüedad real) → null", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ empleado_id: 501, vehiculo_id: 15, hora_salida: "2026-08-27 07:00:00" }] as unknown as Awaited<ReturnType<typeof query>>)
      .mockResolvedValueOnce([{ id: 30 }, { id: 31 }] as unknown as Awaited<ReturnType<typeof query>>);
    expect(await buscarPlanCandidatoUnicoParaViaje(7, 5)).toBeNull();
  });

  it("viaje inexistente o con datos incompletos (sin empleado/vehículo/hora) → null, sin buscar candidatos", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    expect(await buscarPlanCandidatoUnicoParaViaje(7, 5)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
