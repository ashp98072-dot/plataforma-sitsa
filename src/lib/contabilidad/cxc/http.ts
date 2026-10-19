import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantCxc } from "@/lib/tenant";
import { ambitoDesdeRequest, errorAmbito } from "@/lib/contabilidad/ambito";
import { filtrosDesdeParams } from "@/lib/facturacion/cuentas-por-cobrar-shared";
import { listarCobrosCxc, listarDocumentosCxc, registrarCobroCxc } from "./cxc";

const NO_STORE = { "Cache-Control": "private, no-store" };
type Guard = Awaited<ReturnType<typeof requireTenantCxc>>;
type Ok = Exclude<Guard, { error: NextResponse }>;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });

function responderError(e: unknown) {
  const ambito = errorAmbito(e);
  if (ambito) return ambito;
  const code = (e as { code?: string })?.code;
  if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") return json({ error: "Operación en conflicto. Actualiza y vuelve a intentar." }, 409);
  console.error("[cxc]", { code: code ?? "desconocido" });
  return json({ error: "No se pudo completar la operación. Intenta nuevamente." }, 500);
}
async function conAmbito(req: Request, g: Ok, fn: (entidadId: number) => Promise<NextResponse>) {
  try { return await fn(ambitoDesdeRequest(req, g.session).entidadId); } catch (e) { return responderError(e); }
}

/** Documentos (facturas Emitidas/Anuladas) del libro. Permiso cxc_cuentas:ver. */
export async function listarDocumentosHttp(req: Request, slug: string) {
  const g = await requireTenantCxc(slug, "cxc_cuentas", "ver", "Sin permiso para ver Cuentas por cobrar.");
  if (g.error) return g.error;
  return conAmbito(req, g, async (entidadId) => json(await listarDocumentosCxc(g.empresa.id, entidadId, filtrosDesdeParams(new URL(req.url).searchParams, "historial"))));
}

const entero = (v: string | null) => (v && /^[1-9]\d{0,9}$/.test(v) && Number(v) <= 2147483647 ? Number(v) : undefined);
const fecha = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const texto = (v: string | null, max: number) => (v?.trim() ? v.trim().slice(0, max) : undefined);

/** Cobros (fact_pagos) del libro. Permiso cxc_cuentas:ver. */
export async function listarCobrosHttp(req: Request, slug: string) {
  const g = await requireTenantCxc(slug, "cxc_cuentas", "ver", "Sin permiso para ver Cuentas por cobrar.");
  if (g.error) return g.error;
  return conAmbito(req, g, async (entidadId) => {
    const sp = new URL(req.url).searchParams;
    return json(await listarCobrosCxc(g.empresa.id, entidadId, {
      clienteId: entero(sp.get("clienteId")), textoCliente: texto(sp.get("textoCliente"), 120), numeroFactura: texto(sp.get("numeroFactura"), 60),
      fechaDesde: fecha(sp.get("fechaDesde")), fechaHasta: fecha(sp.get("fechaHasta")), page: entero(sp.get("page")), pageSize: entero(sp.get("pageSize")),
    }));
  });
}

const schemaCobro = z.object({
  facturaId: z.number().int().positive(),
  fechaPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monto: z.number().positive(),
  referencia: z.string().trim().max(120).optional().nullable(),
  medioPago: z.string().trim().max(40).optional().nullable(),
  observaciones: z.string().trim().max(2000).optional().nullable(),
});

/** Registra un cobro. Permiso cxc_cobros:editar (NO requiere ni concede permisos de Facturación). Empresa, usuario y entidad salen de la sesión/ámbito. */
export async function registrarCobroHttp(req: Request, slug: string) {
  const g = await requireTenantCxc(slug, "cxc_cobros", "editar", "Sin permiso para registrar cobros.");
  if (g.error) return g.error;
  return conAmbito(req, g, async (entidadId) => {
    const parsed = schemaCobro.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "Datos de cobro inválidos." }, 400);
    const r = await registrarCobroCxc({ empresaId: g.empresa.id, usuarioId: g.session.id, usuario: g.session.username }, entidadId, parsed.data);
    return r.ok ? json({ mensaje: "Cobro registrado." }, 201) : json({ error: r.error }, r.status);
  });
}
