import { describe, expect, it, vi } from "vitest";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { validarEdicionRapidaSchema, type FilaResultadoEdicionRapida } from "@/lib/tms/edicion-rapida-schema";
import {
  agregarAuxiliar,
  confirmarPerdida,
  cuerpoEdicionRapida,
  editarRecursos,
  enviarGuardar,
  enviarValidar,
  errorAntesDeEnviar,
  estadoFila,
  mapaResultados,
  mensajeGuardado,
  motivoNoEditable,
  opcionesPersonal,
  opcionesVehiculo,
  puedeGuardar,
  puedeUsarEdicionRapida,
  puedeValidar,
  quitarAuxiliar,
  recursosVisibles,
  resumenEdicion,
  snapshotEsperado,
  subirAuxiliar,
  unidadSinVinculoFlota,
  type Borrador,
  type EntradaBorrador,
  type PlanEdicionRapida,
} from "./edicion-rapida-helpers";

/** PROGRAMACIÓN — EDICIÓN RÁPIDA PR-3: lógica pura de la tabla compacta (borrador, payload, estados, envío). */
const HOY = "2026-09-24";
const plan = (id: number, over: Partial<PlanEdicionRapida> = {}): PlanEdicionRapida => ({
  id, codigo: `P-${id}`, estado: "Programado", fecha_plan: "2026-09-25", hora_carga: "08:00:00", regreso_estimado: "2026-09-25T18:00",
  tipo_viaje: "Propio", pilotoId: 10 + id, piloto: `Piloto ${id}`, auxiliaresDetalle: [{ personalId: 100 + id, nombre: `Aux ${id}` }],
  placa: `C-${id}`, tc: `TC-${id}`, tc_vehiculo_id: 700 + id, flotaVehiculoId: 500 + id, auxiliarPersonalIds: [100 + id], ...over,
});
const vacio = (): Borrador => new Map<number, EntradaBorrador>();
const permiso = (p: Partial<Omit<PermisoModulo, "modulo">>): PermisoModulo[] =>
  [{ modulo: "programacion", puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false, ...p }];
const fila = (planId: number, estado: FilaResultadoEdicionRapida["estado"], over: Partial<FilaResultadoEdicionRapida> = {}): FilaResultadoEdicionRapida =>
  ({ planId, estado, errores: [], advertencias: [], ...over });

describe("permiso", () => {
  it("1) con programacion:editar el botón Edición rápida está disponible", () => {
    expect(puedeUsarEdicionRapida(permiso({ puedeVer: true, puedeEditar: true }))).toBe(true);
  });
  it("2) sin programacion:editar (solo ver) queda bloqueado", () => {
    expect(puedeUsarEdicionRapida(permiso({ puedeVer: true, puedeCrear: true }))).toBe(false);
    expect(puedeUsarEdicionRapida([])).toBe(false);
  });
});

describe("snapshot esperado", () => {
  it("14) se arma desde los datos REALES del viaje (ids, no nombres) con los 8 campos del contrato", () => {
    expect(snapshotEsperado(plan(1))).toEqual({
      estado: "Programado", fechaPlan: "2026-09-25", horaCarga: "08:00:00", regresoEstimado: "2026-09-25T18:00",
      pilotoPersonalId: 11, auxiliarPersonalIds: [101], flotaVehiculoId: 501, tcVehiculoId: 701,
    });
  });
  it("se congela al PRIMER cambio: si el servidor refresca el plan, `esperado` sigue siendo lo que el usuario vio", () => {
    const b1 = editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 });
    const b2 = editarRecursos(b1, plan(1, { pilotoId: 55, estado: "En ruta" }), { tcVehiculoId: null });
    expect(b2.get(1)!.esperado).toEqual(snapshotEsperado(plan(1)));
    expect(b2.get(1)!.nuevo).toMatchObject({ pilotoPersonalId: 99, tcVehiculoId: null });
  });
});

