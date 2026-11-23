import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
// SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — mismo criterio que viaticos.test.ts:
// crearFirmaInterna/guardarUpload/borrarUpload/leerBytesFirmaGuardada se
// mockean por completo (nunca tocan disco/DB real en un test unitario).
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn() }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import {
  actualizarSolicitudFondo,
  cambiarEstadoSolicitudFondo,
  crearSolicitudFondo,
  listarSolicitudesFondo,
  MENSAJE_SIN_EMPRESA_REQUIRENTE,
  MENSAJE_SIN_REQUIRENTE,
  type IdentidadFirmante,
} from "./fondos";
import { camposProtegidosModificados, esLineaProtegida, origenDeFila, rechazarOrigenDeCliente } from "./fondo-lineas-protegidas";

const AUTORIZANTE: IdentidadFirmante = { usuarioId: 9, nombre: "Heber Sitan", rol: "JefeOperaciones" };
const IMAGEN_FIRMA = { bytes: new ArrayBuffer(4), original: "firma.png" };

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
  empleadoNombre?: string; empleadoPuesto?: string | null; empleadoCuenta?: string | null; empleadoTelefono?: string | null; vehiculoPlaca?: string; clienteNombre?: string; planFecha?: string;
  // SOLICITUD-FONDOS-REPORTE-1 (pendiente 1 del PR #211) — fila RAW que
  // actualizarSolicitudFondo relee FOR UPDATE antes de editar.
  actualRequirenteEmpleadoId?: number | null;
  actualRequirenteNombre?: string | null;
  actualRequirenteUsuarioId?: number | null;
  actualFechaRequerimiento?: string;
  actualObservaciones?: string | null;
  actualTotal?: number;
  // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — usuario requirente seleccionado
  // del catálogo (resolverUsuarioDeEmpresaTx).
  usuarioEnEmpresa?: boolean; usuarioNombre?: string; usuarioRol?: string | null;
  // Dueños de la solicitud: defensa interna de autoautorización cuando la
  // ruta no ha confirmado el permiso específico (fila RAW FOR UPDATE).
  cambiarRequirenteUsuarioId?: number | null;
  cambiarSolicitanteUsuarioId?: number | null;
  cambiarCreadoPor?: string | null;
  entidadRequirenteValida?: boolean;
  // FONDOS FASE 1 — fila RAW usada al AUTORIZAR (empresa requirente y requirente de la solicitud guardada).
  actualEntidadRequirenteId?: number | null;
  sinRequirente?: boolean;
  // FONDOS FASE 1 — líneas ya guardadas (SELECT … FOR UPDATE por empresa+solicitud) y vínculos que impiden retirarlas.
  lineasExistentes?: Record<string, unknown>[];
  lineasConVales?: number[];
  lineasConCb2?: number[];
} = {}) {
  const empleadoEnEmpresa = opts.empleadoEnEmpresa ?? true;
  const vehiculoEnEmpresa = opts.vehiculoEnEmpresa ?? true;
  const clienteEnEmpresa = opts.clienteEnEmpresa ?? true;
  const planEnEmpresa = opts.planEnEmpresa ?? true;
  const usuarioEnEmpresa = opts.usuarioEnEmpresa ?? true;
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      void _params;
      if (sql.includes("FROM cont_entidades")) {
        return [opts.entidadRequirenteValida === false ? [] : [{ id: 10, nombre: "Kuiqtrans" }]];
      }
      // FONDOS FASE 1 — líneas guardadas y sus vínculos (Combustible / CB2) dentro de la transacción de edición.
      if (sql.includes("FROM tms_solicitud_fondo_lineas l WHERE")) return [opts.lineasExistentes ?? []];
      if (sql.includes("FROM flota_combustible_cargas")) return [(opts.lineasConVales ?? []).map((n) => ({ linea_id: n }))];
      if (sql.includes("FROM flota_cb2_fondos_vinculos")) return [(opts.lineasConCb2 ?? []).map((n) => ({ linea_id: n }))];
      if (sql.includes("FROM tms_solicitudes_fondo WHERE id")) {
        return [[{
          id: 1, estado: opts.estadoActual ?? "Pendiente",
          entidad_requirente_id: opts.actualEntidadRequirenteId === undefined ? 10 : opts.actualEntidadRequirenteId,
          requirente_empleado_id: opts.actualRequirenteEmpleadoId ?? null,
          requirente_nombre: opts.sinRequirente ? null : (opts.actualRequirenteNombre ?? "Juan Perez"),
          requirente_usuario_id: opts.sinRequirente ? null : (opts.cambiarRequirenteUsuarioId ?? opts.actualRequirenteUsuarioId ?? null),
          solicitante_usuario_id: opts.cambiarSolicitanteUsuarioId ?? null,
          creado_por: opts.cambiarCreadoPor ?? "admin",
          fecha_requerimiento: opts.actualFechaRequerimiento ?? "2026-09-01",
          observaciones: opts.actualObservaciones ?? null,
          total: opts.actualTotal ?? 500,
        }]];
      }
      // SOLICITUD-FONDOS-REPORTE-1: resolverSnapshotLineaTx — cada catálogo
      // relecto por (id, empresa_id) dentro de la MISMA transacción.
      if (sql.includes("nombre, puesto, cuenta_bancaria, telefono FROM empleados")) {
        return [empleadoEnEmpresa
          ? [{ nombre: opts.empleadoNombre ?? "Juan Pérez", puesto: opts.empleadoPuesto ?? "Piloto", cuenta_bancaria: opts.empleadoCuenta ?? "1234567890", telefono: opts.empleadoTelefono ?? null }]
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
        return [planEnEmpresa ? [{ fecha_plan: opts.planFecha ?? "2026-09-05", cliente_id: 12, cliente_nombre: "Cliente del plan" }] : []];
      }
      // SOLICITUD-FONDOS-PDF-AUTORIZADO-1: resolverUsuarioDeEmpresaTx (requirente-usuario)
      if (sql.includes("FROM usuarios u")) {
        return [usuarioEnEmpresa ? [{ nombre: opts.usuarioNombre ?? "Mario Caal", rol_global: opts.usuarioRol ?? "Operaciones" }] : []];
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

beforeEach(() => {
  vi.resetAllMocks();
  // Default seguro: sin firma guardada en "Mi firma" (los tests de
  // captura de firma la sobreescriben explícitamente) — nunca toca disco real.
  vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(null);
  vi.mocked(guardarUpload).mockResolvedValue({ relative: "empresas/7/firmas/firma_x.png", original: "firma.png", size: 15 } as never);
  vi.mocked(crearFirmaInterna).mockResolvedValue({
    id: 1, codigoFirma: "SIG-1", fechaHoraServidor: new Date("2026-09-01T10:00:00Z"),
    hashPayload: "hash", nombreFirmante: "Heber Sitan", rolFirmante: "JefeOperaciones", tieneImagen: true,
  } as never);
});

describe("aislamiento multiempresa en el SELECT de listado (bloqueo 1, revisión PR #204)", () => {
  it("los JOIN a empleados (requirente/autorizante) exigen empresa_id igual, no solo el id", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarSolicitudesFondo(7);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("req.id = s.requirente_empleado_id AND req.empresa_id = s.empresa_id");
    expect(sql).toContain("aut.id = s.autorizante_empleado_id AND aut.empresa_id = s.empresa_id");
  });
});

/**
 * REPORTES-FONDOS-PDF-TABULAR-1 — el listado en pantalla (GET /tms/fondos)
 * ahora respeta el filtro Requirente, mismo criterio que ya usaban las
 * exportaciones (condicionesFondos en reportes-gastos.ts, sobre
 * s.requirente_usuario_id) — nunca un segundo mecanismo de filtrado.
 */
describe("listarSolicitudesFondo — filtro Requirente", () => {
  it("con requirenteUsuarioId, agrega la condición y el parámetro", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarSolicitudesFondo(7, { requirenteUsuarioId: 9 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("s.requirente_usuario_id = ?");
    expect(params).toEqual([7, 9]);
  });

  it("sin requirenteUsuarioId, no agrega la condición (todos los requirentes)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarSolicitudesFondo(7);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    // SELECT_SOLICITUD ya trae s.requirente_usuario_id como columna (para
    // otros usos) — lo que NO debe aparecer es la CONDICIÓN del filtro.
    expect(sql).not.toContain("s.requirente_usuario_id = ?");
    expect(params).toEqual([7]);
  });

  it("combina con estado y fechas (filtros existentes) sin pisarlos", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarSolicitudesFondo(7, { estado: "Autorizada", fechaDesde: "2026-09-01", fechaHasta: "2026-09-30", requirenteUsuarioId: 9 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("s.estado = ?");
    expect(sql).toContain("s.fecha_requerimiento >= ?");
    expect(sql).toContain("s.fecha_requerimiento <= ?");
    expect(sql).toContain("s.requirente_usuario_id = ?");
    expect(params).toEqual([7, "Autorizada", "2026-09-01", "2026-09-30", 9]);
  });
});

describe("regresión requirente de Operaciones Fondos", () => {
  it.each(["Contabilidad", "Admin", "Gerencia"])("rechaza nuevo requirente %s sin escritura", async rol => {
    const c = conexion({ usuarioRol: rol });
    await expect(crearSolicitudFondo(7, { fechaRequerimiento: "2026-09-01", requirenteUsuarioId: 9, lineas: [{ categoria: "Otros", monto: 10 }] })).rejects.toThrow("usuario de Operaciones");
    expect(c.execute).not.toHaveBeenCalled(); expect(c.rollback).toHaveBeenCalledOnce();
  });
  it.each([9, null])("preserva histórico %s fuera del catálogo al editar otros datos", async id => {
    const c = conexion({ actualRequirenteUsuarioId: id, actualRequirenteNombre: "Anterior", usuarioRol: "Contabilidad" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await actualizarSolicitudFondo(7, 1, { observaciones: "Otra edición", requirenteUsuarioId: id, requirenteNombre: "Anterior" });
    expect(c.query.mock.calls.some(([sql]) => sql.includes("FROM usuarios"))).toBe(false);
    expect(c.execute.mock.calls.find(([sql]) => sql.includes("UPDATE tms_solicitudes_fondo"))?.[1]).toContain("Anterior");
  });
  it("cambiar histórico a usuario no Operaciones rechaza antes de escrituras", async () => {
    const c = conexion({ actualRequirenteUsuarioId: 8, usuarioRol: "Contabilidad" });
    await expect(actualizarSolicitudFondo(7, 1, { requirenteUsuarioId: 9 })).rejects.toThrow("usuario de Operaciones");
    expect(c.execute).not.toHaveBeenCalled();
  });
});
describe("crearSolicitudFondo", () => {
  it("valida la entidad requirente por empresa, activa y código permitido, y guarda nombre resuelto", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaSolicitud({ entidad_requirente_id: 10, entidad_requirente_nombre: "Kuiqtrans" })] as never);
    await crearSolicitudFondo(7, {
      entidadRequirenteId: 10, fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100 }],
    });
    const consulta = conn.query.mock.calls.find((c) => String(c[0]).includes("FROM cont_entidades"));
    expect(String(consulta?.[0])).toContain("empresa_id = ? AND activa = 1 AND codigo IN (?, ?)");
    expect(consulta?.[1]).toEqual([10, 7, "KT", "MONACO"]);
    const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_solicitudes_fondo"));
    expect(insert?.[1]).toEqual(expect.arrayContaining([10, "Kuiqtrans"]));
  });

  it("rechaza una entidad requirente ajena, inactiva o con código no permitido", async () => {
    conexion({ entidadRequirenteValida: false });
    await expect(crearSolicitudFondo(7, {
      entidadRequirenteId: 99, fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100 }],
    })).rejects.toThrow("empresa requirente no es válida");
  });
  it("rechaza sin líneas", async () => {
    conexion();
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9, lineas: [],
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
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 0 }],
    })).rejects.toThrow("mayor a cero");
  });

  it("calcula el total como suma de cantidad*monto y genera código FONDO-######", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
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
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
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

  it("con requirente usuario de Operaciones de la MISMA empresa, sí crea", async () => {
    const conn = conexion({ empleadoEnEmpresa: true });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteUsuarioId: 9,
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
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [
        { categoria: "Combustible", monto: 100, cantidad: 2, empleadoId: 4, vehiculoId: 9, clienteId: 5, fechaViaje: "2026-09-02" },
        { categoria: "Hospedaje", monto: 150 }, // línea sin relaciones — sigue siendo válida
      ],
    }, "admin");
    const insertsLinea = conn.execute.mock.calls.filter((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"));
    expect(insertsLinea).toHaveLength(2);
    // empresa_id, solicitud_id, categoria, descripcion, cantidad, monto, orden,
    // fecha_viaje, empleado_id, empleado_nombre, cargo, cuenta, metodo_pago,
    // vehiculo_id, placa, cliente_id, cliente_nombre, plan_id
    expect(insertsLinea[0][1]).toEqual([
      7, 1, "Combustible", null, 2, 100, 0,
      "2026-09-02", 4, "Heber Sitan", "Piloto", "1234567890", null, 9, "P111AAA", 5, "Cliente A", null,
    ]);
    expect(insertsLinea[1][1]).toEqual([
      7, 1, "Hospedaje", null, 1, 150, 1,
      null, null, null, null, null, null, null, null, null, null, null,
    ]);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("el snapshot SIEMPRE se resuelve del lado del servidor — nunca confía en nombre/placa/cliente enviados por el cliente HTTP (el tipo LineaFondoInput ni siquiera los acepta)", async () => {
    const conn = conexion({ empleadoNombre: "Nombre Real En BD", empleadoPuesto: "Auxiliar" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, empleadoId: 4 }],
    });
    const insertLinea = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insertLinea[1]).toContain("Nombre Real En BD"); // releído de BD, no un valor inventado por el caller
  });

  it("permite editar nombre/cuenta/cargo como snapshot sin actualizar el maestro de empleados", async () => {
    const conn = conexion({ empleadoNombre: "Nombre Maestro", empleadoPuesto: "Piloto", empleadoCuenta: "111" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, empleadoId: 4, empleadoNombreOverride: "  Nombre Administrativo  ", cuentaOverride: "  9988 7766 ", cargoOverride: " Piloto especial " }],
    });
    const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insert[1]).toEqual(expect.arrayContaining(["Nombre Administrativo", "9988 7766", "Piloto especial"]));
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE empleados"))).toBe(false);
  });

  it("conserva un snapshot de Cuenta vacío aunque RRHH tenga una cuenta vigente", async () => {
    const conn = conexion({ empleadoCuenta: "001122" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      requirenteUsuarioId: 8, solicitanteUsuarioId: 9,
      fechaRequerimiento: "2026-09-09",
      lineas: [{ categoria: "Otros", monto: 25, empleadoId: 4, cuentaOverride: "" }],
    }, "admin");
    const insertLinea = conn.execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect((insertLinea[1] as unknown[])[11]).toBeNull();
    expect(conn.execute.mock.calls.some(([sql]) => /UPDATE\s+empleados/i.test(String(sql)))).toBe(false);
  });

  it("fechaViaje explícita del caller SIEMPRE gana sobre la fecha del plan", async () => {
    const conn = conexion({ planFecha: "2026-09-10" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, planId: 8, fechaViaje: "2026-09-03" }],
    });
    const insertLinea = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insertLinea[1]).toContain("2026-09-03"); // la fecha escrita a mano, NO la del plan (2026-09-10)
  });

  it("sin fechaViaje explícita, se completa con la fecha real del plan indicado (planId)", async () => {
    const conn = conexion({ planFecha: "2026-09-10" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, planId: 8 }],
    });
    const insertLinea = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insertLinea[1]).toContain("2026-09-10");
    expect(insertLinea[1]).toContain(12);
    expect(insertLinea[1]).toContain("Cliente del plan");
  });

  it("un cliente elegido después del plan se conserva y no modifica Programación", async () => {
    const conn = conexion({ planFecha: "2026-09-10", clienteNombre: "Cliente elegido" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, planId: 8, clienteId: 5 }],
    });
    const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insert[1]).toEqual(expect.arrayContaining([5, "Cliente elegido", 8]));
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE tms_planes_viaje"))).toBe(false);
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE empleados"))).toBe(false);
  });

  it.each([
    ["empleadoId", { empleadoId: 999 }, "empleadoEnEmpresa" as const, "El empleado indicado no pertenece a esta empresa."],
    ["vehiculoId", { vehiculoId: 999 }, "vehiculoEnEmpresa" as const, "El vehículo indicado no pertenece a esta empresa."],
    ["clienteId", { clienteId: 999 }, "clienteEnEmpresa" as const, "El cliente indicado no pertenece a esta empresa."],
    ["planId", { planId: 999 }, "planEnEmpresa" as const, "El viaje indicado no pertenece a esta empresa."],
  ])("AISLAMIENTO MULTIEMPRESA: rechaza una línea con %s de otra empresa, sin insertar nada", async (_campo, extra, flag, mensaje) => {
    const conn = conexion({ [flag]: false });
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, ...extra }],
    })).rejects.toThrow(mensaje);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))).toBe(false);
  });
});

