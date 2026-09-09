import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { actualizarSolicitudFondo, cambiarEstadoSolicitudFondo, crearSolicitudFondo, listarSolicitudesFondo } from "./fondos";

function filaSolicitud(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, empresa_id: 7, codigo: "FONDO-000001", requirente_empleado_id: 3, requirente_nombre: "Juan Perez",
    fecha_requerimiento: "2026-09-01", total: "500.00", autorizante_empleado_id: null, autorizante_nombre: null,
    estado: "Pendiente", autorizado_en: null, rechazado_en: null, motivo_rechazo: null, liquidado_en: null,
    observaciones: null, creado_por: "admin", creado_en: "2026-09-01 10:00:00",
    ...overrides,
  };
}

function conexion(opts: {
  fallaEn?: string; estadoActual?: string; empleadoEnEmpresa?: boolean;
  // SOLICITUD-FONDOS-REPORTE-1 — snapshot de línea: catálogos que
  // resolverSnapshotLineaTx relee dentro de la transacción.
  vehiculoEnEmpresa?: boolean; clienteEnEmpresa?: boolean; planEnEmpresa?: boolean;
  empleadoNombre?: string; empleadoPuesto?: string | null; empleadoCuenta?: string | null; vehiculoPlaca?: string; clienteNombre?: string; planFecha?: string;
  // SOLICITUD-FONDOS-REPORTE-1 (pendiente 1 del PR #211) — fila RAW que
  // actualizarSolicitudFondo relee FOR UPDATE antes de editar.
  actualRequirenteEmpleadoId?: number | null;
  actualRequirenteNombre?: string | null;
  actualFechaRequerimiento?: string;
  actualObservaciones?: string | null;
  actualTotal?: number;
} = {}) {
  const empleadoEnEmpresa = opts.empleadoEnEmpresa ?? true;
  const vehiculoEnEmpresa = opts.vehiculoEnEmpresa ?? true;
  const clienteEnEmpresa = opts.clienteEnEmpresa ?? true;
  const planEnEmpresa = opts.planEnEmpresa ?? true;
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM tms_solicitudes_fondo WHERE id")) {
        return [[{
          id: 1, estado: opts.estadoActual ?? "Pendiente",
          requirente_empleado_id: opts.actualRequirenteEmpleadoId ?? null,
          requirente_nombre: opts.actualRequirenteNombre ?? "Juan Perez",
          fecha_requerimiento: opts.actualFechaRequerimiento ?? "2026-09-01",
          observaciones: opts.actualObservaciones ?? null,
          total: opts.actualTotal ?? 500,
        }]];
      }
      // SOLICITUD-FONDOS-REPORTE-1: resolverSnapshotLineaTx — cada catálogo
      // relecto por (id, empresa_id) dentro de la MISMA transacción.
      if (sql.includes("nombre, puesto, cuenta_bancaria FROM empleados")) {
        return [empleadoEnEmpresa
          ? [{ nombre: opts.empleadoNombre ?? "Juan Pérez", puesto: opts.empleadoPuesto ?? "Piloto", cuenta_bancaria: opts.empleadoCuenta ?? "1234567890" }]
          : []];
      }
      // AISLAMIENTO MULTIEMPRESA: SELECT id FROM empleados WHERE id = ? AND empresa_id = ? (requirente/autorizante)
      if (sql.includes("FROM empleados")) {
        return [empleadoEnEmpresa ? [{ id: 1 }] : []];
      }
      if (sql.includes("FROM flota_vehiculos")) {
        return [vehiculoEnEmpresa ? [{ placa: opts.vehiculoPlaca ?? "P123ABC" }] : []];
      }
      if (sql.includes("FROM tms_clientes")) {
        return [clienteEnEmpresa ? [{ nombre: opts.clienteNombre ?? "Acme" }] : []];
      }
      if (sql.includes("FROM tms_planes_viaje")) {
        return [planEnEmpresa ? [{ fecha_plan: opts.planFecha ?? "2026-09-05" }] : []];
      }
      return [[]];
    }),
    execute: vi.fn(async (...args: [string, ...unknown[]]) => {
      const sql = args[0];
      if (opts.fallaEn && sql.includes(opts.fallaEn)) throw new Error(`fallo:${opts.fallaEn}`);
      if (sql.includes("INSERT INTO tms_solicitudes_fondo")) return [{ insertId: 1, affectedRows: 1 }];
      return [{ insertId: 0, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return conn;
}

beforeEach(() => vi.resetAllMocks());

describe("aislamiento multiempresa en el SELECT de listado (bloqueo 1, revisión PR #204)", () => {
  it("los JOIN a empleados (requirente/autorizante) exigen empresa_id igual, no solo el id", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarSolicitudesFondo(7);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("req.id = s.requirente_empleado_id AND req.empresa_id = s.empresa_id");
    expect(sql).toContain("aut.id = s.autorizante_empleado_id AND aut.empresa_id = s.empresa_id");
  });
});

describe("crearSolicitudFondo", () => {
  it("rechaza sin líneas", async () => {
    conexion();
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", lineas: [],
    })).rejects.toThrow("al menos una línea");
  });

  it("rechaza sin requirente", async () => {
    conexion();
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", lineas: [{ categoria: "Combustible", monto: 100 }],
    })).rejects.toThrow("Requirente");
  });

  it("rechaza línea con monto <= 0", async () => {
    conexion();
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan",
      lineas: [{ categoria: "Combustible", monto: 0 }],
    })).rejects.toThrow("mayor a cero");
  });

  it("calcula el total como suma de cantidad*monto y genera código FONDO-######", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan",
      lineas: [
        { categoria: "Combustible", monto: 100, cantidad: 2 },
        { categoria: "Hospedaje", monto: 150 },
      ],
    }, "admin");
    const insertCalls = conn.execute.mock.calls.map((c) => c[0] as string);
    expect(insertCalls.some((sql) => sql.includes("INSERT INTO tms_solicitudes_fondo"))).toBe(true);
    expect(insertCalls.filter((sql) => sql.includes("INSERT INTO tms_solicitud_fondo_lineas"))).toHaveLength(2);
    const updateCodigoCall = conn.execute.mock.calls.find((c) => (c[0] as string).includes("SET codigo"));
    expect(updateCodigoCall?.[1]).toEqual(["FONDO-000001", 1, 7]);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("hace rollback si falla la inserción de una línea", async () => {
    const conn = conexion({ fallaEn: "INSERT INTO tms_solicitud_fondo_lineas" });
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan",
      lineas: [{ categoria: "Combustible", monto: 100 }],
    })).rejects.toThrow();
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("AISLAMIENTO MULTIEMPRESA: rechaza un requirenteEmpleadoId que no pertenece a esta empresa, sin insertar nada (bloqueo 1, revisión PR #204)", async () => {
    const conn = conexion({ empleadoEnEmpresa: false });
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteEmpleadoId: 999,
      lineas: [{ categoria: "Combustible", monto: 100 }],
    })).rejects.toThrow("El requirente indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT"))).toBe(false);
  });

  it("con requirenteEmpleadoId de la MISMA empresa, sí crea (no bloquea referencias legítimas)", async () => {
    const conn = conexion({ empleadoEnEmpresa: true });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteEmpleadoId: 3,
      lineas: [{ categoria: "Combustible", monto: 100 }],
    });
    expect(conn.commit).toHaveBeenCalledOnce();
  });
});

