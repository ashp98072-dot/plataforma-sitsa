import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agruparPlanes,
  elegibilidadCierre,
  esSeleccionable,
  fechaVisible,
  grupoAbierto,
  idsSeleccionables,
  notaPaginacionGrupo,
  resumenSeleccion,
  type PlanAgrupable,
} from "./planes-agrupacion";
import { accionesViaje } from "./planes-viajes-client";

// PLANES-TARIFA-CIERRE-1 — tarifaComercial: 500 por defecto (CON tarifa); los tests "sin tarifa" la pasan explícitamente como null.
const p = (id: number, fechaPlan: string, estado: string, pendienteCierre = false, tarifaComercial: number | null = 500): PlanAgrupable => ({ id, fechaPlan, estado, pendienteCierre, tarifaComercial });

const planes: PlanAgrupable[] = [
  p(1, "2026-09-22", "Cerrado"),
  p(2, "2026-09-23", "En ruta", true),
  p(3, "2026-09-23", "Programado"),
  p(4, "2026-09-23", "Descargado"),
  p(5, "2026-09-23", "Cancelado"),
  p(6, "2026-09-21", "Cargado"),
  p(7, "2026-09-22", "Programado", true), // el listado lo marca pendiente (hay llegada) pero cerrarViaje() lo rechaza
];

describe("agrupación visual por DÍA (comportamiento previo, ítem 1: se conserva)", () => {
  it("agrupa por fechaPlan y ordena los grupos por fecha DESC", () => {
    expect(agruparPlanes(planes, "DIA").map((g) => g.clave)).toEqual(["2026-09-23", "2026-09-22", "2026-09-21"]);
  });

  it("dentro de cada fecha conserva el orden del backend (estable)", () => {
    const g = agruparPlanes(planes, "DIA");
    expect(g[0].planes.map((x) => x.id)).toEqual([2, 3, 4, 5]);
    expect(g[1].planes.map((x) => x.id)).toEqual([1, 7]);
  });

  it("contadores por día: total, pendientes de cierre (cierre normal disponible), cerrados y otros", () => {
    const [d23, d22, d21] = agruparPlanes(planes, "DIA");
    expect(d23).toMatchObject({ clave: "2026-09-23", etiqueta: "23/09/2026", total: 4, cerrables: 2, cerrados: 0, otros: 2 }); // En ruta con llegada + Descargado; Programado y Cancelado = otros
    expect(d22).toMatchObject({ total: 2, cerrables: 0, cerrados: 1, otros: 1 }); // el Programado "pendiente" NO cuenta como cerrable
    expect(d21).toMatchObject({ total: 1, cerrables: 0, cerrados: 0, otros: 1 });
    for (const g of [d23, d22, d21]) expect(g.cerrables + g.cerrados + g.otros).toBe(g.total);
  });

  it("no oculta ni pierde viajes antiguos: la suma de los grupos es el total de la página", () => {
    expect(agruparPlanes(planes, "DIA").reduce((n, g) => n + g.total, 0)).toBe(planes.length);
    expect(agruparPlanes([], "DIA")).toEqual([]);
  });

  it("todos los grupos empiezan contraídos y el usuario puede alternar cualquiera", () => {
    expect(grupoAbierto(0, "2026-09-23", {}, false)).toBe(false);
    expect(grupoAbierto(1, "2026-09-22", {}, false)).toBe(false);
    expect(grupoAbierto(2, "2026-09-21", {}, false)).toBe(false);
    expect(grupoAbierto(0, "2026-09-23", { "2026-09-23": false }, false)).toBe(false); // contraer el reciente
    expect(grupoAbierto(2, "2026-09-21", { "2026-09-21": true }, false)).toBe(true); // expandir uno antiguo
    expect(grupoAbierto(2, "2026-09-21", {}, true)).toBe(true); // deep-link ?plan=: el grupo del plan enfocado se abre
    expect(grupoAbierto(2, "2026-09-21", { "2026-09-21": false }, true)).toBe(false); // el toggle explícito prevalece sobre el foco
  });

  it("fecha visible dd/mm/aaaa (helper conservado)", () => {
    expect(fechaVisible("2026-09-23")).toBe("23/09/2026");
  });
});

