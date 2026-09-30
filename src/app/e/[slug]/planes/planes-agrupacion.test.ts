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

const p = (id: number, fechaPlan: string, estado: string, pendienteCierre = false): PlanAgrupable => ({ id, fechaPlan, estado, pendienteCierre });

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

  it("expandir/contraer: por defecto solo el grupo más reciente abierto; el usuario puede alternar cualquiera", () => {
    expect(grupoAbierto(0, "2026-09-23", {}, false)).toBe(true);
    expect(grupoAbierto(1, "2026-09-22", {}, false)).toBe(false);
    expect(grupoAbierto(2, "2026-09-21", {}, false)).toBe(false);
    expect(grupoAbierto(0, "2026-09-23", { "2026-09-23": false }, false)).toBe(false); // contraer el reciente
    expect(grupoAbierto(2, "2026-09-21", { "2026-09-21": true }, false)).toBe(true); // expandir uno antiguo
    expect(grupoAbierto(2, "2026-09-21", {}, true)).toBe(true); // deep-link ?plan=: el grupo del plan enfocado se abre
  });

  it("fecha visible dd/mm/aaaa (helper conservado)", () => {
    expect(fechaVisible("2026-09-23")).toBe("23/09/2026");
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

describe('corrección de la inconsistencia: "Cerrar viaje" normal solo si cerrarViaje() lo admitiría', () => {
  it("Programado con llegada (pendienteCierre) YA NO muestra 'Cerrar viaje' pero conserva Cierre manual", () => {
    const a = accionesViaje("operativo", { estado: "Programado", pendienteCierre: true }, true);
    expect(a.cerrar).toBe(false);
    expect(a.cierreManual).toBe(true);
  });
  it("Descargado sí muestra 'Cerrar viaje' (el backend lo admite aunque el listado no lo marque pendiente)", () => {
    expect(accionesViaje("operativo", { estado: "Descargado", pendienteCierre: false }, true).cerrar).toBe(true);
  });
  it("En ruta sin llegada: sin 'Cerrar viaje' (solo manual); con llegada: sí", () => {
    expect(accionesViaje("operativo", { estado: "En ruta", pendienteCierre: false }, true).cerrar).toBe(false);
    expect(accionesViaje("operativo", { estado: "En ruta", pendienteCierre: true }, true).cerrar).toBe(true);
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
    expect(accionesViaje("reporte", { estado: "Descargado", pendienteCierre: true }, true)).toEqual({ verDetalle: true, pdf: true, irProgramacion: false, cerrar: false, cierreManual: false });
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
