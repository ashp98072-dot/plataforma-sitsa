import { NextResponse } from "next/server";
import { requireTenantCxp } from "@/lib/tenant";
import { ambitoDesdeRequest, errorAmbito } from "@/lib/contabilidad/ambito";
import { ErrorCxp } from "./errores";
import { exportarEstadoCuentaCxp, obtenerEstadoCuentaCxp, type OpcionesEstado } from "./estado-cuenta";
import { estadoCuentaAExcel } from "./estado-cuenta-excel";
import { filtrosEstadoCuentaDesdeParams } from "./estado-cuenta-shared";

const NO_STORE = { "Cache-Control": "private, no-store" };
const MSG_SIN_PERMISO = "Sin permiso para ver facturas de proveedores.";
type Guard = Awaited<ReturnType<typeof requireTenantCxp>>;
type Ok = Exclude<Guard, { error: NextResponse }>;

/** Fallo → respuesta JSON segura (sin SQL). Mismo contrato que el resto de CxP: 503 MIGRACION_PENDIENTE, 400/404 de dominio, 500 genérico. */
function responderError(e: unknown) {
  if (e instanceof ErrorCxp) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status });
  const ambito = errorAmbito(e);
  if (ambito) return ambito;
  const code = (e as { code?: string })?.code;
  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") {
    return NextResponse.json({ error: "Esquema de Cuentas por pagar pendiente. Aplica las migraciones CxP (M-3A y M-3B1) antes de usar el módulo.", codigo: "MIGRACION_PENDIENTE" }, { status: 503 });
  }
  console.error("[cxp-estado-cuenta]", { code: code ?? "desconocido" });
  return NextResponse.json({ error: "No se pudo generar el estado de cuenta. Intenta nuevamente." }, { status: 500 });
}

/**
 * Permisos (D2/D6), decididos en el SERVIDOR: `cxp_facturas`:`ver` es obligatorio (facturas y saldos). Sin `cxp_pagos`:`ver` NO se consultan ni se envían
 * líneas de pagos, referencias, medios ni datos de reversión (ni en JSON ni en Excel). Sin `cxp_proveedor_fiscal`:`ver` no se muestra el régimen.
 * La autorización va ANTES de validar filtros; la política de entidad vigente (ticket transversal #555) no cambia.
 */
async function permisos(slug: string): Promise<{ error: NextResponse } | { error?: undefined; g: Ok; op: OpcionesEstado }> {
  const g = await requireTenantCxp(slug, "cxp_facturas", "ver", MSG_SIN_PERMISO);
  if (g.error) return { error: g.error };
  const ok = g as Ok;
  const [pagos, fiscal] = await Promise.all([
    requireTenantCxp(slug, "cxp_pagos", "ver", "Sin permiso para ver pagos de proveedores."),
    requireTenantCxp(slug, "cxp_proveedor_fiscal", "ver", "Sin permiso para ver la configuración fiscal de proveedores."),
  ]);
  const op: OpcionesEstado = { verPagos: !pagos.error, verFiscal: !fiscal.error };
  return { g: ok, op };
}

export async function estadoCuentaCxpHttp(req: Request, slug: string) {
  const r0 = await permisos(slug);
  if (r0.error) return r0.error;
  const { g, op } = r0;
  try {
    const { entidadId } = ambitoDesdeRequest(req, g.session);
    const parsed = filtrosEstadoCuentaDesdeParams(new URL(req.url).searchParams);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, codigo: "FILTRO_INVALIDO" }, { status: 400 });
    return NextResponse.json(await obtenerEstadoCuentaCxp(g.empresa.id, entidadId, parsed.filtros, op), { headers: NO_STORE });
  } catch (e) { return responderError(e); }
}

/** Excel del conjunto FILTRADO exacto. `corte` (opcional) conserva la fecha de la pantalla: solo hoy/ayer (Guatemala); NO es un saldo histórico. */
export async function exportarEstadoCuentaCxpHttp(req: Request, slug: string) {
  const r0 = await permisos(slug);
  if (r0.error) return r0.error;
  const { g, op } = r0;
  try {
    const { entidadId } = ambitoDesdeRequest(req, g.session);
    const parsed = filtrosEstadoCuentaDesdeParams(new URL(req.url).searchParams, { permitirCorte: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, codigo: "FILTRO_INVALIDO" }, { status: 400 });
    const r = await exportarEstadoCuentaCxp(g.empresa.id, entidadId, parsed.filtros, op, parsed.corte);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    const buffer = await estadoCuentaAExcel(r.datos);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="cuentas-por-pagar-estado-cuenta-proveedor-${r.datos.proveedor.id}-${r.datos.fechaCorte}.xlsx"`,
        ...NO_STORE,
      },
    });
  } catch (e) { return responderError(e); }
}