describe("apertura por defecto en Día/Semana/Mes", () => {
  it.each(["DIA", "SEMANA", "MES"] as const)("%s: todos cerrados, foco abierto y alternancia manual conservada", (modo) => {
    const grupos = agruparPlanes([p(1, "2026-09-30", "Descargado"), p(2, "2026-08-10", "Cerrado")], modo);
    expect(grupos).toHaveLength(2);
    const toggles: Record<string, boolean> = {};
    grupos.forEach((g, indice) => {
      expect(grupoAbierto(indice, g.clave, toggles, false)).toBe(false);
      expect(grupoAbierto(indice, g.clave, toggles, true)).toBe(true);
      toggles[g.clave] = !grupoAbierto(indice, g.clave, toggles, false);
      expect(grupoAbierto(indice, g.clave, toggles, false)).toBe(true);
      toggles[g.clave] = !grupoAbierto(indice, g.clave, toggles, false);
      expect(grupoAbierto(indice, g.clave, toggles, true)).toBe(false);
    });
    expect(grupos.map(({ total, cerrables, cerrados }) => ({ total, cerrables, cerrados }))).toEqual([
      { total: 1, cerrables: 1, cerrados: 0 }, { total: 1, cerrables: 0, cerrados: 1 },
    ]);
  });

  it("cambiar de modo no hereda la apertura de una clave de otro modo", () => {
    const viaje = [p(1, "2026-09-30", "Programado")];
    const claves = (["DIA", "SEMANA", "MES"] as const).map((modo) => agruparPlanes(viaje, modo)[0].clave);
    expect(claves).toEqual(["2026-09-30", "2026-W40", "2026-09"]);
    const toggles: Record<string, boolean> = {};
    for (const clave of claves) {
      expect(grupoAbierto(0, clave, toggles, false)).toBe(false);
      toggles[clave] = true;
    }
  });
});

describe("agrupación visual por SEMANA y MES (PLANES-CIERRE-PERIODO)", () => {
  const planesSemana: PlanAgrupable[] = [
    p(10, "2026-09-28", "Descargado"), // lunes de la semana 40
    p(11, "2026-10-04", "Cerrado"), // domingo de la MISMA semana 40 (cruza de mes)
    p(12, "2026-09-14", "Programado"), // semana 38
  ];

  it("2. Semana lunes-domingo: agrupa por semana ISO, no por día calendario", () => {
    const grupos = agruparPlanes(planesSemana, "SEMANA");
    expect(grupos.map((g) => g.clave)).toEqual(["2026-W40", "2026-W38"]);
    expect(grupos[0].planes.map((x) => x.id)).toEqual([10, 11]); // mismo grupo aunque cruce septiembre/octubre
    expect(grupos[0].etiqueta).toBe("Semana 40 · 28/09/2026 al 04/10/2026");
  });

  it("5. Mes: agrupa por mes calendario", () => {
    const grupos = agruparPlanes(planesSemana, "MES");
    expect(grupos.map((g) => g.clave)).toEqual(["2026-10", "2026-09"]);
    expect(grupos.find((g) => g.clave === "2026-09")!.planes.map((x) => x.id)).toEqual([10, 12]);
    expect(grupos.find((g) => g.clave === "2026-09")!.etiqueta).toBe("Septiembre 2026");
  });

  it("6. orden descendente por período en los tres modos", () => {
    for (const modo of ["DIA", "SEMANA", "MES"] as const) {
      const claves = agruparPlanes(planes, modo).map((g) => g.clave);
      expect([...claves].sort().reverse()).toEqual(claves);
    }
  });

  it("7. counts total/cerrables/cerrados/otros también en SEMANA/MES (mismo criterio que DÍA)", () => {
    const [semana] = agruparPlanes(planesSemana, "SEMANA");
    expect(semana.cerrables + semana.cerrados + semana.otros).toBe(semana.total);
  });
});

describe("paginación: un grupo (día/semana/mes) puede partirse entre páginas", () => {
  it("solo los grupos de los bordes avisan que pueden continuar, con el nombre del período correspondiente", () => {
    expect(notaPaginacionGrupo(0, 3, 1, 1, "DIA")).toBeNull();
    expect(notaPaginacionGrupo(0, 3, 1, 3, "DIA")).toBeNull(); // primera página: el primer grupo no viene de antes
    expect(notaPaginacionGrupo(2, 3, 1, 3, "DIA")).toContain("Este día puede continuar en la página siguiente");
    expect(notaPaginacionGrupo(0, 3, 2, 3, "SEMANA")).toContain("Esta semana puede continuar en la página anterior");
    expect(notaPaginacionGrupo(1, 3, 2, 3, "MES")).toBeNull(); // un grupo intermedio está completo
    expect(notaPaginacionGrupo(2, 3, 3, 3, "DIA")).toBeNull();
    expect(notaPaginacionGrupo(0, 1, 2, 3, "MES")).toContain("Este mes puede continuar en la página anterior y en la siguiente");
  });
});

