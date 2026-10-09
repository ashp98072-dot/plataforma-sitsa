import { describe, expect, it } from "vitest";
import {
  badgeAdminClase,
  badgeFinancieroClase,
  calcularTotalLineas,
  calcularTotalPaginas,
  detalleCorrespondeAFactura,
  esBorrador,
  esEmitida,
  etiquetaAnular,
  evaluarSeleccion,
  etiquetaSumaTarifas,
  etiquetaTratamientoIva,
  firmaLineas,
  firmaPreview,
  formatearMonto,
  resumenTratamientoIva,
  interpretarError,
  lineaDifiereDeTarifa,
  puedeOfrecerAnular,
  puedeRegistrarOtroPago,
  validarEmision,
} from "./ui-logica";

/**
 * FACT-1-UI — pruebas de la lógica PURA reusada por los 3 componentes de
 * Facturación clientes. No existe un harness de componentes React en este
 * proyecto (vitest.config: environment "node") — mismo criterio que
 * pasosStepper/resumenCierre en TMS-REPORTES-1: se prueba la lógica
 * extraída, no el render.
 */

describe("1/2) evaluarSeleccion — solo un cliente a la vez", () => {
  const A1 = { planId: 1, clienteId: 20, cliente: "Cliente A" };
  const A2 = { planId: 2, clienteId: 20, cliente: "Cliente A" };
  const B1 = { planId: 3, clienteId: 30, cliente: "Cliente B" };

  it("1) el primer viaje seleccionado siempre se agrega", () => {
    expect(evaluarSeleccion(A1, new Map())).toEqual({ accion: "agregar" });
  });

  it("1) un segundo viaje del MISMO cliente se agrega sin problema", () => {
    const seleccion = new Map([[A1.planId, A1]]);
    expect(evaluarSeleccion(A2, seleccion)).toEqual({ accion: "agregar" });
  });

  it("2) un viaje de OTRO cliente se rechaza con mensaje claro, mencionando el cliente ya elegido", () => {
    const seleccion = new Map([[A1.planId, A1]]);
    const r = evaluarSeleccion(B1, seleccion);
    expect(r.accion).toBe("rechazar");
    if (r.accion === "rechazar") {
      expect(r.mensaje).toContain("Cliente A");
      expect(r.mensaje).toContain("mismo cliente");
    }
  });

  it("un viaje ya seleccionado se puede DESELECCIONAR aunque haya otros de otro cliente en teoría", () => {
    const seleccion = new Map([[A1.planId, A1]]);
    expect(evaluarSeleccion(A1, seleccion)).toEqual({ accion: "quitar" });
  });
});

describe("3) calcularTotalLineas — SUM de monto_asignado, nunca de tarifa_comercial", () => {
  it("suma los montos asignados de todas las líneas", () => {
    expect(calcularTotalLineas([{ montoAsignado: 100 }, { montoAsignado: 250.5 }])).toBe(350.5);
  });
  it("sin líneas, el total es 0", () => {
    expect(calcularTotalLineas([])).toBe(0);
  });
  it("ignora un montoAsignado no finito en vez de romper el total (NaN de un input vacío)", () => {
    expect(calcularTotalLineas([{ montoAsignado: 100 }, { montoAsignado: NaN }])).toBe(100);
  });
});

describe("4) lineaDifiereDeTarifa — se avisa cuando el monto a facturar se editó", () => {
  it("no difiere cuando montoAsignado === tarifaComercial", () => {
    expect(lineaDifiereDeTarifa({ tarifaComercial: 1000, montoAsignado: 1000 })).toBe(false);
  });
  it("difiere cuando se editó el monto", () => {
    expect(lineaDifiereDeTarifa({ tarifaComercial: 1000, montoAsignado: 800 })).toBe(true);
  });
  it("tarifa_comercial null nunca se marca como 'diferente' (no hay referencia real)", () => {
    expect(lineaDifiereDeTarifa({ tarifaComercial: null, montoAsignado: 500 })).toBe(false);
  });
});

