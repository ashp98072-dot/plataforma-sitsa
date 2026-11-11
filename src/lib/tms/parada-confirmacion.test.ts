import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn(), registrarAuditoria: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ borrarUpload: vi.fn(), guardarUpload: vi.fn(), contentTypeFor: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { borrarUpload } from "@/lib/uploads";
import { eliminarEvidenciaTms, eliminarEvidenciaViaje } from "@/lib/flota/viaje-evidencias";
import { confirmarParadaPorPiloto, evidenciaConfirmada, listarConfirmacionesPlan, RECEPCION_OFICIAL, revisionDe, type ConfirmarParadaBody } from "./parada-confirmacion";

// TMS-ENTREGA-PILOTO-1 — pruebas del dominio con un doble de conexión (SIN base de datos real): verifican reglas, alcance de cada consulta, transacción, auditoría y no-sobrescritura.
type Fila = Record<string, unknown>;
function fixture(over: { parada?: Fila | null; piloto?: boolean; viaje?: boolean; evidencias?: Fila[]; previas?: Fila[] } = {}) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const state = {
    parada: over.parada === undefined ? { id: 10, orden: 2, lugar_nombre: "Club Zona 10", tipo: "Entrega", plan_estado: "En ruta", piloto_id: 5 } : over.parada,
    piloto: over.piloto ?? true, viaje: over.viaje ?? true,
    evidencias: over.evidencias ?? [{ id: 77, ruta_relativa: "u/1/flota/foto.jpg", capturado_en: "2026-11-11 10:00:00", subido_por: "portal:P01" }],
    previas: over.previas ?? [], inserts: [] as unknown[][], failInsert: null as unknown, failQuery: null as unknown,
  };
  const conn = {
    beginTransaction: vi.fn(async () => { calls.push({ sql: "BEGIN" }); }), commit: vi.fn(async () => { calls.push({ sql: "COMMIT" }); }),
    rollback: vi.fn(async () => { calls.push({ sql: "ROLLBACK" }); }), release: vi.fn(),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params }); if (state.failQuery) throw state.failQuery;
      if (sql.startsWith("SET TRANSACTION")) return [[]];
      if (sql.includes("FROM tms_plan_paradas pp")) return [state.parada ? [state.parada] : []];
      if (sql.includes("FROM tms_personal per")) return [state.piloto ? [{ id: 5 }] : []];
      if (sql.includes("FROM flota_viajes")) return [state.viaje ? [{ id: 900 }] : []];
      if (sql.includes("FROM flota_viaje_evidencias")) return [params && params[0] === 77 || !sql.includes("AND id")
        ? state.evidencias : state.evidencias.filter((e) => e.id === params?.[0])];
      if (sql.includes("FROM tms_parada_confirmaciones")) return [state.previas];
      throw new Error("consulta inesperada: " + sql);
    }),
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params }); if (state.failInsert) throw state.failInsert;
      expect(sql).toMatch(/^INSERT INTO tms_parada_confirmaciones/); expect((sql.match(/\?/g) ?? []).length).toBe(params?.length);
      state.inserts.push(params!); return [{ insertId: 4321 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn(async () => conn) } as never);
  return { conn, calls, state };
}
const base = { empresaId: 7, empleadoId: 31, usuario: "portal:P01", viajeId: 900, planId: 55, paradaId: 10 };
const entregada: ConfirmarParadaBody = { resultado: "ENTREGADA_POR_PILOTO" };
const sqlOf = (f: ReturnType<typeof fixture>) => f.calls.map((c) => c.sql);
beforeEach(() => { vi.clearAllMocks(); });

