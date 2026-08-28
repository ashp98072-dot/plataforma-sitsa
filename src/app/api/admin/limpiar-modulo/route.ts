import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-guard";
import { obtenerEmpresaPorId } from "@/lib/empresas";
import { MODULOS_LIMPIEZA } from "@/lib/admin/limpiar-modulo-shared";
import { LimpiezaBloqueada } from "@/lib/admin/limpiar-operaciones";
import {
  contarModuloEmpresa,
  limpiarModuloEmpresa,
  type ModuloLimpieza,
} from "@/lib/admin/limpiar-modulo";

function requireAdmin() {
  return requireSession().then((guard) => {
    if (guard.error) return guard;
    if (guard.user.rol !== "Admin") {
      return {
        error: NextResponse.json(
          { error: "Solo el administrador puede limpiar módulos." },
          { status: 403 },
        ),
      };
    }
    return guard;
  });
}

const getSchema = z.object({
  empresaId: z.coerce.number().int().positive(),
  modulo: z.enum(MODULOS_LIMPIEZA),
});

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const parsed = getSchema.safeParse({
    empresaId: url.searchParams.get("empresaId"),
    modulo: url.searchParams.get("modulo"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Indica empresaId y modulo." },
      { status: 400 },
    );
  }

  const empresa = await obtenerEmpresaPorId(parsed.data.empresaId);
  if (!empresa) {
    return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  }

  const conteos = await contarModuloEmpresa(
    parsed.data.empresaId,
    parsed.data.modulo,
  );
  return NextResponse.json({
    empresa: { id: empresa.id, codigo: empresa.codigo, nombre: empresa.nombre },
    modulo: parsed.data.modulo,
    conteos,
    confirmacionEsperada: `${empresa.codigo} LIMPIAR ${parsed.data.modulo.toUpperCase()}`,
  });
}

const postSchema = z.object({
  empresaId: z.number().int().positive(),
  modulo: z.enum(MODULOS_LIMPIEZA),
  confirmacion: z.string().min(3),
});

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const empresa = await obtenerEmpresaPorId(parsed.data.empresaId);
  if (!empresa) {
    return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  }

  const esperado = `${empresa.codigo} LIMPIAR ${parsed.data.modulo.toUpperCase()}`;
  if (parsed.data.confirmacion.trim().toUpperCase() !== esperado.toUpperCase()) {
    return NextResponse.json(
      {
        error: `Confirmación incorrecta. Escribe exactamente: ${esperado}`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await limpiarModuloEmpresa({
      empresaId: empresa.id,
      empresaCodigo: empresa.codigo,
      modulo: parsed.data.modulo as ModuloLimpieza,
      usuario: guard.user.username,
      usuarioId: guard.user.id,
    });
    return NextResponse.json({
      mensaje: `Módulo ${parsed.data.modulo} limpiado en ${empresa.codigo}.`,
      ...result,
    });
  } catch (err) {
    if (err instanceof LimpiezaBloqueada) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo limpiar el módulo. Revisa el log del servidor." },
      { status: 500 },
    );
  }
}
