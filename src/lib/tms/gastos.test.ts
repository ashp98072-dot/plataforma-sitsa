import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
// GASTOS-ADMINISTRATIVO-1 (Fase 5) — mismo criterio que fondos.test.ts:
// crearFirmaInterna/guardarUpload/borrarUpload/leerBytesFirmaGuardada se
// mockean por completo (nunca tocan disco/DB real en un test unitario).
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn() }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn() }));
vi.mock("@/lib/firmas/imagen-firma", () => ({ sha256Hex: vi.fn(() => "hash") }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import {
  CATEGORIAS_GASTO,
  ErrorGasto,
  ESTADOS_GASTO,
  MENSAJE_FIRMA_REQUERIDA_AUTORIZAR,
  METODOS_PAGO_GASTO,
  actualizarGasto,
  autorizarGasto,
  crearGasto,
  desactivarGasto,
  listarGastos,
  normalizarDestinoPago,
  obtenerGasto,
  rechazarGasto,
  type GastoOperativo,
} from "./gastos";

const IMAGEN_FIRMA = { bytes: new ArrayBuffer(4), original: "firma.png" };

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 3) — verifica que un rechazo sea
 * EXACTAMENTE un `ErrorGasto` con el status HTTP esperado (nunca se
 * clasifica por texto del mensaje en la API, ver route.ts de autorizar/
 * rechazar) además del mensaje.
 */
async function esperarErrorGasto(promesa: Promise<unknown>, mensaje: string, status: number) {
  await promesa.then(
    () => { throw new Error("Se esperaba que la promesa rechazara."); },
    (error: unknown) => {
      expect(error).toBeInstanceOf(ErrorGasto);
      expect((error as ErrorGasto).message).toBe(mensaje);
      expect((error as ErrorGasto).status).toBe(status);
    },
  );
}

function filaGasto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, empresa_id: 7, fecha_solicitud: "2026-09-01", fecha_viaje: "2026-09-02",
    empleado_id: 3, empleado_codigo: "EMP-003", empleado_nombre: "Juan Perez", empleado_cargo: "Piloto",
    vehiculo_id: 5, vehiculo_placa: "P-123ABC",
    cliente_id: 9, cliente_nombre: "Cliente Acme",
    plan_id: 11, plan_codigo: "PLAN-20260901-001",
    categoria: "Combustible", descripcion: "Diesel", cantidad: "1.00", monto: "450.00",
    metodo_pago: "Efectivo", numero_cuenta_pago: null, tiene_factura: 1,
    observaciones: null, activo: 1, creado_por: "admin", creado_en: "2026-09-01 10:00:00",
    actualizado_en: "2026-09-01 10:00:00",
    ...overrides,
  };
}

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — fila RAW que actualizarGasto relee
 * con `SELECT ... FOR UPDATE` dentro de la transacción (columnas propias
 * de tms_gastos_operativos, SIN los JOIN de empleado/vehículo/cliente/
 * plan que sí trae `filaGasto` — actualizarGasto no los necesita para la
 * fusión, solo los ids crudos).
 */
function filaGastoRaw(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, fecha_solicitud: "2026-09-01", fecha_viaje: "2026-09-02",
    empleado_id: 3, vehiculo_id: 5, cliente_id: 9, plan_id: 11,
    categoria: "Combustible", descripcion: "Diesel", cantidad: "1.00", monto: "450.00",
    metodo_pago: "Efectivo", numero_cuenta_pago: null,
    tiene_factura: 1, factura_nombre_original: null, observaciones: null, activo: 1,
    entidad_requirente_id: null, entidad_requirente_nombre: null,
    requirente_empleado_id: null, requirente_nombre: null, requirente_usuario_id: null,
    solicitante_usuario_id: null, solicitante_nombre: null,
    estado: null,
    ...overrides,
  };
}

/** GASTOS-ADMINISTRATIVO-1 (Fase 2) — fila mínima que autorizarGasto/rechazarGasto relee FOR UPDATE. */
describe("regresión requirente de Operaciones Gastos", () => {
  it.each(["Contabilidad", "Admin", "Gerencia"])("rechaza nuevo requirente %s sin escritura", async rol => {
    const c = conexion({ usuarioRol: rol });
    await expect(crearGasto(7, { fechaSolicitud: "2026-09-01", categoria: "Otros", monto: 10, requirenteUsuarioId: 9 })).rejects.toThrow("usuario de Operaciones");
    expect(c.execute).not.toHaveBeenCalled(); expect(c.rollback).toHaveBeenCalledOnce();
  });
  it.each([9, null])("preserva histórico %s fuera del catálogo al editar otros datos", async id => {
    const c = conexion({ actualRaw: filaGastoRaw({ requirente_usuario_id: id, requirente_nombre: "Anterior" }), usuarioRol: "Contabilidad" });
    vi.mocked(query).mockResolvedValue([filaGasto()] as never);
    await actualizarGasto(7, 1, { observaciones: "Otra edición", requirenteUsuarioId: id, requirenteNombre: "Anterior" });
    expect(c.query.mock.calls.some(([sql]) => String(sql).includes("FROM usuarios"))).toBe(false);
    expect(c.execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE tms_gastos_operativos"))?.[1]).toContain("Anterior");
  });
  it("cambiar histórico a usuario no Operaciones rechaza antes de escrituras", async () => {
    const c = conexion({ actualRaw: filaGastoRaw({ requirente_usuario_id: 8 }), usuarioRol: "Contabilidad" });
    await expect(actualizarGasto(7, 1, { requirenteUsuarioId: 9 })).rejects.toThrow("usuario de Operaciones");
    expect(c.execute).not.toHaveBeenCalled();
  });
});
function filaGastoBloqueo(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, estado: "Pendiente", requirente_usuario_id: null, solicitante_usuario_id: null, creado_por: "admin",
    ...overrides,
  };
}

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — mismo criterio de mock que
 * fondos.test.ts (conexion()): una `conn` falsa despachando por texto
 * SQL, para las funciones que ahora abren una transacción explícita
 * (crearGasto, actualizarGasto, autorizarGasto, rechazarGasto). Las
 * lecturas fuera de transacción (obtenerGasto/listarGastos, incluida la
 * relectura final tras el commit) siguen usando el `query()` plano — se
 * configuran aparte con `vi.mocked(query)`.
 */