/**
 * FONDOS-GASTOS-METODO-PAGO-1 — `metodoPago` es POR LÍNEA (mismo
 * catálogo que Gastos, METODOS_PAGO_GASTO) y NO forma parte del
 * snapshot de empleado: se guarda tal cual viene, mientras que el
 * destino de pago (`cuenta`) pasa por normalizarDestinoPago (gastos.ts)
 * ANTES de insertarse — reutilizando exactamente la misma validación que
 * ya cubre gastos.test.ts.
 */
describe("crearSolicitudFondo — método de pago por línea (FONDOS-GASTOS-METODO-PAGO-1)", () => {
  it("resuelve móvil desde teléfono RRHH y mantiene consulta tenant-safe", async () => {
    const conn = conexion({ empleadoTelefono: "5555-1234" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Otros", monto: 100, empleadoId: 4, metodoPago: "Transferencia móvil" }],
    });
    const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insert[1]).toContain("55551234");
    const lectura = conn.query.mock.calls.find((c) => c[0].includes("cuenta_bancaria, telefono"))!;
    expect(lectura[0]).toContain("empresa_id = ?");
  });
  it("rechaza Transferencia móvil sin cuenta/override resuelto, con rollback y sin insertar nada", async () => {
    const conn = conexion({ empleadoCuenta: "" }); // sin cuenta bancaria en el maestro
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, empleadoId: 4, metodoPago: "Transferencia móvil" }],
    })).rejects.toThrow("Ingresa el número");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))).toBe(false);
  });

  it("Transferencia móvil con número override: normaliza (quita espacios/guiones) antes de guardar", async () => {
    const conn = conexion({ empleadoCuenta: "1234567890" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, empleadoId: 4, cuentaOverride: "5555-1234", metodoPago: "Transferencia móvil" }],
    });
    const insertLinea = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insertLinea[1]).toEqual(expect.arrayContaining(["55551234", "Transferencia móvil"]));
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("otros métodos (o sin método): la cuenta sigue siendo opcional, mismo comportamiento previo", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Hospedaje", monto: 100 }], // sin empleado -> sin cuenta -> sin metodoPago tampoco es un problema
    });
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("históricos: metodo_pago queda NULL cuando no se envía, sin romper la línea", async () => {
    const conn = conexion({ empleadoCuenta: "1234567890" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9,
      lineas: [{ categoria: "Combustible", monto: 100, empleadoId: 4 }],
    });
    const insertLinea = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))!;
    expect(insertLinea[1]).toContain(null); // metodo_pago no enviado -> null (comportamiento "Cuenta" tradicional)
  });
});

