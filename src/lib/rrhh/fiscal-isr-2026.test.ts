import { describe, expect, it } from "vitest";
import {
  calcularIsrTrabajo2026,
  ErrorMotorIsr2026,
  PARAMETROS_ISR_2026,
  type ConceptoIngresoIsr,
  type InputIsrTrabajo2026,
  type LimiteExencionAnualIsr,
} from "./fiscal-isr-2026";

/**
 * RRHH-FISCAL-ISR-MOTOR-2026 — pruebas del motor puro. Cada caso referencia
 * el punto de la norma/diseño que sustenta el número esperado (ver el
 * docblock de fiscal-isr-2026.ts para las fuentes completas):
 * - Tramos 5% / Q15,000 + 7%: Decreto 10-2012 (LAT).
 * - Deducción ordinaria Q48,000 y extraordinaria Q3,024 (solo 2026):
 *   Decreto 10-2012 y Decreto 13-2026 respectivamente.
 * - Límite de exención de aguinaldo/Bono 14 al equivalente del salario
 *   ordinario mensual: Art. 4 LAT (el motor NO calcula ese monto; lo recibe
 *   ya resuelto en `limitesExencionAnual`, ver docblock).
 */

function concepto(overrides: Partial<ConceptoIngresoIsr> = {}): ConceptoIngresoIsr {
  return {
    id: "c1",
    codigoConcepto: "SUELDO_BASE",
    tratamiento: "GRAVADO",
    monto: "0.00",
    categoriaLimiteAnual: null,
    ...overrides,
  };
}

function input(overrides: Partial<InputIsrTrabajo2026> = {}): InputIsrTrabajo2026 {
  return {
    ejercicio: 2026,
    fechaCorte: "2026-06-30",
    periodosRestantes: 6,
    ingresosPropiosAcumulados: [],
    ingresosPropiosProyectadosRestantes: [],
    limitesExencionAnual: [],
    antecedentes: null,
    igssLaboralPropio: { acumuladoQ: "0.00", proyectadoRestanteQ: "0.00" },
    isrRetenidoPropioQ: "0.00",
    deduccionesAdicionalesAdmitidas: [],
    ...overrides,
  };
}

describe("calcularIsrTrabajo2026 — tramos y renta imponible", () => {
  it("1. renta imponible cero -> ISR 0 (solo deducciones, sin ingresos)", () => {
    const r = calcularIsrTrabajo2026(input());
    expect(r.rentaGravadaProyectada).toBe("0.00");
    expect(r.rentaImponible).toBe("0.00");
    expect(r.isrAnual).toBe("0.00");
    expect(r.retencionSugerida).toBe("0.00");
  });

  it("2. primer tramo: renta imponible <= Q300,000 -> 5% plano", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "100000.00" })],
      }),
    );
    // imponible = 100000 - 48000 - 3024 = 48976.00 ; isr = 48976 * 5% = 2448.80
    expect(r.rentaImponible).toBe("48976.00");
    expect(r.isrAnual).toBe("2448.80");
  });

  it("3. segundo tramo: renta imponible > Q300,000 -> Q15,000 + 7% sobre excedente", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "400000.00" })],
      }),
    );
    // imponible = 400000 - 48000 - 3024 = 348976.00 ; excedente = 48976.00
    // isr = 15000 + 48976 * 7% = 15000 + 3428.32 = 18428.32
    expect(r.rentaImponible).toBe("348976.00");
    expect(r.isrAnual).toBe("18428.32");
  });

  it("frontera exacta Q300,000.00 usa el tramo 1 (5%), continuo con el tramo 2", () => {
    const rFrontera = calcularIsrTrabajo2026(
      input({ ingresosPropiosAcumulados: [concepto({ monto: "351024.00" })] }),
    );
    // imponible = 351024 - 51024 = 300000.00 exacto -> tramo 1: 300000*5% = 15000.00
    expect(rFrontera.rentaImponible).toBe("300000.00");
    expect(rFrontera.isrAnual).toBe("15000.00");

    const rExcedeUnCentavo = calcularIsrTrabajo2026(
      input({ ingresosPropiosAcumulados: [concepto({ monto: "351024.01" })] }),
    );
    // imponible = 300000.01 -> tramo 2: 15000 + 0.01*7% (redondeado) = 15000.00
    expect(rExcedeUnCentavo.rentaImponible).toBe("300000.01");
    expect(rExcedeUnCentavo.isrAnual).toBe("15000.00");
  });
});