function conexion(opts: {
  fallaEn?: string;
  empleadoEnEmpresa?: boolean; vehiculoEnEmpresa?: boolean; clienteEnEmpresa?: boolean; planEnEmpresa?: boolean;
  entidadRequirenteValida?: boolean; entidadRequirenteNombre?: string;
  usuarioEnEmpresa?: boolean; usuarioNombre?: string; usuarioRol?: string | null;
  actualRaw?: Record<string, unknown> | null;
  bloqueoRaw?: Record<string, unknown> | null;
  // GASTOS-MULTIPLES-LINEAS-1 — snapshot que devuelve resolverSnapshotLineaGastoTx
  // al resolver una línea (SELECT nombre/puesto/placa/cliente distintos a
  // los de validarReferenciasGastoTx, que solo pide `id`) — ADITIVO: las 4
  // condiciones de arriba (`FROM empleados` etc.) ya devolvían `{ id }`
  // solamente; ahora también devuelven estos campos, sin afectar ningún
  // test existente (ninguno inspecciona el contenido de esas filas, solo
  // si existen).
  lineaEmpleadoNombre?: string; lineaEmpleadoPuesto?: string | null;
  empleadoCuenta?: string; empleadoTelefono?: string;
  lineaVehiculoPlaca?: string;
  lineaClienteNombre?: string;
  lineaPlanClienteId?: number; lineaPlanClienteNombre?: string; lineaPlanFecha?: string;
  /**
   * GASTOS-MULTIPLES-LINEAS-1 (corrección post-revisión PR #262) — total
   * REAL de las líneas YA GUARDADAS de este gasto, tal como lo relee
   * sumaLineasGastoTx dentro de la transacción de actualizarGasto.
   * `undefined` (default) = el gasto NO tiene líneas existentes (0 filas
   * en tms_gasto_operativo_lineas) — mismo comportamiento que todos los
   * tests existentes, que nunca configuran líneas.
   */
  lineasExistentesTotal?: number;
} = {}) {
  const empleadoEnEmpresa = opts.empleadoEnEmpresa ?? true;
  const vehiculoEnEmpresa = opts.vehiculoEnEmpresa ?? true;
  const clienteEnEmpresa = opts.clienteEnEmpresa ?? true;
  const planEnEmpresa = opts.planEnEmpresa ?? true;
  const entidadRequirenteValida = opts.entidadRequirenteValida ?? true;
  const usuarioEnEmpresa = opts.usuarioEnEmpresa ?? true;
  const actualRaw = opts.actualRaw !== undefined ? opts.actualRaw : filaGastoRaw();
  const bloqueoRaw = opts.bloqueoRaw !== undefined ? opts.bloqueoRaw : filaGastoBloqueo();
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM tms_gastos_operativos") && sql.includes("DATE_FORMAT(fecha_solicitud")) {
        return [actualRaw ? [actualRaw] : []];
      }
      if (sql.includes("FROM tms_gastos_operativos") && sql.includes("FOR UPDATE")) {
        return [bloqueoRaw ? [bloqueoRaw] : []];
      }
      if (sql.includes("FROM cont_entidades")) {
        return [entidadRequirenteValida ? [{ id: 4, nombre: opts.entidadRequirenteNombre ?? "Kuiqtrans, S.A." }] : []];
      }
      if (sql.includes("FROM usuarios u")) {
        return [usuarioEnEmpresa ? [{ nombre: opts.usuarioNombre ?? "Mario Caal", rol_global: opts.usuarioRol ?? "Operaciones" }] : []];
      }
      if (sql.includes("FROM empleados")) {
        return [empleadoEnEmpresa ? [{ id: 3, nombre: opts.lineaEmpleadoNombre ?? "Juan Perez", puesto: opts.lineaEmpleadoPuesto ?? "Piloto", cuenta_bancaria: opts.empleadoCuenta, telefono: opts.empleadoTelefono }] : []];
      }
      if (sql.includes("FROM flota_vehiculos")) {
        return [vehiculoEnEmpresa ? [{ id: 5, placa: opts.lineaVehiculoPlaca ?? "P-123ABC" }] : []];
      }
      if (sql.includes("FROM tms_clientes")) {
        return [clienteEnEmpresa ? [{ id: 9, nombre: opts.lineaClienteNombre ?? "Cliente Acme" }] : []];
      }
      if (sql.includes("FROM tms_planes_viaje")) {
        return [planEnEmpresa ? [{ id: 11, cliente_id: opts.lineaPlanClienteId ?? 9, cliente_nombre: opts.lineaPlanClienteNombre ?? "Cliente Acme", fecha_plan: opts.lineaPlanFecha ?? "2026-09-02" }] : []];
      }
      if (sql.includes("FROM tms_gasto_operativo_lineas") && sql.includes("COUNT(*)")) {
        return opts.lineasExistentesTotal !== undefined
          ? [[{ n: 1, total: opts.lineasExistentesTotal }]]
          : [[{ n: 0, total: 0 }]];
      }
      return [[]];
    }),
    execute: vi.fn(async (...args: [string, ...unknown[]]) => {
      const sql = args[0];
      if (opts.fallaEn && sql.includes(opts.fallaEn)) throw new Error(`fallo:${opts.fallaEn}`);
      if (sql.includes("INSERT INTO tms_gastos_operativos")) return [{ insertId: 55, affectedRows: 1 }];
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

describe("catálogo de categorías", () => {
  it("incluye las categorías originales más las del Excel operativo real (GASTOS-OPERATIVOS-DETALLE-FORMATO-1); 'Otros' siempre al final", () => {
    expect(CATEGORIAS_GASTO).toEqual([
      "Combustible", "Hospedaje", "Parqueo", "Cuadrilla", "Auxiliar extra",
      "Mantenimiento", "Arbitrios", "Transporte",
      "Comida", "Aceite", "Medicamento", "Bonificación",
      "Reintegro de gastos",
      "Otros",
    ]);
  });

  /** GASTOS-COMPROBANTE-404-1 — catálogo COMPARTIDO con Fondos (ver fondos.test.ts y catalogos/route.ts). */
  it("incluye 'Bonificación' y 'Reintegro de gastos', requeridas también para Fondos", () => {
    expect(CATEGORIAS_GASTO).toContain("Bonificación");
    expect(CATEGORIAS_GASTO).toContain("Reintegro de gastos");
  });
});

describe("métodos de pago", () => {
  it("incluye Transferencia móvil sin retirar los métodos existentes", () => {
    expect(METODOS_PAGO_GASTO).toContain("Transferencia móvil");
    expect(METODOS_PAGO_GASTO).toEqual(expect.arrayContaining(["Efectivo", "Transferencia", "Tarjeta", "Cheque", "Otro"]));
  });
});

/** GASTOS-ADMINISTRATIVO-1 (Fase 2) — máquina de estados propia de Gastos, sin "Liquidada". */
describe("ESTADOS_GASTO", () => {
  it("solo Pendiente/Autorizada/Rechazada — sin Liquidada (un gasto ya es dinero incurrido)", () => {
    expect(ESTADOS_GASTO).toEqual(["Pendiente", "Autorizada", "Rechazada"]);
  });
});

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 1 — SOLO lectura/mapeo) — mismos conceptos
 * administrativos que Fondos (requirente/solicitante/autorizante/estado),
 * pero cada gasto es su propia unidad (sin encabezado/líneas). Estas
 * columnas todavía no las escribe crearGasto/actualizarGasto en esta
 * fase — aquí solo se prueba que `mapRow` las lee correctamente.
 */
describe("campos administrativos: mapeo (GASTOS-ADMINISTRATIVO-1, Fase 1)", () => {
  it("histórico/legado: ausentes en la fila -> se mapean a null (nunca a 'Pendiente' ni a un valor inventado)", async () => {
    vi.mocked(query).mockResolvedValue([filaGasto()] as never);
    const g = await obtenerGasto(7, 1);
    expect(g).toMatchObject<Partial<GastoOperativo>>({
      entidadRequirenteId: null, entidadRequirenteNombre: null,
      requirenteEmpleadoId: null, requirenteNombre: null, requirenteUsuarioId: null,
      solicitanteUsuarioId: null, solicitanteNombre: null,
      autorizanteEmpleadoId: null, autorizanteNombre: null, autorizanteUsuarioId: null,
      estado: null, autorizadoEn: null, rechazadoEn: null, motivoRechazo: null,
    });
  });

  it("mapea correctamente cuando la fila SÍ trae los 14 campos administrativos", async () => {
    vi.mocked(query).mockResolvedValue([filaGasto({
      entidad_requirente_id: 4, entidad_requirente_nombre: "Kuiqtrans, S.A.",
      requirente_empleado_id: 3, requirente_nombre: "Juan Perez", requirente_usuario_id: 12,
      solicitante_usuario_id: 5, solicitante_nombre: "Mario Caal",
      autorizante_empleado_id: 8, autorizante_nombre: "Heber Sitan", autorizante_usuario_id: 9,
      estado: "Autorizada", autorizado_en: "2026-09-05 10:00:00", rechazado_en: null, motivo_rechazo: null,
    })] as never);
    const g = await obtenerGasto(7, 1);
    expect(g).toMatchObject<Partial<GastoOperativo>>({
      entidadRequirenteId: 4, entidadRequirenteNombre: "Kuiqtrans, S.A.",
      requirenteEmpleadoId: 3, requirenteNombre: "Juan Perez", requirenteUsuarioId: 12,
      solicitanteUsuarioId: 5, solicitanteNombre: "Mario Caal",
      autorizanteEmpleadoId: 8, autorizanteNombre: "Heber Sitan", autorizanteUsuarioId: 9,
      estado: "Autorizada",
    });
    expect(g?.autorizadoEn).toContain("2026-09-05");
  });

  it("rechazado: motivo_rechazo y rechazado_en se mapean cuando el estado es Rechazada", async () => {
    vi.mocked(query).mockResolvedValue([filaGasto({
      estado: "Rechazada", rechazado_en: "2026-09-06 08:00:00", motivo_rechazo: "Factura ilegible",
    })] as never);
    const g = await obtenerGasto(7, 1);
    expect(g?.estado).toBe("Rechazada");
    expect(g?.motivoRechazo).toBe("Factura ilegible");
    expect(g?.rechazadoEn).toContain("2026-09-06");
  });
});

/**
 * FONDOS-GASTOS-METODO-PAGO-1 — normalizarDestinoPago es la ÚNICA puerta
 * de validación/normalización del destino de pago, reutilizada por
 * Gastos y Fondos (fondos.ts la importa de aquí).
 */
describe("normalizarDestinoPago", () => {
  it("métodos distintos a Transferencia móvil: opcional, solo trim (sin cambio de comportamiento previo)", () => {
    expect(normalizarDestinoPago("Efectivo", "  Caja chica  ")).toBe("Caja chica");
    expect(normalizarDestinoPago("Efectivo", "")).toBeNull();
    expect(normalizarDestinoPago(null, null)).toBeNull();
    expect(normalizarDestinoPago(undefined, undefined)).toBeNull();
  });

  it("Transferencia móvil: vacío se rechaza", () => {
    expect(() => normalizarDestinoPago("Transferencia móvil", "")).toThrow("Ingresa el número");
    expect(() => normalizarDestinoPago("Transferencia móvil", null)).toThrow("Ingresa el número");
  });

  it("Transferencia móvil: acepta espacios/guiones y los normaliza (los quita) antes de guardar", () => {
    expect(normalizarDestinoPago("Transferencia móvil", "5555 1234")).toBe("55551234");
    expect(normalizarDestinoPago("Transferencia móvil", "5555-1234")).toBe("55551234");
    expect(normalizarDestinoPago("Transferencia móvil", "+502 5555-1234")).toBe("+50255551234");
  });

  it("Transferencia móvil: el '+' solo se acepta al inicio", () => {
    expect(() => normalizarDestinoPago("Transferencia móvil", "5555+1234")).toThrow("8 y 15 dígitos");
    expect(() => normalizarDestinoPago("Transferencia móvil", "5555123+")).toThrow("8 y 15 dígitos");
  });

  it("Transferencia móvil: exige 8-15 dígitos reales, sin contar el '+'", () => {
    expect(() => normalizarDestinoPago("Transferencia móvil", "1234567")).toThrow("8 y 15 dígitos"); // 7 dígitos
    expect(normalizarDestinoPago("Transferencia móvil", "12345678")).toBe("12345678"); // 8 dígitos, límite inferior
    expect(normalizarDestinoPago("Transferencia móvil", "+123456789012345")).toBe("+123456789012345"); // 15 dígitos + "+", límite superior
    expect(() => normalizarDestinoPago("Transferencia móvil", "+1234567890123456")).toThrow("8 y 15 dígitos"); // 16 dígitos
  });

  it("Transferencia móvil: rechaza letras u otros caracteres no numéricos", () => {
    expect(() => normalizarDestinoPago("Transferencia móvil", "5555abc4")).toThrow("8 y 15 dígitos");
  });
});

describe("listarGastos", () => {
  it("mapea filas y aplica filtro de activos por defecto", async () => {
    vi.mocked(query).mockResolvedValue([filaGasto()] as never);
    const [g] = await listarGastos(7);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("g.activo = 1");
    expect(g).toMatchObject<Partial<GastoOperativo>>({
      id: 1, empresaId: 7, categoria: "Combustible", monto: 450, cantidad: 1,
      tieneFactura: true, empleadoNombre: "Juan Perez", vehiculoPlaca: "P-123ABC",
      clienteNombre: "Cliente Acme", planCodigo: "PLAN-20260901-001",
    });
  });

  it("AISLAMIENTO MULTIEMPRESA: los JOIN de empleado/vehiculo/cliente/plan exigen empresa_id igual, no solo el id (bloqueo 1, revisión PR #204)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarGastos(7);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("emp.id = g.empleado_id AND emp.empresa_id = g.empresa_id");
    expect(sql).toContain("veh.id = g.vehiculo_id AND veh.empresa_id = g.empresa_id");
    expect(sql).toContain("cli.id = g.cliente_id AND cli.empresa_id = g.empresa_id");
    expect(sql).toContain("plan.id = g.plan_id AND plan.empresa_id = g.empresa_id");
  });

  it("incluirInactivos evita el filtro de activo", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarGastos(7, { incluirInactivos: true });
    expect(vi.mocked(query).mock.calls[0][0]).not.toContain("g.activo = 1");
  });

  it("aplica filtros de fecha/categoria/cliente/vehiculo/plan/empleado", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarGastos(7, {
      fechaDesde: "2026-01-01", fechaHasta: "2026-01-31", categoria: "Hospedaje",
      clienteId: 2, vehiculoId: 3, planId: 4, empleadoId: 5,
    });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("g.categoria = ?");
    expect(params).toEqual([7, "2026-01-01", "2026-01-31", "Hospedaje", 2, 3, 4, 5]);
  });
});

