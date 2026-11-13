import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * URGENTE — POST /tms/planes devolvía "No se pudo generar un código de plan único. Intenta de nuevo." ante CUALQUIER
 * error SQL del INSERT de `tms_planes_viaje` (el `catch {}` regeneraba el código sin mirar el error). Se ejercita el
 * handler REAL; solo se sustituyen sus dependencias de I/O (mismo patrón que programacion-viajes-tercerizados.test.ts).
 * Los errores son los REALES de MariaDB reproducidos contra el esquema (ver planes-codigo-unico.db.test.ts).
 */
vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({
  listarDisponibilidadVehiculos: vi.fn(() => Promise.resolve({ vehiculos: [], resumen: {} })),
  placasDisponiblesParaPlan: vi.fn(() => []),
}));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(), generarCodigoPlan: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({
  guardarParadasPlan: vi.fn(() => Promise.resolve({ ok: true })),
  listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({ vehiculoPorPlaca: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(() => Promise.resolve([])),
  personalRecienAsignadoDelPlan: vi.fn(() => Promise.resolve([])),
  sincronizarViaticosPlan: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(() => Promise.resolve(1)), guardarAuxiliaresPlan: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(() => Promise.resolve(null)), validarPersonalId: vi.fn() }));
vi.mock("@/lib/tms/vehiculo-solicitado-db", async (importOriginal) => (await import("@/lib/tms/vehiculo-solicitado-db.fixture")).conVehiculoSolicitado(await importOriginal<object>()));

import { getPool, query } from "@/lib/db";
import { requireTenantProgramacion } from "@/lib/tenant";
import { asegurarCodigoPlanUnico } from "@/lib/tms/codigo-plan";
import { guardarAuxiliaresPlan } from "@/lib/tms/plan-comunes";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ vehiculoSolicitadoPerfilId: 1, ...(body as object) }) }), ctx);

const PLAN = {
  fechaPlan: "2026-11-13", horaCarga: "08:00", tipoViaje: "Tercerizado", pilotoExternoNombre: "Juan Externo",
  auxiliaresExternos: [], unidadExternaPlaca: "ext-999", unidadExternaDescripcion: "Rastra", transportistaExterno: "Transportes ABC", costoTercerizado: 1500,
};

const sqlError = (code: string, errno: number, sqlMessage: string, sqlState = "23000") =>
  Object.assign(new Error(sqlMessage), { code, errno, sqlState, sqlMessage });
const dupUqPlan = (codigo: string) => sqlError("ER_DUP_ENTRY", 1062, `Duplicate entry '7-${codigo}' for key 'uq_plan'`);
const guardaFusion = () => sqlError("ER_SIGNAL_EXCEPTION", 1644, "Seleccione la unidad principal: ID fusionado", "45000");

let conexion: ReturnType<typeof crearConexion>;
let comportamientoInsert: (codigo: string, intento: number) => unknown;

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : [[]])),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) {
        const intento = conexion.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje")).length;
        const r = comportamientoInsert(String(params[1]), intento);
        if (r instanceof Error) throw r;
        return [{ insertId: Number(r), affectedRows: 1 }];
      }
      return [{ insertId: 1, affectedRows: 1 }];
    }),
  };
}
const inserts = () => conexion.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje"));

