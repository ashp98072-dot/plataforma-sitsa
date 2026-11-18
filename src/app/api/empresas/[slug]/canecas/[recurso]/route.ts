import { NextResponse } from "next/server";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { accesoCanecas } from "@/lib/canecas/acceso";
import { confirmarRecepcion } from "@/lib/canecas/confirmar";
import { guardarProveedor, ErrorProveedorDuplicado } from "@/lib/compras/proveedores";

type Ctx = { params: Promise<{ slug: string; recurso: string }> };
const texto = (n: number) => z.string().trim().min(1).max(n);
const id = z.coerce.number().int().positive().max(2147483647);
const clave = z.uuid();
const schemas = {
  productos: z.object({ codigo: texto(80), nombre: texto(200), marca: z.string().trim().max(160), presentacion: texto(160), capacidad: z.coerce.number().min(0.001).max(999999999).multipleOf(0.001), unidad_capacidad: texto(40), unidad_inventario: texto(40) }).strict(),
  ubicaciones: z.object({ nombre: texto(160) }).strict(),
  proveedores: z.object({ nombre_comercial: texto(200) }).strict(),
  compras: z.object({ proveedor_id: id, producto_id: id, cantidad: id, referencia: texto(250), clave_operacion: clave }).strict(),
  recepciones: z.object({ compra_id: id, ubicacion_id: id, recibido_por_empleado_id: id, cantidad: id, clave_operacion: clave }).strict(),
  confirmar: z.object({ id }).strict(),
};
const lecturas: Record<string, string> = {
  productos: "SELECT * FROM canecas_productos WHERE empresa_id=? ORDER BY nombre,id",
  ubicaciones: "SELECT * FROM canecas_ubicaciones WHERE empresa_id=? ORDER BY nombre,id",
  proveedores: "SELECT id,nombre_comercial FROM compras_proveedores WHERE empresa_id=? AND activo=1 ORDER BY nombre_comercial",
  empleados: "SELECT id,nombre FROM empleados WHERE empresa_id=? AND estado='Activo' ORDER BY nombre",
  compras: "SELECT c.*,p.nombre AS producto,pr.nombre_comercial AS proveedor FROM canecas_compras c JOIN canecas_productos p ON p.empresa_id=c.empresa_id AND p.id=c.producto_id JOIN compras_proveedores pr ON pr.empresa_id=c.empresa_id AND pr.id=c.proveedor_id WHERE c.empresa_id=? ORDER BY c.id DESC",
  recepciones: "SELECT r.*,c.referencia,p.nombre AS producto,u.nombre AS ubicacion,e.nombre AS recibido_por,us.username AS confirmado_usuario FROM canecas_recepciones r JOIN canecas_compras c ON c.empresa_id=r.empresa_id AND c.id=r.compra_id JOIN canecas_productos p ON p.empresa_id=c.empresa_id AND p.id=c.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=r.empresa_id AND u.id=r.ubicacion_id JOIN empleados e ON e.empresa_id=r.empresa_id AND e.id=r.recibido_por_empleado_id LEFT JOIN usuarios us ON us.id=r.confirmado_por WHERE r.empresa_id=? ORDER BY r.id DESC",
  inventario: "SELECT p.nombre,p.presentacion,u.nombre AS ubicacion,s.fisico,s.reservado,s.fisico-s.reservado AS disponible FROM canecas_saldos s JOIN canecas_productos p ON p.empresa_id=s.empresa_id AND p.id=s.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=s.empresa_id AND u.id=s.ubicacion_id WHERE s.empresa_id=? ORDER BY p.nombre,u.nombre",
  movimientos: "SELECT m.*,p.nombre AS producto,p.presentacion,u.nombre AS ubicacion,us.username AS usuario,e.nombre AS recibido_por FROM canecas_movimientos m JOIN canecas_productos p ON p.empresa_id=m.empresa_id AND p.id=m.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=m.empresa_id AND u.id=m.ubicacion_id JOIN usuarios us ON us.id=m.usuario_id LEFT JOIN canecas_recepciones r ON r.empresa_id=m.empresa_id AND r.id=m.recepcion_id LEFT JOIN empleados e ON e.empresa_id=r.empresa_id AND e.id=r.recibido_por_empleado_id WHERE m.empresa_id=? ORDER BY m.id DESC LIMIT 200",
};

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, recurso } = await ctx.params;
  const guard = await accesoCanecas(slug, "ver");
  if (guard.error) return guard.error;
  if (!lecturas[recurso]) return NextResponse.json({ error: "Recurso desconocido." }, { status: 404 });
  try { return NextResponse.json({ datos: await query<RowDataPacket[]>(lecturas[recurso], [guard.empresa.id]) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "No se pudo consultar el módulo." }, { status: 500 }); }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, recurso } = await ctx.params;
  const accion = recurso === "confirmar" ? "confirmar" : recurso === "compras" ? "compras" : recurso === "recepciones" ? "recepciones" : "catalogo";
  const guard = await accesoCanecas(slug, accion);
  if (guard.error) return guard.error;
  const schema = schemas[recurso as keyof typeof schemas];
  if (!schema) return NextResponse.json({ error: "Recurso desconocido." }, { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Revise los campos del formulario." }, { status: 400 });
  const d = parsed.data as Record<string, string | number>;
  const empresa = guard.empresa.id, usuario = guard.session.id;
  try {
    if (recurso === "confirmar") return NextResponse.json(await confirmarRecepcion(getPool(), empresa, Number(d.id), usuario));
    if (recurso === "proveedores") {
      const nuevo = await guardarProveedor(empresa, usuario, guard.session.username, { nombre_comercial: String(d.nombre_comercial) });
      return NextResponse.json({ id: nuevo }, { status: 201 });
    }
    const pool = getPool();
    if (recurso === "productos") {
      const [r] = await pool.execute<ResultSetHeader>("INSERT INTO canecas_productos (empresa_id,codigo,nombre,marca,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (?,?,?,?,?,?,?,?)", [empresa,d.codigo,d.nombre,d.marca,d.presentacion,d.capacidad,d.unidad_capacidad,d.unidad_inventario]);
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
        await conn.commit();
        return NextResponse.json({ id: existentes[0].id });
      }
      let r: ResultSetHeader;
      if (recurso === "compras") {
        const [validos] = await conn.query<RowDataPacket[]>("SELECT p.id FROM canecas_productos p JOIN compras_proveedores pr ON pr.empresa_id=p.empresa_id WHERE p.empresa_id=? AND p.id=? AND p.activo=1 AND pr.id=? AND pr.activo=1", [empresa,d.producto_id,d.proveedor_id]);
        if (!validos.length) throw new Error("REFERENCIA_INVALIDA");
        [r] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_compras (empresa_id,proveedor_id,producto_id,cantidad,referencia,clave_operacion,creado_por) VALUES (?,?,?,?,?,?,?)", [empresa,d.proveedor_id,d.producto_id,d.cantidad,d.referencia,d.clave_operacion,usuario]);
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
        if (rows[0] && campos.every(c => String(rows[0][c]) === String(d[c]))) return NextResponse.json({ id: rows[0].id });
      }
      throw error;
    } finally { conn.release(); }
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (error instanceof ErrorProveedorDuplicado || e.code === "ER_DUP_ENTRY" || ["CLAVE_REUTILIZADA","CANTIDAD_EXCEDE_COMPRA","REFERENCIA_INVALIDA"].includes(e.message ?? "")) return NextResponse.json({ error: "Registro duplicado o datos incompatibles. Verifique la operación." }, { status: 409 });
    if (e.message === "RECEPCION_NO_ENCONTRADA") return NextResponse.json({ error: "Recepción no encontrada." }, { status: 404 });
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
