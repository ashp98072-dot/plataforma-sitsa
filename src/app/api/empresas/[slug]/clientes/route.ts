import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import {
  crearCliente,
  importarClientesDesdeTms,
  listarClientes,
} from "@/lib/clientes/repository";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const estado = url.searchParams.get("estado") ?? undefined;
  const clientes = await listarClientes(guard.empresa.id, { q, estado });
  return NextResponse.json(
    { clientes },
    { headers: { "Cache-Control": "private, no-store" } },
  );
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
  importarTms: z.boolean().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes", true);
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => ({}));
  if (body && typeof body === "object" && body.importarTms === true) {
    const r = await importarClientesDesdeTms(guard.empresa.id);
    return NextResponse.json({
      mensaje: `Importación TMS: ${r.importados} nuevos, ${r.existentes} ya estaban.`,
      ...r,
    });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { importarTms: _i, ...input } = parsed.data;
  const cliente = await crearCliente(guard.empresa.id, input);
  return NextResponse.json({ mensaje: "Cliente creado.", cliente });
}
