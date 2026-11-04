import { NextResponse } from "next/server";
import { requireTenantCxp } from "@/lib/tenant";
import { ambitoDesdeRequest, errorAmbito } from "@/lib/contabilidad/ambito";
import { ErrorCxp } from "./errores";
import { listarAntiguedadCxp, listarAntiguedadCxpParaExportar } from "./antiguedad";
import { antiguedadCxpAExcel } from "./antiguedad-excel";
import { filtrosAntiguedadCxpDesdeParams } from "./antiguedad-shared";

const NO_STORE = { "Cache-Control": "private, no-store" };
const MSG_SIN_PERMISO = "Sin permiso para ver facturas de proveedores.";

/** Fallo → respuesta JSON segura (sin SQL). Mismo contrato que el resto de CxP: 503 MIGRACION_PENDIENTE, 400 de ámbito, 500 genérico. */
function responderError(e: unknown) {
  if (e instanceof ErrorCxp) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status });
  const ambito = errorAmbito(e);
  if (ambito) return ambito;
  const code = (e as { code?: string })?.code;
  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") {
    return NextResponse.json({ error: "Esquema de Cuentas por pagar pendiente. Aplica las migraciones CxP (M-3A y M-3B1) antes de usar el módulo.", codigo: "MIGRACION_PENDIENTE" }, { status: 503 });
  }
  console.error("[cxp-antiguedad]", { code: code ?? "desconocido" });
  return NextResponse.json({ error: "No se pudo generar el reporte. Intenta nuevamente." }, { status: 500 });
}

/**
 * MIL-CXP-01 — Antigüedad de saldos de proveedores. SOLO LECTURA. Permiso `cxp_facturas`:ver (el mismo de las facturas); empresa de la sesión,
 * entidad = `?entidad=` único y válido. La autorización va ANTES de validar filtros; un filtro inválido responde 400 y no consulta.
 */
export async function antiguedadCxpHttp(req: Request, slug: string) {
  const g = await requireTenantCxp(slug, "cxp_facturas", "ver", MSG_SIN_PERMISO);
  if (g.error) return g.error;
  try {
    const { entidadId } = ambitoDesdeRequest(req, g.session);
    const parsed = filtrosAntiguedadCxpDesdeParams(new URL(req.url).searchParams);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, codigo: "FILTRO_INVALIDO" }, { status: 400 });
    return NextResponse.json(await listarAntiguedadCxp(g.empresa.id, entidadId, parsed.filtros), { headers: NO_STORE });
  } catch (e) { return responderError(e); }
}

/** Excel del conjunto FILTRADO exacto. `corte` (opcional) conserva la fecha de la pantalla: solo hoy/ayer (Guatemala); NO es un saldo histórico. */
export async function exportarAntiguedadCxpHttp(req: Request, slug: string) {
  const g = await requireTenantCxp(slug, "cxp_facturas", "ver", MSG_SIN_PERMISO);
  if (g.error) return g.error;
  try {
    const { entidadId } = ambitoDesdeRequest(req, g.session);
    const parsed = filtrosAntiguedadCxpDesdeParams(new URL(req.url).searchParams, { permitirCorte: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, codigo: "FILTRO_INVALIDO" }, { status: 400 });
    const r = await listarAntiguedadCxpParaExportar(g.empresa.id, entidadId, parsed.filtros, parsed.corte);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    const buffer = await antiguedadCxpAExcel(r.filas, r.totalesPorTramo, r.totalesPorSituacion, r.saldoTotal, r.fechaCorte);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="cuentas-por-pagar-antiguedad-${r.fechaCorte}.xlsx"`,
        ...NO_STORE,
      },
    });
  } catch (e) { return responderError(e); }
}
