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

  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, p.codigo, p.fecha_plan, p.hora_carga, p.estado, p.tipo_traslado, p.notas,
            c.nombre AS cliente, u.placa, pil.nombre AS piloto, aux.nombre AS auxiliar,
            (SELECT COUNT(*) FROM tms_evidencias ev WHERE ev.plan_id = p.id) AS evidencias
     FROM tms_planes_viaje p
     LEFT JOIN tms_clientes c ON c.id = p.cliente_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     LEFT JOIN tms_personal aux ON aux.id = p.auxiliar_id
     WHERE p.empresa_id = ?
     ORDER BY p.fecha_plan DESC, p.id DESC
     LIMIT 200`,
    [guard.empresa.id],
  );
  return NextResponse.json({ planes: rows });
}

const schema = z.object({
  codigo: z.string().min(1),
  fechaPlan: z.string().min(1),
  horaCarga: z.string().optional(),
  tipoTraslado: z.string().optional(),
  notas: z.string().optional(),
  clienteNombre: z.string().optional(),
  placa: z.string().optional(),
  pilotoNombre: z.string().optional(),
  auxiliarNombre: z.string().optional(),
  lugarCarga: z.string().optional(),
  lugarDescarga: z.string().optional(),
});

async function upsertLugar(
  empresaId: number,
  nombre: string | undefined,
  tipo: string,
): Promise<number | null> {
  if (!nombre?.trim()) return null;
  const existing = await query<RowDataPacket[]>(
    "SELECT id FROM tms_lugares WHERE empresa_id = ? AND nombre = ? LIMIT 1",
    [empresaId, nombre.trim()],
  );
  if (existing[0]) return Number(existing[0].id);
  const r = await execute(
    "INSERT INTO tms_lugares (empresa_id, nombre, tipo) VALUES (?, ?, ?)",
    [empresaId, nombre.trim(), tipo],
  );
  return Number(r.insertId);
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const empresaId = guard.empresa.id;
  let clienteId: number | null = null;
  let unidadId: number | null = null;
  let pilotoId: number | null = null;
  let auxiliarId: number | null = null;

  if (d.clienteNombre?.trim()) {
    const found = await query<RowDataPacket[]>(
      "SELECT id FROM tms_clientes WHERE empresa_id = ? AND nombre = ? LIMIT 1",
      [empresaId, d.clienteNombre.trim()],
    );
    if (found[0]) {
      clienteId = Number(found[0].id);
    } else {
      const r = await execute(
        "INSERT INTO tms_clientes (empresa_id, nombre) VALUES (?, ?)",
        [empresaId, d.clienteNombre.trim()],
      );
      clienteId = Number(r.insertId);
    }
  }
  if (d.placa?.trim()) {
    const r = await execute(
      `INSERT INTO tms_unidades (empresa_id, placa, tipo)
       VALUES (?, ?, 'Camion')
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [empresaId, d.placa.trim()],
    );
    unidadId = Number(r.insertId);
  }
  if (d.pilotoNombre?.trim()) {
    const r = await execute(
      "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Piloto')",
      [empresaId, d.pilotoNombre.trim()],
    );
    pilotoId = Number(r.insertId);
  }
  if (d.auxiliarNombre?.trim()) {
    const r = await execute(
      "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Auxiliar')",
      [empresaId, d.auxiliarNombre.trim()],
    );
    auxiliarId = Number(r.insertId);
  }

  const lugarCargaId = await upsertLugar(empresaId, d.lugarCarga, "Carga");
  const lugarDescargaId = await upsertLugar(empresaId, d.lugarDescarga, "Descarga");

  const result = await execute(
    `INSERT INTO tms_planes_viaje
      (empresa_id, codigo, cliente_id, lugar_carga_id, lugar_descarga_id, unidad_id, piloto_id, auxiliar_id, fecha_plan, hora_carga, tipo_traslado, notas, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Programado')`,
    [
      empresaId,
      d.codigo,
      clienteId,
      lugarCargaId,
      lugarDescargaId,
      unidadId,
      pilotoId,
      auxiliarId,
      d.fechaPlan,
      d.horaCarga ?? null,
      d.tipoTraslado ?? null,
      d.notas ?? null,
    ],
  );
  return NextResponse.json({ id: result.insertId, mensaje: "Plan creado." });
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  pilotoNombre: z.string().optional(),
  auxiliarNombre: z.string().optional(),
  placa: z.string().optional(),
  estado: z
    .enum(["Programado", "En ruta", "Cargado", "Descargado", "Cerrado", "Cancelado"])
    .optional(),
  notas: z.string().optional(),
  horaCarga: z.string().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const empresaId = guard.empresa.id;

  const plan = await query<RowDataPacket[]>(
    "SELECT id FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1",
    [d.id, empresaId],
  );
  if (!plan[0]) {
    return NextResponse.json({ error: "Plan no encontrado." }, { status: 404 });
  }

  let pilotoId: number | undefined;
  let auxiliarId: number | undefined;
  let unidadId: number | undefined;

  if (d.pilotoNombre?.trim()) {
    const r = await execute(
      "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Piloto')",
      [empresaId, d.pilotoNombre.trim()],
    );
    pilotoId = Number(r.insertId);
  }
  if (d.auxiliarNombre?.trim()) {
    const r = await execute(
      "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Auxiliar')",
      [empresaId, d.auxiliarNombre.trim()],
    );
    auxiliarId = Number(r.insertId);
  }
  if (d.placa?.trim()) {
    const r = await execute(
      `INSERT INTO tms_unidades (empresa_id, placa, tipo)
       VALUES (?, ?, 'Camion')
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [empresaId, d.placa.trim()],
    );
    unidadId = Number(r.insertId);
  }

  await execute(
    `UPDATE tms_planes_viaje SET
      piloto_id = COALESCE(?, piloto_id),
      auxiliar_id = COALESCE(?, auxiliar_id),
      unidad_id = COALESCE(?, unidad_id),
      estado = COALESCE(?, estado),
      notas = COALESCE(?, notas),
      hora_carga = COALESCE(?, hora_carga)
     WHERE id = ? AND empresa_id = ?`,
    [
      pilotoId ?? null,
      auxiliarId ?? null,
      unidadId ?? null,
      d.estado ?? null,
      d.notas ?? null,
      d.horaCarga ?? null,
      d.id,
      empresaId,
    ],
  );
  return NextResponse.json({ mensaje: "Plan actualizado." });
}
