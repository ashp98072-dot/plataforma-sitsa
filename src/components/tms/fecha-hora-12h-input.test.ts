import { describe, expect, it } from "vitest";
import {
  actualizarEstadoFechaHora12,
  inicializarEstadoFechaHora12,
  separarFechaHora,
  sincronizarEstadoFechaHora12,
  siguienteValorFechaHora12,
  type EstadoFechaHora12,
} from "./fecha-hora-12h-input";

/**
 * OPERACIONES-HORA-12H-1 ("Regreso estimado") — mismo criterio de prueba
 * que hora-input-12h.test.ts: se prueba la lógica PURA extraída, nunca se
 * renderiza el DOM. `separarFechaHora`/`siguienteValorFechaHora12` son
 * funciones inversas entre sí sobre el MISMO contrato que ya exige la
 * API (`"YYYY-MM-DDTHH:mm"`, regex en .../tms/planes/route.ts).
 */
describe("separarFechaHora", () => {
  it("valor vacío -> fecha y hora vacías", () => {
    expect(separarFechaHora("")).toEqual({ fecha: "", hora24: "" });
  });

  it("edición de un valor existente: separa correctamente fecha y hora", () => {
    expect(separarFechaHora("2026-09-14T08:00")).toEqual({ fecha: "2026-09-14", hora24: "08:00" });
    expect(separarFechaHora("2026-12-25T17:30")).toEqual({ fecha: "2026-12-25", hora24: "17:30" });
  });
});

describe("siguienteValorFechaHora12", () => {
  it("fecha + hora AM -> 'YYYY-MM-DDTHH:mm' reconstruido exacto", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "08:00")).toBe("2026-09-14T08:00");
  });

  it("fecha + hora PM -> 'YYYY-MM-DDTHH:mm' reconstruido exacto", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "17:30")).toBe("2026-09-14T17:30");
  });

  it("12:00 AM (medianoche, HH:mm=00:00) se reconstruye tal cual", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "00:00")).toBe("2026-09-14T00:00");
  });

  it("12:00 PM (mediodía, HH:mm=12:00) se reconstruye tal cual", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "12:00")).toBe("2026-09-14T12:00");
  });

  it("colapsa a '' si falta la fecha", () => {
    expect(siguienteValorFechaHora12("", "08:00")).toBe("");
  });

  it("colapsa a '' si falta la hora", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "")).toBe("");
  });

  it("colapsa a '' si faltan ambas", () => {
    expect(siguienteValorFechaHora12("", "")).toBe("");
  });
});

/**
 * Round-trip: separarFechaHora + siguienteValorFechaHora12 deben ser
 * consistentes entre sí — la garantía real de que "al editar un valor
 * existente, separar correctamente fecha y hora" y "al guardar,
 * reconstruir exactamente YYYY-MM-DDTHH:mm" (§4/§5 del ticket original).
 */
describe("round-trip 'YYYY-MM-DDTHH:mm' -> separado -> reconstruido", () => {
  it.each(["2026-09-14T08:00", "2026-09-14T00:00", "2026-09-14T12:00", "2026-12-31T23:59"])(
    "%s se conserva exacto tras separarFechaHora + siguienteValorFechaHora12",
    (value) => {
      const { fecha, hora24 } = separarFechaHora(value);
      expect(siguienteValorFechaHora12(fecha, hora24)).toBe(value);
    },
  );

  it("'' se conserva '' (nunca se inventa una fecha/hora)", () => {
    const { fecha, hora24 } = separarFechaHora("");
    expect(siguienteValorFechaHora12(fecha, hora24)).toBe("");
  });
});

/**
 * CORRECCIÓN post-revisión PR #265 — bug confirmado en producción:
 * elegir solo la hora (o solo la fecha) con el valor inicial vacío hacía
 * IMPOSIBLE construir un valor nuevo, porque el borrador se derivaba
 * únicamente de `value` y `value` volvía a "" en cada cambio parcial.
 *
 * `inicializarEstadoFechaHora12`/`actualizarEstadoFechaHora12`/
 * `sincronizarEstadoFechaHora12` son las MISMAS 3 funciones puras que usa
 * el componente (useState/useEffect solo las invoca) — cada test aquí
 * simula la secuencia real de renders/interacciones sin renderizar DOM
 * (este proyecto no tiene harness de componentes React: environment
 * "node" en vitest.config.mts, y solo se incluyen archivos `*.test.ts`).
 *
 * Reproduce EXACTAMENTE los 9 escenarios pedidos.
 */
