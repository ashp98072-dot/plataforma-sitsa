import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  agruparDuplicadosFactura, claveFacturaProveedor, indicesFacturasRepetidas, mensajeFacturaDuplicadaServidor, mensajeFacturaExistente,
  MSG_FACTURA_DUPLICADA_INTERNA, MSG_FACTURAS_REPETIDAS, normalizarFacturaCompra, type FacturaExistente,
} from "./factura-compra";
import {
  bloqueaGuardarPorFactura, claveConsultaFactura, consultarFactura, DEBOUNCE_FACTURA_MS, debeConsultarFactura, estadoDeConsulta, urlVerificarFactura, urlVerRequerimiento,
} from "./factura-duplicada-ui";

/** Facturas duplicadas: normalización, formulario (lógica pura + guardas del código) y paridad con el preflight SQL. */
const L = (proveedor_id: number, serie: string | null, numero: string | null) => ({ proveedor_id, serie_factura: serie, numero_factura: numero });
const src = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const form = src("src/components/compras/requerimiento-form-client.tsx");
const estadoLinea = src("src/components/compras/factura-estado-linea.tsx");
const preflight = src("sql/preflight-2026-09-compras-facturas-unicas.sql");

describe("NORMALIZACIÓN", () => {
  it("1) recorta la serie", () => expect(normalizarFacturaCompra(" A-123 ", "1")!.serie).toBe("A-123"));
  it("2) recorta el número", () => expect(normalizarFacturaCompra("A", "  45872 ")!.numero).toBe("45872"));
  it("3) la serie no distingue mayúsculas (y colapsa espacios internos)", () => {
    expect(normalizarFacturaCompra("fac01", "1")!.clave).toBe(normalizarFacturaCompra("FAC01", "1")!.clave);
    expect(normalizarFacturaCompra(" A-123 ", "9")!.clave).toBe(normalizarFacturaCompra("A-123", "9")!.clave);
    expect(normalizarFacturaCompra("FAC  01", "9")!.clave).toBe(normalizarFacturaCompra("FAC 01", "9")!.clave);
  });
  it("4) CONSERVA los ceros iniciales: '000458' ≠ '458'", () => {
    expect(normalizarFacturaCompra("", " 000458 ")!.numero).toBe("000458");
    expect(normalizarFacturaCompra("", "000458")!.clave).not.toBe(normalizarFacturaCompra("", "458")!.clave);
  });
  it("5) serie vacía o null es una serie vacía válida", () => {
    for (const s of [null, undefined, "", "   "]) expect(normalizarFacturaCompra(s, "123")).toEqual({ serie: "", numero: "123", clave: "\u0001123" });
  });
  it("sin número (vacío, null o solo espacios) no hay clave: no aplica el control", () => {
    for (const n of [null, undefined, "", "   "]) expect(normalizarFacturaCompra("A", n)).toBeNull();
  });
  it("guiones y puntos son significativos ('A-123' ≠ 'A123'); los acentos no distinguen (como la colación de la BD)", () => {
    expect(normalizarFacturaCompra("A-1", "1")!.clave).not.toBe(normalizarFacturaCompra("A1", "1")!.clave);
    expect(normalizarFacturaCompra("Ñ", "É1")!.clave).toBe(normalizarFacturaCompra("N", "E1")!.clave);
  });
  it("normalizar no altera el valor original (devuelve una clave nueva)", () => {
    const serie = " a-1 ";
    normalizarFacturaCompra(serie, " 9 ");
    expect(serie).toBe(" a-1 ");
  });
  it("identidad = PROVEEDOR + serie + número (nunca solo el número)", () => {
    expect(claveFacturaProveedor(L(1, "A", "100"))).not.toBe(claveFacturaProveedor(L(2, "A", "100")));
    expect(claveFacturaProveedor(L(1, "A", "100"))).toBe(claveFacturaProveedor(L(1, " a ", " 100 ")));
    expect(claveFacturaProveedor(L(0, "A", "100"))).toBeNull(); // sin proveedor no hay control
    expect(claveFacturaProveedor(L(1, "A", null))).toBeNull();
  });
});

