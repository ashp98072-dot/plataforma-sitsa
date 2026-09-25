import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RRHH VACACIONES — eliminar un registro y devolver el saldo. BD simulada EN MEMORIA y TRANSACCIONAL (BEGIN respalda,
 * ROLLBACK restaura) que responde al SQL real que envía la función; se pueden inyectar fallos en cada paso.
 * Sin BD real: ningún SQL se ejecuta contra ninguna base.
 */
const h = vi.hoisted(() => ({ falla: null as null | "saldo" | "detalle" | "espejo" | "incidencia" | "auditoria" | "sync" }));

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("./vacaciones", () => ({ sincronizarPeriodosVacacionesEnConexion: vi.fn() }));

import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { sincronizarPeriodosVacacionesEnConexion } from "./vacaciones";
import { eliminarRegistroVacaciones, MSG_CON_EVIDENCIAS } from "./vacaciones-eliminar";

const EMP = 3;
type Inc = { id: number; empresa_id: number; id_empleado: number; tipo: string; fecha_inicio: string; fecha_fin: string; dias_habiles: number };
type Det = { id: number; incidencia_id: number; saldo_id: number; dias_tomados: number };
type Saldo = { id: number; empresa_id: number; id_empleado: number; anio_laboral: number; dias_otorgados: number; dias_disponibles: number; estado: string };
type Vac = { id: number; empresa_id: number; id_empleado: number; fecha_inicio: string; fecha_fin: string; dias_habiles: number; estado: string };
type Db = { incidencias: Inc[]; detalle: Det[]; saldos: Saldo[]; vacaciones: Vac[]; evidencias: { id: number; empresa_id: number; incidencia_id: number }[]; auditoria: { accion: string; detalle: string; usuario: string }[] };
let db: Db;
let respaldo = "";
let eventos: string[];

const inc = (id: number, over: Partial<Inc> = {}): Inc => ({ id, empresa_id: EMP, id_empleado: 7, tipo: "Vacaciones", fecha_inicio: "2026-01-02", fecha_fin: "2026-01-03", dias_habiles: 2, ...over });
const saldo = (id: number, over: Partial<Saldo> = {}): Saldo => ({ id, empresa_id: EMP, id_empleado: 7, anio_laboral: id, dias_otorgados: 15, dias_disponibles: 11, estado: "Vigente", ...over });
const vac = (id: number, over: Partial<Vac> = {}): Vac => ({ id, empresa_id: EMP, id_empleado: 7, fecha_inicio: "2026-01-02", fecha_fin: "2026-01-03", dias_habiles: 2, estado: "Aprobado", ...over });
const totalSaldo = () => Math.round(db.saldos.filter((s) => s.estado === "Vigente").reduce((a, s) => a + s.dias_disponibles, 0) * 100) / 100;

/** Caso real: saldo 22.19 tras DOS registros idénticos (02/01→03/01, 2 días) que descontaron 4 días del período 1. */
function casoReal(): Db {
  return {
    incidencias: [inc(500), inc(501)],
    detalle: [{ id: 1, incidencia_id: 500, saldo_id: 1, dias_tomados: 2 }, { id: 2, incidencia_id: 501, saldo_id: 1, dias_tomados: 2 }],
    saldos: [saldo(1, { dias_disponibles: 11 }), saldo(2, { dias_disponibles: 11.19 })],
    vacaciones: [vac(1), vac(2)],
    evidencias: [],
    auditoria: [],
  };
}