describe("edición local (nada se guarda al cambiar un select)", () => {
  it("4) cambio de piloto marca la fila modificada", () => {
    const b = editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 });
    expect(estadoFila(1, b, new Map())).toBe("modificada");
    expect(recursosVisibles(b, plan(1)).pilotoPersonalId).toBe(99);
    expect(estadoFila(2, b, new Map())).toBe("sin_cambios");
  });
  it("5) cambio de auxiliar (agregar) y el orden importa: el primero es el principal", () => {
    let b = editarRecursos(vacio(), plan(1), { auxiliarPersonalIds: agregarAuxiliar([101], 200) });
    expect(b.get(1)!.nuevo.auxiliarPersonalIds).toEqual([101, 200]);
    b = editarRecursos(b, plan(1), { auxiliarPersonalIds: subirAuxiliar([101, 200], 200) });
    expect(b.get(1)!.nuevo.auxiliarPersonalIds).toEqual([200, 101]);
    expect(estadoFila(1, b, new Map())).toBe("modificada");
  });
  it("6) quitar auxiliar", () => {
    const b = editarRecursos(vacio(), plan(1), { auxiliarPersonalIds: quitarAuxiliar([101], 101) });
    expect(b.get(1)!.nuevo.auxiliarPersonalIds).toEqual([]);
  });
  it("7) cambio de unidad (por flotaVehiculoId)", () => {
    expect(editarRecursos(vacio(), plan(1), { flotaVehiculoId: 777 }).get(1)!.nuevo.flotaVehiculoId).toBe(777);
  });
  it("8) quitar unidad", () => {
    expect(editarRecursos(vacio(), plan(1), { flotaVehiculoId: null }).get(1)!.nuevo.flotaVehiculoId).toBeNull();
  });
  it("9) cambio de TC (por tcVehiculoId)", () => {
    expect(editarRecursos(vacio(), plan(1), { tcVehiculoId: 888 }).get(1)!.nuevo.tcVehiculoId).toBe(888);
  });
  it("10) quitar TC", () => {
    expect(editarRecursos(vacio(), plan(1), { tcVehiculoId: null }).get(1)!.nuevo.tcVehiculoId).toBeNull();
  });
  it("volver al valor original saca la fila del borrador", () => {
    const b = editarRecursos(editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 }), plan(1), { pilotoPersonalId: 11 });
    expect(b.size).toBe(0);
  });
  it("auxiliares repetidos se deduplican y se respeta el máximo de 8", () => {
    const b = editarRecursos(vacio(), plan(1), { auxiliarPersonalIds: [1, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
    expect(b.get(1)!.nuevo.auxiliarPersonalIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("12) Descartar = borrador vacío: todas las filas vuelven a sus valores reales y sin estado de validación", () => {
    const b = editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 });
    expect(recursosVisibles(b, plan(1)).pilotoPersonalId).toBe(99);
    const descartado = vacio();
    expect(recursosVisibles(descartado, plan(1)).pilotoPersonalId).toBe(11);
    expect(estadoFila(1, descartado, new Map())).toBe("sin_cambios");
    expect(resumenEdicion(descartado, new Map())).toEqual({ cambios: 0, ok: 0, conflictos: 0 });
  });
});

describe("payload de /validar y /edicion-rapida", () => {
  it("11) UN motivo por lote (recortado), nunca por fila", () => {
    let b = editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 });
    b = editarRecursos(b, plan(2), { tcVehiculoId: null });
    const cuerpo = cuerpoEdicionRapida(b, "  Piloto no se presentó ");
    expect(cuerpo.motivoCambio).toBe("Piloto no se presentó");
    expect(cuerpo.cambios.every((c) => !("motivoCambio" in c))).toBe(true);
  });
  it("13/14/15) arma exactamente { motivoCambio, cambios: [{ planId, esperado: snapshot original, nuevo: estado editado }] }", () => {
    const b = editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99, auxiliarPersonalIds: [] });
    expect(cuerpoEdicionRapida(b, "m")).toEqual({
      motivoCambio: "m",
      cambios: [{
        planId: 1,
        esperado: snapshotEsperado(plan(1)),
        nuevo: { pilotoPersonalId: 99, auxiliarPersonalIds: [], flotaVehiculoId: 501, tcVehiculoId: 701 },
      }],
    });
  });
  it("34) no toca campos fuera del alcance: `nuevo` solo lleva los 4 recursos y el cuerpo pasa el esquema ESTRICTO del backend", () => {
    const cuerpo = cuerpoEdicionRapida(editarRecursos(vacio(), plan(1), { flotaVehiculoId: 777 }), "m");
    expect(Object.keys(cuerpo.cambios[0].nuevo).sort()).toEqual(["auxiliarPersonalIds", "flotaVehiculoId", "pilotoPersonalId", "tcVehiculoId"]);
    expect(Object.keys(cuerpo.cambios[0].esperado).sort()).toEqual(
      ["auxiliarPersonalIds", "estado", "fechaPlan", "flotaVehiculoId", "horaCarga", "pilotoPersonalId", "regresoEstimado", "tcVehiculoId"],
    );
    expect(Object.keys(cuerpo).sort()).toEqual(["cambios", "motivoCambio"]);
    expect(validarEdicionRapidaSchema.safeParse(cuerpo).success).toBe(true);
  });
  it("28) intercambio manual A<->B produce payload con AMBAS filas", () => {
    const a = plan(1, { pilotoId: 11, piloto: "Carlos" });
    const bb = plan(2, { pilotoId: 12, piloto: "Juan" });
    let b = editarRecursos(vacio(), a, { pilotoPersonalId: 12 });
    b = editarRecursos(b, bb, { pilotoPersonalId: 11 });
    const { cambios } = cuerpoEdicionRapida(b, "Intercambio");
    expect(cambios.map((c) => [c.planId, c.esperado.pilotoPersonalId, c.nuevo.pilotoPersonalId])).toEqual([[1, 11, 12], [2, 12, 11]]);
    expect(validarEdicionRapidaSchema.safeParse({ motivoCambio: "Intercambio", cambios }).success).toBe(true);
  });
  it("29) rotación de 3 produce payload con 3 filas", () => {
    const [a, bb, c] = [plan(1), plan(2), plan(3)];
    let b = editarRecursos(vacio(), a, { flotaVehiculoId: 502 });
    b = editarRecursos(b, bb, { flotaVehiculoId: 503 });
    b = editarRecursos(b, c, { flotaVehiculoId: 501 });
    const { cambios } = cuerpoEdicionRapida(b, "Rotación");
    expect(cambios.map((x) => [x.planId, x.esperado.flotaVehiculoId, x.nuevo.flotaVehiculoId])).toEqual([[1, 501, 502], [2, 502, 503], [3, 503, 501]]);
  });
});

