import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RutaSelect } from "@/components/tms/ruta-select";

const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
/** Solo sentencias: sin comentarios `--`. */
const sinComentarios = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const DEFINICIONES = [
  "documento_emisor VARCHAR(20) NOT NULL DEFAULT 'KUIQTRANS'",
  "atencion_nombre VARCHAR(160) NULL",
  "atencion_cargo VARCHAR(160) NULL",
  "unidad_descripcion VARCHAR(160) NULL",
];

describe("COTIZACIONES FASE 6 — migración y preflight", () => {
  const migracion = leer("sql/migrate-2026-09-cotizaciones-documento-comercial.sql");
  const preflight = leer("sql/preflight-2026-09-cotizaciones-documento-comercial.sql");

  it("la migración es aditiva e idempotente: solo ALTER TABLE tms_cotizaciones ... ADD COLUMN IF NOT EXISTS", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(sentencias).toMatch(/ALTER TABLE tms_cotizaciones\b/);
    expect(sentencias.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(4);
    for (const definicion of DEFINICIONES) expect(sentencias).toContain(`ADD COLUMN IF NOT EXISTS ${definicion}`);
    expect(sentencias.trim().endsWith(";")).toBe(true);
    expect(sentencias.match(/;/g)).toHaveLength(1);
  });

  it("no destruye ni reescribe nada: sin DROP/UPDATE/INSERT/DELETE/TRUNCATE/MODIFY/CHANGE/RENAME ni cambios de PK/FK/índices", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias).not.toMatch(/\b(DROP|UPDATE|INSERT|DELETE|TRUNCATE|MODIFY|CHANGE|RENAME|CREATE|GRANT)\b/i);
    expect(sentencias).not.toMatch(/PRIMARY KEY|FOREIGN KEY|CONSTRAINT|\bINDEX\b|\bKEY\b/i);
  });

  it("documento_emisor es VARCHAR con DEFAULT 'KUIQTRANS' (no ENUM): las cotizaciones existentes quedan KUIQTRANS sin UPDATE", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias).not.toMatch(/ENUM/i);
    expect(sentencias).toContain("documento_emisor VARCHAR(20) NOT NULL DEFAULT 'KUIQTRANS'");
  });

  it("las columnas quedan juntas después de observaciones, en el mismo orden que sql/schema.sql", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias).toContain("AFTER observaciones");
    expect(sentencias.indexOf("documento_emisor")).toBeLessThan(sentencias.indexOf("atencion_nombre"));
    expect(sentencias.indexOf("atencion_nombre")).toBeLessThan(sentencias.indexOf("atencion_cargo"));
    expect(sentencias.indexOf("atencion_cargo")).toBeLessThan(sentencias.indexOf("unidad_descripcion"));
  });

  it("el preflight usa SHOW COLUMNS por columna + SHOW CREATE TABLE, sin metadatos del sistema ni escritura", () => {
    const sentencias = sinComentarios(preflight);
    for (const columna of ["documento_emisor", "atencion_nombre", "atencion_cargo", "unidad_descripcion"]) {
      expect(sentencias).toContain(`SHOW COLUMNS FROM tms_cotizaciones\nLIKE '${columna}';`);
    }
    expect(sentencias).toContain("SHOW CREATE TABLE tms_cotizaciones;");
    expect(preflight).not.toMatch(/information_schema/i);
    expect(sentencias).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/i);
    expect(sentencias).not.toMatch(/^\s*CREATE TABLE/im); // SHOW CREATE TABLE sí; un CREATE TABLE real no
    expect(sentencias.match(/SHOW COLUMNS/g)).toHaveLength(4);
  });

  it("el preflight documenta APLICAR / NOOP / DETENER y la definición esperada de cada columna", () => {
    for (const palabra of ["APLICAR", "NOOP", "DETENER"]) expect(preflight).toContain(palabra);
    expect(preflight).toMatch(/documento_emisor\s+varchar\(20\)\s+NO\s+KUIQTRANS/);
    expect(preflight).toMatch(/atencion_nombre\s+varchar\(160\)\s+YES\s+NULL/);
    expect(preflight).toMatch(/atencion_cargo\s+varchar\(160\)\s+YES\s+NULL/);
    expect(preflight).toMatch(/unidad_descripcion\s+varchar\(160\)\s+YES\s+NULL/);
  });

  it("sql/schema.sql (instalaciones nuevas) declara las mismas cuatro columnas en tms_cotizaciones", () => {
    const schema = leer("sql/schema.sql");
    const inicio = schema.indexOf("CREATE TABLE IF NOT EXISTS tms_cotizaciones (");
    const tabla = schema.slice(inicio, schema.indexOf(") ENGINE=InnoDB", inicio));
    for (const definicion of DEFINICIONES) expect(tabla).toContain(definicion);
    expect(tabla.indexOf("observaciones TEXT NULL")).toBeLessThan(tabla.indexOf("documento_emisor"));
    expect(tabla.indexOf("unidad_descripcion")).toBeLessThan(tabla.indexOf("creado_por"));
  });

  it("el código lee y escribe exactamente esas columnas (SELECT, INSERT y UPDATE)", () => {
    const fuente = leer("src/lib/tms/cotizaciones.ts");
    const select = fuente.slice(fuente.indexOf("const SELECT = `"), fuente.indexOf("export type FiltrosCotizaciones"));
    expect(select).toContain("documento_emisor, atencion_nombre, atencion_cargo, unidad_descripcion");
    expect(fuente).toContain("documento_emisor, atencion_nombre, atencion_cargo, unidad_descripcion)");
    expect(fuente).toContain("documento_emisor = ?, atencion_nombre = ?, atencion_cargo = ?, unidad_descripcion = ?");
  });
});

