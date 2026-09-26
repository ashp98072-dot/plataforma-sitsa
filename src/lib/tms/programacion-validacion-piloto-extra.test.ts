import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("./personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(), validarPersonalId: vi.fn() }));
vi.mock("./tc-plan", () => ({ resolverTcInterno: vi.fn() }));

import { query } from "@/lib/db";
import { personalDesdeEmpleado, validarPersonalId } from "./personal-resolucion";
import {
  calcularCambiosRecursos, camposTocados, personalQueSale, resolverSeleccionPersonal, validarEstadoEditable, validarMotivoCambioRecursos,
} from "./programacion-validacion-recursos";
import { MSG_EXTRA_INVALIDO, MSG_PERSONA_DUPLICADA } from "./piloto-extra";

/** PILOTO EXTRA — reglas puras de edición: cambio sensible (motivo), estado editable, cambios reales y personal que sale. */
beforeEach(() => vi.resetAllMocks());

describe("cambio sensible: el piloto extra se trata como piloto/unidad/auxiliares", () => {
  it("camposTocados: asignar, cambiar o QUITAR (null) el extra cuenta como tocado; ausente no", () => {
    expect(camposTocados({}).pilotoExtra).toBe(false);
    expect(camposTocados({ pilotoExtraEmpleadoId: 5 }).pilotoExtra).toBe(true);
    expect(camposTocados({ pilotoExtraPersonalId: 5 }).pilotoExtra).toBe(true);
    expect(camposTocados({ pilotoExtraEmpleadoId: null }).pilotoExtra).toBe(true); // quitar
    expect(camposTocados({ notas: "x" } as never).pilotoExtra).toBe(false);
  });
  it("exige motivo cuando toca el extra; no exige motivo si solo se editan tarifa/notas/referencia/paradas/regreso", () => {
    const motivo = "Indica el motivo del cambio de piloto, unidad o auxiliares.";
    expect(validarMotivoCambioRecursos(camposTocados({ pilotoExtraEmpleadoId: 5 }), undefined)?.error).toBe(motivo);
    expect(validarMotivoCambioRecursos(camposTocados({ pilotoExtraEmpleadoId: 5 }), "  ")?.error).toBe(motivo);
    expect(validarMotivoCambioRecursos(camposTocados({ pilotoExtraEmpleadoId: 5 }), "Ruta larga")).toBeNull();
    expect(validarMotivoCambioRecursos(camposTocados({ tarifaComercial: 10, referenciaCliente: "x", paradas: [], regresoEstimado: null }), undefined)).toBeNull();
  });
  it("En ruta (sin llegada) no admite tocar el extra; pendiente de cierre sí (como piloto/unidad/auxiliares)", () => {
    const toca = camposTocados({ pilotoExtraEmpleadoId: 5 });
    expect(validarEstadoEditable({ estado: "En ruta", pendienteCierre: false }, toca)?.error).toContain("piloto extra");
    expect(validarEstadoEditable({ estado: "En ruta", pendienteCierre: true }, toca)).toBeNull();
    expect(validarEstadoEditable({ estado: "Cerrado", pendienteCierre: false }, toca)?.status).toBe(409);
  });
});

describe("calcularCambiosRecursos con piloto extra", () => {
  const antes = { pilotoId: 10, pilotoExtraId: null, auxiliaresIds: [20], unidadFlotaId: 55 };
  it("editar solo otros campos: nada cambia ni se revalida (17)", () => {
    const r = calcularCambiosRecursos(antes, { pilotoId: undefined, pilotoExtraId: undefined, auxiliaresIds: undefined, unidadFlotaId: 55 }, false);
    expect(r).toMatchObject({ pilotoExtraCambioReal: false, pilotoExtraIdParaValidar: null, pilotoExtraFinal: null });
  });
  it("asignar extra nuevo: cambio real y se revalida ese; quitar: cambio real y nada que validar", () => {
    expect(calcularCambiosRecursos(antes, { pilotoId: undefined, pilotoExtraId: 30, auxiliaresIds: undefined, unidadFlotaId: 55 }, false))
      .toMatchObject({ pilotoExtraCambioReal: true, pilotoExtraIdParaValidar: 30 });
    const conExtra = { ...antes, pilotoExtraId: 30 };
    expect(calcularCambiosRecursos(conExtra, { pilotoId: undefined, pilotoExtraId: null, auxiliaresIds: undefined, unidadFlotaId: 55 }, false))
      .toMatchObject({ pilotoExtraCambioReal: true, pilotoExtraIdParaValidar: null, pilotoExtraFinal: null });
  });
  it("si cambia la FECHA, el extra ya asignado se revalida en la nueva fecha aunque no cambie", () => {
    const conExtra = { ...antes, pilotoExtraId: 30 };
    expect(calcularCambiosRecursos(conExtra, { pilotoId: undefined, pilotoExtraId: undefined, auxiliaresIds: undefined, unidadFlotaId: 55 }, true))
      .toMatchObject({ pilotoExtraCambioReal: false, pilotoExtraIdParaValidar: 30 });
  });
  it("enviar el mismo extra no es un cambio real (no exige revalidar por falso positivo)", () => {
    const conExtra = { ...antes, pilotoExtraId: 30 };
    expect(calcularCambiosRecursos(conExtra, { pilotoId: undefined, pilotoExtraId: 30, auxiliaresIds: undefined, unidadFlotaId: 55 }, false).pilotoExtraCambioReal).toBe(false);
  });
});

describe("personalQueSale: protección de viáticos procesados", () => {
  const base = { pilotoId: 10, piloto: "Juan", pilotoExtraId: 30, pilotoExtraNombre: "Carlos", auxiliaresIds: [20], auxiliaresNombres: ["Pedro"] };
  it("16) quitar el extra lo marca como removido (para validar su viático)", () => {
    expect(personalQueSale(base, { pilotoId: 10, pilotoExtraId: null, auxiliaresIds: [20] })).toEqual([{ personalId: 30, nombre: "Carlos" }]);
  });
  it("cambiar de extra B→C: sale B; sin cambio no sale nadie", () => {
    expect(personalQueSale(base, { pilotoId: 10, pilotoExtraId: 31, auxiliaresIds: [20] })).toEqual([{ personalId: 30, nombre: "Carlos" }]);
    expect(personalQueSale(base, { pilotoId: 10, pilotoExtraId: 30, auxiliaresIds: [20] })).toEqual([]);
  });
  it("una persona que solo cambia de rol dentro del viaje (extra↔principal, extra→auxiliar) conserva su viático: no sale", () => {
    expect(personalQueSale(base, { pilotoId: 30, pilotoExtraId: 10, auxiliaresIds: [20] })).toEqual([]);
    expect(personalQueSale(base, { pilotoId: 10, pilotoExtraId: null, auxiliaresIds: [20, 30] })).toEqual([]);
  });
  it("sin extra en el viaje: exactamente el comportamiento de siempre", () => {
    expect(personalQueSale({ pilotoId: 10, piloto: "Juan", auxiliaresIds: [20], auxiliaresNombres: ["Pedro"] }, { pilotoId: 11, auxiliaresIds: [] }))
      .toEqual([{ personalId: 10, nombre: "Juan" }, { personalId: 20, nombre: "Pedro" }]);
  });
});

describe("resolverSeleccionPersonal: solo RRHH, nunca texto libre", () => {
  it("sin campos del extra no lo toca (undefined) y el resultado previo se conserva", async () => {
    const r = await resolverSeleccionPersonal(7, {});
    expect(r).toMatchObject({ ok: true, pilotoExtraId: undefined });
    expect(query).not.toHaveBeenCalled();
  });
  it("null quita el extra (sin consultar nada)", async () => {
    expect(await resolverSeleccionPersonal(7, { pilotoExtraEmpleadoId: null })).toMatchObject({ ok: true, pilotoExtraId: null });
    expect(await resolverSeleccionPersonal(7, { pilotoExtraPersonalId: null })).toMatchObject({ ok: true, pilotoExtraId: null });
    expect(query).not.toHaveBeenCalled();
  });
  it("por id exacto: valida tipo Piloto de la empresa; otro tipo/empresa → 400", async () => {
    vi.mocked(validarPersonalId).mockResolvedValueOnce({ id: 30, nombre: "Carlos" });
    expect(await resolverSeleccionPersonal(7, { pilotoExtraPersonalId: 30 })).toMatchObject({ ok: true, pilotoExtraId: 30 });
    expect(validarPersonalId).toHaveBeenCalledWith(7, 30, "Piloto");
    vi.mocked(validarPersonalId).mockResolvedValueOnce(null);
    expect(await resolverSeleccionPersonal(7, { pilotoExtraPersonalId: 99 })).toEqual({ ok: false, status: 400, error: MSG_EXTRA_INVALIDO });
  });
  it("por empleado (escritura): activo + puesto de piloto de esta empresa; resuelve tms_personal; inválido → 400 sin crear nada", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ id: 200 }] as never);
    vi.mocked(personalDesdeEmpleado).mockResolvedValueOnce(30);
    expect(await resolverSeleccionPersonal(7, { pilotoExtraEmpleadoId: 200 }, "escritura")).toMatchObject({ ok: true, pilotoExtraId: 30 });
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain("estado = 'Activo'");
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([200, 7]);
    vi.mocked(query).mockResolvedValueOnce([] as never);
    expect(await resolverSeleccionPersonal(7, { pilotoExtraEmpleadoId: 201 })).toEqual({ ok: false, status: 400, error: MSG_EXTRA_INVALIDO });
    expect(personalDesdeEmpleado).toHaveBeenCalledTimes(1);
  });
  it("modo lectura: nunca inserta; informa lo que habría que crear", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 200 }] as never) // empleado válido
      .mockResolvedValueOnce([{ id: 200, codigo: "E-200", nombre: "Carlos" }] as never) // personalExistenteDesdeEmpleado: empleado
      .mockResolvedValueOnce([] as never); // sin tms_personal todavía
    const r = await resolverSeleccionPersonal(7, { pilotoExtraEmpleadoId: 200 }, "lectura");
    expect(r).toMatchObject({ ok: true, pilotoExtraId: undefined, porCrear: [{ tipo: "Piloto", empleadoId: 200 }] });
    expect(personalDesdeEmpleado).not.toHaveBeenCalled();
  });
  it("4/5/6) duplicados entre lo enviado: principal==extra, extra==auxiliar, principal==auxiliar → mensaje de negocio", async () => {
    vi.mocked(validarPersonalId).mockImplementation((async (_e: number, id: number) => ({ id, nombre: `P${id}` })) as never);
    expect(await resolverSeleccionPersonal(7, { pilotoPersonalId: 30, pilotoExtraPersonalId: 30 })).toEqual({ ok: false, status: 400, error: MSG_PERSONA_DUPLICADA });
    expect(await resolverSeleccionPersonal(7, { pilotoExtraPersonalId: 31, auxiliarPersonalIds: [31] })).toEqual({ ok: false, status: 400, error: MSG_PERSONA_DUPLICADA });
    expect(await resolverSeleccionPersonal(7, { pilotoPersonalId: 30, auxiliarPersonalIds: [30] })).toEqual({ ok: false, status: 400, error: MSG_PERSONA_DUPLICADA });
    expect(await resolverSeleccionPersonal(7, { pilotoPersonalId: 30, pilotoExtraPersonalId: 31, auxiliarPersonalIds: [32] })).toMatchObject({ ok: true, pilotoId: 30, pilotoExtraId: 31 });
  });
});