describe("obtenerGasto", () => {
  it("devuelve null si no existe", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await obtenerGasto(7, 999)).toBeNull();
  });
});

describe("crearGasto", () => {
  it("rechaza monto <= 0, sin abrir conexión", async () => {
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 0,
    })).rejects.toThrow("mayor a cero");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("rechaza sin categoría", async () => {
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "", monto: 10,
    })).rejects.toThrow("Categoría");
  });

  it("inserta y devuelve el gasto creado; estado queda 'Pendiente' hardcodeado en el INSERT", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
    const g = await crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 450,
    }, "admin");
    expect(g.id).toBe(55);
    const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_gastos_operativos"))!;
    expect(String(insert[0])).toContain("'Pendiente'");
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  describe("FONDOS-GASTOS-METODO-PAGO-1: Transferencia móvil", () => {
    it.each([["Transferencia", "001234"], ["Transferencia móvil", "55551234"]])("resuelve %s desde RRHH en la empresa", async (metodoPago, destino) => {
      const conn = conexion({ empleadoCuenta: "001234", empleadoTelefono: "55551234" });
      vi.mocked(query).mockResolvedValue([filaGasto()] as never);
      await crearGasto(7, { fechaSolicitud: "2026-09-01", categoria: "Otros", monto: 100, empleadoId: 3, metodoPago });
      const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_gastos_operativos"))!;
      expect(insert[1]).toContain(destino);
      const lectura = conn.query.mock.calls.find((c) => c[0].includes("SELECT cuenta_bancaria, telefono"))!;
      expect(lectura[0]).toContain("empresa_id = ?");
    });
    it("rechaza crear sin número cuando el método es Transferencia móvil, sin abrir conexión", async () => {
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, metodoPago: "Transferencia móvil",
      })).rejects.toThrow("Ingresa el número");
      expect(getPool).not.toHaveBeenCalled();
    });

    it("normaliza el número (quita espacios/guiones) antes de insertar", async () => {
      const conn = conexion();
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55, metodo_pago: "Transferencia móvil", numero_cuenta_pago: "55551234" })] as never);
      await crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100,
        metodoPago: "Transferencia móvil", numeroCuentaPago: "5555-1234",
      });
      const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_gastos_operativos"))!;
      expect(insert[1]).toContain("55551234");
    });
  });

  describe("AISLAMIENTO MULTIEMPRESA: rechaza referencias que no pertenecen a la empresa actual (bloqueo 1, revisión PR #204)", () => {
    it("empleado de otra empresa (id existe, pero no en esta empresa) se rechaza sin insertar, con rollback", async () => {
      const conn = conexion({ empleadoEnEmpresa: false });
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, empleadoId: 999,
      })).rejects.toThrow("El empleado indicado no pertenece a esta empresa.");
      expect(conn.rollback).toHaveBeenCalledOnce();
      expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("INSERT"))).toBe(false);
    });

    it("vehiculo de otra empresa se rechaza", async () => {
      conexion({ vehiculoEnEmpresa: false });
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, vehiculoId: 999,
      })).rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
    });

    it("cliente de otra empresa se rechaza", async () => {
      conexion({ clienteEnEmpresa: false });
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, clienteId: 999,
      })).rejects.toThrow("El cliente indicado no pertenece a esta empresa.");
    });

    it("plan/viaje de otra empresa se rechaza", async () => {
      conexion({ planEnEmpresa: false });
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, planId: 999,
      })).rejects.toThrow("El viaje/plan indicado no pertenece a esta empresa.");
    });

    it("con id válido de la MISMA empresa, sí inserta (no bloquea referencias legítimas)", async () => {
      const conn = conexion();
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
      const g = await crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, empleadoId: 3,
      });
      expect(g.id).toBe(55);
      expect(conn.commit).toHaveBeenCalledOnce();
    });
  });

  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 2, decisión #1) — TODOS opcionales: sin
   * ninguno de estos campos, crearGasto funciona exactamente igual que
   * antes de esta fase (no rompe la UI actual, que todavía no los envía).
   */
  describe("campos administrativos (GASTOS-ADMINISTRATIVO-1, Fase 2)", () => {
    it("sin entidad/requirente/solicitante: crea igual que antes, todos quedan NULL", async () => {
      const conn = conexion();
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
      await crearGasto(7, { fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100 });
      const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_gastos_operativos"))!;
      const params = insert[1] as unknown[];
      // entidad_requirente_id/nombre, requirente_empleado_id/nombre/usuario_id, solicitante_usuario_id/nombre
      expect(params.slice(-7)).toEqual([null, null, null, null, null, null, null]);
      expect(conn.commit).toHaveBeenCalledOnce();
    });

    it("con entidadRequirenteId: se resuelve y congela como snapshot contra cont_entidades", async () => {
      const conn = conexion({ entidadRequirenteNombre: "Kuiqtrans, S.A." });
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
      await crearGasto(7, { fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, entidadRequirenteId: 4 });
      const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_gastos_operativos"))!;
      expect(insert[1]).toEqual(expect.arrayContaining([4, "Kuiqtrans, S.A."]));
    });

    it("entidadRequirenteId inválida (no pertenece/no activa/código fuera de KT-MONACO) se rechaza, con rollback", async () => {
      const conn = conexion({ entidadRequirenteValida: false });
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, entidadRequirenteId: 999,
      })).rejects.toThrow("La empresa requirente no es válida");
      expect(conn.rollback).toHaveBeenCalledOnce();
    });

    it("con requirenteUsuarioId: el nombre resuelto por el servidor manda sobre requirenteNombre libre", async () => {
      const conn = conexion({ usuarioNombre: "Wilter Flores" });
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
      await crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100,
        requirenteUsuarioId: 12, requirenteNombre: "Nombre que el cliente intentó forzar",
      });
      const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_gastos_operativos"))!;
      expect(insert[1]).toContain("Wilter Flores");
      expect(insert[1]).not.toContain("Nombre que el cliente intentó forzar");
    });

    it("requirenteUsuarioId que no pertenece a la empresa se rechaza", async () => {
      conexion({ usuarioEnEmpresa: false });
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, requirenteUsuarioId: 999,
      })).rejects.toThrow("La persona que requiere debe ser un usuario de Operaciones.");
    });

    it("solicitanteUsuarioId sin rol de Operaciones se rechaza (resolverSolicitanteOperacionesTx)", async () => {
      conexion({ usuarioRol: "Contabilidad" });
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, solicitanteUsuarioId: 6,
      })).rejects.toThrow("El usuario solicitante indicado no pertenece a esta empresa.");
    });

    it("solicitanteUsuarioId con rol de Operaciones válido se congela como snapshot", async () => {
      const conn = conexion({ usuarioNombre: "Mario Caal", usuarioRol: "Operaciones" });
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
      await crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, solicitanteUsuarioId: 5,
      });
      const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_gastos_operativos"))!;
      expect(insert[1]).toEqual(expect.arrayContaining([5, "Mario Caal"]));
    });
  });

  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 5) — mismo criterio EXACTO que
   * crearSolicitudFondo en fondos.test.ts: firma BEST-EFFORT del
   * solicitante/requirente (nunca bloquea la creación por falta de "Mi
   * firma"), modulo='GASTOS'/entidadTipo='GASTO_OPERATIVO'.
   */
  describe("captura de firma del solicitante/requirente (Fase 5, best-effort)", () => {
    it("guarda el snapshot del SOLICITANTE al crear (nombre real + firma de 'Mi firma')", async () => {
      const conn = conexion({ usuarioNombre: "Mario Caal", usuarioRol: "Operaciones" });
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
      await crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, solicitanteUsuarioId: 5,
      });
      expect(leerBytesFirmaGuardada).toHaveBeenCalledWith(5);
      expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
        empresaId: 7, usuarioId: 5, nombreFirmante: "Mario Caal",
        accion: "SOLICITAR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO", entidadId: 55,
        metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
      }));
    });

    it("solicitante SIN firma guardada: el gasto se crea igual, sin bloquear ni inventar una firma", async () => {
      const conn = conexion({ usuarioNombre: "Mario Caal", usuarioRol: "Operaciones" });
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(null);
      await crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, solicitanteUsuarioId: 5,
      });
      expect(conn.commit).toHaveBeenCalledOnce();
      expect(crearFirmaInterna).not.toHaveBeenCalled();
    });

    it("requirente asociado a un usuario del catálogo: resuelve su nombre real y captura su firma", async () => {
      conexion({ usuarioNombre: "Ana Gómez", usuarioRol: "GerenteOperaciones" });
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
      await crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, requirenteUsuarioId: 30,
      });
      expect(crearFirmaInterna).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        usuarioId: 30, nombreFirmante: "Ana Gómez", accion: "REQUERIR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO",
      }));
    });

    it("texto libre nuevo rechazado sin escrituras ni captura de firma", async () => {
      const conn = conexion();
      vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, requirenteNombre: "Juan Pérez (texto libre)",
      })).rejects.toThrow("La persona que requiere debe ser un usuario de Operaciones.");
      expect(leerBytesFirmaGuardada).not.toHaveBeenCalled();
      expect(crearFirmaInterna).not.toHaveBeenCalled();
      expect(conn.execute).not.toHaveBeenCalled();
    });

    it("si falla la transacción después de guardar las firmas, se compensan (borran) los archivos escritos", async () => {
      // Falla DESPUÉS de la captura de firmas (que ocurre luego del
      // INSERT principal), en la auditoría — así el archivo de firma ya
      // se escribió a disco cuando el rollback ocurre.
      conexion({ usuarioNombre: "Mario Caal", usuarioRol: "Operaciones", fallaEn: "INSERT INTO auditoria" });
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, solicitanteUsuarioId: 5,
      })).rejects.toThrow();
      expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
    });
  });
});