/**
 * SOLICITUD-FONDOS-REPORTE-1 — snapshot histórico por línea: cada línea
 * puede relacionarse con empleado/vehículo/cliente/viaje; el servidor
 * resuelve y CONGELA el nombre/cargo/placa/cliente real al momento de
 * crear (nunca confía en texto enviado por el cliente HTTP), y valida
 * aislamiento multiempresa en cada catálogo por separado.
 */
describe("crearSolicitudFondo — snapshot histórico por línea (empleado/vehículo/cliente/viaje)", () => {
  it("varias líneas, cada una con sus propios datos de empleado/vehículo/cliente/viaje", async () => {
    const conn = conexion({
      empleadoNombre: "Heber Sitan", empleadoPuesto: "Piloto", vehiculoPlaca: "P111AAA", clienteNombre: "Cliente A",
    });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan",
      lineas: [
        { categoria: "Combustible", monto: 100, cantidad: 2, empleadoId: 4, vehiculoId: 9, clienteId: 5, fechaViaje: "2026-09-02" },
        { categoria: "Hospedaje", monto: 150 }, // línea sin relaciones — sigue siendo válida
      ],
    }, "admin");
    const insertsLinea = conn.execute.mock.calls.filter((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"));
    expect(insertsLinea).toHaveLength(2);
    // empresa_id, solicitud_id, categoria, descripcion, cantidad, monto, orden,
    // fecha_viaje, empleado_id, empleado_nombre, cargo, cuenta, vehiculo_id, placa, cliente_id, cliente_nombre, plan_id
    expect(insertsLinea[0][1]).toEqual([
      7, 1, "Combustible", null, 2, 100, 0,
      "2026-09-02", 4, "Heber Sitan", "Piloto", "1234567890", 9, "P111AAA", 5, "Cliente A", null,
    ]);
    expect(insertsLinea[1][1]).toEqual([
      7, 1, "Hospedaje", null, 1, 150, 1,
      null, null, null, null, null, null, null, null, null, null,
    ]);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("el snapshot SIEMPRE se resuelve del lado del servidor — nunca confía en nombre/placa/cliente enviados por el cliente HTTP (el tipo LineaFondoInput ni siquiera los acepta)", async () => {
    const conn = conexion({ empleadoNombre: "Nombre Real En BD", empleadoPuesto: "Auxiliar" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan",
      lineas: [{ categoria: "Combustible", monto: 100, empleadoId: 4 }],
    });
    const insertLinea = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insertLinea[1]).toContain("Nombre Real En BD"); // releído de BD, no un valor inventado por el caller
  });

  it("fechaViaje explícita del caller SIEMPRE gana sobre la fecha del plan", async () => {
    const conn = conexion({ planFecha: "2026-09-10" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan",
      lineas: [{ categoria: "Combustible", monto: 100, planId: 8, fechaViaje: "2026-09-03" }],
    });
    const insertLinea = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insertLinea[1]).toContain("2026-09-03"); // la fecha escrita a mano, NO la del plan (2026-09-10)
  });

  it("sin fechaViaje explícita, se completa con la fecha real del plan indicado (planId)", async () => {
    const conn = conexion({ planFecha: "2026-09-10" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan",
      lineas: [{ categoria: "Combustible", monto: 100, planId: 8 }],
    });
    const insertLinea = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insertLinea[1]).toContain("2026-09-10");
  });

  it.each([
    ["empleadoId", { empleadoId: 999 }, "empleadoEnEmpresa" as const, "El empleado indicado no pertenece a esta empresa."],
    ["vehiculoId", { vehiculoId: 999 }, "vehiculoEnEmpresa" as const, "El vehículo indicado no pertenece a esta empresa."],
    ["clienteId", { clienteId: 999 }, "clienteEnEmpresa" as const, "El cliente indicado no pertenece a esta empresa."],
    ["planId", { planId: 999 }, "planEnEmpresa" as const, "El viaje indicado no pertenece a esta empresa."],
  ])("AISLAMIENTO MULTIEMPRESA: rechaza una línea con %s de otra empresa, sin insertar nada", async (_campo, extra, flag, mensaje) => {
    const conn = conexion({ [flag]: false });
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan",
      lineas: [{ categoria: "Combustible", monto: 100, ...extra }],
    })).rejects.toThrow(mensaje);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))).toBe(false);
  });
});

