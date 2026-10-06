import { NextResponse } from "next/server";
import {
  alcanceFacturacionPorRol,
  type AlcanceFacturacion,
} from "@/lib/facturacion/alcance-rol";

export type { AlcanceFacturacion };

/**
 * @deprecated Solo equivalencia LEGACY por rol. Las capacidades de Facturación (configuración de la empresa y requisitos de clientes) salen de
 * los permisos asignables: usar `capacidadesFacturacion(permisos, rol)` (capacidades.ts) y `requireFacturacionConfig` (acceso.ts) en el backend.
 */
export function alcanceFacturacion(rol: string): AlcanceFacturacion {
  return alcanceFacturacionPorRol(rol);
}

export function denyFacturacionAlcance(
  mensaje = "Sin permiso para esta parte de facturación.",
) {
  return NextResponse.json({ error: mensaje }, { status: 403 });
}
