import { describe, expect, it } from "vitest";
import { construirIdentidadPatch, debeIncluirIdentidad } from "./entrevista-form";

const vacio = { primerNombre: "", segundoNombre: "", tercerNombre: "", cuartoNombre: "", primerApellido: "", segundoApellido: "", apellidoCasada: "" };
const completa = { ...vacio, primerNombre: "Juan", primerApellido: "Pérez" };

describe("AJUSTE PR #375 — entrevista histórica: NO exigir/enviar identidad si RRHH no la toca", () => {
  it("1) histórica solo candidato_nombre: editar teléfono -> OK (no se exige identidad)", () => {
    const r = construirIdentidadPatch({ editando: true, entrevistaCargadaSinEstructura: true, form: vacio });
    expect(r.ok).toBe(true);
  });
  it("2) histórica: editar email -> OK", () => {
    expect(debeIncluirIdentidad({ editando: true, entrevistaCargadaSinEstructura: true, form: vacio })).toBe(false);
  });
  it("3) histórica: editar puesto -> OK (misma condición: no toca identidad)", () => {
    const r = construirIdentidadPatch({ editando: true, entrevistaCargadaSinEstructura: true, form: vacio });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identidad).toEqual({});
  });
  it("4) histórica: editar fecha/hora -> OK", () => {
    // La identidad no depende de qué otro campo se edite; el helper solo mira form/editando/entrevistaCargadaSinEstructura.
    expect(debeIncluirIdentidad({ editando: true, entrevistaCargadaSinEstructura: true, form: vacio })).toBe(false);
  });
  it("5) histórica: editar notas -> OK", () => {
    const r = construirIdentidadPatch({ editando: true, entrevistaCargadaSinEstructura: true, form: vacio });
    expect(r.ok).toBe(true);
  });
  it("6) esos PATCH no contienen campos de identidad vacíos (identidad = {})", () => {
    const r = construirIdentidadPatch({ editando: true, entrevistaCargadaSinEstructura: true, form: vacio });
    expect(r.ok && r.identidad).toEqual({});
    expect(r.ok && Object.keys(r.identidad)).toHaveLength(0);
  });
  it("7) candidato_nombre histórico queda intacto (no se envía ningún candidatoPrimerNombre/... vacío)", () => {
    const r = construirIdentidadPatch({ editando: true, entrevistaCargadaSinEstructura: true, form: vacio });
    if (r.ok) {
      expect(r.identidad).not.toHaveProperty("candidatoPrimerNombre");
      expect(r.identidad).not.toHaveProperty("candidatoPrimerApellido");
    }
  });
  it("8) histórica comienza a completar SOLO primer nombre: debe bloquear porque falta primer apellido", () => {
    const r = construirIdentidadPatch({ editando: true, entrevistaCargadaSinEstructura: true, form: { ...vacio, primerNombre: "Juan" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain("obligatorios");
  });
  it("9) histórica completa primer nombre + primer apellido: OK", () => {
    const r = construirIdentidadPatch({ editando: true, entrevistaCargadaSinEstructura: true, form: completa });
    expect(r.ok).toBe(true);
  });
  it("10) al completar identidad, se arma el fragmento para que el backend recomponga candidato_nombre", () => {
    const r = construirIdentidadPatch({ editando: true, entrevistaCargadaSinEstructura: true, form: completa });
    expect(r.ok && r.identidad).toEqual({
      candidatoPrimerNombre: "Juan", candidatoSegundoNombre: null, candidatoTercerNombre: null, candidatoCuartoNombre: null,
      candidatoPrimerApellido: "Pérez", candidatoSegundoApellido: null, candidatoApellidoCasada: null,
    });
  });
  it("11) entrevista YA ESTRUCTURADA: editar identidad mantiene primer nombre/apellido obligatorios, aunque el formulario esté vacío en ese instante", () => {
    const r = construirIdentidadPatch({ editando: true, entrevistaCargadaSinEstructura: false, form: vacio });
    expect(r.ok).toBe(false);
    expect(debeIncluirIdentidad({ editando: true, entrevistaCargadaSinEstructura: false, form: vacio })).toBe(true);
  });
  it("12) NUEVA entrevista: primer nombre/apellido siguen obligatorios", () => {
    expect(debeIncluirIdentidad({ editando: false, entrevistaCargadaSinEstructura: false, form: vacio })).toBe(true);
    const r = construirIdentidadPatch({ editando: false, entrevistaCargadaSinEstructura: false, form: vacio });
    expect(r.ok).toBe(false);
    const ok = construirIdentidadPatch({ editando: false, entrevistaCargadaSinEstructura: false, form: completa });
    expect(ok.ok).toBe(true);
  });
});
