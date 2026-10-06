import type { PermisoModulo } from "@/lib/permisos-shared";
import { tieneAccionCatalogo, tienePermisoBase } from "@/lib/permisos-catalogo";
import type { AlcanceFacturacion } from "@/lib/facturacion/alcance-rol";

/**
 * Capacidades de Facturación (configuración de la empresa / requisitos de clientes) derivadas de PERMISOS ASIGNABLES — no del rol.
 *
 * Reglas:
 * - Admin: todo (bypass existente de la plataforma).
 * - Sin «Ver Facturación» (base): ninguna.
 * - «Editar …» exige además «Ver …» de la misma sección (editar sin ver no existe).
 * - Cada sección es independiente de las demás y de «Emitir / Anular / Pagar»: emitir una factura (borrador → emitida) NO da acceso a la configuración.
 *
 * `permisos` debe ser la lista EFECTIVA (`permisosEfectivos`, o la del `useEmpresaSession`), que ya aplicó `adaptarPermisosLegacy`: ahí las
 * equivalencias por rol de usuarios anteriores a la matriz V2 se vuelven filas de permiso. Aquí no se consulta `username` ni se vuelve a mirar el rol.
 */
export function capacidadesFacturacion(permisos: PermisoModulo[], rol: string): AlcanceFacturacion {
  if (rol === "Admin") return { verEmpresa: true, editarEmpresa: true, verClientes: true, editarClientes: true };
  if (!tienePermisoBase(permisos, "facturacion")) {
    return { verEmpresa: false, editarEmpresa: false, verClientes: false, editarClientes: false };
  }
  const verEmpresa = tieneAccionCatalogo(permisos, "facturacion", "ver_empresa");
  const verClientes = tieneAccionCatalogo(permisos, "facturacion", "ver_requisitos");
  return {
    verEmpresa,
    editarEmpresa: verEmpresa && tieneAccionCatalogo(permisos, "facturacion", "editar_empresa"),
    verClientes,
    editarClientes: verClientes && tieneAccionCatalogo(permisos, "facturacion", "editar_requisitos"),
  };
}