describe("calcularIsrTrabajo2026 — deducciones 2026", () => {
  it("4. deducción extraordinaria de Q3,024 aplica en 2026 y NO en el objeto de parámetros de otro ejercicio", () => {
    const r = calcularIsrTrabajo2026(input());
    expect(r.deduccionExtraordinaria2026).toBe("3024.00");
    expect(PARAMETROS_ISR_2026.deduccionExtraordinariaAnualQ).toBe("3024.00");
    expect(PARAMETROS_ISR_2026.ejercicio).toBe(2026);
  });

  it("5. IGSS laboral (propio + antecedentes) es deducible de la renta gravada", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "100000.00" })],
        igssLaboralPropio: { acumuladoQ: "2000.00", proyectadoRestanteQ: "1000.00" },
        antecedentes: {
          ingresosGravadosQ: "0.00",
          ingresosExentosQ: "0.00",
          igssLaboralQ: "500.00",
          isrRetenidoQ: "0.00",
        },
      }),
    );
    expect(r.igssDeducible).toBe("3500.00");
    // imponible = 100000 - 48000 - 3024 - 3500 = 45476.00
    expect(r.rentaImponible).toBe("45476.00");
  });
});

describe("calcularIsrTrabajo2026 — proyección propia (altas, cambios, variables)", () => {
  it("6. empleado que ingresó a mitad de año: acumulado + proyectado restante se suman sin duplicarse", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ id: "ene-jun", monto: "30000.00" })],
        ingresosPropiosProyectadosRestantes: [concepto({ id: "jul-dic", monto: "30000.00" })],
      }),
    );
    expect(r.rentaGravadaProyectada).toBe("60000.00");
    expect(r.rentaBrutaProyectada).toBe("60000.00");
  });

  it("7. cambio salarial: acumulado a sueldo viejo + proyectado a sueldo nuevo, no uniforme", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ id: "sueldo-viejo", monto: "24000.00" })], // 6 meses a Q4,000
        ingresosPropiosProyectadosRestantes: [concepto({ id: "sueldo-nuevo", monto: "30000.00" })], // 6 meses a Q5,000
      }),
    );
    expect(r.rentaGravadaProyectada).toBe("54000.00");
  });

  it("8. ingresos variables: varios conceptos gravados con montos distintos se acumulan", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [
          concepto({ id: "comision-1", codigoConcepto: "COMISION", monto: "1500.00" }),
          concepto({ id: "comision-2", codigoConcepto: "COMISION", monto: "2750.50" }),
          concepto({ id: "sueldo", monto: "24000.00" }),
        ],
      }),
    );
    expect(r.rentaGravadaProyectada).toBe("28250.50");
  });
});

describe("calcularIsrTrabajo2026 — antecedentes de patrono anterior", () => {
  it("9. antecedentes de patrono anterior se incorporan a renta gravada/exenta e IGSS", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "50000.00" })],
        antecedentes: {
          ingresosGravadosQ: "20000.00",
          ingresosExentosQ: "5000.00",
          igssLaboralQ: "966.00",
          isrRetenidoQ: "300.00",
        },
      }),
    );
    expect(r.rentaGravadaProyectada).toBe("70000.00");
    expect(r.rentaExenta).toBe("5000.00");
    expect(r.igssDeducible).toBe("966.00");
    expect(r.isrRetenidoPrevio).toBe("300.00");
  });

  it("10. ISR retenido anteriormente (propio y de otro patrono) se reporta por separado", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "400000.00" })],
        isrRetenidoPropioQ: "5000.00",
        antecedentes: {
          ingresosGravadosQ: "0.00",
          ingresosExentosQ: "0.00",
          igssLaboralQ: "0.00",
          isrRetenidoQ: "1000.00",
        },
      }),
    );
    expect(r.isrRetenidoPropio).toBe("5000.00");
    expect(r.isrRetenidoPrevio).toBe("1000.00");
    // isrAnual (18428.32, ver test de tramo 2) - 5000 - 1000 = 12428.32
    expect(r.isrAnual).toBe("18428.32");
    expect(r.saldoIsr).toBe("12428.32");
  });

  it("11. no hay doble contabilización de antecedentes (se suman exactamente una vez)", () => {
    const antecedentes = {
      ingresosGravadosQ: "10000.00",
      ingresosExentosQ: "0.00",
      igssLaboralQ: "0.00",
      isrRetenidoQ: "700.00",
    };
    const r = calcularIsrTrabajo2026(
      input({ ingresosPropiosAcumulados: [concepto({ monto: "5000.00" })], antecedentes }),
    );
    // 5000 (propio) + 10000 (antecedente) = 15000, no 25000 ni 20000.
    expect(r.rentaGravadaProyectada).toBe("15000.00");
    expect(r.isrRetenidoPrevio).toBe("700.00");
  });
});

