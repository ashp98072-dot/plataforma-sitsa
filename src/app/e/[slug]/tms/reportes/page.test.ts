import { describe, expect, it } from "vitest";
import { resumenCierre } from "./page";

/**
 * CORRECCIÓN PR #112 (HALLAZGO 1): "Cerrar viaje" ya no ejecuta el POST al
 * primer clic — primero muestra este resumen de confirmación. Este
 * proyecto no tiene un harness de pruebas de componentes React, así que
 * se prueba la función PURA que arma el resumen (mismo criterio ya usado
 * en el resto del repo: probar la lógica extraíble, no el renderizado).
 */
function plan(overrides: Partial<Parameters<typeof resumenCierre>[0]>) {
  return {
    id: 1, codigo: "PLAN-20260827-001", fechaPlan: "2026-08-27", horaCarga: null, estado: "En ruta",
    pendienteCierre: true, cerradoPor: null, cerradoEn: null, clienteId: null, cliente: "Cliente X",
    rutaCodigo: null, lugarDescargaHistorico: null, referenciaCliente: null, tipoTraslado: null,
    regresoEstimado: null, tarifaComercial: 1500, placa: "C-034BXR", unidadTipo: null, unidadCapacidad: null,
    pilotoId: null, piloto: "Juan Pérez", auxiliares: [], paradas: [], evidencias: 3,
    horaSalida: "2026-08-27T07:00", horaLlegada: "2026-08-27T18:00", kmSalida: 1000, kmLlegada: 1350,
    kmRecorridos: 350, diasRuta: 1,
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
