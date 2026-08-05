import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlota, requireTenantModulo } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { normalizarNombrePiloto } from "@/lib/flota/pilotos";
import { ahoraLocal } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  // Piloto puede ver los suyos pendientes; Ops/Admin ven todos
  const guard = await requireTenantFlota(slug, "flota_piloto", "ver");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT id, piloto_nombre, motivo, estado, solicitado_por, aprobado_por,
            creado_at, resuelto_at
     FROM flota_permisos_externos
     WHERE empresa_id = ?
     ORDER BY FIELD(estado,'pendiente','aprobado','rechazado'), creado_at DESC
     LIMIT 100`,
    [guard.empresa.id],
  );
  return NextResponse.json({ permisos: rows });
}

const crearSchema = z.object({
  pilotoNombre: z.string().min(2),
  motivo: z.string().min(5),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_piloto", "crear");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const parsed = crearSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Indica nombre del piloto y motivo (mín. 5 caracteres)." },
      { status: 400 },
    );
  }

  const nombre = parsed.data.pilotoNombre.trim();
  const norm = normalizarNombrePiloto(nombre);
  const ahora = ahoraLocal();

  const r = await execute(
    `INSERT INTO flota_permisos_externos
      (empresa_id, piloto_nombre, piloto_nombre_norm, motivo, estado, solicitado_por, creado_at)
     VALUES (?, ?, ?, ?, 'pendiente', ?, ?)`,
    [
      guard.empresa.id,
      nombre,
      norm,
      parsed.data.motivo.trim(),
      guard.session.username,
      ahora,
    ],
  );

  return NextResponse.json({
    id: r.insertId,
    mensaje: `Solicitud enviada a Operaciones para conductor externo: ${nombre}.`,
    estado: "pendiente",
  });
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  estado: z.enum(["aprobado", "rechazado"]),
});

/** Operaciones / Admin aprueban o rechazan. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ops = await requireTenantModulo(slug, "tms", true);
  const flota = ops.error
    ? await requireTenantFlota(slug, "flota_vehiculos", "editar")
    : null;
  const guard = !ops.error ? ops : flota!;
  if (guard.error) {
    return NextResponse.json(
      { error: "Solo Operaciones/Predios con edición puede autorizar." },
      { status: 403 },
    );
  }
  if (
    guard.session.rol !== "Admin" &&
    guard.session.rol !== "Operaciones" &&
    guard.session.rol !== "CoordinadorPredios"
  ) {
    return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  await execute(
    `UPDATE flota_permisos_externos
     SET estado = ?, aprobado_por = ?, resuelto_at = ?
     WHERE id = ? AND empresa_id = ? AND estado = 'pendiente'`,
    [
      parsed.data.estado,
      guard.session.username,
      ahoraLocal(),
      parsed.data.id,
      guard.empresa.id,
    ],
  );

  return NextResponse.json({
    mensaje:
      parsed.data.estado === "aprobado"
        ? "Conductor externo autorizado."
        : "Solicitud rechazada.",
  });
}