describe("calcularIsrTrabajo2026 — saldo, retención sugerida y devolución", () => {
  it("12. saldo ya cubierto por retenciones previas -> retención sugerida 0", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "100000.00" })],
        isrRetenidoPropioQ: "3000.00", // isr anual de este caso es 2448.80 (ver test de tramo 1)
      }),
    );
    expect(r.isrAnual).toBe("2448.80");
    expect(r.ajustePendiente).toBe("0.00");
    expect(r.retencionSugerida).toBe("0.00");
  });

  it("13. saldo negativo reporta posible devolución/ajuste sin ejecutarla", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "100000.00" })],
        isrRetenidoPropioQ: "3000.00",
      }),
    );
    expect(r.saldoIsr).toBe("-551.20");
    expect(r.posibleDevolucion).toBe("551.20");
    expect(r.ajustePendiente).toBe("0.00");
    expect(r.retencionSugerida).toBe("0.00");
    expect(r.advertencias.some((a) => a.includes("posible devolución"))).toBe(true);
  });

  it("retención nunca es negativa aunque el saldo sea muy negativo", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "10000.00" })],
        isrRetenidoPropioQ: "999999.00",
      }),
    );
    expect(Number(r.retencionSugerida)).toBeGreaterThanOrEqual(0);
    expect(r.retencionSugerida).toBe("0.00");
  });

  it("saldo pendiente sin períodos restantes: retención sugerida 0 y advertencia explícita (liquidación es otro PR)", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "100000.00" })],
        periodosRestantes: 0,
      }),
    );
    expect(r.ajustePendiente).not.toBe("0.00");
    expect(r.retencionSugerida).toBe("0.00");
    expect(r.advertencias.some((a) => a.includes("liquidación"))).toBe(true);
  });
});

describe("calcularIsrTrabajo2026 — conceptos sin clasificar bloquean el cálculo", () => {
  it("14a. concepto PENDIENTE bloquea con error explícito, no adivina", () => {
    expect(() =>
      calcularIsrTrabajo2026(
        input({ ingresosPropiosAcumulados: [concepto({ tratamiento: "PENDIENTE", monto: "500.00" })] }),
      ),
    ).toThrow(ErrorMotorIsr2026);
    try {
      calcularIsrTrabajo2026(input({ ingresosPropiosAcumulados: [concepto({ tratamiento: "PENDIENTE", monto: "500.00" })] }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorMotorIsr2026);
      expect((e as ErrorMotorIsr2026).codigo).toBe("CONCEPTO_SIN_CLASIFICAR");
    }
  });

  it("14b. concepto CONDICIONAL (sin evidencia suficiente resuelta) también bloquea", () => {
    expect(() =>
      calcularIsrTrabajo2026(
        input({ ingresosPropiosAcumulados: [concepto({ tratamiento: "CONDICIONAL", monto: "500.00" })] }),
      ),
    ).toThrow(ErrorMotorIsr2026);
  });
});

describe("calcularIsrTrabajo2026 — límites de exención anual (aguinaldo/Bono 14)", () => {
  it("15. exento sujeto a límite anual: excedente sobre el tope se grava", () => {
    const limites: LimiteExencionAnualIsr[] = [
      { categoria: "AGUINALDO", limiteQ: "4000.00", exencionExternaYaReconocidaQ: "0.00" },
    ];
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [
          concepto({ id: "aguinaldo", codigoConcepto: "AGUINALDO", tratamiento: "EXENTO", monto: "6000.00", categoriaLimiteAnual: "AGUINALDO" }),
        ],
        limitesExencionAnual: limites,
      }),
    );
    expect(r.rentaExenta).toBe("4000.00");
    expect(r.rentaGravadaProyectada).toBe("2000.00");
    expect(r.advertencias.some((a) => a.includes("AGUINALDO"))).toBe(true);
  });

  it("dentro del límite: todo queda exento, nada se grava", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [
          concepto({ id: "bono14", codigoConcepto: "BONO14", tratamiento: "EXENTO", monto: "3000.00", categoriaLimiteAnual: "BONO14" }),
        ],
        limitesExencionAnual: [{ categoria: "BONO14", limiteQ: "4500.00", exencionExternaYaReconocidaQ: "0.00" }],
      }),
    );
    expect(r.rentaExenta).toBe("3000.00");
    expect(r.rentaGravadaProyectada).toBe("0.00");
  });

  it("16. antecedentes externos ya reconocidos reducen el remanente disponible del límite", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [
          concepto({ id: "aguinaldo", codigoConcepto: "AGUINALDO", tratamiento: "EXENTO", monto: "3000.00", categoriaLimiteAnual: "AGUINALDO" }),
        ],
        limitesExencionAnual: [
          { categoria: "AGUINALDO", limiteQ: "4000.00", exencionExternaYaReconocidaQ: "3500.00" },
        ],
      }),
    );
    // remanente = 4000 - 3500 = 500 ; de los 3000, solo 500 quedan exentos, 2500 se gravan.
    expect(r.rentaExenta).toBe("500.00");
    expect(r.rentaGravadaProyectada).toBe("2500.00");
  });

  it("concepto EXENTO con categoriaLimiteAnual sin límite declarado bloquea con error explícito", () => {
    expect(() =>
      calcularIsrTrabajo2026(
        input({
          ingresosPropiosAcumulados: [
            concepto({ tratamiento: "EXENTO", monto: "1000.00", categoriaLimiteAnual: "SIN_LIMITE_DECLARADO" }),
          ],
        }),
      ),
    ).toThrow(/LIMITE_EXENCION_FALTANTE|límite de exención/);
  });

  it("categoría de límite duplicada en la entrada bloquea con error explícito", () => {
    expect(() =>
      calcularIsrTrabajo2026(
        input({
          limitesExencionAnual: [
            { categoria: "AGUINALDO", limiteQ: "4000.00", exencionExternaYaReconocidaQ: "0.00" },
            { categoria: "AGUINALDO", limiteQ: "4000.00", exencionExternaYaReconocidaQ: "0.00" },
          ],
        }),
      ),
    ).toThrow(/duplicado/);
  });
});

