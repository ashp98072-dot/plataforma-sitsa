import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import {
  agruparSolicitudesFondo,
  filtrosReporteGastosDesdeUrl,
  reporteGastosDetalle,
  reporteGastosPorCategoria,
  reporteGastosPorCliente,
  reporteGastosPorPeriodo,
  reporteGastosPorUnidad,
  reporteGastosPorViaje,
  reporteRentabilidadPorViaje,
  reporteSolicitudesFondo,
  resumenMensualFondos,
  resumirSolicitudesFondo,
  resumirViaticosPorEstado,
  reporteViaticosPorViajeEmpleado,
  type FilaSolicitudFondoReporte,
} from "./reportes-gastos";

describe("resumen de solicitudes de fondo", () => {
  it("cuenta y suma cada solicitud una sola vez aunque tenga varias líneas", () => {
    const base = { solicitudCodigo: "F", fechaSolicitud: "2026-09-01", fechaViaje: null, empleadoId: null, empleadoNombre: null, cargo: null, vehiculoId: null, placa: null, clienteId: null, clienteNombre: null, planId: null, cantidad: 1, descripcion: null, monto: 100, total: 100 };
    const resumen = resumirSolicitudesFondo([
      { ...base, lineaId: 1, solicitudId: 10, estadoFondo: "Autorizada", totalSolicitud: 1000 },
      { ...base, lineaId: 2, solicitudId: 10, estadoFondo: "Autorizada", totalSolicitud: 1000 },
      { ...base, lineaId: 3, solicitudId: 11, estadoFondo: "Liquidada", totalSolicitud: 500 },
      { ...base, lineaId: 4, solicitudId: 12, estadoFondo: "Rechazada", totalSolicitud: 200 },
    ]);
    expect(resumen).toEqual({ cantidad: 3, totalSolicitado: 1700, totalAutorizado: 1500, totalLiquidado: 500, totalRechazado: 200 });
  });
});

beforeEach(() => vi.resetAllMocks());

describe("reportes agregados de gastos", () => {
  it("por categoría: agrupa y mapea registros/total", async () => {
    vi.mocked(query).mockResolvedValue([
      { clave: "Combustible", etiqueta: "Combustible", registros: 3, total_monto: "1350.00" },
    ] as never);
    const filas = await reporteGastosPorCategoria(7);
    expect(filas).toEqual([{ clave: "Combustible", etiqueta: "Combustible", registros: 3, totalMonto: 1350 }]);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("GROUP BY g.categoria");
  });

  it("por viaje: siempre filtra activo=1 y aísla por empresa", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosPorViaje(7, { fechaDesde: "2026-01-01" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("g.empresa_id = ?");
    expect(sql).toContain("g.activo = 1");
    expect(params).toEqual([7, "2026-01-01"]);
  });

  it("por unidad y por cliente usan sus propios GROUP BY", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosPorUnidad(7);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("GROUP BY g.vehiculo_id");
    await reporteGastosPorCliente(7);
    expect(vi.mocked(query).mock.calls[1][0]).toContain("GROUP BY g.cliente_id");
  });

  it("por período agrupa por mes calendario", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosPorPeriodo(7);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("%Y-%m");
  });
});

/**
 * REPORTES-VIATICOS-GASTOS-DETALLE-1 (§1 del ticket) — detalle completo
 * por viático: fecha de registro, fecha de viaje, código, ruta/destino
 * (snapshot histórico del plan), nombre/cargo/cuenta bancaria (vía
 * tms_personal.id_empleado -> empleados, § 6: no hay snapshot propio en
 * tms_viaticos, el JOIN en vivo es la única fuente posible), placa,
 * cliente, concepto (rol), montos, estado, autorización y entrega.
 */