describe("elegibilidad: la UI coincide con el backend", () => {
  it("Programado: NO cierre normal (aunque el listado lo marque pendiente), SÍ manual", () => {
    for (const pend of [false, true]) expect(elegibilidadCierre(p(1, "d", "Programado", pend), true)).toEqual({ normal: false, manual: true });
  });
  it("Descargado: normal sí (con o sin llegada), manual no", () => {
    for (const pend of [false, true]) expect(elegibilidadCierre(p(1, "d", "Descargado", pend), true)).toEqual({ normal: true, manual: false });
  });
  it("En ruta / Cargado con llegada válida: normal Y manual", () => {
    for (const e of ["En ruta", "Cargado"]) expect(elegibilidadCierre(p(1, "d", e, true), true)).toEqual({ normal: true, manual: true });
  });
  it("En ruta / Cargado SIN llegada: solo manual", () => {
    for (const e of ["En ruta", "Cargado"]) expect(elegibilidadCierre(p(1, "d", e, false), true)).toEqual({ normal: false, manual: true });
  });
  it("Cerrado y Cancelado: ninguno, y no seleccionables", () => {
    for (const e of ["Cerrado", "Cancelado"]) {
      expect(elegibilidadCierre(p(1, "d", e, true), true)).toEqual({ normal: false, manual: false });
      expect(esSeleccionable(p(1, "d", e, true), true)).toBe(false);
    }
  });
  it("sin permiso viajes_cerrar:editar nada es elegible ni seleccionable", () => {
    for (const e of ["Programado", "Descargado", "En ruta", "Cargado", "Cerrado", "Cancelado"]) {
      expect(elegibilidadCierre(p(1, "d", e, true), false)).toEqual({ normal: false, manual: false });
      expect(esSeleccionable(p(1, "d", e, true), false)).toBe(false);
    }
  });
});

describe('corrección de la inconsistencia: "Cerrar viaje" normal solo si cerrarViaje() lo admitiría (todos CON tarifa)', () => {
  it("Programado con llegada (pendienteCierre) YA NO muestra 'Cerrar viaje' pero conserva Cierre manual", () => {
    const a = accionesViaje("operativo", { estado: "Programado", pendienteCierre: true, tarifaComercial: 500 }, true);
    expect(a.cerrar).toBe(false);
    expect(a.cierreManual).toBe(true);
  });
  it("Descargado sí muestra 'Cerrar viaje' (el backend lo admite aunque el listado no lo marque pendiente)", () => {
    expect(accionesViaje("operativo", { estado: "Descargado", pendienteCierre: false, tarifaComercial: 500 }, true).cerrar).toBe(true);
  });
  it("En ruta sin llegada: sin 'Cerrar viaje' (solo manual); con llegada: sí", () => {
    expect(accionesViaje("operativo", { estado: "En ruta", pendienteCierre: false, tarifaComercial: 500 }, true).cerrar).toBe(false);
    expect(accionesViaje("operativo", { estado: "En ruta", pendienteCierre: true, tarifaComercial: 500 }, true).cerrar).toBe(true);
  });
});

/** PLANES-TARIFA-CIERRE-1 (7-10, 29-33) — accionesViaje respeta tarifa; UI test 29-37 se cubren en el bloque de inspección de código más abajo. */
describe("accionesViaje — tarifa (PLANES-TARIFA-CIERRE-1)", () => {
  it("Descargado SIN tarifa (null) -> ni cerrar ni cierreManual, y faltaTarifa=true", () => {
    const a = accionesViaje("operativo", { estado: "Descargado", pendienteCierre: false, tarifaComercial: null }, true);
    expect(a.cerrar).toBe(false);
    expect(a.cierreManual).toBe(false);
    expect(a.faltaTarifa).toBe(true);
  });

  it("Programado SIN tarifa -> cierreManual false, faltaTarifa true (el estado SÍ admitiría manual si tuviera tarifa)", () => {
    const a = accionesViaje("operativo", { estado: "Programado", pendienteCierre: false, tarifaComercial: null }, true);
    expect(a.cierreManual).toBe(false);
    expect(a.faltaTarifa).toBe(true);
  });

  it("Cerrado SIN tarifa -> faltaTarifa false (el estado de todos modos no admitiría ningún cierre, no es 'culpa' de la tarifa)", () => {
    const a = accionesViaje("operativo", { estado: "Cerrado", pendienteCierre: false, tarifaComercial: null }, true);
    expect(a.faltaTarifa).toBe(false);
  });

  it("Q0.00 (tarifaComercial = 0, no null) se comporta como CON tarifa", () => {
    const a = accionesViaje("operativo", { estado: "Descargado", pendienteCierre: false, tarifaComercial: 0 }, true);
    expect(a.cerrar).toBe(true);
    expect(a.faltaTarifa).toBe(false);
  });

  it("modo reporte: faltaTarifa siempre false (sin acciones operativas)", () => {
    const a = accionesViaje("reporte", { estado: "Descargado", pendienteCierre: false, tarifaComercial: null }, true);
    expect(a.faltaTarifa).toBe(false);
  });

  it("sin permiso viajes_cerrar:editar: faltaTarifa siempre false", () => {
    const a = accionesViaje("operativo", { estado: "Descargado", pendienteCierre: false, tarifaComercial: null }, false);
    expect(a.faltaTarifa).toBe(false);
  });
});

