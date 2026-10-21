/** Quién ve/edita cada parte de Facturación (configuración de la empresa / requisitos por cliente). */
export type AlcanceFacturacion = {
  verEmpresa: boolean;
  editarEmpresa: boolean;
  verClientes: boolean;
  editarClientes: boolean;
};

/**
 * EQUIVALENCIA LEGACY por rol — ya NO es la fuente de verdad.
 *
 * Antes de que Configuración empresa / Requisitos clientes fueran permisos asignables, el acceso salía solo del rol. Esta tabla se conserva
 * únicamente para no romper a los usuarios actuales: `adaptarPermisosLegacy` (permisos-catalogo.ts) la materializa como filas de permiso
 * (`facturacion_empresa`, `facturacion_clientes_requisitos`) cuando el usuario aún no tiene una fila explícita. A partir de ahí manda la matriz.
 * Archivo puro (sin `next/server`) para poder importarlo desde el catálogo, que también carga el cliente.
 *
 * Contabilidad → configuración de la empresa. Operaciones → requisitos por cliente. Admin → ambas. Visualizador → lectura de ambas.
 * Facturador → lectura de requisitos por cliente (contexto útil al facturar).
 */
export function alcanceFacturacionPorRol(rol: string): AlcanceFacturacion {
  if (rol === "Admin") return { verEmpresa: true, editarEmpresa: true, verClientes: true, editarClientes: true };
  if (rol === "Contabilidad") return { verEmpresa: true, editarEmpresa: true, verClientes: false, editarClientes: false };
  if (rol === "Operaciones") return { verEmpresa: false, editarEmpresa: false, verClientes: true, editarClientes: true };
  if (rol === "Visualizador") return { verEmpresa: true, editarEmpresa: false, verClientes: true, editarClientes: false };
  if (rol === "Facturador") return { verEmpresa: false, editarEmpresa: false, verClientes: true, editarClientes: false };
  return { verEmpresa: false, editarEmpresa: false, verClientes: false, editarClientes: false };
}
