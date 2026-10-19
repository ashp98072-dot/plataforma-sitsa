import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantCxc } from "@/lib/tenant";
import { ambitoDesdeRequest, errorAmbito } from "@/lib/contabilidad/ambito";
import { ErrorCobro, anularCobro, clientesConSaldo, facturasPendientesCliente, listarCobros, registrarCobro } from "@/lib/facturacion/cobros";
import { exigirEntidadActiva } from "./cxc";

/**
 * CxC-1 — HTTP del cobro multi-factura. Empresa y usuario salen de la sesión; la entidad, de `?entidad=` (obligatoria y única, validada activa y de la empresa).
 * Permisos propios: ver = cxc_cuentas:ver · registrar = cxc_cobros:editar · anular = cxc_anular_cobro:editar (ninguno concede los otros ni Facturación).
 */
const NO_STORE = { "Cache-Control": "private, no-store" };
type Guard = Awaited<ReturnType<typeof requireTenantCxc>>;
type Ok = Exclude<Guard, { error: NextResponse }>;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });

function responderError(e: unknown) {
  if (e instanceof ErrorCobro) return json({ error: e.message, codigo: e.codigo }, e.status);
  const ambito = errorAmbito(e);
  if (ambito) return ambito;
  const code = (e as { code?: string })?.code;
  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") return json({ error: "Esquema de cobros pendiente. Aplica la migración CxC-1 antes de usar esta función.", codigo: "MIGRACION_PENDIENTE" }, 503);
  if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") return json({ error: "Operación en conflicto. Actualiza y vuelve a intentar.", codigo: "CONFLICTO" }, 409);
  console.error("[cxc-cobros]", { code: code ?? "desconocido" });
  return json({ error: "No se pudo completar la operación. Intenta nuevamente." }, 500);
}
async function conAmbito(req: Request, g: Ok, fn: (entidadId: number) => Promise<NextResponse>) {
  try { return await fn(ambitoDesdeRequest(req, g.session).entidadId); } catch (e) { return responderError(e); }
}
const entero = (v: string | null) => (v && /^[1-9]\d{0,9}$/.test(v) && Number(v) <= 2147483647 ? Number(v) : undefined);
const fecha = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** Historial de cobros aplicados del libro (con sus aplicaciones). Permiso cxc_cuentas:ver. */
export async function listarCobrosAplicadosHttp(req: Request, slug: string) {
  const g = await requireTenantCxc(slug, "cxc_cuentas", "ver", "Sin permiso para ver Cuentas por cobrar.");
  if (g.error) return g.error;
  return conAmbito(req, g, async (entidadId) => {
    await exigirEntidadActiva(g.empresa.id, entidadId);
    const sp = new URL(req.url).searchParams, estado = sp.get("estado");
    return json(await listarCobros(g.empresa.id, entidadId, {
      clienteId: entero(sp.get("clienteId")), estado: estado === "VIGENTE" || estado === "ANULADO" ? estado : undefined,
      desde: fecha(sp.get("desde")), hasta: fecha(sp.get("hasta")), page: entero(sp.get("page")), pageSize: entero(sp.get("pageSize")),
    }));
  });
}

const schemaCobro = z.object({
  clienteId: z.number().int().positive(),
  fechaCobro: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  medioPago: z.string().trim().max(40).nullable().optional(),
  referencia: z.string().trim().max(120).nullable().optional(),
  observaciones: z.string().trim().max(2000).nullable().optional(),
  claveIdempotencia: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/),
  // El monto viaja como TEXTO decimal (nunca flotante). Empresa, entidad, usuario y totales NO se aceptan del cuerpo.
  aplicaciones: z.array(z.object({ facturaId: z.number().int().positive(), monto: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/) }).strict()).min(1).max(50),
}).strict();

/** Registra un cobro aplicado a una o varias facturas. Permiso cxc_cobros:editar. */
export async function registrarCobroAplicadoHttp(req: Request, slug: string) {
  const g = await requireTenantCxc(slug, "cxc_cobros", "editar", "Sin permiso para registrar cobros.");
  if (g.error) return g.error;
  return conAmbito(req, g, async (entidadId) => {
    const parsed = schemaCobro.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "Datos de cobro inválidos.", codigo: "DATOS_INVALIDOS" }, 400);
    const r = await registrarCobro({ empresaId: g.empresa.id, usuarioId: g.session.id, usuario: g.session.username }, entidadId, parsed.data);
    return json({ cobro: r.cobro, repetido: r.repetido, mensaje: r.repetido ? "Este cobro ya estaba registrado; no se duplicó." : "Cobro registrado." }, r.repetido ? 200 : 201);
  });
}

/** Anula el cobro COMPLETO con motivo. Permiso PROPIO cxc_anular_cobro:editar. */
export async function anularCobroAplicadoHttp(req: Request, slug: string, id: string) {
  const g = await requireTenantCxc(slug, "cxc_anular_cobro", "editar", "Sin permiso para anular cobros.");
  if (g.error) return g.error;
  return conAmbito(req, g, async (entidadId) => {
    if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) return json({ error: "Cobro inválido." }, 400);
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "Cuerpo de la solicitud inválido." }, 400);
    const cobro = await anularCobro({ empresaId: g.empresa.id, usuarioId: g.session.id, usuario: g.session.username }, entidadId, Number(id), (b as { motivo?: unknown }).motivo);
    return json({ cobro, mensaje: "Cobro anulado: los saldos se restauraron." });
  });
}

/** Clientes del libro con saldo pendiente (para elegir a quién se cobra). Permiso cxc_cobros:editar. */
export async function clientesCobroHttp(req: Request, slug: string) {
  const g = await requireTenantCxc(slug, "cxc_cobros", "editar", "Sin permiso para registrar cobros.");
  if (g.error) return g.error;
  return conAmbito(req, g, async (entidadId) => {
    await exigirEntidadActiva(g.empresa.id, entidadId);
    return json({ clientes: await clientesConSaldo(g.empresa.id, entidadId) });
  });
}

/** Facturas Emitidas con saldo de un cliente del libro. Permiso cxc_cobros:editar. */
export async function facturasPendientesHttp(req: Request, slug: string) {
  const g = await requireTenantCxc(slug, "cxc_cobros", "editar", "Sin permiso para registrar cobros.");
  if (g.error) return g.error;
  return conAmbito(req, g, async (entidadId) => {
    await exigirEntidadActiva(g.empresa.id, entidadId);
    const clienteId = entero(new URL(req.url).searchParams.get("clienteId"));
    if (!clienteId) return json({ error: "Selecciona el cliente." }, 400);
    return json({ facturas: await facturasPendientesCliente(g.empresa.id, entidadId, clienteId) });
  });
}