describe("selección y resumen por tipo de cierre", () => {
  const dia = agruparPlanes(planes, "DIA")[0].planes; // 2 En ruta(llegada) / 3 Programado / 4 Descargado / 5 Cancelado

  it("'Seleccionar elegibles' solo incluye viajes que admiten algún cierre (nunca Cerrado/Cancelado)", () => {
    expect(idsSeleccionables(dia, true)).toEqual([2, 3, 4]);
    expect(idsSeleccionables(dia, false)).toEqual([]);
  });

  it("una selección por día; cada botón recalcula sus elegibles y no elegibles", () => {
    const r = resumenSeleccion(dia, new Set([2, 3, 4, 5]), true);
    expect(r.seleccionados).toBe(4);
    expect(r.normal).toEqual({ elegibles: 2, noElegibles: 2, ids: [2, 4] }); // En ruta con llegada + Descargado
    expect(r.manual).toEqual({ elegibles: 2, noElegibles: 2, ids: [2, 3] }); // En ruta + Programado
  });

  it("ignora ids seleccionados que no pertenecen al grupo mostrado", () => {
    const r = resumenSeleccion(dia, new Set([1, 6, 4]), true);
    expect(r.seleccionados).toBe(1);
    expect(r.normal.ids).toEqual([4]);
    expect(r.manual.ids).toEqual([]);
  });

  it("limpiar selección: un conjunto vacío no habilita ningún cierre", () => {
    const r = resumenSeleccion(dia, new Set(), true);
    expect(r).toMatchObject({ seleccionados: 0, normal: { elegibles: 0, ids: [] }, manual: { elegibles: 0, ids: [] } });
  });
});

describe("pantalla (código fuente): selección, botones separados y reporte sin acciones nuevas", () => {
  const src = readFileSync("src/app/e/[slug]/planes/planes-viajes-client.tsx", "utf8");

  it("cualquier carga (filtros, página, rango, búsqueda, tras cerrar) limpia la selección, y tras el masivo se recarga", () => {
    const cargar = src.slice(src.indexOf("const cargar = useCallback"), src.indexOf("}, [slug, filtrosQueryString"));
    expect(cargar).toContain("setSeleccion(new Set())");
    expect(cargar.indexOf("setSeleccion(new Set())")).toBeLessThan(cargar.indexOf("await fetch") === -1 ? cargar.indexOf("fetch(") : cargar.indexOf("await fetch"));
    const masivo = src.slice(src.indexOf("async function ejecutarMasivo"), src.indexOf("const columnas ="));
    expect(masivo).toContain("await cargar()");
    expect(masivo).toContain("/tms/planes/cerrar-masivo");
  });

  it("dos botones masivos SEPARADOS (Cerrar seleccionados / Cierre manual masivo, por SELECCIÓN de esta página) y el modal manual exige motivo y advierte", () => {
    expect(src).toContain('abrirMasivo("NORMAL", g.clave)');
    expect(src).toContain('abrirMasivo("MANUAL", g.clave)');
    expect(src).toContain("Cerrar seleccionados");
    expect(src).toContain("Cierre manual masivo");
    expect(src).toContain("Este cierre es administrativo y puede cerrar viajes sin llegada física registrada. No se crearán horas de llegada, km de llegada ni evidencias.");
    expect(src).toContain("Confirmar cierre manual");
    expect(src).toContain("Se intentarán cerrar únicamente los {cual.elegibles} elegibles. ¿Continuar?");
    expect(src).toMatch(/motivoMasivo\.trim\(\)\.length < 5/);
    expect(src).toContain("Elegibles para cierre manual");
  });

  it("solo se envían al servidor los elegibles del tipo elegido (y el servidor revalida)", () => {
    expect(src).toContain('const ids = masivo.tipo === "NORMAL" ? r.normal.ids : r.manual.ids');
    expect(src).not.toMatch(/empresa_?id/i);
  });

  it("modo reporte NO obtiene acciones operativas: sin agrupación por defecto, sin checkbox, sin botones masivos ni de período", () => {
    expect(src).toContain("const mostrarSel = !esReporte && puedeCerrarViaje");
    expect(src).toContain("esReporte ? [] : agruparPlanes(planes, modoAgrupacion)");
    expect(src).toContain("if (esReporte) return planes.map((p) => ({ kind: \"plan\" as const, p }))");
    expect(src).toContain("{mostrarSel && it.abierto ? (");
    expect(src).toContain("{!esReporte ? (");
    expect(accionesViaje("reporte", { estado: "Descargado", pendienteCierre: true, tarifaComercial: 500 }, true)).toEqual({ verDetalle: true, pdf: true, irProgramacion: false, cerrar: false, cierreManual: false, faltaTarifa: false });
  });

  it("regresión: cierre individual, cierre manual individual, Ver detalle, Programación y PDF siguen en cada fila", () => {
    expect(src).toContain("onClick={() => pedirCierre(p.id)}");
    expect(src).toContain("onClick={() => abrirCierreManual(p.id)}");
    expect(src).toContain("void abrirDetalle(p.id)");
    expect(src).toContain("/programacion?plan=${p.id}");
    expect(src).toContain("/tms/planes/${p.id}/reporte-pdf");
    expect(src).toContain("/tms/planes/${planId}/cerrar");
  });

  it("checkbox por viaje deshabilitado si no es seleccionable; el encabezado de grupo trae Hoy (solo en DÍA), contadores y nota de paginación", () => {
    expect(src).toContain("disabled={!esSeleccionable(p, puedeCerrarViaje)}");
    expect(src).toContain('modoAgrupacion === "DIA" && g.clave === hoy');
    expect(src).toContain("{g.cerrables} pendientes de cierre");
    expect(src).toContain("{g.cerrados} cerrados");
    expect(src).toContain("{g.otros} otros");
    expect(src).toContain("notaPaginacionGrupo(it.indice, grupos.length, page, totalPaginas, modoAgrupacion)");
  });
});