describe("cambiarEstadoSolicitudFondo", () => {
  it("permite Pendiente -> Autorizada", async () => {
    const conn = conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
    await cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizanteNombre: "Jefe" });
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("rechaza autorizar -> pendiente (transición hacia atrás) sin escribir nada", async () => {
    const conn = conexion({ estadoActual: "Rechazada" });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar")).rejects.toThrow('No se puede pasar de "Rechazada" a "Autorizada"');
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("rechazar exige motivo", async () => {
    conexion({ estadoActual: "Pendiente" });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "rechazar")).rejects.toThrow("motivo");
  });

  it("Liquidada no admite ninguna transición más", async () => {
    conexion({ estadoActual: "Liquidada" });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar")).rejects.toThrow();
  });

  it("devuelve null si la solicitud no existe", async () => {
    const conn = conexion();
    conn.query.mockResolvedValue([[]]);
    expect(await cambiarEstadoSolicitudFondo(7, 999, "autorizar")).toBeNull();
  });

  it("AISLAMIENTO MULTIEMPRESA: rechaza autorizar con un autorizanteEmpleadoId que no pertenece a esta empresa", async () => {
    const conn = conexion({ estadoActual: "Pendiente", empleadoEnEmpresa: false });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizanteEmpleadoId: 999 }))
      .rejects.toThrow("El autorizante indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

/**
 * SOLICITUD-FONDOS-REPORTE-1 (pendiente 1 del PR #211) — edición de una
 * solicitud existente MIENTRAS está Pendiente: encabezado + reemplazo de
 * líneas en UNA transacción, total recalculado, snapshot regenerado por
 * resolverSnapshotLineaTx (mismo criterio de seguridad que al crear).
 */
describe("actualizarSolicitudFondo", () => {
  it("edita Pendiente: encabezado y líneas se reemplazan, el total se recalcula", async () => {
    const conn = conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ total: "600.00" })] as never);
    await actualizarSolicitudFondo(7, 1, {
      fechaRequerimiento: "2026-09-05",
      requirenteNombre: "Maria Lopez",
      observaciones: "Actualizada",
      lineas: [
        { categoria: "Combustible", monto: 200, cantidad: 2 }, // 400
        { categoria: "Hospedaje", monto: 200 }, // 200
      ],
    }, "admin");
    const updateHeader = conn.execute.mock.calls.find((c) => (c[0] as string).includes("UPDATE tms_solicitudes_fondo"))!;
    expect(updateHeader[1]).toEqual([null, "Maria Lopez", "2026-09-05", 600, "Actualizada", 1, 7]);
    const deleteLineas = conn.execute.mock.calls.find((c) => (c[0] as string).includes("DELETE FROM tms_solicitud_fondo_lineas"));
    expect(deleteLineas?.[1]).toEqual([7, 1]);
    const insertsLinea = conn.execute.mock.calls.filter((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"));
    expect(insertsLinea).toHaveLength(2);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("campos no enviados conservan su valor RAW actual (nunca el nombre derivado del JOIN de SELECT_SOLICITUD)", async () => {
    const conn = conexion({ estadoActual: "Pendiente", actualRequirenteEmpleadoId: 9, actualRequirenteNombre: "Nombre Original", actualFechaRequerimiento: "2026-08-20", actualObservaciones: "Nota original" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    // Solo se envían las líneas — ningún campo de encabezado.
    await actualizarSolicitudFondo(7, 1, { lineas: [{ categoria: "Combustible", monto: 100 }] });
    const updateHeader = conn.execute.mock.calls.find((c) => (c[0] as string).includes("UPDATE tms_solicitudes_fondo"))!;
    expect(updateHeader[1]).toEqual([9, "Nombre Original", "2026-08-20", 100, "Nota original", 1, 7]);
  });

  it("sin lineas en el input: NO se tocan las líneas existentes ni el total", async () => {
    const conn = conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ total: "500.00" })] as never);
    await actualizarSolicitudFondo(7, 1, { observaciones: "Solo cambio observaciones" });
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("DELETE FROM tms_solicitud_fondo_lineas"))).toBe(false);
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))).toBe(false);
    const updateHeader = conn.execute.mock.calls.find((c) => (c[0] as string).includes("UPDATE tms_solicitudes_fondo"))!;
    expect((updateHeader[1] as unknown[])?.[3]).toBe(500); // total sin cambios (releído de la fila actual)
  });

  it.each(["Autorizada", "Rechazada", "Liquidada"] as const)(
    "NO permite editar una solicitud en estado %s",
    async (estado) => {
      const conn = conexion({ estadoActual: estado });
      await expect(actualizarSolicitudFondo(7, 1, { observaciones: "Intento de edición" }))
        .rejects.toThrow(`No se puede editar una solicitud en estado "${estado}"`);
      expect(conn.rollback).toHaveBeenCalledOnce();
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("UPDATE") || (c[0] as string).includes("DELETE") || (c[0] as string).includes("INSERT"))).toBe(false);
    },
  );

  it("hace ROLLBACK de TODO (encabezado incluido) si falla la inserción de una línea", async () => {
    const conn = conexion({ estadoActual: "Pendiente", fallaEn: "INSERT INTO tms_solicitud_fondo_lineas" });
    await expect(actualizarSolicitudFondo(7, 1, {
      observaciones: "No debe persistir",
      lineas: [{ categoria: "Combustible", monto: 100 }],
    })).rejects.toThrow();
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("devuelve null si la solicitud no existe", async () => {
    const conn = conexion({ estadoActual: "Pendiente" });
    conn.query.mockImplementation(async () => [[]]);
    expect(await actualizarSolicitudFondo(7, 999, { observaciones: "x" })).toBeNull();
  });

  it("rechaza sin líneas cuando `lineas` viene vacío", async () => {
    conexion({ estadoActual: "Pendiente" });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [] })).rejects.toThrow("al menos una línea");
  });

  it("AISLAMIENTO MULTIEMPRESA: rechaza reasignar a un requirenteEmpleadoId de otra empresa, sin escribir nada", async () => {
    const conn = conexion({ estadoActual: "Pendiente", empleadoEnEmpresa: false });
    await expect(actualizarSolicitudFondo(7, 1, { requirenteEmpleadoId: 999 }))
      .rejects.toThrow("El requirente indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it.each([
    ["empleadoId", { empleadoId: 999 }, "empleadoEnEmpresa" as const, "El empleado indicado no pertenece a esta empresa."],
    ["vehiculoId", { vehiculoId: 999 }, "vehiculoEnEmpresa" as const, "El vehículo indicado no pertenece a esta empresa."],
    ["clienteId", { clienteId: 999 }, "clienteEnEmpresa" as const, "El cliente indicado no pertenece a esta empresa."],
    ["planId", { planId: 999 }, "planEnEmpresa" as const, "El viaje indicado no pertenece a esta empresa."],
  ])("AISLAMIENTO MULTIEMPRESA: rechaza editar con %s de otra empresa, con rollback y sin insertar nada", async (_campo, extra, flag, mensaje) => {
    const conn = conexion({ estadoActual: "Pendiente", [flag]: false });
    await expect(actualizarSolicitudFondo(7, 1, {
      lineas: [{ categoria: "Combustible", monto: 100, ...extra }],
    })).rejects.toThrow(mensaje);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))).toBe(false);
  });
});
