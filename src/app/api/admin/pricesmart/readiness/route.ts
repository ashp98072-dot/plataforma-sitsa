import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-guard";
import { readinessDiagnostic } from "@/lib/integrations/pricesmart/readiness-diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * PRICESMART API-15 — diagnóstico administrativo de readiness. Solo Admin, solo lectura (no hay POST/PUT/DELETE). No instala handlers, no activa endpoints, no consulta datos
 * de ninguna empresa y no devuelve valores de configuración, claves ni tokens: solo presencia y estados.
 */
export async function GET() {
  const guard = await requireSession();
  if (guard.error) return guard.error;
  if (guard.user.rol !== "Admin") return NextResponse.json({ error: "Solo Admin puede consultar el diagnóstico." }, { status: 403, headers });
  return NextResponse.json(await readinessDiagnostic(), { headers });
}
