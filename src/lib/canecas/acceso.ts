import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { permisosEfectivos } from "@/lib/permisos";

export async function accesoCanecas(slug: string, accion: "ver" | "catalogo" | "compras" | "recepciones" | "confirmar" | "ventas", opciones: { soloLectura?: boolean } = {}) {
  const guard = await requireTenant(slug, opciones);
  if (guard.error) return guard;
  if (guard.session.rol === "Admin") return guard;
  const permisos = await permisosEfectivos(guard.session.id, guard.session.rol);
  const p = permisos.find(x => x.modulo === "canecas");
  if (!p?.puedeVer || (accion !== "ver" && !permisos.find(x => x.modulo === `canecas_${accion}`)?.puedeVer)) {
    return { error: NextResponse.json({ error: "Sin permiso para esta operación de Canecas." }, { status: 403 }) };
  }
  return guard;
}
