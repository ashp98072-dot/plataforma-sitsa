import { handlePriceSmart } from "@/lib/integrations/pricesmart/runtime";

// PRICESMART API-11 — candidato POST /orders (D01/D09/D12 pendientes). Autenticación y todo el contrato viven en el transporte aislado; esta ruta solo delega.
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handlePriceSmart(request);
export const GET = (request: Request) => handlePriceSmart(request);
