import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";

type Ctx = {
  params: Promise<{ slug: string }>;
};

type UbicacionRow = RowDataPacket & {
  id: number;
  nombre: string;
  lat: string | number;
  lng: string | number;
  radio_m: number;
  activa: number;
  creado_en: Date | string;
};

/**
 * El helper query() del proyecto está tipado principalmente para SELECT
 * (RowDataPacket[]), pero MySQL devuelve estos campos para INSERT/UPDATE.
 *
 * Usamos este tipo local para no modificar todavía src/lib/db.ts.
 */
type MutationResult = {
  insertId: number;
  affectedRows: number;
};

const crearSchema = z.object({
  action: z.literal("crear"),
  nombre: z.string().trim().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radioM: z.number().int().min(30).max(5000),
});

const editarSchema = z.object({
  action: z.literal("editar"),
  id: z.number().int().positive(),
  nombre: z.string().trim().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radioM: z.number().int().min(30).max(5000),
});

const toggleSchema = z.object({
  action: z.literal("toggle"),
  id: z.number().int().positive(),
  activa: z.boolean(),
});

const schema = z.discriminatedUnion("action", [
  crearSchema,
  editarSchema,
  toggleSchema,
]);

/**
 * Lista las ubicaciones de marcaje de la empresa actual.
 *
 * El empresa_id nunca viene del navegador.
 * Se obtiene mediante requireTenantRrhh().
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;

  const guard = await requireTenantRrhh(
    slug,
    "configuracion",
    "ver",
  );

  if (guard.error) {
    return guard.error;
  }

  const rows = await query<UbicacionRow[]>(
    `SELECT
       id,
       nombre,
       lat,
       lng,
       radio_m,
       activa,
       creado_en
     FROM ubicaciones_marcaje
     WHERE empresa_id = ?
     ORDER BY activa DESC, nombre ASC, id ASC`,
    [guard.empresa.id],
  );

  return NextResponse.json({
    ubicaciones: rows.map((row) => ({
      id: Number(row.id),
      nombre: String(row.nombre),
      lat: Number(row.lat),
      lng: Number(row.lng),
      radioM: Number(row.radio_m),
      activa: Boolean(row.activa),
      creadoEn: row.creado_en,
    })),
  });
}

/**
 * Crear, editar o activar/desactivar ubicaciones.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;

  const guard = await requireTenantRrhh(
    slug,
    "configuracion",
    "editar",
  );

  if (guard.error) {
    return guard.error;
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "El cuerpo de la solicitud no es válido." },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos de ubicación inválidos." },
      { status: 400 },
    );
  }

  const data = parsed.data;

  /*
   * CREAR
   */
  if (data.action === "crear") {
    const result = (await query(
      `INSERT INTO ubicaciones_marcaje
         (
           empresa_id,
           nombre,
           lat,
           lng,
           radio_m,
           activa
         )
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        guard.empresa.id,
        data.nombre,
        data.lat,
        data.lng,
        data.radioM,
      ],
    )) as unknown as MutationResult;

    return NextResponse.json(
      {
        id: Number(result.insertId),
        mensaje: "Ubicación creada correctamente.",
      },
      { status: 201 },
    );
  }

  /*
   * EDITAR
   */
  if (data.action === "editar") {
    const result = (await query(
      `UPDATE ubicaciones_marcaje
       SET
         nombre = ?,
         lat = ?,
         lng = ?,
         radio_m = ?
       WHERE id = ?
         AND empresa_id = ?`,
      [
        data.nombre,
        data.lat,
        data.lng,
        data.radioM,
        data.id,
        guard.empresa.id,
      ],
    )) as unknown as MutationResult;

    if (Number(result.affectedRows) === 0) {
      return NextResponse.json(
        { error: "Ubicación no encontrada." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      mensaje: "Ubicación actualizada correctamente.",
    });
  }

  /*
   * ACTIVAR / DESACTIVAR
   */
  const result = (await query(
    `UPDATE ubicaciones_marcaje
     SET activa = ?
     WHERE id = ?
       AND empresa_id = ?`,
    [
      data.activa ? 1 : 0,
      data.id,
      guard.empresa.id,
    ],
  )) as unknown as MutationResult;

  if (Number(result.affectedRows) === 0) {
    return NextResponse.json(
      { error: "Ubicación no encontrada." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    mensaje: data.activa
      ? "Ubicación activada."
      : "Ubicación desactivada.",
  });
}