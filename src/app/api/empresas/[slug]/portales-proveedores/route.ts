import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { execute, query } from "@/lib/db";
import { cifrarCredencial } from "@/lib/proveedores/credenciales";
import {
  puedeUsarPortalesProveedores,
  ROLES_PORTALES_PROVEEDORES,
} from "@/lib/proveedores/acceso";
import { labelRol } from "@/lib/permisos-shared";
import { requireTenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

const portalSchema = z.object({
  id: z.number().int().positive().optional(),
  proveedor: z.string().trim().min(1).max(160),
  nombrePortal: z.string().trim().min(1).max(160),
  url: z.string().trim().url().max(1000),
  usuarioPortal: z.string().trim().min(1).max(255),
  password: z.string().max(1000).optional(),
  asignadoUsuarioId: z.number().int().positive().optional(),
  notas: z.string().trim().max(1000).optional().nullable(),
  activo: z.boolean().optional(),
});

async function usuarioAsignable(usuarioId: number, empresaId: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT u.id
     FROM usuarios u
     WHERE u.id = ? AND u.activo = 1
       AND u.rol_global IN (?, ?, ?, ?, ?)
       AND (u.acceso_todas_empresas = 1 OR EXISTS (
         SELECT 1 FROM usuario_empresa ue
         WHERE ue.usuario_id = u.id AND ue.empresa_id = ?
       ))
     LIMIT 1`,
    [usuarioId, ...ROLES_PORTALES_PROVEEDORES, empresaId],
  );
  return Boolean(rows[0]);
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenant(slug);
  if (guard.error) return guard.error;
  if (!puedeUsarPortalesProveedores(guard.session.rol)) {
    return NextResponse.json({ error: "Sin acceso a portales de proveedores." }, { status: 403 });
  }

  const admin = guard.session.rol === "Admin";
  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, p.proveedor, p.nombre_portal, p.url, p.usuario_portal,
            p.asignado_usuario_id, p.notas, p.activo, p.creado_en,
            u.username AS asignado_username, u.nombre AS asignado_nombre
     FROM proveedor_portales p
     INNER JOIN usuarios u ON u.id = p.asignado_usuario_id
     WHERE p.empresa_id = ?${admin ? "" : " AND p.asignado_usuario_id = ?"}
     ORDER BY p.proveedor, p.nombre_portal`,
    admin
      ? [guard.empresa.id]
      : [guard.empresa.id, guard.session.id],
  );

  const usuariosAsignables = admin
    ? await query<RowDataPacket[]>(
        `SELECT u.id, u.username, u.nombre, u.rol_global
         FROM usuarios u
         WHERE u.activo = 1
           AND u.rol_global IN (?, ?, ?, ?, ?)
           AND (u.acceso_todas_empresas = 1 OR EXISTS (
             SELECT 1 FROM usuario_empresa ue
             WHERE ue.usuario_id = u.id AND ue.empresa_id = ?
           ))
         ORDER BY COALESCE(u.nombre, u.username), u.username`,
        [...ROLES_PORTALES_PROVEEDORES, guard.empresa.id],
      )
    : [];

  return NextResponse.json(
    {
      puedeAdministrar: admin,
      puedeCrear: true,
      usuarioActualId: guard.session.id,
      portales: rows.map((r) => ({
        id: Number(r.id),
        proveedor: String(r.proveedor),
        nombrePortal: String(r.nombre_portal),
        url: String(r.url),
        usuarioPortal: String(r.usuario_portal),
        asignadoUsuarioId: Number(r.asignado_usuario_id),
        asignadoUsername: String(r.asignado_username),
        asignadoNombre: r.asignado_nombre ? String(r.asignado_nombre) : null,
        notas: r.notas ? String(r.notas) : null,
        activo: Boolean(r.activo),
        tienePassword: true,
        creadoEn: String(r.creado_en),
      })),
      usuariosAsignables: usuariosAsignables.map((u) => ({
        id: Number(u.id),
        username: String(u.username),
        nombre: u.nombre ? String(u.nombre) : null,
        rol: labelRol(String(u.rol_global)),
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenant(slug);
  if (guard.error) return guard.error;
  if (!puedeUsarPortalesProveedores(guard.session.rol)) {
    return NextResponse.json({ error: "Sin acceso a portales de proveedores." }, { status: 403 });
  }

  const parsed = portalSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos del portal inválidos." }, { status: 400 });
  }
  const data = parsed.data;
  const admin = guard.session.rol === "Admin";
  const asignadoUsuarioId = admin ? data.asignadoUsuarioId : guard.session.id;
  if (!asignadoUsuarioId) {
    return NextResponse.json({ error: "Selecciona el usuario asignado." }, { status: 400 });
  }
  if (admin && !(await usuarioAsignable(asignadoUsuarioId, guard.empresa.id))) {
    return NextResponse.json({ error: "El usuario asignado no pertenece a esta empresa." }, { status: 400 });
  }

  if (data.id) {
    const existente = await query<RowDataPacket[]>(
      `SELECT id FROM proveedor_portales
       WHERE id = ? AND empresa_id = ?${admin ? "" : " AND asignado_usuario_id = ?"}
       LIMIT 1`,
      admin
        ? [data.id, guard.empresa.id]
        : [data.id, guard.empresa.id, guard.session.id],
    );
    if (!existente[0]) {
      return NextResponse.json({ error: "Portal no encontrado." }, { status: 404 });
    }
    const passwordSql = data.password
      ? ", password_cifrado = ?"
      : "";
    const params: (string | number | boolean | null)[] = [
      data.proveedor,
      data.nombrePortal,
      data.url,
      data.usuarioPortal,
      asignadoUsuarioId,
      data.notas ?? null,
      data.activo ?? true,
    ];
    if (data.password) params.push(cifrarCredencial(data.password));
    params.push(data.id, guard.empresa.id);
    if (!admin) params.push(guard.session.id);
    const actualizado = await execute(
      `UPDATE proveedor_portales
       SET proveedor = ?, nombre_portal = ?, url = ?, usuario_portal = ?,
           asignado_usuario_id = ?, notas = ?, activo = ?${passwordSql}
       WHERE id = ? AND empresa_id = ?${admin ? "" : " AND asignado_usuario_id = ?"}`,
      params,
    );
    if (!actualizado.affectedRows) {
      return NextResponse.json({ error: "Portal no encontrado o no asignado." }, { status: 404 });
    }
    return NextResponse.json({ mensaje: "Portal actualizado." });
  }

  if (!data.password) {
    return NextResponse.json({ error: "La contraseña es obligatoria al crear el portal." }, { status: 400 });
  }
  const result = await execute(
    `INSERT INTO proveedor_portales
      (empresa_id, proveedor, nombre_portal, url, usuario_portal,
       password_cifrado, asignado_usuario_id, notas, activo, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guard.empresa.id,
      data.proveedor,
      data.nombrePortal,
      data.url,
      data.usuarioPortal,
      cifrarCredencial(data.password),
      asignadoUsuarioId,
      data.notas ?? null,
      data.activo ?? true,
      guard.session.id,
    ],
  );
  return NextResponse.json({
    mensaje: "Portal guardado.",
    id: Number((result as ResultSetHeader).insertId),
  });
}
