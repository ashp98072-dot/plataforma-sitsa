import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-guard";
import { obtenerEmpresaPorId } from "@/lib/empresas";
import { listarCargasCombustibleBloqueantes } from "@/lib/admin/limpiar-combustible-preview";

/**
 * ADMIN-LIMPIAR-COMBUSTIBLE-PREVIEW — detalle SOLO LECTURA de las cargas
 * de combustible que hoy bloquean `pruebas_reinicio_completo` para una
 * empresa, para revisión manual. Nunca modifica nada; separado del GET
 * principal de /api/admin/limpiar-modulo (que ya trae los conteos) para
 * no cargar el detalle completo en cada carga automática del preview —
 * se pide solo cuando el administrador expande la sección en la UI.
 */
function requireAdmin() {
  return requireSession().then((guard) => {
    if (guard.error) return guard;
    if (guard.user.rol !== "Admin") {
      return {
        error: NextResponse.json(
          { error: "Solo el administrador puede ver este detalle." },
          { status: 403 },
        ),
      };
    }
    return guard;
  });
}

const getSchema = z.object({
  empresaId: z.coerce.number().int().positive(),
});

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const parsed = getSchema.safeParse({
    empresaId: url.searchParams.get("empresaId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Indica empresaId." }, { status: 400 });
  }

  const empresa = await obtenerEmpresaPorId(parsed.data.empresaId);
  if (!empresa) {
    return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  }

  const cargas = await listarCargasCombustibleBloqueantes(parsed.data.empresaId);
  return NextResponse.json({
    empresa: { id: empresa.id, codigo: empresa.codigo, nombre: empresa.nombre },
    cargas,
  });
}
