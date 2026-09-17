import { describe, expect, it } from "vitest";
import {
  CONFIGURACION_CONCEPTOS_2026,
  CONFIGURACION_CONCEPTOS_2026_REVISION,
  resolverConceptoFiscal2026,
} from "./fiscal-conceptos-2026";
import { calcularIsrTrabajo2026, type ConceptoIngresoIsr } from "./fiscal-isr-2026";

/**
 * RRHH-FISCAL-CONCEPTOS-2026 — pruebas de la configuración fiscal
 * versionada de conceptos. Cada caso referencia el punto de la norma que
 * sustenta la clasificación (ver el docblock de fiscal-conceptos-2026.ts
 * para las fuentes completas).
 */

describe("resolverConceptoFiscal2026 — matriz ISR", () => {
  it("1. sueldo base -> gravado (Art. 68 LAT)", () => {
    expect(resolverConceptoFiscal2026("SUELDO_BASE", 2026).tratamientoIsr).toBe("GRAVADO");
  });

  it("2. horas extra -> gravado (Art. 68 LAT)", () => {
    expect(resolverConceptoFiscal2026("HORAS_EXTRA", 2026).tratamientoIsr).toBe("GRAVADO");
  });

  it("3. bono incentivo -> gravado para ISR, exento de IGSS/IRTRA/INTECAP (tratamiento asimétrico documentado)", () => {
    const def = resolverConceptoFiscal2026("BONO_INCENTIVO", 2026);
    expect(def.tratamientoIsr).toBe("GRAVADO");
    expect(def.aplicaIgssLaboral).toBe(false);
    expect(def.aplicaIgssPatronal).toBe(false);
    expect(def.aplicaIrtra).toBe(false);
    expect(def.aplicaIntecap).toBe(false);
  });

  it("13. bono herramientas sin clasificación oficial suficiente -> pendiente, requiere evidencia", () => {
    const def = resolverConceptoFiscal2026("BONO_HERRAMIENTAS", 2026);
    expect(def.tratamientoIsr).toBe("PENDIENTE");
    expect(def.requiereEvidencia).toBe(true);
  });

  it("condicional con límite anual: aguinaldo y bono 14, cada uno con su propia categoría de límite", () => {
    const aguinaldo = resolverConceptoFiscal2026("AGUINALDO", 2026);
    const bono14 = resolverConceptoFiscal2026("BONO_14", 2026);
    expect(aguinaldo.tratamientoIsr).toBe("CONDICIONAL");
    expect(aguinaldo.categoriaLimiteAnual).toBe("AGUINALDO");
    expect(bono14.tratamientoIsr).toBe("CONDICIONAL");
    expect(bono14.categoriaLimiteAnual).toBe("BONO_14");
    expect(aguinaldo.categoriaLimiteAnual).not.toBe(bono14.categoriaLimiteAnual);
  });

  it("9. viático comprobable requiere evidencia (CONDICIONAL) — sin evidencia no puede resolverse a GRAVADO/EXENTO", () => {
    const def = resolverConceptoFiscal2026("VIATICO_COMPROBABLE", 2026);
    expect(def.tratamientoIsr).toBe("CONDICIONAL");
    expect(def.requiereEvidencia).toBe(true);
  });

  it("10. viático NO comprobable -> gravado (Art. 68/70 LAT, sin derecho a exención sin comprobar)", () => {
    expect(resolverConceptoFiscal2026("VIATICO_NO_COMPROBABLE", 2026).tratamientoIsr).toBe("GRAVADO");
  });

  it("11. comisión -> gravado para ISR (Art. 68 LAT, incluida expresamente); IGSS/IRTRA/INTECAP pendiente sin fuente primaria", () => {
    const def = resolverConceptoFiscal2026("COMISION", 2026);
    expect(def.tratamientoIsr).toBe("GRAVADO");
    expect(def.aplicaIgssLaboral).toBeNull();
    expect(def.aplicaIgssPatronal).toBeNull();
    expect(def.aplicaIrtra).toBeNull();
    expect(def.aplicaIntecap).toBeNull();
  });

  it("aguinaldo, Bono 14 y viático comprobable: IGSS/IRTRA/INTECAP pendiente sin fuente primaria oficial (no se convierte convergencia de blogs en un hecho productivo)", () => {
    for (const codigo of ["AGUINALDO", "BONO_14", "VIATICO_COMPROBABLE"]) {
      const def = resolverConceptoFiscal2026(codigo, 2026);
      expect(def.aplicaIgssLaboral).toBeNull();
      expect(def.aplicaIgssPatronal).toBeNull();
      expect(def.aplicaIrtra).toBeNull();
      expect(def.aplicaIntecap).toBeNull();
    }
  });

  it("bono variable -> gravado (Art. 68 LAT, sin exención específica)", () => {
    expect(resolverConceptoFiscal2026("BONO_VARIABLE", 2026).tratamientoIsr).toBe("GRAVADO");
  });

  it("12. concepto OTRO sin asignación -> pendiente, bloquea", () => {
    expect(resolverConceptoFiscal2026("OTRO", 2026).tratamientoIsr).toBe("PENDIENTE");
  });

  it("12b. un código completamente desconocido resuelve como OTRO (PENDIENTE), nunca se adivina", () => {
    const def = resolverConceptoFiscal2026("CODIGO_INVENTADO_QUE_NO_EXISTE", 2026);
    expect(def).toEqual(CONFIGURACION_CONCEPTOS_2026.OTRO);
    expect(def.tratamientoIsr).toBe("PENDIENTE");
  });

  it("ningún campo IGSS/IRTRA/INTECAP se asume por estar gravado o exento de ISR (separación explícita)", () => {
    // Horas extra: gravado ISR, pero IGSS/IRTRA/INTECAP quedan null (pendiente, no "false" ni "true" por defecto).
    const horasExtra = resolverConceptoFiscal2026("HORAS_EXTRA", 2026);
    expect(horasExtra.tratamientoIsr).toBe("GRAVADO");
    expect(horasExtra.aplicaIgssLaboral).toBeNull();
    // Aguinaldo: condicional ISR (con fuente primaria del límite, Art. 70), pero IGSS queda null: no hay fuente
    // primaria del IGSS/IRTRA/INTECAP que lo respalde, solo convergencia de fuentes secundarias — insuficiente.
    const aguinaldo = resolverConceptoFiscal2026("AGUINALDO", 2026);
    expect(aguinaldo.aplicaIgssLaboral).toBeNull();
    // Bono incentivo SÍ tiene fuente primaria (el propio Decreto 78-89 excluye expresamente la carga social) —
    // es la única excepción legítima a "sin fuente primaria, queda null", junto con sueldo base.
    const bonoIncentivo = resolverConceptoFiscal2026("BONO_INCENTIVO", 2026);
    expect(bonoIncentivo.aplicaIgssLaboral).toBe(false);
  });

  it("regla de rigor: solo SUELDO_BASE y BONO_INCENTIVO tienen las 4 cargas sociales resueltas (no null) — el resto queda pendiente sin fuente primaria", () => {
    const codigosConFuentePrimaria = ["SUELDO_BASE", "BONO_INCENTIVO"];
    for (const [codigo, def] of Object.entries(CONFIGURACION_CONCEPTOS_2026)) {
      const cargas = [def.aplicaIgssLaboral, def.aplicaIgssPatronal, def.aplicaIrtra, def.aplicaIntecap];
      if (codigosConFuentePrimaria.includes(codigo)) {
        expect(cargas.every((c) => c !== null), `${codigo} debería tener las 4 cargas resueltas`).toBe(true);
      } else {
        expect(cargas.every((c) => c === null), `${codigo} debería quedar pendiente (null) sin fuente primaria`).toBe(true);
      }
    }
  });
});

