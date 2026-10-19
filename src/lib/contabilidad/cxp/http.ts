import { NextResponse } from "next/server";
import { requireTenantCxp } from "@/lib/tenant";
import { ambitoDesdeRequest, errorAmbito } from "@/lib/contabilidad/ambito";
import { ErrorCxp } from "./errores";
import { anularFactura, listarFacturas, obtenerFactura, previsualizarFactura, registrarFactura } from "./facturas";
import { listarPagos, obtenerPago, registrarPago, reversarPago } from "./pagos";
import { guardarConfigFiscal, listarCuentasCxp, listarProveedoresCxp, obtenerConfigFiscal } from "./proveedor-fiscal";
import { idPositivo } from "./validacion";

const NO_STORE = { "Cache-Control": "private, no-store" };
type Guard = Awaited<ReturnType<typeof requireTenantCxp>>;
type Ok = Exclude<Guard, { error: NextResponse }>;

/** Convierte cualquier fallo en una respuesta JSON segura (sin SQL ni detalles internos). */
function responderError(e: unknown) {
  if (e instanceof ErrorCxp) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status });
  const ambito = errorAmbito(e);
  if (ambito) return ambito;
  const code = (e as { code?: string })?.code;
  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") {
    return NextResponse.json({ error: "Esquema de Cuentas por pagar pendiente. Aplica las migraciones CxP (M-3A y M-3B1) antes de usar el módulo.", codigo: "MIGRACION_PENDIENTE" }, { status: 503 });
  }
  console.error("[cxp]", { code: code ?? "desconocido" });
  return NextResponse.json({ error: "No se pudo completar la operación. Intenta nuevamente." }, { status: 500 });
}

async function conAmbito(req: Request, g: Ok, fn: (entidadId: number) => Promise<NextResponse>) {
  try { return await fn(ambitoDesdeRequest(req, g.session).entidadId); } catch (e) { return responderError(e); }
}
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });
const cuerpo = async (req: Request) => {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new ErrorCxp("Cuerpo de la solicitud inválido.", 400, "CUERPO_INVALIDO");
  return b as Record<string, unknown>;
};
const actor = (g: Ok) => ({ id: g.session.id, username: g.session.username });

export async function listarFacturasHttp(req: Request, slug: string) {
  const g = await requireTenantCxp(slug, "cxp_facturas", "ver", "Sin permiso para ver facturas de proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const sp = new URL(req.url).searchParams, estado = sp.get("estado");
    if (estado && estado !== "REGISTRADA" && estado !== "ANULADA") throw new ErrorCxp("Estado inválido.", 400, "ESTADO_INVALIDO");
    const num = (k: string) => (sp.get(k) && /^[1-9]\d*$/.test(sp.get(k)!) ? Number(sp.get(k)) : undefined);
    const fecha = (k: string) => (sp.get(k) && /^\d{4}-\d{2}-\d{2}$/.test(sp.get(k)!) ? sp.get(k)! : undefined);
    return json(await listarFacturas(g.empresa.id, entidadId, {
      proveedorId: num("proveedorId"), estado: (estado as "REGISTRADA" | "ANULADA") || undefined, desde: fecha("desde"), hasta: fecha("hasta"),
      q: sp.get("q") ?? undefined, page: num("page"), pageSize: num("pageSize"),
    }));
  });
}

export async function registrarFacturaHttp(req: Request, slug: string) {
  const g = await requireTenantCxp(slug, "cxp_facturas", "editar", "Sin permiso para registrar facturas de proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const b = await cuerpo(req);
    // Solo campos capturados; empresa, entidad, usuario, totales e ISR NUNCA se leen del cuerpo.
    const r = await registrarFactura(g.empresa.id, entidadId, actor(g), {
      proveedorId: b.proveedorId, tipoDocumento: b.tipoDocumento, serie: b.serie, numero: b.numero, fechaDocumento: b.fechaDocumento,
      fechaVencimiento: b.fechaVencimiento, baseNeto: b.baseNeto, ivaMonto: b.ivaMonto, observaciones: b.observaciones,
    });
    return json(r, 201);
  });
}

export async function previsualizarFacturaHttp(req: Request, slug: string) {
  const g = await requireTenantCxp(slug, "cxp_facturas", "ver", "Sin permiso para ver facturas de proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const b = await cuerpo(req);
    return json(await previsualizarFactura(g.empresa.id, entidadId, { proveedorId: b.proveedorId, tipoDocumento: b.tipoDocumento, baseNeto: b.baseNeto, ivaMonto: b.ivaMonto, serie: "x", numero: "x", fechaDocumento: "2000-01-01" }));
  });
}

export async function obtenerFacturaHttp(req: Request, slug: string, id: string) {
  const g = await requireTenantCxp(slug, "cxp_facturas", "ver", "Sin permiso para ver facturas de proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const f = await obtenerFactura(g.empresa.id, entidadId, idPositivo(id, "Factura"));
    return f ? json({ factura: f }) : json({ error: "Factura no encontrada." }, 404);
  });
}

export async function anularFacturaHttp(req: Request, slug: string, id: string) {
  const g = await requireTenantCxp(slug, "cxp_anular", "editar", "Sin permiso para anular facturas de proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const b = await cuerpo(req);
    return json({ factura: await anularFactura(g.empresa.id, entidadId, id, actor(g), b.motivo) });
  });
}

