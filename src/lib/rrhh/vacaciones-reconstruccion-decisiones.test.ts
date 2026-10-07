import { describe, expect, it } from "vitest";
import { claveDecision, huellaTexto, validarDecisiones } from "./vacaciones-reconstruccion-decisiones";

const HUELLA = huellaTexto("propuesta del motor");
const base = { clave: "VACACION_CRUZA_ANIVERSARIO|E-10|2025-10-20|2025-11-05|15.00", tipo: "ACEPTAR_PROPUESTA", huella: HUELLA, resueltoPor: "gerente.rrhh", resueltoEn: "2026-10-07T10:00:00-06:00", motivo: "Aprobado tras revisar la boleta." };

describe("decisiones explícitas y auditables", () => {
  it("la huella es el SHA-256 determinista del texto propuesto y la clave identifica código + empleado + fechas + días", () => {
    expect(HUELLA).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaTexto("propuesta del motor")).toBe(HUELLA);
    expect(huellaTexto("otra propuesta")).not.toBe(HUELLA);
    expect(claveDecision("VACACION_CRUZA_ANIVERSARIO", "E-10", "2025-10-20", "2025-11-05", 15)).toBe(base.clave);
  });

  it("una decisión completa es válida; sin entrada no hay decisiones ni errores", () => {
    expect(validarDecisiones(undefined)).toEqual({ decisiones: [], errores: [] });
    const r = validarDecisiones([base]);
    expect(r.errores).toEqual([]);
    expect(r.decisiones).toEqual([base]);
  });

  it("rechaza lo que no es una lista, claves repetidas, tipo/huella/autor/fecha/motivo inválidos", () => {
    expect(validarDecisiones({}).errores[0]).toContain("lista");
    expect(validarDecisiones([base, base]).errores.join(" ")).toContain("repetida");
    expect(validarDecisiones([{ ...base, tipo: "OTRO" }]).errores.join(" ")).toContain("tipo inválido");
    expect(validarDecisiones([{ ...base, huella: "abc" }]).errores.join(" ")).toContain("SHA-256");
    expect(validarDecisiones([{ ...base, resueltoPor: "" }]).errores.join(" ")).toContain("resueltoPor");
    expect(validarDecisiones([{ ...base, resueltoEn: "mañana" }]).errores.join(" ")).toContain("resueltoEn");
    expect(validarDecisiones([{ ...base, motivo: "ok" }]).errores.join(" ")).toContain("motivo");
    expect(validarDecisiones([{ ...base, clave: "" }]).errores.join(" ")).toContain("clave");
  });

  it("REPARTO_MANUAL exige un reparto válido por año laboral (sin repetir, días > 0); ACEPTAR_PROPUESTA no admite reparto", () => {
    const manual = { ...base, tipo: "REPARTO_MANUAL" };
    expect(validarDecisiones([manual]).errores.join(" ")).toContain("exige el reparto");
    expect(validarDecisiones([{ ...manual, reparto: [{ anioLaboral: 3, dias: 9 }, { anioLaboral: 3, dias: 6 }] }]).errores.join(" ")).toContain("reparto inválido");
    expect(validarDecisiones([{ ...manual, reparto: [{ anioLaboral: 0, dias: 9 }] }]).errores.join(" ")).toContain("reparto inválido");
    expect(validarDecisiones([{ ...manual, reparto: [{ anioLaboral: 3, dias: -1 }] }]).errores.join(" ")).toContain("reparto inválido");
    const ok = validarDecisiones([{ ...manual, reparto: [{ anioLaboral: 2, dias: 10 }, { anioLaboral: 3, dias: 5.005 }] }]);
    expect(ok.errores).toEqual([]);
    expect(ok.decisiones[0].reparto).toEqual([{ anioLaboral: 2, dias: 10 }, { anioLaboral: 3, dias: 5.01 }]);
    expect(validarDecisiones([{ ...base, reparto: [{ anioLaboral: 1, dias: 1 }] }]).errores.join(" ")).toContain("no admite");
  });
});
