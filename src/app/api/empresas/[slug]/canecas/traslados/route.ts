import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { accesoCanecas } from "@/lib/canecas/acceso";
import { crearTraslado, enviarTraslado, recibirTraslado } from "@/lib/canecas/traslados";
import { cargarLogoEmpresa } from "@/lib/facturacion/factura-demo-pdf";
import { getPool } from "@/lib/db";

type Ctx = { params: Promise<{ slug: string }> };
const id = z.number().int().positive().max(2147483647);
const cantidad = z.number().int().nonnegative().max(2147483647);
const texto = (max: number) => z.string().trim().min(1).max(max);
const opcional = (max: number) => z.string().trim().max(max);
const esquema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("crear"), clave: z.uuid(), origenId: id, destinoId: id, entrega: texto(200), transporte: opcional(200), observaciones: opcional(1000), partidas: z.array(z.object({ productoId: id, cantidad: cantidad.positive() }).strict()).min(1).max(100) }).strict(),
  z.object({ accion: z.literal("enviar"), id }).strict(),
  z.object({ accion: z.literal("recibir"), id, clave: z.uuid(), recibe: texto(200), condicion: texto(500), observaciones: opcional(1000), partidas: z.array(z.object({ partidaId: id, recibido: cantidad, faltante: cantidad, motivo: opcional(500) }).strict()).min(1).max(100) }).strict(),
]);

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await accesoCanecas(slug, "ver");
  if (guard.error) return guard.error;
  try {
    const [traslados] = await getPool().query<RowDataPacket[]>(`SELECT t.id,t.numero,t.estado,t.entrega,t.transporte,t.observaciones,t.creado_en,t.enviado_en,o.nombre AS origen,d.nombre AS destino,
      (SELECT COUNT(*) FROM canecas_traslado_documentos doc WHERE doc.empresa_id=t.empresa_id AND doc.traslado_id=t.id) AS versiones
      FROM canecas_traslados t JOIN canecas_ubicaciones o ON o.empresa_id=t.empresa_id AND o.id=t.origen_id
      JOIN canecas_ubicaciones d ON d.empresa_id=t.empresa_id AND d.id=t.destino_id WHERE t.empresa_id=? ORDER BY t.id DESC`, [guard.empresa.id]);
    const [partidas] = await getPool().query<RowDataPacket[]>(`SELECT p.id,p.traslado_id,p.cantidad,p.recibido,p.faltante,p.cantidad-p.recibido-p.faltante AS transito,a.nombre AS producto,a.presentacion
      FROM canecas_traslado_partidas p JOIN canecas_productos a ON a.empresa_id=p.empresa_id AND a.id=p.producto_id WHERE p.empresa_id=? ORDER BY p.id`, [guard.empresa.id]);
    return NextResponse.json({ datos: traslados.map(t => ({ ...t, partidas: partidas.filter(p => p.traslado_id === t.id) })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "No se pudieron consultar los traslados." }, { status: 500 }); }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const parsed = esquema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Revise los datos del traslado." }, { status: 400 });
  const d = parsed.data;
  const guard = await accesoCanecas(slug, d.accion === "crear" ? "recepciones" : "confirmar");
  if (guard.error) return guard.error;
  try {
    if (d.accion === "crear") return NextResponse.json(await crearTraslado(getPool(), guard.empresa.id, guard.session.id, d));
    if (d.accion === "enviar") {
      let logo = await cargarLogoEmpresa(guard.empresa);
      if (!logo && guard.empresa.slug === "monaco" && guard.empresa.logoUrl === "/brands/monaco/logo.png") logo = await readFile(join(process.cwd(), "public", "brands", "monaco", "logo.png"));
      if (!logo) return NextResponse.json({ error: "Configure un logotipo válido para la empresa antes de emitir el comprobante." }, { status: 409 });
      return NextResponse.json(await enviarTraslado(getPool(), guard.empresa.id, d.id, guard.session.id, { nombre: guard.empresa.nombre, logo, logoTipo: logo[0] === 0xff ? "image/jpeg" : "image/png" }));
    }
    // Tanto la recepción como la declaración de faltantes requieren el permiso
    // canecas_confirmar. El guard anterior comprueba además lectura y empresa;
    // el usuario de esa sesión queda registrado como responsable del faltante.
    const autorizaFaltante = !guard.error && d.accion === "recibir";
    return NextResponse.json(await recibirTraslado(getPool(), guard.empresa.id, d.id, guard.session.id, d, autorizaFaltante));
  } catch (error) {
    const codigo = (error as Error).message;
    if (codigo === "TRASLADO_NO_ENCONTRADO") return NextResponse.json({ error: "Traslado no encontrado." }, { status: 404 });
    if (["PARTIDAS_INVALIDAS","CANTIDAD_INVALIDA","CANTIDAD_EXCEDE_ENVIO","EXISTENCIA_INSUFICIENTE","ESTADO_INVALIDO","CLAVE_REUTILIZADA","UBICACION_NO_ENCONTRADA","PRODUCTO_NO_ENCONTRADO","PARTIDA_NO_ENCONTRADA","FALTANTE_NO_AUTORIZADO","SALDO_EXCEDE_LIMITE"].includes(codigo)) return NextResponse.json({ error: codigo }, { status: 409 });
    return NextResponse.json({ error: "No se pudo completar el traslado." }, { status: 500 });
  }
}
