import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { permisosEfectivos, tienePermiso, type AccionPermiso } from "@/lib/permisos";
import { modulosPorRol } from "@/lib/roles";
import { getSession, type SessionPayload } from "@/lib/session";
import { empresasParaUsuario, obtenerEmpresaPorSlug, type Empresa } from "@/lib/empresas";

async function validarAcceso(guard: { empresa: Empresa; session: SessionPayload }, accion: AccionPermiso) {
  const modulos = guard.empresa.modulos.length ? guard.empresa.modulos : modulosPorRol(guard.session.rol);
  const permisos = await permisosEfectivos(guard.session.id, guard.session.rol);
  if (!modulos.includes("tms") || !tienePermiso(permisos, "compras_proveedores", accion)) {
    return { error: NextResponse.json({ error: `Sin permiso para ${accion} proveedores comerciales.` }, { status: 403 }) };
  }
  return { ...guard, permisos, error: undefined };
}

export async function requireComprasProveedores(slug: string, accion: AccionPermiso = "ver") {
  const guard = await requireTenant(slug);
  if (guard.error) return guard;
  return validarAcceso(guard, accion);
}

/** Server Components: valida acceso sin intentar escribir cookies. */
export async function obtenerAccesoComprasPagina(slug: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  const [empresa, permitidas] = await Promise.all([
    obtenerEmpresaPorSlug(slug),
    empresasParaUsuario({ usuarioId: session.id, rol: session.rol, accesoTodas: Boolean(session.accesoTodas) }),
  ]);
  if (!empresa || !empresa.activa || !permitidas.some(e => e.id === empresa.id)) {
    return { error: NextResponse.json({ error: "Sin acceso a esta empresa." }, { status: 403 }) };
  }
  return validarAcceso({ session, empresa }, "ver");
}
