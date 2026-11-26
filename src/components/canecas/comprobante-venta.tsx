"use client";
import { useRef, useState } from "react";

/** Datos de una venta tal como los devuelve el historial de ventas (cadenas ya formateadas) + los de la empresa activa. */
export type DatosComprobante = {
  empresaNombre: string; logoUrl?: string | null; documento: string; fecha: string; cliente: string; origen: string; destino: string; producto: string;
  cantidad: string; precioUnitario: string; total: string; quienLleva: string; quienRecibe: string;
};
/** `carta`: hoja carta 8.5 x 11 con el comprobante en la MITAD SUPERIOR (la inferior queda en blanco). `media`: papel media carta 8.5 x 5.5 (horizontal). */
export type Papel = "carta" | "media";

const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
/** Solo rutas del propio sitio, https o imágenes PNG/JPEG incrustadas: nunca esquemas como javascript:. */
const logoSeguro = (u?: string | null) => (u && /^(\/(?!\/)|https:\/\/|data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$)/.test(u) ? u : "");

/** Escala mínima a la que se reduce un comprobante extenso para que quepa completo en media hoja (por debajo, deja de reducir y se avisa). */
export const ESCALA_MINIMA = 0.6;
/** Alto máximo (in) que puede ocupar el comprobante en la media hoja: 5.5 in menos 0.1 in de holgura para no generar otra página. */
const ALTO_MAXIMO_IN = 5.4;

/**
 * Documento HTML autónomo de 8.5 x 5.5 in (media hoja carta, horizontal), listo para imprimir sin encabezados ni pies del navegador
 * (@page margin 0). NUNCA recorta información: no hay `overflow: hidden` ni alto fijo. Un script mide el contenido y, si no cabe en
 * 5.4 in, lo reduce (hasta ESCALA_MINIMA) para que quepa completo en la media hoja; si ni así cabe, no lo oculta: continúa hacia abajo
 * (en hoja carta, dentro de la misma página; en media carta, en una segunda hoja) y lo marca en `data-ajuste` para avisar al usuario.
 * `data-ajuste` = normal | reducido | extendido. Todo dato se escapa.
 */
export function htmlComprobante(d: DatosComprobante, papel: Papel = "carta"): string {
  const logo = logoSeguro(d.logoUrl);
  const pagina = papel === "media" ? "8.5in 5.5in" : "8.5in 11in";
  const campo = (etiqueta: string, valor: string) => `<div class="campo"><span class="et">${esc(etiqueta)}</span><span class="va">${valor ? esc(valor) : "&nbsp;"}</span></div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante de Venta ${esc(d.documento)}</title><style>
@page { size: ${pagina}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; font: 10.5px/1.3 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.hoja { width: 8.5in; padding: 0.25in 0.45in; }
.contenido { overflow-wrap: anywhere; }
.enc { text-align: center; height: 0.72in; display: flex; align-items: center; justify-content: center; }
.enc img { max-height: 0.72in; max-width: 3in; object-fit: contain; mix-blend-mode: multiply; }
.enc .emp { font-size: 16px; font-weight: 700; }
h1 { font-size: 15px; margin: 4px 0 0; text-align: center; letter-spacing: .6px; }
.doc { text-align: center; font-size: 11.5px; margin-bottom: 6px; }
.datos { display: grid; grid-template-columns: 1fr 1fr; column-gap: 0.3in; }
.campo { display: flex; gap: 6px; padding: 2px 0; border-bottom: 1px solid #999; }
.et { flex: 0 0 0.8in; font-weight: 700; }
.va { flex: 1; min-width: 0; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { border: 1px solid #111; padding: 3px 6px; text-align: left; }
th { background: #eee; }
td.n, th.n { text-align: right; white-space: nowrap; }
.totales { margin: 4px 0 0 auto; width: 2.4in; }
.totales div { display: flex; justify-content: space-between; padding: 1px 0; }
.totales .tot { border-top: 2px solid #111; font-weight: 700; font-size: 13px; }
.personas { margin-top: 4px; }
.firmas { margin-top: 0.4in; display: flex; gap: 0.5in; }
.firma { flex: 1; text-align: center; }
.firma .linea { border-top: 1px solid #111; margin-bottom: 2px; }
@media screen { body { background: #e5e5e5; } .hoja { background: #fff; box-shadow: 0 0 6px rgba(0,0,0,.3); } }
</style></head><body><div class="hoja"><div class="contenido">
<div class="enc">${logo ? `<img src="${esc(logo)}" alt="${esc(d.empresaNombre)}">` : `<div class="emp">${esc(d.empresaNombre)}</div>`}</div>
<h1>COMPROBANTE DE VENTA</h1><div class="doc">N.º de documento: <strong>${esc(d.documento)}</strong></div>
<div class="datos">${campo("Fecha", d.fecha)}${campo("Cliente", d.cliente)}${campo("Sale de", d.origen)}${campo("Va hacia", d.destino)}</div>
<table><thead><tr><th>Descripción</th><th class="n">Cantidad</th><th class="n">Precio unitario</th><th class="n">Subtotal</th></tr></thead>
<tbody><tr><td>${esc(d.producto || "Caneca")}</td><td class="n">${esc(d.cantidad)}</td><td class="n">${esc(d.precioUnitario)}</td><td class="n">${esc(d.total)}</td></tr></tbody></table>
<div class="totales"><div><span>Subtotal</span><span>${esc(d.total)}</span></div><div class="tot"><span>Total</span><span>${esc(d.total)}</span></div></div>
<div class="datos personas">${campo("Quién lleva", d.quienLleva)}${campo("Quién recibe", d.quienRecibe)}</div>
<div class="firmas"><div class="firma"><div class="linea"></div>Firma de quien entrega</div><div class="firma"><div class="linea"></div>Firma de quien recibe</div></div>
</div></div>
<script>(function () {
  var MIN = ${ESCALA_MINIMA}, DISPONIBLE = ${ALTO_MAXIMO_IN} * 96 - 48;
  var raiz = document.documentElement, c = document.querySelector('.contenido');
  function ajustar() {
    c.style.zoom = '1';
    var natural = c.getBoundingClientRect().height, s = natural > 0 ? DISPONIBLE / natural : 1;
    if (s >= 1) { c.style.zoom = '1'; raiz.setAttribute('data-ajuste', 'normal'); raiz.setAttribute('data-escala', '1'); return; }
    c.style.zoom = String(Math.max(s, MIN));
    raiz.setAttribute('data-ajuste', s >= MIN ? 'reducido' : 'extendido'); raiz.setAttribute('data-escala', String(Math.max(s, MIN)));
  }
  window.ajustarComprobante = ajustar; ajustar(); window.addEventListener('load', ajustar);
})();</script>
</body></html>`;
}

