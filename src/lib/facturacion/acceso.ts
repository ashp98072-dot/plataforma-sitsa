import {
  asegurarModulosClientesFacturacion,
  asegurarSchemaClientes,
} from "@/lib/clientes/schema";
import { asegurarSchemaFacturacion } from "@/lib/facturacion/schema";
import {
  requireTenant,
  requireTenantFacturacion,
  type AccionConfigFacturacion,
} from "@/lib/tenant";

/**
 * Guard de los endpoints de Configuración de la empresa y Requisitos de clientes (GET/PUT). Asegura tablas + modulos_json (igual que
 * requireClientesOFacturacion, para no dar 403 en Hostinger cuando la empresa aún no tenía "facturacion") y exige el PERMISO específico
 * (ver_empresa / editar_empresa / ver_requisitos / editar_requisitos) más «Ver Facturación» — nunca el rol ni «Editar factura borrador».
 * Sin permiso: 403 aunque la pestaña no se muestre (la UI no es la protección).
 */
export async function requireFacturacionConfig(slug: string, accion: AccionConfigFacturacion) {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;
  await asegurarSchemaClientes();
  await asegurarSchemaFacturacion();
  await asegurarModulosClientesFacturacion(tenant.empresa.id);
  return requireTenantFacturacion(slug, accion);
}