/**
 * GASTOS-MULTIPLES-LINEAS-1 — decisión #1 (caché cantidad=1/monto=SUM en
 * cabecera) + decisión #2 (array vacío = error de validación) + decisión
 * #3 (sin overrides de texto, diferidos).
 */
describe("GASTOS-MULTIPLES-LINEAS-1 — crearGasto con líneas", () => {
  it("lineas: [] se rechaza como error de validación, sin abrir conexión (decisión #2)", async () => {
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible", lineas: [],
    })).rejects.toThrow("al menos una");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("una línea sin categoría se rechaza, sin abrir conexión", async () => {
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible",
      lineas: [{ categoria: "", monto: 100 }],
    })).rejects.toThrow("Cada línea necesita una categoría.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("una línea con monto <= 0 se rechaza, sin abrir conexión", async () => {
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible",
      lineas: [{ categoria: "Peaje", monto: 0 }],
    })).rejects.toThrow("Cada línea necesita un monto mayor a cero.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("categoría de cabecera sigue siendo requerida aunque haya líneas (decisión #1: solo cantidad/monto se derivan)", async () => {
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "",
      lineas: [{ categoria: "Peaje", monto: 100 }],
    })).rejects.toThrow("Categoría");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("NO exige `monto` de cabecera cuando hay líneas (a diferencia del modo sin líneas)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
    await crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible",
      lineas: [{ categoria: "Peaje", monto: 100 }],
    });
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("inserta la cabecera con cantidad=1 y monto=SUM(líneas) — caché sincronizada (decisión #1)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
    await crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible",
      lineas: [
        { categoria: "Combustible", monto: 300 },
        { categoria: "Peaje", cantidad: 2, monto: 25 },
      ],
    });
    const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_gastos_operativos"))!;
    const params = insert[1] as unknown[];
    expect(params[9]).toBe(1); // cantidad de cabecera
    expect(params[10]).toBe(350); // monto de cabecera = 300 + (2 * 25)
  });

  it("inserta cada línea con orden incremental y su propio snapshot (empleado/vehículo/cliente resueltos en servidor)", async () => {
    const conn = conexion({ lineaEmpleadoNombre: "Ana Gómez", lineaEmpleadoPuesto: "Auxiliar", lineaVehiculoPlaca: "P-999ZZZ", lineaClienteNombre: "Cliente Beta" });
    vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
    await crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible",
      lineas: [
        { categoria: "Combustible", monto: 300, empleadoId: 3 },
        { categoria: "Peaje", monto: 25, vehiculoId: 5, clienteId: 9 },
      ],
    });
    const inserts = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_gasto_operativo_lineas"));
    expect(inserts).toHaveLength(2);
    const [primera, segunda] = inserts.map((c) => c[1] as unknown[]);
    // [empresaId, gastoId, categoria, descripcion, cantidad, monto, metodoPago, numeroCuentaPago, orden, fechaViaje, empleadoId, empleadoNombre, cargo, vehiculoId, placa, clienteId, clienteNombre, planId]
    expect(primera[0]).toBe(7); expect(primera[1]).toBe(55);
    expect(primera[2]).toBe("Combustible"); expect(primera[5]).toBe(300); expect(primera[8]).toBe(0);
    expect(primera[10]).toBe(3); expect(primera[11]).toBe("Ana Gómez"); expect(primera[12]).toBe("Auxiliar");
    expect(segunda[2]).toBe("Peaje"); expect(segunda[5]).toBe(25); expect(segunda[8]).toBe(1);
    expect(segunda[14]).toBe("P-999ZZZ"); expect(segunda[15]).toBe(9); expect(segunda[16]).toBe("Cliente Beta");
  });

  it("línea con empleado de otra empresa se rechaza, con rollback (mismo criterio que la cabecera)", async () => {
    const conn = conexion({ empleadoEnEmpresa: false });
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible",
      lineas: [{ categoria: "Combustible", monto: 100, empleadoId: 999 }],
    })).rejects.toThrow("El empleado indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("si falla la inserción de una línea, se revierte también la cabecera (transacción atómica)", async () => {
    const conn = conexion({ fallaEn: "INSERT INTO tms_gasto_operativo_lineas" });
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible",
      lineas: [{ categoria: "Combustible", monto: 100 }],
    })).rejects.toThrow();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("sin líneas (undefined): comportamiento idéntico al de antes de este ticket, sin filas nuevas en tms_gasto_operativo_lineas", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
    await crearGasto(7, { fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 450 });
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("INSERT INTO tms_gasto_operativo_lineas"))).toBe(false);
  });
});