beforeEach(() => {
  vi.resetAllMocks();
  conexion = crearConexion();
  comportamientoInsert = () => 55;
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(query).mockResolvedValue([] as never);
  vi.mocked(asegurarCodigoPlanUnico).mockResolvedValueOnce("PLAN-20261113-001").mockResolvedValueOnce("PLAN-20261113-002").mockResolvedValue("PLAN-20261113-003");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /tms/planes — error del INSERT que NO es colisión de código: se propaga, rollback total, mensaje verdadero", () => {
  it.each([
    ["guarda/trigger SQLSTATE 45000 (causa reproducida del bloqueo)", guardaFusion()],
    ["columna inexistente en producción (esquema desactualizado)", sqlError("ER_BAD_FIELD_ERROR", 1054, "Unknown column 'tc_externo_placa' in 'INSERT INTO'", "42S22")],
    ["FK de perfil inexistente", sqlError("ER_NO_REFERENCED_ROW_2", 1452, "Cannot add or update a child row: a foreign key constraint fails")],
    ["interbloqueo", sqlError("ER_LOCK_DEADLOCK", 1213, "Deadlock found when trying to get lock; try restarting transaction", "40001")],
    ["duplicado de PRIMARY (no es el código)", sqlError("ER_DUP_ENTRY", 1062, "Duplicate entry '31' for key 'PRIMARY'")],
    ["error sin código SQL", new Error("socket hang up")],
  ])("%s", async (_nombre, err) => {
    comportamientoInsert = () => err;
    const res = await post(PLAN);
    const cuerpo = await res.json();
    expect(res.status).toBe(500);
    expect(cuerpo.error).toBe("No se pudo crear el viaje. No se guardó ningún cambio.");
    expect(cuerpo.error).not.toContain("código de plan único"); // nunca disfrazado de error de numeración
    expect(inserts()).toHaveLength(1); // NO reintenta
    expect(asegurarCodigoPlanUnico).toHaveBeenCalledTimes(1); // solo el código inicial: no se regenera
    expect(conexion.rollback).toHaveBeenCalledTimes(1); // rollback transaccional conservado
    expect(conexion.commit).not.toHaveBeenCalled();
    expect(conexion.release).toHaveBeenCalledTimes(1);
    expect(vi.mocked(guardarAuxiliaresPlan)).not.toHaveBeenCalled(); // nada posterior al INSERT se ejecuta
    expect(sincronizarViaticosPlan).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("POST tms/planes (transacción de alta)", err); // el error REAL queda en la bitácora
  });
});

describe("POST /tms/planes — colisión REAL del UNIQUE (empresa_id, codigo)", () => {
  it("una colisión y luego éxito: reintenta con otro código, sin rollback, y responde con el código nuevo", async () => {
    comportamientoInsert = (codigo, intento) => (intento === 1 ? dupUqPlan(codigo) : 55);
    const res = await post(PLAN);
    const cuerpo = await res.json();
    expect(res.status).toBe(200);
    expect(cuerpo.codigo).toBe("PLAN-20261113-002");
    expect(inserts().map((c) => (c[1] as unknown[])[1])).toEqual(["PLAN-20261113-001", "PLAN-20261113-002"]);
    expect(conexion.rollback).not.toHaveBeenCalled();
    expect(conexion.commit).toHaveBeenCalledTimes(1);
  });

  it("5 colisiones seguidas: 409 'código de plan único' (el único caso legítimo) con rollback", async () => {
    comportamientoInsert = (codigo) => dupUqPlan(codigo);
    const res = await post(PLAN);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("No se pudo generar un código de plan único. Intenta de nuevo.");
    expect(inserts()).toHaveLength(5);
    expect(conexion.rollback).toHaveBeenCalledTimes(1);
    expect(conexion.commit).not.toHaveBeenCalled();
  });

  it("una colisión y luego un error de trigger: gana el error REAL (500), no el mensaje de código", async () => {
    comportamientoInsert = (codigo, intento) => (intento === 1 ? dupUqPlan(codigo) : guardaFusion());
    const res = await post(PLAN);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("No se pudo crear el viaje. No se guardó ningún cambio.");
    expect(inserts()).toHaveLength(2);
    expect(conexion.rollback).toHaveBeenCalledTimes(1);
    expect(conexion.commit).not.toHaveBeenCalled();
  });

  it("un duplicado que menciona otro índice (otro nombre) pero el valor es <empresa>-<código> del intento se reconoce como colisión de código", async () => {
    comportamientoInsert = (codigo, intento) => (intento === 1 ? sqlError("ER_DUP_ENTRY", 1062, `Duplicate entry '7-${codigo}' for key 'uk_legacy'`) : 55);
    const res = await post(PLAN);
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(2);
  });
});
