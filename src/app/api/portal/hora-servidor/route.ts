import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { ahoraLocal } from "@/lib/rrhh/dates";

/**
 * PORTAL-HARDENING-2 (Fase D — geoestampado): el navegador del piloto
 * podría tener el reloj del dispositivo mal configurado (a propósito o
 * no). Antes de dibujar el sello de fecha/hora sobre la fotografía, el
 * Portal consulta este endpoint para calcular un offset dispositivo↔
 * servidor y usar la hora del SERVIDOR (autoritativa) en el sello, no
 * solo la del dispositivo. No elimina el riesgo por completo (la
 * respuesta viaja por la misma red que podría manipularse), pero reduce
 * el caso más común (reloj local desconfigurado); ver nota de riesgo en
 * el reporte de PORTAL-HARDENING-2. Requiere sesión de colaborador —
 * no es información sensible, pero tampoco se expone sin autenticar.
 */
export async function GET() {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  return NextResponse.json(
    { ahora: ahoraLocal(), epochMs: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
