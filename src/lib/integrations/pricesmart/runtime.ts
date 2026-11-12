// PRICESMART API-11 — punto de entrada de las rutas HTTP. Cerrado por defecto: sin una composición instalada, TODA solicitud recibe 503 DISABLED.
// No lee variables de entorno, no abre conexiones y no contiene ningún verificador criptográfico (D02 PENDIENTE). Una composición administrativa
// (pool sandbox verificado + EvidencePort/EvidenceVerifier ratificados + puertos de seguridad) la instala con `installPriceSmartHandler`.
export type PriceSmartHandler = (request: Request) => Promise<Response>;
let installed: PriceSmartHandler | null = null;

export function installPriceSmartHandler(handler: PriceSmartHandler | null): void {
  if (handler !== null && typeof handler !== 'function') throw new TypeError('handler inválido');
  installed = handler;
}
function disabled(): Response {
  const correlationId = crypto.randomUUID();
  return new Response(JSON.stringify({ code: 'DISABLED', correlationId }), { status: 503, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Correlation-Id': correlationId } });
}
export async function handlePriceSmart(request: Request): Promise<Response> {
  const handler = installed;
  if (!handler) return disabled();
  try { return await handler(request); } catch { return disabled(); }
}