/** El listado de proveedores sirve a quien registra facturas y a quien configura lo fiscal: basta cualquiera de los dos permisos de lectura. */
export async function listarProveedoresHttp(req: Request, slug: string) {
  let g = await requireTenantCxp(slug, "cxp_facturas", "ver", "Sin permiso para ver proveedores de CxP.");
  if (g.error) g = await requireTenantCxp(slug, "cxp_proveedor_fiscal", "ver", "Sin permiso para ver proveedores de CxP.");
  if (g.error) return g.error;
  const ok = g as Ok;
  return conAmbito(req, ok, async entidadId => {
    const sp = new URL(req.url).searchParams;
    return json({ proveedores: await listarProveedoresCxp(ok.empresa.id, entidadId, { buscar: sp.get("q") ?? "", soloActivos: sp.get("activos") === "1" }) });
  });
}

export async function obtenerConfigFiscalHttp(req: Request, slug: string, proveedorId: string) {
  const g = await requireTenantCxp(slug, "cxp_proveedor_fiscal", "ver", "Sin permiso para ver la configuración fiscal de proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => json({ config: await obtenerConfigFiscal(g.empresa.id, entidadId, idPositivo(proveedorId, "Proveedor")) }));
}

export async function guardarConfigFiscalHttp(req: Request, slug: string, proveedorId: string) {
  const g = await requireTenantCxp(slug, "cxp_proveedor_fiscal", "editar", "Sin permiso para editar la configuración fiscal de proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const b = await cuerpo(req);
    return json({ config: await guardarConfigFiscal(g.empresa.id, entidadId, proveedorId, actor(g), {
      regimenFiscal: b.regimenFiscal, sujetoIsr: b.sujetoIsr, cuentaProveedorId: b.cuentaProveedorId, cuentaAnticipoId: b.cuentaAnticipoId,
      cuentaGastoId: b.cuentaGastoId, activo: b.activo,
    }) });
  });
}

/** Cuentas ACTIVAS de la entidad para elegir cuenta de proveedores / anticipo / gasto al configurar un proveedor. */
export async function listarCuentasHttp(req: Request, slug: string) {
  const g = await requireTenantCxp(slug, "cxp_proveedor_fiscal", "ver", "Sin permiso para ver la configuración fiscal de proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => json({ cuentas: await listarCuentasCxp(g.empresa.id, entidadId) }));
}

/* ------------------------------------------------------------------ M-3B1: pagos a proveedores ------------------------------------------------------------------ */

export async function listarPagosHttp(req: Request, slug: string) {
  const g = await requireTenantCxp(slug, "cxp_pagos", "ver", "Sin permiso para ver pagos a proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const sp = new URL(req.url).searchParams, estado = sp.get("estado");
    if (estado && estado !== "REGISTRADO" && estado !== "REVERSADO") throw new ErrorCxp("Estado inválido.", 400, "ESTADO_INVALIDO");
    const num = (k: string) => (sp.get(k) && /^[1-9]\d*$/.test(sp.get(k)!) ? Number(sp.get(k)) : undefined);
    const fecha = (k: string) => (sp.get(k) && /^\d{4}-\d{2}-\d{2}$/.test(sp.get(k)!) ? sp.get(k)! : undefined);
    return json(await listarPagos(g.empresa.id, entidadId, {
      proveedorId: num("proveedorId"), facturaId: num("facturaId"), estado: (estado as "REGISTRADO" | "REVERSADO") || undefined,
      desde: fecha("desde"), hasta: fecha("hasta"), page: num("page"), pageSize: num("pageSize"),
    }));
  });
}

export async function registrarPagoHttp(req: Request, slug: string) {
  const g = await requireTenantCxp(slug, "cxp_pagos", "editar", "Sin permiso para registrar pagos a proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const b = await cuerpo(req);
    // Solo datos capturados. Empresa, entidad, usuario, monto total y estado NUNCA se leen del cuerpo (el total es la suma de las aplicaciones).
    const r = await registrarPago(g.empresa.id, entidadId, actor(g), {
      proveedorId: b.proveedorId, fechaPago: b.fechaPago, medioPago: b.medioPago, referencia: b.referencia, observaciones: b.observaciones,
      claveIdempotencia: b.claveIdempotencia, aplicaciones: b.aplicaciones,
    });
    return json(r, r.repetido ? 200 : 201);
  });
}

export async function obtenerPagoHttp(req: Request, slug: string, id: string) {
  const g = await requireTenantCxp(slug, "cxp_pagos", "ver", "Sin permiso para ver pagos a proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const p = await obtenerPago(g.empresa.id, entidadId, idPositivo(id, "Pago"));
    return p ? json({ pago: p }) : json({ error: "Pago no encontrado." }, 404);
  });
}

export async function reversarPagoHttp(req: Request, slug: string, id: string) {
  const g = await requireTenantCxp(slug, "cxp_reversar_pago", "editar", "Sin permiso para reversar pagos a proveedores.");
  if (g.error) return g.error;
  return conAmbito(req, g, async entidadId => {
    const b = await cuerpo(req);
    return json({ pago: await reversarPago(g.empresa.id, entidadId, id, actor(g), b.motivo) });
  });
}