describe("5/6/18) estado derivado — qué acciones ofrece cada estado_admin", () => {
  it("5) Borrador permite editar", () => {
    expect(esBorrador("Borrador")).toBe(true);
  });
  it("6) Emitida NO permite editar", () => {
    expect(esBorrador("Emitida")).toBe(false);
  });
  it("18) Anulada tampoco permite editar", () => {
    expect(esBorrador("Anulada")).toBe(false);
  });
  it("18) solo Emitida ofrece registrar pago", () => {
    expect(esEmitida("Borrador")).toBe(false);
    expect(esEmitida("Emitida")).toBe(true);
    expect(esEmitida("Anulada")).toBe(false);
  });
  it("18) anular se ofrece en Borrador y Emitida, nunca en una ya Anulada", () => {
    expect(puedeOfrecerAnular("Borrador")).toBe(true);
    expect(puedeOfrecerAnular("Emitida")).toBe(true);
    expect(puedeOfrecerAnular("Anulada")).toBe(false);
  });
});

describe("7/8) validarEmision — exige número Y fecha antes del POST", () => {
  it("7) rechaza sin número de factura", () => {
    expect(validarEmision("", "2026-08-28")).toContain("número de factura");
  });
  it("7) rechaza número en blanco (solo espacios)", () => {
    expect(validarEmision("   ", "2026-08-28")).toContain("número de factura");
  });
  it("8) rechaza sin fecha de emisión", () => {
    expect(validarEmision("F-001", "")).toContain("fecha de emisión");
  });
  it("con número y fecha, no hay error", () => {
    expect(validarEmision("F-001", "2026-08-28")).toBeNull();
  });
});

describe("10/13) URLs de acción — cada botón llama al endpoint correcto (contrato de los componentes)", () => {
  // Los propios componentes construyen la URL con template literals fijos
  // (`/facturas/${id}/pagos`, `/facturas/${id}/anular`) — no hay lógica
  // que extraer sin duplicar el string. Se deja documentado aquí: ver
  // facturas-panel.tsx `registrarPago`/`anular`/`emitir`, cada una golpea
  // exactamente el endpoint de su Fase (J/K/I) y NUNCA hace un PATCH
  // directo de estado_admin.
  it("interpretarError (10/13/14): 409 con mensaje del backend se muestra TAL CUAL, nunca reemplazado", () => {
    expect(interpretarError({ error: "El viaje ya está vinculado a otra factura." }, "fallback")).toBe(
      "El viaje ya está vinculado a otra factura.",
    );
  });
  it("14) sin mensaje del backend, usa el fallback (nunca deja el error en blanco)", () => {
    expect(interpretarError({}, "No se pudo anular la factura.")).toBe("No se pudo anular la factura.");
    expect(interpretarError(null, "No se pudo anular la factura.")).toBe("No se pudo anular la factura.");
  });
});

describe("11/12) badges de estado financiero — reflejan el saldo derivado por el backend", () => {
  it("11) 'Pago parcial' se pinta distinto de 'Sin pagos'", () => {
    expect(badgeFinancieroClase("Pago parcial")).not.toBe(badgeFinancieroClase("Sin pagos"));
  });
  it("12) 'Cobrado' (saldo cero) tiene su propio color, distinto de los otros dos", () => {
    const cobrado = badgeFinancieroClase("Cobrado");
    expect(cobrado).not.toBe(badgeFinancieroClase("Sin pagos"));
    expect(cobrado).not.toBe(badgeFinancieroClase("Pago parcial"));
  });
  it("Borrador/Anulada (estadoFinanciero null) usa el mismo neutro que 'Sin pagos'", () => {
    expect(badgeFinancieroClase(null)).toBe(badgeFinancieroClase("Sin pagos"));
  });
});

describe("15/16) calcularTotalPaginas — misma fórmula que ya usa TMS-REPORTES-1", () => {
  it("15/16) redondea hacia arriba y nunca da menos de 1 página, incluso sin resultados", () => {
    expect(calcularTotalPaginas(0, 50)).toBe(1);
    expect(calcularTotalPaginas(120, 50)).toBe(3);
    expect(calcularTotalPaginas(150, 50)).toBe(3);
    expect(calcularTotalPaginas(151, 50)).toBe(4);
  });
});

