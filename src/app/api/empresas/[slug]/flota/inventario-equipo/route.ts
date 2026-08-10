import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query, type SqlParams, type SqlValue } from "@/lib/db";
import {
  asegurarInventarioEquipo,
  invalidarCatalogoInventario,
  listarCatalogos,
  listarEquipo,
  resumenDesdeItems,
} from "@/lib/flota/inventario-equipo";
import { requireTenantFlota } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_inventario", "ver");
  if (guard.error) return guard.error;

  await asegurarInventarioEquipo(guard.empresa.id);
  const sp = new URL(req.url).searchParams;
  const propiedad = sp.get("propiedad") ?? undefined;
  const q = sp.get("q") ?? undefined;

  // 2 queries en paralelo; el resumen se deriva de items (sin 3 queries extra).
  const [items, catalogos] = await Promise.all([
    listarEquipo(guard.empresa.id, { propiedad, q }),
    listarCatalogos(guard.empresa.id),
  ]);

  return NextResponse.json({
    items,
    categorias: catalogos.categorias,
    areas: catalogos.areas,
    resumen: resumenDesdeItems(items),
  });
}

const itemLoteSchema = z.object({
  codigo: z.string().max(80).optional().nullable(),
  nombre: z.string().min(1).max(200),
  categoriaId: z.number().int().positive().nullable().optional(),
  cantidad: z.number().int().min(0).default(1),
  unidad: z.string().max(40).default("Unidad"),
  marca: z.string().max(80).optional().nullable(),
  serie: z.string().max(120).optional().nullable(),
  estado: z.string().max(40).default("Activo"),
  notas: z.string().max(2000).optional().nullable(),
});

const schema = z.object({
  codigo: z.string().min(1).max(80),
  nombre: z.string().min(1).max(200),
  categoriaId: z.number().int().positive().nullable().optional(),
  propiedad: z.enum(["empresa", "empleado"]),
  areaId: z.number().int().positive().nullable().optional(),
  empleadoId: z.number().int().positive().nullable().optional(),
  empleadoNombre: z.string().max(200).optional().nullable(),
  cantidad: z.number().int().min(0).default(1),
  unidad: z.string().max(40).default("Unidad"),
  marca: z.string().max(80).optional().nullable(),
  serie: z.string().max(120).optional().nullable(),
  estado: z.string().max(40).default("Activo"),
  notas: z.string().max(2000).optional().nullable(),
});

/** Lote: un empleado + varias herramientas en una sola petición. */
const loteSchema = z.object({
  lote: z.literal(true),
  propiedad: z.literal("empleado"),
  empleadoId: z.number().int().positive(),
  items: z.array(itemLoteSchema).min(1).max(80),
});

