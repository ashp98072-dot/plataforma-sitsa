import { describe, expect, it, vi } from "vitest";
import {
  CodigoPlanAgotadoError,
  codigoErrorSql,
  esColisionIndiceCodigoPlan,
  incrementarCodigoPlan,
  insertarPlanConCodigoUnico,
  MAX_INTENTOS_CODIGO_PLAN,
  numeroDeCodigoPlan,
  resumenErrorSql,
} from "./codigo-plan-colision";

/**
 * URGENTE — el alta de viajes devolvía "No se pudo generar un código de plan único" ante CUALQUIER error SQL.
 * Los mensajes de abajo son los REALES de MariaDB (reproducidos contra el esquema de sql/schema.sql).
 */
const sqlError = (code: string, errno: number, sqlMessage: string, sqlState = "23000") =>
  Object.assign(new Error(sqlMessage), { code, errno, sqlState, sqlMessage });

const dupUqPlan = (codigo = "PLAN-20261113-005", empresa = 7) =>
  sqlError("ER_DUP_ENTRY", 1062, `Duplicate entry '${empresa}-${codigo}' for key 'uq_plan'`);
const guardaFusion = () => sqlError("ER_SIGNAL_EXCEPTION", 1644, "Seleccione la unidad principal: ID fusionado", "45000");

describe("esColisionIndiceCodigoPlan — SOLO el UNIQUE (empresa_id, codigo)", () => {
  it("colisión real de uq_plan (MariaDB, MySQL 8 con prefijo de tabla y mensaje localizado) -> true", () => {
    expect(esColisionIndiceCodigoPlan(dupUqPlan())).toBe(true);
    expect(esColisionIndiceCodigoPlan(sqlError("ER_DUP_ENTRY", 1062, "Duplicate entry '7-PLAN-1' for key 'tms_planes_viaje.uq_plan'"))).toBe(true);
    expect(esColisionIndiceCodigoPlan(sqlError("ER_DUP_ENTRY", 1062, "Entrada duplicada '7-PLAN-1' para la clave 'uq_plan'"))).toBe(true);
    expect(esColisionIndiceCodigoPlan({ errno: 1062, message: "Duplicate entry '7-PLAN-1' for key 'uq_plan'" })).toBe(true);
  });

  it("ER_DUP_ENTRY de OTRO índice (PRIMARY, uq_tmsplanes_empresa_id…) NO es colisión de código", () => {
    expect(esColisionIndiceCodigoPlan(sqlError("ER_DUP_ENTRY", 1062, "Duplicate entry '31' for key 'PRIMARY'"))).toBe(false);
    expect(esColisionIndiceCodigoPlan(sqlError("ER_DUP_ENTRY", 1062, "Duplicate entry '7-31' for key 'uq_tmsplanes_empresa_id'"))).toBe(false);
    expect(esColisionIndiceCodigoPlan(sqlError("ER_DUP_ENTRY", 1062, "Duplicate entry 'x' for key 'uq_plan_otro'"))).toBe(false); // nombre parecido, no igual
  });

  it("sin información del índice (mock desnudo) -> false: ante la duda se propaga el error, no se reintenta", () => {
    expect(esColisionIndiceCodigoPlan({ code: "ER_DUP_ENTRY" })).toBe(false);
    expect(esColisionIndiceCodigoPlan({ errno: 1062 })).toBe(false);
  });

  it("respaldo para otro nombre de índice: el valor duplicado es exactamente <empresa_id>-<codigo> del intento", () => {
    const otroNombre = sqlError("ER_DUP_ENTRY", 1062, "Duplicate entry '7-PLAN-20261113-005' for key 'uk_codigo_legacy'");
    expect(esColisionIndiceCodigoPlan(otroNombre)).toBe(false); // sin contexto no se asume
    expect(esColisionIndiceCodigoPlan(otroNombre, { empresaId: 7, codigo: "PLAN-20261113-005" })).toBe(true);
    expect(esColisionIndiceCodigoPlan(otroNombre, { empresaId: 8, codigo: "PLAN-20261113-005" })).toBe(false); // otra empresa
    expect(esColisionIndiceCodigoPlan(otroNombre, { empresaId: 7, codigo: "PLAN-20261113-006" })).toBe(false); // otro código
  });

  it.each([
    ["trigger / guarda (SIGNAL 45000) — la causa real del bloqueo reproducido", guardaFusion()],
    ["columna inexistente (esquema desactualizado)", sqlError("ER_BAD_FIELD_ERROR", 1054, "Unknown column 'tc_externo_placa' in 'INSERT INTO'", "42S22")],
    ["FK inexistente", sqlError("ER_NO_REFERENCED_ROW_2", 1452, "Cannot add or update a child row: a foreign key constraint fails")],
    ["dato demasiado largo", sqlError("ER_DATA_TOO_LONG", 1406, "Data too long for column 'codigo' at row 1", "22001")],
    ["valor no válido en modo estricto", sqlError("ER_TRUNCATED_WRONG_VALUE_FOR_FIELD", 1366, "Incorrect integer value", "HY000")],
    ["interbloqueo", sqlError("ER_LOCK_DEADLOCK", 1213, "Deadlock found when trying to get lock; try restarting transaction", "40001")],
    ["espera de bloqueo agotada", sqlError("ER_LOCK_WAIT_TIMEOUT", 1205, "Lock wait timeout exceeded; try restarting transaction", "HY000")],
    ["conexión perdida", Object.assign(new Error("Connection lost: The server closed the connection."), { code: "PROTOCOL_CONNECTION_LOST" })],
    ["Error genérico", new Error("timeout")],
  ])("%s -> false", (_nombre, err) => {
    expect(esColisionIndiceCodigoPlan(err)).toBe(false);
    expect(esColisionIndiceCodigoPlan(err, { empresaId: 7, codigo: "PLAN-20261113-005" })).toBe(false);
  });

  it("valores que no son errores -> false", () => {
    for (const v of [null, undefined, "ER_DUP_ENTRY", 1062, true, [], {}]) expect(esColisionIndiceCodigoPlan(v)).toBe(false);
  });
});

