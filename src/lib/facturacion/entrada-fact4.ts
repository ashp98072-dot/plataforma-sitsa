import { z } from "zod";
import { requireTenantFacturacion } from "@/lib/tenant";
import type { DatosFacturaFact4 } from "@/lib/facturacion/facturas";
import {
  fact4Disponible,
  leerRetencionIvaCliente,
  listarEntidadesEmisoras,
  MENSAJE_FALTA_MIGRACION_FACT4,
} from "@/lib/facturacion/contexto-factura";
import {
  CLASIFICACIONES_LINEA,
  CONDICIONES_PAGO,
  MAX_LINEAS_FACTURA,
  esRetencionIvaValida,
} from "@/lib/facturacion/lineas-factura";

/**
 * FACT-4 — borde HTTP de las rutas de facturas (crear, editar, vista previa). Valida la FORMA de lo nuevo y resuelve lo que
 * NO debe confiarse al cliente: la retención de IVA (se precarga de la configuración del cliente y solo se cambia con el
 * permiso «Editar requisitos de clientes») y la entidad emisora. Los montos NUNCA vienen de aquí: el servidor recalcula.
 *
 * SIN FALLBACK SILENCIOSO: desde FACT-4, crear/editar/previsualizar una factura exige líneas y condición de pago. Si la
 * migración FACT-4 no está aplicada, la operación se BLOQUEA con 503 (nada se guarda): jamás se degrada al modelo anterior,
 * que perdería líneas agrupadas, condición de pago, entidad, banco, clasificación y retención. Las LECTURAS sí degradan
 * (facturas anteriores se siguen viendo); el bloqueo es solo de escrituras.
 */

export const fact4CamposSchema = {
  lineas: z
    .array(
      z.object({
        planIds: z.array(z.number().int().positive()).min(1).max(MAX_LINEAS_FACTURA),
        cantidad: z.number(),
        descripcion: z.string().max(2000),
        precioUnitario: z.number(),
        clasificacion: z.enum(CLASIFICACIONES_LINEA),
        // Tratamiento de IVA de ESTA línea, explícito (sin valor por defecto en el servidor).
        precioIncluyeIva: z.boolean(),
      }),
    )
    .min(1)
    .max(MAX_LINEAS_FACTURA)
    .optional(),
  entidadId: z.number().int().positive().nullable().optional(),
  condicionPago: z.enum(CONDICIONES_PAGO).optional(),
  cuentaBancariaId: z.number().int().positive().nullable().optional(),
  retencionIvaPct: z.number().int().optional(),
};

export type EntradaFact4 = z.infer<z.ZodObject<typeof fact4CamposSchema>>;

export type ResultadoEntradaFact4 =
  | { ok: true; datos: DatosFacturaFact4 }
  | { ok: false; error: string; status: number };

const falla = (error: string, status = 400): ResultadoEntradaFact4 => ({ ok: false, error, status });

export async function resolverEntradaFact4(args: {
  slug: string;
  empresaId: number;
  clienteId: number;
  entrada: EntradaFact4;
  /** Retención ya congelada en el borrador que se edita: reenviarla no exige el permiso de cambio. */
  retencionVigente?: number | null;
}): Promise<ResultadoEntradaFact4> {
  const e = args.entrada;

  // 1) Esquema: antes de cualquier otra cosa. Sin migración no se crea ni edita nada (503), con o sin campos FACT-4.
  if (!(await fact4Disponible())) return falla(MENSAJE_FALTA_MIGRACION_FACT4, 503);

  // 2) Lo que FACT-4 exige: líneas preparadas y condición de pago. Un payload del modelo anterior se rechaza, no se degrada.
  if (e.lineas == null) return falla("Prepara las líneas de la factura (cantidad, descripción y precio unitario).");
  if (e.condicionPago == null) return falla("La condición de pago (CRÉDITO o CONTADO) es obligatoria.");

  // Retención de IVA: por defecto la configurada del cliente; otro valor solo con permiso de edición de requisitos.
  const clientePct = await leerRetencionIvaCliente(args.empresaId, args.clienteId);
  let retencion: number = clientePct;
  if (e.retencionIvaPct != null && e.retencionIvaPct !== clientePct) {
    if (!esRetencionIvaValida(e.retencionIvaPct)) return falla("La retención de IVA debe ser 0, 15 o 30 %.");
    if (e.retencionIvaPct !== args.retencionVigente) {
      const permiso = await requireTenantFacturacion(args.slug, "editar_requisitos");
      if (permiso.error) {
        return falla("No tienes permiso para cambiar la retención de IVA del cliente en esta factura.", 403);
      }
    }
    retencion = e.retencionIvaPct;
  }

  // Entidad emisora: la elegida; la única de la empresa; o (al contado) la del banco. Con varias, es obligatoria.
  let entidadId = e.entidadId ?? null;
  if (entidadId == null && e.cuentaBancariaId == null) {
    const entidades = await listarEntidadesEmisoras(args.empresaId);
    if (entidades.length === 1) entidadId = entidades[0].id;
    else if (entidades.length > 1) return falla("Elige la entidad emisora de la factura.");
    else return falla("La empresa no tiene entidades emisoras activas configuradas: Contabilidad debe crearlas antes de facturar.");
  }

  return {
    ok: true,
    datos: {
      lineas: e.lineas,
      entidadId,
      condicionPago: e.condicionPago,
      cuentaBancariaId: e.cuentaBancariaId ?? null,
      retencionIvaPct: retencion,
      retencionIvaClientePct: clientePct,
    },
  };
}
