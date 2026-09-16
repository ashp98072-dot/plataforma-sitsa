import { describe, expect, it } from "vitest";
import { centavosFiscales, documentosAntecedente, parsearDatosFiscales, validarAntecedenteFiscal, type AntecedenteFiscal } from "./fiscal-modelo";

function datos(): AntecedenteFiscal {
  return { inicioFiscal: null, corteAntecedentes: null,
    ingresosGravadosPrevios: "0.00", ingresosExentosPrevios: "0.00", igssLaboralPrevio: "0.00", isrRetenidoPrevio: "0.00",
    datos: { version: 1, declaracionAntecedentes: "SIN_ANTECEDENTES", constancias: [], ingresosPreviosPorConcepto: [],
      ajustesPrevios: [], deducciones: [], otrosPatronos: { declaracion: "NO", agenteRetenedor: "ESTA_EMPRESA", remuneraciones: [] } } };
}
function externos(): AntecedenteFiscal {
  const a = datos();
  a.inicioFiscal = "2026-01-01"; a.corteAntecedentes = "2026-03-31";
  a.ingresosGravadosPrevios = "12000.00"; a.ingresosExentosPrevios = "4000.00";
  a.igssLaboralPrevio = "579.60"; a.isrRetenidoPrevio = "100.00";
  a.datos.declaracionAntecedentes = "CON_ANTECEDENTES";
  a.datos.constancias = [{ id: "c1", patronoNit: "123-4", numero: "001", periodoDesde: "2026-01-01", periodoHasta: "2026-03-31", documentoId: 5 }];
  a.datos.ingresosPreviosPorConcepto = [{ id: "i1", codigoConcepto: "AGUINALDO", tipoConcepto: "Aguinaldo",
    monto: "16000.00", montoGravado: "12000.00", montoExento: "4000.00", tratamientoDeclarado: "CONDICIONAL",
    fundamentoDocumentado: "Constancia declarada", periodoDesde: "2026-03-01", periodoHasta: "2026-03-31",
    patronoNit: "123-4", constanciaId: "c1", documentoId: 5, observacionesLimitesAnuales: "Salario ordinario declarado Q4000" }];
  return a;
}

describe("contrato fiscal v1", () => {
  it("confirma ausencia explícita, no inventa antecedentes", () => expect(validarAntecedenteFiscal(datos(), 2026, true)).toEqual(datos()));
  it("admite LONGTEXT y objeto JSON con contrato idéntico", () => {
    expect(parsearDatosFiscales(JSON.stringify(datos().datos))).toEqual(datos().datos);
    expect(parsearDatosFiscales(datos().datos)).toEqual(datos().datos);
  });
  it.each(["{", "null", "[]", '{"version":2}', undefined])("JSON inválido falla cerrado: %s", (raw) => {
    expect(() => parsearDatosFiscales(raw)).toThrow("almacenados inválidos");
  });
  it("rechaza claves desconocidas tanto en cabecera como JSON anidado", () => {
    expect(() => validarAntecedenteFiscal({ ...datos(), empresaId: 99 }, 2026)).toThrow();
    expect(() => parsearDatosFiscales({ ...datos().datos, autorizado: true })).toThrow();
  });
  it.each(["-1.00", "0.001", "1e3", "01.00", "1000000000000.00", 100])("rechaza importe ambiguo %s", (monto) => {
    expect(() => validarAntecedenteFiscal({ ...datos(), isrRetenidoPrevio: monto }, 2026)).toThrow();
  });
  it("no convierte desconocido en cero: captura acepta NULL, confirmación no", () => {
    const a = datos(); a.isrRetenidoPrevio = null;
    expect(validarAntecedenteFiscal(a, 2026).isrRetenidoPrevio).toBeNull();
    expect(() => validarAntecedenteFiscal(a, 2026, true)).toThrow("acumulados");
  });
  it.each(["2026-02-30", "2025-12-31"]) ("rechaza fecha inválida/fuera de ejercicio %s", (fecha) => {
    expect(() => validarAntecedenteFiscal({ ...datos(), inicioFiscal: fecha }, 2026)).toThrow();
  });
  it("concilia ingreso condicionado sin sumarlo dos veces", () => {
    expect(validarAntecedenteFiscal(externos(), 2026, true).ingresosExentosPrevios).toBe("4000.00");
    expect(documentosAntecedente(externos().datos)).toEqual([5]);
  });
  it("agregados sin detalle no bastan para confirmar", () => {
    const a = externos(); a.datos.ingresosPreviosPorConcepto = [];
    expect(() => validarAntecedenteFiscal(a, 2026, true)).toThrow("Totales");
  });
  it("requiere desglose/observaciones y fundamento para confirmar", () => {
    const a = externos(); a.datos.ingresosPreviosPorConcepto[0].observacionesLimitesAnuales = null;
    expect(() => validarAntecedenteFiscal(a, 2026, true)).toThrow("respaldo");
  });
  it("rechaza constancia ajena al concepto y monto que no concilia", () => {
    const a = externos(); a.datos.ingresosPreviosPorConcepto[0].patronoNit = "otro";
    expect(() => validarAntecedenteFiscal(a, 2026)).toThrow("constancia compatible");
    a.datos.ingresosPreviosPorConcepto[0].patronoNit = "123-4";
    a.datos.ingresosPreviosPorConcepto[0].monto = "15000.00";
    expect(() => validarAntecedenteFiscal(a, 2026)).toThrow("no concilia");
  });
  it("rechaza referencias duplicadas y constancias solapadas", () => {
    const a = externos(); a.datos.constancias.push({ ...a.datos.constancias[0] });
    expect(() => validarAntecedenteFiscal(a, 2026)).toThrow("duplicadas");
    a.datos.constancias[1].id = "c2";
    a.datos.constancias[1].numero = "002"; a.datos.constancias[1].documentoId = 6;
    expect(() => validarAntecedenteFiscal(a, 2026)).toThrow("solapadas");
  });
  it("detecta el mismo ingreso incluso si se cambia su id", () => {
    const a = externos(); a.datos.ingresosPreviosPorConcepto.push({ ...a.datos.ingresosPreviosPorConcepto[0], id: "i2" });
    expect(() => validarAntecedenteFiscal(a, 2026)).toThrow("concepto duplicado");
  });
  it("tratamiento exento no admite parte gravada", () => {
    const a = externos(); a.datos.ingresosPreviosPorConcepto[0].tratamientoDeclarado = "EXENTO";
    expect(() => validarAntecedenteFiscal(a, 2026)).toThrow("Tratamiento declarado");
  });
  it("no confirma multiempleo incompleto", () => {
    const a = datos(); a.datos.otrosPatronos.declaracion = "SI";
    expect(() => validarAntecedenteFiscal(a, 2026, true)).toThrow("otros patronos");
  });
  it("centavos exactos incluso en límite DECIMAL", () => {
    expect(centavosFiscales("999999999999.99") + centavosFiscales("0.01")).toBe(BigInt("100000000000000"));
  });
});
