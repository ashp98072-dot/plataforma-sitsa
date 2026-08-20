import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import {
  asegurarVinculosTmsClientes,
  crearClienteDesdeTms,
  listarClientes,
} from "@/lib/clientes/repository";
import {
  asegurarModulosClientesFacturacion,
  asegurarSchemaClientes,
} from "@/lib/clientes/schema";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;
  const eid = guard.empresa.id;
  // Puente ligero: mantiene tms_clientes (FK de planes) y alinea catálogo compartido.
  try {
    await asegurarSchemaClientes();
    await asegurarModulosClientesFacturacion(eid);
    await asegurarVinculosTmsClientes(eid);
  } catch {
    /* TMS sigue aunque clientes aún no esté migrado */
  }

  const [shared, tmsClientes, lugares, unidades, personal] = await Promise.all([
    listarClientes(eid).catch(() => []),
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
      "SELECT id, id_empleado, codigo, nombre, tipo, telefono, estado FROM tms_personal WHERE empresa_id = ? ORDER BY nombre",
      [eid],
    ),
  ]);

  // Preferir datos del módulo Clientes cuando hay vínculo TMS.
  const byTms = new Map(
    shared
      .filter((c) => c.tmsClienteId != null)
      .map((c) => [c.tmsClienteId!, c]),
  );
  const clientes = tmsClientes.map((t) => {
    const s = byTms.get(Number(t.id));
    return {
      id: Number(t.id),
      nombre: s?.nombre ?? String(t.nombre),
      nit: s?.nit ?? (t.nit != null ? String(t.nit) : null),
      telefono: s?.telefono ?? (t.telefono != null ? String(t.telefono) : null),
      estado: s?.estado ?? String(t.estado ?? "Activo"),
    };
  });

  return NextResponse.json(
    { clientes, lugares, unidades, personal },
    { headers: { "Cache-Control": "private, no-store" } },
  );
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
    idEmpleado: z.number().int().positive().optional(),
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
    try {
      const created = await crearClienteDesdeTms(eid, {
        nombre: d.nombre,
        nit: d.nit,
        telefono: d.telefono,
      });
      return NextResponse.json({
        id: created.tmsClienteId,
        clienteId: created.clienteId,
        mensaje: "Cliente creado.",
      });
    } catch {
      const r = await execute(
        "INSERT INTO tms_clientes (empresa_id, nombre, nit, telefono) VALUES (?, ?, ?, ?)",
        [eid, d.nombre, d.nit ?? null, d.telefono ?? null],
      );
      return NextResponse.json({ id: r.insertId, mensaje: "Cliente creado." });
    }
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
  let idEmpleadoValido: number | null = null;
  if (d.idEmpleado != null) {
    const emp = await query<RowDataPacket[]>(
      "SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1",
      [d.idEmpleado, eid],
    );
    if (!emp[0]) {
      return NextResponse.json(
        { error: "El empleado indicado no pertenece a esta empresa." },
        { status: 400 },
      );
    }
    idEmpleadoValido = d.idEmpleado;
  }
  const r = await execute(
    "INSERT INTO tms_personal (empresa_id, id_empleado, codigo, nombre, tipo, telefono) VALUES (?, ?, ?, ?, ?, ?)",
    [eid, idEmpleadoValido, d.codigo ?? null, d.nombre, d.tipo, d.telefono ?? null],
  );
  return NextResponse.json({ id: r.insertId, mensaje: "Personal creado." });
}