/**
 * SOLICITUD-FONDOS-PDF-AUTORIZADO-1 §1/§3 — firma del SOLICITANTE
 * (siempre, best-effort) y del REQUIRIENTE (solo cuando se asocia un
 * usuario real del catálogo, best-effort) — a diferencia de autorizar,
 * NUNCA bloquean la creación por falta de firma.
 */
describe("crearSolicitudFondo — firma real de solicitante y requirente (§1/§3 del ticket)", () => {
  const SOLICITANTE: IdentidadFirmante = { usuarioId: 5, nombre: "Mario Caal", rol: "Operaciones" };

  it("selecciona solicitante explícito distinto del requirente y guarda ambos snapshots", async () => {
    const conn = conexion({ usuarioNombre: "Persona de Operaciones", usuarioRol: "JefeOperaciones" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteUsuarioId: 9, solicitanteUsuarioId: 55,
      lineas: [{ categoria: "Combustible", monto: 100 }],
    }, "admin");
    const insert = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitudes_fondo"));
    expect(insert?.[1]).toContain(9);
    expect(insert?.[1]).toContain(55);
    expect(insert?.[1]).toContain("Persona de Operaciones");
  });

  it("guarda el snapshot del SOLICITANTE al crear (nombre real + firma de 'Mi firma')", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9, lineas: [{ categoria: "Combustible", monto: 100 }],
    }, "mcaal", SOLICITANTE);

    const insertCabecera = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitudes_fondo"));
    expect(insertCabecera?.[1]).toContain(5); // solicitante_usuario_id
    expect(insertCabecera?.[1]).toContain("Mario Caal"); // solicitante_nombre
    expect(leerBytesFirmaGuardada).toHaveBeenCalledWith(5);
    expect(crearFirmaInterna).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      usuarioId: 5, nombreFirmante: "Mario Caal", accion: "SOLICITAR_FONDO", modulo: "FONDOS", entidadTipo: "SOLICITUD_FONDO",
      metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
    }));
  });

  it("solicitante SIN firma guardada: la solicitud se crea igual, sin bloquear ni inventar una firma", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(null); // sin "Mi firma"
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9, lineas: [{ categoria: "Combustible", monto: 100 }],
    }, "mcaal", SOLICITANTE);
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });

  it("requirente asociado a un usuario del catálogo: resuelve su nombre real y captura su firma", async () => {
    const conn = conexion({ usuarioNombre: "Ana Gómez", usuarioRol: "GerenteOperaciones" });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
    await crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteUsuarioId: 30, lineas: [{ categoria: "Combustible", monto: 100 }],
    }, "mcaal");
    const insertCabecera = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_solicitudes_fondo"));
    expect(insertCabecera?.[1]).toContain("Ana Gómez"); // nombre real, nunca el texto libre
    expect(insertCabecera?.[1]).toContain(30); // requirente_usuario_id
    expect(crearFirmaInterna).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      usuarioId: 30, nombreFirmante: "Ana Gómez", accion: "REQUERIR_FONDO",
    }));
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("AISLAMIENTO MULTIEMPRESA: rechaza un requirenteUsuarioId que no tiene acceso a esta empresa, sin escribir nada", async () => {
    const conn = conexion({ usuarioEnEmpresa: false });
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteUsuarioId: 999, lineas: [{ categoria: "Combustible", monto: 100 }],
    })).rejects.toThrow("La persona que requiere debe ser un usuario de Operaciones.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_solicitudes_fondo"))).toBe(false);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });

  it("texto libre nuevo rechazado sin escrituras ni captura de firma", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan Pérez (texto libre)", lineas: [{ categoria: "Combustible", monto: 100 }],
    })).rejects.toThrow("La persona que requiere debe ser un usuario de Operaciones.");
    expect(leerBytesFirmaGuardada).not.toHaveBeenCalled();
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("si falla la transacción después de guardar las firmas, se compensan (borran) los archivos escritos", async () => {
    // Falla DESPUÉS de la captura de firmas (que ocurre luego de insertar
    // las líneas), en la auditoría — así el archivo de firma ya se
    // escribió a disco cuando el rollback ocurre.
    conexion({ fallaEn: "INSERT INTO auditoria" });
    vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
    await expect(crearSolicitudFondo(7, {
      fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", requirenteUsuarioId: 9, lineas: [{ categoria: "Combustible", monto: 100 }],
    }, "mcaal", SOLICITANTE)).rejects.toThrow();
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });
});