describe("habilitación de Validar / Guardar", () => {
  it("23) sin cambios no se puede validar ni guardar", () => {
    expect(errorAntesDeEnviar(vacio(), "motivo")).toMatch(/No hay cambios/);
    expect(puedeValidar(vacio(), "motivo", false)).toBe(false);
    expect(puedeGuardar(vacio(), "motivo", new Map(), false)).toBe(false);
  });
  it("motivo obligatorio cuando hay cambios reales", () => {
    const b = editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 });
    expect(errorAntesDeEnviar(b, "   ")).toBe("Indica el motivo del cambio.");
    expect(puedeGuardar(b, "", new Map(), false)).toBe(false);
    expect(puedeGuardar(b, "Piloto no se presentó", new Map(), false)).toBe(true);
  });
  it("32) mientras valida/guarda (ocupado) no se puede volver a enviar", () => {
    const b = editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 });
    expect(puedeValidar(b, "m", true)).toBe(false);
    expect(puedeGuardar(b, "m", new Map(), true)).toBe(false);
  });
  it("con conflictos conocidos no se habilita Guardar (hay que corregir o revalidar)", () => {
    const b = editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 });
    expect(puedeGuardar(b, "m", mapaResultados([fila(1, "error")]), false)).toBe(false);
  });
  it("33) máximo 200 filas por lote sigue respetado", () => {
    let b: Borrador = vacio();
    for (let i = 1; i <= 201; i++) b = editarRecursos(b, plan(i), { pilotoPersonalId: 9999 });
    expect(errorAntesDeEnviar(b, "m")).toMatch(/Máximo 200/);
    expect(puedeGuardar(b, "m", new Map(), false)).toBe(false);
    b = editarRecursos(b, plan(201), { pilotoPersonalId: 211 });
    expect(errorAntesDeEnviar(b, "m")).toBeNull();
  });
});

