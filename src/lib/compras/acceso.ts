import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { permisosEfectivos, tienePermiso, type AccionPermiso } from "@/lib/permisos";
import { modulosPorRol } from "@/lib/roles";
import { getSession, type SessionPayload } from "@/lib/session";
import { empresasParaUsuario, obtenerEmpresaPorSlug, type Empresa } from "@/lib/empresas";

type AmbitoCompras = "compras_proveedores" | "compras_requerimientos" | "compras";
async function validarAcceso(guard: { empresa: Empresa; session: SessionPayload }, accion: AccionPermiso, ambito: AmbitoCompras = "compras_proveedores") {
  const modulos = guard.empresa.modulos.length ? guard.empresa.modulos : modulosPorRol(guard.session.rol);
  const permisos = await permisosEfectivos(guard.session.id, guard.session.rol);
  const permitido = ambito === "compras" ? tienePermiso(permisos, "compras_proveedores", accion) || tienePermiso(permisos, "compras_requerimientos", accion) : tienePermiso(permisos, ambito, accion);
  if (!modulos.includes("tms") || !permitido) {
    return { error: NextResponse.json({ error: `Sin permiso para ${accion} ${ambito === "compras_proveedores" ? "proveedores comerciales" : "requerimientos de compra"}.` }, { status: 403 }) };
  }
  return { ...guard, permisos, error: undefined };
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