/**
 * PLANES-CIERRE-PERIODO — extiende la agrupación/cierre masivo de Planes / Viajes a Semana y Mes, cerrando
 * TODO el período (más allá de la página cargada), resuelto SIEMPRE server-side. Mismo criterio de pruebas que
 * el resto de este archivo: sin harness de componentes React, se verifica el código fuente directamente.
 */
describe("PLANES-CIERRE-PERIODO — selector Día/Semana/Mes y acciones del período completo", () => {
  const src = readFileSync("src/app/e/[slug]/planes/planes-viajes-client.tsx", "utf8").replace(/\r\n/g, "\n");

  it("28. selector Agrupar por con Día / Semana / Mes (Día por defecto)", () => {
    expect(src).toContain('useState<AgrupacionPlanes>("DIA")');
    expect(src).toContain("Agrupar por");
    expect(src).toContain('<option value="DIA">Día</option>');
    expect(src).toContain('<option value="SEMANA">Semana</option>');
    expect(src).toContain('<option value="MES">Mes</option>');
  });

  it("no se muestra el selector de agrupación en modo reporte", () => {
    const selector = src.slice(src.indexOf("{/* PLANES-CIERRE-PERIODO — selector de agrupación"), src.indexOf("{/* Tabla */}"));
    expect(selector).toContain("{!esReporte ? (");
  });

  it("las acciones 'Cerrar elegibles del período' / 'Cierre manual del período' son DISTINTAS de 'Cerrar seleccionados' — nunca reutilizan `seleccion`", () => {
    const fn = src.slice(src.indexOf("async function abrirCierrePeriodo"), src.indexOf("async function ejecutarCierrePeriodo"));
    expect(fn).not.toContain("seleccion");
    const fn2 = src.slice(src.indexOf("async function ejecutarCierrePeriodo"), src.indexOf("puedeAccionPeriodo = mostrarSel"));
    expect(fn2).not.toContain("seleccion");
    expect(src).toContain("Cerrar elegibles del período");
    expect(src).toContain("Cierre manual del período");
  });

  it("candidatos-cierre (GET, vista previa) y cerrar-masivo-periodo (POST, ejecución) son endpoints separados del cierre-masivo por selección", () => {
    expect(src).toContain("/tms/planes/candidatos-cierre?");
    expect(src).toContain("/tms/planes/cerrar-masivo-periodo");
  });

  it("filtros del período: cliente/piloto/unidad/estado/ruta/facturación/cobro Y soloPendientes/soloCerrados/soloSinCerrar se reenvían (intersección con el rango); fDesde/fHasta NUNCA (el período fija el rango, no las fechas generales de pantalla)", () => {
    const fn = src.slice(src.indexOf("const filtrosPeriodoValores = useCallback"), src.indexOf("}, [fCliente, fPiloto, fUnidad, fEstado, fRuta, fEstadoFacturacion, fEstadoCobro, soloPendientes, soloCerrados, soloSinCerrar]"));
    for (const campo of ["clienteId", "pilotoId", "unidadId", "estado", "ruta", "estadoFacturacion", "estadoCobro", "soloPendientesCierre", "soloCerrados", "soloSinCerrar"]) {
      expect(fn).toContain(campo);
    }
    expect(fn).not.toContain("fDesde");
    expect(fn).not.toContain("fHasta");
  });

  it("clienteId/pilotoId/unidadId se convierten a number (nunca strings crudos del <select>) — el backend exige number en el body JSON", () => {
    const fn = src.slice(src.indexOf("const filtrosPeriodoValores = useCallback"), src.indexOf("}, [fCliente, fPiloto, fUnidad, fEstado, fRuta, fEstadoFacturacion, fEstadoCobro, soloPendientes, soloCerrados, soloSinCerrar]"));
    expect(fn).toContain("f.clienteId = Number(fCliente)");
    expect(fn).toContain("f.pilotoId = Number(fPiloto)");
    expect(fn).toContain("f.unidadId = Number(fUnidad)");
  });

  it("al CONFIRMAR, el backend vuelve a resolver los candidatos (nunca reutiliza los ids de la vista previa) — el POST no envía ids", () => {
    const fn = src.slice(src.indexOf("async function ejecutarCierrePeriodo"), src.indexOf("puedeAccionPeriodo = mostrarSel"));
    expect(fn).not.toContain("candidatosPeriodo.normal.ids");
    expect(fn).not.toContain("candidatosPeriodo.manual.ids");
    expect(fn).not.toContain("planIds");
  });

  it("deep-link ?plan=<id> deshabilita las acciones del período (el usuario debe volver a 'Ver todos los planes')", () => {
    expect(src).toContain("const puedeAccionPeriodo = mostrarSel && planFocoId == null");
  });

  it("modal de confirmación advierte explícitamente que incluye viajes de OTRAS páginas y muestra el total/elegibles/no elegibles", () => {
    expect(src).toContain("incluyendo viajes de otras páginas");
    expect(src).toContain("Viajes encontrados: {candidatosPeriodo.total}");
    expect(src).toContain("No elegibles: {noElegibles}");
  });

  it("MANUAL del período exige motivo (5-500) y admite comentario opcional (<=1000), mismo criterio que el masivo por selección", () => {
    expect(src).toMatch(/motivoPeriodo\.trim\(\)\.length < 5/);
    expect(src).toContain('maxLength={500} value={motivoPeriodo}');
    expect(src).toContain('maxLength={1000} value={comentarioPeriodo}');
  });

  it("el resultado combinado (bloque 'Resultado del cierre masivo') se generaliza a período — un solo bloque para ambos orígenes", () => {
    expect(src).toContain("resultadoMasivo.etiquetaOrigen");
    expect(src).not.toMatch(/resultadoMasivo\.fecha\b/);
  });

  it("cambiar de agrupación limpia la selección (evita referirse a un grupo con un formato de clave que ya no existe)", () => {
    const efecto = src.slice(src.indexOf("useEffect(() => {\n    // Cambiar de Día/Semana/Mes"), src.indexOf("}, [modoAgrupacion]);"));
    expect(efecto).toContain("setSeleccion(new Set())");
  });
});

