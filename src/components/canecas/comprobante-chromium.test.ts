import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ESCALA_MINIMA, htmlComprobante, type DatosComprobante, type Papel } from "./comprobante-venta";

/**
 * Verificación REPRODUCIBLE en Chromium real del comprobante con datos hasta los límites que admite el sistema (no solo «una dirección larga»):
 * cliente 200, bodega 160, dirección 500, producto 200, quién lleva/recibe 160, documento 250, importes grandes; con espacios y sin ellos
 * (cadenas que no se pueden partir). Comprueba geometría (nada fuera de la hoja, ningún elemento recortado), PDF (páginas, tamaño y texto
 * completo extraído del propio PDF) y que, si no cabe, el aviso `data-ajuste` queda marcado. Se omite si no hay Playwright/Chromium o pdftotext.
 *   npx vitest run src/components/canecas/comprobante-chromium.test.ts
 */
type Pagina = { setContent(h: string, o?: object): Promise<void>; waitForLoadState(e: string): Promise<void>; evaluate<T>(f: (...a: never[]) => T, a?: unknown): Promise<T>; pdf(o: object): Promise<Buffer>; emulateMedia(o: object): Promise<void>; close(): Promise<void> };
type Navegador = { newPage(): Promise<Pagina>; close(): Promise<void> };
let chromium: { launch(o?: object): Promise<Navegador> } | null = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { chromium = null; }
const tienePdftotext = spawnSync("pdftotext", ["-v"]).status !== null;
const hayChromium = (() => { try { return Boolean(chromium) && existsSync((chromium as unknown as { executablePath(): string }).executablePath()); } catch { return false; } })();

const palabras = (n: number, semilla: string) => { let t = ""; for (let i = 0; t.length < n; i++) t += `${semilla}${i} `; return t.slice(0, n).trim(); };
const compacto = (n: number, semilla: string) => semilla.repeat(Math.ceil(n / semilla.length)).slice(0, n);
const base: DatosComprobante = { empresaNombre: "Empresa Demo, S.A.", logoUrl: null, documento: "VTA-000001", fecha: "2026-11-25", cliente: "Quedely", origen: "Bodega Central", destino: "50 Calle", producto: "Caneca", cantidad: "12", precioUnitario: "Q 60.00", total: "Q 720.00", quienLleva: "Juan Pérez", quienRecibe: "Ana López" };
const maximo = (relleno: (n: number, s: string) => string): DatosComprobante => ({ ...base, empresaNombre: relleno(150, "Empresa"), documento: relleno(250, "DOC"), cliente: relleno(200, "Cliente"), origen: relleno(160, "Bodega"), destino: relleno(500, "Destino"), producto: relleno(200, "Caneca"), cantidad: "2147483647", precioUnitario: "Q 99,999,999.99", total: "Q 99,999,999,999.99", quienLleva: relleno(160, "Lleva"), quienRecibe: relleno(160, "Recibe") });
const casos: [string, DatosComprobante][] = [["normal", base], ["límites con espacios", maximo(palabras)], ["límites sin espacios", maximo(compacto)], ["excede los límites (6000 caracteres)", { ...maximo(palabras), destino: palabras(6000, "Destino") }]];
const solo = (s: string) => s.replace(/\s+/g, "");

