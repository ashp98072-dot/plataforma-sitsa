import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { accesoCanecas } from "@/lib/canecas/acceso";
import { anularVenta, registrarVenta } from "@/lib/canecas/ventas";
import { registrarRedistribucion, reversarRedistribucion } from "@/lib/canecas/redistribucion";
import { historialVentas, reportePorProducto, reporteResumen, type FiltrosReporte } from "@/lib/canecas/reportes";
import { comprasPendientesDeMapeo, mapeosRealizados } from "@/lib/canecas/historico-proveedores";

/** Recursos comerciales de Canecas: ventas, reportes, Ajuste de canecas (redistribución) y proveedores históricos. */
export const RECURSOS_COMERCIALES_GET = new Set(["ventas", "reporte_resumen", "reporte_productos", "redistribuciones", "compras_historicas", "mapeos_proveedor"]);
export const RECURSOS_COMERCIALES_POST = new Set(["ventas", "anular_venta", "redistribuciones", "reversar_redistribucion"]);

type Ctx = { slug: string; recurso: string };
const id = z.coerce.number().int().positive().max(2147483647);
const texto = (n: number) => z.string().trim().min(1).max(n);
const clave = z.uuid();
const fecha = z.iso.date();
const esquemas = {
  ventas: z.object({ cliente_id: id, producto_id: id, ubicacion_id: id, fecha_venta: fecha, documento: texto(250), cantidad: id, precio_unitario: z.string().trim().min(1).max(14), clave_operacion: clave }).strict(),
  anular_venta: z.object({ venta_id: z.string().regex(/^[1-9][0-9]{0,18}$/), motivo: texto(500) }).strict(),
  redistribuciones: z.object({ compra_id: id, ubicacion_id: id, cantidad_final: id, motivo: texto(500), clave_operacion: clave }).strict(),
  reversar_redistribucion: z.object({ redistribucion_id: z.string().regex(/^[1-9][0-9]{0,18}$/), motivo: texto(500) }).strict(),
} as const;

/** Código interno -> [estado HTTP, mensaje para la persona usuaria]. */
const MENSAJES: Record<string, [number, string]> = {
  VENTA_INVALIDA: [400, "Revise cliente, producto, fecha, cantidad y precio: el precio debe ser mayor que Q0.00 con hasta dos decimales."],
  SALIDA_INVALIDA: [400, "Revise los datos de la operación."],
  ANULACION_INVALIDA: [400, "Indique la venta y el motivo."],
  REDISTRIBUCION_INVALIDA: [400, "Revise la compra, la ubicación, la cantidad final y el motivo."],
  REVERSO_INVALIDO: [400, "Indique el ajuste y el motivo."],
  FILTRO_INVALIDO: [400, "Revise las fechas (AAAA-MM-DD) y los filtros."],
  CLIENTE_INVALIDO: [409, "El cliente no existe, es de otra empresa o está inactivo."],
  REFERENCIA_INVALIDA: [409, "El producto o la ubicación no existe o está inactivo."],
  SALDO_NO_ENCONTRADO: [409, "No hay existencias de este producto en esa ubicación."],
  SALDO_INSUFICIENTE: [409, "No hay suficientes canecas disponibles para esta operación."],
  RESERVAS_PENDIENTES: [409, "Hay canecas reservadas: libere las reservas antes de vender o ajustar."],
  CAPAS_NO_CONCILIADAS: [409, "El inventario no concilia con sus capas de costo. Revise antes de continuar."],
  COSTO_PENDIENTE: [409, "Hay canecas sin costo conocido: no se puede calcular la utilidad. Registre su costo primero."],
  PRIORIDAD_INICIAL_PENDIENTE: [409, "Hay existencias iniciales sin fecha de ingreso conocida. Concílielas antes de vender."],
  CAPAS_INSUFICIENTES: [409, "No hay canecas disponibles para esta operación."],
  MONEDA_INCOMPATIBLE: [409, "Las existencias tienen costos en distinta moneda; no se puede calcular la operación."],
  CLAVE_REUTILIZADA: [409, "Esta operación ya se registró con otros datos."],
  ANULACION_YA_REGISTRADA: [409, "Esta venta ya fue anulada con otro motivo."],
  REVERSO_YA_REGISTRADO: [409, "Este ajuste ya fue revertido con otro motivo."],
  REDISTRIBUCION_CONSUMIDA: [409, "Ya se vendieron o ajustaron canecas de este ajuste: anule primero esas ventas."],
  TRAZABILIDAD_INVALIDA: [409, "No se puede restablecer el inventario original de esta operación."],
  SALDO_INVALIDO: [409, "El saldo resultante no es válido."],
  CONCILIACION_INVALIDA: [409, "El costo no concilia: la operación no se registró."],
  VENTA_NO_ENCONTRADA: [404, "Venta no encontrada."],
  COMPRA_NO_ENCONTRADA: [404, "Compra no encontrada."],
  REDISTRIBUCION_NO_ENCONTRADA: [404, "Ajuste no encontrado."],
};
function respuestaDeError(error: unknown) {
  const codigo = (error as { message?: string })?.message ?? "";
  const [estado, mensaje] = MENSAJES[codigo] ?? [500, "No se pudo completar la operación."];
  return NextResponse.json({ error: mensaje }, { status: estado });
}
const privado = { headers: { "Cache-Control": "private, no-store" } };

function leerFiltros(req: Request): FiltrosReporte {
  const p = new URL(req.url).searchParams, opcional = (k: string) => p.get(k) || undefined, numero = (k: string) => { const v = opcional(k); return v === undefined ? undefined : Number(v); };
  return { desde: opcional("desde"), hasta: opcional("hasta"), productoId: numero("producto_id"), clienteId: numero("cliente_id") };
}

