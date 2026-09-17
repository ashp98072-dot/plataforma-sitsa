import { NextResponse } from "next/server";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { codigoConceptoPrestacionSchema } from "@/lib/rrhh/prestaciones";
import { toIsoDate } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const actualizarSchema = z.object({
  empleadoId: z.number().int().positive(),
  tipo: z.string().trim().min(1).max(80),
  // RRHH-PRESTACIONES-CODIGO-CONCEPTO: opcional (`.optional()`, NUNCA
  // `.nullable()`) — si el campo VIENE debe ser uno de los códigos del
  // catálogo; si NO viene, la columna existente no se toca (COALESCE en el
  // UPDATE de abajo). Como el schema nunca acepta `null` como valor válido,
  // no existe forma de "borrar" un código ya asignado desde este endpoint —
  // solo se puede omitir el campo (no tocar) o reemplazarlo por otro código
  // válido. Un histórico con codigo_concepto = NULL sí puede recibir un
  // código explícito por primera vez enviando el campo.
  codigoConcepto: codigoConceptoPrestacionSchema.optional(),
  monto: z.number().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notas: z.string().max(4000).optional(),
});

const anularSchema = z.object({
  motivo: z.string().trim().min(3).max(500),
});

async function explicarBloqueo(empresaId: number, id: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT p.tipo,
            EXISTS (
              SELECT 1 FROM rrhh_planilla_periodos pp
              WHERE pp.empresa_id = p.empresa_id
                AND p.fecha BETWEEN pp.fecha_inicio AND pp.fecha_fin
                AND pp.estado IN ('Generada', 'Cerrada')
            ) AS en_planilla
     FROM rrhh_prestaciones p
     WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  if (!rows[0]) return "Prestación no encontrada.";
  if (String(rows[0].tipo).startsWith("Anulada · ")) {
    return "La prestación ya está anulada.";
  }
  if (Number(rows[0].en_planilla) === 1) {
    return "No puede modificarse porque su periodo de planilla ya fue generado o cerrado.";
  }
  return "No se pudo actualizar la prestación con los datos indicados.";
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id: idRaw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "prestaciones", "editar");
  if (guard.error) return guard.error;
  const id = Number(idRaw);
  const parsed = actualizarSchema.safeParse(await req.json());
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    // "Antes" — mismo empresa_id que el UPDATE de abajo (tenant-safe); FOR
    // UPDATE bloquea la fila para que la auditoría refleje exactamente lo
    // que el UPDATE va a pisar, sin carrera con otra edición concurrente.
    const [antesRows] = await conn.query<RowDataPacket[]>(
      `SELECT tipo, codigo_concepto, monto, fecha
       FROM rrhh_prestaciones WHERE id = ? AND empresa_id = ? FOR UPDATE`,
      [id, guard.empresa.id],
    );
    const antes = antesRows[0];
    const [result] = await conn.execute<ResultSetHeader>(
      `UPDATE rrhh_prestaciones p
       SET p.id_empleado = ?, p.tipo = ?,
           p.codigo_concepto = COALESCE(?, p.codigo_concepto),
           p.monto = ?, p.fecha = ?, p.notas = ?
       WHERE p.id = ? AND p.empresa_id = ?
         AND p.tipo NOT LIKE 'Anulada · %'
         AND EXISTS (
           SELECT 1 FROM empleados e
           WHERE e.id = ? AND e.empresa_id = p.empresa_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM rrhh_planilla_periodos pp
           WHERE pp.empresa_id = p.empresa_id
             AND p.fecha BETWEEN pp.fecha_inicio AND pp.fecha_fin
             AND pp.estado IN ('Generada', 'Cerrada')
         )
         AND NOT EXISTS (
           SELECT 1 FROM rrhh_planilla_periodos pp
           WHERE pp.empresa_id = p.empresa_id
             AND ? BETWEEN pp.fecha_inicio AND pp.fecha_fin
             AND pp.estado IN ('Generada', 'Cerrada')
         )`,
      [
        d.empleadoId,
        d.tipo,
        d.codigoConcepto ?? null,
        d.monto,
        d.fecha,
        d.notas?.trim() || null,
        id,
        guard.empresa.id,
        d.empleadoId,
        d.fecha,
      ],
    );
    if (!result.affectedRows) {
      await conn.rollback();
      return NextResponse.json(
        { error: await explicarBloqueo(guard.empresa.id, id) },
        { status: 409 },
      );
    }
    // Si el campo no vino, el código no cambió (COALESCE lo dejó igual) —
    // el "después" auditado es el mismo `antes.codigo_concepto`, no un
    // valor inventado.
    const codigoConceptoDespues = d.codigoConcepto ?? (antes ? (antes.codigo_concepto as string | null) : null);
    await registrarAuditoriaTx(conn, {
      empresaId: guard.empresa.id,
      usuario: guard.session.username,
      accion: "editar_prestacion_rrhh",
      modulo: "rrhh",
      detalle: JSON.stringify({
        prestacionId: id,
        antes: antes
          ? {
              tipo: antes.tipo,
              codigoConcepto: (antes.codigo_concepto as string | null) ?? null,
              monto: Number(antes.monto),
              fecha: toIsoDate(antes.fecha as string | Date),
            }
          : null,
        despues: { tipo: d.tipo, codigoConcepto: codigoConceptoDespues, monto: d.monto, fecha: d.fecha },
      }),
    });
    await conn.commit();
    return NextResponse.json({ mensaje: "Prestación actualizada." });
  } catch (e) {
    await conn.rollback();
    console.error("PATCH rrhh/prestaciones/[id]", e);
    return NextResponse.json({ error: "No se pudo actualizar la prestación." }, { status: 500 });
  } finally {
    conn.release();
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug, id: idRaw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "prestaciones", "eliminar");
  if (guard.error) return guard.error;
  const id = Number(idRaw);
  const parsed = anularSchema.safeParse(await req.json());
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    return NextResponse.json(
      { error: "Indica un motivo de anulación válido." },
      { status: 400 },
    );
  }
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    // codigo_concepto NUNCA entra en este UPDATE — la anulación solo toca
    // tipo/notas/monto (regla existente), el código fiscal permanece
    // estable aunque el label visible cambie a "Anulada · ...".
    const [antesRows] = await conn.query<RowDataPacket[]>(
      `SELECT codigo_concepto FROM rrhh_prestaciones WHERE id = ? AND empresa_id = ? FOR UPDATE`,
      [id, guard.empresa.id],
    );
    const codigoConcepto = (antesRows[0]?.codigo_concepto as string | null) ?? null;
    const [result] = await conn.execute<ResultSetHeader>(
      `UPDATE rrhh_prestaciones p
       SET p.notas = CONCAT(
             '[ANULADA por ', ?, ' el ', DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i'),
             '. Motivo: ', ?, '. Monto original: Q', FORMAT(p.monto, 2), '] ',
             COALESCE(p.notas, '')
           ),
           p.tipo = LEFT(CONCAT('Anulada · ', p.tipo), 80),
           p.monto = 0
       WHERE p.id = ? AND p.empresa_id = ?
         AND p.tipo NOT LIKE 'Anulada · %'
         AND NOT EXISTS (
           SELECT 1 FROM rrhh_planilla_periodos pp
           WHERE pp.empresa_id = p.empresa_id
             AND p.fecha BETWEEN pp.fecha_inicio AND pp.fecha_fin
             AND pp.estado IN ('Generada', 'Cerrada')
         )`,
      [guard.session.username, parsed.data.motivo, id, guard.empresa.id],
    );
    if (!result.affectedRows) {
      await conn.rollback();
      return NextResponse.json(
        { error: await explicarBloqueo(guard.empresa.id, id) },
        { status: 409 },
      );
    }
    await registrarAuditoriaTx(conn, {
      empresaId: guard.empresa.id,
      usuario: guard.session.username,
      accion: "anular_prestacion_rrhh",
      modulo: "rrhh",
      detalle: JSON.stringify({ prestacionId: id, codigoConcepto, motivo: parsed.data.motivo }),
    });
    await conn.commit();
    return NextResponse.json({ mensaje: "Prestación anulada y conservada en el historial." });
  } catch (e) {
    await conn.rollback();
    console.error("DELETE rrhh/prestaciones/[id]", e);
    return NextResponse.json({ error: "No se pudo anular la prestación." }, { status: 500 });
  } finally {
    conn.release();
  }
}
