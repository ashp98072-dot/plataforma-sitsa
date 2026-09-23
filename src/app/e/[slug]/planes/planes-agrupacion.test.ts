import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agruparPorFecha,
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

describe("agrupación visual por fecha", () => {
  it("agrupa por fechaPlan y ordena los grupos por fecha DESC", () => {
    expect(agruparPorFecha(planes).map((g) => g.fecha)).toEqual(["2026-09-23", "2026-09-22", "2026-09-21"]);
  });

  it("dentro de cada fecha conserva el orden del backend (estable)", () => {
    const g = agruparPorFecha(planes);
    expect(g[0].planes.map((x) => x.id)).toEqual([2, 3, 4, 5]);
    expect(g[1].planes.map((x) => x.id)).toEqual([1, 7]);
  });

  it("contadores por día: total, pendientes de cierre (cierre normal disponible), cerrados y otros", () => {
    const [d23, d22, d21] = agruparPorFecha(planes);
    expect(d23).toMatchObject({ total: 4, cerrables: 2, cerrados: 0, otros: 2 }); // En ruta con llegada + Descargado; Programado y Cancelado = otros
    expect(d22).toMatchObject({ total: 2, cerrables: 0, cerrados: 1, otros: 1 }); // el Programado "pendiente" NO cuenta como cerrable
    expect(d21).toMatchObject({ total: 1, cerrables: 0, cerrados: 0, otros: 1 });
    for (const g of [d23, d22, d21]) expect(g.cerrables + g.cerrados + g.otros).toBe(g.total);
  });

  it("no oculta ni pierde viajes antiguos: la suma de los grupos es el total de la página", () => {
    expect(agruparPorFecha(planes).reduce((n, g) => n + g.total, 0)).toBe(planes.length);
    expect(agruparPorFecha([])).toEqual([]);
  });

  it("expandir/contraer: por defecto solo el día más reciente abierto; el usuario puede alternar cualquiera", () => {
    expect(grupoAbierto(0, "2026-09-23", {}, false)).toBe(true);
    expect(grupoAbierto(1, "2026-09-22", {}, false)).toBe(false);
    expect(grupoAbierto(2, "2026-09-21", {}, false)).toBe(false);
    expect(grupoAbierto(0, "2026-09-23", { "2026-09-23": false }, false)).toBe(false); // contraer el reciente
    expect(grupoAbierto(2, "2026-09-21", { "2026-09-21": true }, false)).toBe(true); // expandir uno antiguo
    expect(grupoAbierto(2, "2026-09-21", {}, true)).toBe(true); // deep-link ?plan=: el día del plan enfocado se abre
  });

  it("fecha visible dd/mm/aaaa", () => {
    expect(fechaVisible("2026-09-23")).toBe("23/09/2026");
  });
});

describe("paginación: una fecha puede partirse entre páginas", () => {
  it("solo los grupos de los bordes avisan que pueden continuar", () => {
    expect(notaPaginacionGrupo(0, 3, 1, 1)).toBeNull();
    expect(notaPaginacionGrupo(0, 3, 1, 3)).toBeNull(); // primera página: el primer día no viene de antes
    expect(notaPaginacionGrupo(2, 3, 1, 3)).toContain("siguiente"); // el último día puede seguir en la página 2
    expect(notaPaginacionGrupo(0, 3, 2, 3)).toContain("anterior");
    expect(notaPaginacionGrupo(1, 3, 2, 3)).toBeNull(); // un día intermedio está completo
    expect(notaPaginacionGrupo(2, 3, 3, 3)).toBeNull();
    expect(notaPaginacionGrupo(0, 1, 2, 3)).toContain("anterior y en la siguiente"); // un solo día en una página intermedia
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
  const dia = agruparPorFecha(planes)[0].planes; // 2 En ruta(llegada) / 3 Programado / 4 Descargado / 5 Cancelado

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

  it("dos botones masivos SEPARADOS (Cerrar seleccionados / Cierre manual masivo) y el modal manual exige motivo y advierte", () => {
    expect(src).toContain('abrirMasivo("NORMAL", g.fecha)');
    expect(src).toContain('abrirMasivo("MANUAL", g.fecha)');
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

  it("modo reporte NO obtiene acciones operativas: sin agrupación, sin checkbox, sin botones masivos", () => {
    expect(src).toContain("const mostrarSel = !esReporte && puedeCerrarViaje");
    expect(src).toContain("esReporte ? [] : agruparPorFecha(planes)");
    expect(src).toContain("if (esReporte) return planes.map((p) => ({ kind: \"plan\" as const, p }))");
    expect(src).toContain("{mostrarSel && it.abierto ? (");
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

  it("checkbox por viaje deshabilitado si no es seleccionable; el encabezado de día trae Hoy, contadores y nota de paginación", () => {
    expect(src).toContain("disabled={!esSeleccionable(p, puedeCerrarViaje)}");
    expect(src).toContain("g.fecha === hoy");
    expect(src).toContain("{g.cerrables} pendientes de cierre");
    expect(src).toContain("{g.cerrados} cerrados");
    expect(src).toContain("{g.otros} otros");
    expect(src).toContain("notaPaginacionGrupo(");
  });
});