function crearConexion() {
  const fallar = (paso: NonNullable<typeof h.falla>) => { if (h.falla === paso) throw new Error(`fallo inyectado: ${paso}`); };
  return {
    beginTransaction: vi.fn(async () => { eventos.push("begin"); respaldo = JSON.stringify(db); }),
    commit: vi.fn(async () => { eventos.push("commit"); }),
    rollback: vi.fn(async () => { eventos.push("rollback"); if (respaldo) db = JSON.parse(respaldo); }),
    release: vi.fn(() => { eventos.push("release"); }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      if (s.includes("FROM incidencias WHERE id = ? AND empresa_id = ?")) {
        expect(s).toContain("FOR UPDATE");
        return [db.incidencias.filter((i) => i.id === params[0] && i.empresa_id === params[1])];
      }
      if (s.includes("FROM empleados")) return [[{ nombre: "Danis Mardoqueo Chub Choc" }]];
      if (s.includes("FROM evidencias_incidencias")) return [db.evidencias.filter((e) => e.incidencia_id === params[0] && e.empresa_id === params[1])];
      if (s.includes("FROM detalle_consumo_vacaciones WHERE incidencia_id")) { expect(s).toContain("FOR UPDATE"); return [db.detalle.filter((d) => d.incidencia_id === params[0])]; }
      if (s.includes("FROM saldos_vacaciones")) {
        const [empresa, ...ids] = params as number[];
        return [db.saldos.filter((x) => x.empresa_id === empresa && ids.includes(x.id))];
      }
      if (s.includes("FROM solicitudes_vacaciones")) return [[]];
      if (s.includes("FROM vacaciones")) {
        expect(s).toContain("LIMIT 1 FOR UPDATE");
        const [empresa, emp, fi, ff, dias] = params as [number, number, string, string, number];
        return [db.vacaciones.filter((v) => v.empresa_id === empresa && v.id_empleado === emp && v.fecha_inicio === fi && v.fecha_fin === ff && v.dias_habiles === dias && v.estado === "Aprobado").sort((a, b) => b.id - a.id).slice(0, 1)];
      }
      throw new Error(`consulta inesperada: ${s.slice(0, 70)}`);
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      if (s.startsWith("UPDATE saldos_vacaciones SET dias_disponibles")) {
        fallar("saldo"); eventos.push("update-saldo");
        const x = db.saldos.find((q) => q.id === params[1] && q.empresa_id === params[2]);
        if (x) x.dias_disponibles = params[0] as number;
        return [{ affectedRows: x ? 1 : 0 }];
      }
      if (s.startsWith("DELETE FROM detalle_consumo_vacaciones WHERE incidencia_id")) {
        fallar("detalle"); eventos.push("delete-detalle");
        const n = db.detalle.length; db.detalle = db.detalle.filter((d) => d.incidencia_id !== params[0]);
        return [{ affectedRows: n - db.detalle.length }];
      }
      if (s.startsWith("DELETE FROM vacaciones WHERE id = ? AND empresa_id = ?")) {
        fallar("espejo"); eventos.push("delete-espejo");
        const n = db.vacaciones.length; db.vacaciones = db.vacaciones.filter((v) => !(v.id === params[0] && v.empresa_id === params[1]));
        return [{ affectedRows: n - db.vacaciones.length }];
      }
      if (s.startsWith("DELETE FROM incidencias WHERE id = ? AND empresa_id = ?")) {
        fallar("incidencia"); eventos.push("delete-incidencia");
        const n = db.incidencias.length; db.incidencias = db.incidencias.filter((i) => !(i.id === params[0] && i.empresa_id === params[1]));
        return [{ affectedRows: n - db.incidencias.length }];
      }
      throw new Error(`SQL de escritura inesperado: ${s.slice(0, 70)}`);
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.falla = null;
  eventos = [];
  respaldo = "";
  db = casoReal();
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => crearConexion() } as never);
  vi.mocked(registrarAuditoriaTx).mockImplementation((async (_c: unknown, i: { accion: string; detalle?: string; usuario?: string | null }) => {
    if (h.falla === "auditoria") throw new Error("fallo inyectado: auditoria");
    db.auditoria.push({ accion: i.accion, detalle: String(i.detalle), usuario: String(i.usuario) });
  }) as never);
  vi.mocked(sincronizarPeriodosVacacionesEnConexion).mockImplementation((async () => { if (h.falla === "sync") throw new Error("fallo inyectado: sync"); }) as never);
});

const eliminar = (id: number, empresa = EMP) => eliminarRegistroVacaciones(empresa, id, "rrhh.ana");

