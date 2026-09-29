import { describe, expect, it } from "vitest";
import { calcularPeriodoTrasGuardar, construirIdentidadPatch, debeIncluirIdentidad, resolverEntrevistadorMostrado } from "./entrevista-form";

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

describe("ATRACCION-TALENTO-1 (corrección post-revisión) — calcularPeriodoTrasGuardar (reselección al reprogramar)", () => {
  it("1) 28/09/2026 -> 30/09/2026 (mismo mes): cambioPeriodo=false, anio/mes sin cambios", () => {
    const r = calcularPeriodoTrasGuardar("2026-09-30", 2026, 9);
    expect(r).toEqual({ anio: 2026, mes: 9, cambioPeriodo: false });
  });

  it("2) 28/09/2026 -> 02/10/2026 (cambia de mes): cambioPeriodo=true, mes=10, anio=2026", () => {
    const r = calcularPeriodoTrasGuardar("2026-10-02", 2026, 9);
    expect(r).toEqual({ anio: 2026, mes: 10, cambioPeriodo: true });
  });

  it("cambio de año (31/12 -> 05/01 del año siguiente): cambioPeriodo=true, anio se actualiza", () => {
    const r = calcularPeriodoTrasGuardar("2027-01-05", 2026, 12);
    expect(r).toEqual({ anio: 2027, mes: 1, cambioPeriodo: true });
  });

  it("misma fecha exacta que la ya cargada: cambioPeriodo=false", () => {
    const r = calcularPeriodoTrasGuardar("2026-09-28", 2026, 9);
    expect(r.cambioPeriodo).toBe(false);
  });
});

describe("ATRACCION-TALENTO-2 (secciones 3, 9, 19-21) — resolverEntrevistadorMostrado (precedencia usuario > empleado histórico)", () => {
  it("20) registro nuevo (solo entrevistadorUsuarioId) -> tipo usuario, con su nombre", () => {
    const r = resolverEntrevistadorMostrado({
      entrevistadorUsuarioId: 10, entrevistadorUsuarioNombre: "María López",
      entrevistadorEmpleadoId: null, entrevistadorNombre: undefined,
    });
    expect(r).toEqual({ tipo: "usuario", nombre: "María López" });
  });

  it("19) registro antiguo (solo entrevistadorEmpleadoId histórico) -> tipo empleado_historico, sigue mostrando su nombre", () => {
    const r = resolverEntrevistadorMostrado({
      entrevistadorUsuarioId: null, entrevistadorUsuarioNombre: undefined,
      entrevistadorEmpleadoId: 77, entrevistadorNombre: "Juan Gómez",
    });
    expect(r).toEqual({ tipo: "empleado_historico", nombre: "Juan Gómez" });
  });

  it("21) si por dato transitorio existen ambos, la precedencia documentada es usuario > empleado histórico", () => {
    const r = resolverEntrevistadorMostrado({
      entrevistadorUsuarioId: 10, entrevistadorUsuarioNombre: "María López",
      entrevistadorEmpleadoId: 77, entrevistadorNombre: "Juan Gómez",
    });
    expect(r).toEqual({ tipo: "usuario", nombre: "María López" });
  });

  it("sin ninguno de los dos -> tipo ninguno (la UI no muestra ninguna línea)", () => {
    const r = resolverEntrevistadorMostrado({
      entrevistadorUsuarioId: null, entrevistadorUsuarioNombre: undefined,
      entrevistadorEmpleadoId: null, entrevistadorNombre: undefined,
    });
    expect(r).toEqual({ tipo: "ninguno" });
  });
});