async function resolverEmpleadoNombre(
  empresaId: number,
  empleadoId: number,
): Promise<string | null> {
  const emp = await query<RowDataPacket[]>(
    `SELECT id, nombre FROM empleados
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [empleadoId, empresaId],
  );
  return emp[0] ? String(emp[0].nombre) : null;
}

function codigoAuto(idx = 0): string {
  return `EQ-${Date.now().toString(36).toUpperCase()}${idx ? `-${idx}` : ""}`;
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_inventario", "crear");
  if (guard.error) return guard.error;

  await asegurarInventarioEquipo(guard.empresa.id);
  const body = await req.json().catch(() => null);

  // --- Lote por empleado ---
  if (body && typeof body === "object" && body.lote === true) {
    const parsed = loteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos de lote inválidos. Revisa empleado y herramientas." },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const empleadoNombre = await resolverEmpleadoNombre(
      guard.empresa.id,
      d.empleadoId,
    );
    if (!empleadoNombre) {
      return NextResponse.json(
        { error: "Empleado no encontrado en RRHH de esta empresa." },
        { status: 400 },
      );
    }

    let creados = 0;
    const errores: string[] = [];
    for (let i = 0; i < d.items.length; i++) {
      const it = d.items[i]!;
      const nombre = it.nombre.trim();
      if (!nombre) continue;
      const codigo = (it.codigo?.trim() || codigoAuto(i + 1)).slice(0, 80);
      try {
        await execute(
          `INSERT INTO flota_inv_equipo
            (empresa_id, codigo, nombre, categoria_id, propiedad, area_id,
             empleado_id, empleado_nombre, cantidad, unidad, marca, serie, estado, notas)
           VALUES (?, ?, ?, ?, 'empleado', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            guard.empresa.id,
            codigo,
            nombre,
            it.categoriaId ?? null,
            d.empleadoId,
            empleadoNombre,
            it.cantidad ?? 1,
            it.unidad || "Unidad",
            it.marca?.trim() || null,
            it.serie?.trim() || null,
            it.estado || "Activo",
            it.notas?.trim() || null,
          ],
        );
        creados += 1;
      } catch (err) {
        const code =
          typeof err === "object" && err && "code" in err
            ? String((err as { code?: string }).code)
            : "";
        errores.push(
          code === "ER_DUP_ENTRY"
            ? `${nombre}: código duplicado (${codigo})`
            : `${nombre}: no se pudo guardar`,
        );
      }
    }

    if (!creados && errores.length) {
      return NextResponse.json(
        { error: errores[0] ?? "No se pudo guardar el lote.", errores },
        { status: 400 },
      );
    }
    return NextResponse.json({
      mensaje: `Inventario de ${empleadoNombre}: ${creados} herramienta(s) agregada(s).`,
      creados,
      errores: errores.slice(0, 20),
    });
  }

  // --- Ítem único (empresa o empleado) ---
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  if (d.propiedad === "empresa" && !d.areaId) {
    return NextResponse.json(
      { error: "Indica el área donde está la herramienta de la empresa." },
      { status: 400 },
    );
  }
  if (d.propiedad === "empleado" && !d.empleadoId && !d.empleadoNombre?.trim()) {
    return NextResponse.json(
      { error: "Selecciona el empleado dueño de la herramienta propia." },
      { status: 400 },
    );
  }

  let empleadoNombre = d.empleadoNombre?.trim() || null;
  if (d.empleadoId) {
    empleadoNombre = await resolverEmpleadoNombre(
      guard.empresa.id,
      d.empleadoId,
    );
    if (!empleadoNombre) {
      return NextResponse.json(
        { error: "Empleado no encontrado en RRHH de esta empresa." },
        { status: 400 },
      );
    }
  }

  try {
    const result = await execute(
      `INSERT INTO flota_inv_equipo
        (empresa_id, codigo, nombre, categoria_id, propiedad, area_id,
         empleado_id, empleado_nombre, cantidad, unidad, marca, serie, estado, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        d.codigo.trim(),
        d.nombre.trim(),
        d.categoriaId ?? null,
        d.propiedad,
        d.propiedad === "empresa" ? (d.areaId ?? null) : null,
        d.propiedad === "empleado" ? (d.empleadoId ?? null) : null,
        d.propiedad === "empleado" ? empleadoNombre : null,
        d.cantidad,
        d.unidad || "Unidad",
        d.marca?.trim() || null,
        d.serie?.trim() || null,
        d.estado || "Activo",
        d.notas?.trim() || null,
      ],
    );
    return NextResponse.json({
      id: result.insertId,
      mensaje: "Equipo registrado.",
    });
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "Ya existe un ítem con ese código." },
        { status: 409 },
      );
    }
    console.error("flota inventario POST", err);
    return NextResponse.json(
      { error: "No se pudo guardar el equipo." },
      { status: 500 },
    );
  }
}

const patchSchema = schema.partial().extend({
  id: z.number().int().positive(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_inventario", "editar");
  if (guard.error) return guard.error;

  await asegurarInventarioEquipo(guard.empresa.id);
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const existing = await query<RowDataPacket[]>(
    `SELECT id, propiedad FROM flota_inv_equipo
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [d.id, guard.empresa.id],
  );
  if (!existing[0]) {
    return NextResponse.json({ error: "Ítem no encontrado." }, { status: 404 });
  }

  const propiedad = d.propiedad ?? String(existing[0].propiedad);
  let empleadoNombre = d.empleadoNombre?.trim() || null;
  if (d.empleadoId) {
    const emp = await query<RowDataPacket[]>(
      `SELECT id, nombre FROM empleados
       WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [d.empleadoId, guard.empresa.id],
    );
    if (!emp[0]) {
      return NextResponse.json(
        { error: "Empleado no encontrado en RRHH." },
        { status: 400 },
      );
    }
    empleadoNombre = String(emp[0].nombre);
  }

  const sets: string[] = [];
  const params: SqlParams = [];
  const set = (col: string, val: SqlValue) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };

  if (d.codigo != null) set("codigo", d.codigo.trim());
  if (d.nombre != null) set("nombre", d.nombre.trim());
  if (d.categoriaId !== undefined) set("categoria_id", d.categoriaId);
  if (d.propiedad != null) set("propiedad", d.propiedad);
  if (d.cantidad != null) set("cantidad", d.cantidad);
  if (d.unidad != null) set("unidad", d.unidad);
  if (d.marca !== undefined) set("marca", d.marca?.trim() || null);
  if (d.serie !== undefined) set("serie", d.serie?.trim() || null);
  if (d.estado != null) set("estado", d.estado);
  if (d.notas !== undefined) set("notas", d.notas?.trim() || null);

  if (propiedad === "empresa") {
    if (d.areaId !== undefined) set("area_id", d.areaId);
    if (d.propiedad === "empresa") {
      set("empleado_id", null);
      set("empleado_nombre", null);
    }
  } else {
    if (d.empleadoId !== undefined) set("empleado_id", d.empleadoId);
    if (empleadoNombre != null || d.empleadoId !== undefined) {
      set("empleado_nombre", empleadoNombre);
    }
    if (d.propiedad === "empleado") set("area_id", null);
  }

  if (!sets.length) {
    return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
  }

  params.push(d.id, guard.empresa.id);
  try {
    await execute(
      `UPDATE flota_inv_equipo SET ${sets.join(", ")}
       WHERE id = ? AND empresa_id = ?`,
      params,
    );
    return NextResponse.json({ ok: true, mensaje: "Equipo actualizado." });
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "Ya existe un ítem con ese código." },
        { status: 409 },
      );
    }
    console.error("flota inventario PATCH", err);
    return NextResponse.json(
      { error: "No se pudo actualizar." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_inventario", "eliminar");
  if (guard.error) return guard.error;

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) {
    return NextResponse.json({ error: "Falta id." }, { status: 400 });
  }
  await execute(
    "DELETE FROM flota_inv_equipo WHERE id = ? AND empresa_id = ?",
    [id, guard.empresa.id],
  );
  return NextResponse.json({ ok: true, mensaje: "Ítem eliminado." });
}