describe("confirmarParadaPorPiloto: camino válido", () => {
  it("agrega UNA confirmación con identidad, hora, evidencia y fotografía de la parada; audita en la misma transacción; no publica nada externo", async () => {
    const f = fixture(); const r = await confirmarParadaPorPiloto({ ...base, body: entregada });
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.replayed).toBe(false); expect(r.confirmacion).toMatchObject({ id: 4321, paradaId: 10, planId: 55, resultado: "ENTREGADA_POR_PILOTO", revision: "NO_REQUERIDA", pilotoUsuario: "portal:P01", evidenciaId: 77,
      recepcionOficial: RECEPCION_OFICIAL, estadoExternoPublicado: false });
    expect(RECEPCION_OFICIAL).toBe("NO_ACEPTADA_POR_PRICESMART");
    const [p] = f.state.inserts;   // empresa, plan, viaje, parada, tipo, orden, lugar, resultado, revision, vigente, empleado, personal, usuario, evid, ruta, captura, autor, nota, hora
    expect(p.slice(0, 18)).toEqual([7, 55, 900, 10, "Entrega", 2, "Club Zona 10", "ENTREGADA_POR_PILOTO", "NO_REQUERIDA", 1, 31, 5, "portal:P01", 77, "u/1/flota/foto.jpg", "2026-11-11 10:00:00", "portal:P01", null]);
    expect(typeof p[18]).toBe("string");
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(f.conn, expect.objectContaining({ empresaId: 7, usuario: "portal:P01", accion: "confirmar_entrega_parada_piloto", modulo: "tms" }));
    const orden = sqlOf(f); expect(orden.slice(0, 2)).toEqual(["SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "BEGIN"]); expect(orden.at(-1)).toBe("COMMIT"); expect(orden.filter((s) => s === "COMMIT")).toHaveLength(1); expect(f.conn.release).toHaveBeenCalled();
  });
  it("cada consulta lleva el alcance completo: empresa, plan, parada, viaje e identidad del colaborador salen de la sesión", async () => {
    const f = fixture(); await confirmarParadaPorPiloto({ ...base, body: entregada });
    const q = (needle: string) => f.calls.find((c) => c.sql.includes(needle))!;
    expect(q("FROM tms_plan_paradas pp").params).toEqual([10, 55, 7]); expect(q("FROM tms_plan_paradas pp").sql).toContain("FOR UPDATE");
    expect(q("FROM tms_personal per").params).toEqual([7, 31, 5, 55]);
    expect(q("FROM flota_viajes").params).toEqual([900, 7, 55]);
    const ev = q("FROM flota_viaje_evidencias"); expect(ev.params).toEqual([7, 900, 10]); expect(ev.sql).toMatch(/parada_id = \?/); expect(ev.sql).toContain("tipo = 'producto'");
    expect(q("FROM tms_parada_confirmaciones").params).toEqual([7, 10]); expect(sqlOf(f).slice(0, 2)).toEqual(["SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "BEGIN"]);   // lecturas vigentes, no una instantánea anterior a la espera del bloqueo
  });
  it("un evidenciaId explícito se valida contra empresa, viaje y parada", async () => {
    const f = fixture(); await confirmarParadaPorPiloto({ ...base, body: { ...entregada, evidenciaId: 77 } });
    expect(f.calls.find((c) => c.sql.includes("FROM flota_viaje_evidencias"))!.params).toEqual([77, 7, 900, 10]);
    const g = fixture({ evidencias: [] }); const r = await confirmarParadaPorPiloto({ ...base, body: { ...entregada, evidenciaId: 999 } });
    expect(r).toMatchObject({ ok: false, codigo: "EVIDENCIA_INVALIDA", status: 400 }); expect(g.state.inserts).toHaveLength(0);
  });
  it("cada parada tiene su confirmación independiente (dos paradas, dos filas, dos auditorías)", async () => {
    const f = fixture(); await confirmarParadaPorPiloto({ ...base, paradaId: 10, body: entregada }); await confirmarParadaPorPiloto({ ...base, paradaId: 11, body: entregada });
    expect(f.state.inserts.map((i) => i[3])).toEqual([10, 11]); expect(registrarAuditoriaTx).toHaveBeenCalledTimes(2);
  });
});

describe("confirmarParadaPorPiloto: rechazos (nada se escribe)", () => {
  const rechaza = async (over: Parameters<typeof fixture>[0], codigo: string, status: number, body: ConfirmarParadaBody = entregada) => {
    const f = fixture(over); const r = await confirmarParadaPorPiloto({ ...base, body });
    expect(r).toMatchObject({ ok: false, codigo, status }); expect(f.state.inserts).toHaveLength(0); expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(sqlOf(f)).toContain("ROLLBACK"); expect(sqlOf(f)).not.toContain("COMMIT"); expect(f.conn.release).toHaveBeenCalled();
  };
  it("parada ajena, inexistente u otra empresa/plan ⇒ PARADA_INVALIDA", () => rechaza({ parada: null }, "PARADA_INVALIDA", 404));
  it("quien no es piloto principal ni extra (auxiliar u otro) ⇒ NO_ASIGNADO", () => rechaza({ piloto: false }, "NO_ASIGNADO", 403));
  it("la parada de Carga no se confirma ⇒ TIPO_NO_CONFIRMABLE", () => rechaza({ parada: { id: 10, orden: 1, lugar_nombre: "CD", tipo: "Carga", plan_estado: "En ruta", piloto_id: 5 } }, "TIPO_NO_CONFIRMABLE", 409));
  it("viaje no abierto ⇒ VIAJE_NO_EN_CURSO", () => rechaza({ viaje: false }, "VIAJE_NO_EN_CURSO", 409));
  it.each(["Programado", "Cargado", "Descargado", "Cerrado", "Cancelado"])("plan en estado %s ⇒ VIAJE_NO_EN_CURSO", (estado) =>
    rechaza({ parada: { id: 10, orden: 2, lugar_nombre: "L", tipo: "Entrega", plan_estado: estado, piloto_id: 5 } }, "VIAJE_NO_EN_CURSO", 409));
  it("sin evidencia vinculada a la parada ⇒ SIN_EVIDENCIA", () => rechaza({ evidencias: [] }, "SIN_EVIDENCIA", 409));
  it("una entrega ya confirmada por otro piloto ⇒ YA_CONFIRMADA (no se sobrescribe)", () =>
    rechaza({ previas: [{ id: 1, plan_id: 55, parada_id: 10, resultado: "ENTREGADA_POR_PILOTO", revision: "NO_REQUERIDA", piloto_empleado_id: 99, piloto_usuario: "portal:P99", evidencia_id: 77, confirmado_en: "2026-11-11 10:05:00", nota: null }] }, "YA_CONFIRMADA", 409));
  it.each(["PARCIAL", "RECHAZADA", "INCIDENCIA"] as const)("con una incidencia %s pendiente no se puede confirmar como entregada ⇒ REVISION_PENDIENTE", (resultado) =>
    rechaza({ previas: [{ id: 2, plan_id: 55, parada_id: 10, resultado, revision: "PENDIENTE", piloto_empleado_id: 31, piloto_usuario: "portal:P01", evidencia_id: 77, confirmado_en: "2026-11-11 10:05:00", nota: "Faltó mercadería" }] }, "REVISION_PENDIENTE", 409));
});

describe("entregas parciales, rechazadas o con incidencia: revisión humana", () => {
  it.each(["PARCIAL", "RECHAZADA", "INCIDENCIA"] as const)("%s exige nota (≥5) y se valida ANTES de tocar la base", async (resultado) => {
    for (const nota of [undefined, "", "   ", "ab"]) {
      const f = fixture(); const r = await confirmarParadaPorPiloto({ ...base, body: { resultado, ...(nota !== undefined ? { nota } : {}) } });
      expect(r).toMatchObject({ ok: false, codigo: "NOTA_REQUERIDA", status: 400 }); expect(getPool).not.toHaveBeenCalled(); expect(f.state.inserts).toHaveLength(0); vi.clearAllMocks();
    }
  });
  it.each(["PARCIAL", "RECHAZADA", "INCIDENCIA"] as const)("%s con nota se guarda PENDIENTE de revisión, sin vigencia de entrega; la nota no va a la auditoría", async (resultado) => {
    const f = fixture(); const r = await confirmarParadaPorPiloto({ ...base, body: { resultado, nota: "Faltaron 3 cajas, cliente firmó" } });
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.confirmacion).toMatchObject({ resultado, revision: "PENDIENTE", nota: "Faltaron 3 cajas, cliente firmó" });
    const [p] = f.state.inserts; expect(p[8]).toBe("PENDIENTE"); expect(p[9]).toBeNull(); expect(p[17]).toBe("Faltaron 3 cajas, cliente firmó");
    expect(JSON.stringify(vi.mocked(registrarAuditoriaTx).mock.calls)).not.toContain("Faltaron 3 cajas");
  });
  it("revisionDe: solo la entrega completa no requiere revisión", () => {
    expect(revisionDe("ENTREGADA_POR_PILOTO")).toBe("NO_REQUERIDA"); for (const r of ["PARCIAL", "RECHAZADA", "INCIDENCIA"] as const) expect(revisionDe(r)).toBe("PENDIENTE");
  });
});

describe("idempotencia, concurrencia y fallos", () => {
  const previa = (resultado: string, empleado = 31) => ({ id: 3, plan_id: 55, parada_id: 10, resultado, revision: resultado === "ENTREGADA_POR_PILOTO" ? "NO_REQUERIDA" : "PENDIENTE", piloto_empleado_id: empleado, piloto_usuario: "portal:P01", evidencia_id: 70, confirmado_en: "2026-11-11 10:05:00", nota: null });
  it("el reintento idéntico del mismo piloto devuelve lo ya guardado (replayed) sin otra fila ni otra auditoría", async () => {
    const f = fixture({ previas: [previa("ENTREGADA_POR_PILOTO")] }); const r = await confirmarParadaPorPiloto({ ...base, body: entregada });
    expect(r).toMatchObject({ ok: true, replayed: true, confirmacion: { id: 3, evidenciaId: 70 } }); expect(f.state.inserts).toHaveLength(0); expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
  it("el UNIQUE de la base cierra la carrera residual ⇒ YA_CONFIRMADA con rollback", async () => {
    const f = fixture(); f.state.failInsert = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    expect(await confirmarParadaPorPiloto({ ...base, body: entregada })).toMatchObject({ ok: false, codigo: "YA_CONFIRMADA" }); expect(sqlOf(f)).toContain("ROLLBACK"); expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
  it("tabla inexistente (migración no aplicada) ⇒ NO_DISPONIBLE 503, sin dejar nada", async () => {
    const f = fixture(); f.state.failInsert = Object.assign(new Error("no table"), { errno: 1146, code: "ER_NO_SUCH_TABLE" });
    expect(await confirmarParadaPorPiloto({ ...base, body: entregada })).toMatchObject({ ok: false, codigo: "NO_DISPONIBLE", status: 503 });
    const g = fixture(); g.state.failQuery = Object.assign(new Error("no table"), { errno: 1146 });
    expect(await confirmarParadaPorPiloto({ ...base, body: entregada })).toMatchObject({ ok: false, codigo: "NO_DISPONIBLE" });
  });
  it("si falla la auditoría no queda confirmación (todo revierte) y la conexión se libera; otros errores se propagan", async () => {
    const f = fixture(); vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("auditoria caída"));
    await expect(confirmarParadaPorPiloto({ ...base, body: entregada })).rejects.toThrow("auditoria caída");
    expect(sqlOf(f)).toContain("ROLLBACK"); expect(sqlOf(f)).not.toContain("COMMIT"); expect(f.conn.release).toHaveBeenCalled();
  });
  it.each([[1213, "ER_LOCK_DEADLOCK"], [1205, "ER_LOCK_WAIT_TIMEOUT"], [1020, "ER_CHECKREAD"]])("el error reintentable %i (%s) responde REINTENTAR 503 con rollback, sin dejar nada", async (errno, code) => {
    const f = fixture(); f.state.failQuery = Object.assign(new Error("SQL secreto"), { errno, code });
    const r = await confirmarParadaPorPiloto({ ...base, body: entregada }); expect(r).toMatchObject({ ok: false, codigo: "REINTENTAR", status: 503 }); expect(sqlOf(f)).toContain("ROLLBACK"); expect(f.state.inserts).toHaveLength(0);
    const g = fixture(); g.state.failInsert = Object.assign(new Error("x"), { errno, code }); expect(await confirmarParadaPorPiloto({ ...base, body: entregada })).toMatchObject({ ok: false, codigo: "REINTENTAR" });
  });
  it("rechaza cuerpos con campos extra (empresa, piloto, hora, estado externo)", async () => {
    fixture(); for (const extra of [{ empresaId: 9 }, { pilotoId: 1 }, { confirmadoEn: "2020-01-01" }, { estadoExterno: "DELIVERED" }]) await expect(confirmarParadaPorPiloto({ ...base, body: { ...entregada, ...extra } as ConfirmarParadaBody })).rejects.toThrow();
  });
});

describe("historial inmutable", () => {
  it("el módulo y la ruta solo AGREGAN: ninguna sentencia hace UPDATE ni DELETE sobre tms_parada_confirmaciones", () => {
    const root = join(__dirname, "../../..");
    for (const f of ["src/lib/tms/parada-confirmacion.ts", "src/app/api/portal/viajes/[id]/paradas/[paradaId]/confirmar/route.ts"]) {
      const text = readFileSync(join(root, f), "utf8"); expect(text).not.toMatch(/UPDATE\s+tms_parada_confirmaciones/i); expect(text).not.toMatch(/DELETE\s+FROM\s+tms_parada_confirmaciones/i);
    }
  });
  it("la migración propuesta es solo CREATE TABLE IF NOT EXISTS (sin DROP/ALTER/DELETE ejecutables) y con restricciones de integridad", () => {
    const sql = readFileSync(join(__dirname, "../../../sql/migrate-2026-11-tms-parada-confirmaciones.sql"), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS tms_parada_confirmaciones/); expect(sql.replaceAll("ON DELETE RESTRICT", "")).not.toMatch(/\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE|GRANT)\b/i);
    for (const c of ["uq_tmspc_entrega", "fk_tmspc_plan", "fk_tmspc_parada", "ck_tmspc_resultado", "ck_tmspc_vigente", "ck_tmspc_nota"]) expect(sql).toContain(c);
    expect(sql.match(/ON DELETE RESTRICT/g)).toHaveLength(2);
    expect(sql).toContain("entrega_vigente <=> 1");   // el CHECK debe tolerar NULL: con «= 1» una entrega con entrega_vigente NULL pasaría (UNKNOWN) y esquivaría el UNIQUE
  });
  it("listarConfirmacionesPlan filtra por empresa+plan y trata la tabla ausente como vacía", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ id: 1, plan_id: 55, parada_id: 10, resultado: "ENTREGADA_POR_PILOTO", revision: "NO_REQUERIDA", piloto_usuario: "portal:P01", confirmado_en: "2026-11-11 10:05:00", evidencia_id: 77, nota: null }] as never);
    expect(await listarConfirmacionesPlan(7, 55)).toHaveLength(1); expect(vi.mocked(query).mock.calls[0][1]).toEqual([7, 55]);
    vi.mocked(query).mockRejectedValueOnce(Object.assign(new Error("x"), { errno: 1146 })); expect(await listarConfirmacionesPlan(7, 55)).toEqual([]);
    vi.mocked(query).mockRejectedValueOnce(new Error("conexión")); await expect(listarConfirmacionesPlan(7, 55)).rejects.toThrow("conexión");
  });
});