export async function getComercial(req: Request, { slug, recurso }: Ctx) {
  const accion = recurso === "compras_historicas" || recurso === "mapeos_proveedor" ? "catalogo" : "ventas";
  const guard = await accesoCanecas(slug, accion);
  if (guard.error) return guard.error;
  const empresa = guard.empresa.id;
  try {
    if (recurso === "compras_historicas") return NextResponse.json({ datos: await comprasPendientesDeMapeo(getPool(), empresa) }, privado);
    if (recurso === "mapeos_proveedor") return NextResponse.json({ datos: await mapeosRealizados(getPool(), empresa) }, privado);
    const costos = !(await accesoCanecas(slug, "compras")).error; // costos y utilidad solo con permiso de costos
    if (recurso === "ventas") return NextResponse.json({ datos: await historialVentas(getPool(), empresa, leerFiltros(req), costos) }, privado);
    if (recurso === "reporte_resumen") return NextResponse.json({ datos: [await reporteResumen(getPool(), empresa, leerFiltros(req), costos)], costos }, privado);
    if (recurso === "reporte_productos") return NextResponse.json({ datos: await reportePorProducto(getPool(), empresa, leerFiltros(req), costos), costos }, privado);
    if (recurso === "redistribuciones") {
      const filas = await query<RowDataPacket[]>(`SELECT CAST(r.id AS CHAR) AS id,c.referencia AS compra,u.nombre AS ubicacion,r.cantidad_origen,r.cantidad_resultante,r.diferencia,
          ${costos ? "CONCAT('Q ',FORMAT(r.costo_total_centavos/100,2)) AS costo_total," : ""}r.motivo,IF(r.reversado_en IS NULL,'Vigente','Revertido') AS estado,us.username AS usuario,r.creado_en,ur.username AS revertido_por,r.reversado_en,r.motivo_reverso
        FROM canecas_redistribuciones r JOIN canecas_compras c ON c.empresa_id=r.empresa_id AND c.id=r.compra_id JOIN canecas_ubicaciones u ON u.empresa_id=r.empresa_id AND u.id=r.ubicacion_id
        JOIN usuarios us ON us.id=r.creado_por LEFT JOIN usuarios ur ON ur.id=r.reversado_por WHERE r.empresa_id=? ORDER BY r.id DESC LIMIT 200`, [empresa]);
      return NextResponse.json({ datos: filas }, privado);
    }
    return NextResponse.json({ error: "Recurso desconocido." }, { status: 404 });
  } catch (error) {
    if ((error as { message?: string })?.message === "FILTRO_INVALIDO") return respuestaDeError(error);
    return NextResponse.json({ error: "No se pudo consultar el módulo." }, { status: 500 });
  }
}

export async function postComercial(req: Request, { slug, recurso }: Ctx) {
  const guard = await accesoCanecas(slug, "ventas");
  if (guard.error) return guard.error;
  const esquema = esquemas[recurso as keyof typeof esquemas];
  if (!esquema) return NextResponse.json({ error: "Recurso desconocido." }, { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const parsed = esquema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Revise los campos del formulario." }, { status: 400 });
  const d = parsed.data as Record<string, string | number>;
  const empresa = guard.empresa.id, usuario = guard.session.id; // empresa y usuario salen siempre de la sesión
  try {
    if (recurso === "ventas") {
      const v = await registrarVenta(getPool(), empresa, usuario, { clienteId: Number(d.cliente_id), productoId: Number(d.producto_id), ubicacionId: Number(d.ubicacion_id), fechaVenta: String(d.fecha_venta), documento: String(d.documento), cantidad: Number(d.cantidad), precio: String(d.precio_unitario), claveOperacion: String(d.clave_operacion) });
      const costos = !(await accesoCanecas(slug, "compras")).error;
      const mensaje = costos ? `Venta registrada: ingreso ${v.total}, costo FIFO ${v.costo}, utilidad bruta ${v.utilidad}.` : `Venta registrada: ingreso ${v.total}.`;
      return NextResponse.json({ id: v.id, yaRegistrada: v.yaRegistrada, total: v.total, ...(costos ? { costo: v.costo, utilidad: v.utilidad } : {}), mensaje }, { status: v.yaRegistrada ? 200 : 201 });
    }
    if (recurso === "anular_venta") return NextResponse.json({ ...(await anularVenta(getPool(), empresa, usuario, String(d.venta_id), String(d.motivo))), mensaje: "Venta anulada: el inventario se restableció." });
    if (recurso === "redistribuciones") {
      const r = await registrarRedistribucion(getPool(), empresa, usuario, { compraId: Number(d.compra_id), ubicacionId: Number(d.ubicacion_id), cantidadResultante: Number(d.cantidad_final), documento: `Ajuste de canecas (compra ${d.compra_id})`, motivo: String(d.motivo), claveOperacion: String(d.clave_operacion) });
      return NextResponse.json({ id: r.id, yaRegistrada: r.yaRegistrada, mensaje: r.yaRegistrada ? "El ajuste ya estaba registrado." : "Ajuste de canecas registrado." }, { status: r.yaRegistrada ? 200 : 201 });
    }
    return NextResponse.json({ ...(await reversarRedistribucion(getPool(), empresa, usuario, String(d.redistribucion_id), String(d.motivo))), mensaje: "Ajuste revertido." });
  } catch (error) {
    const e = error as { code?: string };
    if (e.code === "ER_DUP_ENTRY") return NextResponse.json({ error: "Operación duplicada. Verifique el registro." }, { status: 409 });
    return respuestaDeError(error);
  }
}