describe("reporteViaticosPorViajeEmpleado", () => {
  function filaCruda(overrides: Record<string, unknown> = {}) {
    return {
      viatico_id: 1, fecha_registro: "2026-09-01", plan_id: 2, plan_codigo: "PLAN-1", fecha_plan: "2026-09-02",
      lugar_descarga_historico: "Escuintla",
      personal_id: 3, personal_nombre: "Juan Perez", cargo: "Piloto", cuenta_bancaria: "1234567890",
      placa: "P111AAA", cliente_id: 5, cliente_nombre: "Cliente A",
      rol: "Piloto", monto_sugerido: "150.00", monto_asignado: "150.00", estado: "AUTORIZADO",
      fecha_autorizacion: "2026-09-02", autorizado_por: "hsitan",
      fecha_entrega: null, entregado_por: null,
      observaciones_entrega: null, observaciones_liquidacion: null,
      ...overrides,
    };
  }

  it("mapea el detalle completo (§1 del ticket) del join tms_viaticos + plan + personal + empleados + unidad + cliente", async () => {
    vi.mocked(query).mockResolvedValue([filaCruda()] as never);
    const [f] = await reporteViaticosPorViajeEmpleado(7);
    expect(f).toEqual({
      viaticoId: 1, fechaRegistro: "2026-09-01", fechaViaje: "2026-09-02",
      planId: 2, planCodigo: "PLAN-1", rutaDestino: "Escuintla",
      personalId: 3, personalNombre: "Juan Perez", cargo: "Piloto", cuentaBancaria: "1234567890",
      placa: "P111AAA", clienteId: 5, clienteNombre: "Cliente A", rol: "Piloto",
      montoSugerido: 150, montoAsignado: 150, estado: "AUTORIZADO",
      fechaAutorizacion: "2026-09-02", autorizadoPor: "hsitan",
      fechaEntrega: null, entregadoPor: null, observaciones: null,
    });
  });

  it("observaciones: prefiere la de liquidación sobre la de entrega cuando ambas existen", async () => {
    vi.mocked(query).mockResolvedValue([filaCruda({ observaciones_entrega: "Entrega ok", observaciones_liquidacion: "Liquidado sin novedad" })] as never);
    const [f] = await reporteViaticosPorViajeEmpleado(7);
    expect(f.observaciones).toBe("Liquidado sin novedad");
  });

  it("sin liquidación, usa la observación de entrega", async () => {
    vi.mocked(query).mockResolvedValue([filaCruda({ observaciones_entrega: "Entrega ok", observaciones_liquidacion: null })] as never);
    const [f] = await reporteViaticosPorViajeEmpleado(7);
    expect(f.observaciones).toBe("Entrega ok");
  });

  it("sin empleado vinculado (tms_personal.id_empleado NULL): cargo cae a tp.tipo, cuenta bancaria queda null", async () => {
    vi.mocked(query).mockResolvedValue([filaCruda({ cargo: "Piloto", cuenta_bancaria: null })] as never);
    const [f] = await reporteViaticosPorViajeEmpleado(7);
    expect(f.cargo).toBe("Piloto");
    expect(f.cuentaBancaria).toBeNull();
  });

  it("§3 del ticket — filtra por placa, empleado (nombre parcial) y estado", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteViaticosPorViajeEmpleado(7, { placa: "P111AAA", empleadoNombre: "Juan", estadoViatico: "LIQUIDADO" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("COALESCE(fv.placa, u.placa) = ?");
    expect(sql).toContain("per.nombre LIKE ?");
    expect(sql).toContain("v.estado = ?");
    expect(params).toEqual([7, "P111AAA", "%Juan%", "LIQUIDADO"]);
  });

  it("la placa viene de flota_vehiculos (dato maestro) con fallback a tms_unidades.placa — nunca u.placa solo", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteViaticosPorViajeEmpleado(7);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    // JOIN a flota_vehiculos vía tms_unidades.flota_vehiculo_id (mismo
    // patrón que resolverVehiculoDeUnidadTms/unidad-flota.ts).
    expect(sql).toContain("LEFT JOIN flota_vehiculos fv ON fv.id = u.flota_vehiculo_id");
    // Selección: COALESCE(fv.placa, u.placa) — nunca u.placa solo, porque
    // tms_unidades.flota_vehiculo_id es nullable a propósito (backfill
    // progresivo) y no debe perderse la placa de unidades sin vincular.
    expect(sql).toContain("COALESCE(fv.placa, u.placa) AS placa");
    // Toda aparición de "u.placa" en el SQL vive dentro de un COALESCE(...) —
    // nunca queda un "u.placa" suelto en el SELECT o en el filtro.
    const usosDeUPlaca = sql.match(/u\.placa/g) ?? [];
    const usosDentroDeCoalesce = sql.match(/COALESCE\(fv\.placa, u\.placa\)/g) ?? [];
    expect(usosDeUPlaca.length).toBe(usosDentroDeCoalesce.length);
  });

  it("nunca depende de tms_cliente_rutas — usa el snapshot histórico del plan (ruta_codigo_historico/lugar_descarga_historico)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteViaticosPorViajeEmpleado(7);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).not.toContain("tms_cliente_rutas");
    expect(sql).toContain("lugar_descarga_historico");
  });
});

