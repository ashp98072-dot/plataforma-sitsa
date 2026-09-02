import { describe, expect, it } from "vitest";
import type { AsignacionOperativaPortal } from "@/lib/flota/viajes-piloto";
import { paginarViajesPortal, separarViajesPortal, viajePortalFinalizado } from "./viajes-portal-ui";

function viaje(planId: number, estado: string, fecha: string, viajeEstado: string | null = null): AsignacionOperativaPortal {
  return {
    planId, estado, fecha, viajeEstado, codigo: `V-${planId}`, horaSalida: "08:00:00",
    regresoEstimado: null, cliente: null, origen: null, destino: null, placa: null,
    piloto: null, auxiliares: [], viajeId: null, kmSalida: null, odometroFuncional: true,
  };
}

describe("organización de viajes en el portal", () => {
  it("considera finalizado el plan cerrado/cancelado o el viaje técnico cerrado", () => {
    expect(viajePortalFinalizado(viaje(1, "Cerrado", "2026-09-01"))).toBe(true);
    expect(viajePortalFinalizado(viaje(2, "Cancelado", "2026-09-01"))).toBe(true);
    expect(viajePortalFinalizado(viaje(3, "En ruta", "2026-09-01", "cerrado"))).toBe(true);
    expect(viajePortalFinalizado(viaje(4, "Programado", "2026-09-01"))).toBe(false);
  });

  it("pone pendientes cronológicos y finalizados recientes primero sin mutar la entrada", () => {
    const entrada = [
      viaje(1, "Cerrado", "2026-08-20"),
      viaje(2, "Programado", "2026-09-04"),
      viaje(3, "Cerrado", "2026-08-30"),
      viaje(4, "En ruta", "2026-09-02", "abierto"),
      viaje(5, "Programado", "2026-09-03"),
    ];
    const idsOriginales = entrada.map((item) => item.planId);

    const resultado = separarViajesPortal(entrada);

    expect(resultado.pendientes.map((item) => item.planId)).toEqual([4, 5, 2]);
    expect(resultado.finalizados.map((item) => item.planId)).toEqual([3, 1]);
    expect(entrada.map((item) => item.planId)).toEqual(idsOriginales);
  });

  it("pagina el historial y corrige páginas fuera de rango", () => {
    const historial = Array.from({ length: 19 }, (_, indice) =>
      viaje(indice + 1, "Cerrado", `2026-08-${String(indice + 1).padStart(2, "0")}`),
    );

    expect(paginarViajesPortal(historial, 2).viajes.map((item) => item.planId)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(paginarViajesPortal(historial, 99)).toMatchObject({ pagina: 3, totalPaginas: 3, desde: 17, hasta: 19 });
    expect(paginarViajesPortal([], -5)).toMatchObject({ pagina: 1, totalPaginas: 1, desde: 0, hasta: 0, viajes: [] });
  });
});