describe("resultado de /validar por fila", () => {
  const b = editarRecursos(editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 }), plan(2), { pilotoPersonalId: 98 });
  it("16) respuesta ok marca la fila OK", () => {
    expect(estadoFila(1, b, mapaResultados([fila(1, "ok")]))).toBe("ok");
  });
  it("17) respuesta error marca conflicto (y el contador lo refleja)", () => {
    const r = mapaResultados([fila(1, "ok"), fila(2, "error", { errores: [{ codigo: "RECURSO_OCUPADO_LOTE", mensaje: "choca" }] })]);
    expect(estadoFila(2, b, r)).toBe("conflicto");
    expect(resumenEdicion(b, r)).toEqual({ cambios: 2, ok: 1, conflictos: 1 });
  });
  it("18) las advertencias llegan intactas a la fila", () => {
    const r = mapaResultados([fila(1, "ok", { advertencias: [{ tipo: "otro_plan_dia", mensaje: "Otro viaje hoy" }] })]);
    expect(r.get(1)!.advertencias).toEqual([{ tipo: "otro_plan_dia", mensaje: "Otro viaje hoy" }]);
  });
});

describe("red", () => {
  const cuerpo = cuerpoEdicionRapida(editarRecursos(vacio(), plan(1), { pilotoPersonalId: 99 }), "m");
  const respuesta = (status: number, data: unknown) =>
    vi.fn<(url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>(
      async () => ({ ok: status < 400, status, json: async () => data }),
    );

  it("13) Validar usa POST /tms/planes/edicion-rapida/validar con el cuerpo exacto", async () => {
    const f = respuesta(200, { ok: true, filas: [fila(1, "ok")] });
    const r = await enviarValidar(f, "sitsa", cuerpo);
    expect(f).toHaveBeenCalledWith("/api/empresas/sitsa/tms/planes/edicion-rapida/validar", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(f.mock.calls[0][1].body))).toEqual(cuerpo);
    expect(r).toEqual({ tipo: "ok", ok: true, filas: [fila(1, "ok")] });
  });
  it("19) Guardar usa POST /tms/planes/edicion-rapida y devuelve cuántos se guardaron", async () => {
    const f = respuesta(200, { ok: true, guardados: 3, filas: [] });
    const r = await enviarGuardar(f, "sitsa", cuerpo);
    expect(f).toHaveBeenCalledWith("/api/empresas/sitsa/tms/planes/edicion-rapida", expect.objectContaining({ method: "POST" }));
    expect(r).toEqual({ tipo: "ok", guardados: 3 });
    expect(mensajeGuardado(3)).toBe("Se actualizaron 3 viajes.");
    expect(mensajeGuardado(1)).toBe("Se actualizaron 1 viaje.");
  });
  it("20) 409 devuelve los errores por fila (el componente conserva el borrador)", async () => {
    const f = respuesta(409, { ok: false, error: "Los cambios ya no son válidos.", filas: [fila(1, "error")] });
    expect(await enviarGuardar(f, "sitsa", cuerpo)).toEqual({ tipo: "conflicto", error: "Los cambios ya no son válidos.", filas: [fila(1, "error")] });
  });
  it("409 por candado (sin filas) y errores de red no rompen: se informan", async () => {
    expect(await enviarGuardar(respuesta(409, { ok: false, error: "otra operación" }), "sitsa", cuerpo)).toEqual({ tipo: "conflicto", error: "otra operación", filas: [] });
    expect((await enviarGuardar(vi.fn(async () => { throw new Error("x"); }), "sitsa", cuerpo)).tipo).toBe("error");
    expect((await enviarValidar(respuesta(400, { error: "Datos inválidos." }), "sitsa", cuerpo))).toEqual({ tipo: "error", error: "Datos inválidos." });
  });
});

