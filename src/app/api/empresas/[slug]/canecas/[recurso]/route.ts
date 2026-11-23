import { NextResponse } from "next/server";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { accesoCanecas } from "@/lib/canecas/acceso";
import { confirmarRecepcion } from "@/lib/canecas/confirmar";
import { registrarSalidaFifo, reversarSalidaFifo } from "@/lib/canecas/salidas-fifo";
import { guardarProveedor, ErrorProveedorDuplicado } from "@/lib/compras/proveedores";
import { valorarExistenciaInicial } from "@/lib/canecas/valoracion-inicial";
import { registrarGastoPosterior } from "@/lib/canecas/gasto-posterior";

type Ctx = { params: Promise<{ slug: string; recurso: string }> };
const texto = (n: number) => z.string().trim().min(1).max(n);
const id = z.coerce.number().int().positive().max(2147483647);
const clave = z.uuid();
const importe = z.string().trim().regex(/^(?:\d{1,12}(?:\.\d{1,2})?)?$/).optional().default("");
const moneda = z.string().trim().regex(/^(?:[A-Z]{3})?$/).optional().default("");
function centavos(valor: string): bigint | null {
  if (!valor) return null;
  const [entero, decimal = ""] = valor.split(".");
  return BigInt(entero) * BigInt("100") + BigInt(decimal.padEnd(2, "0"));
}
const schemas = {
  productos: z.object({ codigo: texto(80), nombre: texto(200), marca: z.string().trim().max(160), presentacion: texto(160), capacidad: z.coerce.number().min(0.001).max(999999999).multipleOf(0.001), unidad_capacidad: texto(40), unidad_inventario: z.literal("caneca"), precio_venta_referencia: importe, moneda: moneda }).strict(),
  ubicaciones: z.object({ nombre: texto(160) }).strict(),
  proveedores: z.object({ nombre_comercial: texto(200) }).strict(),
  compras: z.object({ proveedor_id: id, producto_id: id, cantidad: id, referencia: texto(250), clave_operacion: clave, precio_compra: importe, gastos_adquisicion: importe, moneda: moneda }).strict(),
  recepciones: z.object({ compra_id: id, ubicacion_id: id, recibido_por_empleado_id: id, cantidad: id, clave_operacion: clave }).strict(),
  confirmar: z.object({ id }).strict(),
  salidas: z.object({ producto_id: id, ubicacion_id: id, cantidad: id, documento: texto(250), clave_operacion: clave }).strict(),
  reversar_salida: z.object({ salida_id: z.string().regex(/^[1-9][0-9]{0,18}$/), motivo: texto(500) }).strict(),
  valoracion_inicial: z.object({ producto_id: id, ubicacion_id: id, cantidad: id, costo: importe.refine(x => x !== ''), moneda: moneda.refine(x => x !== ''), documento: texto(250), motivo: texto(500), clave_operacion: clave }).strict(),
  gastos_posteriores: z.object({ compra_id: id, importe: importe.refine(x => x !== ''), moneda: moneda.refine(x => x !== ''), fecha_documento: z.iso.date(), referencia: texto(250), motivo: texto(500), clave_operacion: clave }).strict(),
  precio_referencia: z.object({ producto_id: id, precio_venta_referencia: importe, moneda }).strict(),
};
const lecturas: Record<string, string> = {
  productos: "SELECT p.*, CASE WHEN p.precio_venta_referencia_centavos IS NULL THEN NULL ELSE CONCAT(p.precio_venta_referencia_moneda,' ',FORMAT(p.precio_venta_referencia_centavos/100,2)) END AS precio_referencia FROM canecas_productos p WHERE p.empresa_id=? ORDER BY p.nombre,p.id",
  ubicaciones: "SELECT * FROM canecas_ubicaciones WHERE empresa_id=? ORDER BY nombre,id",
  proveedores: "SELECT id,nombre_comercial FROM compras_proveedores WHERE empresa_id=? AND activo=1 ORDER BY nombre_comercial",
  empleados: "SELECT id,nombre FROM empleados WHERE empresa_id=? AND estado='Activo' ORDER BY nombre",
  compras: "SELECT c.*, CASE WHEN c.precio_unitario_centavos IS NULL THEN NULL ELSE CONCAT(c.moneda,' ',FORMAT(c.precio_unitario_centavos/100,2)) END AS precio_compra_visible, CASE WHEN c.gastos_centavos IS NULL THEN NULL ELSE CONCAT(c.moneda,' ',FORMAT(c.gastos_centavos/100,2)) END AS gastos_visible, p.nombre AS producto,pr.nombre_comercial AS proveedor FROM canecas_compras c JOIN canecas_productos p ON p.empresa_id=c.empresa_id AND p.id=c.producto_id JOIN compras_proveedores pr ON pr.empresa_id=c.empresa_id AND pr.id=c.proveedor_id WHERE c.empresa_id=? ORDER BY c.id DESC",
  recepciones: "SELECT r.*,c.referencia,p.nombre AS producto,u.nombre AS ubicacion,e.nombre AS recibido_por,us.username AS confirmado_usuario FROM canecas_recepciones r JOIN canecas_compras c ON c.empresa_id=r.empresa_id AND c.id=r.compra_id JOIN canecas_productos p ON p.empresa_id=c.empresa_id AND p.id=c.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=r.empresa_id AND u.id=r.ubicacion_id JOIN empleados e ON e.empresa_id=r.empresa_id AND e.id=r.recibido_por_empleado_id LEFT JOIN usuarios us ON us.id=r.confirmado_por WHERE r.empresa_id=? ORDER BY r.id DESC",
  valoracion_inicial: "SELECT v.id,p.nombre AS producto,u.nombre AS ubicacion,v.cantidad,v.moneda,CASE WHEN v.costo_unitario_centavos IS NULL THEN NULL ELSE FORMAT(v.costo_unitario_centavos/100,2) END AS costo,v.documento,v.motivo,us.username AS usuario,v.creado_en FROM canecas_valoraciones_iniciales v JOIN canecas_productos p ON p.empresa_id=v.empresa_id AND p.id=v.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=v.empresa_id AND u.id=v.ubicacion_id JOIN usuarios us ON us.id=v.creado_por WHERE v.empresa_id=? ORDER BY v.id DESC",
  gastos_posteriores: "SELECT g.id,c.referencia AS compra,g.moneda,FORMAT(g.importe_centavos/100,2) AS importe,DATE_FORMAT(g.fecha_documento,'%Y-%m-%d') AS fecha_documento,g.estado,g.referencia,g.motivo,us.username AS usuario,g.creado_en FROM canecas_gastos_posteriores g JOIN canecas_compras c ON c.empresa_id=g.empresa_id AND c.id=g.compra_id JOIN usuarios us ON us.id=g.creado_por WHERE g.empresa_id=? ORDER BY g.id DESC",
  inventario: "SELECT p.nombre,p.presentacion,u.nombre AS ubicacion,s.fisico,s.reservado,s.fisico-s.reservado AS disponible,s.fisico-COALESCE((SELECT SUM(c.cantidad_disponible) FROM canecas_capas_costo c WHERE c.empresa_id=s.empresa_id AND c.producto_id=s.producto_id AND c.ubicacion_id=s.ubicacion_id),0) AS sin_capa, COALESCE((SELECT SUM(c.cantidad_disponible) FROM canecas_capas_costo c WHERE c.empresa_id=s.empresa_id AND c.producto_id=s.producto_id AND c.ubicacion_id=s.ubicacion_id AND c.costo_unitario_centavos IS NULL),0) AS con_costo_pendiente FROM canecas_saldos s JOIN canecas_productos p ON p.empresa_id=s.empresa_id AND p.id=s.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=s.empresa_id AND u.id=s.ubicacion_id WHERE s.empresa_id=? ORDER BY p.nombre,u.nombre",
  valoracion_inventario: "SELECT p.nombre,p.presentacion,u.nombre AS ubicacion,c.moneda,SUM(c.cantidad_disponible) AS unidades,CAST(SUM(CAST(c.costo_unitario_centavos AS DECIMAL(38,0))*c.cantidad_disponible)/100 AS DECIMAL(38,2)) AS costo_conocido FROM canecas_capas_costo c JOIN canecas_productos p ON p.empresa_id=c.empresa_id AND p.id=c.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=c.empresa_id AND u.id=c.ubicacion_id WHERE c.empresa_id=? AND c.costo_unitario_centavos IS NOT NULL AND c.cantidad_disponible>0 GROUP BY c.empresa_id,c.producto_id,c.ubicacion_id,c.moneda,p.nombre,p.presentacion,u.nombre ORDER BY p.nombre,u.nombre,c.moneda",
  salidas: "SELECT CAST(s.id AS CHAR) AS id,p.nombre AS producto,u.nombre AS ubicacion,s.cantidad,s.documento,CAST(s.costo_centavos AS CHAR) AS costo_centavos,s.moneda,s.creado_en,s.reversado_en FROM canecas_salidas_fifo s JOIN canecas_productos p ON p.empresa_id=s.empresa_id AND p.id=s.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=s.empresa_id AND u.id=s.ubicacion_id WHERE s.empresa_id=? ORDER BY s.id DESC LIMIT 200",
  movimientos: "SELECT m.*,p.nombre AS producto,p.presentacion,u.nombre AS ubicacion,us.username AS usuario,e.nombre AS recibido_por FROM canecas_movimientos m JOIN canecas_productos p ON p.empresa_id=m.empresa_id AND p.id=m.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=m.empresa_id AND u.id=m.ubicacion_id JOIN usuarios us ON us.id=m.usuario_id LEFT JOIN canecas_recepciones r ON r.empresa_id=m.empresa_id AND r.id=m.recepcion_id LEFT JOIN empleados e ON e.empresa_id=r.empresa_id AND e.id=r.recibido_por_empleado_id WHERE m.empresa_id=? ORDER BY m.id DESC LIMIT 200",
};

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, recurso } = await ctx.params;
  const accion = recurso === "gastos_posteriores" || recurso === "valoracion_inventario" || recurso === "salidas" ? "compras" : recurso === "valoracion_inicial" ? "confirmar" : "ver";
  const guard = await accesoCanecas(slug, accion);
  if (guard.error) return guard.error;
  if (!lecturas[recurso]) return NextResponse.json({ error: "Recurso desconocido." }, { status: 404 });
  let consulta = lecturas[recurso];
  if (recurso === "compras") {
    const costos = await accesoCanecas(slug, "compras");
    if (costos.error) consulta = "SELECT c.id,c.empresa_id,c.proveedor_id,c.producto_id,c.referencia,c.cantidad,c.creado_en,p.nombre AS producto,pr.nombre_comercial AS proveedor FROM canecas_compras c JOIN canecas_productos p ON p.empresa_id=c.empresa_id AND p.id=c.producto_id JOIN compras_proveedores pr ON pr.empresa_id=c.empresa_id AND pr.id=c.proveedor_id WHERE c.empresa_id=? ORDER BY c.id DESC";
  }
  if (recurso === "productos") {
    const [compras, catalogo] = await Promise.all([accesoCanecas(slug, "compras"), accesoCanecas(slug, "catalogo")]);
    if (compras.error && catalogo.error) consulta = "SELECT id,empresa_id,codigo,nombre,marca,presentacion,capacidad,unidad_capacidad,unidad_inventario,activo FROM canecas_productos WHERE empresa_id=? ORDER BY nombre,id";
  }
  try { return NextResponse.json({ datos: await query<RowDataPacket[]>(consulta, [guard.empresa.id]) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "No se pudo consultar el módulo." }, { status: 500 }); }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, recurso } = await ctx.params;
  const accion = recurso === "confirmar" || recurso === "valoracion_inicial" || recurso === "salidas" || recurso === "reversar_salida" ? "confirmar" : recurso === "compras" || recurso === "gastos_posteriores" ? "compras" : recurso === "recepciones" ? "recepciones" : "catalogo";
  const guard = await accesoCanecas(slug, accion);
  if (guard.error) return guard.error;
  if (recurso === "salidas" || recurso === "reversar_salida") {
    const costos = await accesoCanecas(slug, "compras");
    if (costos.error) return costos.error;
  }
  const schema = schemas[recurso as keyof typeof schemas];
  if (!schema) return NextResponse.json({ error: "Recurso desconocido." }, { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Revise los campos del formulario." }, { status: 400 });
  const d = parsed.data as Record<string, string | number>;
  const empresa = guard.empresa.id, usuario = guard.session.id;
  try {
    if ((d.precio_compra || d.gastos_adquisicion || d.precio_venta_referencia || d.costo) && !d.moneda) return NextResponse.json({ error: "Indique la moneda del importe." }, { status: 400 });
    if (recurso === "salidas") return NextResponse.json(await registrarSalidaFifo(getPool(), empresa, usuario, { productoId: Number(d.producto_id), ubicacionId: Number(d.ubicacion_id), cantidad: Number(d.cantidad), documento: String(d.documento), claveOperacion: String(d.clave_operacion) }));
    if (recurso === "reversar_salida") return NextResponse.json(await reversarSalidaFifo(getPool(), empresa, usuario, String(d.salida_id), String(d.motivo)));
    if (recurso === "confirmar") return NextResponse.json(await confirmarRecepcion(getPool(), empresa, Number(d.id), usuario));
    if (recurso === "valoracion_inicial") return NextResponse.json(await valorarExistenciaInicial(getPool(), empresa, usuario, { productoId: Number(d.producto_id), ubicacionId: Number(d.ubicacion_id), cantidad: Number(d.cantidad), costoCentavos: centavos(String(d.costo)), moneda: String(d.moneda) || null, documento: String(d.documento), motivo: String(d.motivo), claveOperacion: String(d.clave_operacion) }));
    if (recurso === "gastos_posteriores") return NextResponse.json(await registrarGastoPosterior(getPool(), empresa, usuario, { compraId: Number(d.compra_id), importeCentavos: centavos(String(d.importe))!, moneda: String(d.moneda), fechaDocumento: String(d.fecha_documento), referencia: String(d.referencia), motivo: String(d.motivo), claveOperacion: String(d.clave_operacion) }));
    if (recurso === "precio_referencia") {
      const [r] = await getPool().execute<ResultSetHeader>("UPDATE canecas_productos SET precio_venta_referencia_centavos=?,precio_venta_referencia_moneda=? WHERE empresa_id=? AND id=?", [centavos(String(d.precio_venta_referencia))?.toString() ?? null,String(d.moneda) || null,empresa,d.producto_id]);
      return r.affectedRows ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
    }
    if (recurso === "proveedores") {
      const nuevo = await guardarProveedor(empresa, usuario, guard.session.username, { nombre_comercial: String(d.nombre_comercial) });
      return NextResponse.json({ id: nuevo }, { status: 201 });
    }
    const pool = getPool();
    if (recurso === "productos") {
      const [r] = await pool.execute<ResultSetHeader>("INSERT INTO canecas_productos (empresa_id,codigo,nombre,marca,presentacion,capacidad,unidad_capacidad,unidad_inventario,precio_venta_referencia_centavos,precio_venta_referencia_moneda) VALUES (?,?,?,?,?,?,?,?,?,?)", [empresa,d.codigo,d.nombre,d.marca,d.presentacion,d.capacidad,d.unidad_capacidad,d.unidad_inventario,centavos(String(d.precio_venta_referencia))?.toString() ?? null,String(d.moneda) || null]);
      return NextResponse.json({ id: r.insertId }, { status: 201 });
    }
    if (recurso === "ubicaciones") {
      const [r] = await pool.execute<ResultSetHeader>("INSERT INTO canecas_ubicaciones (empresa_id,nombre) VALUES (?,?)", [empresa,d.nombre]);
      return NextResponse.json({ id: r.insertId }, { status: 201 });
    }
    const conn = await pool.getConnection();
    const tabla = recurso === "compras" ? "canecas_compras" : "canecas_recepciones";
    try {
      await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await conn.beginTransaction();
      const [existentes] = await conn.query<RowDataPacket[]>(`SELECT * FROM ${tabla} WHERE empresa_id=? AND clave_operacion=?`, [empresa,d.clave_operacion]);
      if (existentes[0]) {
        const campos = recurso === "compras" ? ["proveedor_id","producto_id","cantidad","referencia"] : ["compra_id","ubicacion_id","recibido_por_empleado_id","cantidad"];
        if (campos.some(c => String(existentes[0][c]) !== String(d[c]))) throw new Error("CLAVE_REUTILIZADA");
        if (recurso === "compras" && (String(existentes[0].precio_unitario_centavos) !== String(centavos(String(d.precio_compra))) || String(existentes[0].gastos_centavos) !== String(centavos(String(d.gastos_adquisicion))) || String(existentes[0].moneda ?? "") !== String(d.moneda))) throw new Error("CLAVE_REUTILIZADA");
        await conn.commit();
        return NextResponse.json({ id: existentes[0].id });
      }
      let r: ResultSetHeader;
      if (recurso === "compras") {
        const [validos] = await conn.query<RowDataPacket[]>("SELECT p.id FROM canecas_productos p JOIN compras_proveedores pr ON pr.empresa_id=p.empresa_id WHERE p.empresa_id=? AND p.id=? AND p.activo=1 AND pr.id=? AND pr.activo=1", [empresa,d.producto_id,d.proveedor_id]);
        if (!validos.length) throw new Error("REFERENCIA_INVALIDA");
        [r] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_compras (empresa_id,proveedor_id,producto_id,cantidad,referencia,clave_operacion,creado_por,precio_unitario_centavos,gastos_centavos,moneda) VALUES (?,?,?,?,?,?,?,?,?,?)", [empresa,d.proveedor_id,d.producto_id,d.cantidad,d.referencia,d.clave_operacion,usuario,centavos(String(d.precio_compra))?.toString() ?? null,centavos(String(d.gastos_adquisicion))?.toString() ?? null,String(d.moneda) || null]);
      } else {
        const [validos] = await conn.query<RowDataPacket[]>("SELECT c.id FROM canecas_compras c JOIN canecas_ubicaciones u ON u.empresa_id=c.empresa_id JOIN empleados e ON e.empresa_id=c.empresa_id WHERE c.empresa_id=? AND c.id=? AND u.id=? AND u.activo=1 AND e.id=? AND e.estado='Activo'", [empresa,d.compra_id,d.ubicacion_id,d.recibido_por_empleado_id]);
        if (!validos.length) throw new Error("REFERENCIA_INVALIDA");
        [r] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_recepciones (empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,cantidad,clave_operacion,creado_por) VALUES (?,?,?,?,?,?,?)", [empresa,d.compra_id,d.ubicacion_id,d.recibido_por_empleado_id,d.cantidad,d.clave_operacion,usuario]);
      }
      await conn.commit();
      return NextResponse.json({ id: r.insertId }, { status: 201 });
    } catch (error) {
      await conn.rollback();
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM ${tabla} WHERE empresa_id=? AND clave_operacion=?`, [empresa,d.clave_operacion]);
        const campos = recurso === "compras" ? ["proveedor_id","producto_id","cantidad","referencia"] : ["compra_id","ubicacion_id","recibido_por_empleado_id","cantidad"];
        if (rows[0] && campos.every(c => String(rows[0][c]) === String(d[c])) && (recurso !== "compras" || (String(rows[0].precio_unitario_centavos) === String(centavos(String(d.precio_compra))) && String(rows[0].gastos_centavos) === String(centavos(String(d.gastos_adquisicion))) && String(rows[0].moneda ?? "") === String(d.moneda)))) return NextResponse.json({ id: rows[0].id });
      }
      throw error;
    } finally { conn.release(); }
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (error instanceof ErrorProveedorDuplicado || e.code === "ER_DUP_ENTRY" || ["CLAVE_REUTILIZADA","CANTIDAD_EXCEDE_COMPRA","REFERENCIA_INVALIDA","CONCILIACION_INVALIDA","MONEDA_INCOMPATIBLE","SALDO_INSUFICIENTE","CAPAS_NO_CONCILIADAS","COSTO_PENDIENTE","PRIORIDAD_INICIAL_PENDIENTE","CAPAS_INSUFICIENTES","TRAZABILIDAD_INVALIDA","REVERSO_YA_REGISTRADO"].includes(e.message ?? "")) return NextResponse.json({ error: "Registro duplicado o datos incompatibles. Verifique la operación." }, { status: 409 });
    if (["VALORACION_INVALIDA","GASTO_INVALIDO","MONEDA_REQUERIDA","SALIDA_INVALIDA","REVERSO_INVALIDO"].includes(e.message ?? "")) return NextResponse.json({ error: "Revise los importes, la moneda y los demás campos." }, { status: 400 });
    if (["RECEPCION_NO_ENCONTRADA","COMPRA_NO_ENCONTRADA","SALDO_NO_ENCONTRADO","SALIDA_NO_ENCONTRADA"].includes(e.message ?? "")) return NextResponse.json({ error: "Registro no encontrado." }, { status: 404 });
    return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, recurso } = await ctx.params;
  const guard = await accesoCanecas(slug, "catalogo");
  if (guard.error) return guard.error;
  if (recurso !== "productos" && recurso !== "ubicaciones") return NextResponse.json({ error: "Recurso desconocido." }, { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const parsed = z.object({ id, activo: z.boolean() }).strict().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  try {
    const tabla = recurso === "productos" ? "canecas_productos" : "canecas_ubicaciones";
    const [result] = await getPool().execute<ResultSetHeader>(`UPDATE ${tabla} SET activo=? WHERE empresa_id=? AND id=?`, [Number(parsed.data.activo),guard.empresa.id,parsed.data.id]);
    if (!result.affectedRows) return NextResponse.json({ error: "Registro no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "No se pudo cambiar el estado." }, { status: 500 }); }
}
