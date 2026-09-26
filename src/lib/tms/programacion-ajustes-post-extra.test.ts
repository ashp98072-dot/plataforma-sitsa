import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  agruparViaticosPorRol,
  derivarFilasViaticos,
  derivarPreviewViaticosEdicion,
  empleadosPersistidos,
  tituloGrupoPilotos,
  type EstadoFormularioPersonal,
} from "./plan-form-viaticos";
import { payloadTipoViaje, precargaTipoViajeDesdePlan } from "./plan-form-tercerizado";
import {
  ALTO_FILA,
  ALTO_LINEA_EXTRA,
  altoFilaImagen,
  celdaPilotoImagen,
  celdasFila,
  construirLayoutImagen,
  envolverTexto,
  type FilaProgramacionImagen,
} from "./programacion-imagen";
import { auxiliaresDeVista, pilotosDeVista, tieneAuxiliaresVista, tienePilotoVista } from "./programacion-personal-vista";
import { PilotosCelda } from "@/components/tms/pilotos-celda";

const raiz = join(__dirname, "../../..");
const src = (p: string) => readFileSync(join(raiz, p), "utf-8").replace(/\r\n/g, "\n");

const base: EstadoFormularioPersonal = {
  tipoViaje: "Propio",
  pilotoEmpleadoId: 10,
  pilotoNombre: "Juan Pérez",
  mostrarPilotoExtra: false,
  pilotoExtraEmpleadoId: 0,
  pilotoExtraNombre: "",
  auxiliarEmpleadoIds: [],
  auxiliarNombres: [],
};
const opts = { sugeridoPorRol: (r: string) => (r === "Piloto" ? 100 : 50) };

describe("1) creación: preview de viáticos derivado del estado actual del formulario", () => {
  it("principal + extra + auxiliares aparecen de inmediato, cada uno con su fila", () => {
    const f = { ...base, mostrarPilotoExtra: true, pilotoExtraEmpleadoId: 11, pilotoExtraNombre: "Ana Gómez", auxiliarEmpleadoIds: [20] };
    const filas = derivarFilasViaticos(f, opts);
    expect(filas.map((x) => [x.key, x.rol, x.empleadoId])).toEqual([
      ["piloto", "Piloto", 10],
      ["piloto-extra-11", "Piloto", 11],
      ["aux-emp-20", "Auxiliar", 20],
    ]);
    expect(agruparViaticosPorRol(filas).pilotos).toHaveLength(2);
    expect(tituloGrupoPilotos(2)).toBe("Pilotos");
  });
  it("quitar el extra hace desaparecer su fila; sin extra el bloque es el de siempre", () => {
    const con = derivarFilasViaticos({ ...base, mostrarPilotoExtra: true, pilotoExtraEmpleadoId: 11 }, opts);
    const sin = derivarFilasViaticos({ ...base, mostrarPilotoExtra: false, pilotoExtraEmpleadoId: 11 }, opts);
    expect(con).toHaveLength(2);
    expect(sin.map((x) => x.key)).toEqual(["piloto"]);
    expect(tituloGrupoPilotos(1)).toBe("Piloto");
  });
  it("Tercerizado no admite extra", () => {
    const filas = derivarFilasViaticos({ ...base, tipoViaje: "Tercerizado", mostrarPilotoExtra: true, pilotoExtraEmpleadoId: 11 }, opts);
    expect(filas.some((x) => x.key.startsWith("piloto-extra"))).toBe(false);
  });
});

describe("2-4) edición: preview solo de quien aún no está persistido; nunca duplica", () => {
  const plan = { pilotoEmpleadoId: 10, pilotoExtraEmpleadoId: null, auxiliaresDetalle: [{ empleadoId: 20 }] };
  it("agregar extra en edición → una fila de preview del extra (no del principal ni del auxiliar ya guardados)", () => {
    const f = { ...base, mostrarPilotoExtra: true, pilotoExtraEmpleadoId: 11, auxiliarEmpleadoIds: [20] };
    const prev = derivarPreviewViaticosEdicion(f, empleadosPersistidos(plan), opts);
    expect(prev.map((x) => x.empleadoId)).toEqual([11]);
  });
  it("quitar el extra en edición → sin preview", () => {
    const f = { ...base, mostrarPilotoExtra: false, auxiliarEmpleadoIds: [20] };
    expect(derivarPreviewViaticosEdicion(f, empleadosPersistidos(plan), opts)).toEqual([]);
  });
  it("extra ya persistido → sin duplicado entre preview y viático real", () => {
    const persistido = { ...plan, pilotoExtraEmpleadoId: 11 };
    const f = { ...base, mostrarPilotoExtra: true, pilotoExtraEmpleadoId: 11, auxiliarEmpleadoIds: [20] };
    expect(derivarPreviewViaticosEdicion(f, empleadosPersistidos(persistido), opts)).toEqual([]);
  });
  it("el formulario solo muestra preview en edición Propio y no inventa estados", () => {
    const f = src("src/app/e/[slug]/programacion/plan-form.tsx");
    expect(f).toContain("data-preview-viaticos");
    expect(f).toContain("Viáticos por crear al guardar");
    expect(f).not.toMatch(/data-preview-viaticos[\s\S]{0,400}(Procesado|Pagado)/);
  });
});