describe("cambiarEstadoSolicitudFondo", () => {
  it("permite Pendiente -> Autorizada, con firma real del autorizante", async () => {
    const conn = conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
    await cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } });
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("rechaza autorizar -> pendiente (transición hacia atrás) sin escribir nada", async () => {
    const conn = conexion({ estadoActual: "Rechazada" });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } }))
      .rejects.toThrow('No se puede pasar de "Rechazada" a "Autorizada"');
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("rechazar exige motivo", async () => {
    conexion({ estadoActual: "Pendiente" });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "rechazar")).rejects.toThrow("motivo");
  });

  it("Liquidada no admite ninguna transición más", async () => {
    conexion({ estadoActual: "Liquidada" });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } })).rejects.toThrow();
  });

  it("devuelve null si la solicitud no existe", async () => {
    const conn = conexion();
    conn.query.mockResolvedValue([[]]);
    expect(await cambiarEstadoSolicitudFondo(7, 999, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } })).toBeNull();
  });

  it("AISLAMIENTO MULTIEMPRESA: rechaza autorizar con un autorizanteEmpleadoId que no pertenece a esta empresa", async () => {
    const conn = conexion({ estadoActual: "Pendiente", empleadoEnEmpresa: false });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", {
      autorizanteEmpleadoId: 999, autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA },
    })).rejects.toThrow("El autorizante indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

/**
 * La librería rechaza por defecto una solicitud propia. Solo la ruta que ya
 * validó `gastos_autorizar:editar` puede activar la excepción explícita.
 */
describe("cambiarEstadoSolicitudFondo — autoautorización controlada por permiso", () => {
  const MSG = "No puede autorizar su propia solicitud.";

  it("el autorizante ES el REQUIRENTE de la solicitud -> rechazo con el mensaje exacto, sin commit", async () => {
    const conn = conexion({ estadoActual: "Pendiente", cambiarRequirenteUsuarioId: 9 });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } }))
      .rejects.toThrow(MSG);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    // la copia de la firma se compensa (nunca queda huérfana)
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });

  it("el autorizante ES el SOLICITANTE de la solicitud -> rechazo", async () => {
    const conn = conexion({ estadoActual: "Pendiente", cambiarSolicitanteUsuarioId: 9 });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } }))
      .rejects.toThrow(MSG);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("el autorizante CREÓ el registro (creado_por == su username) -> rechazo", async () => {
    const conn = conexion({ estadoActual: "Pendiente", cambiarCreadoPor: "hsitan" });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", { usuario: "hsitan", autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } }))
      .rejects.toThrow(MSG);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("permite al creador autorizar cuando la ruta habilita explícitamente la autoautorización", async () => {
    const conn = conexion({ estadoActual: "Pendiente", cambiarRequirenteUsuarioId: 9, cambiarCreadoPor: "hsitan" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
    await cambiarEstadoSolicitudFondo(7, 1, "autorizar", {
      usuario: "hsitan",
      autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA },
      permitirAutoautorizacion: true,
    });
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(crearFirmaInterna).toHaveBeenCalled();
  });

  it("autorizante distinto del requirente/solicitante/creador -> autoriza normalmente", async () => {
    const conn = conexion({ estadoActual: "Pendiente", cambiarRequirenteUsuarioId: 100, cambiarSolicitanteUsuarioId: 200, cambiarCreadoPor: "otro" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
    await cambiarEstadoSolicitudFondo(7, 1, "autorizar", { usuario: "hsitan", autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } });
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(crearFirmaInterna).toHaveBeenCalled();
  });
});

/**
 * SOLICITUD-FONDOS-PDF-AUTORIZADO-1 §2/§4/§6/§7/§11 — "No permitir una
 * Solicitud Autorizada sin firma del autorizante": bloquea ANTES de
 * tocar la base de datos si falta `opts.autorizante`, y captura un
 * snapshot INMUTABLE (firmas_electronicas) de la firma real usada en
 * ESE momento — nunca vuelve a resolver "la firma actual" del usuario.
 */
describe("cambiarEstadoSolicitudFondo — firma real del autorizante (§2 del ticket)", () => {
  it("autorizante SIN firma (opts.autorizante ausente) -> rechaza con el mensaje fijo, sin tocar la base de datos", async () => {
    const conn = conexion({ estadoActual: "Pendiente" });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar")).rejects.toThrow(
      "Debes registrar tu firma en Mi firma antes de autorizar la solicitud.",
    );
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });

  it("autorización guarda un snapshot REAL: crearFirmaInterna recibe la imagen, el nombre real y accion='AUTORIZAR_FONDO'", async () => {
    const conn = conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
    await cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } });
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 7, usuarioId: 9, nombreFirmante: "Heber Sitan",
      accion: "AUTORIZAR_FONDO", modulo: "FONDOS", entidadTipo: "SOLICITUD_FONDO", entidadId: 1,
      metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
      imagen: expect.objectContaining({ relative: "empresas/7/firmas/firma_x.png" }),
    }));
    // La copia física se escribe ANTES de abrir la transacción de negocio.
    expect(vi.mocked(guardarUpload).mock.invocationCallOrder[0]).toBeLessThan(conn.beginTransaction.mock.invocationCallOrder[0]);
    const update = conn.execute.mock.calls.find((c) => (c[0] as string).includes("autorizante_usuario_id"));
    expect(update?.[1]).toEqual(["Autorizada", null, "Heber Sitan", 9, 1, 7]);
  });

  it("el nombre guardado es SIEMPRE el real de la identidad de sesión — nunca un autorizanteNombre inventado por el caller", async () => {
    conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
    // El tipo ya no acepta autorizanteNombre — solo opts.autorizante.nombre define el nombre persistido.
    await cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizante: { usuarioId: 20, nombre: "Ana Gómez", rol: null, imagen: IMAGEN_FIRMA } });
    expect(crearFirmaInterna).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nombreFirmante: "Ana Gómez" }));
  });

  it("si falla la transacción después de guardar la imagen, se compensa (borra) el archivo — nunca queda huérfano", async () => {
    conexion({ estadoActual: "Pendiente", fallaEn: "UPDATE tms_solicitudes_fondo" });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } })).rejects.toThrow();
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });

  it("commit exitoso NUNCA borra el archivo de la firma recién guardada", async () => {
    conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
    await cambiarEstadoSolicitudFondo(7, 1, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } });
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("AISLAMIENTO MULTIEMPRESA: la firma se registra con el empresaId del caller, nunca uno distinto", async () => {
    conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
    await cambiarEstadoSolicitudFondo(9, 1, "autorizar", { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } });
    expect(crearFirmaInterna).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ empresaId: 9 }));
  });
});

