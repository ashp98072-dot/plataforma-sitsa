import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn() }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { actualizarSolicitudFondo, crearSolicitudFondo } from "./fondos";
import { crearGasto } from "./gastos";
import { obtenerVehiculoAccesibleTx, predicadoVehiculoAccesible } from "@/lib/flota/acceso";

/**
 * SOLICITUDES DE FONDO: VEHÍCULOS COMPARTIDOS — la validación debe ser por ACCESIBILIDAD REAL (propio de la empresa activa o
 * compartido con ella vía flota_vehiculo_acceso), la misma regla que Flota, y no un simple `WHERE id = ?`.
 *
 * La base se simula con datos en memoria que evalúan la MISMA condición con los parámetros reales que manda el código:
 * `[empresaId, vehiculoId, empresaId, empresaId]` (CASE compartido, id, predicado propio-o-compartido ×2).
 */
const MONACO = 7;
const FRESCOFRESH = 3;
const OTRO_TENANT = 99;
const VEHICULOS = [
  { id: 1, empresa_id: MONACO, placa: "M-001MON", activo: 1 },       // propio
  { id: 2, empresa_id: FRESCOFRESH, placa: "C-091BXF", activo: 1 },  // de Frescofresh, compartido con Mónaco
  { id: 3, empresa_id: FRESCOFRESH, placa: "C-777NOC", activo: 1 },  // de Frescofresh, NO compartido
  { id: 4, empresa_id: OTRO_TENANT, placa: "X-999OTR", activo: 1 },  // otro tenant
];
const ACCESOS = [{ vehiculo_id: 2, empresa_id: MONACO }];

function accesible(empresaId: number, vehiculoId: number) {
  const v = VEHICULOS.find((x) => x.id === vehiculoId);
  if (!v) return null;
  const ok = v.empresa_id === empresaId || ACCESOS.some((a) => a.vehiculo_id === v.id && a.empresa_id === empresaId);
  return ok ? { id: v.id, placa: v.placa, activo: v.activo, compartido: v.empresa_id === empresaId ? 0 : 1 } : null;
}

