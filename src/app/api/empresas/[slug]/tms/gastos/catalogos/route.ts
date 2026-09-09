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
      "SELECT id, codigo, nombre, puesto FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre LIMIT 1000",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, placa, marca, modelo FROM flota_vehiculos WHERE empresa_id = ? AND activo = 1 ORDER BY placa LIMIT 1000",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, codigo, nombre, nit FROM tms_clientes WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre LIMIT 1000",
      [eid],
    ),
    query<RowDataPacket[]>(
      `SELECT p.id, p.codigo, p.cliente_id, c.nombre AS cliente_nombre, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan
       FROM tms_planes_viaje p
       LEFT JOIN tms_clientes c ON c.id = p.cliente_id AND c.empresa_id = p.empresa_id
       WHERE p.empresa_id = ? ORDER BY p.id DESC LIMIT 500`,
      [eid],
    ),
    // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§3) — usuarios reales con acceso
    // a esta empresa (usuario_empresa o acceso_todas_empresas), para el
    // selector opcional "Requirente (usuario)" — solo un usuario real
    // puede tener firma en "Mi firma" (usuario_firmas está keyed por
    // usuario_id, NUNCA por empleado_id, ver src/lib/firmas/usuario-firmas.ts),
    // mismo criterio inverso que empresasParaUsuario() en src/lib/empresas.ts.
    query<RowDataPacket[]>(
      `SELECT DISTINCT u.id, u.nombre, u.rol_global
       FROM usuarios u
       LEFT JOIN usuario_empresa ue ON ue.usuario_id = u.id AND ue.empresa_id = ?
       WHERE u.activo = 1 AND (ue.usuario_id IS NOT NULL OR u.acceso_todas_empresas = 1)
       ORDER BY u.nombre LIMIT 1000`,
      [eid],
    ),
  ]);

  return NextResponse.json(
    {
      empleados: empleados.map((r) => ({ id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre), puesto: r.puesto != null ? String(r.puesto) : null })),
      vehiculos: vehiculos.map((r) => ({ id: Number(r.id), placa: String(r.placa), marca: r.marca != null ? String(r.marca) : null, modelo: r.modelo != null ? String(r.modelo) : null })),
      clientes: clientes.map((r) => ({ id: Number(r.id), codigo: r.codigo != null ? String(r.codigo) : null, nombre: String(r.nombre), nit: r.nit != null ? String(r.nit) : null })),
      planes: planes.map((r) => ({ id: Number(r.id), codigo: String(r.codigo), clienteId: r.cliente_id != null ? Number(r.cliente_id) : null, clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null, fechaPlan: String(r.fecha_plan) })),
      usuarios: usuarios.map((r) => ({ id: Number(r.id), nombre: String(r.nombre) })),
      solicitantes: usuarios.filter((r) => ["Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones"].includes(String(r.rol_global ?? ""))).map((r) => ({ id: Number(r.id), nombre: String(r.nombre) })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