describe("FORMULARIO — duplicados dentro del requerimiento", () => {
  it("6) dos líneas con mismo proveedor + serie + número → ambas marcadas", () => {
    expect([...indicesFacturasRepetidas([L(1, "A", "100"), L(1, " a", "100 "), L(1, "B", "5")])].sort()).toEqual([0, 1]);
  });
  it("7) distinto proveedor → permitido (mismo número/serie)", () => expect(indicesFacturasRepetidas([L(1, "A", "100"), L(2, "A", "100")]).size).toBe(0));
  it("8) distinta serie → permitido", () => expect(indicesFacturasRepetidas([L(1, "A", "100"), L(1, "B", "100")]).size).toBe(0));
  it("9) distinto número → permitido", () => expect(indicesFacturasRepetidas([L(1, "A", "100"), L(1, "A", "101")]).size).toBe(0));
  it("10) número vacío → sin control (aunque todo lo demás coincida)", () => {
    expect(indicesFacturasRepetidas([L(1, "A", null), L(1, "A", null), L(1, "A", ""), L(1, "A", "  ")]).size).toBe(0);
  });
  it("11) corregir el número elimina el error", () => {
    const lineas = [L(1, "A", "100"), L(1, "A", "100")];
    expect(indicesFacturasRepetidas(lineas).size).toBe(2);
    lineas[1] = L(1, "A", "101");
    expect(indicesFacturasRepetidas(lineas).size).toBe(0);
  });
  it("tres líneas iguales marcan las tres; una repetida y una única solo marca las repetidas; sin proveedor no cuenta", () => {
    expect(indicesFacturasRepetidas([L(1, "", "7"), L(1, "", "7"), L(1, "", "7")]).size).toBe(3);
    expect([...indicesFacturasRepetidas([L(1, "", "7"), L(1, "", "8"), L(1, "", "7")])].sort()).toEqual([0, 2]);
    expect(indicesFacturasRepetidas([L(0, "", "7"), L(0, "", "7")]).size).toBe(0);
  });
  it("12) Guardar se deshabilita con duplicado interno (y con una factura ya registrada confirmada por la consulta)", () => {
    expect(bloqueaGuardarPorFactura(new Set([0, 1]), {})).toBe(true);
    expect(bloqueaGuardarPorFactura(new Set(), { a: { clave: "x", estado: "duplicada" } })).toBe(true);
    expect(bloqueaGuardarPorFactura(new Set(), { a: { clave: "x", estado: "disponible" }, b: { clave: "y", estado: "validando" }, c: { clave: "z", estado: "error" } })).toBe(false);
    expect(form).toContain("disabled={deshabilitado || !catalogos || bloqueoFactura}");
    expect(form).toContain("const bloqueoFactura = repetidas.size > 0 || Object.values(existentes).some(Boolean);");
    expect(form).toContain("if (repetidas.size) { setError(MSG_FACTURAS_REPETIDAS); return; }"); // ni siquiera envía
  });
  it("mensajes: por línea y general; se recalculan en cada render (proveedor, serie o número)", () => {
    expect(MSG_FACTURA_DUPLICADA_INTERNA).toBe("Factura duplicada dentro de este requerimiento.");
    expect(MSG_FACTURAS_REPETIDAS).toBe("Hay facturas repetidas dentro del requerimiento. Corrige las líneas marcadas.");
    expect(form).toContain("const repetidas = indicesFacturasRepetidas(lineas);");
    expect(form).toContain("interna={repetidas.has(indice)}");
    expect(form).toContain("{repetidas.size > 0 && <p role=\"alert\" className=\"text-red-300\">{MSG_FACTURAS_REPETIDAS}</p>}");
    expect(estadoLinea).toContain("{MSG_FACTURA_DUPLICADA_INTERNA}");
  });
});