describe("filas no editables", () => {
  it("24) Tercerizado no permite editar recursos internos", () => {
    expect(motivoNoEditable(plan(1, { tipo_viaje: "Tercerizado" }), HOY)).toBe("Tercerizado");
  });
  it("25) Cerrado bloqueado", () => {
    expect(motivoNoEditable(plan(1, { estado: "Cerrado" }), HOY)).toBe("Cerrado");
  });
  it("26) Cancelado bloqueado", () => {
    expect(motivoNoEditable(plan(1, { estado: "Cancelado" }), HOY)).toBe("Cancelado");
  });
  it("27) fecha pasada = histórico (hoy sí se edita)", () => {
    expect(motivoNoEditable(plan(1, { fecha_plan: "2026-09-23" }), HOY)).toBe("Histórico");
    expect(motivoNoEditable(plan(1, { fecha_plan: HOY }), HOY)).toBeNull();
  });
  it("En ruta NO se bloquea en la UI: lo decide el backend", () => {
    expect(motivoNoEditable(plan(1, { estado: "En ruta" }), HOY)).toBeNull();
  });
  it("auxiliar legado (solo auxiliar_id) o GET sin datos nuevos: no editable (el snapshot no sería exacto)", () => {
    expect(motivoNoEditable(plan(1, { auxiliarPersonalIds: [] }), HOY)).toMatch(/legado/);
    expect(motivoNoEditable(plan(1, { flotaVehiculoId: undefined }), HOY)).toMatch(/Sin datos/);
  });
  it("unidad con placa pero sin vínculo con Flota se detecta (solo esa celda queda bloqueada)", () => {
    expect(unidadSinVinculoFlota(plan(1, { flotaVehiculoId: null }))).toBe(true);
    expect(unidadSinVinculoFlota(plan(1, { placa: null, flotaVehiculoId: null }))).toBe(false);
    expect(unidadSinVinculoFlota(plan(1))).toBe(false);
  });
});

describe("confirmación antes de perder cambios", () => {
  it("30/31) con cambios pide confirmación y respeta la respuesta; sin cambios no pregunta", () => {
    const si = vi.fn(() => true);
    const no = vi.fn(() => false);
    expect(confirmarPerdida(true, si)).toBe(true);
    expect(confirmarPerdida(true, no)).toBe(false);
    expect(si).toHaveBeenCalledTimes(1);
    const nunca = vi.fn(() => false);
    expect(confirmarPerdida(false, nunca)).toBe(true);
    expect(nunca).not.toHaveBeenCalled();
  });
});

describe("catálogos", () => {
  const disp = new Map([[21, { personalId: 21, estadoDisponibilidad: "disponible", otrosPlanesDelDia: [{ planId: 2 }] }]]) as never;
  it("piloto: tms_personal Activo del tipo, con indicador de ocupado SIN ocultarlo; el actual se conserva aunque ya no esté", () => {
    const cat = [
      { id: 21, nombre: "Juan", tipo: "Piloto", estado: "Activo" },
      { id: 22, nombre: "Inactivo", tipo: "Piloto", estado: "Inactivo" },
      { id: 23, nombre: "Aux", tipo: "Auxiliar", estado: "Activo" },
    ];
    const o = opcionesPersonal(cat, "Piloto", [{ id: 11, nombre: "Carlos" }], disp, 1);
    expect(o.map((x) => x.id)).toEqual([11, 21]);
    expect(o[1].etiqueta).toBe("Juan 🟢 · otro viaje");
  });
  it("unidad y TC por flota_vehiculos.id mostrando placa; los TC nunca aparecen como Unidad", () => {
    const veh = [
      { id: 1, placa: "C-1", tipoUnidad: "CABEZAL", estadoDisponibilidad: "disponible" },
      { id: 2, placa: "TC-1", tipoUnidad: "TC", estadoDisponibilidad: "en_taller" },
    ];
    expect(opcionesVehiculo(veh, "unidad", { id: null, placa: null })).toEqual([{ id: 1, etiqueta: "C-1" }]);
    expect(opcionesVehiculo(veh, "tc", { id: null, placa: null })).toEqual([{ id: 2, etiqueta: "TC-1 (en taller)" }]);
    expect(opcionesVehiculo(veh, "unidad", { id: 9, placa: "OLD-9" })[0]).toEqual({ id: 9, etiqueta: "OLD-9" });
  });
});
