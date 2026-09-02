import { describe, expect, it } from "vitest";
import { claseEstadoSolicitud, etiquetaEstadoSolicitud } from "./solicitudes-cliente-ui";

describe("etiquetaEstadoSolicitud", () => {
  it("mapea los 5 estados a su texto visible", () => {
    expect(etiquetaEstadoSolicitud("SOLICITADA")).toBe("Solicitud enviada");
    expect(etiquetaEstadoSolicitud("EN_REVISION")).toBe("En revisión");
    expect(etiquetaEstadoSolicitud("PROGRAMADA")).toBe("Programada");
    expect(etiquetaEstadoSolicitud("RECHAZADA")).toBe("Rechazada");
    expect(etiquetaEstadoSolicitud("CANCELADA")).toBe("Cancelada");
  });

  it("un estado desconocido se muestra tal cual (no revienta)", () => {
    expect(etiquetaEstadoSolicitud("ALGO_RARO")).toBe("ALGO_RARO");
  });
});

describe("claseEstadoSolicitud", () => {
  it("devuelve una clase distinta por cada estado conocido", () => {
    const clases = new Set(
      ["SOLICITADA", "EN_REVISION", "PROGRAMADA", "RECHAZADA", "CANCELADA"].map(claseEstadoSolicitud),
    );
    expect(clases.size).toBe(5);
  });

  it("un estado desconocido cae en un estilo neutro por defecto", () => {
    expect(claseEstadoSolicitud("ALGO_RARO")).toContain("gray");
  });
});
