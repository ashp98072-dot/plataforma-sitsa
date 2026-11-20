import { describe, expect, it } from "vitest";
import { conductorSchema, vehiculoSchema, diagnosticarBusqueda, revisar } from "./contratos";
import { catalogoSintetico as cat } from "./fixtures";
const empleado = { tipo: "EMPLEADO", empleadoId: 11, metodo: "MANUAL", motivo: "Selección sintética" };
const unidad = { tipo: "CATALOGO", vehiculoId: 101 };
describe("Contratos sintéticos sin efectos", () => {
  it.each([
    {}, { tipo: "EMPLEADO", empleadoId: 0 }, { tipo: "EMPLEADO", empleadoId: 11, externoId: 31 },
    { tipo: "EXTERNO", externoId: 31, empleadoId: 11 }, { tipo: "NO_IDENTIFICADO", motivo: "SIN_DATO" },
  ])("rechaza conductor incompleto o incompatible %j", value => expect(conductorSchema.safeParse(value).success).toBe(false));
  it.each([{}, { tipo: "CATALOGO", vehiculoId: -1 }, { tipo: "EXTERNO", externoId: 301, vehiculoId: 101 }])("rechaza vehículo incompatible %j", value => expect(vehiculoSchema.safeParse(value).success).toBe(false));
  for (const conductor of [empleado, { tipo: "EXTERNO", externoId: 31 }]) for (const vehiculo of [unidad, { tipo: "EXTERNO", externoId: 301 }]) {
    it(`representa ${conductor.tipo}/${vehiculo.tipo} sin habilitar confirmación`, () => expect(revisar("A", conductor, vehiculo, cat)).toEqual({ estado: "SIMULACION_VALIDA", diagnosticos: [], confirmacionHabilitada: false }));
  }
  it.each([32, 33, 34, 999])("bloquea conductor pendiente, inactivo, ajeno o inexistente %i", externoId => expect(revisar("A", { tipo: "EXTERNO", externoId }, unidad, cat).diagnosticos[0].codigo).toBe("EXTERNO_NO_VALIDADO"));
  it.each([14, 22, 999])("bloquea empleado inactivo/ajeno/inexistente %i", empleadoId => expect(revisar("A", { ...empleado, empleadoId }, unidad, cat).diagnosticos[0].codigo).toBe("EMPLEADO_NO_DISPONIBLE"));
  it("conserva NO_IDENTIFICADO como propuesta bloqueada", () => expect(revisar("A", { tipo: "NO_IDENTIFICADO", motivo: "SIN_DATO", observacion: "Sin dato sintético", responsable: "Demo" }, unidad, cat).diagnosticos[0].codigo).toBe("CONDUCTOR_NO_IDENTIFICADO"));
  it("permite compartido explícito, pero no unidad privada ajena", () => {
    expect(revisar("A", empleado, { tipo: "CATALOGO", vehiculoId: 202 }, cat).estado).toBe("SIMULACION_VALIDA");
    expect(revisar("A", empleado, { tipo: "CATALOGO", vehiculoId: 201 }, cat).diagnosticos[0].codigo).toBe("VEHICULO_NO_DISPONIBLE");
  });
  it.each(["evidencia", "jurisdiccion", "tenedor", "verificadoPor"] as const)("exige %s de vehículo externo", campo => {
    const copia = structuredClone(cat); copia.vehiculos[0][campo] = " ";
    expect(revisar("A", empleado, { tipo: "EXTERNO", externoId: 301 }, copia).estado).toBe("BLOQUEADO");
  });
  it("rechaza autoaprobación aun con estado verificado", () => {
    const copia = structuredClone(cat); copia.conductores[0].verificadoPor = copia.conductores[0].capturadoPor;
    expect(revisar("A", { tipo: "EXTERNO", externoId: 31 }, unidad, copia).estado).toBe("BLOQUEADO");
  });
  it("exige relación acreditada del conductor externo", () => {
    const copia = structuredClone(cat); copia.conductores[0].referenciaRelacion = "";
    expect(revisar("A", { tipo: "EXTERNO", externoId: 31 }, unidad, copia).diagnosticos[0].codigo).toBe("EXTERNO_NO_VALIDADO");
  });
  it.each([
    ["conductor", "Homónimo", "CONDUCTOR_AMBIGUO"], ["conductor", "ausente", "EMPLEADO_NO_DISPONIBLE"],
    ["vehiculo", "DEMO-002", "PLACA_AMBIGUA"], ["vehiculo", "DEMO-B", "VEHICULO_NO_DISPONIBLE"],
  ] as const)("diagnostica %s/%s sin exponer otro tenant", (campo, consulta, codigo) => expect(diagnosticarBusqueda(cat, "A", campo, consulta)[0].codigo).toBe(codigo));
  it("no muta los originales", () => { const copia = structuredClone(cat); revisar("A", empleado, unidad, cat); expect(cat).toEqual(copia); });
});