describe("HOTFIX PRE-MERGE PR #114 — Hallazgo 2: el detalle nunca corresponde a otra factura", () => {
  it("detalle==null nunca corresponde a nada (se sigue mostrando 'Cargando…', nunca contenido viejo)", () => {
    expect(detalleCorrespondeAFactura(null, 5)).toBe(false);
  });
  it("detalle de la factura #5 corresponde cuando la fila expandida es la #5", () => {
    expect(detalleCorrespondeAFactura({ factura: { id: 5 } }, 5)).toBe(true);
  });
  it("detalle de la factura #5 NO corresponde si la fila expandida es la #7 (fetch viejo que llegó tarde)", () => {
    expect(detalleCorrespondeAFactura({ factura: { id: 5 } }, 7)).toBe(false);
  });
});

describe("HOTFIX PRE-MERGE PR #114 — Hallazgo 3: no ofrecer pago con saldo 0", () => {
  it("Emitida + saldo 0 → NO se puede registrar otro pago (factura ya cobrada)", () => {
    expect(puedeRegistrarOtroPago("Emitida", 0)).toBe(false);
  });
  it("Emitida + saldo negativo (defensivo, no debería ocurrir) → tampoco se ofrece", () => {
    expect(puedeRegistrarOtroPago("Emitida", -0.01)).toBe(false);
  });
  it("Emitida + saldo > 0 → SÍ se puede registrar pago", () => {
    expect(puedeRegistrarOtroPago("Emitida", 100)).toBe(true);
  });
  it("Borrador o Anulada con saldo > 0 (no debería pasar, pero por si acaso) → nunca se ofrece pago fuera de Emitida", () => {
    expect(puedeRegistrarOtroPago("Borrador", 100)).toBe(false);
    expect(puedeRegistrarOtroPago("Anulada", 100)).toBe(false);
  });
});

describe("Fase M — cada estado_admin tiene su propio color (relleno sólido)", () => {
  it("Borrador/Emitida/Anulada nunca comparten clase", () => {
    const clases = new Set([badgeAdminClase("Borrador"), badgeAdminClase("Emitida"), badgeAdminClase("Anulada")]);
    expect(clases.size).toBe(3);
  });
});

describe("FACT-2 — una factura admite una sola moneda al seleccionar", () => {
  type Sel = { planId: number; clienteId: number; cliente: string; moneda?: string };
  const Q1: Sel = { planId: 1, clienteId: 20, cliente: "Cliente A", moneda: "GTQ" };
  const Q2: Sel = { planId: 2, clienteId: 20, cliente: "Cliente A", moneda: "GTQ" };
  const D1: Sel = { planId: 3, clienteId: 20, cliente: "Cliente A", moneda: "USD" };

  it("mismo cliente y misma moneda → se agrega", () => {
    expect(evaluarSeleccion(Q2, new Map([[1, Q1]]))).toEqual({ accion: "agregar" });
  });

  it("mismo cliente pero moneda distinta → se rechaza explicando por qué", () => {
    const r = evaluarSeleccion(D1, new Map([[1, Q1]]));
    expect(r.accion).toBe("rechazar");
    if (r.accion === "rechazar") { expect(r.mensaje).toContain("GTQ"); expect(r.mensaje).toContain("USD"); expect(r.mensaje).toContain("una sola moneda"); }
  });

  it("si falta el dato de moneda no se bloquea en la UI (el servidor decide)", () => {
    expect(evaluarSeleccion({ planId: 9, clienteId: 20, cliente: "Cliente A" }, new Map([[1, Q1]]))).toEqual({ accion: "agregar" });
  });
});

describe("FACT-2 — formatearMonto", () => {
  it("quetzales con «Q»; otra moneda con su código; sin dato → «—»", () => {
    expect(formatearMonto(1500.5)).toBe("Q1,500.50");
    expect(formatearMonto(1500.5, "GTQ")).toBe("Q1,500.50");
    expect(formatearMonto(99, "USD")).toBe("USD 99.00");
    expect(formatearMonto(null)).toBe("—");
    expect(formatearMonto(Number.NaN)).toBe("—");
  });
});

describe("FACT-2 — firmaLineas (la vista previa solo vale para la selección exacta que la generó)", () => {
  it("no depende del orden de las líneas", () => {
    expect(firmaLineas([{ planId: 1, montoAsignado: 100 }, { planId: 2, montoAsignado: 50 }]))
      .toBe(firmaLineas([{ planId: 2, montoAsignado: 50 }, { planId: 1, montoAsignado: 100 }]));
  });

  it("cambia si cambia un monto, se quita un viaje o se agrega otro", () => {
    const base = firmaLineas([{ planId: 1, montoAsignado: 100 }, { planId: 2, montoAsignado: 50 }]);
    expect(firmaLineas([{ planId: 1, montoAsignado: 101 }, { planId: 2, montoAsignado: 50 }])).not.toBe(base);
    expect(firmaLineas([{ planId: 1, montoAsignado: 100 }])).not.toBe(base);
    expect(firmaLineas([{ planId: 1, montoAsignado: 100 }, { planId: 2, montoAsignado: 50 }, { planId: 3, montoAsignado: 1 }])).not.toBe(base);
  });
});

