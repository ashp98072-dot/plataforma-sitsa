import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/auth", () => ({ verificarPasswordUsuarioActual: vi.fn() }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn(), TEXTO_FIRMA_INTERNA: "Firma electrónica interna" }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));

import { personalRecienAsignadoDelPlan, sincronizarViaticosPlan } from "./viaticos";

/**
 * PILOTO EXTRA — VIÁTICOS. Cada piloto (principal y extra) recibe su propia fila de tms_viaticos con rol "Piloto"; el UNIQUE
 * (plan_id, personal_id) evita duplicados; monto sugerido por puesto y override INDIVIDUAL; ciclo de estados sin tocar los procesados.
 */
type Existente = { personal_id: number; estado: string; monto_asignado: string };
let extraEnBd: number | null;
let existentes: Existente[];
let conn: { query: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };
const insertsViatico = () => conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_viaticos")).map((c) => c[1] as unknown[]);
const deleteViatico = () => conn.execute.mock.calls.find((c) => String(c[0]).includes("DELETE FROM tms_viaticos")) as [string, unknown[]] | undefined;

beforeEach(() => {
  extraEnBd = null;
  existentes = [];
  conn = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      if (s.includes("FROM tms_plan_pilotos_adicionales")) return [extraEnBd == null ? [] : [{ personal_id: extraEnBd }]];
      if (s.includes("SELECT personal_id, estado, monto_asignado FROM tms_viaticos")) return [existentes];
      if (s.includes("COALESCE(e.categoria_ops, tp.tipo) AS puesto")) return [[{ puesto: [9, 12].includes(Number(params[0])) ? "Piloto" : "Auxiliar" }]];
      if (s.includes("FROM tms_viaticos_config")) return [[{ monto_defecto: params[1] === "Piloto" ? "500" : "300" }]];
      return [[]];
    }),
    execute: vi.fn(async () => [{ affectedRows: 1 }]),
  };
});