/**
 * SOLICITUD-FONDOS-REPORTE-1 (pendiente 1 del PR #211) — edición de una
 * solicitud existente MIENTRAS está Pendiente: encabezado + reemplazo de
 * líneas en UNA transacción, total recalculado, snapshot regenerado por
 * resolverSnapshotLineaTx (mismo criterio de seguridad que al crear).
 */
describe("actualizarSolicitudFondo", () => {
  it("edita Pendiente: encabezado y líneas se actualizan (inserta las nuevas), el total se recalcula", async () => {
    const conn = conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ total: "600.00" })] as never);
    await actualizarSolicitudFondo(7, 1, {
      fechaRequerimiento: "2026-09-05",
      requirenteUsuarioId: 9,
      observaciones: "Actualizada",
      lineas: [
        { categoria: "Combustible", monto: 200, cantidad: 2 }, // 400
        { categoria: "Hospedaje", monto: 200 }, // 200
      ],
    }, "admin");
    const updateHeader = conn.execute.mock.calls.find((c) => (c[0] as string).includes("UPDATE tms_solicitudes_fondo"))!;
    expect(updateHeader[1]).toEqual([10, undefined, null, "Mario Caal", 9, "2026-09-05", 600, "Actualizada", 1, 7]);
    // Sin líneas guardadas previas ya NO se hace un DELETE masivo: solo se insertan las nuevas.
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("DELETE FROM tms_solicitud_fondo_lineas"))).toBe(false);
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
    expect(updateHeader[1]).toEqual([10, undefined, 9, "Nombre Original", null, "2026-08-20", 100, "Nota original", 1, 7]);
  });

  it("sin lineas en el input: NO se tocan las líneas existentes ni el total", async () => {
    const conn = conexion({ estadoActual: "Pendiente" });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ total: "500.00" })] as never);
    await actualizarSolicitudFondo(7, 1, { observaciones: "Solo cambio observaciones" });
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("DELETE FROM tms_solicitud_fondo_lineas"))).toBe(false);
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_solicitud_fondo_lineas"))).toBe(false);
    const updateHeader = conn.execute.mock.calls.find((c) => (c[0] as string).includes("UPDATE tms_solicitudes_fondo"))!;
    expect((updateHeader[1] as unknown[])?.[6]).toBe(500); // total sin cambios (releído de la fila actual)
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

