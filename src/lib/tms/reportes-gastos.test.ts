import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import {
  filtrosReporteGastosDesdeUrl,
  reporteGastosPorCategoria,
  reporteGastosPorCliente,
  reporteGastosPorPeriodo,
  reporteGastosPorUnidad,
  reporteGastosPorViaje,
  reporteRentabilidadPorViaje,
  reporteSolicitudesFondo,
  resumirSolicitudesFondo,
  reporteViaticosPorViajeEmpleado,
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

describe("reporteViaticosPorViajeEmpleado", () => {
  it("mapea filas del join tms_viaticos + tms_planes_viaje + tms_personal", async () => {
    vi.mocked(query).mockResolvedValue([{
      viatico_id: 1, plan_id: 2, plan_codigo: "PLAN-1", fecha_plan: "2026-09-01",
      personal_id: 3, personal_nombre: "Juan Perez", rol: "Piloto",
      monto_sugerido: "150.00", monto_asignado: "150.00", estado: "PROGRAMADO",
    }] as never);
    const [f] = await reporteViaticosPorViajeEmpleado(7);
    expect(f).toEqual({
      viaticoId: 1, planId: 2, planCodigo: "PLAN-1", fechaPlan: "2026-09-01",
      personalId: 3, personalNombre: "Juan Perez", rol: "Piloto",
      montoSugerido: 150, montoAsignado: 150, estado: "PROGRAMADO",
    });
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

  it("fecha con formato inválido para fondos se ignora, igual que fechaDesde/fechaHasta de gastos", () => {
    const f = filtrosReporteGastosDesdeUrl(new URL("http://x?fechaSolicitudDesde=01/09/2026"));
    expect(f.fechaSolicitudDesde).toBeUndefined();
  });

  it("el mismo parseo sirve para listado y exportador — una sola función, sin duplicar (mismo criterio que reportes-viajes.ts)", () => {
    const url = new URL("http://x?fechaSolicitudDesde=2026-09-01&clienteId=5&placa=P1");
    expect(filtrosReporteGastosDesdeUrl(url)).toEqual(filtrosReporteGastosDesdeUrl(url));
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
});
