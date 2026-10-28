import { describe, expect, it } from "vitest";
import { validarCalendarioContable } from "./calendario-schema";

export const ejemplo = () => ({ codigo: " ef-24 ", fechaInicio: "2024-02-01", fechaFin: "2024-03-31", periodos: [
  { codigo: "p1", fechaInicio: "2024-02-01", fechaFin: "2024-02-29" },
  { codigo: "p2", fechaInicio: "2024-03-01", fechaFin: "2024-03-31" },
] });
describe("C3C-1: calendario puro", () => {
  it("normaliza códigos y admite bisiesto y ejercicio no anual", () => {
    expect(validarCalendarioContable(ejemplo())).toMatchObject({ codigo: "EF-24", periodos: [{ codigo: "P1" }, { codigo: "P2" }] });
  });
  it("admite un ejercicio y período de un día", () => {
    expect(() => validarCalendarioContable({ codigo: "D", fechaInicio: "2026-01-01", fechaFin: "2026-01-01", periodos: [{ codigo: "D", fechaInicio: "2026-01-01", fechaFin: "2026-01-01" }] })).not.toThrow();
  });
  it.each(["2023-02-29", "2024-02-30", "2024-13-01", "24-02-01", "0999-01-01", "2024-02-01T00:00:00Z"])("rechaza fecha %s", (fechaInicio) => {
    expect(() => validarCalendarioContable({ ...ejemplo(), fechaInicio })).toThrow();
  });
  it.each(["hueco", "solape", "orden", "duplicado", "inicio", "fin", "fuera", "invertido"])("rechaza %s", (caso) => {
    const d = ejemplo();
    if (caso === "hueco") d.periodos[1].fechaInicio = "2024-03-02";
    if (caso === "solape") d.periodos[1].fechaInicio = "2024-02-29";
    if (caso === "orden") d.periodos.reverse();
    if (caso === "duplicado") d.periodos[1].codigo = " P1 ";
    if (caso === "inicio") d.periodos[0].fechaInicio = "2024-02-02";
    if (caso === "fin") d.periodos[1].fechaFin = "2024-03-30";
    if (caso === "fuera") d.periodos[0].fechaInicio = "2024-01-31";
    if (caso === "invertido") d.fechaFin = "2024-01-01";
    expect(() => validarCalendarioContable(d)).toThrow();
  });
  it("rechaza campos de autoridad, vacío y exceso de períodos", () => {
    for (const campo of ["empresaId", "entidadId", "estado", "creadoPor", "id"]) expect(() => validarCalendarioContable({ ...ejemplo(), [campo]: 1 })).toThrow();
    expect(() => validarCalendarioContable({ ...ejemplo(), periodos: [] })).toThrow();
    expect(() => validarCalendarioContable({ ...ejemplo(), periodos: Array(367).fill(ejemplo().periodos[0]) })).toThrow();
    expect(() => validarCalendarioContable({ ...ejemplo(), periodos: [{ ...ejemplo().periodos[0], orden: 8 }] })).toThrow();
  });
});
