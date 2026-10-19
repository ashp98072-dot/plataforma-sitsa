import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cotizacionPdf } from "./cotizacion-pdf";
import { TRATAMIENTOS_DESTINATARIO, construirDocumentoComercial, esTratamientoDestinatario, lineaDestinatario } from "./cotizacion-documento";
import { COTIZACION_DOC } from "./cotizacion-documento.fixture";
import type { Cotizacion } from "./cotizaciones";

afterEach(() => vi.restoreAllMocks());

async function textosPdf(c: Cotizacion) {
  const espia = vi.spyOn(PDFDocument.prototype, "text");
  await cotizacionPdf(c);
  const textos = espia.mock.calls.map((l) => String(l[0]));
  espia.mockRestore();
  return textos;
}
const base = (documentoEmisor: "MONACO" | "KUIQTRANS", extra: Partial<Cotizacion>): Cotizacion => ({ ...COTIZACION_DOC, documentoEmisor, incluyeIva: false, ...extra });

const CASOS = [
  ["Sr.", "Juan Pérez"], ["Sra.", "Ana López"], ["Srta.", "María Gómez"], ["Sres.", "Transportes XYZ"],
] as const;

describe.each([["MONACO"], ["KUIQTRANS"]] as const)("PDF %s: tratamiento del destinatario", (marca) => {
  it.each(CASOS)("%s → «%s %s»: solo tratamiento + destinatario, sin «Atención:»", async (tratamiento, nombre) => {
    const textos = await textosPdf(base(marca, { atencionTratamiento: tratamiento, atencionNombre: nombre }));
    expect(textos).toContain(`${tratamiento} ${nombre}`);
    expect(textos.join("\n")).not.toMatch(/Atenci[oó]n/);
    expect(textos.some((t) => t.includes(`: ${tratamiento}`))).toBe(false);
  });

  it.each(CASOS)("%s: el resto del PDF no cambia (mismos textos salvo la línea del destinatario)", async (tratamiento, nombre) => {
    const referencia = await textosPdf(base(marca, { atencionTratamiento: null, atencionNombre: nombre }));
    const con = await textosPdf(base(marca, { atencionTratamiento: tratamiento, atencionNombre: nombre }));
    expect(referencia).toContain(nombre);
    expect(con.map((t) => (t === `${tratamiento} ${nombre}` ? nombre : t))).toEqual(referencia);
  });

  it("la línea queda debajo del cliente y antes del cargo (mismo lugar que antes)", async () => {
    const t = await textosPdf(base(marca, { atencionTratamiento: "Srta.", atencionNombre: "Marjoie Barahona" }));
    const i = t.indexOf(COTIZACION_DOC.clienteNombre), j = t.indexOf("Srta. Marjoie Barahona"), k = t.indexOf("Compras / Logística");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(j);
  });

  it("cotización anterior (sin tratamiento guardado): solo el nombre, sin «Atención:»; sin nombre no hay línea", async () => {
    const t = await textosPdf(base(marca, { atencionTratamiento: null, atencionNombre: "Claudia Cordero" }));
    expect(t).toContain("Claudia Cordero");
    expect(t.join("\n")).not.toMatch(/Atenci[oó]n/);
    const sin = await textosPdf(base(marca, { atencionTratamiento: "Sr.", atencionNombre: null }));
    expect(sin.some((x) => x.trim() === "Sr.")).toBe(false);
  });
});

describe("snapshot e integridad del tratamiento", () => {
  it("el documento toma el tratamiento GUARDADO en la cotización; un valor ajeno se descarta y nada se deduce del nombre", () => {
    expect(construirDocumentoComercial({ ...COTIZACION_DOC, atencionTratamiento: "Sra.", atencionNombre: "Carlos" }).atencionTratamiento).toBe("Sra.");
    expect(construirDocumentoComercial({ ...COTIZACION_DOC, atencionTratamiento: "Don", atencionNombre: "María" }).atencionTratamiento).toBeNull();
    expect(construirDocumentoComercial({ ...COTIZACION_DOC, atencionTratamiento: null, atencionNombre: "María" }).atencionTratamiento).toBeNull();
  });
  it("catálogo cerrado: Sr., Sres., Sra., Srta.", () => {
    expect(TRATAMIENTOS_DESTINATARIO.map((t) => t.valor)).toEqual(["Sr.", "Sres.", "Sra.", "Srta."]);
    expect(TRATAMIENTOS_DESTINATARIO.map((t) => t.etiqueta)).toEqual(["Señor — Sr.", "Señores — Sres.", "Señora — Sra.", "Señorita — Srta."]);
    expect(esTratamientoDestinatario("Sr")).toBe(false);
    expect(lineaDestinatario("Sr.", "  ")).toBeNull();
    expect(lineaDestinatario(undefined, "Ana")).toBe("Ana");
  });
  it("el servicio guarda/lee/duplica la columna y valida el valor; las rutas y la UI lo exponen", () => {
    const srv = readFileSync("src/lib/tms/cotizaciones.ts", "utf8");
    expect(srv).toContain("atencion_tratamiento");
    expect(srv).toContain("atencionTratamiento: original.atencionTratamiento"); // duplicar conserva el snapshot
    expect(srv).toContain("El tratamiento debe ser Sr., Sres., Sra. o Srta.");
    expect(srv).toMatch(/cambios\.atencionTratamiento !== undefined/); // editar otra cosa no lo pisa
    for (const r of ["src/app/api/empresas/[slug]/tms/cotizaciones/route.ts", "src/app/api/empresas/[slug]/tms/cotizaciones/[id]/route.ts"]) {
      expect(readFileSync(r, "utf8")).toContain('atencionTratamiento: z.enum(["Sr.", "Sres.", "Sra.", "Srta."])');
    }
    const ui = readFileSync("src/app/e/[slug]/cotizaciones/page.tsx", "utf8");
    expect(ui).toContain("Tratamiento (opcional)");
    expect(ui).toContain("atencionTratamiento: form.atencionTratamiento || null");
    expect(readFileSync("src/lib/tms/cotizacion-pdf-layout.ts", "utf8")).not.toMatch(/Atenci[oó]n:/);
  });
  it("el SQL es aditivo (una columna nullable) y no destructivo", () => {
    const sql = readFileSync("sql/migrate-2026-10-cotizaciones-tratamiento-destinatario.sql", "utf8").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS atencion_tratamiento VARCHAR\(10\) NULL AFTER atencion_nombre/);
    expect(sql).not.toMatch(/DROP|UPDATE|DELETE|TRUNCATE|INSERT/i);
    expect(readFileSync("sql/schema.sql", "utf8")).toContain("atencion_tratamiento VARCHAR(10) NULL");
  });
});