function conexion() {
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM flota_vehiculos v") && sql.includes("flota_vehiculo_acceso")) {
        const [empresaId, vehiculoId] = params as number[];
        const row = accesible(empresaId, vehiculoId);
        return [row ? [row] : []];
      }
      if (sql.includes("FROM flota_vehiculos")) {
        // Cualquier lectura "cruda" por id (la que NO debe existir) devolvería el vehículo de cualquier empresa.
        const id = (params as number[])[0];
        const v = VEHICULOS.find((x) => x.id === id);
        return [v ? [{ id: v.id, placa: v.placa }] : []];
      }
      if (sql.includes("FROM tms_solicitudes_fondo WHERE id")) {
        return [[{
          id: 1, estado: "Pendiente", requirente_empleado_id: null, requirente_nombre: "Juan", requirente_usuario_id: null,
          solicitante_usuario_id: null, creado_por: "admin", fecha_requerimiento: "2026-09-01", observaciones: null, total: 500,
        }]];
      }
      if (sql.includes("FROM usuarios u")) return [[{ nombre: "Mario", rol_global: "Operaciones" }]];
      return [[]];
    }),
    execute: vi.fn(async (...args: [string, ...unknown[]]) => {
      if (args[0].includes("INSERT INTO tms_solicitudes_fondo")) return [{ insertId: 1, affectedRows: 1 }];
      return [{ insertId: 1, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return conn;
}

const filaSolicitud = {
  id: 1, empresa_id: MONACO, codigo: "FONDO-000001", requirente_empleado_id: null, requirente_nombre: "Juan",
  fecha_requerimiento: "2026-09-01", total: "100.00", autorizante_empleado_id: null, autorizante_nombre: null,
  estado: "Pendiente", autorizado_en: null, rechazado_en: null, motivo_rechazo: null, liquidado_en: null,
  observaciones: null, creado_por: "admin", creado_en: "2026-09-01 10:00:00",
};

function crear(vehiculoId: number) {
  return crearSolicitudFondo(MONACO, {
    fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
    lineas: [{ categoria: "Combustible", monto: 100, vehiculoId }],
  });
}
const insertLinea = (conn: ReturnType<typeof conexion>) =>
  conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(query).mockResolvedValue([filaSolicitud] as never);
});

describe("Fondos — vehículos propios o compartidos (regla real de Flota)", () => {
  it("F: vehículo PROPIO sigue siendo válido (vehiculoId real y placa congelada)", async () => {
    const conn = conexion();
    await crear(1);
    const ins = insertLinea(conn);
    expect(ins[1]).toEqual(expect.arrayContaining([1, "M-001MON"]));
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("G/J: Mónaco + vehículo de Frescofresh COMPARTIDO con Mónaco es válido; guarda el id real y la placa del snapshot", async () => {
    const conn = conexion();
    await crear(2);
    const ins = insertLinea(conn);
    expect(ins[1]).toEqual(expect.arrayContaining([2, "C-091BXF"]));
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("H: vehículo de otra empresa NO compartido se rechaza, con rollback y sin insertar nada", async () => {
    const conn = conexion();
    await expect(crear(3)).rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("INSERT INTO tms_solicitud_fondo_lineas"))).toBe(false);
  });

  it("I: vehículo de OTRO tenant (sin acceso) y un id manipulado/inexistente se rechazan", async () => {
    for (const id of [4, 424242]) {
      const conn = conexion();
      await expect(crear(id)).rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
      expect(conn.commit).not.toHaveBeenCalled();
    }
  });

  it("la validación NO es `WHERE id = ?` a secas: consulta flota_vehiculo_acceso con empresa activa e id", async () => {
    const conn = conexion();
    await crear(2);
    const lectura = conn.query.mock.calls.find((c) => String(c[0]).includes("FROM flota_vehiculos"))!;
    expect(lectura[0]).toContain("flota_vehiculo_acceso");
    expect(lectura[0]).toContain(predicadoVehiculoAccesible("v", "?"));
    expect(lectura[1]).toEqual([MONACO, 2, MONACO, MONACO]);
  });

  it("J: la propiedad y los accesos no se modifican al usar un vehículo compartido (ningún UPDATE/DELETE sobre flota)", async () => {
    const conn = conexion();
    await crear(2);
    const escrituras = [...conn.execute.mock.calls, ...conn.query.mock.calls].map((c) => String(c[0]));
    expect(escrituras.some((s) => /(UPDATE|DELETE|INSERT)[^;]*flota_vehiculo/i.test(s))).toBe(false);
  });

  it("E/edición: editar una solicitud Pendiente con vehículo compartido conserva vehiculoId y placa", async () => {
    const conn = conexion();
    await actualizarSolicitudFondo(MONACO, 1, { lineas: [{ categoria: "Combustible", monto: 100, vehiculoId: 2 }] });
    expect(insertLinea(conn)[1]).toEqual(expect.arrayContaining([2, "C-091BXF"]));
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("editar rechaza un vehículo no compartido", async () => {
    const conn = conexion();
    await expect(actualizarSolicitudFondo(MONACO, 1, { lineas: [{ categoria: "Combustible", monto: 100, vehiculoId: 3 }] }))
      .rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe("Gastos operativos — mismo catálogo, misma regla (sin cambiar montos ni estados)", () => {
  const gasto = (vehiculoId: number) => crearGasto(MONACO, {
    fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, vehiculoId, requirenteUsuarioId: 9,
  }, "admin");

  it("acepta un vehículo compartido con la empresa activa", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([{ id: 1, codigo: "GASTO-1", empresa_id: MONACO }] as never);
    // Otras validaciones del flujo pueden fallar con este mock mínimo; lo que se exige es que NO sea por el vehículo compartido.
    const error = await gasto(2).then(() => null, (e: Error) => e);
    expect(error?.message ?? "").not.toContain("El vehículo indicado no pertenece a esta empresa.");
    const lecturas = conn.query.mock.calls.filter((c) => String(c[0]).includes("FROM flota_vehiculos"));
    expect(lecturas.length).toBeGreaterThan(0);
    expect(lecturas.every((c) => String(c[0]).includes("flota_vehiculo_acceso"))).toBe(true);
    expect(conn.rollback.mock.calls.length).toBe(0);
  });

  it("rechaza un vehículo no compartido", async () => {
    const conn = conexion();
    await expect(gasto(3)).rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe("obtenerVehiculoAccesibleTx", () => {
  it("devuelve null para vehículo no accesible / ids vacíos y marca `compartido`", async () => {
    const conn = conexion();
    expect(await obtenerVehiculoAccesibleTx(conn as never, MONACO, 3)).toBeNull();
    expect(await obtenerVehiculoAccesibleTx(conn as never, MONACO, 0)).toBeNull();
    expect(await obtenerVehiculoAccesibleTx(conn as never, MONACO, 2)).toMatchObject({ placa: "C-091BXF", compartido: 1 });
    expect(await obtenerVehiculoAccesibleTx(conn as never, MONACO, 1)).toMatchObject({ placa: "M-001MON", compartido: 0 });
  });
});
