import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { listarVehiculosAccesibles } from "@/lib/flota/acceso";

type Ctx = { params: Promise<{ slug: string }> };

async function auxiliaresDelPlan(planId: number): Promise<string[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT per.nombre FROM tms_plan_auxiliares a
       INNER JOIN tms_personal per ON per.id = a.personal_id
       WHERE a.plan_id = ?
       ORDER BY a.orden, a.id`,
      [planId],
    );
    return rows.map((r) => String(r.nombre));
  } catch {
    return [];
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

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

  const planes = [];
  for (const r of rows) {
    const extras = await auxiliaresDelPlan(Number(r.id));
    const auxList =
      extras.length > 0
        ? extras
        : r.auxiliar
          ? [String(r.auxiliar)]
          : [];
    planes.push({
      ...r,
      auxiliares: auxList,
      auxiliar: auxList.join(", ") || null,
    });
  }

  // Placas de flota (propias + compartidas) para el formulario
  let placasFlota: string[] = [];
  try {
    const vehs = await listarVehiculosAccesibles(guard.empresa.id);
    placasFlota = vehs
      .filter((v) => Number(v.activo ?? 1) !== 0)
      .map((v) => String(v.placa));
  } catch {
    placasFlota = [];
  }

  return NextResponse.json({ planes, placasFlota });
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
  auxiliarNombres: z.array(z.string().min(2)).max(8).optional(),
  pilotoEmpleadoId: z.number().int().positive().optional(),
  auxiliarEmpleadoId: z.number().int().positive().optional(),
  auxiliarEmpleadoIds: z.array(z.number().int().positive()).max(8).optional(),
  lugarCarga: z.string().optional(),
  lugarDescarga: z.string().optional(),
});

async function personalDesdeEmpleado(
  empresaId: number,
  empleadoId: number | undefined,
  tipo: "Piloto" | "Auxiliar",
): Promise<number | null> {
  if (!empleadoId) return null;
  const emp = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre FROM empleados
     WHERE id = ? AND empresa_id = ? AND estado = 'Activo' LIMIT 1`,
    [empleadoId, empresaId],
  );
  if (!emp[0]) return null;
  const codigo = String(emp[0].codigo);
  const nombre = String(emp[0].nombre);
  const existing = await query<RowDataPacket[]>(
    `SELECT id FROM tms_personal
     WHERE empresa_id = ? AND codigo = ? AND tipo = ? LIMIT 1`,
    [empresaId, codigo, tipo],
  );
  if (existing[0]) return Number(existing[0].id);
  const r = await execute(
    `INSERT INTO tms_personal (empresa_id, codigo, nombre, tipo, estado)
     VALUES (?, ?, ?, ?, 'Activo')`,
    [empresaId, codigo, nombre, tipo],
  );
  return Number(r.insertId);
}

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

async function guardarAuxiliaresPlan(
  planId: number,
  personalIds: number[],
): Promise<void> {
  try {
    await execute("DELETE FROM tms_plan_auxiliares WHERE plan_id = ?", [planId]);
    let orden = 1;
    for (const pid of personalIds.slice(0, 8)) {
      await execute(
        `INSERT INTO tms_plan_auxiliares (plan_id, personal_id, orden)
         VALUES (?, ?, ?)`,
        [planId, pid, orden++],
      );
    }
  } catch {
    /* tabla aún no existe */
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const empresaId = guard.empresa.id;
  let clienteId: number | null = null;
  let unidadId: number | null = null;
  let pilotoId: number | null = null;

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
      [empresaId, d.placa.trim().toUpperCase()],
    );
    unidadId = Number(r.insertId);
  }
  pilotoId = await personalDesdeEmpleado(
    empresaId,
    d.pilotoEmpleadoId,
    "Piloto",
  );
  if (!pilotoId && d.pilotoNombre?.trim()) {
    const r = await execute(
      "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Piloto')",
      [empresaId, d.pilotoNombre.trim()],
    );
    pilotoId = Number(r.insertId);
  }

  const auxIdsRaw =
    d.auxiliarEmpleadoIds?.length
      ? d.auxiliarEmpleadoIds
      : d.auxiliarEmpleadoId
        ? [d.auxiliarEmpleadoId]
        : [];
  const auxPersonalIds: number[] = [];
  for (const eid of auxIdsRaw.slice(0, 8)) {
    const pid = await personalDesdeEmpleado(empresaId, eid, "Auxiliar");
    if (pid) auxPersonalIds.push(pid);
  }
  const nombresAux = [
    ...(d.auxiliarNombres ?? []),
    ...(d.auxiliarNombre?.trim() ? [d.auxiliarNombre.trim()] : []),
  ];
  for (const nom of nombresAux) {
    if (auxPersonalIds.length >= 8) break;
    const nombre = nom.trim();
    if (nombre.length < 2) continue;
    const existing = await query<RowDataPacket[]>(
      `SELECT id FROM tms_personal
       WHERE empresa_id = ? AND tipo = 'Auxiliar' AND LOWER(TRIM(nombre)) = LOWER(?)
       LIMIT 1`,
      [empresaId, nombre],
    );
    if (existing[0]) {
      auxPersonalIds.push(Number(existing[0].id));
      continue;
    }
    const r = await execute(
      "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Auxiliar')",
      [empresaId, nombre],
    );
    auxPersonalIds.push(Number(r.insertId));
  }
  const auxiliarId = auxPersonalIds[0] ?? null;

  const lugarCargaId = await upsertLugar(empresaId, d.lugarCarga, "Carga");
  const lugarDescargaId = await upsertLugar(
    empresaId,
    d.lugarDescarga,
    "Descarga",
  );

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
  const planId = Number(result.insertId);
  await guardarAuxiliaresPlan(planId, auxPersonalIds);

  return NextResponse.json({
    id: planId,
    mensaje: `Plan creado${
      auxPersonalIds.length > 1
        ? ` con ${auxPersonalIds.length} auxiliares`
        : ""
    }.`,
  });
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  pilotoNombre: z.string().optional(),
  auxiliarNombre: z.string().optional(),
  auxiliarEmpleadoIds: z.array(z.number().int().positive()).max(8).optional(),
  placa: z.string().optional(),
  estado: z
    .enum([
      "Programado",
      "En ruta",
      "Cargado",
      "Descargado",
      "Cerrado",
      "Cancelado",
    ])
    .optional(),
  notas: z.string().optional(),
  horaCarga: z.string().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

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
  if (d.auxiliarEmpleadoIds) {
    const ids: number[] = [];
    for (const eid of d.auxiliarEmpleadoIds.slice(0, 8)) {
      const pid = await personalDesdeEmpleado(empresaId, eid, "Auxiliar");
      if (pid) ids.push(pid);
    }
    auxiliarId = ids[0];
    await guardarAuxiliaresPlan(d.id, ids);
  } else if (d.auxiliarNombre?.trim()) {
    const r = await execute(
      "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Auxiliar')",
      [empresaId, d.auxiliarNombre.trim()],
    );
    auxiliarId = Number(r.insertId);
    await guardarAuxiliaresPlan(d.id, [auxiliarId]);
  }
  if (d.placa?.trim()) {
    const r = await execute(
      `INSERT INTO tms_unidades (empresa_id, placa, tipo)
       VALUES (?, ?, 'Camion')
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [empresaId, d.placa.trim().toUpperCase()],
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