/**
 * PLANES-SEPARAR-CERRADOS — separa "Pendientes / Activos" (estado <> 'Cerrado') de "Viajes cerrados"
 * (estado = 'Cerrado') en dos pestañas del modo operativo, reutilizando soloSinCerrar/soloCerrados ya
 * existentes en el backend (nunca una tabla nueva ni SQL duplicado). Mismo criterio de pruebas que el resto
 * de este archivo: sin harness de componentes React, se verifica el código fuente directamente.
 */
describe("PLANES-SEPARAR-CERRADOS — pestañas Pendientes/Activos vs Viajes cerrados", () => {
  const src = readFileSync("src/app/e/[slug]/planes/planes-viajes-client.tsx", "utf8").replace(/\r\n/g, "\n");
  const fnAplicar = src.slice(src.indexOf("function aplicarFiltrosDeVista"), src.indexOf("function irAVista"));
  const fnIrAVista = src.slice(src.indexOf("function irAVista"), src.indexOf("function limpiarFiltros"));
  const fnLimpiar = src.slice(src.indexOf("function limpiarFiltros"), src.indexOf("function verTodosLosPlanes"));

  it("1) modo operativo inicia en ACTIVOS (vista y soloSinCerrar por defecto)", () => {
    expect(src).toContain('useState<VistaPlanes>("ACTIVOS")');
    expect(src).toContain('useState(modo === "operativo")'); // soloSinCerrar: true en operativo, false en reporte (sin cambios)
  });

  it("2/3) ACTIVOS manda soloSinCerrar=1 y NO manda soloCerrados — mismo builder de query existente (filtrosQueryString)", () => {
    expect(src).toContain('if (soloSinCerrar) p.set("soloSinCerrar", "1")');
    expect(src).toContain('if (soloCerrados) p.set("soloCerrados", "1")');
    // aplicarFiltrosDeVista(ACTIVOS) deja soloSinCerrar=true y soloCerrados=false — ambos estados fluyen al mismo filtrosQueryString ya existente.
    expect(fnAplicar).toMatch(/setSoloSinCerrar\(true\);\s*\n\s*setSoloCerrados\(false\);/);
  });

  it("4/5) CERRADOS manda soloCerrados=1 y NO manda soloSinCerrar", () => {
    expect(fnAplicar).toMatch(/setSoloCerrados\(true\);\s*\n\s*setSoloSinCerrar\(false\);/);
  });

  it("8) CERRADOS fuerza soloPendientes=false", () => {
    const bloqueCerrados = fnAplicar.slice(fnAplicar.indexOf('if (v === "CERRADOS")'), fnAplicar.indexOf("} else {"));
    expect(bloqueCerrados).toContain("setSoloPendientes(false)");
  });

  it("6) cambiar de pestaña resetea page=1 (reutiliza buscarTick -> cargar(1), mismo mecanismo que 'Buscar')", () => {
    expect(fnIrAVista).toContain("setBuscarTick((t) => t + 1)");
    // El efecto que escucha buscarTick llama cargar(1) con página fija — no cargar(page).
    const efectoBuscarTick = src.slice(src.indexOf("useEffect(() => {\n    // eslint-disable-next-line react-hooks/set-state-in-effect\n    void cargar(1)"), src.indexOf("}, [buscarTick])"));
    expect(efectoBuscarTick).toContain("void cargar(1)");
  });

  it("7) cambiar de pestaña limpia la selección de cierre masivo", () => {
    expect(fnIrAVista).toContain("setSeleccion(new Set())");
  });

  it("9/10/11/12) filtros cliente/piloto/unidad/rango de fecha se CONSERVAN al cambiar de pestaña (irAVista nunca los toca)", () => {
    for (const campo of ["fCliente", "fPiloto", "fUnidad", "fDesde", "fHasta"]) {
      expect(fnIrAVista).not.toContain(`set${campo[0].toUpperCase()}${campo.slice(1)}`);
    }
  });

  it("13/14/15) la agrupación Día/Semana/Mes es independiente de la pestaña — agruparPlanes(planes, modoAgrupacion) no depende de `vista`", () => {
    expect(src).toContain("const grupos = useMemo(() => (esReporte ? [] : agruparPlanes(planes, modoAgrupacion))");
  });

  it("16/17) las acciones de cierre (selección/masivo/período) son visibles en ACTIVOS y se ocultan en CERRADOS: todas cuelgan de mostrarSel, que ahora exige vista === \"ACTIVOS\"", () => {
    expect(src).toContain('const mostrarSel = !esReporte && puedeCerrarViaje && vista === "ACTIVOS"');
    expect(src).toContain("const puedeAccionPeriodo = mostrarSel && planFocoId == null");
    expect(src).toContain('...(mostrarSel ? ["Sel."] : [])');
    expect(src).toContain("{mostrarSel && it.abierto ? (");
    expect(src).toContain("{puedeAccionPeriodo && it.abierto ? (");
  });

  it("18) el checkbox 'Solo pendientes de cierre' solo aparece en modo reporte o en la pestaña ACTIVOS del operativo", () => {
    expect(src).toContain('{esReporte || vista === "ACTIVOS" ? (');
    expect(src).toContain("checked={soloPendientes}");
  });

  it("19) los checkboxes 'Solo cerrados'/'Solo sin cerrar' ya NO aparecen en modo operativo — solo dentro de `{esReporte ? (...) : null}`", () => {
    const bloqueCheckboxes = src.slice(src.indexOf('<div className="mt-2 flex flex-wrap gap-3 text-xs">'), src.indexOf("{/* OPERACIONES-UX-PLANES-REPORTES-1 — exportación"));
    expect(bloqueCheckboxes).toContain("{esReporte ? (");
    expect(bloqueCheckboxes).toContain("checked={soloCerrados}");
    expect(bloqueCheckboxes).toContain("checked={soloSinCerrar}");
    // Ambos checkboxes (sus <input checked={...}>, no solo el texto en un comentario) quedan DENTRO del bloque
    // `esReporte ? (...) : null` — nunca sueltos, fuera de esa condición.
    const idxEsReporte = bloqueCheckboxes.indexOf("{esReporte ? (");
    const idxSoloCerrados = bloqueCheckboxes.indexOf("checked={soloCerrados}");
    const idxSoloSinCerrar = bloqueCheckboxes.indexOf("checked={soloSinCerrar}");
    expect(idxSoloCerrados).toBeGreaterThan(idxEsReporte);
    expect(idxSoloSinCerrar).toBeGreaterThan(idxEsReporte);
  });

  it("20) Reportes conserva los 3 filtros de siempre (soloPendientes/soloCerrados/soloSinCerrar), sin pestañas", () => {
    expect(src).toContain("{!esReporte ? (");
    expect(src).toContain('role="tablist" aria-label="Vista de viajes"');
    // El bloque de pestañas nunca se renderiza cuando esReporte es true.
    const idxPestañas = src.indexOf('role="tablist" aria-label="Vista de viajes"');
    const idxEsReporteGuard = src.lastIndexOf("{!esReporte ? (", idxPestañas);
    expect(idxEsReporteGuard).toBeGreaterThan(-1);
    expect(idxEsReporteGuard).toBeLessThan(idxPestañas);
  });

  it("21/22) deep-link a un plan (abierto o Cerrado) sigue funcionando: filtrosQueryString ignora soloSinCerrar/soloCerrados/vista cuando hay planFocoId (comportamiento existente, sin cambios)", () => {
    const fnFiltrosQuery = src.slice(src.indexOf("const filtrosQueryString = useCallback"), src.indexOf("const exportQueryString"));
    expect(fnFiltrosQuery).toContain("if (planFocoId != null)");
    expect(fnFiltrosQuery).toContain('p.set("planId", String(planFocoId))');
    expect(fnFiltrosQuery).toContain("return p;"); // corta ANTES de aplicar soloSinCerrar/soloCerrados/fEstado
    // El corte temprano ocurre ANTES de las líneas que agregan soloSinCerrar/soloCerrados a la query.
    const idxCorte = fnFiltrosQuery.indexOf('p.set("planId", String(planFocoId))');
    const idxSoloSinCerrar = fnFiltrosQuery.indexOf('p.set("soloSinCerrar"');
    expect(idxCorte).toBeLessThan(idxSoloSinCerrar);
  });

  it("23/24/25/26) cerrar individual/manual/masivo/período recargan con `cargar()` (servidor sigue siendo fuente de verdad) — nunca un filter() optimista en el arreglo local", () => {
    expect(src).not.toMatch(/planes\.filter\(\s*\(?p\)?\s*=>\s*p\.id\s*!==/); // ningún filtro optimista del arreglo `planes` tras cerrar
    const fnConfirmarManual = src.slice(src.indexOf("async function confirmarCierreManual"), src.indexOf("async function abrirDetalle"));
    expect(fnConfirmarManual).toContain("await cargar()");
    const fnCerrarViaje = src.slice(src.indexOf("async function cerrarViaje(planId"), src.indexOf("const mostrarSel ="));
    expect(fnCerrarViaje).toContain("await cargar()");
    const fnEjecutarMasivo = src.slice(src.indexOf("async function ejecutarMasivo"), src.indexOf("async function abrirCierrePeriodo"));
    expect(fnEjecutarMasivo).toContain("await cargar()");
    const fnEjecutarPeriodo = src.slice(src.indexOf("async function ejecutarCierrePeriodo"), src.indexOf("puedeAccionPeriodo = mostrarSel"));
    expect(fnEjecutarPeriodo).toContain("await cargar()");
  });

  it("27) el backend no cambia: sigue reutilizando soloCerrados/soloSinCerrar ya existentes (mismos nombres de parámetro en la query string)", () => {
    expect(src).toContain('p.set("soloCerrados", "1")');
    expect(src).toContain('p.set("soloSinCerrar", "1")');
    expect(src).not.toContain("vista=cerrados"); // no se persiste en URL (fuera de alcance, estado client-side)
  });

  it("28) no SQL: ningún string de este archivo contiene una sentencia SQL (sigue siendo un componente cliente puro)", () => {
    expect(src).not.toMatch(/\bSELECT\b|\bUPDATE\b|\bINSERT\b/);
  });

  it("Cancelados: ACTIVOS usa exactamente estado <> 'Cerrado' (vía soloSinCerrar) — nunca excluye Cancelado ni crea una tercera pestaña", () => {
    expect(src).not.toContain('"CANCELADOS"');
    expect(src).not.toContain("VistaPlanes = \"ACTIVOS\" | \"CERRADOS\" | \"CANCELADOS\"");
    // El filtro Estado en ACTIVOS sigue permitiendo seleccionar "Cancelado" explícitamente.
    expect(src).toContain('ESTADOS.filter((e) => e !== "Cerrado")');
  });

  it("filtro Estado: ACTIVOS nunca ofrece 'Cerrado'; CERRADOS lo fija y deshabilita; Reportes sin cambios", () => {
    const bloqueEstado = src.slice(src.indexOf('<label className="text-xs text-[var(--muted)]">Estado\n'), src.indexOf("</label>", src.indexOf('<label className="text-xs text-[var(--muted)]">Estado\n')));
    expect(bloqueEstado).toContain('disabled={!esReporte && vista === "CERRADOS"}');
    expect(bloqueEstado).toContain('<option value="Cerrado">Cerrado</option>');
    expect(bloqueEstado).toContain("ESTADOS.filter((e) => e !== \"Cerrado\")");
  });

  it("limpiarFiltros() en modo operativo reaplica los filtros de la pestaña ACTUAL (nunca deja soloSinCerrar/soloCerrados en false/false, lo que rompería la separación)", () => {
    expect(fnLimpiar).toContain('if (modo === "operativo")');
    expect(fnLimpiar).toContain("aplicarFiltrosDeVista(vista)");
  });

  it("contadores del grupo: CERRADOS muestra un resumen limpio ('N viaje(s) · N cerrados'); ACTIVOS oculta '0 cerrados'; ningún cambio al helper agruparPlanes", () => {
    expect(src).toContain("{g.total} viaje(s) · {g.cerrados} cerrados");
    expect(src).toContain("{g.cerrados > 0 ?");
  });

  it("las pestañas están posicionadas después de los filtros principales y antes de 'Agrupar por'", () => {
    const idxFiltrosFin = src.indexOf("</section>\n\n      {/* PLANES-SEPARAR-CERRADOS — pestañas");
    const idxPestañas = src.indexOf('role="tablist" aria-label="Vista de viajes"');
    const idxAgruparPor = src.indexOf("Agrupar por");
    expect(idxFiltrosFin).toBeGreaterThan(-1);
    expect(idxFiltrosFin).toBeLessThan(idxPestañas);
    expect(idxPestañas).toBeLessThan(idxAgruparPor);
  });
});
