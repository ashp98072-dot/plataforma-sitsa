import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { permisosEfectivos, tienePermiso, type AccionPermiso } from "@/lib/permisos";
import { modulosPorRol } from "@/lib/roles";
import { getSession, type SessionPayload } from "@/lib/session";
import { empresasParaUsuario, obtenerEmpresaPorSlug, type Empresa } from "@/lib/empresas";

type AmbitoCompras = "compras_proveedores" | "compras_requerimientos" | "compras";
async function validarAcceso(guard: { empresa: Empresa; session: SessionPayload }, accion: AccionPermiso, ambito: AmbitoCompras = "compras_proveedores", catalogos = false) {
  const modulos = guard.empresa.modulos.length ? guard.empresa.modulos : modulosPorRol(guard.session.rol);
  const permisos = await permisosEfectivos(guard.session.id, guard.session.rol);
  const requerimientos = permisos.find(p => p.modulo === "compras_requerimientos");
  // Compras mantiene acciones independientes: el helper compartido infiere ver desde otras acciones.
  const acciones = { ver: "puedeVer", crear: "puedeCrear", editar: "puedeEditar", eliminar: "puedeEliminar" } as const;
  const permitido = ambito === "compras_requerimientos"
    ? catalogos ? Boolean(requerimientos?.puedeVer || requerimientos?.puedeCrear || requerimientos?.puedeEditar) : Boolean(requerimientos?.[acciones[accion]])
    : ambito === "compras" ? tienePermiso(permisos, "compras_proveedores", accion) || tienePermiso(permisos, "compras_requerimientos", accion) : tienePermiso(permisos, ambito, accion);
  if (!modulos.includes("tms") || !permitido) {
    return { error: NextResponse.json({ error: `Sin permiso para ${accion} ${ambito === "compras_proveedores" ? "proveedores comerciales" : "requerimientos de compra"}.` }, { status: 403 }) };
  }
  return { ...guard, permisos, error: undefined };
}

export async function requireComprasCatalogos(slug: string) {
  const guard = await requireTenant(slug);
  if (guard.error) return guard;
  return validarAcceso(guard, "ver", "compras_requerimientos", true);
}

export async function requireComprasRequerimientos(slug: string, accion: AccionPermiso = "ver") {
  const guard = await requireTenant(slug);
  if (guard.error) return guard;
  return validarAcceso(guard, accion, "compras_requerimientos");
}

export async function requireComprasProveedores(slug: string, accion: AccionPermiso = "ver") {
  const guard = await requireTenant(slug);
  if (guard.error) return guard;
  return validarAcceso(guard, accion);
}

/**
 * COMPRAS-FASE-4-AUTORIZACION — autorizar/rechazar un Requerimiento de
 * compra exige el permiso "compras_autorizar" propio, SIN fallback a
 * compras_requerimientos:editar, tms:editar ni compras_proveedores:editar.
 * Mismo patrón exacto que requireTenantGastosAutorizar/
 * requireTenantViaticosAutorizar (src/lib/tenant.ts): Admin pasa siempre
 * (no depende de que su fila usuario_modulo ya tenga sincronizado este
 * permiso nuevo — "Admin lo obtiene por catálogo global"), cualquier otro
 * rol necesita el permiso explícito en su matriz.
 */
export async function requireComprasAutorizar(slug: string, accion: AccionPermiso = "ver") {
  const guard = await requireTenant(slug);
  if (guard.error) return guard;
  const { session, empresa } = guard;
  if (session.rol === "Admin") return { session, empresa, permisos: [], error: undefined };
  const modulos = empresa.modulos.length ? empresa.modulos : modulosPorRol(session.rol);
  if (!modulos.includes("tms")) {
    return { error: NextResponse.json({ error: "Esta empresa no tiene el módulo TMS." }, { status: 403 }) };
  }
  const permisos = await permisosEfectivos(session.id, session.rol);
  if (!tienePermiso(permisos, "compras_autorizar", accion)) {
    return {
      error: NextResponse.json(
        { error: "Sin permiso para autorizar/rechazar requerimientos de compra." },
        { status: 403 },
      ),
    };
  }
  return { session, empresa, permisos, error: undefined };
}

/** Server Components: valida acceso sin intentar escribir cookies. */
export async function obtenerAccesoComprasPagina(slug: string, ambito: AmbitoCompras = "compras", accion: AccionPermiso = "ver") {
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
