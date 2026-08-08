import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";
import {
  parsearExcelFlota,
  parsearFiltrosTexto,
} from "@/lib/flota/import-excel";
import {
  asegurarSchemaFlota,
  asegurarSchemaFlotaLectura,
} from "@/lib/flota/schema";
import { guardarFiltrosVehiculo } from "@/lib/flota/filtros";
import { guardarAccesoVehiculo } from "@/lib/flota/acceso";
import { resolverEmpresaFlotaExcel } from "@/lib/flota/empresas-alias";
import { listarEmpresasActivas } from "@/lib/empresas";

type Ctx = { params: Promise<{ slug: string }> };

/** Empresas del grupo que comparten camiones (KT / Mónaco / Fresco Fresh). */
const SLUGS_FLOTA_COMPARTIDA = ["kt-monaco", "frescofresh"];

function matchEmpresa(
  empresas: { id: number; codigo: string; slug: string; nombre: string }[],
  slugs: string[],
  codigos: string[],
): number | null {
  const slugSet = new Set(slugs.map((s) => s.toLowerCase()));
  const codSet = new Set(codigos.map((c) => c.toUpperCase()));
  for (const e of empresas) {
    if (slugSet.has(e.slug.toLowerCase())) return e.id;
    if (codSet.has(e.codigo.toUpperCase())) return e.id;
  }
  return null;
}

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
    filas = filas.filter((f) => {
      const r = resolverEmpresaFlotaExcel(f.empresaActivo);
      return (
        (f.empresaActivo ?? "").toLowerCase().includes(q) ||
        r.etiqueta.toLowerCase().includes(q) ||
        r.codigoCorto.toLowerCase().includes(q)
      );
    });
  }

  const empresas = await listarEmpresasActivas();
  const idsComparten = empresas
    .filter((e) => SLUGS_FLOTA_COMPARTIDA.includes(e.slug))
    .map((e) => e.id);

  let creados = 0;
  let actualizados = 0;
  const errores: string[] = [];

  for (const f of filas) {
    try {
      const resuelta = resolverEmpresaFlotaExcel(f.empresaActivo);
      const etiqueta =
        resuelta.etiqueta || (f.empresaActivo ?? "").trim() || null;

      // Dueño: empresa resuelta del Excel, o la empresa donde se importa
      let duenoId =
        matchEmpresa(empresas, resuelta.slugs, resuelta.codigos) ??
        guard.empresa.id;
      // KT y Mónaco comparten el tenant kt-monaco en plataforma
      if (
        resuelta.grupoCompartido &&
        (resuelta.codigoCorto === "KT" || resuelta.codigoCorto === "MÓNACO")
      ) {
        const kt = empresas.find((e) => e.slug === "kt-monaco");
        if (kt) duenoId = kt.id;
      }

      // Buscar por placa en dueño o en el tenant actual (evita duplicar unidad física)
      let existente = await query<RowDataPacket[]>(
        `SELECT id, empresa_id FROM flota_vehiculos
         WHERE placa = ? AND empresa_id IN (?, ?)
         ORDER BY CASE WHEN empresa_id = ? THEN 0 ELSE 1 END
         LIMIT 1`,
        [f.placa, duenoId, guard.empresa.id, duenoId],
      );
      if (!existente[0]) {
        existente = await query<RowDataPacket[]>(
          "SELECT id, empresa_id FROM flota_vehiculos WHERE placa = ? LIMIT 1",
          [f.placa],
        );
      }

      const kmActual = f.kmActual ?? 0;
      const kmIntervalo =
        f.kmIntervalo && f.kmIntervalo > 0 ? f.kmIntervalo : 10000;
      const kmUltimo = f.kmUltimoServicio ?? 0;
      const filtros = parsearFiltrosTexto(f.filtros);

      const accesosPara = (vehiculoEmpresaId: number) => {
        const ids = new Set<number>();
        // Quien importa siempre ve la unidad
        ids.add(guard.empresa.id);
        // Grupo compartido KT / Mónaco / Fresco Fresh
        if (resuelta.grupoCompartido || idsComparten.includes(vehiculoEmpresaId)) {
          for (const id of idsComparten) ids.add(id);
        }
        ids.delete(vehiculoEmpresaId);
        return [...ids];
      };

      if (existente[0]) {
        const vid = Number(existente[0].id);
        const empId = Number(existente[0].empresa_id);
        await execute(
          `UPDATE flota_vehiculos SET
            marca = ?,
            modelo = ?,
            descripcion = COALESCE(?, descripcion),
            color = COALESCE(?, color),
            credito = COALESCE(?, credito),
            empresa_activo = ?,
            nit = COALESCE(?, nit),
            condicion_propiedad = COALESCE(?, condicion_propiedad),
            seguros = COALESCE(?, seguros),
            notas = COALESCE(?, notas),
            km_actual = COALESCE(?, km_actual),
            km_intervalo_servicio = COALESCE(?, km_intervalo_servicio),
            km_ultimo_servicio = COALESCE(?, km_ultimo_servicio),
            rin_llanta = COALESCE(?, rin_llanta),
            medida_llanta = COALESCE(?, medida_llanta),
            tipo_aceite = COALESCE(?, tipo_aceite),
            tipo_combustible = COALESCE(?, tipo_combustible),
            chasis = COALESCE(?, chasis),
            capacidad = COALESCE(?, capacidad),
            activo = ?,
            estado = ?
           WHERE id = ?`,
          [
            f.marca,
            f.modelo,
            f.descripcion,
            f.color,
            f.credito,
            etiqueta,
            f.nit,
            f.condicionPropiedad,
            f.seguros,
            f.notas,
            f.kmActual,
            f.kmIntervalo && f.kmIntervalo > 0 ? f.kmIntervalo : null,
            f.kmUltimoServicio,
            f.rinLlanta,
            f.medidaLlanta,
            f.tipoAceite,
            f.tipoCombustible,
            f.chasis,
            f.capacidad,
            f.activo ? 1 : 0,
            f.activo ? "Activo" : "Inactivo",
            vid,
          ],
        );
        if (filtros.length) {
          await guardarFiltrosVehiculo(empId, vid, filtros);
        }
        const acc = accesosPara(empId);
        if (acc.length) {
          await guardarAccesoVehiculo(vid, acc, empId);
        }
        actualizados += 1;
      } else {
        const ins = await execute(
          `INSERT INTO flota_vehiculos
            (empresa_id, placa, marca, modelo, descripcion, color, credito,
             empresa_activo, nit, condicion_propiedad, seguros, notas,
             km_actual, km_intervalo_servicio, km_ultimo_servicio,
             rin_llanta, medida_llanta, tipo_aceite, tipo_combustible,
             chasis, capacidad, activo, estado)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            duenoId,
            f.placa,
            f.marca,
            f.modelo,
            f.descripcion,
            f.color,
            f.credito,
            etiqueta,
            f.nit,
            f.condicionPropiedad,
            f.seguros,
            f.notas,
            kmActual,
            kmIntervalo,
            kmUltimo,
            f.rinLlanta,
            f.medidaLlanta,
            f.tipoAceite,
            f.tipoCombustible,
            f.chasis,
            f.capacidad,
            f.activo ? 1 : 0,
            f.activo ? "Activo" : "Inactivo",
          ],
        );
        const nuevoId = Number(ins.insertId);
        if (filtros.length && nuevoId) {
          await guardarFiltrosVehiculo(duenoId, nuevoId, filtros);
        }
        if (nuevoId) {
          const acc = accesosPara(duenoId);
          if (acc.length) {
            await guardarAccesoVehiculo(nuevoId, acc, duenoId);
          }
        }
        creados += 1;
      }
    } catch (err) {
      errores.push(
        `${f.placa}: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  return NextResponse.json({
    mensaje: `Importación: ${creados} nuevos, ${actualizados} actualizados. KT=Kuiqtrans, Mónaco y FSS=Fresco Fresh quedan etiquetados y compartidos en flota.`,
    creados,
    actualizados,
    total: filas.length,
    errores: errores.slice(0, 30),
  });
}
