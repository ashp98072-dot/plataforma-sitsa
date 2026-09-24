import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * TMS-VIATICOS-AGRUPACION-1 (PR 1) — el panel "Operaciones > Viáticos" agrupa por Día/Semana/Mes con <details> y
 * autoriza los seleccionados DE UN GRUPO reutilizando SIN CAMBIOS el flujo actual (firma una vez en la UI, POST
 * individual por viático, parcial, no transaccional, firmaLote). No hay harness de componentes: se verifica el código.
 */
const src = readFileSync("src/components/tms/viaticos-control-panel.tsx", "utf8").replace(/\r\n/g, "\n");
const bloque = (desde: string, hasta: string) => src.slice(src.indexOf(desde), src.indexOf(hasta, src.indexOf(desde)));

describe("UI: selector y grupos desplegables", () => {
  it("selector 'Agrupar por' con Día / Semana / Mes (Día por defecto)", () => {
    expect(src).toContain('useState<ModoAgrupacion>("DIA")');
    expect(src).toContain("Agrupar por");
    expect(src).toContain("MODOS_AGRUPACION.map((m)");
    const lib = readFileSync("src/lib/tms/viaticos-agrupacion.ts", "utf8");
    for (const e of ['"Día"', '"Semana"', '"Mes"']) expect(lib).toContain(e);
  });

  it("un <details>/<summary> por grupo, el más reciente abierto por defecto; la key incluye el modo", () => {
    expect(src).toContain("<details key={`${modoAgrupacion}-${g.clave}`} ref={(el) => abrirPrimerGrupoUnaVez(el, indice === 0)}");
    // `open` NO se impone desde React (un re-render al seleccionar reabriría/cerraría grupos); `defaultOpen` no existe en <details>.
    expect(src).not.toMatch(/open=\{indice === 0\}/);
    expect(src).not.toContain("defaultOpen");
    expect(src).toMatch(/if \(!el \|\| el\.dataset\.inicializado\) return;\s+el\.dataset\.inicializado = "1";\s+if \(esPrimero\) el\.open = true;/);
    expect(src).toContain("<summary");
    expect(src).not.toMatch(/setGrupoAbierto|useState<Record<string, boolean>>/); // sin estado React para abrir/cerrar
  });

  it("encabezado con etiqueta, resumen (total · pendientes · monto no rechazado) y conteos por estado", () => {
    expect(src).toContain("{g.etiqueta}");
    expect(src).toContain("resumenGrupo(g, q)");
    for (const c of ["por autorizar", "autorizados", "rechazados", "entregados", "liquidados"]) expect(src).toContain(c);
  });

  it("contador por grupo 'Seleccionados: X de N'", () => {
    expect(src).toMatch(/Seleccionados: <strong>\{sel\.length\}<\/strong> de <strong>\{g\.total\}<\/strong>/);
  });

  it("agrupa DESPUÉS de filtrar y funciona en todas las pestañas (mismo `filtrados`)", () => {
    expect(src).toContain("const grupos = useMemo(() => agruparViaticos(filtrados, modoAgrupacion)");
    for (const e of ["PROGRAMADO", "AUTORIZADO", "RECHAZADO", "ENTREGADO", "LIQUIDADO"]) expect(src).toContain(`estado: "${e}"`); // las 5 pestañas siguen
  });

  it("conserva los filtros existentes (búsqueda, empleado, rol, método, desde, hasta) y los recargos", () => {
    for (const f of ["fBusqueda", "fEmpleado", "fRol", "fMetodo", "fFechaDesde", "fFechaHasta", "fEstado"]) expect(src).toContain(`const [${f}, `);
    expect(src).toContain("/tms/viaticos/control?${params.toString()}");
  });
});

