import { describe, expect, it } from "vitest";
import { badgeCobro, badgeFacturacion, pasosStepper, resumenCierre } from "./page";

/**
 * CORRECCIÓN PR #112 (HALLAZGO 1): "Cerrar viaje" ya no ejecuta el POST al
 * primer clic — primero muestra este resumen de confirmación. Este
 * proyecto no tiene un harness de pruebas de componentes React, así que
 * se prueba la función PURA que arma el resumen (mismo criterio ya usado
 * en el resto del repo: probar la lógica extraíble, no el renderizado).
 */
function plan(overrides: Partial<Parameters<typeof resumenCierre>[0]>): Parameters<typeof resumenCierre>[0] {
  return {
    id: 1, codigo: "PLAN-20260827-001", fechaPlan: "2026-08-27", horaCarga: null, estado: "En ruta",
    pendienteCierre: true, cerradoPor: null, cerradoEn: null, clienteId: null, cliente: "Cliente X",
    rutaCodigo: null, lugarDescargaHistorico: null, referenciaCliente: null, tipoTraslado: null,
    regresoEstimado: null, tarifaComercial: 1500, placa: "C-034BXR", unidadTipo: null, unidadCapacidad: null,
    pilotoId: null, piloto: "Juan Pérez", auxiliares: [], paradas: [], evidencias: 3,
    horaSalida: "2026-08-27T07:00", horaLlegada: "2026-08-27T18:00", kmSalida: 1000, kmLlegada: 1350,
    kmRecorridos: 350, diasRuta: 1,
    estadoFacturacion: "No aplica", facturaId: null, numeroFactura: null, estadoAdminFactura: null,
    estadoFinancieroFactura: null, montoFacturadoViaje: null, montoBorradorViaje: null,
    totalFactura: null, totalPagadoFactura: null, saldoFactura: null,
    ...overrides,
  };
}

describe("resumenCierre — datos mínimos exigidos por la confirmación", () => {
  it("incluye código, cliente, placa, piloto, horas, km, evidencias y tarifa", () => {
    const r = resumenCierre(plan({}));
    expect(r.codigo).toBe("PLAN-20260827-001");
    expect(r.cliente).toBe("Cliente X");
    expect(r.placa).toBe("C-034BXR");
    expect(r.piloto).toBe("Juan Pérez");
    expect(r.horaSalida).toBe("2026-08-27 07:00");
    expect(r.horaLlegada).toBe("2026-08-27 18:00");
    expect(r.kmSalida).toBe("1000");
    expect(r.kmLlegada).toBe("1350");
    expect(r.evidencias).toBe(3);
    expect(r.tarifa).toContain("1,500");
  });

  it("usa '—' para campos ausentes en vez de undefined/null crudo", () => {
    const r = resumenCierre(plan({ cliente: null, placa: null, piloto: null, horaSalida: null, horaLlegada: null, kmSalida: null, kmLlegada: null }));
    expect(r.cliente).toBe("—");
    expect(r.placa).toBe("—");
    expect(r.piloto).toBe("—");
    expect(r.horaSalida).toBe("—");
    expect(r.horaLlegada).toBe("—");
    expect(r.kmSalida).toBe("—");
    expect(r.kmLlegada).toBe("—");
  });

  it("tarifa null se muestra como 'Pendiente', nunca Q0.00", () => {
    const r = resumenCierre(plan({ tarifaComercial: null }));
    expect(r.tarifa).toBe("Pendiente");
  });
});

/**
 * CORRECCIÓN PR #112 (último detalle 1): el orden visual quedaba
 * invertido — "Cargado (opcional)" aparecía ANTES de "Programado". El
 * orden correcto es Programado → Cargado (opcional) → En ruta →
 * Llegada registrada → Pendiente de cierre → Cerrado.
 */
describe("pasosStepper — orden correcto y semántica de 'Cargado (opcional)'", () => {
  it("el orden de las etiquetas es exactamente Programado, Cargado (opcional), En ruta, Llegada registrada, Pendiente de cierre, Cerrado", () => {
    const pasos = pasosStepper(plan({ estado: "Programado", horaSalida: null, horaLlegada: null, pendienteCierre: false }));
    expect(pasos.map((p) => p.label)).toEqual([
      "Programado",
      "Cargado (opcional)",
      "En ruta",
      "Llegada registrada",
      "Pendiente de cierre",
      "Cerrado",
    ]);
  });

  it("estado actual 'Cargado' → se marca hecho=true (dato real, no inferido)", () => {
    const pasos = pasosStepper(plan({ estado: "Cargado", horaSalida: null, horaLlegada: null, pendienteCierre: false }));
    const cargado = pasos.find((p) => p.label === "Cargado (opcional)")!;
    expect(cargado.hecho).toBe(true);
    expect(cargado.opcionalSinDato).toBeFalsy();
  });

  it("plan ya en 'En ruta' (o más adelante) → Cargado queda SIN DATO, nunca inferido como ocurrido", () => {
    const pasos = pasosStepper(plan({ estado: "En ruta", horaSalida: "2026-08-27T07:00", horaLlegada: null, pendienteCierre: false }));
    const cargado = pasos.find((p) => p.label === "Cargado (opcional)")!;
    expect(cargado.hecho).toBe(false);
    expect(cargado.opcionalSinDato).toBe(true);
  });

  it("Programado → En ruta directo (sin pasar por Cargado) sigue siendo un flujo válido: Cargado no bloquea ni se marca hecho", () => {
    const pasos = pasosStepper(plan({ estado: "En ruta", horaSalida: "2026-08-27T07:00", horaLlegada: "2026-08-27T18:00", pendienteCierre: true }));
    expect(pasos.find((p) => p.label === "Cargado (opcional)")!.hecho).toBe(false);
    expect(pasos.find((p) => p.label === "Llegada registrada")!.hecho).toBe(true);
    expect(pasos.find((p) => p.label === "Pendiente de cierre")!.hecho).toBe(true);
  });

  it("no crea ningún estado nuevo — los pasos derivan solo de estado/horaSalida/horaLlegada/pendienteCierre ya existentes", () => {
    const pasos = pasosStepper(plan({ estado: "Cerrado", horaSalida: "2026-08-27T07:00", horaLlegada: "2026-08-27T18:00", pendienteCierre: false }));
    expect(pasos.find((p) => p.label === "Cerrado")!.hecho).toBe(true);
  });
});

describe("FACT-1-TMS-REPORTES (Fase M) — badges de facturación/cobro: color sólido, cada estado distinto", () => {
  it("badgeFacturacion: Pendiente/Borrador/Facturado/No aplica nunca comparten clase", () => {
    const clases = new Set([
      badgeFacturacion("Pendiente de facturación").clase,
      badgeFacturacion("En borrador de factura").clase,
      badgeFacturacion("Facturado").clase,
      badgeFacturacion("No aplica").clase,
    ]);
    expect(clases.size).toBe(4);
  });

  it("badgeCobro: Sin pagos/Pago parcial/Cobrado tienen colores distintos; null se muestra '—'", () => {
    expect(badgeCobro("Sin pagos").clase).not.toBe(badgeCobro("Pago parcial").clase);
    expect(badgeCobro("Pago parcial").clase).not.toBe(badgeCobro("Cobrado").clase);
    expect(badgeCobro(null).texto).toBe("—");
  });
});