const LLAVE_PAPEL = "canecas:comprobante:papel";
function papelGuardado(): Papel { try { return window.localStorage.getItem(LLAVE_PAPEL) === "media" ? "media" : "carta"; } catch { return "carta"; } }

/** Vista previa del comprobante (iframe aislado con el mismo HTML que se imprime) con elección de papel y los botones Imprimir y Cerrar. */
export function ComprobanteVenta({ datos, onCerrar }: { datos: DatosComprobante; onCerrar: () => void }) {
  const marco = useRef<HTMLIFrameElement>(null);
  const [ajuste, setAjuste] = useState<{ estado: string; escala: number }>({ estado: "normal", escala: 1 });
  const leerAjuste = () => { const raiz = marco.current?.contentDocument?.documentElement; if (raiz) setAjuste({ estado: raiz.getAttribute("data-ajuste") ?? "normal", escala: Number(raiz.getAttribute("data-escala") ?? 1) }); };
  const [papel, setPapel] = useState<Papel>(papelGuardado);
  function elegir(p: Papel) { setPapel(p); try { window.localStorage.setItem(LLAVE_PAPEL, p); } catch { /* sin almacenamiento: solo en memoria */ } }
  /** Espera a que el logo termine de cargar (o falle: imágenes bloqueadas) antes de imprimir; sin espera infinita. */
  async function imprimir() {
    const ventana = marco.current?.contentWindow;
    if (!ventana) return;
    const imagenes = Array.from(ventana.document?.images ?? []);
    await Promise.all(imagenes.map(img => img.complete ? null : new Promise<void>(listo => { img.addEventListener("load", () => listo(), { once: true }); img.addEventListener("error", () => listo(), { once: true }); setTimeout(listo, 4000); })));
    (ventana as unknown as { ajustarComprobante?: () => void }).ajustarComprobante?.(); // el logo ya cargó: se vuelve a medir
    leerAjuste();
    ventana.focus(); ventana.print();
  }
  return <div role="dialog" aria-modal="true" aria-label="Comprobante de venta" className="fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-auto bg-black/60 p-4">
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--card)] px-4 py-2 text-sm">
      <fieldset className="flex flex-wrap gap-4"><legend className="sr-only">Papel</legend>
        <label className="flex items-center gap-1.5"><input type="radio" name="papel" checked={papel === "carta"} onChange={() => elegir("carta")} />Hoja carta (sale en la mitad superior)</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="papel" checked={papel === "media"} onChange={() => elegir("media")} />Papel media carta</label>
      </fieldset>
      <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-white" onClick={() => void imprimir()}>Imprimir</button>
      <button type="button" className="rounded-lg border border-[var(--border)] px-4 py-2" onClick={onCerrar}>Cerrar</button>
    </div>
    <p className="max-w-[8.5in] text-center text-xs text-white">En el cuadro de impresión desactive «Encabezados y pies de página» si su navegador los muestra, y deje la escala en 100 %.</p>
    {ajuste.estado === "reducido" && <p role="status" className="max-w-[8.5in] rounded bg-amber-100 px-3 py-1 text-center text-xs text-amber-900">Los datos son extensos: el comprobante se redujo al {Math.round(ajuste.escala * 100)} % para que quepa completo en la media hoja.</p>}
    {ajuste.estado === "extendido" && <p role="alert" className="max-w-[8.5in] rounded bg-red-100 px-3 py-1 text-center text-xs text-red-900">Los datos son demasiado extensos para una media hoja, incluso reducidos al {Math.round(ESCALA_MINIMA * 100)} %. No se recorta nada: en hoja carta el comprobante ocupará más de la mitad superior y en papel media carta se imprimirá en más de una hoja.</p>}
    <iframe ref={marco} onLoad={leerAjuste} title="Vista previa del comprobante" srcDoc={htmlComprobante(datos, papel)} className="h-[5.5in] min-h-[5.5in] w-[8.5in] max-w-none shrink-0 bg-white" />
  </div>;
}