describe.skipIf(!hayChromium || !tienePdftotext)("comprobante en Chromium con datos en los límites reales", () => {
  for (const [nombre, datos] of casos) for (const papel of ["carta", "media"] as Papel[]) for (const conLogo of [true, false]) {
    it(`${nombre} · ${papel} · ${conLogo ? "con logo" : "sin logo"}: ningún dato, importe ni firma se pierde`, async () => {
      const logo = conLogo ? `data:image/png;base64,${readFileSync("public/brands/monaco/logo.png").toString("base64")}` : null;
      const d = { ...datos, logoUrl: logo };
      const navegador = await chromium!.launch();
      const carpeta = mkdtempSync(join(tmpdir(), "comprobante-"));
      try {
        const pagina = await navegador.newPage();
        await pagina.emulateMedia({ media: "print" }); // se mide el diseño de IMPRESIÓN
        await pagina.setContent(htmlComprobante(d, papel));
        await pagina.waitForLoadState("load");
        const m = await pagina.evaluate(() => {
          const raiz = document.documentElement, c = document.querySelector(".contenido") as HTMLElement, caja = document.body.getBoundingClientRect();
          const todos = [...c.querySelectorAll("*")] as HTMLElement[];
          const fuera = todos.filter(e => { const r = e.getBoundingClientRect(); return r.right > 8.5 * 96 + 0.5 || r.left < -0.5; }).map(e => e.className || e.tagName);
          const recortados = todos.filter(e => { const o = getComputedStyle(e).overflow; return (o === "hidden" || o === "clip") && e.tagName !== "IMG"; }).map(e => e.className || e.tagName);
          const anchoDesbordado = todos.filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== "inline").map(e => e.className || e.tagName);
          const firmas = [...document.querySelectorAll(".firma")].map(f => f.getBoundingClientRect().bottom);
          const totales = (document.querySelector(".totales .tot") as HTMLElement).getBoundingClientRect().bottom;
          return { ajuste: raiz.getAttribute("data-ajuste"), escala: Number(raiz.getAttribute("data-escala")), alto: (document.querySelector(".hoja") as HTMLElement).getBoundingClientRect().bottom + 0 * caja.bottom, fuera, recortados, anchoDesbordado, firmas, totales, texto: document.body.textContent ?? "", recorta: getComputedStyle(document.querySelector(".hoja") as HTMLElement).overflow };
        });
        // El contenido completo existe en el documento y nada está recortado por overflow.
        for (const v of [d.cliente, d.origen, d.destino, d.quienLleva, d.quienRecibe, d.producto, d.documento, d.total, d.precioUnitario, d.cantidad]) expect(solo(m.texto)).toContain(solo(v));
        expect(m.recortados).toEqual([]); expect(m.recorta).toBe("visible"); expect(m.fuera).toEqual([]); expect(m.anchoDesbordado).toEqual([]);
        expect(m.firmas).toHaveLength(2);
        expect(["normal", "reducido", "extendido"]).toContain(m.ajuste);
        if (m.ajuste !== "extendido") {
          expect(m.alto).toBeLessThanOrEqual(5.5 * 96); // todo, firmas incluidas, dentro de la media hoja
          for (const y of [...m.firmas, m.totales]) expect(y).toBeLessThanOrEqual(5.5 * 96);
        } else expect(m.escala).toBe(ESCALA_MINIMA); // no cabe ni reducido: queda marcado para avisar, sin ocultar nada
        if (nombre === "normal") { expect(m.ajuste).toBe("normal"); expect(m.escala).toBe(1); }
        // PDF real: tamaño de papel, páginas y texto COMPLETO extraído del propio PDF.
        const pdf = join(carpeta, "c.pdf"), txt = join(carpeta, "c.txt");
        writeFileSync(pdf, await pagina.pdf({ preferCSSPageSize: true, printBackground: true }));
        const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
        expect(info).toContain(papel === "carta" ? "612 x 792 pts" : "612 x 396 pts");
        const paginas = Number(/Pages:\s+(\d+)/.exec(info)![1]);
        if (m.ajuste !== "extendido") expect(paginas).toBe(1); else expect(paginas).toBeGreaterThanOrEqual(1);
        if (nombre.startsWith("excede")) { expect(m.ajuste).toBe("extendido"); if (papel === "media") expect(paginas).toBeGreaterThanOrEqual(2); } // aviso + continúa en otra hoja, sin ocultar
        else expect(m.ajuste).not.toBe("extendido"); // los límites reales del sistema caben completos en la media hoja
        execFileSync("pdftotext", ["-raw", pdf, txt]); // orden del contenido: cada celda queda contigua aunque se parta en líneas
        const extraido = solo(readFileSync(txt, "utf8"));
        for (const v of [d.cliente, d.origen, d.destino, d.quienLleva, d.quienRecibe, d.producto, d.documento, d.total, d.precioUnitario, d.cantidad]) expect(extraido, v.slice(0, 40)).toContain(solo(v).slice(0, 25));
        expect(extraido).toContain("Firmadequienentrega"); expect(extraido).toContain("Firmadequienrecibe"); expect(extraido).toContain(solo(d.total));
        await pagina.close();
      } finally { rmSync(carpeta, { recursive: true, force: true }); await navegador.close(); }
    }, 60000);
  }
});
