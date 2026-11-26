"use client";
import { useRef } from "react";

/** Datos de una venta tal como los devuelve el historial de ventas (cadenas ya formateadas) + los de la empresa activa. */
export type DatosComprobante = {
  empresaNombre: string; logoUrl?: string | null; documento: string; fecha: string; cliente: string; direccion: string; producto: string;
  cantidad: string; precioUnitario: string; total: string; quienLleva: string; quienRecibe: string;
};

const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
/** Solo rutas del propio sitio o https: nunca esquemas como javascript:. */
const logoSeguro = (u?: string | null) => (u && /^(\/(?!\/)|https:\/\/)/.test(u) ? u : "");

/** Documento HTML autónomo, media carta (5.5 x 8.5 in) vertical, listo para imprimir. Todo dato se escapa. */
export function htmlComprobante(d: DatosComprobante): string {
  const logo = logoSeguro(d.logoUrl);
  const campo = (etiqueta: string, valor: string) => `<div class="campo"><span class="et">${esc(etiqueta)}</span><span class="va">${valor ? esc(valor) : "&nbsp;"}</span></div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante de Venta ${esc(d.documento)}</title><style>
@page { size: 5.5in 8.5in; margin: 0.35in; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; font: 11px/1.35 Arial, Helvetica, sans-serif; }
.hoja { width: 4.8in; min-height: 7.8in; margin: 0 auto; display: flex; flex-direction: column; }
.enc { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #111; padding-bottom: 8px; }
.enc img { max-height: 0.8in; max-width: 1.6in; object-fit: contain; }
.enc .emp { font-size: 15px; font-weight: 700; }
h1 { font-size: 16px; margin: 12px 0 2px; text-align: center; letter-spacing: .5px; }
.doc { text-align: center; font-size: 12px; margin-bottom: 10px; }
.campo { display: flex; gap: 6px; padding: 3px 0; border-bottom: 1px solid #bbb; }
.et { flex: 0 0 1.05in; font-weight: 700; }
.va { flex: 1; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { border: 1px solid #111; padding: 4px 6px; text-align: left; }
th { background: #eee; }
td.n, th.n { text-align: right; }
.totales { margin-top: 6px; margin-left: auto; width: 2.3in; }
.totales div { display: flex; justify-content: space-between; padding: 2px 0; }
.totales .tot { border-top: 2px solid #111; font-weight: 700; font-size: 13px; }
.personas { margin-top: 14px; }
.firmas { margin-top: auto; padding-top: 0.6in; display: flex; gap: 0.4in; }
.firma { flex: 1; text-align: center; }
.firma .linea { border-top: 1px solid #111; margin-bottom: 3px; }
@media print { html, body { width: 4.8in; height: 7.8in; overflow: hidden; } .hoja { height: 7.7in; min-height: 0; overflow: hidden; break-inside: avoid; } }
@media screen { body { background: #f3f3f3; } .hoja { background: #fff; padding: 0.35in; box-shadow: 0 0 6px rgba(0,0,0,.25); margin: 8px auto; } }
</style></head><body><div class="hoja">
<div class="enc">${logo ? `<img src="${esc(logo)}" alt="">` : ""}<div class="emp">${esc(d.empresaNombre)}</div></div>
<h1>Comprobante de Venta</h1><div class="doc">N.º de documento: <strong>${esc(d.documento)}</strong></div>
${campo("Fecha", d.fecha)}${campo("Cliente", d.cliente)}${campo("Dirección de entrega", d.direccion)}
<table><thead><tr><th>Descripción</th><th class="n">Cantidad</th><th class="n">Precio unitario</th><th class="n">Subtotal</th></tr></thead>
<tbody><tr><td>${esc(d.producto || "Caneca")}</td><td class="n">${esc(d.cantidad)}</td><td class="n">${esc(d.precioUnitario)}</td><td class="n">${esc(d.total)}</td></tr></tbody></table>
<div class="totales"><div><span>Subtotal</span><span>${esc(d.total)}</span></div><div class="tot"><span>Total</span><span>${esc(d.total)}</span></div></div>
<div class="personas">${campo("Quién lleva", d.quienLleva)}${campo("Quién recibe", d.quienRecibe)}</div>
<div class="firmas"><div class="firma"><div class="linea"></div>Firma de quien entrega</div><div class="firma"><div class="linea"></div>Firma de quien recibe</div></div>
</div></body></html>`;
}

/** Vista previa del comprobante (en un iframe aislado, con el mismo HTML que se imprime) con los botones Imprimir y Cerrar. */
export function ComprobanteVenta({ datos, onCerrar }: { datos: DatosComprobante; onCerrar: () => void }) {
  const marco = useRef<HTMLIFrameElement>(null);
  /** Espera a que el logo termine de cargar (o falle: imágenes bloqueadas) antes de imprimir; sin espera infinita. */
  async function imprimir() {
    const ventana = marco.current?.contentWindow;
    if (!ventana) return;
    const imagenes = Array.from(ventana.document?.images ?? []);
    await Promise.all(imagenes.map(img => img.complete ? null : new Promise<void>(listo => { img.addEventListener("load", () => listo(), { once: true }); img.addEventListener("error", () => listo(), { once: true }); setTimeout(listo, 4000); })));
    ventana.focus(); ventana.print();
  }
  return <div role="dialog" aria-modal="true" aria-label="Comprobante de venta" className="fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-auto bg-black/60 p-4">
    <div className="flex gap-3">
      <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-white" onClick={() => void imprimir()}>Imprimir</button>
      <button type="button" className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2" onClick={onCerrar}>Cerrar</button>
    </div>
    <iframe ref={marco} title="Vista previa del comprobante" srcDoc={htmlComprobante(datos)} className="h-[9.2in] w-[6in] max-w-full rounded bg-white" />
  </div>;
}
