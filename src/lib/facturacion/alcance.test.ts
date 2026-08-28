import { describe, expect, it } from "vitest";
import { alcanceFacturacion } from "./alcance";

describe("FACT-1-UI — alcanceFacturacion: Facturador debe poder llegar a Facturación clientes", () => {
  it("Facturador ve el cuestionario de clientes en SOLO LECTURA (no edita requisitos, eso es de Operaciones)", () => {
    expect(alcanceFacturacion("Facturador")).toEqual({
      verEmpresa: false,
      editarEmpresa: false,
      verClientes: true,
      editarClientes: false,
    });
  });

  it("Facturador nunca ve la facturación de la EMPRESA (eso es de Contabilidad)", () => {
    expect(alcanceFacturacion("Facturador").verEmpresa).toBe(false);
  });

  it("no cambia el comportamiento de los roles ya existentes (Contabilidad/Operaciones/Visualizador/Admin)", () => {
    expect(alcanceFacturacion("Contabilidad")).toEqual({
      verEmpresa: true, editarEmpresa: true, verClientes: false, editarClientes: false,
    });
    expect(alcanceFacturacion("Operaciones")).toEqual({
      verEmpresa: false, editarEmpresa: false, verClientes: true, editarClientes: true,
    });
    expect(alcanceFacturacion("Admin")).toEqual({
      verEmpresa: true, editarEmpresa: true, verClientes: true, editarClientes: true,
    });
  });

  it("un rol sin alcance definido (p.ej. Piloto) sigue sin ver nada de Facturación", () => {
    expect(alcanceFacturacion("Piloto")).toEqual({
      verEmpresa: false, editarEmpresa: false, verClientes: false, editarClientes: false,
    });
  });
});