describe("selección por grupo", () => {
  it("cada grupo tiene Seleccionar todos / Limpiar selección del grupo y checkbox por viático", () => {
    expect(src).toContain("Seleccionar todos del grupo");
    expect(src).toContain("Limpiar selección del grupo");
    expect(src).toContain("seleccionarTodosDelGrupo(prev, g)");
    expect(src).toContain("limpiarSeleccionDelGrupo(prev, g)");
    expect(src).toContain("onChange={() => toggleSeleccion(r.id)}");
  });

  it("la selección se limpia al recargar, al cambiar filtros del cliente y al cambiar la agrupación", () => {
    expect(bloque("const cargar = useCallback", "  useEffect(() => {")).toContain("setSeleccionados(new Set())");
    expect(src).toContain("}, [fBusqueda, fRol, fMetodo, modoAgrupacion]);");
  });

  it("no queda el botón/checkbox GLOBAL que mezclaba grupos", () => {
    expect(src).not.toContain("toggleSeleccionTodos");
    expect(src).not.toContain("filtrados.length > 0 && seleccionados.size === filtrados.length");
    expect(src.match(/Autorizar seleccionados\$\{/g)).toHaveLength(1); // solo el botón del grupo
  });
});

describe("autorización de seleccionados del grupo: el flujo ACTUAL, sin cambios", () => {
  const masivo = bloque("  async function autorizarSeleccionados()", "  return (\n");

  it("el botón del grupo pasa SOLO los ids seleccionados de ese grupo y solo aparece con permiso de autorizar", () => {
    expect(src).toContain("onClick={() => void abrirMasivo(idsAAutorizarDelGrupo(seleccionados, g))}");
    expect(src).toMatch(/\{puedeAutorizar \? \(\n\s+<div className="flex flex-wrap items-center gap-2 border-b/);
  });

  it("abrirMasivo congela los ids del grupo y el bucle usa EXACTAMENTE esos ids (no `seleccionados` global)", () => {
    expect(src).toContain("async function abrirMasivo(ids: number[])");
    expect(src).toContain("setIdsMasivo(ids)");
    expect(masivo).toContain("const ids = [...idsMasivo]");
    expect(masivo).not.toContain("[...seleccionados]");
  });

  it("sigue siendo: firma una vez (Mi firma o dibujada) + POST individual por viático + parcial + no transaccional", () => {
    expect(masivo).toContain("firmaImagen = (await canvasMasivoRef.current?.obtenerImagen()) ?? null");
    expect(masivo).toContain('fd.set("usarFirmaGuardada", "true")');
    expect(masivo).toContain('fd.set("firmaImagen", firmaImagen!, "firma.png")');
    expect(masivo).toContain('fd.set("firmaLote", "true")'); // una firma electrónica por viático, con firmaLote
    expect(masivo).toContain("for (const id of ids)");
    expect(masivo).toContain("await fetch(`/api/empresas/${slug}/tms/viaticos/${id}/autorizar`");
    expect(masivo).toContain("fallos.push(");
    expect(masivo).toContain("No se pudieron autorizar ${fallos.length}: ${fallos.join(\" · \")}");
    expect(masivo).toContain("viático(s) autorizado(s) y firmado(s)");
    expect(masivo).toContain("await cargar()");
  });

  it("no hay endpoint nuevo de autorización masiva/atómica ni firma de requerimiento", () => {
    expect(src).not.toMatch(/autorizar-masiv|autorizar-lote|requerimiento|viatico_activo|viatico_id/i);
    expect(src.match(/\/tms\/viaticos\/\$\{id\}\/autorizar/g)).toHaveLength(1);
  });

  it("el modal muestra la cantidad del grupo (no la selección global)", () => {
    expect(src).toContain("Firmar y autorizar seleccionados ({idsMasivo.length})");
    expect(src).toContain("`Firmar y autorizar (${idsMasivo.length})`");
  });

  it("la fila (acciones individuales, rechazo, firmas) es la misma de siempre", () => {
    for (const t of ["Firmar y autorizar", "Rechazar", "Firmar liquidación", "Ver firmas", "Rechazado por:"]) expect(src).toContain(t);
  });
});