describe("FACT-2 — etiquetaAnular", () => {
  it("un Borrador se «cancela»; una Emitida se «anula»", () => {
    expect(etiquetaAnular("Borrador")).toBe("Cancelar borrador");
    expect(etiquetaAnular("Emitida")).toBe("Anular factura");
  });
});

describe("FACT-2 — firmaPreview: la vista previa solo vale para el cliente y, de CADA línea, el viaje, el monto y SU tratamiento de IVA", () => {
  const lineas = [
    { planId: 1, montoAsignado: 100, precioIncluyeIva: true },
    { planId: 2, montoAsignado: 100, precioIncluyeIva: false },
  ];
  const base = firmaPreview({ clienteId: 20, lineas });

  it("es estable (misma entrada, en cualquier orden → misma huella)", () => {
    expect(firmaPreview({ clienteId: 20, lineas: [...lineas].reverse() })).toBe(base);
  });

  it("8) cambiar el tratamiento de IVA de CUALQUIER viaje invalida la vista previa (incluido ↔ agregado), de uno en uno", () => {
    expect(firmaPreview({ clienteId: 20, lineas: [{ ...lineas[0], precioIncluyeIva: false }, lineas[1]] })).not.toBe(base);
    expect(firmaPreview({ clienteId: 20, lineas: [lineas[0], { ...lineas[1], precioIncluyeIva: true }] })).not.toBe(base);
  });

  it("intercambiar los tratamientos entre dos viajes NO deja la misma huella (cada viaje cuenta con el suyo)", () => {
    const cruzado = [
      { planId: 1, montoAsignado: 100, precioIncluyeIva: false },
      { planId: 2, montoAsignado: 100, precioIncluyeIva: true },
    ];
    expect(firmaPreview({ clienteId: 20, lineas: cruzado })).not.toBe(base);
  });

  it("cambiar viajes, montos o cliente también la invalida", () => {
    expect(firmaPreview({ clienteId: 21, lineas })).not.toBe(base);
    expect(firmaPreview({ clienteId: 20, lineas: [lineas[0]] })).not.toBe(base);
    expect(firmaPreview({ clienteId: 20, lineas: [{ ...lineas[0], montoAsignado: 101 }, lineas[1]] })).not.toBe(base);
  });
});

describe("FACT-2 — textos del tratamiento de IVA", () => {
  it("por línea: IVA incluido / IVA agregado / Sin definir", () => {
    expect(etiquetaTratamientoIva(true)).toBe("IVA incluido");
    expect(etiquetaTratamientoIva(false)).toBe("IVA agregado");
    expect(etiquetaTratamientoIva(null)).toBe("Sin definir");
  });

  it("11) el resumen de la factura sale de sus LÍNEAS y nunca finge una sola política cuando hay mezcla", () => {
    expect(resumenTratamientoIva([true, true])).toBe("IVA incluido en la tarifa");
    expect(resumenTratamientoIva([false])).toBe("IVA agregado a la tarifa");
    expect(resumenTratamientoIva([true, false])).toBe("Mixto: varía por viaje");
    expect(resumenTratamientoIva([true, null])).toBe("Mixto: varía por viaje"); // una línea sin tratamiento congelado
    expect(resumenTratamientoIva([null, null])).toBe("Sin definir");
    expect(resumenTratamientoIva([])).toBe("Sin definir");
  });
});

describe("FACT-2 — etiquetaSumaTarifas (hallazgo de la prueba manual)", () => {
  it("al CREAR remite a la vista previa; al EDITAR (que no tiene vista previa) dice que se recalcula al guardar", () => {
    expect(etiquetaSumaTarifas(false)).toContain("vista previa");
    expect(etiquetaSumaTarifas(true)).toContain("al guardar");
    expect(etiquetaSumaTarifas(true)).not.toContain("vista previa");
  });
});
