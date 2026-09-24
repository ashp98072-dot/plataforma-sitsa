import { describe, expect, it } from "vitest";
import {
  intervaloProgramacion,
  mensajeConflictoProgramacionIntervalo,
  ventanaProgramacionSegura,
  ventanasProgramacionSeSolapan,
} from "./disponibilidad-programacion-intervalos";

/** A2.1 — helpers compartidos por POST / PATCH / importación (y, en A2.2, lote/copia y buscadores). */
const v = (fechaPlan: string, horaCarga: string | null, regresoEstimado: string | null) => ({ fechaPlan, horaCarga, regresoEstimado });

describe("ventanaProgramacionSegura", () => {
  it("ventana completa válida se conserva; vacíos se normalizan a null", () => {
    expect(ventanaProgramacionSegura(v("2026-09-24", "05:00", "2026-09-24T08:00"))).toEqual(v("2026-09-24", "05:00", "2026-09-24T08:00"));
    expect(ventanaProgramacionSegura(v("2026-09-24", "", ""))).toEqual(v("2026-09-24", null, null));
  });

  it("hora inválida, regreso inválido o regreso <= carga: reserva conservadora del día (nunca lanza ni inventa duración)", () => {
    for (const w of [v("2026-09-24", "25:00", "2026-09-24T08:00"), v("2026-09-24", "05:00", "basura"), v("2026-09-24", "08:00", "2026-09-24T08:00"), v("2026-09-24", "08:00", "2026-09-24T07:00")]) {
      expect(ventanaProgramacionSegura(w)).toEqual(v("2026-09-24", null, null));
    }
  });

  it("solo una fecha inválida lanza", () => {
    expect(() => ventanaProgramacionSegura(v("2026-13-40", "05:00", null))).toThrow("Fecha de programación inválida.");
  });
});

describe("ventanasProgramacionSeSolapan (lote / importación)", () => {
  it("semiabierto: [05,08) y [08,11) no se solapan; [05,08) y [07:59,10) sí", () => {
    expect(ventanasProgramacionSeSolapan(v("2026-09-24", "05:00", "2026-09-24T08:00"), v("2026-09-24", "08:00", "2026-09-24T11:00"))).toBe(false);
    expect(ventanasProgramacionSeSolapan(v("2026-09-24", "05:00", "2026-09-24T08:00"), v("2026-09-24", "07:59", "2026-09-24T10:00"))).toBe(true);
  });

  it("cruce de medianoche: 24/09 22:00 -> 25/09 02:00 con 25/09 01:00 sí; con 25/09 02:00 no", () => {
    const noche = v("2026-09-24", "22:00", "2026-09-25T02:00");
    expect(ventanasProgramacionSeSolapan(noche, v("2026-09-25", "01:00", "2026-09-25T05:00"))).toBe(true);
    expect(ventanasProgramacionSeSolapan(noche, v("2026-09-25", "02:00", "2026-09-25T05:00"))).toBe(false);
  });

  it("sin regreso (o sin hora) reserva SOLO su día: no toca el día siguiente", () => {
    const sinRegreso = v("2026-09-24", "22:00", null);
    expect(ventanasProgramacionSeSolapan(sinRegreso, v("2026-09-24", "05:00", "2026-09-24T06:00"))).toBe(true);
    expect(ventanasProgramacionSeSolapan(sinRegreso, v("2026-09-25", "00:30", "2026-09-25T02:00"))).toBe(false);
    expect(intervaloProgramacion(sinRegreso)).toEqual({ inicio: "2026-09-24 00:00:00", fin: "2026-09-25 00:00:00" });
    expect(ventanasProgramacionSeSolapan(v("2026-09-24", null, "2026-09-24T06:00"), v("2026-09-24", "23:00", "2026-09-25T01:00"))).toBe(true);
  });

  it("es simétrica", () => {
    const a = v("2026-09-24", "05:00", "2026-09-24T08:00");
    const b = v("2026-09-24", "07:00", null);
    expect(ventanasProgramacionSeSolapan(a, b)).toBe(ventanasProgramacionSeSolapan(b, a));
  });
});

describe("mensajeConflictoProgramacionIntervalo", () => {
  it("mismo texto que la política diaria, con la fecha del inicio del conflicto", () => {
    const base = { id: 1, nombre: "Juan", planIdConflicto: 9, codigoConflicto: "PLAN-9", inicioConflicto: "2026-09-24 05:00:00", finConflicto: "2026-09-24 08:00:00" };
    expect(mensajeConflictoProgramacionIntervalo({ ...base, tipo: "piloto" })).toBe("El piloto Juan ya está asignado al PLAN-9 para el 24/09/2026.");
    expect(mensajeConflictoProgramacionIntervalo({ ...base, tipo: "auxiliar" })).toBe("El auxiliar Juan ya está asignado al PLAN-9 para el 24/09/2026.");
    expect(mensajeConflictoProgramacionIntervalo({ ...base, tipo: "unidad", nombre: "C-1" })).toBe("La unidad C-1 ya está asignada al PLAN-9 para el 24/09/2026.");
    expect(mensajeConflictoProgramacionIntervalo({ ...base, tipo: "tc", nombre: "TC-5" })).toBe("El TC TC-5 ya está asignado al PLAN-9 para el 24/09/2026.");
  });
});