describe("resumirViaticosPorEstado (§1 del ticket — totales por estado)", () => {
  it("agrupa cantidad y suma de monto asignado por estado", () => {
    const base = { viaticoId: 1, fechaRegistro: "2026-09-01", fechaViaje: "2026-09-01", planId: 1, planCodigo: "P", rutaDestino: null, personalId: 1, personalNombre: "X", cargo: null, cuentaBancaria: null, placa: null, clienteId: null, clienteNombre: null, rol: "Piloto", montoSugerido: 0, fechaAutorizacion: null, autorizadoPor: null, fechaEntrega: null, entregadoPor: null, observaciones: null };
    const resumen = resumirViaticosPorEstado([
      { ...base, viaticoId: 1, montoAsignado: 150, estado: "AUTORIZADO" },
      { ...base, viaticoId: 2, montoAsignado: 100, estado: "AUTORIZADO" },
      { ...base, viaticoId: 3, montoAsignado: 200, estado: "LIQUIDADO" },
    ]);
    expect(resumen).toEqual({
      AUTORIZADO: { cantidad: 2, total: 250 },
      LIQUIDADO: { cantidad: 1, total: 200 },
    });
  });

  it("sin filas, devuelve un objeto vacío (nunca revienta)", () => {
    expect(resumirViaticosPorEstado([])).toEqual({});
  });
});

/**
 * REPORTES-VIATICOS-GASTOS-DETALLE-1 (§2 del ticket) — detalle completo
 * de Gastos Operativos, una fila por gasto (nunca agrupado).
 */
describe("reporteGastosDetalle", () => {
  function filaCruda(overrides: Record<string, unknown> = {}) {
    return {
      id: 1, fecha_solicitud: "2026-09-01", fecha_viaje: "2026-09-02",
      plan_id: 2, plan_codigo: "PLAN-1",
      empleado_id: 4, empleado_nombre: "Heber Sitan", cargo: "Piloto",
      vehiculo_id: 9, placa: "P111AAA", cliente_id: 5, cliente_nombre: "Cliente A",
      categoria: "Combustible", descripcion: "Diesel", cantidad: "2.00", monto: "100.00",
      activo: 1, creado_por: "admin", observaciones: null,
      ...overrides,
    };
  }

  it("mapea el detalle completo y calcula total = cantidad × monto", async () => {
    vi.mocked(query).mockResolvedValue([filaCruda()] as never);
    const [f] = await reporteGastosDetalle(7);
    expect(f).toEqual({
      id: 1, fechaSolicitud: "2026-09-01", fechaViaje: "2026-09-02",
      planId: 2, planCodigo: "PLAN-1", empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto",
      vehiculoId: 9, placa: "P111AAA", clienteId: 5, clienteNombre: "Cliente A",
      categoria: "Combustible", descripcion: "Diesel", cantidad: 2, monto: 100, total: 200,
      activo: true, registradoPor: "admin", observaciones: null,
    });
  });

  it("GASTOS-OPERATIVOS-DETALLE-FORMATO-1 — filtra por fecha solicitud y fecha viaje POR SEPARADO (columnas propias, no el COALESCE combinado)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosDetalle(7, {
      fechaSolicitudDesde: "2026-09-01", fechaSolicitudHasta: "2026-09-30",
      fechaViajeDesde: "2026-09-05", fechaViajeHasta: "2026-09-10",
    });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("g.fecha_solicitud >= ?");
    expect(sql).toContain("g.fecha_solicitud <= ?");
    expect(sql).toContain("g.fecha_viaje >= ?");
    expect(sql).toContain("g.fecha_viaje <= ?");
    expect(params).toEqual([7, "2026-09-01", "2026-09-30", "2026-09-05", "2026-09-10"]);
  });

  it("activo=0 se mapea a false (gasto anulado)", async () => {
    vi.mocked(query).mockResolvedValue([filaCruda({ activo: 0 })] as never);
    const [f] = await reporteGastosDetalle(7);
    expect(f.activo).toBe(false);
  });

  it("§3 del ticket — filtra por empleadoId y estado (activo)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosDetalle(7, { empleadoId: 4, activo: false });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("g.empleado_id = ?");
    expect(sql).toContain("g.activo = ?");
    expect(params).toEqual([7, 0, 4]);
  });

  it("activo=undefined (sin filtro de estado): incluye activos e inactivos, nunca fuerza activo=1", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosDetalle(7, {});
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).not.toContain("g.activo = ?");
  });

  it("multiempresa: todos los JOIN exigen empresa_id igual, no solo el id", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosDetalle(7);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("p.empresa_id = g.empresa_id");
    expect(sql).toContain("emp.empresa_id = g.empresa_id");
    expect(sql).toContain("veh.empresa_id = g.empresa_id");
    expect(sql).toContain("cli.empresa_id = g.empresa_id");
  });
});

