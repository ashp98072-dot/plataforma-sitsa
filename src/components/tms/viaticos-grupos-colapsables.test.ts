import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agruparViaticos, alternarEnSeleccion, resumenGrupo, seleccionarTodosDelGrupo } from "@/lib/tms/viaticos-agrupacion";
import {
  algunoAbierto,
  alternarGrupo,
  claveExpansion,
  estaAbierto,
  expandirTodos,
  GRUPOS_INICIALES,
  ocultarTodos,
  todosAbiertos,
} from "@/lib/tms/viaticos-grupos-expansion";

/**
 * VIÁTICOS — todos los grupos de fecha colapsables. La expansión es estado PURO y solo visual (lib) más el cableado del
 * panel (guardas del código: no hay harness de componentes en este proyecto).
 */
const v = (id: number, fechaPlan: string, estado = "PROGRAMADO", montoAsignado = 100) => ({ id, fechaPlan, estado, montoAsignado });
const items = [v(1, "2026-09-25"), v(2, "2026-09-25"), v(3, "2026-09-24"), v(4, "2026-09-23", "AUTORIZADO"), v(5, "2026-09-22", "RECHAZADO")];
const grupos = () => agruparViaticos(items, "DIA");
const claves = () => grupos().map((g) => claveExpansion("DIA", g.clave));
const src = readFileSync("src/components/tms/viaticos-control-panel.tsx", "utf8").replace(/\r\n/g, "\n");

describe("expansión de grupos de fecha (lógica)", () => {
  it("estado inicial: TODOS colapsados", () => {
    for (const c of claves()) expect(estaAbierto(GRUPOS_INICIALES, c)).toBe(false);
    expect(algunoAbierto(GRUPOS_INICIALES, claves())).toBe(false);
  });

  it("1/2) el PRIMER grupo (más reciente) puede abrirse, cerrarse y volver a abrirse", () => {
    const primero = claves()[0];
    expect(primero).toBe("DIA:2026-09-25");
    let s = alternarGrupo(GRUPOS_INICIALES, primero);
    expect(estaAbierto(s, primero)).toBe(true);
    s = alternarGrupo(s, primero);
    expect(estaAbierto(s, primero)).toBe(false); // sin excepción: ningún grupo queda forzado abierto
    s = alternarGrupo(s, primero);
    expect(estaAbierto(s, primero)).toBe(true);
  });

  it("3) un grupo intermedio puede cerrarse sin afectar a los demás", () => {
    const [a, b, c] = claves();
    let s = expandirTodos(GRUPOS_INICIALES, claves());
    s = alternarGrupo(s, b);
    expect([a, b, c].map((k) => estaAbierto(s, k))).toEqual([true, false, true]);
  });

  it("4) varios grupos pueden estar abiertos a la vez (estado independiente por grupo)", () => {
    const [a, b, c, d] = claves();
    let s = alternarGrupo(GRUPOS_INICIALES, b);
    s = alternarGrupo(s, d);
    expect([a, b, c, d].map((k) => estaAbierto(s, k))).toEqual([false, true, false, true]); // 25 cerrado · 24 abierto · 23 cerrado · 22 abierto
  });

  it("5) todos pueden quedar cerrados simultáneamente", () => {
    let s = expandirTodos(GRUPOS_INICIALES, claves());
    for (const c of claves()) s = alternarGrupo(s, c);
    expect(algunoAbierto(s, claves())).toBe(false);
  });

  it("6) Expandir todos abre todos los grupos visibles", () => {
    const s = expandirTodos(GRUPOS_INICIALES, claves());
    expect(todosAbiertos(s, claves())).toBe(true);
    expect(claves().every((c) => estaAbierto(s, c))).toBe(true);
  });

  it("7) Ocultar todos cierra todos", () => {
    const s = ocultarTodos();
    expect(algunoAbierto(s, claves())).toBe(false);
    expect(claves().every((c) => !estaAbierto(s, c))).toBe(true);
  });

  it("no muta el estado anterior (inmutable)", () => {
    const base = alternarGrupo(GRUPOS_INICIALES, "DIA:2026-09-25");
    const antes = [...base];
    alternarGrupo(base, "DIA:2026-09-24");
    expandirTodos(base, claves());
    expect([...base]).toEqual(antes);
    expect(GRUPOS_INICIALES.size).toBe(0);
  });

  it("10) cambiar filtros: los grupos que siguen existiendo conservan su estado y los nuevos inician cerrados", () => {
    let s = alternarGrupo(alternarGrupo(GRUPOS_INICIALES, "DIA:2026-09-25"), "DIA:2026-09-23");
    // un filtro deja solo los viáticos del 25 y del 22
    const filtrados = agruparViaticos(items.filter((x) => x.fechaPlan === "2026-09-25" || x.fechaPlan === "2026-09-22"), "DIA");
    const visibles = filtrados.map((g) => claveExpansion("DIA", g.clave));
    expect(visibles.map((c) => estaAbierto(s, c))).toEqual([true, false]); // 25 sigue abierto; 22 (no abierto antes) cerrado
    // al quitar el filtro, el 23 (que estaba abierto) reaparece abierto y el 24 nunca abierto sigue cerrado
    s = expandirTodos(s, []);
    expect([estaAbierto(s, "DIA:2026-09-23"), estaAbierto(s, "DIA:2026-09-24")]).toEqual([true, false]);
  });

  it("cada modo (Día/Semana/Mes) guarda su propia expansión (la clave incluye el modo)", () => {
    const s = alternarGrupo(GRUPOS_INICIALES, claveExpansion("DIA", "2026-09-25"));
    expect(estaAbierto(s, claveExpansion("MES", "2026-09"))).toBe(false);
    expect(claveExpansion("DIA", "x")).not.toBe(claveExpansion("SEMANA", "x"));
  });

  it("12) el encabezado muestra el resumen aun cerrado (viene del grupo, no de las filas)", () => {
    const g = grupos()[0];
    expect(resumenGrupo(g, (n) => `Q${n}`)).toBe("2 viáticos · 2 pendientes · Q200");
    expect(g.conteos).toMatchObject({ PROGRAMADO: 2, AUTORIZADO: 0, RECHAZADO: 0 });
  });

  it("8) colapsar NO cambia la selección: la expansión y la selección son estados independientes", () => {
    const g = grupos()[0];
    let seleccion = seleccionarTodosDelGrupo(new Set<number>([99]), g);
    seleccion = alternarEnSeleccion(seleccion, 3);
    const copia = [...seleccion].sort();
    let abiertos = expandirTodos(GRUPOS_INICIALES, claves());
    abiertos = alternarGrupo(abiertos, claves()[0]); // cierra el grupo con selección
    abiertos = ocultarTodos();
    expect(abiertos.size).toBe(0);
    expect([...seleccion].sort()).toEqual(copia); // ninguna función de expansión recibe ni devuelve la selección
  });
});

