import { describe, expect, it } from "vitest";
import {
  contarEntregas,
  esTipoSolicitudParadaValido,
  validarParadasSolicitud,
  type SolicitudParadaInput,
} from "./solicitudes-cliente";

function parada(overrides: Partial<SolicitudParadaInput> = {}): SolicitudParadaInput {
  return { orden: 1, tipo: "Carga", lugarNombre: "Bodega central", ...overrides };
}

describe("esTipoSolicitudParadaValido", () => {
  it("acepta solo Carga/Entrega/Descarga", () => {
    expect(esTipoSolicitudParadaValido("Carga")).toBe(true);
    expect(esTipoSolicitudParadaValido("Entrega")).toBe(true);
    expect(esTipoSolicitudParadaValido("Descarga")).toBe(true);
    expect(esTipoSolicitudParadaValido("Salida")).toBe(false);
    expect(esTipoSolicitudParadaValido("")).toBe(false);
  });
});

describe("validarParadasSolicitud", () => {
  it("1 Carga + N Entregas + 1 Descarga = válido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Entrega", lugarNombre: "Cliente A" }),
      parada({ orden: 3, tipo: "Entrega", lugarNombre: "Cliente B" }),
      parada({ orden: 4, tipo: "Descarga", lugarNombre: "Bodega final" }),
    ]);
    expect(r.ok).toBe(true);
  });

  it("1 Carga + 0 Entregas + 1 Descarga = válido (entregas es 0..N)", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Descarga", lugarNombre: "Bodega final" }),
    ]);
    expect(r.ok).toBe(true);
  });

  it("sin Carga = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Entrega" }),
      parada({ orden: 2, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/origen/i);
  });

  it("sin Descarga = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Entrega" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/destino/i);
  });

  it("2 Cargas = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Carga" }),
      parada({ orden: 3, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/más de un origen/i);
  });

  it("2 Descargas = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Descarga" }),
      parada({ orden: 3, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/más de un destino/i);
  });

  it("tipo arbitrario = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      // "Salida" es intencionalmente un tipo fuera de la lista cerrada —
      // SolicitudParadaInput.tipo es `string` a propósito (el valor llega
      // como texto desde fuera, ej. un body HTTP, antes de validarse).
      parada({ orden: 2, tipo: "Salida" }),
      parada({ orden: 3, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no permitido/i);
  });

  it("orden repetido = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 1, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mismo orden/i);
  });

  it("lista vacía = inválido", () => {
    expect(validarParadasSolicitud([]).ok).toBe(false);
  });
});

describe("contarEntregas", () => {
  it("cuenta solo las paradas de tipo Entrega (cantidad_entregas siempre derivado, nunca almacenado)", () => {
    expect(
      contarEntregas([
        { tipo: "Carga" },
        { tipo: "Entrega" },
        { tipo: "Entrega" },
        { tipo: "Descarga" },
      ]),
    ).toBe(2);
    expect(contarEntregas([{ tipo: "Carga" }, { tipo: "Descarga" }])).toBe(0);
  });
});
