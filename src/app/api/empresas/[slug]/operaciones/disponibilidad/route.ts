import { NextResponse } from "next/server";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import {
  esFlotaSubmodulo,
  tienePermiso,
  type PermisoModulo,
} from "@/lib/permisos-shared";
import { permisosEfectivos } from "@/lib/permisos";
import { modulosPorRol, type RolGlobal } from "@/lib/roles";
import { requireTenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET disponibilidad de flota para Operaciones.
 * Acceso: Admin, TMS, u Operaciones/Flota con permiso de ver vehículos.
 * No escribe; no toca schema pesado de Flota.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant.error;

  const { session, empresa } = tenant;
  if (session.rol !== "Admin") {
    const rol = session.rol as RolGlobal;
    const rolMods = modulosPorRol(rol);
    let perms: PermisoModulo[] = [];
    try {
      perms = await permisosEfectivos(session.id, rol);
    } catch {
      perms = [];
    }

    const porTms =
      perms.length > 0
        ? tienePermiso(perms, "tms", "ver")
        : rolMods.includes("tms");
    const porFlota =
      perms.length > 0
        ? perms.some(
            (p) =>
              (esFlotaSubmodulo(p.modulo) || p.modulo === "flota") &&
              p.puedeVer,
          )
        : rolMods.includes("flota") || empresa.modulos.includes("flota");

    if (!porTms && !porFlota) {
      return NextResponse.json(
        { error: "Sin permiso para ver disponibilidad de flota." },
        { status: 403 },
      );
    }
  }

  try {
    const data = await listarDisponibilidadVehiculos(empresa.id);
    return NextResponse.json(data, {
      headers: {
        // Lectura operativa: no cachear en CDN (estado cambia con viajes/taller).
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("disponibilidad", e);
    return NextResponse.json(
      { error: "No se pudo cargar la disponibilidad." },
      { status: 500 },
    );
  }
}