describe("cableado del panel (guardas del código)", () => {
  it("1-5/11) encabezado = botón real con aria-expanded y aria-controls; sin <details> ni grupo forzado abierto", () => {
    expect(src).toContain("aria-expanded={abierto}");
    expect(src).toContain("aria-controls={idCuerpo}");
    expect(src).toContain("<div id={idCuerpo} hidden={!abierto}>");
    expect(src).toContain('{abierto ? "▼" : "▶"}');
    expect(src).not.toContain("<details");
    expect(src).not.toMatch(/indice === 0|esPrimero/);
  });

  it("estado inicial vacío (todos colapsados) y un solo estado para varios abiertos", () => {
    expect(src).toContain("useState<GruposAbiertos>(GRUPOS_INICIALES)");
    expect(src).toContain("onClick={() => setGruposAbiertos((a) => alternarGrupo(a, claveG))}");
  });

  it("6/7) botones Expandir todos y Ocultar todos con los grupos visibles", () => {
    expect(src).toContain("Expandir todos");
    expect(src).toContain("Ocultar todos");
    expect(src).toContain("setGruposAbiertos((a) => expandirTodos(a, clavesGrupos))");
    expect(src).toContain("setGruposAbiertos(ocultarTodos())");
    expect(src).toContain("const clavesGrupos = grupos.map((g) => claveExpansion(modoAgrupacion, g.clave));");
  });

  it("8/9) colapsar/expandir solo llama a setGruposAbiertos: no toca la selección ni hace requests", () => {
    for (const trozo of ["setGruposAbiertos((a) => alternarGrupo(a, claveG))", "setGruposAbiertos((a) => expandirTodos(a, clavesGrupos))", "setGruposAbiertos(ocultarTodos())"]) {
      const i = src.indexOf(trozo);
      expect(i).toBeGreaterThan(-1);
      const linea = src.slice(src.lastIndexOf("\n", i), src.indexOf("\n", i));
      expect(linea).not.toMatch(/setSeleccionados|fetch|cargar|autorizar/);
    }
    // ningún efecto limpia la selección por cambios de expansión
    expect(src).toContain("}, [fBusqueda, fRol, fMetodo, modoAgrupacion]);");
    expect(src).not.toMatch(/\[[^\]]*gruposAbiertos[^\]]*\]\);/);
  });

  it("10) los filtros y la agrupación siguen igual: la expansión no se reinicia al filtrar", () => {
    const efecto = src.slice(src.indexOf("setSeleccionados(new Set());\n  }, [fBusqueda"), src.indexOf("}, [fBusqueda, fRol, fMetodo, modoAgrupacion]);") + 60);
    expect(efecto).not.toContain("setGruposAbiertos");
    expect(src).toContain("const grupos = useMemo(() => agruparViaticos(filtrados, modoAgrupacion)");
  });

  it("no se tocó autorización, rechazo, firmas ni la bandeja 'Viáticos por pagar'", () => {
    expect(src).toContain("abrirMasivo(idsAAutorizarDelGrupo(seleccionados, g))");
    expect(src).toContain("Seleccionar todos del grupo");
    expect(src).not.toContain("PAGAR (FACTURADOR)"); // esa sección vive en otro componente
  });
});