describe("FORMULARIO — consulta a la BD (UX)", () => {
  it("solo consulta con proveedor seleccionado y número no vacío (la serie puede ir vacía)", () => {
    expect(debeConsultarFactura(L(1, "", "5"))).toBe(true);
    expect(debeConsultarFactura(L(0, "A", "5"))).toBe(false);
    expect(debeConsultarFactura(L(1, "A", ""))).toBe(false);
    expect(debeConsultarFactura(L(1, "A", "   "))).toBe(false);
  });
  it("debounce de 300–500 ms y resultados viejos descartados", () => {
    expect(DEBOUNCE_FACTURA_MS).toBeGreaterThanOrEqual(300);
    expect(DEBOUNCE_FACTURA_MS).toBeLessThanOrEqual(500);
    expect(estadoLinea).toContain("window.setTimeout");
    expect(estadoLinea).toContain("if (vigente.current !== clave) return;");
    expect(claveConsultaFactura({ ...L(1, "A", "5"), id: 3 })).not.toBe(claveConsultaFactura({ ...L(1, "A", "6"), id: 3 }));
  });
  it("la URL envía proveedor, serie, número y SOLO la propia línea al editar (lineaId); nada de empresa", () => {
    const u = new URL(`https://x${urlVerificarFactura("sitsa", { id: 10, proveedor_id: 3, serie_factura: "X", numero_factura: "123" })}`);
    expect(u.pathname).toBe("/api/empresas/sitsa/compras/requerimientos/facturas/verificar");
    expect(Object.fromEntries(u.searchParams)).toEqual({ proveedorId: "3", serie: "X", numero: "123", lineaId: "10" });
    expect(new URL(`https://x${urlVerificarFactura("s", L(3, null, "1"))}`).searchParams.has("lineaId")).toBe(false);
  });
  it("estados: validando / disponible / duplicada / error, con mensaje y enlace 'Ver requerimiento'", async () => {
    const existente: FacturaExistente = { requerimientoId: 42, requerimientoCodigo: "RC-2026-000042", lineaId: 193, proveedorNombre: "MULTISERVICIOS LOS TRES", serie: "A123", numero: "45872", fecha: "2026-09-21", estado: "Autorizada" };
    expect(mensajeFacturaExistente(existente)).toBe("Esta factura ya existe en RC-2026-000042 · Proveedor MULTISERVICIOS LOS TRES · Fecha 21/09/2026.");
    expect(urlVerRequerimiento("sitsa", 42)).toBe("/e/sitsa/compras/requerimientos/42");
    const ok = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body }));
    expect(estadoDeConsulta(await consultarFactura(ok({ existe: false }), "s", L(1, "", "1")))).toBe("disponible");
    const dup = await consultarFactura(ok({ existe: true, factura: existente }), "s", L(1, "", "1"));
    expect(estadoDeConsulta(dup)).toBe("duplicada");
    expect(estadoDeConsulta(await consultarFactura(vi.fn(async () => { throw new Error("red"); }), "s", L(1, "", "1")))).toBe("error");
    expect(estadoDeConsulta(await consultarFactura(vi.fn(async () => ({ ok: false, json: async () => ({}) })), "s", L(1, "", "1")))).toBe("error");
    for (const t of ["Validando factura…", "✓ Factura disponible", "Ver requerimiento", "⚠ {mensajeFacturaExistente"]) expect(estadoLinea).toContain(t);
  });
  it("mensaje del servidor exacto", () => {
    expect(mensajeFacturaDuplicadaServidor("A123", "45872", "RC-2026-000042", "MULTISERVICIOS LOS TRES")).toBe("La factura A123 / 45872 ya existe en el requerimiento RC-2026-000042 para el proveedor MULTISERVICIOS LOS TRES.");
    expect(mensajeFacturaDuplicadaServidor(null, "45872", "RC-1", "P")).toBe("La factura 45872 ya existe en el requerimiento RC-1 para el proveedor P.");
  });
  it("el componente de estado es aparte del formulario y no se muestra sin edición", () => {
    expect(form).toContain("{editable ? <FacturaEstadoLinea");
    expect(estadoLinea.startsWith('"use client";')).toBe(true);
  });
});

describe("PREFLIGHT — paridad con la regla del código", () => {
  const fila = (empresa_id: number, proveedor_id: number, serie: string | null, numero: string | null, linea = 1) => ({ empresa_id, proveedor_id, serie_factura: serie, numero_factura: numero, linea });
  it("31) detecta duplicados reales; 34) normaliza case/espacios con la misma regla que el código", () => {
    const g = agruparDuplicadosFactura([fila(1, 1, "A", "100", 1), fila(1, 1, " a ", " 100 ", 2), fila(1, 1, "A", "101", 3)]);
    expect(g).toHaveLength(1);
    expect(g[0].lineas.map((l) => l.linea)).toEqual([1, 2]);
  });
  it("32) ignora número vacío/null", () => expect(agruparDuplicadosFactura([fila(1, 1, "A", null), fila(1, 1, "A", null), fila(1, 1, "A", ""), fila(1, 1, "A", "  ")])).toEqual([]));
  it("33) separa proveedores y empresas", () => {
    expect(agruparDuplicadosFactura([fila(1, 1, "A", "100"), fila(1, 2, "A", "100"), fila(2, 1, "A", "100")])).toEqual([]);
  });
  it("el SQL del preflight es de SOLO LECTURA y aplica la misma normalización y exclusiones", () => {
    expect(preflight).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER)\b/im);
    expect(preflight).toContain("TRIM(REGEXP_REPLACE(l.numero_factura, '[[:space:]]+', ' '))");
    expect(preflight).toContain("TRIM(REGEXP_REPLACE(COALESCE(l.serie_factura, ''), '[[:space:]]+', ' '))");
    expect(preflight).toContain("l.numero_factura IS NOT NULL");
    expect(preflight).toContain("<> ''");
    expect(preflight).toContain("GROUP BY l.empresa_id, l.proveedor_id");
    expect(preflight).toContain("HAVING COUNT(*) > 1");
    for (const campo of ["empresa_id", "proveedor_id", "serie_normalizada", "numero_normalizado", "cantidad", "requerimientos_y_lineas"]) expect(preflight).toContain(campo);
    expect(preflight).toContain("NO importa"); // el estado del requerimiento no importa
  });
  it("la propuesta comentada del preflight coincide con la migración creada aparte", () => {
    expect(preflight).toContain("PROPUESTA (NO ejecutar");
    expect(preflight).toMatch(/--\s+ALTER TABLE compras_requerimiento_lineas/);
    expect(readFileSync("sql/migrate-2026-09-compras-facturas-unicas.sql", "utf8")).toContain("uq_compras_factura_proveedor"); // ya creada (sin ejecutar) en el PR de migración
  });
});