describe("actualizarGasto / desactivarGasto", () => {
  it("devuelve null si el gasto no existe (rollback, sin UPDATE)", async () => {
    const conn = conexion({ actualRaw: null });
    expect(await actualizarGasto(7, 999, { monto: 100 })).toBeNull();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("preserva campos no enviados y aplica los enviados", async () => {
    conexion();
    vi.mocked(query).mockResolvedValue([filaGasto({ monto: "999.00" })] as never);
    const g = await actualizarGasto(7, 1, { monto: 999 });
    expect(g?.monto).toBe(999);
  });

  it("no permite guardar tiene_factura=0 mientras existe comprobante almacenado", async () => {
    const conn = conexion({ actualRaw: filaGastoRaw({ factura_nombre_original: "factura.pdf" }) });
    vi.mocked(query).mockResolvedValue([filaGasto({ factura_nombre_original: "factura.pdf", tiene_factura: 1 })] as never);
    await actualizarGasto(7, 1, { tieneFactura: false });
    const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos SET"))!;
    const params = update[1] as unknown[];
    expect(params[12]).toBe(1); // posición de tiene_factura en el UPDATE, sin cambios desde antes de esta fase
  });

  it("desactivarGasto pone activo=false sin tocar el resto", async () => {
    conexion();
    vi.mocked(query).mockResolvedValue([filaGasto({ activo: 0 })] as never);
    const g = await desactivarGasto(7, 1);
    expect(g?.activo).toBe(false);
  });

  it("AISLAMIENTO MULTIEMPRESA: rechaza reasignar el gasto a un vehiculo de otra empresa, con rollback", async () => {
    const conn = conexion({ vehiculoEnEmpresa: false });
    await expect(actualizarGasto(7, 1, { vehiculoId: 999 })).rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE"))).toBe(false);
  });

  describe("FONDOS-GASTOS-METODO-PAGO-1: valida sobre el valor FUSIONADO (actual + cambios)", () => {
    it("rechaza cambiar el método a Transferencia móvil si no queda un número (ni en cambios ni en el registro actual)", async () => {
      const conn = conexion({ actualRaw: filaGastoRaw({ metodo_pago: "Efectivo", numero_cuenta_pago: null }) });
      await expect(actualizarGasto(7, 1, { metodoPago: "Transferencia móvil" })).rejects.toThrow("Ingresa el número");
      expect(conn.rollback).toHaveBeenCalledOnce();
    });

    it("cambiar método reemplaza destino anterior por teléfono vigente RRHH", async () => {
      const conn = conexion({ empleadoTelefono: "55559876", actualRaw: filaGastoRaw({ metodo_pago: "Transferencia", numero_cuenta_pago: "001234" }) });
      vi.mocked(query).mockResolvedValue([filaGasto({ metodo_pago: "Transferencia móvil", numero_cuenta_pago: "55551234" })] as never);
      await actualizarGasto(7, 1, { metodoPago: "Transferencia móvil" });
      const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos"))!;
      expect(update[1]).toContain("55559876");
      expect(update[1]).not.toContain("001234");
    });
  });

  it("no re-valida referencias que no cambiaron (solo valida lo que viene en `cambios`)", async () => {
    // Solo se envía `monto` — ninguna referencia debería re-validarse; si
    // se re-validara, el mock de empleados/vehículos/clientes/planes no
    // está configurado para esas SQL y devolvería [] -> rechazaría.
    conexion();
    vi.mocked(query).mockResolvedValue([filaGasto({ monto: "999.00" })] as never);
    const g = await actualizarGasto(7, 1, { monto: 999 });
    expect(g?.monto).toBe(999);
  });

  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 2, decisión #2) — bloqueo de contenido
   * una vez Autorizada/Rechazada; `activo` queda exento (baja lógica).
   */
  describe("bloqueo de edición cuando Autorizada/Rechazada (decisión #2)", () => {
    it.each(["Autorizada", "Rechazada"] as const)("rechaza editar contenido de un gasto %s, con rollback", async (estado) => {
      const conn = conexion({ actualRaw: filaGastoRaw({ estado }) });
      await expect(actualizarGasto(7, 1, { monto: 999 })).rejects.toThrow(`No se puede editar el contenido de un gasto en estado "${estado}"`);
      expect(conn.rollback).toHaveBeenCalledOnce();
      expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE"))).toBe(false);
    });

    it.each(["Autorizada", "Rechazada"] as const)("permite desactivar (activo=false) un gasto %s — excepción aprobada", async (estado) => {
      const conn = conexion({ actualRaw: filaGastoRaw({ estado }) });
      vi.mocked(query).mockResolvedValue([filaGasto({ estado, activo: 0 })] as never);
      const g = await desactivarGasto(7, 1);
      expect(g?.activo).toBe(false);
      expect(conn.commit).toHaveBeenCalledOnce();
    });

    it("un histórico (estado NULL) sigue editable sin restricción nueva", async () => {
      const conn = conexion({ actualRaw: filaGastoRaw({ estado: null }) });
      vi.mocked(query).mockResolvedValue([filaGasto({ monto: "999.00" })] as never);
      await actualizarGasto(7, 1, { monto: 999 });
      expect(conn.commit).toHaveBeenCalledOnce();
    });

    it("un Pendiente sigue editable sin restricción nueva", async () => {
      const conn = conexion({ actualRaw: filaGastoRaw({ estado: "Pendiente" }) });
      vi.mocked(query).mockResolvedValue([filaGasto({ monto: "999.00" })] as never);
      await actualizarGasto(7, 1, { monto: 999 });
      expect(conn.commit).toHaveBeenCalledOnce();
    });
  });

  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 5) — mismo criterio EXACTO que
   * actualizarSolicitudFondo en fondos.test.ts: una nueva firma snapshot
   * se captura SOLO si el usuario requirente/solicitante REALMENTE
   * cambió en esta edición (nunca se re-firma en cada edición no
   * relacionada); best-effort, nunca bloquea.
   */
  describe("captura de firma al cambiar requirente/solicitante (Fase 5, best-effort)", () => {
    it("cambia solicitanteUsuarioId -> captura snapshot SOLICITAR_GASTO si tiene 'Mi firma'", async () => {
      const conn = conexion({
        actualRaw: filaGastoRaw({ estado: "Pendiente", solicitante_usuario_id: null }),
        usuarioNombre: "Mario Caal", usuarioRol: "Operaciones",
      });
      vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Pendiente" })] as never);
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
      await actualizarGasto(7, 1, { solicitanteUsuarioId: 5 });
      expect(leerBytesFirmaGuardada).toHaveBeenCalledWith(5);
      expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
        empresaId: 7, usuarioId: 5, nombreFirmante: "Mario Caal",
        accion: "SOLICITAR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO", entidadId: 1,
      }));
    });

    it("cambia requirenteUsuarioId -> captura snapshot REQUERIR_GASTO si tiene 'Mi firma'", async () => {
      const conn = conexion({
        actualRaw: filaGastoRaw({ estado: "Pendiente", requirente_usuario_id: null }),
        usuarioNombre: "Ana Gómez", usuarioRol: "GerenteOperaciones",
      });
      vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Pendiente" })] as never);
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
      await actualizarGasto(7, 1, { requirenteUsuarioId: 30 });
      expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
        usuarioId: 30, nombreFirmante: "Ana Gómez", accion: "REQUERIR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO",
      }));
    });

    it("mismo solicitanteUsuarioId ya guardado (sin cambio real): NO vuelve a firmar", async () => {
      conexion({ actualRaw: filaGastoRaw({ estado: "Pendiente", solicitante_usuario_id: 5 }), usuarioNombre: "Mario Caal", usuarioRol: "Operaciones" });
      vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Pendiente" })] as never);
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
      await actualizarGasto(7, 1, { solicitanteUsuarioId: 5 });
      expect(crearFirmaInterna).not.toHaveBeenCalled();
    });

    it("edita otro campo sin tocar requirente/solicitante: no dispara ninguna firma", async () => {
      conexion({ actualRaw: filaGastoRaw({ estado: "Pendiente" }) });
      vi.mocked(query).mockResolvedValue([filaGasto({ monto: "999.00" })] as never);
      await actualizarGasto(7, 1, { monto: 999 });
      expect(leerBytesFirmaGuardada).not.toHaveBeenCalled();
      expect(crearFirmaInterna).not.toHaveBeenCalled();
    });

    it("solicitante SIN 'Mi firma': la edición se guarda igual, sin bloquear ni inventar una firma", async () => {
      const conn = conexion({
        actualRaw: filaGastoRaw({ estado: "Pendiente", solicitante_usuario_id: null }),
        usuarioNombre: "Mario Caal", usuarioRol: "Operaciones",
      });
      vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Pendiente" })] as never);
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(null);
      await actualizarGasto(7, 1, { solicitanteUsuarioId: 5 });
      expect(conn.commit).toHaveBeenCalledOnce();
      expect(crearFirmaInterna).not.toHaveBeenCalled();
    });

    it("si falla la transacción después de guardar la firma, se compensa (borra) el archivo escrito", async () => {
      conexion({
        actualRaw: filaGastoRaw({ estado: "Pendiente", solicitante_usuario_id: null }),
        usuarioNombre: "Mario Caal", usuarioRol: "Operaciones",
        fallaEn: "INSERT INTO auditoria",
      });
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
      await expect(actualizarGasto(7, 1, { solicitanteUsuarioId: 5 })).rejects.toThrow();
      expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
    });
  });
});

