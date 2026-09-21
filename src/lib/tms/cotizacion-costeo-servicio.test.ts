import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("./cotizacion-costeo-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cotizacion-costeo-db")>();
  return { ...actual, obtenerPerfilCosteo: vi.fn(), obtenerParametrosCosteoVigentes: vi.fn() };
});
import { ErrorCosteoConfig, obtenerParametrosCosteoVigentes, obtenerPerfilCosteo, MENSAJE_SIN_PARAMETROS } from "./cotizacion-costeo-db";
import { ErrorCosteo, calcularCosteoServicio } from "./cotizacion-costeo";
import { calcularCosteoSchema, costeoPayloadSchema, mensajeErrorCosteo, precioVentaDesdeTarifa, prepararCosteo, type CosteoPayload } from "./cotizacion-costeo-servicio";

const PERFIL = {
  id: 4, codigo: "CABEZAL", nombre: "Cabezal", costoAdquisicion: null, diasOperacionMes: 30, gpsMensual: 174.1, seguroVehiculoMensual: 1550,
  costoAceiteServicio: 1860, vidaUtilAceiteKm: 5000, costoJuegoLlantas: 38466, vidaUtilLlantasKm: 50000, rendimientoKmGalon: 9.3, depreciacion: null, costoRefrigeracion: null,
};
const PARAMETROS = { precioCombustibleGalon: 29.89, ivaTasa: 0.12, costoPilotoDia: 207.74, costoAuxiliarDia: 148.04, viaticoPilotoDia: 200, viaticoAuxiliarDia: 200, viaticoGuiaDia: 125, margenObjetivo: 0.2 };
const PAYLOAD: CosteoPayload = {
  perfilId: 4, distanciaKm: 600, diasServicio: 1, cantidadPilotos: 2, cantidadAuxiliares: 2, incluirGps: true, incluirSeguroVehiculo: true,
  viaticoPilotoTotal: 200, viaticoAuxiliarTotal: 200, viaticoGuiaTotal: 125,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(obtenerPerfilCosteo).mockResolvedValue(PERFIL);
  vi.mocked(obtenerParametrosCosteoVigentes).mockResolvedValue({ vigenteDesde: "2026-09-21", parametros: PARAMETROS });
});