describe("FechaHora12Input — estado con borrador (corrección post-revisión PR #265)", () => {
  // 1) valor inicial vacío
  it("1) valor inicial vacío -> borrador y emitido vacíos", () => {
    const estado = inicializarEstadoFechaHora12("");
    expect(estado).toEqual<EstadoFechaHora12>({ draft: { fecha: "", hora24: "" }, ultimoEmitido: "" });
  });

  // 2) seleccionar primero hora -> la hora permanece
  // 3) luego seleccionar fecha -> emite YYYY-MM-DDTHH:mm
  it("2) y 3) hora primero: la hora permanece visualmente hasta que la fecha completa el valor", () => {
    let estado = inicializarEstadoFechaHora12("");

    // El usuario elige la hora (Hora12Input ya resuelve el HH:mm completo,
    // p. ej. 08:00 AM -> "08:00" — ver Hora12Input, sin cambios).
    estado = actualizarEstadoFechaHora12(estado, { hora24: "08:00" });
    expect(estado.draft).toEqual({ fecha: "", hora24: "08:00" });
    expect(estado.ultimoEmitido).toBe(""); // falta la fecha -> el padre recibe "" (mismo contrato de siempre)

    // El componente llama onChange(""); el padre guarda form.regresoEstimado
    // = "" (sin cambio real, ya era ""); React vuelve a pasar value=""
    // como prop -> se dispara el efecto -> sincronizarEstadoFechaHora12.
    estado = sincronizarEstadoFechaHora12(estado, "");
    // NÚCLEO DEL FIX: "" es el eco del propio onChange (coincide con
    // ultimoEmitido) -> el borrador NO se pisa, la hora sigue ahí.
    expect(estado.draft.hora24).toBe("08:00");

    // Ahora el usuario elige la fecha -> el borrador ya tiene ambas
    // mitades -> se emite el valor completo.
    estado = actualizarEstadoFechaHora12(estado, { fecha: "2026-09-14" });
    expect(estado.draft).toEqual({ fecha: "2026-09-14", hora24: "08:00" });
    expect(estado.ultimoEmitido).toBe("2026-09-14T08:00");
  });

  // 4) seleccionar primero fecha -> la fecha permanece
  // 5) luego seleccionar hora -> emite valor completo
  it("4) y 5) fecha primero: la fecha permanece visualmente hasta que la hora completa el valor", () => {
    let estado = inicializarEstadoFechaHora12("");

    estado = actualizarEstadoFechaHora12(estado, { fecha: "2026-09-14" });
    expect(estado.draft).toEqual({ fecha: "2026-09-14", hora24: "" });
    expect(estado.ultimoEmitido).toBe(""); // falta la hora

    // Mismo eco que en el caso anterior, con el orden invertido.
    estado = sincronizarEstadoFechaHora12(estado, "");
    expect(estado.draft.fecha).toBe("2026-09-14"); // la fecha permanece

    estado = actualizarEstadoFechaHora12(estado, { hora24: "17:30" });
    expect(estado.draft).toEqual({ fecha: "2026-09-14", hora24: "17:30" });
    expect(estado.ultimoEmitido).toBe("2026-09-14T17:30");
  });

  // 6) editar valor existente
  it("6) editar un valor existente: separa fecha y hora correctamente al montar", () => {
    const estado = inicializarEstadoFechaHora12("2026-09-14T08:00");
    expect(estado).toEqual<EstadoFechaHora12>({
      draft: { fecha: "2026-09-14", hora24: "08:00" },
      ultimoEmitido: "2026-09-14T08:00",
    });
  });

  // 7) limpiar fecha (de un valor ya completo)
  it("7) limpiar la fecha de un valor completo: colapsa a '', pero la hora permanece visualmente", () => {
    let estado = inicializarEstadoFechaHora12("2026-09-14T08:00");
    estado = actualizarEstadoFechaHora12(estado, { fecha: "" });
    expect(estado.draft).toEqual({ fecha: "", hora24: "08:00" }); // la hora NO se borra
    expect(estado.ultimoEmitido).toBe(""); // el valor combinado sí colapsa
  });

  // 8) limpiar hora (de un valor ya completo)
  it("8) limpiar la hora de un valor completo: colapsa a '', pero la fecha permanece visualmente", () => {
    let estado = inicializarEstadoFechaHora12("2026-09-14T08:00");
    estado = actualizarEstadoFechaHora12(estado, { hora24: "" });
    expect(estado.draft).toEqual({ fecha: "2026-09-14", hora24: "" }); // la fecha NO se borra
    expect(estado.ultimoEmitido).toBe("");
  });

  // 9) cambio externo de value (p. ej. el padre carga otro plan)
  describe("9) cambio externo de value", () => {
    it("de un valor completo a vacío (otro plan sin regreso_estimado): resincroniza a vacío", () => {
      const estado = inicializarEstadoFechaHora12("2026-09-14T08:00");
      const resincronizado = sincronizarEstadoFechaHora12(estado, "");
      expect(resincronizado).toEqual<EstadoFechaHora12>({ draft: { fecha: "", hora24: "" }, ultimoEmitido: "" });
    });

    it("de un valor completo a OTRO valor completo distinto (otro plan con su propio regreso_estimado): resincroniza al nuevo", () => {
      const estado = inicializarEstadoFechaHora12("2026-09-14T08:00");
      const resincronizado = sincronizarEstadoFechaHora12(estado, "2026-12-01T14:30");
      expect(resincronizado).toEqual<EstadoFechaHora12>({
        draft: { fecha: "2026-12-01", hora24: "14:30" },
        ultimoEmitido: "2026-12-01T14:30",
      });
    });

    it("un borrador PARCIAL (hora elegida, fecha pendiente) también se resincroniza si el padre cambia value externamente", () => {
      let estado = inicializarEstadoFechaHora12("");
      estado = actualizarEstadoFechaHora12(estado, { hora24: "08:00" }); // borrador parcial, ultimoEmitido=""
      // El padre, por una razón AJENA a este componente, carga otro plan
      // con regreso_estimado ya definido -> value cambia a un valor real,
      // distinto de "" (el ultimoEmitido actual) -> debe resincronizar,
      // DESCARTANDO el borrador parcial de "08:00" (es de otro plan).
      const resincronizado = sincronizarEstadoFechaHora12(estado, "2026-12-01T14:30");
      expect(resincronizado.draft).toEqual({ fecha: "2026-12-01", hora24: "14:30" });
    });

    it("no crea un objeto de estado nuevo cuando value es el eco del propio onChange (evita un rerender innecesario)", () => {
      const estado = actualizarEstadoFechaHora12(inicializarEstadoFechaHora12(""), { hora24: "08:00" });
      const resultado = sincronizarEstadoFechaHora12(estado, estado.ultimoEmitido);
      expect(resultado).toBe(estado); // misma referencia, no un objeto equivalente distinto
    });
  });
});