describe("Eliminar registro de vacaciones — devolución FIFO exacta", () => {
  it("1) elimina Vacaciones y devuelve los días al período del que salieron", async () => {
    const r = await eliminar(501);
    expect(r).toMatchObject({ ok: true, diasRestaurados: 2, empleadoId: 7, mensaje: "Registro eliminado y 2 día(s) restaurados." });
    expect(db.saldos.find((s) => s.id === 1)!.dias_disponibles).toBe(13);
    expect(db.saldos.find((s) => s.id === 2)!.dias_disponibles).toBe(11.19); // el otro período no se toca
  });

  it("2) el consumo repartido entre 2 períodos FIFO vuelve EXACTAMENTE a cada uno (1.25 + 0.75)", async () => {
    db.incidencias = [inc(600, { dias_habiles: 2 })];
    db.detalle = [{ id: 10, incidencia_id: 600, saldo_id: 1, dias_tomados: 1.25 }, { id: 11, incidencia_id: 600, saldo_id: 2, dias_tomados: 0.75 }];
    db.saldos = [saldo(1, { dias_disponibles: 10 }), saldo(2, { dias_disponibles: 12 })];
    db.vacaciones = [vac(9)];
    const r = await eliminar(600);
    expect(r).toMatchObject({ ok: true, diasRestaurados: 2 });
    expect(db.saldos.map((s) => s.dias_disponibles)).toEqual([11.25, 12.75]);
    expect(r.ok && r.desglose.map((d) => [d.saldoId, d.diasRestaurados])).toEqual([[1, 1.25], [2, 0.75]]);
  });

  it("3) CASO REAL: entre dos duplicados idénticos se elimina SOLO el pedido; el saldo sube exactamente 2 (22.19 → 24.19)", async () => {
    expect(totalSaldo()).toBe(22.19);
    const r = await eliminar(501);
    expect(r.ok).toBe(true);
    expect(db.incidencias.map((i) => i.id)).toEqual([500]); // queda UNA
    expect(totalSaldo()).toBe(24.19);
    expect(db.detalle.map((d) => d.incidencia_id)).toEqual([500]); // detalle FIFO de la eliminada desaparece; el de la otra permanece
    expect(db.vacaciones.map((v) => v.id)).toEqual([1]); // solo UNA fila espejo desaparece
    expect(db.auditoria).toHaveLength(1);
  });

  it("4) una segunda llamada DELETE no devuelve saldo otra vez (404)", async () => {
    await eliminar(501);
    const antes = totalSaldo();
    const r2 = await eliminar(501);
    expect(r2).toMatchObject({ ok: false, status: 404 });
    expect(totalSaldo()).toBe(antes);
    expect(db.auditoria).toHaveLength(1);
  });

  it("5) una incidencia de OTRA empresa devuelve 404 y no toca nada", async () => {
    const r = await eliminar(501, 99);
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(db.incidencias).toHaveLength(2);
    expect(totalSaldo()).toBe(22.19);
    expect(eventos).toContain("rollback");
  });

  it("8/9) Vacaciones y A cuenta de Vacaciones restauran saldo", async () => {
    for (const tipo of ["Vacaciones", "A cuenta de Vacaciones"]) {
      db = casoReal();
      db.incidencias[1].tipo = tipo;
      expect(await eliminar(501)).toMatchObject({ ok: true, diasRestaurados: 2 });
      expect(totalSaldo()).toBe(24.19);
    }
  });

  it("10/11) Permiso con goce, Permiso sin goce, IGSS y Médico NO tocan saldos ni la fila espejo", async () => {
    for (const tipo of ["Permiso con goce", "Permiso sin goce", "IGSS", "Médico"]) {
      db = casoReal();
      db.incidencias[1].tipo = tipo;
      db.detalle = db.detalle.filter((d) => d.incidencia_id !== 501); // no consumieron saldo
      const r = await eliminar(501);
      expect(r).toMatchObject({ ok: true, diasRestaurados: 0, mensaje: "Registro eliminado." });
      expect(db.saldos.map((s) => s.dias_disponibles)).toEqual([11, 11.19]);
      expect(db.vacaciones).toHaveLength(2); // estos tipos no crean espejo
      expect(db.incidencias.map((i) => i.id)).toEqual([500]);
      expect(eventos).not.toContain("update-saldo");
    }
  });

  it("6b) un tipo que esta pantalla no crea (p. ej. Falta) no se elimina desde aquí (400)", async () => {
    db.incidencias[1].tipo = "Falta injustificada";
    expect(await eliminar(501)).toMatchObject({ ok: false, status: 400 });
    expect(db.incidencias).toHaveLength(2);
  });

  it("12) 'Vacaciones' SIN detalle FIFO falla de forma segura (409): no inventa consumo ni borra", async () => {
    db.detalle = db.detalle.filter((d) => d.incidencia_id !== 501);
    const r = await eliminar(501);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(db.incidencias).toHaveLength(2);
    expect(totalSaldo()).toBe(22.19);
  });

  it("13) rollback total si falla al devolver un saldo", async () => {
    h.falla = "saldo";
    await expect(eliminar(501)).rejects.toThrow("fallo inyectado");
    expect(eventos).toContain("rollback");
    expect(eventos).not.toContain("commit");
    expect(db).toEqual(casoReal());
  });

  it("14) rollback si falla al borrar la incidencia: el saldo devuelto también se revierte", async () => {
    h.falla = "incidencia";
    await expect(eliminar(501)).rejects.toThrow("fallo inyectado");
    expect(eventos).toContain("update-saldo"); // ya se había devuelto…
    expect(db).toEqual(casoReal()); // …y todo volvió atrás: ni saldo devuelto con incidencia viva ni al revés
  });

  it("15) rollback si falla la auditoría (todo o nada)", async () => {
    h.falla = "auditoria";
    await expect(eliminar(501)).rejects.toThrow("fallo inyectado");
    expect(eventos).toContain("delete-incidencia");
    expect(db).toEqual(casoReal());
    expect(eventos).not.toContain("commit");
  });

  it("15b) rollback si falla el borrado del detalle o de la fila espejo", async () => {
    for (const falla of ["detalle", "espejo"] as const) {
      db = casoReal(); eventos = []; h.falla = falla;
      await expect(eliminar(501)).rejects.toThrow("fallo inyectado");
      expect(db).toEqual(casoReal());
    }
  });

  it("16) no deja detalle_consumo_vacaciones huérfano (ningún detalle apunta a una incidencia inexistente)", async () => {
    await eliminar(501);
    const ids = new Set(db.incidencias.map((i) => i.id));
    expect(db.detalle.every((d) => ids.has(d.incidencia_id))).toBe(true);
  });

  it("17) no elimina el duplicado hermano ni su detalle ni su espejo", async () => {
    await eliminar(500);
    expect(db.incidencias.map((i) => i.id)).toEqual([501]);
    expect(db.detalle).toEqual([{ id: 2, incidencia_id: 501, saldo_id: 1, dias_tomados: 2 }]);
    expect(db.vacaciones).toHaveLength(1);
  });

  it("18) fila espejo: con duplicados idénticos se borra UNA (la de mayor id) por su id concreto; nunca un DELETE por fechas", async () => {
    await eliminar(501);
    expect(db.vacaciones.map((v) => v.id)).toEqual([1]);
    const fuente = readFileSync("src/lib/rrhh/vacaciones-eliminar.ts", "utf8");
    expect(fuente).toContain("DELETE FROM vacaciones WHERE id = ? AND empresa_id = ?");
    expect(fuente).toContain("ORDER BY id DESC LIMIT 1 FOR UPDATE");
    expect(fuente).not.toMatch(/DELETE FROM vacaciones\s+WHERE\s+empresa_id/);
  });

  it("18b) sin fila espejo (registro anterior a su creación) se elimina igual y se advierte", async () => {
    db.vacaciones = [];
    const r = await eliminar(501);
    expect(r).toMatchObject({ ok: true, espejoEliminado: false });
    expect(r.ok && r.advertencias.join(" ")).toContain("fila espejo");
  });

  it("19) con evidencias adjuntas se BLOQUEA (409) para no dejar archivos huérfanos; sin evidencias procede", async () => {
    db.evidencias = [{ id: 1, empresa_id: EMP, incidencia_id: 501 }];
    const r = await eliminar(501);
    expect(r).toMatchObject({ ok: false, status: 409, error: MSG_CON_EVIDENCIAS });
    expect(db.incidencias).toHaveLength(2);
    expect(totalSaldo()).toBe(22.19);
    db.evidencias = [{ id: 2, empresa_id: EMP, incidencia_id: 500 }]; // la evidencia es del hermano
    expect((await eliminar(501)).ok).toBe(true);
  });

  it("período VENCIDO: sus días no se restauran (se informa) y el resto sí", async () => {
    db.saldos[0].estado = "Vencido"; db.saldos[0].dias_disponibles = 0;
    const r = await eliminar(501);
    expect(r).toMatchObject({ ok: true, diasRestaurados: 0, diasNoRestaurados: 2 });
    expect(r.ok && r.advertencias.join(" ")).toContain("vencido");
    expect(db.saldos[0].dias_disponibles).toBe(0);
  });

  it("tope: si el saldo restaurado superaría lo otorgado se limita y se REPORTA (nunca en silencio)", async () => {
    db.saldos[0].dias_disponibles = 14; // corrupción previa: 14 + 2 > 15
    const r = await eliminar(501);
    expect(r).toMatchObject({ ok: true, diasRestaurados: 1, diasNoRestaurados: 1 });
    expect(db.saldos[0].dias_disponibles).toBe(15);
    expect(r.ok && r.advertencias.join(" ")).toContain("se limitó a 15.00");
  });

  it("tope de 30 días: si la sincronización vuelve a recortar tras devolver, el efecto se informa y queda en auditoría", async () => {
    vi.mocked(sincronizarPeriodosVacacionesEnConexion).mockImplementation((async () => {
      db.saldos[0].dias_disponibles = 12; // la política recorta 1 día del período más viejo
    }) as never);
    const r = await eliminar(501);
    expect(r).toMatchObject({ ok: true, diasRestaurados: 2, diasAjustadosPorTope: 1 });
    expect(r.ok && r.advertencias.join(" ")).toContain("tope de 30 días");
    expect(db.auditoria[0].detalle).toContain("tope 30 días recortó 1.00");
    expect(sincronizarPeriodosVacacionesEnConexion).toHaveBeenCalledTimes(1);
  });

  it("no devuelve días a un período de OTRO colaborador (409) aunque el detalle lo apunte", async () => {
    db.saldos[0].id_empleado = 8;
    expect(await eliminar(501)).toMatchObject({ ok: false, status: 409 });
    expect(db.incidencias).toHaveLength(2);
  });

  it("auditoría dentro de la transacción con incidencia, empleado, tipo, fechas, días, desglose y usuario", async () => {
    await eliminar(501);
    expect(registrarAuditoriaTx).toHaveBeenCalledTimes(1);
    const a = db.auditoria[0];
    expect(a).toMatchObject({ accion: "vacaciones_eliminar", usuario: "rrhh.ana" });
    expect(a.detalle).toContain("Incidencia #501");
    expect(a.detalle).toContain("Danis Mardoqueo Chub Choc");
    expect(a.detalle).toContain("Vacaciones 02/01/2026 → 03/01/2026");
    expect(a.detalle).toContain("2.00 días eliminados");
    expect(a.detalle).toContain("2.00 días restaurados al saldo (período 1: +2.00)");
    expect(a.detalle).toContain("eliminado por rrhh.ana");
    expect(eventos.indexOf("commit")).toBeGreaterThan(-1);
  });

  it("orden transaccional: BEGIN → … → COMMIT, conexión liberada; el DELETE de la incidencia va después de devolver el saldo", async () => {
    await eliminar(501);
    expect(eventos[0]).toBe("begin");
    expect(eventos.at(-2)).toBe("commit");
    expect(eventos.at(-1)).toBe("release");
    expect(eventos.indexOf("update-saldo")).toBeLessThan(eventos.indexOf("delete-incidencia"));
  });
});

describe("Eliminar registro — guardas de código (sin BD)", () => {
  const fuente = readFileSync("src/lib/rrhh/vacaciones-eliminar.ts", "utf8");
  it("bloquea incidencia, evidencias, detalles y saldos con FOR UPDATE y acota por empresa", () => {
    expect(fuente).toContain("FROM incidencias WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE");
    expect(fuente).toContain("evidencias_incidencias WHERE incidencia_id = ? AND empresa_id = ? FOR UPDATE");
    expect(fuente).toContain("detalle_consumo_vacaciones WHERE incidencia_id = ? ORDER BY id FOR UPDATE");
    expect(fuente).toContain("AND id IN (");
    expect(fuente).toContain("ORDER BY id FOR UPDATE");
  });
  it("nunca restaura con saldo += dias_habiles: usa dias_tomados del detalle", () => {
    expect(fuente).toContain("dias_tomados");
    expect(fuente).not.toMatch(/dias_disponibles\s*\+\s*inc\.dias_habiles|antes\s*\+\s*dias\b/);
  });
  it("sin DDL ni migraciones", () => {
    expect(fuente).not.toMatch(/\b(DROP|TRUNCATE|ALTER|CREATE)\s+TABLE\b/i);
  });
});