describe("sincronizarViaticosPlan con piloto extra", () => {
  it("12/13) dos pilotos generan DOS viáticos independientes, ambos rol 'Piloto' (más los auxiliares como 'Auxiliar')", async () => {
    await sincronizarViaticosPlan(7, 40, { piloto: 9, pilotoExtra: 12, auxiliares: [20] }, conn as never);
    expect(insertsViatico()).toEqual([
      [7, 40, 9, "Piloto", 500, 500],
      [7, 40, 12, "Piloto", 500, 500],
      [7, 40, 20, "Auxiliar", 300, 300],
    ]);
  });

  it("14) override de monto por CADA piloto (no comparten monto)", async () => {
    await sincronizarViaticosPlan(7, 40, { piloto: 9, pilotoExtra: 12, auxiliares: [] }, conn as never, [
      { personalId: 9, montoAsignado: 650 }, { personalId: 12, montoAsignado: 420 },
    ]);
    expect(insertsViatico()).toEqual([[7, 40, 9, "Piloto", 500, 650], [7, 40, 12, "Piloto", 500, 420]]);
  });

  it("el DELETE de sobrantes solo toca PROGRAMADO y NO borra al extra (está en el objetivo)", async () => {
    await sincronizarViaticosPlan(7, 40, { piloto: 9, pilotoExtra: 12, auxiliares: [] }, conn as never);
    const [sql, params] = deleteViatico()!;
    expect(sql).toContain("estado = 'PROGRAMADO'");
    expect(params).toEqual([40, 9, 12]);
  });

  it("15) quitar el extra (pilotoExtra: null): su viático PROGRAMADO sale del objetivo y se elimina; los procesados nunca se tocan (DELETE solo PROGRAMADO)", async () => {
    await sincronizarViaticosPlan(7, 40, { piloto: 9, pilotoExtra: null, auxiliares: [] }, conn as never);
    const [sql, params] = deleteViatico()!;
    expect(sql).toContain("personal_id NOT IN (?) AND estado = 'PROGRAMADO'");
    expect(params).toEqual([40, 9]);
  });

  it("un viático del extra ya AUTORIZADO/ENTREGADO/LIQUIDADO se conserva intacto (sin INSERT/UPDATE) aunque venga override", async () => {
    for (const estado of ["AUTORIZADO", "ENTREGADO", "LIQUIDADO"]) {
      conn.execute.mockClear();
      existentes = [{ personal_id: 12, estado, monto_asignado: "500" }];
      await sincronizarViaticosPlan(7, 40, { piloto: 9, pilotoExtra: 12, auxiliares: [] }, conn as never, [{ personalId: 12, montoAsignado: 1 }]);
      expect(insertsViatico().map((i) => i[2])).toEqual([9]); // solo el principal; el extra procesado no se reescribe
    }
  });

  it("RECHAZADO es terminal por (plan_id, personal_id): no se vuelve a crear para el extra", async () => {
    existentes = [{ personal_id: 12, estado: "RECHAZADO", monto_asignado: "500" }];
    await sincronizarViaticosPlan(7, 40, { piloto: 9, pilotoExtra: 12, auxiliares: [] }, conn as never);
    expect(insertsViatico().map((i) => i[2])).toEqual([9]);
  });

  it("una fila PROGRAMADO existente del extra conserva su monto ajustado (no se resetea a sugerido en un resave)", async () => {
    existentes = [{ personal_id: 12, estado: "PROGRAMADO", monto_asignado: "777" }];
    await sincronizarViaticosPlan(7, 40, { piloto: 9, pilotoExtra: 12, auxiliares: [] }, conn as never);
    expect(insertsViatico()).toContainEqual([7, 40, 12, "Piloto", 500, 777]);
  });

  it("17/edición ajena: si el llamador NO menciona pilotoExtra se conserva el que el plan YA tiene en BD (un sync ajeno nunca borra su viático)", async () => {
    extraEnBd = 12;
    await sincronizarViaticosPlan(7, 40, { piloto: 9, auxiliares: [20] }, conn as never);
    expect(deleteViatico()![1]).toEqual([40, 9, 12, 20]); // el extra sigue en el objetivo: su viático PROGRAMADO no se elimina
    expect(insertsViatico().map((i) => i[2])).toEqual([9, 12, 20]);
    // con `undefined` se lee de la misma conexión/transacción
    expect(conn.query.mock.calls.some((c) => String(c[0]).includes("FROM tms_plan_pilotos_adicionales"))).toBe(true);
  });

  it("si el llamador lo indica explícitamente (null) no se consulta la BD por el extra", async () => {
    await sincronizarViaticosPlan(7, 40, { piloto: 9, pilotoExtra: null, auxiliares: [] }, conn as never);
    expect(conn.query.mock.calls.some((c) => String(c[0]).includes("FROM tms_plan_pilotos_adicionales"))).toBe(false);
  });

  it("nunca duplica: el extra igual al principal se ignora (UNIQUE plan+personal)", async () => {
    await sincronizarViaticosPlan(7, 40, { piloto: 9, pilotoExtra: 9, auxiliares: [] }, conn as never);
    expect(insertsViatico()).toHaveLength(1);
  });
});

describe("aviso de viático RECHAZADO también considera al piloto extra nuevo", () => {
  it("personalRecienAsignadoDelPlan incluye al extra que REALMENTE cambia", () => {
    expect(personalRecienAsignadoDelPlan({ pilotoCambioReal: false, pilotoFinal: 9, pilotoExtraCambioReal: true, pilotoExtraFinal: 12, auxiliaresCambioReal: false, auxiliaresFinal: [], antesAuxiliaresIds: [] })).toEqual([12]);
    expect(personalRecienAsignadoDelPlan({ pilotoCambioReal: false, pilotoFinal: 9, pilotoExtraCambioReal: false, pilotoExtraFinal: 12, auxiliaresCambioReal: false, auxiliaresFinal: [], antesAuxiliaresIds: [] })).toEqual([]);
  });
});