describe("resolverConceptoFiscal2026 — versionado por ejercicio", () => {
  it("14/19. expone su propia revisión versionada", () => {
    expect(CONFIGURACION_CONCEPTOS_2026_REVISION).toBe("2026.r1");
  });

  it("19. 2027 no hereda automáticamente la configuración 2026", () => {
    expect(() => resolverConceptoFiscal2026("SUELDO_BASE", 2027)).toThrow(/exclusiva del ejercicio 2026/);
  });
});

describe("categoriaLimiteAnual de AGUINALDO/BONO_14 integra correctamente con el motor puro", () => {
  const empleado = { id: 7, codigo: "E7", sueldo: 4000, bonoIncentivo: 0, bonoHerramientas: 0 };
  void empleado; // referencia documental: el límite depende del sueldo ordinario mensual del empleado, resuelto por el llamador.

  function inputBase(conceptoAguinaldo: ConceptoIngresoIsr, limiteQ: string, exencionExternaYaReconocidaQ = "0.00") {
    return {
      ejercicio: 2026 as const,
      fechaCorte: "2026-09-01",
      periodosRestantes: 1,
      ingresosPropiosAcumulados: [] as ConceptoIngresoIsr[],
      ingresosPropiosProyectadosRestantes: [conceptoAguinaldo],
      limitesExencionAnual: [{ categoria: "AGUINALDO", limiteQ, exencionExternaYaReconocidaQ }],
      antecedentes: null,
      igssLaboralPropio: { acumuladoQ: "0.00", proyectadoRestanteQ: "0.00" },
      isrRetenidoPropioQ: "0.00",
      deduccionesAdicionalesAdmitidas: [],
    };
  }

  it("4/6. Aguinaldo dentro del límite -> exento íntegro", () => {
    const def = resolverConceptoFiscal2026("AGUINALDO", 2026);
    const concepto: ConceptoIngresoIsr = {
      id: "aguinaldo-2026", codigoConcepto: def.codigo, tratamiento: "EXENTO",
      monto: "3000.00", categoriaLimiteAnual: def.categoriaLimiteAnual,
    };
    // límite = un sueldo ordinario mensual (Q4,000) — resuelto por el llamador, el motor no lo calcula.
    const resultado = calcularIsrTrabajo2026(inputBase(concepto, "4000.00"));
    expect(resultado.rentaExenta).toBe("3000.00");
    expect(resultado.rentaGravadaProyectada).toBe("0.00");
  });

  it("5/7. Aguinaldo sobre el límite -> excedente gravado", () => {
    const def = resolverConceptoFiscal2026("AGUINALDO", 2026);
    const concepto: ConceptoIngresoIsr = {
      id: "aguinaldo-2026", codigoConcepto: def.codigo, tratamiento: "EXENTO",
      monto: "6000.00", categoriaLimiteAnual: def.categoriaLimiteAnual,
    };
    const resultado = calcularIsrTrabajo2026(inputBase(concepto, "4000.00"));
    expect(resultado.rentaExenta).toBe("4000.00");
    expect(resultado.rentaGravadaProyectada).toBe("2000.00"); // excedente sobre el límite
  });

  it("el límite considera antecedentes de otro patrono ya reconocidos (no se duplica el tope)", () => {
    const def = resolverConceptoFiscal2026("AGUINALDO", 2026);
    const concepto: ConceptoIngresoIsr = {
      id: "aguinaldo-2026", codigoConcepto: def.codigo, tratamiento: "EXENTO",
      monto: "3000.00", categoriaLimiteAnual: def.categoriaLimiteAnual,
    };
    // Q4,000 de límite, pero ya se reconocieron Q3,500 exentos con otro patrono: solo quedan Q500 de remanente.
    const resultado = calcularIsrTrabajo2026(inputBase(concepto, "4000.00", "3500.00"));
    expect(resultado.rentaExenta).toBe("500.00");
    expect(resultado.rentaGravadaProyectada).toBe("2500.00");
  });

  it("Bono 14 usa su propia categoría de límite, independiente de AGUINALDO", () => {
    const def = resolverConceptoFiscal2026("BONO_14", 2026);
    const concepto: ConceptoIngresoIsr = {
      id: "bono14-2026", codigoConcepto: def.codigo, tratamiento: "EXENTO",
      monto: "5000.00", categoriaLimiteAnual: def.categoriaLimiteAnual,
    };
    const input = {
      ejercicio: 2026 as const, fechaCorte: "2026-07-01", periodosRestantes: 1,
      ingresosPropiosAcumulados: [] as ConceptoIngresoIsr[], ingresosPropiosProyectadosRestantes: [concepto],
      limitesExencionAnual: [{ categoria: "BONO_14", limiteQ: "4000.00", exencionExternaYaReconocidaQ: "0.00" }],
      antecedentes: null, igssLaboralPropio: { acumuladoQ: "0.00", proyectadoRestanteQ: "0.00" },
      isrRetenidoPropioQ: "0.00", deduccionesAdicionalesAdmitidas: [],
    };
    const resultado = calcularIsrTrabajo2026(input);
    expect(resultado.rentaExenta).toBe("4000.00");
    expect(resultado.rentaGravadaProyectada).toBe("1000.00");
  });
});