describe("la evidencia que respalda una confirmación no se puede eliminar", () => {
  it("evidenciaConfirmada consulta por empresa+ruta; tabla ausente ⇒ false; otro error se propaga", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ id: 1 }] as never); expect(await evidenciaConfirmada(7, "u/1/foto.jpg")).toBe(true); expect(vi.mocked(query).mock.calls[0][1]).toEqual([7, "u/1/foto.jpg"]);
    vi.mocked(query).mockResolvedValueOnce([] as never); expect(await evidenciaConfirmada(7, "u/1/otra.jpg")).toBe(false); expect(await evidenciaConfirmada(7, "")).toBe(false);
    vi.mocked(query).mockRejectedValueOnce(Object.assign(new Error("x"), { errno: 1146 })); expect(await evidenciaConfirmada(7, "u/1/foto.jpg")).toBe(false);
    vi.mocked(query).mockRejectedValueOnce(new Error("conexión")); await expect(evidenciaConfirmada(7, "u/1/foto.jpg")).rejects.toThrow("conexión");
  });
  it("eliminarEvidenciaViaje y eliminarEvidenciaTms la rechazan (409) sin borrar fila, copia ni archivo", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ id: 77, ruta_relativa: "u/1/foto.jpg" }] as never).mockResolvedValueOnce([{ id: 1 }] as never);
    expect(await eliminarEvidenciaViaje(7, 900, 77)).toMatchObject({ ok: false, status: 409 });
    vi.mocked(query).mockResolvedValueOnce([{ id: 5, ruta_archivo: "u/1/foto.jpg" }] as never).mockResolvedValueOnce([{ id: 1 }] as never);
    expect(await eliminarEvidenciaTms(7, 5)).toMatchObject({ ok: false, status: 409 });
    expect(execute).not.toHaveBeenCalled(); expect(borrarUpload).not.toHaveBeenCalled();
  });
  it("una evidencia sin confirmación se sigue eliminando como siempre", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ id: 77, ruta_relativa: "u/1/foto.jpg" }] as never).mockResolvedValueOnce([] as never);
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
    expect(await eliminarEvidenciaViaje(7, 900, 77)).toMatchObject({ ok: true }); expect(execute).toHaveBeenCalledTimes(2); expect(borrarUpload).toHaveBeenCalledWith("u/1/foto.jpg");
  });
});