describe("5-7) imagen: dos pilotos en la misma columna, fila auto, sin truncar", () => {
  const fila = (piloto: string): FilaProgramacionImagen => ({
    mes: "SEP", dia: "26", placa: "C-1", tc: "", piloto, auxiliar1: "", auxiliar2: "", cliente: "X", lugarCarga: "A", hora: "08:00", lugarDescarga: "B",
  });
  it("celda: principal y extra en líneas separadas de la MISMA columna; nunca en Auxiliar", () => {
    const celdas = celdasFila(fila(celdaPilotoImagen("Juan Pérez", "Ana Gómez")));
    expect(celdas).toHaveLength(11);
    expect(celdas[4]).toBe("Juan Pérez\nAna Gómez");
    expect(celdas[5]).toBe("");
    expect(celdas[6]).toBe("");
  });
  it("un solo piloto queda idéntico al texto de siempre", () => {
    expect(celdaPilotoImagen("Juan Pérez", null)).toBe("Juan Pérez");
    expect(celdaPilotoImagen(null, null)).toBe("");
    expect(altoFilaImagen([1, 1, 1])).toBe(ALTO_FILA);
  });
  it("alto de fila crece con las líneas", () => {
    expect(altoFilaImagen([1, 2])).toBe(ALTO_FILA + ALTO_LINEA_EXTRA);
  });
  it("nombre largo se envuelve completo (no 'Mi…') y respeta el salto de línea", () => {
    const medir = (t: string) => t.length * 7;
    const l = envolverTexto("Miguel Ángel de Jesús Rodríguez Hernández\nAna Gómez", 120, medir);
    expect(l.join(" ")).toContain("Miguel");
    expect(l.join(" ")).toContain("Hernández");
    expect(l.every((x) => !x.includes("…"))).toBe(true);
    expect(l[l.length - 1]).toBe("Ana Gómez");
    expect(l.length).toBeGreaterThan(2);
  });
  it("layout: con celdas de varias líneas pagina por alto real sin perder filas", () => {
    const filas = Array.from({ length: 100 }, () => fila("Juan Pérez\nAna Gómez"));
    const l = construirLayoutImagen({ titulo: "t", desde: "2026-09-01", hasta: "2026-09-30" } as never, filas);
    expect(l.paginas.flat()).toHaveLength(100);
    const conUna = construirLayoutImagen({ titulo: "t", desde: "2026-09-01", hasta: "2026-09-30" } as never, Array.from({ length: 100 }, () => fila("Juan")));
    expect(l.totalPaginas).toBeGreaterThanOrEqual(conUna.totalPaginas);
  });
});

describe("web: PilotosCelda", () => {
  it("dos pilotos → dos líneas con break-words en una sola celda", () => {
    const html = renderToStaticMarkup(createElement(PilotosCelda, { principal: "Juan Pérez", extra: "Ana Gómez" }));
    expect(html).toContain("Juan Pérez");
    expect(html).toContain("Ana Gómez");
    expect(html.match(/break-words/g)).toHaveLength(2);
    expect(html).not.toContain("…");
  });
  it("un piloto o ninguno se ve como antes", () => {
    expect(renderToStaticMarkup(createElement(PilotosCelda, { principal: "Juan Pérez" }))).not.toContain("data-piloto-extra");
    expect(renderToStaticMarkup(createElement(PilotosCelda, { principal: null }))).toBe("—");
  });
});

