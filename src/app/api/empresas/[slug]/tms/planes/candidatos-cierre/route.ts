import { NextResponse } from "next/server";
import { requireTenantViajesCerrar } from "@/lib/tenant";
import { puedeCerrarManualmente, puedeCerrarNormalmente } from "@/lib/tms/cierre-viaje-shared";
import { resolverPeriodoPlanes } from "@/lib/tms/planes-periodo";
import { obtenerCandidatosCierre, type FiltrosReporteViajes } from "@/lib/tms/reportes-viajes";
import type { EstadoFinancieroFactura } from "@/lib/facturacion/facturas";

type Ctx = { params: Promise<{ slug: string }> };

const AGRUPACIONES_VALIDAS = new Set(["DIA", "SEMANA", "MES"]);
const ESTADOS_FACTURACION_VIAJE: FiltrosReporteViajes["estadoFacturacion"][] = [
  "No aplica", "Pendiente de facturación", "En borrador de factura", "Facturado",
];
const ESTADOS_COBRO: EstadoFinancieroFactura[] = ["Sin pagos", "Pago parcial", "Cobrado"];

/**
 * PLANES-CIERRE-PERIODO — GET /tms/planes/candidatos-cierre?agrupacion=DIA|SEMANA|MES&valor=...
 * Vista previa (solo lectura) de cuántos viajes de TODO el período (no solo la página cargada) calificarían
 * para un cierre NORMAL o MANUAL, respetando los mismos filtros activos del listado. Es puramente informativa
 * para el modal de confirmación — la ejecución real (POST cerrar-masivo-periodo) vuelve a resolver los
 * candidatos desde cero en ese momento, nunca reutiliza los ids de esta respuesta.
 *
 * Mismo permiso que el cierre (viajes_cerrar:editar), empresa SIEMPRE de la sesión — nunca del cliente.
 * Respuesta mínima: solo ids/conteos, sin exponer cliente/piloto/tarifa/facturación de los viajes candidatos.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViajesCerrar(slug, "editar");
  if (guard.error) return guard.error;

  const sp = new URL(req.url).searchParams;
  const agrupacion = sp.get("agrupacion") ?? "";
  if (!AGRUPACIONES_VALIDAS.has(agrupacion)) {
    return NextResponse.json({ error: "Agrupación inválida: debe ser DIA, SEMANA o MES." }, { status: 400 });
  }
  const periodo = resolverPeriodoPlanes(agrupacion, sp.get("valor") ?? "");
  if (!periodo) {
    return NextResponse.json({ error: "Valor de período inválido." }, { status: 400 });
  }

  const clienteId = Number(sp.get("clienteId"));
  const pilotoId = Number(sp.get("pilotoId"));
  const unidadId = Number(sp.get("unidadId"));
  const estadoFacturacion = sp.get("estadoFacturacion");
  const estadoCobro = sp.get("estadoCobro");

  // PLANES-CIERRE-PERIODO (corrección pre-merge PR #386) — soloPendientesCierre/soloCerrados/soloSinCerrar SÍ
  // se aceptan (booleano real: === "1", nunca un string arbitrario) y se reenvían — la acción de período debe
  // representar la INTERSECCIÓN del filtro de vista activo con el rango del período, nunca ignorarlo.
  // fechaDesde/fechaHasta del cliente NUNCA se aceptan aquí: el período SIEMPRE los fija.
  const candidatos = await obtenerCandidatosCierre(guard.empresa.id, {
    fechaDesde: periodo.desde,
    fechaHasta: periodo.hasta,
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    pilotoId: Number.isInteger(pilotoId) && pilotoId > 0 ? pilotoId : undefined,
    unidadId: Number.isInteger(unidadId) && unidadId > 0 ? unidadId : undefined,
    estado: sp.get("estado")?.trim() || undefined,
    ruta: sp.get("ruta")?.trim() || undefined,
    estadoFacturacion: estadoFacturacion && (ESTADOS_FACTURACION_VIAJE as string[]).includes(estadoFacturacion)
      ? (estadoFacturacion as FiltrosReporteViajes["estadoFacturacion"]) : undefined,
    estadoCobro: estadoCobro && (ESTADOS_COBRO as string[]).includes(estadoCobro)
      ? (estadoCobro as EstadoFinancieroFactura) : undefined,
    soloPendientesCierre: sp.get("soloPendientesCierre") === "1",
    soloCerrados: sp.get("soloCerrados") === "1",
    soloSinCerrar: sp.get("soloSinCerrar") === "1",
  });

  const normalIds = candidatos.filter((c) => puedeCerrarNormalmente(c.estado, c.llegadaRegistrada)).map((c) => c.id);
  const manualIds = candidatos.filter((c) => puedeCerrarManualmente(c.estado)).map((c) => c.id);

  return NextResponse.json(
    {
      periodo: { agrupacion, valor: periodo.clave, etiqueta: periodo.etiqueta, desde: periodo.desde, hasta: periodo.hasta },
      total: candidatos.length,
      normal: { elegibles: normalIds.length, ids: normalIds },
      manual: { elegibles: manualIds.length, ids: manualIds },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
