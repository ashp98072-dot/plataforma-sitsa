import { describe, expect, it } from "vitest";
import type { FaseBorrador, SnapshotBorrador } from "./controlador";
import { ESTADO_GUARDADO_INICIAL } from "./estado-guardado";
import { describirAntiguedad, describirConflicto, describirEstadoAutoguardado, describirSituacion } from "./etiquetas";

const base: SnapshotBorrador = {
  fase: "activo", guardado: ESTADO_GUARDADO_INICIAL, guardadoEn: null, revision: null, recuperacion: null, conflicto: null, otraPestana: false,
  bloqueo: null, suspension: null, errorLectura: null, sinCanal: false, estadoEnvio: "ninguno", claveEnvio: null,
};
const con = (c: Partial<SnapshotBorrador>): SnapshotBorrador => ({ ...base, ...c });

describe("textos del autoguardado", () => {
  it("«Guardado» solo aparece en el estado guardado; pendiente y guardando no lo afirman", () => {
    expect(describirEstadoAutoguardado(con({ guardado: { ...ESTADO_GUARDADO_INICIAL, estado: "pendiente" } })).texto).toBe("Cambios pendientes");
    expect(describirEstadoAutoguardado(con({ guardado: { ...ESTADO_GUARDADO_INICIAL, estado: "guardando" } })).texto).toBe("Guardando…");
    const g = describirEstadoAutoguardado(con({ guardado: { ...ESTADO_GUARDADO_INICIAL, estado: "guardado" }, guardadoEn: Date.UTC(2026, 10, 4, 15, 30) }));
    expect(g.texto).toMatch(/^Guardado en este equipo a las \d{2}:\d{2}/);
    expect(g.tono).toBe("ok");
    for (const e of ["pendiente", "guardando", "error_almacenamiento", "inicial"] as const) {
      expect(describirEstadoAutoguardado(con({ guardado: { ...ESTADO_GUARDADO_INICIAL, estado: e } })).texto).not.toMatch(/^Guardado/);
    }
  });

  it("el error de almacenamiento nombra la causa y no promete que esté a salvo", () => {
    const e = describirEstadoAutoguardado(con({ guardado: { ...ESTADO_GUARDADO_INICIAL, estado: "error_almacenamiento", motivoError: "cuota_excedida" } }));
    expect(e).toMatchObject({ texto: "Error al guardar en este equipo", tono: "error" });
    expect(e.detalle).toMatch(/no hay espacio suficiente/);
    expect(e.detalle).toMatch(/no están a salvo/);
  });

  it("ningún texto menciona el servidor (todo es «este equipo»)", () => {
    const fases: FaseBorrador[] = ["sin_contexto", "desactivado", "consultando", "decision_pendiente", "en_espera", "activo", "conflicto", "bloqueado", "suspendido", "cerrado"];
    for (const fase of fases) {
      const e = describirEstadoAutoguardado(con({ fase }));
      expect(`${e.texto} ${e.detalle ?? ""}`).not.toMatch(/servidor|nube|sincroniz/i);
    }
  });

  it("cada fase tiene un texto propio y la otra pestaña se avisa", () => {
    const textos = new Set((["sin_contexto", "desactivado", "consultando", "decision_pendiente", "en_espera", "conflicto", "suspendido", "cerrado"] as FaseBorrador[]).map((fase) => describirEstadoAutoguardado(con({ fase })).texto));
    expect(textos.size).toBe(8);
    expect(describirEstadoAutoguardado(con({ otraPestana: true })).detalle).toMatch(/Otra pestaña actualizó/);
    expect(describirEstadoAutoguardado(con({ fase: "bloqueado", bloqueo: "envio_en_curso" })).texto).toBe("Envío en curso");
    expect(describirEstadoAutoguardado(con({ fase: "bloqueado", bloqueo: "incompatible" })).texto).toMatch(/versión más nueva/);
    const anterior = describirEstadoAutoguardado(con({ fase: "bloqueado", bloqueo: "sesion_anterior" }));
    expect(anterior.texto).toBe("Sesión anterior finalizada");
    expect(anterior.detalle).toMatch(/siguen en pantalla/);
    expect(anterior.detalle).toMatch(/recarga la página/);
    expect(anterior.detalle).not.toMatch(/servidor/i);
  });

  it("antigüedad en español con singular/plural y sin fechas futuras", () => {
    const t = 1_000_000_000_000;
    expect(describirAntiguedad(t, t)).toBe("hace instantes");
    expect(describirAntiguedad(t + 5000, t)).toBe("hace instantes");
    expect(describirAntiguedad(t - 60_000, t)).toBe("hace 1 minuto");
    expect(describirAntiguedad(t - 5 * 60_000, t)).toBe("hace 5 minutos");
    expect(describirAntiguedad(t - 3_600_000, t)).toBe("hace 1 hora");
    expect(describirAntiguedad(t - 2 * 3_600_000, t)).toBe("hace 2 horas");
    expect(describirAntiguedad(t - 86_400_000, t)).toBe("hace 1 día");
    expect(describirAntiguedad(t - 3 * 86_400_000, t)).toBe("hace 3 días");
  });

  it("situaciones y conflictos: los no usables dicen claramente qué no se puede hacer", () => {
    expect(describirSituacion("incompatible").detalle).toMatch(/No se modificará/);
    expect(describirSituacion("corrupto").detalle).toMatch(/no se recuperará/);
    expect(describirSituacion("expirado").titulo).toMatch(/superó el tiempo/);
    expect(describirSituacion("envio_incierto").detalle).toMatch(/duplicado/);
    expect(describirSituacion("enviado").detalle).toMatch(/no se restaura/i);
    expect(describirConflicto("otra_pestana").detalle).toMatch(/no se combinan/);
    expect(describirConflicto("ya_no_existe").titulo).toMatch(/ya no existe/);
  });
});