describe("El servidor arma TODO lo económico (el cliente solo manda datos operativos)", () => {
  const conExtra = (extra: Record<string, unknown>) => calcularCosteoSchema.safeParse({ ...PAYLOAD, fechaEmision: "2026-09-21", ...extra });
  it("acepta el payload válido", () => {
    expect(conExtra({}).success).toBe(true);
    expect(costeoPayloadSchema.safeParse(PAYLOAD).success).toBe(true);
  });
  it.each([
    "gpsMensual", "seguroVehiculoMensual", "precioCombustibleGalon", "costoPilotoDia", "costoAuxiliarDia", "ivaTasa", "costoJuegoLlantas",
    "costoAceiteServicio", "vidaUtilLlantasKm", "vidaUtilAceiteKm", "depreciacion", "costoRefrigeracion", "rendimientoKmGalon", "perfil", "parametros",
    "viaticoPilotoDia", "hotelDia", "precioVenta", "empresaId",
  ])("rechaza el campo %s enviado por el cliente (esquema estricto)", (campo) => {
    expect(conExtra({ [campo]: 1 }).success).toBe(false);
    expect(costeoPayloadSchema.safeParse({ ...PAYLOAD, [campo]: 1 }).success).toBe(false);
  });
  it("valida rangos y números finitos", () => {
    for (const malo of [{ distanciaKm: -1 }, { diasServicio: 0 }, { cantidadPilotos: -1 }, { distanciaKm: Infinity }, { distanciaKm: NaN }, { perfilId: 0 }, { margenObjetivo: 9 }, { otrosCostos: [{ concepto: "", monto: 1 }] }, { otrosCostos: [{ concepto: "Peaje", monto: -1 }] }]) {
      expect(costeoPayloadSchema.safeParse({ ...PAYLOAD, ...malo }).success).toBe(false);
    }
  });
  it("prepararCosteo: revalida el perfil POR EMPRESA y toma los parámetros vigentes a la fecha", async () => {
    await prepararCosteo(7, PAYLOAD, { fechaEmision: "2026-09-21" });
    expect(obtenerPerfilCosteo).toHaveBeenCalledWith(7, 4);
    expect(obtenerParametrosCosteoVigentes).toHaveBeenCalledWith(7, "2026-09-21");
  });
  it("un perfil de OTRA empresa (o inexistente) se rechaza sin calcular ni consultar parámetros", async () => {
    vi.mocked(obtenerPerfilCosteo).mockResolvedValue(null);
    await expect(prepararCosteo(7, { ...PAYLOAD, perfilId: 99 }, { fechaEmision: "2026-09-21" })).rejects.toThrow("El perfil de unidad indicado no existe en esta empresa.");
    expect(obtenerParametrosCosteoVigentes).not.toHaveBeenCalled();
  });
  it("sin parámetros vigentes => error claro (ErrorCosteoConfig)", async () => {
    vi.mocked(obtenerParametrosCosteoVigentes).mockRejectedValue(new ErrorCosteoConfig(MENSAJE_SIN_PARAMETROS));
    await expect(prepararCosteo(7, PAYLOAD, { fechaEmision: "2026-01-01" })).rejects.toThrow("No hay parámetros de costeo vigentes para la fecha indicada.");
  });
  it("el input del motor sale de la BD, no del cliente, y el resultado es el del motor puro", async () => {
    const { input, resultado, perfil, parametrosVigenteDesde } = await prepararCosteo(7, PAYLOAD, { fechaEmision: "2026-09-21", tarifaCotizada: 5000, incluyeIva: true });
    const { id: _id, ...perfilMotor } = PERFIL; void _id;
    expect(input.perfil).toEqual(perfilMotor); expect(input.parametros).toEqual(PARAMETROS);
    expect(perfil.id).toBe(4); expect(parametrosVigenteDesde).toBe("2026-09-21");
    expect(resultado).toEqual(calcularCosteoServicio(input));
    expect(resultado.costoOperativo).toBeCloseTo(3907.2090967741933, 6); // Puerto Barrios del libro
  });
  it("solo viajan al motor las claves informadas: vacío/null = no informado, nunca 0 implícito", async () => {
    const { input } = await prepararCosteo(7, { perfilId: 4, distanciaKm: 10, diasServicio: 1, cantidadPilotos: 1, cantidadAuxiliares: 0, incluirGps: false, incluirSeguroVehiculo: false, hotelTotal: null, otrosCostos: [] }, { fechaEmision: "2026-09-21" });
    for (const clave of ["hotelTotal", "seguroMercaderia", "viaticoPilotoTotal", "otrosCostos", "margenObjetivo", "usarRefrigeracion", "cantidadGuias"]) expect(clave in input).toBe(false);
  });
  it("datos que el motor rechaza (p. ej. refrigeración sin configuración) => ErrorCosteo con mensaje seguro", async () => {
    const error = await prepararCosteo(7, { ...PAYLOAD, usarRefrigeracion: true }, { fechaEmision: "2026-09-21" }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorCosteo); expect(mensajeErrorCosteo(error)).toContain("refrigeración");
    expect(mensajeErrorCosteo(new Error("sql secreto"))).toBeNull();
  });
});

describe("Precio de venta = tarifa comercial TOTAL CON IVA (IVA de la tarifa, no del costo)", () => {
  it("incluyeIva=true: la tarifa ya es el total", () => { expect(precioVentaDesdeTarifa(1120, true)).toBe(1120); });
  it("incluyeIva=false: tarifa × (1 + IVA comercial) con calcularIva()", () => {
    expect(precioVentaDesdeTarifa(1000, false)).toBe(1120);
    expect(precioVentaDesdeTarifa(1234.56, false)).toBe(1382.71);
  });
  it("sin tarifa válida => null", () => {
    expect(precioVentaDesdeTarifa(null, true)).toBeNull(); expect(precioVentaDesdeTarifa(0, false)).toBeNull(); expect(precioVentaDesdeTarifa(undefined, undefined)).toBeNull();
  });
  it("el precio de venta que ve el motor es el total con IVA (utilidad = total − costo con IVA)", async () => {
    const con = await prepararCosteo(7, PAYLOAD, { fechaEmision: "2026-09-21", tarifaCotizada: 5000, incluyeIva: false });
    expect(con.input.precioVenta).toBe(5600);
    expect(con.resultado.utilidadEstimada).toBeCloseTo(5600 - con.resultado.costoConIva, 6);
    const sin = await prepararCosteo(7, PAYLOAD, { fechaEmision: "2026-09-21" });
    expect(sin.input.precioVenta).toBeNull(); expect(sin.resultado.utilidadEstimada).toBeNull();
  });
  it("el IVA del costo interno (ivaTasa de parámetros) es independiente del IVA comercial", async () => {
    vi.mocked(obtenerParametrosCosteoVigentes).mockResolvedValue({ vigenteDesde: "2026-09-21", parametros: { ...PARAMETROS, ivaTasa: 0.05 } });
    const r = await prepararCosteo(7, PAYLOAD, { fechaEmision: "2026-09-21", tarifaCotizada: 1000, incluyeIva: false });
    expect(r.resultado.iva).toBeCloseTo(r.resultado.costoOperativo * 0.05, 8);
    expect(r.input.precioVenta).toBe(1120);
  });
});
