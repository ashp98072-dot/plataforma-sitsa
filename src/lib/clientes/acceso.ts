import {
  asegurarModulosClientesFacturacion,
  asegurarSchemaClientes,
} from "@/lib/clientes/schema";
import { asegurarSchemaFacturacion } from "@/lib/facturacion/schema";
import { requireTenant, requireTenantModulo } from "@/lib/tenant";
import type { Modulo } from "@/lib/roles";

/**
 * Asegura tablas + modulos_json y luego valida permiso.
 * Evita 403 en Hostinger cuando la empresa aún no tenía "clientes"/"facturacion".
 */
export async function requireClientesOFacturacion(
  slug: string,
  modulo: Extract<Modulo, "clientes" | "facturacion">,
  editar = false,
) {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  await asegurarSchemaClientes();
  if (modulo === "facturacion") {
    await asegurarSchemaFacturacion();
  }
  await asegurarModulosClientesFacturacion(tenant.empresa.id);

  return requireTenantModulo(slug, modulo, editar);
}