describe('categoria Viaticos en lineas de fondo',()=>{
 it('guarda el valor literal al crear y al editar',async()=>{
  const conn=conexion();vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
  await crearSolicitudFondo(7,{requirenteUsuarioId:9,fechaRequerimiento:'2026-09-01',lineas:[{categoria:'Viáticos',monto:100}]});
  expect(conn.execute.mock.calls.find(c=>String(c[0]).includes('INSERT INTO tms_solicitud_fondo_lineas'))?.[1]).toEqual(expect.arrayContaining(['Viáticos']));
  conn.execute.mockClear();await actualizarSolicitudFondo(7,1,{lineas:[{categoria:'Viáticos',monto:100}]});
  expect(conn.execute.mock.calls.find(c=>String(c[0]).includes('INSERT INTO tms_solicitud_fondo_lineas'))?.[1]).toEqual(expect.arrayContaining(['Viáticos']));
 });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FONDOS FASE 1 — edición diferencial de líneas, protección de líneas automáticas y requisitos previos a autorizar.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const filaLinea = (o: Record<string, unknown> = {}) => ({
  id: 11, empresa_id: 7, solicitud_id: 1, categoria: "Combustible", descripcion: null, cantidad: "1.00", monto: "100.00", orden: 0,
  fecha_viaje: null, fecha_viaje_txt: null, empleado_id: null, empleado_nombre: null, cargo: null, cuenta: null, metodo_pago: null,
  vehiculo_id: null, placa: null, cliente_id: null, cliente_nombre: null, plan_id: null, ...o,
});
const sqlsLineas = (conn: ReturnType<typeof conexion>, verbo: "INSERT INTO" | "UPDATE" | "DELETE FROM") =>
  conn.execute.mock.calls.filter((c) => String(c[0]).includes(`${verbo} tms_solicitud_fondo_lineas`));

describe("actualizarSolicitudFondo — actualización diferencial de líneas (FONDOS FASE 1)", () => {
  const dos = () => [filaLinea({ id: 11, categoria: "Combustible", monto: "100.00", orden: 0 }), filaLinea({ id: 12, categoria: "Hospedaje", monto: "200.00", orden: 1 })];

  it("1) editar una línea la actualiza EN SU SITIO: el UPDATE apunta a su id y no se borra ni reinserta nada", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await actualizarSolicitudFondo(7, 1, { lineas: [{ id: 11, categoria: "Combustible", monto: 150 }, { id: 12, categoria: "Hospedaje", monto: 200 }] });
    const updates = sqlsLineas(conn, "UPDATE");
    expect(updates).toHaveLength(1);
    expect((updates[0][1] as unknown[]).slice(-3)).toEqual([11, 7, 1]);   // WHERE id = ? AND empresa_id = ? AND solicitud_id = ?
    expect((updates[0][1] as unknown[])[3]).toBe(150);
    expect(sqlsLineas(conn, "DELETE FROM")).toHaveLength(0); expect(sqlsLineas(conn, "INSERT INTO")).toHaveLength(0);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("2) las líneas SIN cambios conservan su identidad: no se escribe nada sobre ellas", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await actualizarSolicitudFondo(7, 1, { observaciones: "x", lineas: [{ id: 11, categoria: "Combustible", monto: 100 }, { id: 12, categoria: "Hospedaje", monto: 200 }] });
    expect(sqlsLineas(conn, "UPDATE")).toHaveLength(0); expect(sqlsLineas(conn, "DELETE FROM")).toHaveLength(0); expect(sqlsLineas(conn, "INSERT INTO")).toHaveLength(0);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("3) agregar una línea (sin id) solo inserta esa; las existentes no se tocan", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await actualizarSolicitudFondo(7, 1, { lineas: [{ id: 11, categoria: "Combustible", monto: 100 }, { id: 12, categoria: "Hospedaje", monto: 200 }, { categoria: "Parqueo", monto: 30 }] });
    const inserts = sqlsLineas(conn, "INSERT INTO");
    expect(inserts).toHaveLength(1); expect((inserts[0][1] as unknown[])[2]).toBe("Parqueo"); expect((inserts[0][1] as unknown[])[6]).toBe(2);
    expect(sqlsLineas(conn, "UPDATE")).toHaveLength(0); expect(sqlsLineas(conn, "DELETE FROM")).toHaveLength(0);
  });

  it("4) eliminar una línea libre borra SOLO esa (por id, empresa y solicitud) y conserva el resto", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await actualizarSolicitudFondo(7, 1, { lineas: [{ id: 11, categoria: "Combustible", monto: 100 }] });
    const borrados = sqlsLineas(conn, "DELETE FROM");
    expect(borrados).toHaveLength(1);
    expect(String(borrados[0][0])).toContain("WHERE empresa_id = ? AND solicitud_id = ? AND id IN (?)"); expect(borrados[0][1]).toEqual([7, 1, 12]);
    expect(sqlsLineas(conn, "UPDATE")).toHaveLength(0); expect(conn.commit).toHaveBeenCalledOnce();
  });

  it.each([
    ["vales de Combustible", { lineasConVales: [12] }],
    ["vínculos CB2", { lineasConCb2: [12] }],
  ])("5) NO se puede eliminar una línea con %s: error controlado, ROLLBACK total y sin ningún cambio de líneas", async (_n, vinculos) => {
    const conn = conexion({ lineasExistentes: dos(), ...vinculos });
    await expect(actualizarSolicitudFondo(7, 1, { observaciones: "no debe persistir", lineas: [{ id: 11, categoria: "Combustible", monto: 999 }] }))
      .rejects.toThrow("No se puede eliminar la línea 2 (Hospedaje): tiene vales de Combustible o vínculos CB2 asociados");
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled();
    expect(sqlsLineas(conn, "DELETE FROM")).toHaveLength(0); expect(sqlsLineas(conn, "UPDATE")).toHaveLength(0); expect(sqlsLineas(conn, "INSERT INTO")).toHaveLength(0);   // ni la línea 1 (monto 999) llegó a escribirse
  });

  it("5b) respaldo: si la base rechaza el DELETE por una FK (errno 1451) el error es controlado y se revierte todo", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    const base = conn.execute.getMockImplementation()!;
    conn.execute.mockImplementation(async (...a: [string, ...unknown[]]) => {
      if (a[0].includes("DELETE FROM tms_solicitud_fondo_lineas")) throw Object.assign(new Error("FK"), { errno: 1451, code: "ER_ROW_IS_REFERENCED_2" });
      return base(...a);
    });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ id: 11, categoria: "Combustible", monto: 100 }] })).rejects.toThrow("tiene registros asociados");
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled();
  });

  it("5c) un error de la base distinto de FK al borrar NO se disfraza: se propaga y se revierte", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    const base = conn.execute.getMockImplementation()!;
    conn.execute.mockImplementation(async (...a: [string, ...unknown[]]) => {
      if (a[0].includes("DELETE FROM tms_solicitud_fondo_lineas")) throw new Error("disco lleno");
      return base(...a);
    });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ id: 11, categoria: "Combustible", monto: 100 }] })).rejects.toThrow("disco lleno");
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("6) AISLAMIENTO: las líneas se leen SOLO por (empresa, solicitud); un id de otra solicitud o empresa se rechaza sin escribir líneas", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    const lectura = () => conn.query.mock.calls.find((c) => String(c[0]).includes("FROM tms_solicitud_fondo_lineas l WHERE"))!;
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ id: 999, categoria: "Combustible", monto: 100 }] }))
      .rejects.toThrow("Línea 1: el identificador de la línea no pertenece a esta solicitud.");
    expect(lectura()[1]).toEqual([7, 1]);
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled();
    expect(sqlsLineas(conn, "UPDATE")).toHaveLength(0); expect(sqlsLineas(conn, "DELETE FROM")).toHaveLength(0); expect(sqlsLineas(conn, "INSERT INTO")).toHaveLength(0);
  });

  it.each([[0], [-3], [1.5]])("6b) un id inválido (%s) se rechaza", async (id) => {
    const conn = conexion({ lineasExistentes: dos() });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ id, categoria: "Combustible", monto: 100 }] })).rejects.toThrow("no pertenece a esta solicitud");
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("6c) la misma línea dos veces en la lista se rechaza", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ id: 11, categoria: "Combustible", monto: 100 }, { id: 11, categoria: "Combustible", monto: 100 }] }))
      .rejects.toThrow("la misma línea aparece más de una vez");
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("7) una solicitud AUTORIZADA sigue inmutable: ni siquiera se leen o escriben líneas", async () => {
    const conn = conexion({ estadoActual: "Autorizada", lineasExistentes: dos() });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ id: 11, categoria: "Combustible", monto: 1 }] })).rejects.toThrow('No se puede editar una solicitud en estado "Autorizada"');
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some((c) => String(c[0]).includes("tms_solicitud_fondo_lineas"))).toBe(false);
    expect(conn.execute.mock.calls.some((c) => /UPDATE|DELETE|INSERT/.test(String(c[0])))).toBe(false);
  });

  it("10) compatibilidad: un cliente que NO envía ids (comportamiento anterior) reemplaza las líneas libres; las nuevas se insertan en el orden recibido", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await actualizarSolicitudFondo(7, 1, { lineas: [{ categoria: "Combustible", monto: 10 }, { categoria: "Hospedaje", monto: 20 }] });
    expect(sqlsLineas(conn, "DELETE FROM")[0][1]).toEqual([7, 1, 11, 12]);
    expect(sqlsLineas(conn, "INSERT INTO")).toHaveLength(2); expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("10b) compatibilidad con vínculos: ese mismo cliente sin ids NO puede borrar una línea con vales; falla de forma controlada", async () => {
    const conn = conexion({ lineasExistentes: dos(), lineasConVales: [11] });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ categoria: "Combustible", monto: 10 }] })).rejects.toThrow("tiene vales de Combustible o vínculos CB2");
    expect(conn.commit).not.toHaveBeenCalled(); expect(sqlsLineas(conn, "INSERT INTO")).toHaveLength(0);
  });

  it("un cambio de orden se persiste (UPDATE solo de la columna orden efectiva) y las líneas conservan su id", async () => {
    const conn = conexion({ lineasExistentes: dos() });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await actualizarSolicitudFondo(7, 1, { lineas: [{ id: 12, categoria: "Hospedaje", monto: 200 }, { id: 11, categoria: "Combustible", monto: 100 }] });
    const updates = sqlsLineas(conn, "UPDATE");
    expect(updates.map((u) => [(u[1] as unknown[])[4], (u[1] as unknown[]).slice(-3)[0]])).toEqual([[0, 12], [1, 11]]);
    expect(sqlsLineas(conn, "DELETE FROM")).toHaveLength(0);
  });
});