describe("calcularIsrTrabajo2026 — precisión, determinismo y aislamiento por ejercicio", () => {
  it("17. montos grandes sin pérdida de precisión (sin floating point)", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "12345678.91" })],
      }),
    );
    // imponible = 12345678.91 - 51024.00 = 12294654.91 ; > 300000 -> tramo 2
    // excedente = 12294654.91 - 300000.00 = 11994654.91
    // isr = 15000 + 11994654.91 * 7% = 15000 + 839625.8437 -> redondeo half-up centavo = 839625.84
    expect(r.rentaImponible).toBe("12294654.91");
    expect(r.isrAnual).toBe("854625.84");
  });

  it("18. cálculo determinista: misma entrada produce siempre la misma salida, sin mutar el input", () => {
    const base = input({
      ingresosPropiosAcumulados: [concepto({ monto: "77777.77" })],
      antecedentes: { ingresosGravadosQ: "1234.56", ingresosExentosQ: "0.00", igssLaboralQ: "0.00", isrRetenidoQ: "0.00" },
    });
    const snapshot = JSON.parse(JSON.stringify(base));
    const r1 = calcularIsrTrabajo2026(base);
    const r2 = calcularIsrTrabajo2026(base);
    expect(r1).toEqual(r2);
    expect(base).toEqual(snapshot);
  });

  it("19. los parámetros de 2026 no se reutilizan automáticamente para otro ejercicio", () => {
    expect(() => calcularIsrTrabajo2026(input({ ejercicio: 2027 }))).toThrow(ErrorMotorIsr2026);
    try {
      calcularIsrTrabajo2026(input({ ejercicio: 2027 }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorMotorIsr2026);
      expect((e as ErrorMotorIsr2026).codigo).toBe("EJERCICIO_NO_SOPORTADO");
    }
  });
});

describe("calcularIsrTrabajo2026 — validación de entrada", () => {
  it("rechaza un monto con formato inválido (no floating point implícito)", () => {
    expect(() =>
      calcularIsrTrabajo2026(input({ isrRetenidoPropioQ: "100" as unknown as string })),
    ).toThrow(ErrorMotorIsr2026);
  });

  it("rechaza periodosRestantes negativo", () => {
    expect(() => calcularIsrTrabajo2026(input({ periodosRestantes: -1 }))).toThrow(ErrorMotorIsr2026);
  });
});