describe("reporteRentabilidadPorViaje", () => {
  it("calcula utilidad = tarifa - gastos - viaticos", async () => {
    vi.mocked(query).mockResolvedValue([{
      plan_id: 1, plan_codigo: "PLAN-1", fecha_plan: "2026-09-01", cliente_nombre: "Acme",
      tarifa_comercial: "1000.00", total_gastos: "150.00", total_viaticos: "100.00",
    }] as never);
    const [f] = await reporteRentabilidadPorViaje(7);
    expect(f).toMatchObject({
      tarifaComercial: 1000, gastos: 150, viaticos: 100, utilidad: 750,
    });
  });

  it("tarifa sin gastos ni viáticos: utilidad = tarifa completa", async () => {
    vi.mocked(query).mockResolvedValue([{
      plan_id: 1, plan_codigo: "PLAN-1", fecha_plan: "2026-09-01", cliente_nombre: null,
      tarifa_comercial: "1000.00", total_gastos: "0.00", total_viaticos: "0.00",
    }] as never);
    const [f] = await reporteRentabilidadPorViaje(7);
    expect(f.utilidad).toBe(1000);
  });

  /**
   * TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que "costo operativo"
   * ya no se utiliza: la fórmula de utilidad y esta consulta ya NO restan
   * ni seleccionan costo_operativo_referencia. La columna sigue existiendo
   * en tms_planes_viaje (sin DROP, sin migración destructiva) — esta
   * prueba confirma que la capa de aplicación ya no la lee.
   */
  it("ya no selecciona ni usa costo_operativo_referencia (campo retirado, TMS-SIN-COSTO-OPERATIVO-1)", async () => {
    vi.mocked(query).mockResolvedValue([{
      plan_id: 1, plan_codigo: "PLAN-1", fecha_plan: "2026-09-01", cliente_nombre: "Acme",
      tarifa_comercial: "1000.00", total_gastos: "150.00", total_viaticos: "100.00",
    }] as never);
    const [f] = await reporteRentabilidadPorViaje(7);
    expect(f).not.toHaveProperty("costoOperativo");
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).not.toContain("costo_operativo");
    expect(sql).not.toContain("tms_cliente_rutas");
  });
});

describe("aislamiento multiempresa en los JOIN de reportes (bloqueo 1, revisión PR #204)", () => {
  it("gastos por viaje/unidad/cliente exigen empresa_id igual en el JOIN, no solo el id", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosPorViaje(7);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("plan.empresa_id = g.empresa_id");
    await reporteGastosPorUnidad(7);
    expect(vi.mocked(query).mock.calls[1][0]).toContain("veh.empresa_id = g.empresa_id");
    await reporteGastosPorCliente(7);
    expect(vi.mocked(query).mock.calls[2][0]).toContain("cli.empresa_id = g.empresa_id");
  });

  it("viáticos por viaje/empleado exige empresa_id igual también para tms_personal", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteViaticosPorViajeEmpleado(7);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("p.empresa_id = v.empresa_id");
    expect(sql).toContain("per.empresa_id = v.empresa_id");
  });

  it("rentabilidad exige empresa_id igual para el JOIN de cliente", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteRentabilidadPorViaje(7);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("cli.empresa_id = p.empresa_id");
  });
});

