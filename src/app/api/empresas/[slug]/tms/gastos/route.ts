import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastos } from "@/lib/tenant";
import { CATEGORIAS_GASTO, METODOS_PAGO_GASTO, crearGasto, listarGastos } from "@/lib/tms/gastos";
import { CONFIG_GASTOS, respuestaErroresZod, respuestaFalloOperacion, conCuentaMovil } from "@/lib/tms/validacion-fondos-gastos";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const p = url.searchParams;
  const numero = (v: string | null) => {
    const n = Number(v);
    return v && Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const gastos = await listarGastos(guard.empresa.id, {
    fechaDesde: p.get("fechaDesde") || undefined,
    fechaHasta: p.get("fechaHasta") || undefined,
    categoria: p.get("categoria") || undefined,
    clienteId: numero(p.get("clienteId")),
    vehiculoId: numero(p.get("vehiculoId")),
    planId: numero(p.get("planId")),
    empleadoId: numero(p.get("empleadoId")),
    incluirInactivos: p.get("incluirInactivos") === "1",
  });
  return NextResponse.json(
    { gastos, categorias: CATEGORIAS_GASTO, metodosPago: METODOS_PAGO_GASTO },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * GASTOS-MULTIPLES-LINEAS-1 — schema de UNA línea. Sin overrides de texto
 * (decisión #3, diferidos) ni campos de firma/comprobante/factura/
 * requirente/solicitante (permanecen exclusivamente en la cabecera).
 */
const lineaSchema = conCuentaMovil(z.object({
  categoria: z.enum(CATEGORIAS_GASTO),
  descripcion: z.string().max(300).nullable().optional(),
  cantidad: z.number().positive().max(999999).optional(),
  monto: z.number().positive().max(9999999999.99),
  metodoPago: z.enum(METODOS_PAGO_GASTO).nullable().optional(),
  numeroCuentaPago: z.string().max(80).nullable().optional(),
  fechaViaje: z.string().nullable().optional(),
  empleadoId: z.number().int().positive().nullable().optional(),
  vehiculoId: z.number().int().positive().nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
}), "numeroCuentaPago", true);

const schema = z.object({
  fechaSolicitud: z.string().min(1),
  fechaViaje: z.string().nullable().optional(),
  empleadoId: z.number().int().positive().nullable().optional(),
  vehiculoId: z.number().int().positive().nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
  categoria: z.enum(CATEGORIAS_GASTO),
  descripcion: z.string().max(300).nullable().optional(),
  cantidad: z.number().positive().max(999999).optional(),
  // GASTOS-MULTIPLES-LINEAS-1 (decisión #1) — requerido SOLO cuando NO se
  // envían líneas (ver .superRefine abajo); con líneas, se ignora y se
  // deriva en servidor (crearGasto) como SUM(lineas.cantidad * lineas.monto).
  monto: z.number().positive().max(9999999999.99).optional(),
  metodoPago: z.enum(METODOS_PAGO_GASTO).nullable().optional(),
  numeroCuentaPago: z.string().max(80).nullable().optional(),
  tieneFactura: z.boolean().optional(),
  observaciones: z.string().max(300).nullable().optional(),
  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 3) — TODOS opcionales, mismo criterio
   * que crearGasto (Fase 2): la UI actual (Fase 4, todavía no
   * implementada) no los envía, así que "Crear gasto" sigue funcionando
   * igual sin ellos. `estado`/`autorizante*` NO están aquí a propósito —
   * nunca se aceptan en creación/edición, solo los escriben
   * autorizarGasto/rechazarGasto vía sus propios endpoints.
   */
  entidadRequirenteId: z.number().int().positive().optional(),
  requirenteEmpleadoId: z.number().int().positive().nullable().optional(),
  requirenteNombre: z.string().max(200).nullable().optional(),
  requirenteUsuarioId: z.number().int().positive().nullable().optional(),
  solicitanteUsuarioId: z.number().int().positive().nullable().optional(),
  /**
   * GASTOS-MULTIPLES-LINEAS-1 — ausente: modo cabecera (comportamiento
   * idéntico al actual). `.min(1)`: un array vacío se rechaza aquí mismo
   * (decisión #2, aprobada) — nunca llega a crearGasto como "borrar
   * líneas silenciosamente" porque en creación no hay nada que borrar,
   * pero se mantiene el mismo criterio de validación por simetría con PATCH.
   */
  lineas: z.array(lineaSchema).min(1).optional(),
}).superRefine((data, ctx) => {
  if (!data.lineas && data.monto === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Monto requerido.", path: ["monto"] });
  }
});

/** Cuenta de transferencia móvil: en modo cabecera (sin líneas) se revisa en la cabecera; con líneas, cada línea trae la suya. */
const schemaConCuenta = conCuentaMovil(schema, "numeroCuentaPago", true, (d) => Array.isArray((d as { lineas?: unknown }).lineas));

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "crear");
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => ({}));
  const parsed = schemaConCuenta.safeParse(body);
  if (!parsed.success) {
    // Errores claros por campo/línea ("Línea 2 — Método de pago: …"); `error` se conserva por compatibilidad.
    return respuestaErroresZod(parsed.error, CONFIG_GASTOS, body);
  }
  try {
    const gasto = await crearGasto(guard.empresa.id, parsed.data, guard.session.username);
    return NextResponse.json({ mensaje: "Gasto registrado.", gasto });
  } catch (error) {
    return respuestaFalloOperacion(error, "POST tms/gastos");
  }
}
