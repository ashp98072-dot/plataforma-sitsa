import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantGastos } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Catálogos livianos para los formularios de Gastos/Fondos (empleado,
 * vehículo, cliente, viaje) — bajo el MISMO permiso que el resto del
 * módulo (requireTenantGastos), para no depender de permisos de otros
 * módulos (RRHH/Flota) que un usuario de Gastos podría no tener. Solo
 * lee id + etiqueta de cada catálogo existente — no duplica ninguna
 * tabla ni lógica de negocio.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const eid = guard.empresa.id;

  const [empleados, vehiculos, clientes, planes, usuarios] = await Promise.all([
    query<RowDataPacket[]>(
      "SELECT id, codigo, nombre, puesto FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, placa FROM flota_vehiculos WHERE empresa_id = ? AND activo = 1 ORDER BY placa",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, nombre FROM tms_clientes WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, codigo FROM tms_planes_viaje WHERE empresa_id = ? ORDER BY id DESC LIMIT 300",
      [eid],
    ),
    // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§3) — usuarios reales con acceso
    // a esta empresa (usuario_empresa o acceso_todas_empresas), para el
    // selector opcional "Requirente (usuario)" — solo un usuario real
    // puede tener firma en "Mi firma" (usuario_firmas está keyed por
    // usuario_id, NUNCA por empleado_id, ver src/lib/firmas/usuario-firmas.ts),
    // mismo criterio inverso que empresasParaUsuario() en src/lib/empresas.ts.
    query<RowDataPacket[]>(
      `SELECT DISTINCT u.id, u.nombre
       FROM usuarios u
       LEFT JOIN usuario_empresa ue ON ue.usuario_id = u.id AND ue.empresa_id = ?
       WHERE u.activo = 1 AND (ue.usuario_id IS NOT NULL OR u.acceso_todas_empresas = 1)
       ORDER BY u.nombre`,
      [eid],
    ),
  ]);

  return NextResponse.json(
    {
      empleados: empleados.map((r) => ({ id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre), puesto: r.puesto != null ? String(r.puesto) : null })),
      vehiculos: vehiculos.map((r) => ({ id: Number(r.id), placa: String(r.placa) })),
      clientes: clientes.map((r) => ({ id: Number(r.id), nombre: String(r.nombre) })),
      planes: planes.map((r) => ({ id: Number(r.id), codigo: String(r.codigo) })),
      usuarios: usuarios.map((r) => ({ id: Number(r.id), nombre: String(r.nombre) })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
