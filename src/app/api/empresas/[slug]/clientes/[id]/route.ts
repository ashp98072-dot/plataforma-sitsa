import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import {
  actualizarCliente,
  obtenerCliente,
} from "@/lib/clientes/repository";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes");
  if (guard.error) return guard.error;
  const cliente = await obtenerCliente(guard.empresa.id, Number(id));
  if (!cliente) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
  }
  return NextResponse.json({ cliente });
}

const schema = z.object({
  codigo: z.string().optional().nullable(),
  nombre: z.string().min(1),
  razonSocial: z.string().optional().nullable(),
  nit: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  contactoNombre: z.string().optional().nullable(),
  contactoTelefono: z.string().optional().nullable(),
  tipo: z
    .enum(["transporte", "reciclaje", "tarimas", "comercial", "mixto", "otro"])
    .optional(),
  estado: z.enum(["Activo", "Inactivo"]).optional(),
  notas: z.string().optional().nullable(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes", true);
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const cliente = await actualizarCliente(
    guard.empresa.id,
    Number(id),
    parsed.data,
  );
  if (!cliente) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
  }
  return NextResponse.json({ mensaje: "Cliente actualizado.", cliente });
}
