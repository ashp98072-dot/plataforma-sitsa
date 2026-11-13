// PRICESMART API-11/12 — punto de entrada de las rutas HTTP. Cerrado por defecto: sin una composición instalada, TODA solicitud recibe 503 DISABLED.
// Este archivo no lee variables de entorno, no abre conexiones y no contiene ningún verificador criptográfico (D02 PENDIENTE). Una composición administrativa (pool sandbox
// verificado + EvidencePort/EvidenceVerifier ratificados + puertos de seguridad) la instala con `installPriceSmartHandler`. Solo en un laboratorio local aislado, la bandera
// explícita PRICESMART_LAB_DEMO activa `lab-demo/autoinstall.ts` (ver ahí las condiciones).
import { autoInstallLabDemo } from './lab-demo/autoinstall';
import { installPriceSmartHandler, isPriceSmartHandlerInstalled, state, type PriceSmartHandler } from './runtime-state';
export { installPriceSmartHandler, isPriceSmartHandlerInstalled };
export type { PriceSmartHandler };

function disabled(): Response {
  const correlationId = crypto.randomUUID();
  return new Response(JSON.stringify({ code: 'DISABLED', correlationId }), { status: 503, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Correlation-Id': correlationId } });
}
export async function handlePriceSmart(request: Request): Promise<Response> {
  if (!state.handler) {
    // Una sola instalación, compartida por solicitudes simultáneas (si no, la segunda vería «sin manejador» y recibiría 503 durante el arranque).
    state.lab ??= autoInstallLabDemo().catch(() => false);
    await state.lab;
  }
  const handler = state.handler;
  if (!handler) return disabled();
  try { return await handler(request); } catch { return disabled(); }
}