describe("SOLICITUD-FONDOS-REPORTE-1 — filtrosReporteGastosDesdeUrl (filtros propios de 'fondos')", () => {
  it("parsea fechaSolicitudDesde/Hasta y fechaViajeDesde/Hasta por separado", () => {
    const f = filtrosReporteGastosDesdeUrl(new URL(
      "http://x?fechaSolicitudDesde=2026-09-01&fechaSolicitudHasta=2026-09-08&fechaViajeDesde=2026-09-02&fechaViajeHasta=2026-09-10",
    ));
    expect(f.fechaSolicitudDesde).toBe("2026-09-01");
    expect(f.fechaSolicitudHasta).toBe("2026-09-08");
    expect(f.fechaViajeDesde).toBe("2026-09-02");
    expect(f.fechaViajeHasta).toBe("2026-09-10");
  });

  it("parsea placa/empleadoNombre/cargo/estadoFondo/descripcion", () => {
    const f = filtrosReporteGastosDesdeUrl(new URL(
      "http://x?placa=P123ABC&empleadoNombre=Heber+Sitan&cargo=Piloto&estadoFondo=Autorizada&descripcion=viaticos",
    ));
    expect(f).toMatchObject({ placa: "P123ABC", empleadoNombre: "Heber Sitan", cargo: "Piloto", estadoFondo: "Autorizada", descripcion: "viaticos" });
  });

  it("REPORTES-VIATICOS-GASTOS-DETALLE-1 — parsea empleadoId, estadoViatico y activo (1/0)", () => {
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x?empleadoId=4&estadoViatico=LIQUIDADO&activo=1")))
      .toMatchObject({ empleadoId: 4, estadoViatico: "LIQUIDADO", activo: true });
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x?activo=0")).activo).toBe(false);
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x")).activo).toBeUndefined();
  });

  it("fecha con formato inválido para fondos se ignora, igual que fechaDesde/fechaHasta de gastos", () => {
    const f = filtrosReporteGastosDesdeUrl(new URL("http://x?fechaSolicitudDesde=01/09/2026"));
    expect(f.fechaSolicitudDesde).toBeUndefined();
  });

  it("el mismo parseo sirve para listado y exportador — una sola función, sin duplicar (mismo criterio que reportes-viajes.ts)", () => {
    const url = new URL("http://x?fechaSolicitudDesde=2026-09-01&clienteId=5&placa=P1");
    expect(filtrosReporteGastosDesdeUrl(url)).toEqual(filtrosReporteGastosDesdeUrl(url));
  });

  it("REPORTES-MENSUALES-CONSOLIDADOS-1 — parsea requirenteUsuarioId (>0), ignora inválidos", () => {
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x?requirenteUsuarioId=30")).requirenteUsuarioId).toBe(30);
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x?requirenteUsuarioId=0")).requirenteUsuarioId).toBeUndefined();
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x?requirenteUsuarioId=abc")).requirenteUsuarioId).toBeUndefined();
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x")).requirenteUsuarioId).toBeUndefined();
  });
});