describe("calcularIsrTrabajo2026 — motor SOLO PROYECCION: bloquea deducciones de liquidación anual", () => {
  it("1. donación en proyección -> bloquea con código explícito", () => {
    expect(() =>
      calcularIsrTrabajo2026(
        input({ deduccionesAdicionalesAdmitidas: [{ tipo: "DONACION", montoAdmitidoQ: "500.00" }] }),
      ),
    ).toThrow(ErrorMotorIsr2026);
    try {
      calcularIsrTrabajo2026(
        input({ deduccionesAdicionalesAdmitidas: [{ tipo: "DONACION", montoAdmitidoQ: "500.00" }] }),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorMotorIsr2026);
      expect((e as ErrorMotorIsr2026).codigo).toBe("DEDUCCION_NO_ADMITIDA_EN_PROYECCION");
      expect((e as ErrorMotorIsr2026).message).toContain("liquidación");
    }
  });

  it("2. seguro de vida en proyección -> bloquea con código explícito", () => {
    try {
      calcularIsrTrabajo2026(
        input({ deduccionesAdicionalesAdmitidas: [{ tipo: "SEGURO_VIDA", montoAdmitidoQ: "300.00" }] }),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorMotorIsr2026);
      expect((e as ErrorMotorIsr2026).codigo).toBe("DEDUCCION_NO_ADMITIDA_EN_PROYECCION");
    }
  });

  it("3. Planilla/crédito IVA en proyección -> bloquea con código explícito", () => {
    try {
      calcularIsrTrabajo2026(
        input({ deduccionesAdicionalesAdmitidas: [{ tipo: "IVA_PLANILLA", montoAdmitidoQ: "1000.00" }] }),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorMotorIsr2026);
      expect((e as ErrorMotorIsr2026).codigo).toBe("DEDUCCION_NO_ADMITIDA_EN_PROYECCION");
    }
  });

  it("un tipo de deducción completamente desconocido también bloquea (enum cerrado, no solo lista negra)", () => {
    try {
      calcularIsrTrabajo2026(
        input({ deduccionesAdicionalesAdmitidas: [{ tipo: "CREDITO_FISCAL_INVENTADO", montoAdmitidoQ: "10.00" }] }),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorMotorIsr2026);
      expect((e as ErrorMotorIsr2026).codigo).toBe("DEDUCCION_NO_ADMITIDA_EN_PROYECCION");
    }
  });

  it("4. IGSS sigue aplicándose correctamente tras la corrección (no afectado por el bloqueo de deducciones)", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "100000.00" })],
        igssLaboralPropio: { acumuladoQ: "2000.00", proyectadoRestanteQ: "1000.00" },
      }),
    );
    expect(r.igssDeducible).toBe("3000.00");
    // imponible = 100000 - 48000 - 3024 - 3000 = 45976.00
    expect(r.rentaImponible).toBe("45976.00");
  });

  it("5. la deducción extraordinaria Q3,024 de 2026 sigue aplicándose tras la corrección", () => {
    const r = calcularIsrTrabajo2026(input());
    expect(r.deduccionExtraordinaria2026).toBe("3024.00");
  });

  it("6. la aritmética de tramos no cambió (mismos resultados que antes de la corrección)", () => {
    const tramo1 = calcularIsrTrabajo2026(input({ ingresosPropiosAcumulados: [concepto({ monto: "100000.00" })] }));
    expect(tramo1.rentaImponible).toBe("48976.00");
    expect(tramo1.isrAnual).toBe("2448.80");

    const tramo2 = calcularIsrTrabajo2026(input({ ingresosPropiosAcumulados: [concepto({ monto: "400000.00" })] }));
    expect(tramo2.rentaImponible).toBe("348976.00");
    expect(tramo2.isrAnual).toBe("18428.32");
  });

  it("PREVISION_SOCIAL_OTRA sigue admitida en proyección (único tipo del enum cerrado)", () => {
    const r = calcularIsrTrabajo2026(
      input({
        ingresosPropiosAcumulados: [concepto({ monto: "100000.00" })],
        deduccionesAdicionalesAdmitidas: [{ tipo: "PREVISION_SOCIAL_OTRA", montoAdmitidoQ: "600.00" }],
      }),
    );
    expect(r.otrasDeduccionesAdmitidas).toBe("600.00");
    // imponible = 100000 - 48000 - 3024 - 600 = 48376.00
    expect(r.rentaImponible).toBe("48376.00");
  });
});