describe("COTIZACIONES FASE 6 — formulario", () => {
  const page = leer("src/app/e/[slug]/cotizaciones/page.tsx");
  const pos = (texto: string) => {
    const i = page.indexOf(texto);
    expect(i, `no se encontró ${texto}`).toBeGreaterThan(-1);
    return i;
  };

  it("secciones A. Cliente y ruta / B. Presentación comercial / C. Condiciones de servicio / D. Costeo interno, en ese orden", () => {
    const orden = ["A. Cliente y ruta", "B. Presentación comercial", "C. Condiciones de servicio", "D. Costeo interno"].map(pos);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
    expect(page).not.toContain("B. Datos comerciales");
  });

  it("«Documento emitido por» es un selector visible con las dos marcas y KuiqTrans preseleccionado", () => {
    const b = page.slice(pos("B. Presentación comercial"), pos("C. Condiciones de servicio"));
    expect(b).toContain("Documento emitido por");
    expect(b).toContain("<select");
    expect(b).toContain("DOCUMENTOS_EMISOR.map");
    expect(b).toContain("MARCAS_DOCUMENTO[d].etiqueta");
    expect(page).toContain("documentoEmisor: DOCUMENTO_EMISOR_DEFAULT as DocumentoEmisor");
  });

  it("la sección B agrupa marca, atención, cargo, unidad, tarifa e IVA (opcionales donde corresponde)", () => {
    const b = page.slice(pos("B. Presentación comercial"), pos("C. Condiciones de servicio"));
    for (const etiqueta of ["Documento emitido por", "Atención a (opcional)", "Cargo / referencia (opcional)", "Unidad", "Tarifa cotizada (Q)", "La tarifa ya incluye IVA"]) {
      expect(b).toContain(etiqueta);
    }
    // Ya no quedan en la sección A.
    const a = page.slice(pos("A. Cliente y ruta"), pos("B. Presentación comercial"));
    expect(a).not.toContain("Tarifa cotizada (Q)");
    expect(a).not.toContain("La tarifa ya incluye IVA");
  });

  it("los campos nuevos viajan en el payload y se precargan al editar", () => {
    const guardar = page.slice(pos("async function guardar()"), pos("async function cambiarEstado"));
    for (const linea of [
      "documentoEmisor: form.documentoEmisor,", "atencionNombre: form.atencionNombre.trim() || null,",
      "atencionCargo: form.atencionCargo.trim() || null,", "unidadDescripcion: form.unidadDescripcion.trim() || null,",
    ]) expect(guardar).toContain(linea);
    const editar = page.slice(pos("function editar(c: Cotizacion)"), pos("function aplicarRuta"));
    for (const linea of ["documentoEmisor: c.documentoEmisor,", 'atencionNombre: c.atencionNombre ?? "",', 'atencionCargo: c.atencionCargo ?? "",', 'unidadDescripcion: c.unidadDescripcion ?? "",']) {
      expect(editar).toContain(linea);
    }
  });

  it("la marca NO se infiere de cliente, ruta ni costeo: solo el selector, el formulario vacío y editar la asignan", () => {
    const aplicarRuta = page.slice(pos("function aplicarRuta"), pos("async function guardar()"));
    expect(aplicarRuta).not.toContain("documentoEmisor");
    const cliente = page.slice(pos('label="Cliente de la cotización"'), pos("<RutaSelect"));
    expect(cliente).not.toContain("documentoEmisor");
    const costeo = page.slice(pos("<CotizacionCosteoPanel"), pos("Guardar</button>"));
    expect(costeo).not.toContain("documentoEmisor");
    expect(page.match(/documentoEmisor:/g)!.length).toBeLessThanOrEqual(6); // tipo, FORM_VACIO, editar, payload, selector, PATCH local
  });

  it("el perfil elegido solo SUGIERE la unidad, y solo si está vacía (editable)", () => {
    expect(page).toContain("onPerfilElegido={(nombre) => setForm((f) => (f.unidadDescripcion.trim() ? f : { ...f, unidadDescripcion: nombre }))}");
    const panel = leer("src/components/tms/cotizacion-costeo-panel.tsx");
    expect(panel).toContain("if (elegido) p.onPerfilElegido?.(elegido.nombre);");
  });

  it("botón «PDF comercial»: un enlace directo, sin pedir la marca al descargar", () => {
    const enlace = page.slice(pos("PDF comercial") - 200, pos("PDF comercial") + 20);
    expect(enlace).toContain("/tms/cotizaciones/${c.id}/pdf");
    expect(enlace).toContain("<a href=");
    expect(page).not.toContain("Descargar PDF");
  });

  it("el detalle de la lista muestra marca, atención y unidad guardadas", () => {
    expect(page).toContain("Documento emitido por:");
    expect(page).toContain("MARCAS_DOCUMENTO[c.documentoEmisor]");
    expect(page).toContain("Unidad:");
  });

  it("RutaSelect ya no queda dentro de un <label> (sin label anidado); ClienteSearch tampoco", () => {
    for (const bloque of page.match(/<label\b[\s\S]*?<\/label>/g) ?? []) {
      expect(bloque).not.toContain("<RutaSelect");
      expect(bloque).not.toContain("<ClienteSearch");
    }
    const ruta = page.match(/<RutaSelect[\s\S]*?\/>/)![0];
    expect(ruta).toContain('label="Ruta (opcional — sugiere tarifa/origen/destino)"');
    expect(ruta).toContain("descripcion=");
    expect(page).toContain("Usar sin guardar como ruta");
  });
});

