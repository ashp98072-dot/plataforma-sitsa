import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

export function normalizarNombrePiloto(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export async function buscarEmpleadoPorNombre(
  empresaId: number,
  nombre: string,
): Promise<{ id: number; codigo: string; nombre: string; estado: string } | null> {
  const norm = normalizarNombrePiloto(nombre);
  if (norm.length < 2) return null;

  const tokens = norm.split(" ").filter((t) => t.length > 1);
  const likeSeed = tokens[0] ?? norm;
  // Prefiltro SQL para no cargar 500 empleados en cada salida.
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, estado FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo'
       AND LOWER(nombre) LIKE ?
     ORDER BY nombre
     LIMIT 80`,
    [empresaId, `%${likeSeed}%`],
  ).catch(async () =>
    query<RowDataPacket[]>(
      `SELECT id, codigo, nombre, estado FROM empleados
       WHERE empresa_id = ? AND estado = 'Activo'
       ORDER BY nombre
       LIMIT 200`,
      [empresaId],
    ),
  );

  const exacto = rows.find(
    (r) => normalizarNombrePiloto(String(r.nombre)) === norm,
  );
  if (exacto) {
    return {
      id: Number(exacto.id),
      codigo: String(exacto.codigo),
      nombre: String(exacto.nombre),
      estado: String(exacto.estado),
    };
  }

  // Si escribió "Juan Perez" y en RRHH está "Juan Carlos Perez"
  if (tokens.length >= 2) {
    const parcial = rows.find((r) => {
      const n = normalizarNombrePiloto(String(r.nombre));
      return tokens.every((t) => n.includes(t));
    });
    if (parcial) {
      return {
        id: Number(parcial.id),
        codigo: String(parcial.codigo),
        nombre: String(parcial.nombre),
        estado: String(parcial.estado),
      };
    }
  }

  return null;
}

/**
 * ¿El empleado (RRHH) de la sesión del portal está vinculado como piloto
 * activo en TMS? Usa el id_empleado real (Fase 0), no un cruce por nombre.
 */
export async function obtenerPilotoDeEmpleado(
  empresaId: number,
  empleadoId: number,
): Promise<{ id: number; nombre: string } | null> {
  const personal = await obtenerPersonalOperativoDeEmpleado(empresaId, empleadoId);
  return personal?.tipo === "Piloto"
    ? { id: personal.id, nombre: personal.nombre }
    : null;
}

export type PersonalOperativoEmpleado = {
  id: number;
  nombre: string;
  tipo: "Piloto" | "Auxiliar";
};

/** Identidad operativa del colaborador, vinculada por id real de RRHH. */
export async function obtenerPersonalOperativoDeEmpleado(
  empresaId: number,
  empleadoId: number,
): Promise<PersonalOperativoEmpleado | null> {
  let rows = await query<RowDataPacket[]>(
    `SELECT id, nombre, tipo FROM tms_personal
     WHERE empresa_id = ? AND id_empleado = ?
       AND tipo IN ('Piloto', 'Auxiliar') AND estado = 'Activo'
     ORDER BY FIELD(tipo, 'Piloto', 'Auxiliar')
     LIMIT 1`,
    [empresaId, empleadoId],
  ).catch(() => [] as RowDataPacket[]);
  if (!rows[0]) {
    const empleados = await query<RowDataPacket[]>(
      `SELECT codigo, nombre FROM empleados
       WHERE id = ? AND empresa_id = ? AND estado = 'Activo' LIMIT 1`,
      [empleadoId, empresaId],
    ).catch(() => [] as RowDataPacket[]);
    const emp = empleados[0];
    if (emp) {
      const codigo = String(emp.codigo ?? "").trim();
      const nombre = String(emp.nombre ?? "").trim();
      let candidatos = codigo
        ? await query<RowDataPacket[]>(
            `SELECT id FROM tms_personal
             WHERE empresa_id = ? AND codigo = ? AND id_empleado IS NULL
               AND tipo IN ('Piloto', 'Auxiliar') AND estado = 'Activo'`,
            [empresaId, codigo],
          ).catch(() => [] as RowDataPacket[])
        : [];
      if (candidatos.length !== 1 && nombre) {
        candidatos = await query<RowDataPacket[]>(
          `SELECT id FROM tms_personal
           WHERE empresa_id = ? AND LOWER(TRIM(nombre)) = LOWER(TRIM(?))
             AND id_empleado IS NULL AND tipo IN ('Piloto', 'Auxiliar')
             AND estado = 'Activo'`,
          [empresaId, nombre],
        ).catch(() => [] as RowDataPacket[]);
      }
      // Solo repara coincidencias inequívocas; nunca reasigna una fila ya ligada.
      if (candidatos.length === 1) {
        await execute(
          `UPDATE tms_personal SET id_empleado = ?, codigo = COALESCE(NULLIF(codigo, ''), ?)
           WHERE id = ? AND empresa_id = ? AND id_empleado IS NULL`,
          [empleadoId, codigo || null, candidatos[0].id, empresaId],
        );
        rows = await query<RowDataPacket[]>(
          `SELECT id, nombre, tipo FROM tms_personal
           WHERE empresa_id = ? AND id_empleado = ?
             AND tipo IN ('Piloto', 'Auxiliar') AND estado = 'Activo'
           ORDER BY FIELD(tipo, 'Piloto', 'Auxiliar') LIMIT 1`,
          [empresaId, empleadoId],
        ).catch(() => [] as RowDataPacket[]);
      }
    }
  }
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    nombre: String(rows[0].nombre),
    tipo: String(rows[0].tipo) === "Auxiliar" ? "Auxiliar" : "Piloto",
  };
}

export async function vehiculoPorPlaca(
  empresaId: number,
  placaRaw: string,
): Promise<RowDataPacket | null> {
  const placa = placaRaw.trim().toUpperCase().replace(/\s+/g, "-");
  const placaAlt = placaRaw.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!placaAlt) return null;
  const acceso = `(
    v.empresa_id = ?
    OR EXISTS (
      SELECT 1 FROM flota_vehiculo_acceso a
      WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
    )
  )`;
  const matchExacto = `(
    UPPER(REPLACE(REPLACE(v.placa,' ',''),'-','')) = ?
    OR UPPER(v.placa) = ?
    OR UPPER(REPLACE(v.placa,'-','')) = ?
  )`;
  try {
    const exactas = await query<RowDataPacket[]>(
      `SELECT v.id, v.placa, v.en_taller, v.km_actual, v.activo, v.estado, v.empresa_id
       FROM flota_vehiculos v
       WHERE ${matchExacto} AND ${acceso}
       LIMIT 1`,
      [placaAlt, placa, placaAlt, empresaId, empresaId],
    );
    if (exactas[0]) return exactas[0];

    // Coincidencia parcial única (piloto escribe "147CCT" y la placa es "C-147CCT").
    const parciales = await query<RowDataPacket[]>(
      `SELECT v.id, v.placa, v.en_taller, v.km_actual, v.activo, v.estado, v.empresa_id
       FROM flota_vehiculos v
       WHERE ${acceso}
         AND UPPER(REPLACE(REPLACE(COALESCE(v.placa,''),' ',''),'-','')) LIKE ?
       LIMIT 5`,
      [empresaId, empresaId, `%${placaAlt}%`],
    );
    return parciales.length === 1 ? parciales[0] : null;
  } catch {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, placa, en_taller, km_actual, activo, estado, empresa_id
       FROM flota_vehiculos
       WHERE empresa_id = ?
         AND (
           UPPER(REPLACE(REPLACE(placa,' ',''),'-','')) = ?
           OR UPPER(placa) = ?
           OR UPPER(REPLACE(placa,'-','')) = ?
         )
       LIMIT 1`,
      [empresaId, placaAlt, placa, placaAlt],
    );
    return rows[0] ?? null;
  }
}