describe("líneas automáticas — protección reutilizable (FONDOS FASE 1; todavía no existen líneas automáticas)", () => {
  const auto = (o: Record<string, unknown> = {}) => filaLinea({
    id: 21, categoria: "Viáticos", monto: "150.00", empleado_id: 3, empleado_nombre: "Juan Pérez", cargo: "Piloto", cuenta: "1234567890", plan_id: 5, origen: "AUTO_VIATICO", ...o,
  });
  const base = { id: 21, categoria: "Viáticos", monto: 150, empleadoId: 3, planId: 5 };

  it("cambiar el monto de una línea automática se rechaza", async () => {
    const conn = conexion({ lineasExistentes: [auto()] });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ ...base, monto: 999 }] })).rejects.toThrow(/Línea 1: es una línea automática.*monto/);
    expect(conn.commit).not.toHaveBeenCalled(); expect(sqlsLineas(conn, "UPDATE")).toHaveLength(0);
  });
  it("cambiar el beneficiario (empleado, nombre o cargo) o el viaje se rechaza", async () => {
    for (const cambio of [{ empleadoId: 4 }, { empleadoNombreOverride: "Otra Persona" }, { cargoOverride: "Auxiliar" }, { planId: 6 }, { categoria: "Otros" }]) {
      const conn = conexion({ lineasExistentes: [auto()] });
      await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ ...base, ...cambio }] }), JSON.stringify(cambio)).rejects.toThrow("línea automática");
      expect(conn.commit).not.toHaveBeenCalled();
    }
  });
  it("SÍ se pueden editar método de pago y cuenta: los campos protegidos se conservan EXACTAMENTE como están guardados", async () => {
    const conn = conexion({ lineasExistentes: [auto()] });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await actualizarSolicitudFondo(7, 1, { lineas: [{ ...base, metodoPago: "Transferencia", cuentaOverride: "9988776655" }] });
    const [u] = sqlsLineas(conn, "UPDATE"); const p = u[1] as unknown[];
    expect(p[0]).toBe("Viáticos"); expect(p[3]).toBe(150); expect(p[6]).toBe(3); expect(p[7]).toBe("Juan Pérez"); expect(p[8]).toBe("Piloto"); expect(p[15]).toBe(5);   // protegidos = lo guardado
    expect(p[9]).toBe("9988776655"); expect(p[10]).toBe("Transferencia");   // editables
    expect(p.slice(-3)).toEqual([21, 7, 1]); expect(conn.commit).toHaveBeenCalledOnce();
  });
  it("una línea automática no se puede retirar con la edición manual", async () => {
    const conn = conexion({ lineasExistentes: [auto(), filaLinea({ id: 22, orden: 1 })] });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ id: 22, categoria: "Combustible", monto: 100 }] })).rejects.toThrow("Línea 1: es una línea automática y no se puede eliminar manualmente");
    expect(conn.commit).not.toHaveBeenCalled(); expect(sqlsLineas(conn, "DELETE FROM")).toHaveLength(0);
  });
  it("el cliente HTTP no puede declarar ni cambiar el origen de una línea (nueva o existente)", async () => {
    for (const lineas of [[{ ...base, origen: "MANUAL" }], [{ categoria: "Combustible", monto: 10, origen: "AUTO_VIATICO" }]]) {
      const conn = conexion({ lineasExistentes: [auto()] });
      await expect(actualizarSolicitudFondo(7, 1, { lineas: lineas as never })).rejects.toThrow("el origen de una línea no se puede enviar");
      expect(conn.commit).not.toHaveBeenCalled();
    }
    conexion();
    await expect(crearSolicitudFondo(7, { requirenteUsuarioId: 9, fechaRequerimiento: "2026-09-01", lineas: [{ categoria: "Viáticos", monto: 10, origen: "AUTO_VIATICO" } as never] })).rejects.toThrow("el origen de una línea");
  });
  it("un origen DESCONOCIDO se trata como protegido (falla cerrado)", async () => {
    const conn = conexion({ lineasExistentes: [auto({ origen: "OTRO_FUTURO" })] });
    await expect(actualizarSolicitudFondo(7, 1, { lineas: [{ ...base, monto: 1 }] })).rejects.toThrow("línea automática");
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it("una línea nueva creada por edición manual nace SIEMPRE manual (el INSERT no lleva origen)", async () => {
    const conn = conexion({ lineasExistentes: [] });
    vi.mocked(query).mockResolvedValue([filaSolicitud()] as never);
    await actualizarSolicitudFondo(7, 1, { lineas: [{ categoria: "Combustible", monto: 10 }] });
    expect(String(sqlsLineas(conn, "INSERT INTO")[0][0])).not.toContain("origen");
  });
});