describe("SOLICITUD-FONDOS-REPORTE-1 — reporteSolicitudesFondo", () => {
  afterEach(() => vi.restoreAllMocks());

  function filaFondo(overrides: Record<string, unknown> = {}) {
    return {
      linea_id: 1, solicitud_id: 10, solicitud_codigo: "FONDO-000010",
      fecha_solicitud: "2026-09-01", fecha_viaje: "2026-09-02",
      empleado_id: 4, empleado_nombre: "Heber Sitan", cargo: "Piloto",
      vehiculo_id: 9, placa: "P111AAA", cliente_id: 5, cliente_nombre: "Cliente A",
      plan_id: 8, cantidad: "2.00", descripcion: "Viáticos de ruta", monto: "100.00",
      estado: "Autorizada",
      ...overrides,
    };
  }

  it("una fila por LÍNEA, con 'Total' = cantidad × monto (nunca el total de la solicitud completa)", async () => {
    vi.mocked(query).mockResolvedValue([filaFondo()] as never);
    const [f] = await reporteSolicitudesFondo(7);
    expect(f).toMatchObject({
      fechaSolicitud: "2026-09-01", fechaViaje: "2026-09-02",
      empleadoNombre: "Heber Sitan", cargo: "Piloto", placa: "P111AAA", clienteNombre: "Cliente A",
      cantidad: 2, descripcion: "Viáticos de ruta", monto: 100, total: 200, estadoFondo: "Autorizada",
    });
  });

  it("respeta fechaSolicitudDesde/Hasta (sobre el ENCABEZADO s.fecha_requerimiento)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, { fechaSolicitudDesde: "2026-09-01", fechaSolicitudHasta: "2026-09-08" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("s.fecha_requerimiento >= ?");
    expect(sql).toContain("s.fecha_requerimiento <= ?");
    expect(params).toContain("2026-09-01");
    expect(params).toContain("2026-09-08");
  });

  it("respeta fechaViajeDesde/Hasta (sobre la LÍNEA l.fecha_viaje, distinto del encabezado)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, { fechaViajeDesde: "2026-09-02", fechaViajeHasta: "2026-09-10" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("l.fecha_viaje >= ?");
    expect(sql).toContain("l.fecha_viaje <= ?");
    expect(params).toContain("2026-09-02");
    expect(params).toContain("2026-09-10");
  });

  it("respeta clienteId", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, { clienteId: 5 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("l.cliente_id = ?");
    expect(params).toContain(5);
  });

  it("respeta placa (snapshot exacto)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, { placa: "P111AAA" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("l.placa = ?");
    expect(params).toContain("P111AAA");
  });

  it("respeta empleadoNombre (snapshot exacto)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, { empleadoNombre: "Heber Sitan" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("l.empleado_nombre = ?");
    expect(params).toContain("Heber Sitan");
  });

  it("respeta cargo y estadoFondo (sobre el ENCABEZADO s.estado)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, { cargo: "Piloto", estadoFondo: "Liquidada" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("l.cargo = ?");
    expect(sql).toContain("s.estado = ?");
    expect(params).toContain("Piloto");
    expect(params).toContain("Liquidada");
  });

  it("respeta descripcion (búsqueda LIKE, mismo patrón que listarRutas())", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, { descripcion: "viaticos" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("l.descripcion LIKE ?");
    expect(params).toContain("%viaticos%");
  });

  it("combina fecha solicitud + fecha viaje + cliente + placa + empleado en una sola consulta (AND)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, {
      fechaSolicitudDesde: "2026-09-01", fechaSolicitudHasta: "2026-09-08",
      fechaViajeDesde: "2026-09-02", fechaViajeHasta: "2026-09-09",
      clienteId: 5, placa: "P111AAA", empleadoNombre: "Heber Sitan",
    });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("s.fecha_requerimiento >= ?");
    expect(sql).toContain("l.fecha_viaje >= ?");
    expect(sql).toContain("l.cliente_id = ?");
    expect(sql).toContain("l.placa = ?");
    expect(sql).toContain("l.empleado_nombre = ?");
    expect(params).toEqual([7, "2026-09-01", "2026-09-08", "2026-09-02", "2026-09-09", 5, "P111AAA", "Heber Sitan"]);
  });

  it("multiempresa: siempre filtra por l.empresa_id, nunca por uno enviado por el caller", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(42, {});
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("l.empresa_id = ?");
    expect(params?.[0]).toBe(42);
  });

  it("nunca depende de un JOIN en vivo a empleados/flota_vehiculos/tms_clientes — lee el SNAPSHOT de la línea (histórico)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, {});
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).not.toContain("JOIN empleados");
    expect(sql).not.toContain("JOIN flota_vehiculos");
    expect(sql).not.toContain("JOIN tms_clientes");
    expect(sql).toContain("l.empleado_nombre");
    expect(sql).toContain("l.placa");
    expect(sql).toContain("l.cliente_nombre");
  });

  it("REPORTES-MENSUALES-CONSOLIDADOS-1 — filtra por requirenteUsuarioId contra s.requirente_usuario_id", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, { requirenteUsuarioId: 30 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("s.requirente_usuario_id = ?");
    expect(params).toEqual([7, 30]);
  });
});

