import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("./personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(), validarPersonalId: vi.fn() }));
vi.mock("./tc-plan", () => ({ resolverTcInterno: vi.fn() }));

import { execute, query } from "@/lib/db";
import { personalDesdeEmpleado, validarPersonalId } from "./personal-resolucion";
import {
  calcularCambiosRecursos,
  camposTocados,
  evaluarDisponibilidadPersonal,
  evaluarDisponibilidadUnidad,
  personalExistenteDesdeEmpleado,
  personalQueSale,
  resolverSeleccionPersonal,
  validarEstadoEditable,
  validarFechaNoPasada,
  validarMotivoCambioRecursos,
  validarRegresoPosteriorASalida,
} from "./programacion-validacion-recursos";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(query).mockResolvedValue([] as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 900, affectedRows: 1 } as never);
});

const sqls = () => vi.mocked(query).mock.calls.map(([sql]) => String(sql));

describe("resolverSeleccionPersonal — modo escritura (idéntico al PATCH previo)", () => {
  it("piloto por nombre inexistente: INSERT en tms_personal (efecto secundario existente, conservado)", async () => {
    const r = await resolverSeleccionPersonal(7, { pilotoNombre: "  Nuevo Piloto " }, "escritura");
    expect(r).toMatchObject({ ok: true, pilotoId: 900, porCrear: [] });
    expect(vi.mocked(execute).mock.calls[0][0]).toContain("INSERT INTO tms_personal");
    expect(vi.mocked(execute).mock.calls[0][1]).toEqual([7, "Nuevo Piloto"]);
  });

  it("piloto por nombre existente: reutiliza el id, sin INSERT (búsqueda case-insensitive acotada por empresa)", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 31 }] as never);
    const r = await resolverSeleccionPersonal(7, { pilotoNombre: "Juan" });
    expect(r).toMatchObject({ ok: true, pilotoId: 31 });
    expect(execute).not.toHaveBeenCalled();
    expect(sqls()[0]).toContain("empresa_id = ?");
  });

  it("auxiliares por empleado usan personalDesdeEmpleado (puede crear), el primero es el principal", async () => {
    vi.mocked(personalDesdeEmpleado).mockResolvedValueOnce(5).mockResolvedValueOnce(null).mockResolvedValueOnce(6);
    const r = await resolverSeleccionPersonal(7, { auxiliarEmpleadoIds: [1, 2, 3] });
    expect(r).toMatchObject({ ok: true, auxiliarId: 5, auxPersonalIdsLegado: [5, 6], auxPersonalIdsNuevo: undefined });
    expect(personalDesdeEmpleado).toHaveBeenCalledTimes(3);
  });

  it("auxiliarPersonalIds: valida cada id (sin crear), deduplica y el primero es el principal; el nuevo campo gana sobre el legado", async () => {
    vi.mocked(personalDesdeEmpleado).mockResolvedValue(5);
    vi.mocked(validarPersonalId).mockImplementation((async (_e: number, id: number) => ({ id, nombre: `P${id}` })) as never);
    const r = await resolverSeleccionPersonal(7, { auxiliarEmpleadoIds: [1], auxiliarPersonalIds: [9, 8, 9] });
    expect(r).toMatchObject({ ok: true, auxiliarId: 9, auxPersonalIdsNuevo: [9, 8], auxPersonalIdsLegado: [5] });
  });

  it("ids inválidos -> 400 con el mismo texto", async () => {
    vi.mocked(validarPersonalId).mockResolvedValue(null);
    expect(await resolverSeleccionPersonal(7, { pilotoPersonalId: 3 })).toEqual({ ok: false, status: 400, error: "El piloto seleccionado no existe o no pertenece a esta empresa." });
    expect(await resolverSeleccionPersonal(7, { auxiliarPersonalIds: [4] })).toEqual({ ok: false, status: 400, error: "Un auxiliar seleccionado no existe o no pertenece a esta empresa (id 4)." });
  });

  it("sin campos de personal: no consulta ni escribe nada", async () => {
    const r = await resolverSeleccionPersonal(7, {});
    expect(r).toEqual({ ok: true, pilotoId: undefined, auxiliarId: undefined, auxPersonalIdsLegado: undefined, auxPersonalIdsNuevo: undefined, porCrear: [] });
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("resolverSeleccionPersonal — modo lectura (SIN efectos secundarios)", () => {
  it("nombre inexistente: NO inserta; lo informa en porCrear", async () => {
    const r = await resolverSeleccionPersonal(7, { pilotoNombre: "Nuevo", auxiliarNombres: ["Auxiliar Nuevo"] }, "lectura");
    expect(r).toMatchObject({
      ok: true, pilotoId: undefined, auxPersonalIdsLegado: [], auxiliarId: null,
      porCrear: [{ tipo: "Piloto", nombre: "Nuevo" }, { tipo: "Auxiliar", nombre: "Auxiliar Nuevo" }],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("empleado sin fila en tms_personal: NO usa personalDesdeEmpleado ni ejecuta INSERT/UPDATE; lo informa", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => (String(sql).includes("FROM empleados") ? [{ id: 1, codigo: "E-1", nombre: "Ana" }] : [])) as never);
    const r = await resolverSeleccionPersonal(7, { auxiliarEmpleadoIds: [1] }, "lectura");
    expect(r).toMatchObject({ ok: true, auxPersonalIdsLegado: [], porCrear: [{ tipo: "Auxiliar", empleadoId: 1 }] });
    expect(personalDesdeEmpleado).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(sqls().every((s) => /^\s*SELECT/i.test(s))).toBe(true);
  });

  it("empleado ya materializado: se resuelve a su tms_personal.id sin tocar nada", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) =>
      String(sql).includes("FROM empleados") ? [{ id: 1, codigo: "E-1", nombre: "Ana" }] : String(sql).includes("FROM tms_personal") ? [{ id: 44 }] : []) as never);
    const r = await resolverSeleccionPersonal(7, { auxiliarEmpleadoIds: [1] }, "lectura");
    expect(r).toMatchObject({ ok: true, auxiliarId: 44, auxPersonalIdsLegado: [44], porCrear: [] });
    expect(execute).not.toHaveBeenCalled();
  });

  it("empleado inexistente/inactivo: se ignora sin crear (igual que personalDesdeEmpleado -> null)", async () => {
    expect(await personalExistenteDesdeEmpleado(7, 99, "Piloto")).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("nombres existentes se resuelven a su id (sin INSERT) y los ids exactos siguen validándose", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 12 }] as never);
    vi.mocked(validarPersonalId).mockResolvedValue({ id: 20, nombre: "P20" });
    const r = await resolverSeleccionPersonal(7, { pilotoNombre: "Existente", pilotoPersonalId: 20 }, "lectura");
    expect(r).toMatchObject({ ok: true, pilotoId: 20, porCrear: [] }); // el id validado tiene precedencia
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("estado, motivo, fechas y regreso (puras)", () => {
  const nadie = camposTocados({});
  it("camposTocados: presencia en el request, no comparación con el valor anterior", () => {
    expect(nadie).toEqual({ piloto: false, auxiliares: false, unidad: false, fecha: false, paradas: false, hora: false, comercial: false });
    expect(camposTocados({ pilotoPersonalId: 1, auxiliarNombre: "x", flotaVehiculoId: 2, fechaPlan: "2026-01-01", paradas: [], horaCarga: "05:00", tarifaId: null }))
      .toEqual({ piloto: true, auxiliares: true, unidad: true, fecha: true, paradas: true, hora: true, comercial: true });
  });

  it("motivo obligatorio solo para piloto/unidad/auxiliares", () => {
    expect(validarMotivoCambioRecursos(camposTocados({ pilotoPersonalId: 1 }), "  ")).toMatchObject({ status: 400 });
    expect(validarMotivoCambioRecursos(camposTocados({ pilotoPersonalId: 1 }), "Piloto no se presentó")).toBeNull();
    expect(validarMotivoCambioRecursos(camposTocados({ fechaPlan: "2026-01-01" }), undefined)).toBeNull();
  });

  it("estado: Cerrado/Cancelado 409; En ruta según llegada; Programado/Cargado/Descargado libres", () => {
    const todo = camposTocados({ pilotoPersonalId: 1, fechaPlan: "2026-01-01" });
    expect(validarEstadoEditable({ estado: "Cerrado", pendienteCierre: false }, nadie)).toMatchObject({ status: 409 });
    expect(validarEstadoEditable({ estado: "Cancelado", pendienteCierre: false }, nadie)).toMatchObject({ status: 409 });
    expect(validarEstadoEditable({ estado: "En ruta", pendienteCierre: false }, nadie)).toBeNull();
    expect(validarEstadoEditable({ estado: "En ruta", pendienteCierre: false }, todo)?.error).toContain("no permitido: piloto, fecha");
    expect(validarEstadoEditable({ estado: "En ruta", pendienteCierre: true }, camposTocados({ pilotoPersonalId: 1 }))).toBeNull();
    expect(validarEstadoEditable({ estado: "En ruta", pendienteCierre: true }, todo)?.error).toContain("(pendiente de cierre)");
    for (const estado of ["Programado", "Cargado", "Descargado"]) expect(validarEstadoEditable({ estado, pendienteCierre: false }, todo)).toBeNull();
  });

  it("fecha pasada (hoy y futuro sí; sin fecha no bloquea)", () => {
    expect(validarFechaNoPasada("2026-09-23", "2026-09-24")).toMatchObject({ status: 400 });
    expect(validarFechaNoPasada("2026-09-24", "2026-09-24")).toBeNull();
    expect(validarFechaNoPasada("2026-09-25", "2026-09-24")).toBeNull();
    expect(validarFechaNoPasada("", "2026-09-24")).toBeNull();
  });

  it("regreso estimado posterior a la salida (sin hora usa 00:00)", () => {
    expect(validarRegresoPosteriorASalida("2026-09-24T08:00", "2026-09-24", "08:00:00")).toMatchObject({ status: 400 });
    expect(validarRegresoPosteriorASalida("2026-09-24T08:01", "2026-09-24", "08:00:00")).toBeNull();
    expect(validarRegresoPosteriorASalida("2026-09-24T00:00", "2026-09-24", null)).toMatchObject({ status: 400 });
    expect(validarRegresoPosteriorASalida(null, "2026-09-24", "08:00")).toBeNull();
  });
});

describe("cambios reales y personal que sale (puras)", () => {
  const antes = { pilotoId: 10, auxiliaresIds: [5, 6], unidadFlotaId: 55 };

  it("sin cambios y sin cambio de fecha: nada que revalidar", () => {
    const c = calcularCambiosRecursos(antes, { pilotoId: undefined, auxiliaresIds: undefined, unidadFlotaId: 55 }, false);
    expect(c).toMatchObject({ pilotoCambioReal: false, auxiliaresCambioReal: false, unidadCambioReal: false, pilotoIdParaValidar: null, auxiliaresIdsParaValidar: [], vehiculoIdParaValidar: null });
  });

  it("reenviar los MISMOS recursos no es un cambio (aunque el campo venga en el request)", () => {
    const c = calcularCambiosRecursos(antes, { pilotoId: 10, auxiliaresIds: [6, 5], unidadFlotaId: 55 }, false);
    expect(c.pilotoCambioReal || c.auxiliaresCambioReal || c.unidadCambioReal).toBe(false);
  });

  it("cambio de fecha revalida los recursos ya asignados; un cambio real revalida solo el nuevo", () => {
    expect(calcularCambiosRecursos(antes, { pilotoId: undefined, auxiliaresIds: undefined, unidadFlotaId: 55 }, true))
      .toMatchObject({ pilotoIdParaValidar: 10, auxiliaresIdsParaValidar: [5, 6], vehiculoIdParaValidar: 55 });
    expect(calcularCambiosRecursos(antes, { pilotoId: 20, auxiliaresIds: [5, 6, 7], unidadFlotaId: 77 }, false))
      .toMatchObject({ pilotoCambioReal: true, pilotoIdParaValidar: 20, auxiliaresCambioReal: true, auxiliaresIdsParaValidar: [5, 6, 7], unidadCambioReal: true, vehiculoIdParaValidar: 77 });
  });

  it("quitar piloto o auxiliares (a null / vacío) cuenta como cambio real", () => {
    const c = calcularCambiosRecursos(antes, { pilotoId: undefined, auxiliaresIds: [], unidadFlotaId: null }, false);
    expect(c).toMatchObject({ auxiliaresCambioReal: true, auxiliaresIdsParaValidar: [], unidadCambioReal: true, vehiculoIdParaValidar: null });
  });

  it("personalQueSale: piloto anterior si cambia + auxiliares que ya no están (nombre de respaldo #id)", () => {
    const a = { pilotoId: 10, piloto: "Ana", auxiliaresIds: [5, 6], auxiliaresNombres: ["Beto", ""] };
    expect(personalQueSale(a, { pilotoId: 20, auxiliaresIds: [5] })).toEqual([{ personalId: 10, nombre: "Ana" }, { personalId: 6, nombre: "Auxiliar #6" }]);
    expect(personalQueSale(a, { pilotoId: 10, auxiliaresIds: [5, 6] })).toEqual([]);
    expect(personalQueSale({ ...a, pilotoId: null }, { pilotoId: 20, auxiliaresIds: [5, 6] })).toEqual([]);
  });
});

describe("evaluación de disponibilidad (pura)", () => {
  const disp = (over: Record<string, unknown> = {}) => ({ personalId: 1, nombre: "Ana", incidenciasBloqueantes: [], viajeActual: null, estadoDisponibilidad: "disponible", otrosPlanesDelDia: [], advertencias: [], ...over });
  const ctx = { fechaEfectiva: "2026-09-25", esHoy: false, planId: 40 };

  it("personal: el primer bloqueo gana; otros planes y avisos son advertencias; nunca advierte contra el propio plan", () => {
    const r = evaluarDisponibilidadPersonal(
      [disp({ otrosPlanesDelDia: [{ planId: 40, planCodigo: "P-40" }, { planId: 41, planCodigo: "P-41" }], viajeActual: {} })],
      [{ personalId: 1, rol: "auxiliar" }], ctx);
    expect(r.error).toBeNull();
    expect(r.advertencias.map((a) => a.tipo)).toEqual(["viaje_actual_auxiliar", "otro_plan_dia_auxiliar"]);
    const hoy = evaluarDisponibilidadPersonal([disp({ viajeActual: {} })], [{ personalId: 1, rol: "auxiliar" }], { ...ctx, esHoy: true });
    expect(hoy.error).toEqual({ status: 409, error: "El auxiliar Ana tiene un viaje en curso." });
  });

  it("personal fuera del listado disponible no se evalúa (igual que antes)", () => {
    expect(evaluarDisponibilidadPersonal([], [{ personalId: 1, rol: "piloto" }], ctx)).toEqual({ error: null, advertencias: [] });
  });

  it("unidad: TC como unidad 400 solo si el cambio es real; inactiva 409; taller/ruta solo bloquean hoy", () => {
    const v = (over: Record<string, unknown> = {}) => [{ id: 1, placa: "C-1", tipoUnidad: "Camion", estadoDisponibilidad: "disponible", ...over }];
    expect(evaluarDisponibilidadUnidad(v({ tipoUnidad: "TC" }), 1, true, ctx).error?.status).toBe(400);
    expect(evaluarDisponibilidadUnidad(v({ tipoUnidad: "TC" }), 1, false, ctx).error).toBeNull();
    expect(evaluarDisponibilidadUnidad(v({ estadoDisponibilidad: "inactivo" }), 1, true, ctx).error?.status).toBe(409);
    expect(evaluarDisponibilidadUnidad(v({ estadoDisponibilidad: "en_taller" }), 1, true, { ...ctx, esHoy: true }).error?.status).toBe(409);
    expect(evaluarDisponibilidadUnidad(v({ estadoDisponibilidad: "en_taller" }), 1, true, ctx).advertencias[0].tipo).toBe("vehiculo_en_taller");
    expect(evaluarDisponibilidadUnidad(v({ estadoDisponibilidad: "en_ruta" }), 1, true, ctx).advertencias[0].tipo).toBe("vehiculo_en_ruta");
    expect(evaluarDisponibilidadUnidad(v(), 99, true, ctx)).toEqual({ error: null, advertencias: [] });
  });
});

describe("PATCH usa los helpers y el PR-0 no cambia superficie", () => {
  const route = readFileSync("src/app/api/empresas/[slug]/tms/planes/route.ts", "utf8").replace(/\r\n/g, "\n");
  it("planes/route.ts delega en programacion-validacion-recursos y ya no incrusta esas reglas", () => {
    for (const h of ["resolverSeleccionPersonal(empresaId, d, \"escritura\")", "validarEstadoEditable(", "validarMotivoCambioRecursos(", "validarFechaNoPasada(", "calcularCambiosRecursos(", "evaluarDisponibilidadPersonal(", "evaluarDisponibilidadUnidad(", "validarRemocionConViaticos(", "resolverCambioTc("]) {
      expect(route).toContain(h);
    }
    for (const texto of ["Indica el motivo del cambio de piloto", "ya no admite modificaciones desde Programación", "no está activo o el empleado vinculado está de baja", "La unidad seleccionada está inactiva"]) {
      expect(route).not.toContain(texto);
    }
  });

  it("el PATCH sigue con la política DIARIA, el candado por empresa y la auditoría fuera de la transacción", () => {
    expect(route).toContain("primerConflictoProgramacionDia(");
    expect(route).not.toContain("primerConflictoProgramacionIntervalo");
    expect(route).toContain("`tms_traslape_${empresaId}`");
  });

  it("no se crearon endpoints de edición rápida ni se tocó la UI", () => {
    const fuente = (p: string) => readFileSync(p, "utf8");
    expect(fuente("src/app/e/[slug]/programacion/programacion-client.tsx")).not.toMatch(/edicion-rapida|Edición rápida/i);
    expect(fuente("src/app/e/[slug]/programacion/plan-form.tsx")).not.toMatch(/edicion-rapida/i);
  });
});
