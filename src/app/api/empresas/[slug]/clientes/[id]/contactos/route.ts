import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { resolverTmsClienteId } from "@/lib/clientes/repository";
import { registrarAuditoria } from "@/lib/auditoria";
import { buscarPosiblesDuplicadosContacto, crearContactoCliente, listarContactosCliente } from "@/lib/tms/cliente-contactos";

type Ctx = { params: Promise<{ slug: string; id: string }> };
const schema = z.object({
  nombre: z.string().trim().min(1).max(160), cargo: z.string().trim().max(120).optional(),
  telefono: z.string().trim().max(80).optional(), email: z.string().trim().email().max(160).or(z.literal("")).optional(),
  observaciones: z.string().trim().max(300).optional(), forzar: z.boolean().optional(),
}).strict();

async function resolver(slug: string, id: string, editar: boolean) {
  const guard = await requireClientesOFacturacion(slug, "clientes", editar);
  if (guard.error) return { error: guard.error } as const;
  const clienteId = Number(id);
  if (!Number.isInteger(clienteId) || clienteId <= 0) return { error: NextResponse.json({ error: "Cliente inválido." }, { status: 400 }) } as const;
  const r = await resolverTmsClienteId(guard.empresa.id, clienteId);
  if (!r.ok) return { error: NextResponse.json({ error: r.mensaje }, { status: 404 }) } as const;
  return { guard, clienteId, resolucion: r } as const;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params; const r = await resolver(slug, id, false); if ("error" in r) return r.error;
  const contactos = await listarContactosCliente(r.guard.empresa.id, r.resolucion.tmsClienteId, { incluirInactivos: true });
  return NextResponse.json({ contactos }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params; const r = await resolver(slug, id, true); if ("error" in r) return r.error;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  if (!parsed.data.forzar) {
    const duplicados = await buscarPosiblesDuplicadosContacto(r.guard.empresa.id, r.resolucion.tmsClienteId, parsed.data);
    if (duplicados.length) return NextResponse.json({ error: `Ya existe un contacto similar: ${duplicados[0].nombre}.`, posibleDuplicado: true }, { status: 409 });
  }
  const contacto = await crearContactoCliente(r.guard.empresa.id, r.resolucion.tmsClienteId, parsed.data);
  await registrarAuditoria({ empresaId: r.guard.empresa.id, usuario: r.guard.session.username, accion: "crear_contacto_cliente", modulo: "clientes", detalle: `Contacto #${contacto.id} creado para cliente #${r.clienteId}.` });
  return NextResponse.json({ contacto, mensaje: "Contacto creado." }, { status: 201 });
}
