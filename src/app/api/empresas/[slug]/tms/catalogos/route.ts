import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;
  const eid = guard.empresa.id;
  const [clientes, lugares, unidades, personal] = await Promise.all([
    query<RowDataPacket[]>(
      "SELECT id, nombre, nit, telefono, estado FROM tms_clientes WHERE empresa_id = ? ORDER BY nombre",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, nombre, tipo, direccion FROM tms_lugares WHERE empresa_id = ? ORDER BY nombre",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, placa, tipo, marca, modelo, estado FROM tms_unidades WHERE empresa_id = ? ORDER BY placa",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, codigo, nombre, tipo, telefono, estado FROM tms_personal WHERE empresa_id = ? ORDER BY nombre",
      [eid],
    ),
  ]);
  return NextResponse.json({ clientes, lugares, unidades, personal });
}

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cliente"),
    nombre: z.string().min(1),
    nit: z.string().optional(),
    telefono: z.string().optional(),
  }),
  z.object({
    kind: z.literal("lugar"),
    nombre: z.string().min(1),
    tipo: z.enum(["Carga", "Descarga"]).default("Carga"),
    direccion: z.string().optional(),
  }),
  z.object({
    kind: z.literal("unidad"),
    placa: z.string().min(1),
    tipo: z.string().default("Camion"),
    marca: z.string().optional(),
    modelo: z.string().optional(),
  }),
  z.object({
    kind: z.literal("personal"),
    nombre: z.string().min(1),
    tipo: z.enum(["Piloto", "Auxiliar"]).default("Piloto"),
    telefono: z.string().optional(),
    codigo: z.string().optional(),
  }),
]);

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const eid = guard.empresa.id;

  if (d.kind === "cliente") {
    const r = await execute(
      "INSERT INTO tms_clientes (empresa_id, nombre, nit, telefono) VALUES (?, ?, ?, ?)",
      [eid, d.nombre, d.nit ?? null, d.telefono ?? null],
    );
    return NextResponse.json({ id: r.insertId, mensaje: "Cliente creado." });
  }
  if (d.kind === "lugar") {
    const r = await execute(
      "INSERT INTO tms_lugares (empresa_id, nombre, tipo, direccion) VALUES (?, ?, ?, ?)",
      [eid, d.nombre, d.tipo, d.direccion ?? null],
    );
    return NextResponse.json({ id: r.insertId, mensaje: "Lugar creado." });
  }
  if (d.kind === "unidad") {
    const r = await execute(
      "INSERT INTO tms_unidades (empresa_id, placa, tipo, marca, modelo) VALUES (?, ?, ?, ?, ?)",
      [eid, d.placa, d.tipo, d.marca ?? null, d.modelo ?? null],
    );
    return NextResponse.json({ id: r.insertId, mensaje: "Unidad creada." });
  }
  const r = await execute(
    "INSERT INTO tms_personal (empresa_id, codigo, nombre, tipo, telefono) VALUES (?, ?, ?, ?, ?)",
    [eid, d.codigo ?? null, d.nombre, d.tipo, d.telefono ?? null],
  );
  return NextResponse.json({ id: r.insertId, mensaje: "Personal creado." });
}
