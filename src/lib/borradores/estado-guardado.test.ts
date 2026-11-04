import { describe, expect, it } from "vitest";
import { ESTADO_GUARDADO_INICIAL, reducirEstadoGuardado, type EstadoGuardado, type EventoGuardado } from "./index";

const aplicar = (eventos: EventoGuardado[], desde: EstadoGuardado = ESTADO_GUARDADO_INICIAL) => eventos.reduce(reducirEstadoGuardado, desde);

describe("máquina de estados de guardado local", () => {
  it("flujo normal: cambio → pendiente → guardando → guardado", () => {
    expect(aplicar([{ tipo: "cambio" }]).estado).toBe("pendiente");
    expect(aplicar([{ tipo: "cambio" }, { tipo: "inicio_guardado" }]).estado).toBe("guardando");
    expect(aplicar([{ tipo: "cambio" }, { tipo: "inicio_guardado" }, { tipo: "guardado_ok", revision: 1 }])).toMatchObject({ estado: "guardado", revision: 1 });
  });

  it("un cambio durante «guardando» no se pierde: al confirmar vuelve a «pendiente»", () => {
    const s = aplicar([{ tipo: "cambio" }, { tipo: "inicio_guardado" }, { tipo: "cambio" }]);
    expect(s).toMatchObject({ estado: "guardando", cambiosPosteriores: true });
    expect(reducirEstadoGuardado(s, { tipo: "guardado_ok", revision: 2 })).toMatchObject({ estado: "pendiente", revision: 2, cambiosPosteriores: false });
  });

  it("fallo de almacenamiento: queda en error con el motivo y un cambio/reintento lo reactiva", () => {
    const err = aplicar([{ tipo: "cambio" }, { tipo: "inicio_guardado" }, { tipo: "guardado_fallo", motivo: "cuota_excedida" }]);
    expect(err).toMatchObject({ estado: "error_almacenamiento", motivoError: "cuota_excedida" });
    expect(reducirEstadoGuardado(err, { tipo: "inicio_guardado" }).estado).toBe("guardando"); // reintento
    expect(reducirEstadoGuardado(err, { tipo: "cambio" })).toMatchObject({ estado: "pendiente", motivoError: null });
  });

  it("incompatible es terminal: ni cambios ni guardados lo reabren; solo reiniciar", () => {
    const inc = aplicar([{ tipo: "borrador_incompatible" }]);
    expect(inc.estado).toBe("incompatible");
    for (const e of [{ tipo: "cambio" }, { tipo: "inicio_guardado" }, { tipo: "guardado_ok", revision: 3 }, { tipo: "guardado_fallo", motivo: "escritura_fallida" }] as EventoGuardado[]) {
      expect(reducirEstadoGuardado(inc, e).estado).toBe("incompatible");
    }
    expect(reducirEstadoGuardado(inc, { tipo: "reiniciar" }).estado).toBe("inicial");
  });

  it("un fallo por versión incompatible al guardar pasa a «incompatible»", () => {
    expect(aplicar([{ tipo: "cambio" }, { tipo: "inicio_guardado" }, { tipo: "guardado_fallo", motivo: "version_incompatible" }]).estado).toBe("incompatible");
  });

  it("eventos fuera de orden se ignoran (no hay éxito sin haber empezado a guardar)", () => {
    expect(reducirEstadoGuardado(ESTADO_GUARDADO_INICIAL, { tipo: "guardado_ok", revision: 1 }).estado).toBe("inicial");
    expect(reducirEstadoGuardado(ESTADO_GUARDADO_INICIAL, { tipo: "inicio_guardado" }).estado).toBe("inicial");
    expect(reducirEstadoGuardado(ESTADO_GUARDADO_INICIAL, { tipo: "guardado_fallo", motivo: "escritura_fallida" }).estado).toBe("inicial");
  });

  it("reiniciar con una revisión recuperada arranca en «guardado»", () => {
    expect(reducirEstadoGuardado(ESTADO_GUARDADO_INICIAL, { tipo: "reiniciar", revision: 7 })).toMatchObject({ estado: "guardado", revision: 7 });
  });
});
