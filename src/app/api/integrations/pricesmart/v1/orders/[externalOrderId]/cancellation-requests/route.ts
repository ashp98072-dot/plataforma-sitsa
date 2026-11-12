import { handlePriceSmart } from "@/lib/integrations/pricesmart/runtime";

// PRICESMART API-11 — candidato POST /orders/{externalOrderId}/cancellation-requests (método y ruta definitivos: D09 PENDIENTE).
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handlePriceSmart(request);
export const GET = (request: Request) => handlePriceSmart(request);
