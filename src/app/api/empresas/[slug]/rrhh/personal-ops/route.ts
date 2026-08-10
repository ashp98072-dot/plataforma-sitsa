import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import {
  esRrhhSubmodulo,
  permisosEfectivos,
  tienePermiso,
} from "@/lib/permisos";
import { modulosPorRol, type RolGlobal } from "@/lib/roles";
import { requireTenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

/** Empleados operativos desde RRHH para TMS (pilotos / auxiliares). */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  // Un solo requireTenant (antes se hacía 2× si TMS fallaba y caía a RRHH).
  const guard = await requireTenant(slug);
  if (guard.error) return guard.error;

  const { session, empresa } = guard;
  if (session.rol !== "Admin") {
    const empresaMods = empresa.modulos.length
      ? empresa.modulos
      : modulosPorRol(session.rol);
    const perms = await permisosEfectivos(
      session.id,
      session.rol as RolGlobal,
    );
    const rolMods = modulosPorRol(session.rol);
    const canTms =
      (empresaMods.includes("tms") || rolMods.includes("tms")) &&
      (perms.length === 0
        ? rolMods.includes("tms")
        : tienePermiso(perms, "tms", "ver"));
    const canRrhh =
      (empresaMods.includes("rrhh") || rolMods.includes("rrhh")) &&
      (perms.length === 0
        ? rolMods.includes("rrhh")
        : tienePermiso(perms, "rrhh", "ver") ||
          perms.some(
            (p) => esRrhhSubmodulo(p.modulo) && tienePermiso(perms, p.modulo, "ver"),
          ));
    if (!canTms && !canRrhh) {
      return NextResponse.json(
        { error: "Sin permiso de módulo." },
        { status: 403 },
      );
    }
  }

  const tipo = (new URL(req.url).searchParams.get("tipo") ?? "all").trim();

  try {
    let rows: RowDataPacket[];
    if (tipo === "Piloto" || tipo === "Auxiliar") {
      const like =
        tipo === "Auxiliar" ? "%auxiliar%" : "%piloto%";
      rows = await query<RowDataPacket[]>(
        `SELECT id, codigo, nombre, puesto, categoria_ops, estado
         FROM empleados
         WHERE empresa_id = ? AND estado = 'Activo'
           AND (
             categoria_ops = ?
             OR LOWER(COALESCE(puesto, '')) LIKE ?
             OR LOWER(COALESCE(categoria_ops, '')) LIKE ?
           )
         ORDER BY nombre`,
        [guard.empresa.id, tipo, like, like],
      );
      if (rows.length === 0) {
        rows = await query<RowDataPacket[]>(
          `SELECT id, codigo, nombre, puesto, categoria_ops, estado
           FROM empleados
           WHERE empresa_id = ? AND estado = 'Activo'
           ORDER BY nombre`,
          [guard.empresa.id],
        );
      }
    } else {
      rows = await query<RowDataPacket[]>(
        `SELECT id, codigo, nombre, puesto, categoria_ops, estado
         FROM empleados
         WHERE empresa_id = ? AND estado = 'Activo'
         ORDER BY nombre`,
        [guard.empresa.id],
      );
    }

    return NextResponse.json({
      personal: rows.map((r) => ({
        id: Number(r.id),
        codigo: String(r.codigo),
        nombre: String(r.nombre),
        puesto: r.puesto ? String(r.puesto) : "",
        categoriaOps: r.categoria_ops ? String(r.categoria_ops) : "",
        estado: String(r.estado),
      })),
    });
  } catch {
    // Sin migrate: listar por puesto o todos los activos
    const rows = await query<RowDataPacket[]>(
      `SELECT id, codigo, nombre, puesto, estado
       FROM empleados
       WHERE empresa_id = ? AND estado = 'Activo'
       ORDER BY nombre`,
      [guard.empresa.id],
    );
    return NextResponse.json({
      personal: rows.map((r) => ({
        id: Number(r.id),
        codigo: String(r.codigo),
        nombre: String(r.nombre),
        puesto: r.puesto ? String(r.puesto) : "",
        categoriaOps: "",
        estado: String(r.estado),
      })),
      aviso: "Importa sql/migrate-2026-08-rrhh-ops.sql para categoría operativa.",
    });
  }
}
