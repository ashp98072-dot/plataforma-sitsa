import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { permisosEfectivos, tienePermiso, type AccionPermiso } from "@/lib/permisos";
import { modulosPorRol } from "@/lib/roles";
import { getSession, type SessionPayload } from "@/lib/session";
import { empresasParaUsuario, obtenerEmpresaPorSlug, type Empresa } from "@/lib/empresas";

/**
 * RRHH-REQUERIMIENTOS-PROVEEDORES-1 — guards PROPIOS de RRHH: "rrhh_requerimientos"/"rrhh_requerimientos_autorizar"/
 * "rrhh_proveedores" son permisos independientes de compras_requerimientos/compras_proveedores/compras_autorizar
 * (nunca se importa lógica de permisos de Compras aquí). Ningún rol los trae por defecto (ver PLATAFORMA_PERMISIBLES
 * en permisos-shared.ts) — se asignan explícitamente desde la matriz de Usuarios, igual que compras_autorizar/
 * cotizaciones_costeo. Requiere el módulo "rrhh" habilitado en la empresa (no "tms").
 */
type AmbitoRrhhReq = "rrhh_proveedores" | "rrhh_requerimientos" | "rrhh_requerimientos_autorizar";

async function validarAcceso(guard: { empresa: Empresa; session: SessionPayload }, accion: AccionPermiso, ambito: AmbitoRrhhReq) {
  const { session, empresa } = guard;
  const modulos = empresa.modulos.length ? empresa.modulos : modulosPorRol(session.rol);
  if (!modulos.includes("rrhh")) {
    return { error: NextResponse.json({ error: "Esta empresa no tiene el módulo RRHH." }, { status: 403 }) };
  }
  // Admin no tiene un bypass especial aquí (a propósito, mismo patrón que Compras): permisosEfectivos() ya le
  // devuelve el catálogo completo por rol, así que también satisface tienePermiso() más abajo y en la UI.
  const permisos = await permisosEfectivos(session.id, session.rol);
  if (!tienePermiso(permisos, ambito, accion)) {
    const etiqueta = ambito === "rrhh_proveedores" ? "proveedores de RRHH" : ambito === "rrhh_requerimientos_autorizar" ? "autorizar/rechazar requerimientos de RRHH" : "requerimientos de RRHH";
    return { error: NextResponse.json({ error: `Sin permiso para ${accion} ${etiqueta}.` }, { status: 403 }) };
  }
  return { session, empresa, permisos, error: undefined };
}

export async function requireRrhhProveedores(slug: string, accion: AccionPermiso = "ver") {
  const guard = await requireTenant(slug);
  if (guard.error) return guard;
  return validarAcceso(guard, accion, "rrhh_proveedores");
}

export async function requireRrhhRequerimientos(slug: string, accion: AccionPermiso = "ver") {
  const guard = await requireTenant(slug);
  if (guard.error) return guard;
  return validarAcceso(guard, accion, "rrhh_requerimientos");
}

/**
 * AJUSTE PR #372 (punto 2) — autorizar/rechazar exige EXCLUSIVAMENTE "rrhh_requerimientos_autorizar:editar", permiso
 * propio, independiente de "rrhh_requerimientos" (mismo patrón exacto que compras_autorizar/gastos_autorizar/
 * viaticos_autorizar). SIN fallback a rrhh_requerimientos:editar: alguien con permiso para editar datos del
 * requerimiento pero sin este permiso NO puede autorizar/rechazar, y viceversa.
 */
export async function requireRrhhRequerimientosAutorizar(slug: string) {
  const guard = await requireTenant(slug);
  if (guard.error) return guard;
  return validarAcceso(guard, "editar", "rrhh_requerimientos_autorizar");
}

/** Server Components: valida acceso sin intentar escribir cookies (mismo patrón que obtenerAccesoComprasPagina). */
export async function obtenerAccesoRrhhReqPagina(slug: string, ambito: AmbitoRrhhReq, accion: AccionPermiso = "ver") {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  const [empresa, permitidas] = await Promise.all([
    obtenerEmpresaPorSlug(slug),
    empresasParaUsuario({ usuarioId: session.id, rol: session.rol, accesoTodas: Boolean(session.accesoTodas) }),
  ]);
  if (!empresa || !empresa.activa || !permitidas.some(e => e.id === empresa.id)) {
    return { error: NextResponse.json({ error: "Sin acceso a esta empresa." }, { status: 403 }) };
  }
  return validarAcceso({ session, empresa }, accion, ambito);
}
