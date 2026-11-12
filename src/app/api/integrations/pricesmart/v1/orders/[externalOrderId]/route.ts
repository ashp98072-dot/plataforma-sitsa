import { handlePriceSmart } from "@/lib/integrations/pricesmart/runtime";

// PRICESMART API-11 — candidato GET /orders/{externalOrderId}. El identificador se valida en el transporte.
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handlePriceSmart(request);
export const POST = (request: Request) => handlePriceSmart(request);