/**
 * GASTOS-MULTIPLES-LINEAS-1 — semántica de PATCH (decisión #2, aprobada):
 * `lineas` ausente = no modificar líneas; con elementos = reemplazo total
 * transaccional; `lineas: []` = error de validación (nunca "borrar
 * silenciosamente"). El bloqueo de contenido existente (Autorizada/
 * Rechazada) se extiende automáticamente a `lineas` — es "otro campo de
 * contenido" para `soloActivo` en actualizarGasto, sin código nuevo.
 */
describe("GASTOS-MULTIPLES-LINEAS-1 — actualizarGasto con líneas", () => {
  it("lineas: [] se rechaza como error de validación, con rollback (decisión #2 — nunca borra silenciosamente)", async () => {
    const conn = conexion();
    await expect(actualizarGasto(7, 1, { lineas: [] })).rejects.toThrow("al menos una");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("DELETE FROM tms_gasto_operativo_lineas"))).toBe(false);
  });

  it("lineas undefined: no toca la tabla de líneas (comportamiento idéntico al de antes de este ticket)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaGasto({ monto: "999.00" })] as never);
    const g = await actualizarGasto(7, 1, { monto: 999 });
    expect(g?.monto).toBe(999);
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("tms_gasto_operativo_lineas"))).toBe(false);
  });

  it("reemplaza TODAS las líneas: DELETE + INSERT con snapshot nuevo, cantidad=1/monto=SUM recalculado", async () => {
    const conn = conexion({ lineaEmpleadoNombre: "Ana Gómez", lineaEmpleadoPuesto: "Auxiliar" });
    vi.mocked(query).mockResolvedValue([filaGasto({ monto: "375.00" })] as never);
    await actualizarGasto(7, 1, {
      lineas: [
        { categoria: "Combustible", monto: 350 },
        { categoria: "Peaje", monto: 25, empleadoId: 3 },
      ],
    });
    const del = conn.execute.mock.calls.find((c) => String(c[0]).includes("DELETE FROM tms_gasto_operativo_lineas"))!;
    expect(del[1]).toEqual([7, 1]);
    const inserts = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_gasto_operativo_lineas"));
    expect(inserts).toHaveLength(2);
    const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos SET"))!;
    const params = update[1] as unknown[];
    expect(params[8]).toBe(1); // cantidad de cabecera (posición del UPDATE, ver actualizarGasto)
    expect(params[9]).toBe(375); // monto de cabecera = 350 + 25
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("el DELETE se ejecuta ANTES de los INSERT nuevos (reemplazo total, nunca una mezcla de líneas viejas y nuevas)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaGasto({ monto: "100.00" })] as never);
    await actualizarGasto(7, 1, { lineas: [{ categoria: "Combustible", monto: 100 }] });
    const orden = conn.execute.mock.calls
      .map((c) => String(c[0]))
      .filter((sql) => sql.includes("tms_gasto_operativo_lineas"));
    expect(orden[0]).toContain("DELETE FROM");
    expect(orden[1]).toContain("INSERT INTO");
  });

  it.each(["Autorizada", "Rechazada"] as const)("rechaza reemplazar líneas de un gasto %s — mismo bloqueo de contenido que cualquier otro campo", async (estado) => {
    const conn = conexion({ actualRaw: filaGastoRaw({ estado }) });
    await expect(actualizarGasto(7, 1, { lineas: [{ categoria: "Combustible", monto: 100 }] }))
      .rejects.toThrow(`No se puede editar el contenido de un gasto en estado "${estado}"`);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("DELETE FROM tms_gasto_operativo_lineas") || String(c[0]).includes("INSERT INTO tms_gasto_operativo_lineas"))).toBe(false);
  });

  it("una línea inválida en el reemplazo (sin categoría) se rechaza, con rollback, sin tocar la tabla de líneas", async () => {
    const conn = conexion();
    await expect(actualizarGasto(7, 1, { lineas: [{ categoria: "", monto: 100 }] })).rejects.toThrow("Cada línea necesita una categoría.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("tms_gasto_operativo_lineas"))).toBe(false);
  });

  it("línea con vehículo de otra empresa en el reemplazo se rechaza, con rollback", async () => {
    const conn = conexion({ vehiculoEnEmpresa: false });
    await expect(actualizarGasto(7, 1, { lineas: [{ categoria: "Combustible", monto: 100, vehiculoId: 999 }] }))
      .rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  /**
   * GASTOS-MULTIPLES-LINEAS-1 (corrección post-revisión PR #262) —
   * `cantidad`/`monto` de cabecera son una CACHÉ DERIVADA cuando el gasto
   * YA TIENE líneas guardadas: un PATCH que no envía `lineas` NUNCA puede
   * desincronizarla, ni siquiera si envía `monto`/`cantidad` explícitos
   * (protección de DOMINIO en gastos.ts, no de la ruta/UI — la ruta sigue
   * aceptando esos campos en el schema, pero gastos.ts los ignora aquí).
   * El total real se RELEE (`sumaLineasGastoTx`, `FOR UPDATE`) dentro de
   * la misma transacción — nunca se confía en `actual.monto` cacheado.
   */
  describe("protección de la caché derivada — gasto multi-línea existente (corrección post-revisión PR #262)", () => {
    it("PATCH { monto } sobre un gasto multi-línea existente: se IGNORA, se conserva el total real de las líneas", async () => {
      const conn = conexion({ lineasExistentesTotal: 350 });
      vi.mocked(query).mockResolvedValue([filaGasto({ cantidad: "1.00", monto: "350.00" })] as never);
      await actualizarGasto(7, 1, { monto: 999999 });
      const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos SET"))!;
      const params = update[1] as unknown[];
      expect(params[8]).toBe(1); // cantidad — nunca se toca
      expect(params[9]).toBe(350); // monto — el total REAL de las líneas, nunca 999999
      expect(conn.commit).toHaveBeenCalledOnce();
    });

    it("PATCH { cantidad } sobre un gasto multi-línea existente: se IGNORA, cantidad de cabecera sigue en 1", async () => {
      const conn = conexion({ lineasExistentesTotal: 350 });
      vi.mocked(query).mockResolvedValue([filaGasto({ cantidad: "1.00", monto: "350.00" })] as never);
      await actualizarGasto(7, 1, { cantidad: 50 });
      const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos SET"))!;
      const params = update[1] as unknown[];
      expect(params[8]).toBe(1); // nunca 50
      expect(params[9]).toBe(350); // el monto tampoco se ve afectado
    });

    it("PATCH { monto, cantidad } juntos sobre un gasto multi-línea existente: AMBOS se ignoran", async () => {
      const conn = conexion({ lineasExistentesTotal: 500 });
      vi.mocked(query).mockResolvedValue([filaGasto({ cantidad: "1.00", monto: "500.00" })] as never);
      await actualizarGasto(7, 1, { monto: 1, cantidad: 1000 });
      const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos SET"))!;
      const params = update[1] as unknown[];
      expect(params[8]).toBe(1);
      expect(params[9]).toBe(500);
    });

    it("editar OTRO campo (descripción) sin `lineas`: conserva el total real de las líneas, sin tocarlas", async () => {
      const conn = conexion({ lineasExistentesTotal: 350 });
      vi.mocked(query).mockResolvedValue([filaGasto({ cantidad: "1.00", monto: "350.00", descripcion: "Nueva descripción" })] as never);
      await actualizarGasto(7, 1, { descripcion: "Nueva descripción" });
      const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos SET"))!;
      const params = update[1] as unknown[];
      expect(params[7]).toBe("Nueva descripción"); // descripción sí se aplica
      expect(params[8]).toBe(1);
      expect(params[9]).toBe(350); // total intacto
      expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("tms_gasto_operativo_lineas"))).toBe(false); // nunca se tocan las filas de línea
    });

    it("reemplazar `lineas` en un gasto que YA tenía líneas SÍ recalcula el total (con el de las líneas NUEVAS, no el viejo)", async () => {
      const conn = conexion({ lineasExistentesTotal: 350 }); // total viejo, antes del reemplazo
      vi.mocked(query).mockResolvedValue([filaGasto({ cantidad: "1.00", monto: "120.00" })] as never);
      await actualizarGasto(7, 1, { lineas: [{ categoria: "Parqueo", monto: 120 }] });
      const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos SET"))!;
      const params = update[1] as unknown[];
      expect(params[8]).toBe(1);
      expect(params[9]).toBe(120); // el NUEVO total, nunca el 350 anterior
    });

    it("`sumaLineasGastoTx` relee y BLOQUEA (FOR UPDATE) las líneas existentes, acotado a empresa_id + gasto_id — nunca confía en `actual.monto` cacheado", async () => {
      const conn = conexion({ lineasExistentesTotal: 350 });
      vi.mocked(query).mockResolvedValue([filaGasto({ monto: "350.00" })] as never);
      await actualizarGasto(7, 1, { monto: 1 });
      const suma = conn.query.mock.calls.find((c) => String(c[0]).includes("FROM tms_gasto_operativo_lineas") && String(c[0]).includes("COUNT(*)"))!;
      const sql = String(suma[0]);
      expect(sql).toContain("FOR UPDATE");
      expect(sql).toContain("WHERE empresa_id = ? AND gasto_id = ?");
    });

    it("gasto SIN líneas existentes sigue permitiendo editar monto/cantidad directamente (sin cambio de comportamiento)", async () => {
      const conn = conexion(); // sin lineasExistentesTotal -> el gasto no tiene líneas
      vi.mocked(query).mockResolvedValue([filaGasto({ monto: "777.00" })] as never);
      await actualizarGasto(7, 1, { monto: 777, cantidad: 3 });
      const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos SET"))!;
      const params = update[1] as unknown[];
      expect(params[8]).toBe(3); // cantidad enviada, sí se aplica
      expect(params[9]).toBe(777); // monto enviado, sí se aplica
    });

    it("gasto simple (sin líneas) que recibe `lineas` por primera vez: pasa a modo líneas, caché derivada de las NUEVAS líneas", async () => {
      const conn = conexion(); // sin líneas existentes
      vi.mocked(query).mockResolvedValue([filaGasto({ cantidad: "1.00", monto: "200.00" })] as never);
      await actualizarGasto(7, 1, { lineas: [{ categoria: "Combustible", monto: 200 }] });
      const inserts = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_gasto_operativo_lineas"));
      expect(inserts).toHaveLength(1);
      const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos SET"))!;
      const params = update[1] as unknown[];
      expect(params[8]).toBe(1);
      expect(params[9]).toBe(200);
    });
  });
});

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2/Fase 5) — autorizarGasto/rechazarGasto:
 * FOR UPDATE + máquina de estados propia, defensa de autoautorización,
 * histórico rechazado explícitamente (decisión #3). Desde la Fase 5,
 * autorizarGasto exige `opts.firmaImagen` (ver describe "firma real del
 * autorizante" más abajo) — el `autorizante` compartido de este describe
 * ya la incluye por defecto.
 */
describe("autorizarGasto", () => {
  const autorizante = { usuario: "hsitan", autorizanteUsuarioId: 9, autorizanteNombre: "Heber Sitan", firmaImagen: IMAGEN_FIRMA };

  it("devuelve null si el gasto no existe (rollback)", async () => {
    const conn = conexion({ bloqueoRaw: null });
    expect(await autorizarGasto(7, 999, autorizante)).toBeNull();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("histórico (estado NULL): rechaza con ErrorGasto 409 y mensaje claro, nunca lo convierte a Pendiente (decisión #3)", async () => {
    const conn = conexion({ bloqueoRaw: filaGastoBloqueo({ estado: null }) });
    await esperarErrorGasto(autorizarGasto(7, 1, autorizante), "Este gasto es histórico y no tiene flujo de autorización.", 409);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE"))).toBe(false);
  });

  it.each(["Autorizada", "Rechazada"] as const)("no permite pasar de %s a Autorizada (transición inválida) — ErrorGasto 409", async (estadoActual) => {
    const conn = conexion({ bloqueoRaw: filaGastoBloqueo({ estado: estadoActual }) });
    await esperarErrorGasto(autorizarGasto(7, 1, autorizante), `No se puede pasar de "${estadoActual}" a "Autorizada".`, 409);
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("autoriza un Pendiente y escribe estado/autorizante/autorizado_en", async () => {
    const conn = conexion({ bloqueoRaw: filaGastoBloqueo({ estado: "Pendiente" }) });
    vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Autorizada", autorizante_nombre: "Heber Sitan" })] as never);
    const g = await autorizarGasto(7, 1, autorizante);
    expect(g?.estado).toBe("Autorizada");
    const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos"))!;
    expect(String(update[0])).toContain("estado = 'Autorizada'");
    expect(update[1]).toEqual([null, "Heber Sitan", 9, 1, 7]);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  describe("autoautorización controlada por permiso validado en la ruta", () => {
    it("rechaza si el autorizante es el requirente de ese gasto — ErrorGasto 403", async () => {
      const conn = conexion({ bloqueoRaw: filaGastoBloqueo({ requirente_usuario_id: 9 }) });
      await esperarErrorGasto(autorizarGasto(7, 1, autorizante), "No puede autorizar su propio gasto.", 403);
      expect(conn.rollback).toHaveBeenCalledOnce();
    });

    it("rechaza si el autorizante es el solicitante de ese gasto — ErrorGasto 403", async () => {
      conexion({ bloqueoRaw: filaGastoBloqueo({ solicitante_usuario_id: 9 }) });
      await esperarErrorGasto(autorizarGasto(7, 1, autorizante), "No puede autorizar su propio gasto.", 403);
    });

    it("rechaza si el autorizante (por username) es quien creó el registro — ErrorGasto 403", async () => {
      conexion({ bloqueoRaw: filaGastoBloqueo({ creado_por: "hsitan" }) });
      await esperarErrorGasto(autorizarGasto(7, 1, autorizante), "No puede autorizar su propio gasto.", 403);
    });

    it("permite al creador autorizar cuando la ruta habilita explícitamente la autoautorización", async () => {
      const conn = conexion({ bloqueoRaw: filaGastoBloqueo({ requirente_usuario_id: 9, creado_por: "hsitan" }) });
      vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Autorizada" })] as never);
      await autorizarGasto(7, 1, { ...autorizante, permitirAutoautorizacion: true });
      expect(conn.commit).toHaveBeenCalledOnce();
      expect(crearFirmaInterna).toHaveBeenCalled();
    });

    it("permite autorizar cuando el autorizante NO tiene ninguna relación con el gasto", async () => {
      const conn = conexion({ bloqueoRaw: filaGastoBloqueo({ requirente_usuario_id: 20, solicitante_usuario_id: 21, creado_por: "otro" }) });
      vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Autorizada" })] as never);
      await autorizarGasto(7, 1, autorizante);
      expect(conn.commit).toHaveBeenCalledOnce();
    });
  });

  it("AISLAMIENTO MULTIEMPRESA: valida autorizanteEmpleadoId (legado) contra la empresa", async () => {
    const conn = conexion({ bloqueoRaw: filaGastoBloqueo(), empleadoEnEmpresa: false });
    await expect(autorizarGasto(7, 1, { ...autorizante, autorizanteEmpleadoId: 999 })).rejects.toThrow("El autorizante indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
});

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 5) — mismo criterio EXACTO que
 * "cambiarEstadoSolicitudFondo — firma real del autorizante" en
 * fondos.test.ts: firma obligatoria, snapshot inmutable en
 * firmas_electronicas, copia física ANTES de abrir la transacción, y
 * limpieza (borrarUpload) si el commit no llega a completarse.
 */
describe("autorizarGasto — firma real del autorizante (Fase 5)", () => {
  const autorizante = { usuario: "hsitan", autorizanteUsuarioId: 9, autorizanteNombre: "Heber Sitan", firmaImagen: IMAGEN_FIRMA };

  it("autorizante SIN firma (opts.firmaImagen ausente) -> rechaza con el mensaje fijo, sin tocar la base de datos", async () => {
    const conn = conexion({ bloqueoRaw: filaGastoBloqueo() });
    await esperarErrorGasto(
      autorizarGasto(7, 1, { ...autorizante, firmaImagen: null }),
      MENSAJE_FIRMA_REQUERIDA_AUTORIZAR,
      400,
    );
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });

  it("autorización guarda un snapshot REAL: crearFirmaInterna recibe la imagen, el nombre real y accion='AUTORIZAR_GASTO'", async () => {
    const conn = conexion({ bloqueoRaw: filaGastoBloqueo({ estado: "Pendiente" }) });
    vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Autorizada", autorizante_nombre: "Heber Sitan" })] as never);
    await autorizarGasto(7, 1, autorizante);
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 7, usuarioId: 9, nombreFirmante: "Heber Sitan",
      accion: "AUTORIZAR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO", entidadId: 1,
      metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
      imagen: expect.objectContaining({ relative: "empresas/7/firmas/firma_x.png" }),
    }));
    // La copia física se escribe ANTES de abrir la transacción de negocio.
    expect(vi.mocked(guardarUpload).mock.invocationCallOrder[0]).toBeLessThan(conn.beginTransaction.mock.invocationCallOrder[0]);
  });

  it("si falla la transacción después de guardar la imagen, se compensa (borra) el archivo — nunca queda huérfano", async () => {
    conexion({ bloqueoRaw: filaGastoBloqueo({ estado: "Pendiente" }), fallaEn: "UPDATE tms_gastos_operativos" });
    await expect(autorizarGasto(7, 1, autorizante)).rejects.toThrow();
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });

  it("commit exitoso NUNCA borra el archivo de la firma recién guardada", async () => {
    conexion({ bloqueoRaw: filaGastoBloqueo({ estado: "Pendiente" }) });
    vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Autorizada" })] as never);
    await autorizarGasto(7, 1, autorizante);
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("si el gasto no existe, también compensa (borra) el archivo ya escrito — nunca queda huérfano", async () => {
    conexion({ bloqueoRaw: null });
    await autorizarGasto(7, 999, autorizante);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });
});

describe("rechazarGasto", () => {
  it("exige un motivo, sin abrir conexión si falta", async () => {
    await expect(rechazarGasto(7, 1, { motivoRechazo: "" })).rejects.toThrow("El rechazo requiere un motivo.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("devuelve null si el gasto no existe (rollback)", async () => {
    const conn = conexion({ bloqueoRaw: null });
    expect(await rechazarGasto(7, 999, { motivoRechazo: "Factura ilegible" })).toBeNull();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("histórico (estado NULL): rechaza con ErrorGasto 409 y mensaje claro (decisión #3)", async () => {
    const conn = conexion({ bloqueoRaw: filaGastoBloqueo({ estado: null }) });
    await esperarErrorGasto(rechazarGasto(7, 1, { motivoRechazo: "x" }), "Este gasto es histórico y no tiene flujo de autorización.", 409);
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it.each(["Autorizada", "Rechazada"] as const)("no permite pasar de %s a Rechazada (transición inválida) — ErrorGasto 409", async (estadoActual) => {
    conexion({ bloqueoRaw: filaGastoBloqueo({ estado: estadoActual }) });
    await esperarErrorGasto(rechazarGasto(7, 1, { motivoRechazo: "x" }), `No se puede pasar de "${estadoActual}" a "Rechazada".`, 409);
  });

  it("rechaza un Pendiente y escribe estado/motivo/rechazado_en — sin exigir firma ni chequear autoautorización", async () => {
    const conn = conexion({ bloqueoRaw: filaGastoBloqueo({ estado: "Pendiente", requirente_usuario_id: 9, creado_por: "hsitan" }) });
    vi.mocked(query).mockResolvedValue([filaGasto({ estado: "Rechazada", motivo_rechazo: "Factura ilegible" })] as never);
    const g = await rechazarGasto(7, 1, { usuario: "hsitan", motivoRechazo: "  Factura ilegible  " });
    expect(g?.estado).toBe("Rechazada");
    const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_gastos_operativos"))!;
    expect(update[1]).toEqual(["Factura ilegible", 1, 7]);
    expect(conn.commit).toHaveBeenCalledOnce();
  });
});