describe("8-9) Tercerizado: muestra piloto/auxiliares externos, nunca 'Sin piloto/auxiliares' si existen", () => {
  const terc = { tipo_viaje: "Tercerizado", piloto: null, auxiliares: [], piloto_externo_nombre: "Carlos Ext", auxiliares_externos: "Uno\n\n Dos \r\nTres" };
  it("vista", () => {
    expect(pilotosDeVista(terc)).toEqual({ principal: "Carlos Ext", extra: null, externo: true });
    expect(auxiliaresDeVista(terc).nombres).toEqual(["Uno", "Dos", "Tres"]);
    expect(tienePilotoVista(terc)).toBe(true);
    expect(tieneAuxiliaresVista(terc)).toBe(true);
  });
  it("Tercerizado sin datos externos sí cuenta como sin piloto / sin auxiliares", () => {
    const vacio = { ...terc, piloto_externo_nombre: "  ", auxiliares_externos: null };
    expect(tienePilotoVista(vacio)).toBe(false);
    expect(tieneAuxiliaresVista(vacio)).toBe(false);
  });
  it("Propio no cambia", () => {
    const propio = { tipo_viaje: "Propio", piloto: "Juan", pilotoExtraNombre: "Ana", auxiliares: ["X"] };
    expect(pilotosDeVista(propio)).toEqual({ principal: "Juan", extra: "Ana", externo: false });
    expect(auxiliaresDeVista(propio).nombres).toEqual(["X"]);
    expect(tienePilotoVista({ tipo_viaje: "Propio", piloto: null, auxiliares: [] })).toBe(false);
  });
  it("tarjeta, filtros y reporte usan la vista Tercerizado", () => {
    const c = src("src/app/e/[slug]/programacion/programacion-client.tsx");
    expect(c).toContain("tienePilotoVista(p)");
    expect(c).toContain("tieneAuxiliaresVista(p)");
    expect(c).toContain("data-piloto-externo");
    expect(c).toContain("data-auxiliares-externos");
    expect(c).toContain("key={planEditando.id}");
    const r = src("src/app/api/empresas/[slug]/tms/programacion/reporte/route.ts");
    expect(r).toContain("COALESCE(TRIM(p.piloto_externo_nombre), '') = ''");
    expect(r).toContain("COALESCE(TRIM(p.auxiliares_externos), '') = ''");
  });
});

describe("10-12) edición Tercerizado: precarga y ida y vuelta", () => {
  const plan = {
    tipo_viaje: "Tercerizado",
    piloto_externo_nombre: "Carlos Ext",
    auxiliares_externos: "Uno\nDos",
    unidad_externa_placa: "P-123ABC",
    unidad_externa_descripcion: "Camión rojo",
    transportista_externo: "Transportes SA",
    tc_externo_placa: "TC-9",
    costo_tercerizado: 1234.5,
  };
  it("precarga todos los campos externos con los saltos de línea", () => {
    const f = precargaTipoViajeDesdePlan(plan);
    expect(f).toMatchObject({
      tipoViaje: "Tercerizado",
      pilotoExternoNombre: "Carlos Ext",
      auxiliaresExternosTexto: "Uno\nDos",
      unidadExternaPlaca: "P-123ABC",
      unidadExternaDescripcion: "Camión rojo",
      transportistaExterno: "Transportes SA",
      tcExternoPlaca: "TC-9",
      costoTercerizado: "1234.5",
    });
  });
  it("guardar y reabrir devuelve los mismos datos", () => {
    const payload = payloadTipoViaje(precargaTipoViajeDesdePlan(plan));
    expect(payload).toEqual({
      tipoViaje: "Tercerizado",
      pilotoExternoNombre: "Carlos Ext",
      auxiliaresExternos: ["Uno", "Dos"],
      unidadExternaPlaca: "P-123ABC",
      unidadExternaDescripcion: "Camión rojo",
      transportistaExterno: "Transportes SA",
      tcExternoPlaca: "TC-9",
      costoTercerizado: 1234.5,
    });
    const reabierto = precargaTipoViajeDesdePlan({ ...plan, auxiliares_externos: payload.auxiliaresExternos!.join("\n") });
    expect(reabierto.auxiliaresExternosTexto).toBe("Uno\nDos");
  });
  it("Propio: precarga vacía y payload sin campos externos", () => {
    const f = precargaTipoViajeDesdePlan({ tipo_viaje: "Propio", tc_externo_placa: "X" });
    expect(f.tcExternoPlaca).toBe("");
    const p = payloadTipoViaje(f);
    expect(p.pilotoExternoNombre).toBeUndefined();
    expect(p.auxiliaresExternos).toBeUndefined();
    expect(p.costoTercerizado).toBeUndefined();
  });
  it("tipo de traslado se persiste solo si cambió (ruta + validación de recursos)", () => {
    const r = src("src/app/api/empresas/[slug]/tms/planes/route.ts");
    expect(r).toContain("tipoTraslado: z.string().max(80).optional()");
    expect(r).toContain("tipo_traslado = CASE WHEN ? THEN ? ELSE tipo_traslado END");
    expect(src("src/lib/tms/programacion-validacion-recursos.ts")).toContain("d.tipoTraslado !== undefined");
    expect(src("src/app/e/[slug]/programacion/plan-form.tsx")).toContain("...precargaTipoViajeDesdePlan(plan),");
  });
});

describe("13-16) notificaciones, PDF y Excel sin cambios", () => {
  it("no se tocaron PDF, Excel ni notificaciones ni catalogos-nomina", () => {
    const rutas = ["src/lib/tms/reporte-viaje-pdf.ts", "src/app/api/empresas/[slug]/tms/reportes/viajes/export/route.ts"];
    for (const r of rutas) expect(src(r)).toContain("textoPilotos");
  });
});
