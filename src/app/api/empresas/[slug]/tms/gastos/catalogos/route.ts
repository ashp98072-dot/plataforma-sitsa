import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query, type SqlParams } from "@/lib/db";
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

  const consultar = async (catalogo: string, sql: string, params: SqlParams) => {
    try {
      return await query<RowDataPacket[]>(sql, params);
    } catch (error) {
      console.error(`[tms/gastos/catalogos] Falló catálogo ${catalogo}`, error);
      throw new Error(`No se pudo cargar el catálogo de ${catalogo}.`);
    }
  };

  try {
    const [empleados, vehiculos, clientes, planes, usuarios] = await Promise.all([
    consultar("empleados",
      "SELECT id, codigo, nombre, puesto, cuenta_bancaria FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre LIMIT 1000",
      [eid],
    ),
    consultar("vehículos",
      "SELECT id, placa, marca, modelo FROM flota_vehiculos WHERE empresa_id = ? AND activo = 1 ORDER BY placa LIMIT 1000",
      [eid],
    ),
    consultar("clientes",
      "SELECT id, nombre, nit FROM tms_clientes WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre LIMIT 1000",
      [eid],
    ),
    consultar("planes",
      `SELECT p.id, p.codigo, p.cliente_id, c.nombre AS cliente_nombre, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
              u.flota_vehiculo_id AS vehiculo_id, fv.placa,
              pil.id_empleado AS empleado_id, e.nombre AS empleado_nombre,
              e.puesto AS empleado_puesto, e.cuenta_bancaria AS empleado_cuenta
       FROM tms_planes_viaje p
       LEFT JOIN tms_clientes c ON c.id = p.cliente_id AND c.empresa_id = p.empresa_id
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id AND u.empresa_id = p.empresa_id
       LEFT JOIN flota_vehiculos fv ON fv.id = u.flota_vehiculo_id AND fv.empresa_id = p.empresa_id
       LEFT JOIN tms_personal pil ON pil.id = p.piloto_id AND pil.empresa_id = p.empresa_id
       LEFT JOIN empleados e ON e.id = pil.id_empleado AND e.empresa_id = p.empresa_id
       WHERE p.empresa_id = ? ORDER BY p.id DESC LIMIT 500`,
      [eid],
    ),
    // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§3) — usuarios reales con acceso
    // a esta empresa (usuario_empresa o acceso_todas_empresas), para el
    // selector opcional "Requirente (usuario)" — solo un usuario real
    // puede tener firma en "Mi firma" (usuario_firmas está keyed por
    // usuario_id, NUNCA por empleado_id, ver src/lib/firmas/usuario-firmas.ts),
    // mismo criterio inverso que empresasParaUsuario() en src/lib/empresas.ts.
    consultar("usuarios",
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
      empleados: empleados.map((r) => ({ id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre), puesto: r.puesto != null ? String(r.puesto) : null, cuentaBancaria: r.cuenta_bancaria != null ? String(r.cuenta_bancaria) : null })),
      vehiculos: vehiculos.map((r) => ({ id: Number(r.id), placa: String(r.placa), marca: r.marca != null ? String(r.marca) : null, modelo: r.modelo != null ? String(r.modelo) : null })),
      clientes: clientes.map((r) => ({ id: Number(r.id), codigo: null, nombre: String(r.nombre), nit: r.nit != null ? String(r.nit) : null })),
      planes: planes.map((r) => ({
        id: Number(r.id), codigo: String(r.codigo),
        clienteId: r.cliente_id != null ? Number(r.cliente_id) : null,
        clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
        fechaPlan: String(r.fecha_plan),
        vehiculoId: r.vehiculo_id != null ? Number(r.vehiculo_id) : null,
        placa: r.placa != null ? String(r.placa) : null,
        empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
        empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : null,
        empleadoPuesto: r.empleado_puesto != null ? String(r.empleado_puesto) : null,
        empleadoCuenta: r.empleado_cuenta != null ? String(r.empleado_cuenta) : null,
      })),
      usuarios: usuarios.map((r) => ({ id: Number(r.id), nombre: String(r.nombre) })),
      solicitantes: usuarios.filter((r) => ["Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones"].includes(String(r.rol_global ?? ""))).map((r) => ({ id: Number(r.id), nombre: String(r.nombre) })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No se pudieron cargar los catálogos.";
    return NextResponse.json({ error: mensaje }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
