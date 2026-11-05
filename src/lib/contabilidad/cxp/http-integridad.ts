import { NextResponse } from "next/server";
import { requireTenantCxp } from "@/lib/tenant";
import { ambitoDesdeRequest, errorAmbito } from "@/lib/contabilidad/ambito";
import { ErrorCxp } from "./errores";
import { filtrosIntegridadDesdeParams } from "./integridad-shared";
import { exportarIntegridadCxp, obtenerIntegridadCxp } from "./integridad";

const headers = { "Cache-Control": "private, no-store" };
const privado = (r: Response) => {
  const h = new Headers(r.headers); h.set("Cache-Control", headers["Cache-Control"]);
  return new NextResponse(r.body, { status: r.status, statusText: r.statusText, headers: h });
};
async function consultarHttp(req: Request, slug: string, exportacion: boolean) {
  const g = await requireTenantCxp(slug, "cxp_facturas", "ver", "Sin permiso para ver facturas de proveedores.");
  if (g.error) return privado(g.error);
  try {
    const pagos = await requireTenantCxp(slug, "cxp_pagos", "ver", "Sin permiso para ver pagos de proveedores.");
    const { entidadId } = ambitoDesdeRequest(req, g.session);
    const parsed = filtrosIntegridadDesdeParams(new URL(req.url).searchParams, { exportacion });
    if (!parsed.ok) throw new ErrorCxp(parsed.error, 400, "FILTRO_INVALIDO");
    if (!exportacion) return NextResponse.json(await obtenerIntegridadCxp(g.empresa.id, entidadId, parsed.filtros, { verPagos: !pagos.error }), { headers });
    const datos = await exportarIntegridadCxp(g.empresa.id, entidadId, parsed.filtros, { verPagos: !pagos.error });
    const { integridadAExcel } = await import("./integridad-excel");
    const buffer = await integridadAExcel(datos);
    return new NextResponse(new Uint8Array(buffer), { headers: {
      ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cxp-integridad-entidad-${entidadId}-${datos.generadoEn.slice(0,10)}.xlsx"`,
    } });
  } catch (e) {
    if (e instanceof ErrorCxp) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status, headers });
    const ambito = errorAmbito(e);
    if (ambito) return privado(ambito);
    const code = (e as { code?: string })?.code;
    if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") return NextResponse.json({ error: "Esquema de Cuentas por pagar pendiente.", codigo: "MIGRACION_PENDIENTE" }, { status: 503, headers });
    console.error("[cxp-integridad]", { code: code ?? "desconocido" });
    return NextResponse.json({ error: "No se pudo consultar la integridad de Cuentas por pagar. Intenta nuevamente." }, { status: 500, headers });
  }
}

export function integridadCxpHttp(req: Request, slug: string) { return consultarHttp(req, slug, false); }
export function exportarIntegridadCxpHttp(req: Request, slug: string) { return consultarHttp(req, slug, true); }
