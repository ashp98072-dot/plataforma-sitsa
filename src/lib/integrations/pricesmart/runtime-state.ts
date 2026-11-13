// PRICESMART API-11/15 — estado del handler, en un módulo PURO (sin importar la composición del laboratorio, base de datos ni TMS). runtime.ts y el diagnóstico administrativo lo comparten.
export type PriceSmartHandler = (request: Request) => Promise<Response>;
// Singleton en globalThis: los paquetes de Next (rutas, instrumentación, recarga en caliente) pueden evaluar este módulo más de una vez.
const KEY = Symbol.for('novalvion.pricesmart.handler');
const store = globalThis as unknown as Record<symbol, { handler: PriceSmartHandler | null; lab: Promise<boolean> | null } | undefined>;
export const state = (store[KEY] ??= { handler: null, lab: null });

export function installPriceSmartHandler(handler: PriceSmartHandler | null): void {
  if (handler !== null && typeof handler !== 'function') throw new TypeError('handler inválido');
  state.handler = handler;
}
/** Solo lectura: ¿hay un handler instalado? (lo usa el diagnóstico administrativo; no instala ni retira nada). */
export function isPriceSmartHandlerInstalled(): boolean { return state.handler !== null; }
