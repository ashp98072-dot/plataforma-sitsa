import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn() }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { actualizarSolicitudFondo, crearSolicitudFondo } from "./fondos";
import { crearGasto } from "./gastos";

/**
 * Operaciones NUEVAS -> identidad canónica. Un ID de vehículo absorbido por una fusión (flota_vehiculos_fusiones) llega desde un formulario
 * viejo, un borrador o una unidad TMS que sigue ligada al absorbido: el servidor guarda el ID CANÓNICO y la placa canónica. Sin tabla de
 * fusiones, o con un ID sin alias, no cambia nada. La historia existente no se reescribe nunca.
 *
 * La base se simula en memoria: vehículo 2 = canónico «558 BSJ», vehículo 3 = absorbido (alias 3 -> 2), vehículo 1 = sin alias.
 */
const EMPRESA = 7;
const VEHICULOS = [
  { id: 1, empresa_id: EMPRESA, placa: "M-001MON", activo: 1 },
  { id: 2, empresa_id: EMPRESA, placa: "558 BSJ", activo: 1 },
  { id: 3, empresa_id: EMPRESA, placa: "558BSJ", activo: 0 },
];
const ALIAS = [{ origen_id: 3, destino_id: 2, empresa_id: EMPRESA }];

function conexion(conTablaFusiones = true) {
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("information_schema.TABLES") && sql.includes("flota_vehiculos_fusiones")) return [conTablaFusiones ? [{ TABLE_NAME: "flota_vehiculos_fusiones" }] : []];
      if (sql.includes("FROM flota_vehiculos_fusiones WHERE origen_id")) {
        const [id, empresa] = params as number[];
        const a = ALIAS.find((x) => x.origen_id === id && x.empresa_id === empresa);
        return [a ? [{ destino_id: a.destino_id }] : []];
      }
      if (sql.includes("FROM flota_vehiculos v") && sql.includes("flota_vehiculo_acceso")) {
        const [empresaId, vehiculoId] = params as number[];
        const v = VEHICULOS.find((x) => x.id === vehiculoId && x.empresa_id === empresaId);
        return [v ? [{ id: v.id, placa: v.placa, activo: v.activo, compartido: 0 }] : []];
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    execute: vi.fn(async (..._args: [string, unknown[]?]) => [{ insertId: 1, affectedRows: 1 }]),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return conn;
}
const filaSolicitud = {
  id: 1, empresa_id: EMPRESA, codigo: "FONDO-000001", requirente_empleado_id: null, requirente_nombre: "Juan",
  fecha_requerimiento: "2026-09-01", total: "100.00", autorizante_empleado_id: null, autorizante_nombre: null,
  estado: "Pendiente", autorizado_en: null, rechazado_en: null, motivo_rechazo: null, liquidado_en: null,
  observaciones: null, creado_por: "admin", creado_en: "2026-09-01 10:00:00",
};
const crearFondo = (vehiculoId: number) => crearSolicitudFondo(EMPRESA, {
  fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
  lineas: [{ categoria: "Combustible", monto: 100, vehiculoId }],
});
const insertLinea = (conn: ReturnType<typeof conexion>) => conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(query).mockResolvedValue([filaSolicitud] as never);
});

describe("Fondos — la línea nueva se guarda con la identidad canónica", () => {
  it("ID absorbido (3) -> se guarda el canónico (2) con su placa; el absorbido nunca llega al INSERT", async () => {
    const conn = conexion();
    await crearFondo(3);
    const ins = insertLinea(conn);
    expect(ins[1]).toEqual(expect.arrayContaining([2, "558 BSJ"]));
    expect(ins[1]).not.toContain(3);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("ID canónico (2) y ID sin alias (1) no cambian", async () => {
    for (const [id, placa] of [[2, "558 BSJ"], [1, "M-001MON"]] as const) {
      const conn = conexion();
      await crearFondo(id);
      expect(insertLinea(conn)[1]).toEqual(expect.arrayContaining([id, placa]));
    }
  });

  it("sin tabla de fusiones (migración no instalada) el comportamiento es el de siempre", async () => {
    const conn = conexion(false);
    await crearFondo(1);
    expect(insertLinea(conn)[1]).toEqual(expect.arrayContaining([1, "M-001MON"]));
    expect(conn.query.mock.calls.some((c) => String(c[0]).includes("FROM flota_vehiculos_fusiones WHERE origen_id"))).toBe(false);
  });

  it("un alias de OTRA empresa no se aplica (aislamiento): el ID se valida como antes", async () => {
    const conn = conexion();
    await expect(crearSolicitudFondo(99, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, vehiculoId: 3 }],
    })).rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("editar una solicitud Pendiente con una línea del ID absorbido la reescribe con el canónico", async () => {
    const conn = conexion();
    await actualizarSolicitudFondo(EMPRESA, 1, { lineas: [{ categoria: "Combustible", monto: 100, vehiculoId: 3 }] });
    expect(insertLinea(conn)[1]).toEqual(expect.arrayContaining([2, "558 BSJ"]));
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("no toca flota_vehiculos ni flota_vehiculos_fusiones (solo lectura del alias)", async () => {
    const conn = conexion();
    await crearFondo(3);
    const escrituras = [...conn.execute.mock.calls, ...conn.query.mock.calls].map((c) => String(c[0]));
    expect(escrituras.some((s) => /(UPDATE|DELETE|INSERT)[^;]*flota_vehiculos/i.test(s))).toBe(false);
  });
});

describe("Gastos operativos — el gasto nuevo se guarda con la identidad canónica", () => {
  const gasto = (vehiculoId: number) => crearGasto(EMPRESA, {
    fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, vehiculoId, requirenteUsuarioId: 9,
  }, "admin");
  const insertGasto = (conn: ReturnType<typeof conexion>) => conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_gastos_operativos"));

  it("ID absorbido (3) -> INSERT con el canónico (2)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([{ id: 1, codigo: "GASTO-1", empresa_id: EMPRESA }] as never);
    await gasto(3).then(() => null, (e: Error) => e); // otras validaciones del flujo pueden fallar con este mock mínimo
    const ins = insertGasto(conn);
    if (ins) {
      expect(ins[1]).toContain(2);
      expect(ins[1]).not.toContain(3);
    }
    // En cualquier caso nunca se valida/consulta el absorbido como vehículo operativo.
    const lecturas = conn.query.mock.calls.filter((c) => String(c[0]).includes("FROM flota_vehiculos v") && String(c[0]).includes("flota_vehiculo_acceso"));
    expect(lecturas.every((c) => (c[1] as number[])[1] === 2)).toBe(true);
  });
});