describe("RutaSelect — label/descripcion opcionales sin romper a sus otros consumidores", () => {
  const props = { slug: "kt-monaco", clienteId: 0, value: "", inputClassName: "in", onSeleccionar: () => {} };

  it("sin props nuevas: mismo texto de siempre (Programación no cambia)", () => {
    const sinCliente = renderToStaticMarkup(createElement(RutaSelect, props));
    expect(sinCliente).toContain("Código / Ruta (busca por código, cliente o nombre)");
    expect(sinCliente).toContain("Al elegir una ruta se sugieren lugar de carga, hora y destinos — puedes ajustarlos para este viaje sin modificar la ruta maestra.");
    expect(renderToStaticMarkup(createElement(RutaSelect, { ...props, clienteId: 4 }))).toContain("Código / Ruta (rutas de este cliente)");
  });

  it("con label y descripcion los usa, y sigue habiendo un solo <label> asociado al input", () => {
    const html = renderToStaticMarkup(createElement(RutaSelect, { ...props, label: "Ruta (opcional)", descripcion: "Ayuda propia" }));
    expect(html).toContain(">Ruta (opcional)</label>");
    expect(html).toContain("Ayuda propia");
    expect(html).not.toContain("Código / Ruta");
    expect(html.match(/<label/g)).toHaveLength(1);
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>[^<]*<\/label><input id="\1"/);
  });
});