describe("codigoErrorSql / resumenErrorSql", () => {
  it("expone solo el código ER_* (apto para el usuario) y nunca el texto SQL", () => {
    expect(codigoErrorSql(guardaFusion())).toBe("ER_SIGNAL_EXCEPTION");
    expect(codigoErrorSql(new Error("boom"))).toBeNull();
    expect(codigoErrorSql(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBeNull();
    expect(codigoErrorSql(null)).toBeNull();
  });
  it("el resumen para la bitácora conserva code/errno/sqlState/sqlMessage", () => {
    expect(resumenErrorSql(guardaFusion())).toEqual({
      code: "ER_SIGNAL_EXCEPTION", errno: 1644, sqlState: "45000", sqlMessage: "Seleccione la unidad principal: ID fusionado",
    });
    expect(resumenErrorSql("texto")).toMatchObject({ code: null, errno: null, sqlMessage: "texto" });
  });
});

describe("numeración de códigos", () => {
  it("numeroDeCodigoPlan / incrementarCodigoPlan", () => {
    expect(numeroDeCodigoPlan("PLAN-20261113-007")).toBe(7);
    expect(numeroDeCodigoPlan("sin-numero-x")).toBeNull();
    expect(incrementarCodigoPlan("PLAN-20261113-007")).toBe("PLAN-20261113-008");
    expect(incrementarCodigoPlan("PLAN-20261113-099")).toBe("PLAN-20261113-100");
    expect(incrementarCodigoPlan("PLAN-20261113-1000")).toBe("PLAN-20261113-1001");
    expect(incrementarCodigoPlan("SIN-DIGITOS")).toBeNull();
  });
});

describe("insertarPlanConCodigoUnico — reintento SOLO ante colisión real", () => {
  const base = (over: Partial<Parameters<typeof insertarPlanConCodigoUnico>[0]> = {}) => ({
    empresaId: 7,
    codigoInicial: "PLAN-20261113-001",
    intentarInsertar: vi.fn(async () => 55),
    siguienteCodigo: vi.fn(async () => "PLAN-20261113-099"),
    ...over,
  });

  it("sin colisión: un solo INSERT con el código inicial", async () => {
    const o = base();
    await expect(insertarPlanConCodigoUnico(o)).resolves.toEqual({ planId: 55, codigo: "PLAN-20261113-001" });
    expect(o.intentarInsertar).toHaveBeenCalledTimes(1);
    expect(o.siguienteCodigo).not.toHaveBeenCalled();
  });

  it("colisión real de uq_plan: genera otro código y reintenta hasta lograrlo", async () => {
    const insertar = vi.fn<(c: string) => Promise<number>>()
      .mockRejectedValueOnce(dupUqPlan("PLAN-20261113-001"))
      .mockRejectedValueOnce(dupUqPlan("PLAN-20261113-002"))
      .mockResolvedValueOnce(77);
    const siguiente = vi.fn<(c: string) => Promise<string>>()
      .mockResolvedValueOnce("PLAN-20261113-002")
      .mockResolvedValueOnce("PLAN-20261113-003");
    const r = await insertarPlanConCodigoUnico(base({ intentarInsertar: insertar, siguienteCodigo: siguiente }));
    expect(r).toEqual({ planId: 77, codigo: "PLAN-20261113-003" });
    expect(insertar.mock.calls.map((c) => c[0])).toEqual(["PLAN-20261113-001", "PLAN-20261113-002", "PLAN-20261113-003"]);
    expect(siguiente.mock.calls.map((c) => c[0])).toEqual(["PLAN-20261113-001", "PLAN-20261113-002"]); // recibe el que colisionó
  });

  it.each([
    ["guarda/trigger SQLSTATE 45000", guardaFusion()],
    ["columna inexistente", sqlError("ER_BAD_FIELD_ERROR", 1054, "Unknown column 'x' in 'INSERT INTO'", "42S22")],
    ["FK", sqlError("ER_NO_REFERENCED_ROW_2", 1452, "Cannot add or update a child row")],
    ["duplicado de PRIMARY", sqlError("ER_DUP_ENTRY", 1062, "Duplicate entry '31' for key 'PRIMARY'")],
    ["interbloqueo", sqlError("ER_LOCK_DEADLOCK", 1213, "Deadlock found", "40001")],
  ])("%s: se relanza el MISMO error al primer intento, sin reintentar ni regenerar código", async (_n, err) => {
    const o = base({ intentarInsertar: vi.fn(async () => { throw err; }) });
    await expect(insertarPlanConCodigoUnico(o)).rejects.toBe(err); // misma instancia: nada se envuelve ni se enmascara
    expect(o.intentarInsertar).toHaveBeenCalledTimes(1);
    expect(o.siguienteCodigo).not.toHaveBeenCalled();
  });

  it("una colisión seguida de un error NO duplicado: se propaga el error real (no se convierte en 'código único')", async () => {
    const insertar = vi.fn<(c: string) => Promise<number>>().mockRejectedValueOnce(dupUqPlan()).mockRejectedValueOnce(guardaFusion());
    const o = base({ intentarInsertar: insertar });
    const r = await insertarPlanConCodigoUnico(o).catch((e) => e);
    expect(r).not.toBeInstanceOf(CodigoPlanAgotadoError);
    expect(r).toMatchObject({ code: "ER_SIGNAL_EXCEPTION", errno: 1644 });
    expect(insertar).toHaveBeenCalledTimes(2);
  });

  it("5 colisiones reales seguidas: CodigoPlanAgotadoError tras exactamente 5 INSERT (y 4 regeneraciones)", async () => {
    const o = base({
      intentarInsertar: vi.fn(async (c: string) => { throw dupUqPlan(c); }),
      siguienteCodigo: vi.fn(async (c: string) => incrementarCodigoPlan(c) as string),
    });
    const err = await insertarPlanConCodigoUnico(o).catch((e) => e);
    expect(err).toBeInstanceOf(CodigoPlanAgotadoError);
    expect(err).toMatchObject({ intentos: MAX_INTENTOS_CODIGO_PLAN });
    expect(o.intentarInsertar).toHaveBeenCalledTimes(5);
    expect(o.siguienteCodigo).toHaveBeenCalledTimes(4);
  });

  it("progreso garantizado: si el generador devuelve el MISMO código (snapshot REPEATABLE READ que no ve la fila ajena), se incrementa", async () => {
    const insertar = vi.fn<(c: string) => Promise<number>>()
      .mockRejectedValueOnce(dupUqPlan("PLAN-20261113-001"))
      .mockResolvedValueOnce(9);
    const r = await insertarPlanConCodigoUnico(base({ intentarInsertar: insertar, siguienteCodigo: vi.fn(async () => "PLAN-20261113-001") }));
    expect(r).toEqual({ planId: 9, codigo: "PLAN-20261113-002" });
  });

  it("progreso garantizado también si el generador propone un número MENOR", async () => {
    const insertar = vi.fn<(c: string) => Promise<number>>()
      .mockRejectedValueOnce(dupUqPlan("PLAN-20261113-010"))
      .mockResolvedValueOnce(9);
    const r = await insertarPlanConCodigoUnico(base({ codigoInicial: "PLAN-20261113-010", intentarInsertar: insertar, siguienteCodigo: vi.fn(async () => "PLAN-20261113-004") }));
    expect(r.codigo).toBe("PLAN-20261113-011");
  });

  it("un fallo del generador de códigos también se propaga (no se traga)", async () => {
    const boom = new Error("pool agotado");
    const o = base({
      intentarInsertar: vi.fn(async () => { throw dupUqPlan(); }),
      siguienteCodigo: vi.fn(async () => { throw boom; }),
    });
    await expect(insertarPlanConCodigoUnico(o)).rejects.toBe(boom);
  });
});