describe("módulo fondo-lineas-protegidas (puro)", () => {
  it("origenDeFila: ausente/NULL/MANUAL = manual; AUTO_VIATICO = automática; cualquier otro valor = desconocido y protegido", () => {
    expect(origenDeFila({})).toBe("MANUAL"); expect(origenDeFila({ origen: null })).toBe("MANUAL"); expect(origenDeFila({ origen: "MANUAL" })).toBe("MANUAL");
    expect(origenDeFila({ origen: "AUTO_VIATICO" })).toBe("AUTO_VIATICO"); expect(origenDeFila({ origen: "x" })).toBe("DESCONOCIDO");
    expect(esLineaProtegida("MANUAL")).toBe(false); expect(esLineaProtegida("AUTO_VIATICO")).toBe(true); expect(esLineaProtegida("DESCONOCIDO")).toBe(true);
  });
  it("camposProtegidosModificados: compara normalizado; undefined = no enviado; null explícito sí cuenta", () => {
    const actual = { categoria: "Viáticos", monto: "150.00", cantidad: "1.00", empleadoId: 3, fechaViaje: "2026-11-19", descripcion: null, planId: 5 };
    expect(camposProtegidosModificados(actual, { monto: 150, cantidad: 1, empleadoId: "3", fechaViaje: "2026-11-19T00:00:00Z", categoria: " Viáticos ", descripcion: "" })).toEqual([]);
    expect(camposProtegidosModificados(actual, {})).toEqual([]);
    expect(camposProtegidosModificados(actual, { monto: 150.01, empleadoId: null, planId: 6 })).toEqual(["monto", "empleadoId", "planId"]);
  });
  it("rechazarOrigenDeCliente solo se activa si la clave `origen` viene en la entrada", () => {
    expect(() => rechazarOrigenDeCliente({ categoria: "x" }, 1)).not.toThrow();
    expect(() => rechazarOrigenDeCliente({ origen: undefined }, 2)).toThrow("Línea 2");
  });
});

describe("cambiarEstadoSolicitudFondo — requisitos previos a autorizar (FONDOS FASE 1)", () => {
  const aut = { autorizante: { ...AUTORIZANTE, imagen: IMAGEN_FIRMA } };
  const sinEscrituras = (conn: ReturnType<typeof conexion>) => {
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => /UPDATE tms_solicitudes_fondo/.test(String(c[0])))).toBe(false);
    expect(crearFirmaInterna).not.toHaveBeenCalled(); expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");   // la copia física de la firma se compensa
  };

  it("8) sin REQUIRENTE no se autoriza: mensaje claro, sin escrituras ni firma", async () => {
    const conn = conexion({ sinRequirente: true });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", aut)).rejects.toThrow(MENSAJE_SIN_REQUIRENTE);
    sinEscrituras(conn);
  });
  it("9) sin EMPRESA REQUIRENTE no se autoriza", async () => {
    const conn = conexion({ actualEntidadRequirenteId: null });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", aut)).rejects.toThrow(MENSAJE_SIN_EMPRESA_REQUIRENTE);
    sinEscrituras(conn);
  });
  it("9b) una empresa requirente que ya no es válida (inactiva, de otra empresa o fuera de KT/MONACO) tampoco se autoriza", async () => {
    const conn = conexion({ entidadRequirenteValida: false });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", aut)).rejects.toThrow("La empresa requirente no es válida");
    sinEscrituras(conn);
  });
  it("un requirente-usuario guardado que ya no tiene acceso a la empresa NO es válido", async () => {
    const conn = conexion({ actualRequirenteUsuarioId: 5, usuarioEnEmpresa: false });
    await expect(cambiarEstadoSolicitudFondo(7, 1, "autorizar", aut)).rejects.toThrow("el requirente de la solicitud ya no es válido");
    sinEscrituras(conn);
  });
  it("un requirente histórico (empleado de RRHH o nombre guardado) de una solicitud Pendiente sigue pudiendo autorizarse", async () => {
    for (const o of [{ actualRequirenteNombre: "Juan Perez" }, { actualRequirenteEmpleadoId: 3, actualRequirenteNombre: "" }, { actualRequirenteUsuarioId: 5 }]) {
      const conn = conexion(o);
      vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
      await cambiarEstadoSolicitudFondo(7, 1, "autorizar", aut);
      expect(conn.commit, JSON.stringify(o)).toHaveBeenCalledOnce();
    }
  });
  it("las verificaciones corren con la fila bloqueada, por empresa, y solo al AUTORIZAR (rechazar/liquidar no las exigen)", async () => {
    const conn = conexion({ actualEntidadRequirenteId: null, sinRequirente: true });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Rechazada" })] as never);
    await cambiarEstadoSolicitudFondo(7, 1, "rechazar", { motivoRechazo: "no procede" });
    expect(conn.commit).toHaveBeenCalledOnce();
    const lectura = conn.query.mock.calls.find((c) => String(c[0]).includes("FROM tms_solicitudes_fondo WHERE id"))!;
    expect(String(lectura[0])).toContain("FOR UPDATE"); expect(lectura[1]).toEqual([1, 7]);
    const conn2 = conexion({ estadoActual: "Autorizada", actualEntidadRequirenteId: null, sinRequirente: true });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Liquidada" })] as never);
    await cambiarEstadoSolicitudFondo(7, 1, "liquidar");
    expect(conn2.commit).toHaveBeenCalledOnce();   // una solicitud ya Autorizada histórica sin esos datos NO se bloquea ni se modifica
  });
  it("10) solicitudes manuales completas conservan su comportamiento: autorizan con firma como antes", async () => {
    const conn = conexion({ actualEntidadRequirenteId: 10, actualRequirenteUsuarioId: 5 });
    vi.mocked(query).mockResolvedValue([filaSolicitud({ estado: "Autorizada" })] as never);
    await cambiarEstadoSolicitudFondo(7, 1, "autorizar", aut);
    expect(conn.commit).toHaveBeenCalledOnce(); expect(crearFirmaInterna).toHaveBeenCalledOnce();
  });
});