/**
 * REPORTES-MENSUALES-CONSOLIDADOS-1 — el PDF mensual consolidado agrupa
 * las líneas por solicitud (cada solicitud = un bloque). Se arma en JS
 * puro sobre las filas de `reporteSolicitudesFondo` — sin segunda consulta.
 */
describe("agruparSolicitudesFondo / resumenMensualFondos", () => {
  function fila(over: Partial<FilaSolicitudFondoReporte> = {}): FilaSolicitudFondoReporte {
    return {
      lineaId: 1, solicitudId: 10, solicitudCodigo: "FONDO-000010",
      fechaSolicitud: "2026-09-03", fechaViaje: "2026-09-04",
      empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto", cuenta: "123",
      vehiculoId: 9, placa: "P111AAA", clienteId: 5, clienteNombre: "Cliente A", planId: null,
      cantidad: 2, descripcion: "Combustible", monto: 100, total: 200,
      requirenteNombre: "Mario Caal", solicitanteNombre: "Ana Gómez", autorizanteNombre: "Heber Sitan",
      fechaAutorizacion: "2026-09-04", totalSolicitud: 600, estadoFondo: "Autorizada",
      ...over,
    };
  }

  it("agrupa varias líneas de la misma solicitud en UN bloque, conservando encabezado y firmas", () => {
    const grupos = agruparSolicitudesFondo([
      fila({ lineaId: 1, solicitudId: 10 }),
      fila({ lineaId: 2, solicitudId: 10, descripcion: "Peaje" }),
      fila({ lineaId: 3, solicitudId: 11, solicitudCodigo: "FONDO-000011", estadoFondo: "Liquidada", totalSolicitud: 300 }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos[0].solicitudId).toBe(10);
    expect(grupos[0].lineas).toHaveLength(2);
    expect(grupos[0].requirenteNombre).toBe("Mario Caal");
    expect(grupos[0].solicitanteNombre).toBe("Ana Gómez");
    expect(grupos[0].autorizanteNombre).toBe("Heber Sitan");
    expect(grupos[0].totalSolicitud).toBe(600);
    expect(grupos[1].solicitudId).toBe(11);
    expect(grupos[1].estadoFondo).toBe("Liquidada");
  });

  it("preserva el orden de llegada (reporteSolicitudesFondo ya ordena por fecha desc)", () => {
    const grupos = agruparSolicitudesFondo([
      fila({ solicitudId: 20, fechaSolicitud: "2026-09-30" }),
      fila({ solicitudId: 10, fechaSolicitud: "2026-09-01" }),
    ]);
    expect(grupos.map((g) => g.solicitudId)).toEqual([20, 10]);
  });

  it("RESUMEN DEL MES — conteos por estado ACTUAL; TOTAL GENERAL = Autorizada + Liquidada (excluye Rechazada y Pendiente), cada solicitud una vez", () => {
    const grupos = agruparSolicitudesFondo([
      fila({ solicitudId: 1, estadoFondo: "Autorizada", totalSolicitud: 1000 }),
      fila({ solicitudId: 1, estadoFondo: "Autorizada", totalSolicitud: 1000 }), // misma solicitud, no duplica
      fila({ solicitudId: 2, estadoFondo: "Liquidada", totalSolicitud: 500 }),
      fila({ solicitudId: 3, estadoFondo: "Rechazada", totalSolicitud: 999 }),
      fila({ solicitudId: 4, estadoFondo: "Pendiente", totalSolicitud: 777 }),
    ]);
    expect(resumenMensualFondos(grupos)).toEqual({
      totalSolicitudes: 4,
      autorizadas: 1,
      liquidadas: 1,
      rechazadas: 1,
      pendientes: 1,
      totalGeneral: 1500, // 1000 (Autorizada) + 500 (Liquidada); NO 999 ni 777
    });
  });

  it("sin solicitudes -> resumen en cero, nunca revienta", () => {
    expect(resumenMensualFondos([])).toEqual({
      totalSolicitudes: 0, autorizadas: 0, liquidadas: 0, rechazadas: 0, pendientes: 0, totalGeneral: 0,
    });
  });
});
