import { NextResponse } from "next/server";
import { requireTenantViaticosAny } from "@/lib/tenant";
import { listarViaticosControl, type EstadoViatico } from "@/lib/tms/viaticos";
import { permisosEfectivos, tienePermiso } from "@/lib/permisos";
import type { RolGlobal } from "@/lib/roles";

type Ctx = { params: Promise<{ slug: string }> };

// VIATICOS-RECHAZADO-1 — Control de Viáticos SÍ debe poder filtrar por
// RECHAZADO (sección 17 del ticket: "CONTROL: sí"). A diferencia de
// por-pagar/route.ts y por-pagar/exportar/route.ts (que NUNCA deben
// devolver/exportar RECHAZADO — ver listarViaticosPorPagar, que ya lo
// excluye de forma incondicional en el backend).
const ESTADOS: EstadoViatico[] = ["PROGRAMADO", "AUTORIZADO", "RECHAZADO", "ENTREGADO", "LIQUIDADO"];

/**
 * VIAT-3 — listado global para el módulo "Operaciones > Viáticos" (antes
 * "Control de Viáticos" de TMS, VIAT-1 punto 7 — misma función de backend
 * reutilizada, ver src/lib/tms/viaticos.ts). Permiso: CUALQUIERA de
 * viaticos/viaticos_autorizar/viaticos_pagar/viaticos_liquidar con `ver`
 * (requireTenantViaticosAny) — un facturador que solo tiene
 * `viaticos_pagar`/`viaticos_liquidar` también debe poder ver este
 * listado para ubicar sus AUTORIZADOS/ENTREGADOS.
 *
 * Devuelve además flags de capacidad (puedeAutorizar/puedePagar/
 * puedeLiquidar/puedeVerBancario) para que la UI oculte botones que el
 * usuario no puede ejecutar — la seguridad real sigue en cada endpoint de
 * acción (autorizar → requireTenantViaticosAutorizar, pagar/entregar →
 * requireTenantViaticosPagar, liquidar → requireTenantViaticosLiquidar —
 * cada uno con su propio permiso explícito, VIATICOS-FIRMA: liquidar YA
 * NO usa el genérico `viaticos:editar`), nunca en estos flags.
 * `puedeVerBancario` controla si esta respuesta incluye banco/cuenta (ver
 * incluirBancario en listarViaticosControl) — un usuario sin
 * `viaticos_pagar:ver` JAMÁS recibe esos campos, ni siquiera en la
 * respuesta cruda (no es solo ocultarlos en la UI).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViaticosAny(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const planIdRaw = url.searchParams.get("planId");
  const planId = planIdRaw && Number.isFinite(Number(planIdRaw)) ? Number(planIdRaw) : undefined;
  const fechaDesde = url.searchParams.get("fechaDesde") || undefined;
  const fechaHasta = url.searchParams.get("fechaHasta") || undefined;
  const empleadoNombre = url.searchParams.get("empleado") || undefined;
  const estadoRaw = url.searchParams.get("estado");
  const estado = estadoRaw && (ESTADOS as string[]).includes(estadoRaw) ? (estadoRaw as EstadoViatico) : undefined;

  const perms = await permisosEfectivos(guard.session.id, guard.session.rol as RolGlobal);
  const puedeAutorizar = tienePermiso(perms, "viaticos_autorizar", "editar");
  const puedePagar = tienePermiso(perms, "viaticos_pagar", "editar");
  // VIATICOS-FIRMA: liquidar ya NO depende del permiso genérico "viaticos"
  // — es su propio permiso explícito, igual que autorizar/pagar. Un
  // usuario que antes liquidaba solo con "viaticos:editar" necesita este
  // permiso nuevo asignado explícitamente (ver reporte de entrega).
  const puedeLiquidar = tienePermiso(perms, "viaticos_liquidar", "editar");
  const puedeVerBancario = tienePermiso(perms, "viaticos_pagar", "ver");

  const resultado = await listarViaticosControl(
    guard.empresa.id,
    { planId, fechaDesde, fechaHasta, empleadoNombre, estado },
    { incluirBancario: puedeVerBancario },
  );
  return NextResponse.json({
    ...resultado,
    puedeAutorizar,
    puedePagar,
    puedeLiquidar,
    puedeVerBancario,
  });
}
