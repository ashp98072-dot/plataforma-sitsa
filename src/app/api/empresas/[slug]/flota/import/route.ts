import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";
import { parsearExcelFlota } from "@/lib/flota/import-excel";
import { asegurarSchemaFlota } from "@/lib/flota/schema";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "crear");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Archivo Excel (.xlsx) requerido." },
      { status: 400 },
    );
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json(
      { error: "Solo se aceptan archivos .xlsx" },
      { status: 400 },
    );
  }

  const soloEmpresa = String(form.get("soloEmpresa") ?? "").trim();
  const buffer = Buffer.from(await file.arrayBuffer());
  let filas = await parsearExcelFlota(buffer);
  if (!filas.length) {
    return NextResponse.json(
      { error: "No se encontraron vehículos en el Excel." },
      { status: 400 },
    );
  }

  if (soloEmpresa) {
    const q = soloEmpresa.toLowerCase();
    filas = filas.filter((f) =>
      (f.empresaActivo ?? "").toLowerCase().includes(q),
    );
  }

  let creados = 0;
  let actualizados = 0;
  const errores: string[] = [];

  for (const f of filas) {
    try {
      const existente = await query<RowDataPacket[]>(
        "SELECT id FROM flota_vehiculos WHERE empresa_id = ? AND placa = ? LIMIT 1",
        [guard.empresa.id, f.placa],
      );
      if (existente[0]) {
        // Marca y modelo van en columnas separadas (Excel: Marca | Modelo/año)
        await execute(
          `UPDATE flota_vehiculos SET
            marca = ?,
            modelo = ?,
            descripcion = COALESCE(?, descripcion),
            color = COALESCE(?, color),
            credito = COALESCE(?, credito),
            empresa_activo = COALESCE(?, empresa_activo),
            nit = COALESCE(?, nit),
            condicion_propiedad = COALESCE(?, condicion_propiedad),
            seguros = COALESCE(?, seguros),
            notas = COALESCE(?, notas),
            activo = ?,
            estado = ?
           WHERE id = ? AND empresa_id = ?`,
          [
            f.marca,
            f.modelo,
            f.descripcion,
            f.color,
            f.credito,
            f.empresaActivo,
            f.nit,
            f.condicionPropiedad,
            f.seguros,
            f.notas,
            f.activo ? 1 : 0,
            f.activo ? "Activo" : "Inactivo",
            Number(existente[0].id),
            guard.empresa.id,
          ],
        );
        actualizados += 1;
      } else {
        await execute(
          `INSERT INTO flota_vehiculos
            (empresa_id, placa, marca, modelo, descripcion, color, credito,
             empresa_activo, nit, condicion_propiedad, seguros, notas,
             km_actual, km_intervalo_servicio, km_ultimo_servicio, activo, estado)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 10000, 0, ?, ?)`,
          [
            guard.empresa.id,
            f.placa,
            f.marca,
            f.modelo,
            f.descripcion,
            f.color,
            f.credito,
            f.empresaActivo,
            f.nit,
            f.condicionPropiedad,
            f.seguros,
            f.notas,
            f.activo ? 1 : 0,
            f.activo ? "Activo" : "Inactivo",
          ],
        );
        creados += 1;
      }
    } catch (err) {
      errores.push(
        `${f.placa}: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  return NextResponse.json({
    mensaje: `Importación: ${creados} nuevos, ${actualizados} actualizados.`,
    creados,
    actualizados,
    total: filas.length,
    errores: errores.slice(0, 30),
  });
}
