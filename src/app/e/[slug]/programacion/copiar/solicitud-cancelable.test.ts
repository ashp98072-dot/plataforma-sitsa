import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clasificarFalloSolicitud, crearGestorSolicitudes, esRespuestaReintentable } from "./solicitud-cancelable";
import { MSG_CARGA_RED, MSG_CARGA_TARDO } from "@/lib/tms/plazos-copia";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("gestor de solicitudes cancelables", () => {
  it("vence a los plazoMs: aborta la señal, marca vencio() y deja de ser vigente", () => {
    const g = crearGestorSolicitudes(1_000);
    const s = g.iniciar();
    expect(s.esVigente()).toBe(true); expect(s.vencio()).toBe(false);
    vi.advanceTimersByTime(999);
    expect(s.signal.aborted).toBe(false);
    vi.advanceTimersByTime(2);
    expect(s.signal.aborted).toBe(true); expect(s.vencio()).toBe(true); expect(s.esVigente()).toBe(false);
  });
  it("terminar() antes del plazo libera el temporizador: no aborta ni marca vencida", () => {
    const g = crearGestorSolicitudes(1_000);
    const s = g.iniciar(); s.terminar();
    vi.advanceTimersByTime(5_000);
    expect(s.signal.aborted).toBe(false); expect(s.vencio()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("una solicitud nueva CANCELA la anterior (reemplazo): la anterior queda abortada, NO vencida, y solo la nueva es vigente", () => {
    const g = crearGestorSolicitudes(1_000);
    const a = g.iniciar(); const b = g.iniciar();
    expect(a.signal.aborted).toBe(true); expect(a.vencio()).toBe(false); expect(a.esVigente()).toBe(false);
    expect(b.esVigente()).toBe(true); expect(b.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1_500);
    expect(vi.getTimerCount()).toBe(0);   // el temporizador de la reemplazada se liberó; el de b ya disparó
  });
  it("cancelar() (al desmontar) aborta la solicitud en curso y libera el temporizador", () => {
    const g = crearGestorSolicitudes(1_000);
    const s = g.iniciar(); g.cancelar();
    expect(s.signal.aborted).toBe(true); expect(s.vencio()).toBe(false); expect(s.esVigente()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => g.cancelar()).not.toThrow();
  });
  it("los gestores son independientes (carga y revalidación no se cancelan entre sí)", () => {
    const cargas = crearGestorSolicitudes(1_000); const validaciones = crearGestorSolicitudes(1_000);
    const c = cargas.iniciar(); const v = validaciones.iniciar();
    expect(c.esVigente()).toBe(true); expect(v.esVigente()).toBe(true);
  });
});

describe("clasificación de fallos", () => {
  const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
  it("plazo vencido → mensaje claro y reintentable", () => {
    const s = crearGestorSolicitudes(10).iniciar(); vi.advanceTimersByTime(20);
    expect(clasificarFalloSolicitud(abortError, s)).toEqual({ ignorar: false, mensaje: MSG_CARGA_TARDO, reintentable: true });
  });
  it("cancelada por reemplazo o desmontaje → se ignora (no es un error)", () => {
    const g = crearGestorSolicitudes(1_000); const a = g.iniciar(); g.iniciar();
    expect(clasificarFalloSolicitud(abortError, a)).toEqual({ ignorar: true });
  });
  it("error de red (no aborto) → mensaje de conexión y reintentable", () => {
    const s = crearGestorSolicitudes(1_000).iniciar();
    expect(clasificarFalloSolicitud(new TypeError("Failed to fetch"), s)).toEqual({ ignorar: false, mensaje: MSG_CARGA_RED, reintentable: true });
  });
  it.each([[503, true], [502, true], [504, true], [500, true], [400, false], [403, false], [404, false], [409, false]])("HTTP %i reintentable=%s", (status, ok) => {
    expect(esRespuestaReintentable(status)).toBe(ok);
  });
});
