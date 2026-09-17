import { NextResponse } from "next/server";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { codigoConceptoPrestacionSchema } from "@/lib/rrhh/prestaciones";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "prestaciones", "ver");
  if (guard.error) return guard.error;
  try {
    // `p.*` ya trae `codigo_concepto` (snake_case, histórico NULL incluido
    // sin romper nada); `codigoConcepto` es el alias camelCase explícito
    // que exige el contrato de esta API — mismo patrón que emp_codigo/
    // emp_nombre ya usados en esta misma consulta.
    const rows = await query<RowDataPacket[]>(
      `SELECT p.*, p.codigo_concepto AS codigoConcepto, e.codigo AS emp_codigo, e.nombre AS emp_nombre
       FROM rrhh_prestaciones p
       INNER JOIN empleados e
         ON e.id = p.id_empleado AND e.empresa_id = p.empresa_id
       WHERE p.empresa_id = ?
       ORDER BY p.fecha DESC LIMIT 300`,
      [guard.empresa.id],
    );
    return NextResponse.json({ prestaciones: rows });
  } catch {
    return NextResponse.json({
      prestaciones: [],
      aviso: "Importa sql/migrate-2026-08-rrhh-ops.sql en phpMyAdmin.",
    });
  }
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  tipo: z.string().min(1),
  // RRHH-PRESTACIONES-CODIGO-CONCEPTO: obligatorio para prestaciones NUEVAS
  // — la columna es nullable solo por compatibilidad con el histórico
  // previo a este PR, nunca para crear registros nuevos sin clasificar.
  // z.enum ya rechaza null, "" y cualquier valor fuera del catálogo.
  codigoConcepto: codigoConceptoPrestacionSchema,
  monto: z.number().nonnegative(),
  fecha: z.string().min(8),
  notas: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "prestaciones", "crear");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    // INSERT + auditoría en la misma transacción: si la auditoría falla,
    // no queda una prestación creada sin rastro.
    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO rrhh_prestaciones
        (empresa_id, id_empleado, tipo, codigo_concepto, monto, fecha, notas, creado_por)
       SELECT ?, e.id, ?, ?, ?, ?, ?, ?
       FROM empleados e
       WHERE e.id = ? AND e.empresa_id = ?
       LIMIT 1`,
      [
        guard.empresa.id,
        d.tipo,
        d.codigoConcepto,
        d.monto,
        d.fecha,
        d.notas ?? null,
        guard.session.username,
        d.empleadoId,
        guard.empresa.id,
      ],
    );
    if (!r.affectedRows) {
      await conn.rollback();
      return NextResponse.json(
        { error: "El empleado no pertenece a la empresa activa." },
        { status: 400 },
      );
    }
    await registrarAuditoriaTx(conn, {
      empresaId: guard.empresa.id,
      usuario: guard.session.username,
      accion: "crear_prestacion_rrhh",
      modulo: "rrhh",
      detalle: JSON.stringify({
        prestacionId: r.insertId,
        empleadoId: d.empleadoId,
        tipo: d.tipo,
        codigoConcepto: d.codigoConcepto,
        monto: d.monto,
        fecha: d.fecha,
      }),
    });
    await conn.commit();
    return NextResponse.json({ id: r.insertId, mensaje: "Prestación registrada." });
  } catch (e) {
    await conn.rollback();
    console.error("POST rrhh/prestaciones", e);
    return NextResponse.json(
      { error: "No se pudo registrar la prestación." },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}
