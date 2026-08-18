import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { hoyLocal } from "./dates";

export type TipoRecordatorio =
  | "Contrato"
  | "ObligacionLegal"
  | "ExamenMedico"
  | "CitaLegal"
  | "Licencia" // solo para los generados automáticamente desde empleados.licencia_vence
  | "Otro";

export type Recordatorio = {
  id: number | null; // null = generado automáticamente (licencia), no tiene fila propia
  empresaId: number;
  tipo: TipoRecordatorio;
  titulo: string;
  /** Próxima ocurrencia (YYYY-MM-DD). Para recurrentes, ya calculada al año actual/siguiente. */
  fecha: string;
  recurrente: boolean;
  diasAvisoPrevio: number;
  empleadoId: number | null;
  empleadoNombre?: string | null;
  notas: string | null;
  /** true si la ocurrencia vigente (este año, si es recurrente) ya se marcó atendida. */
  atendido: boolean;
  /** Días que faltan para la fecha (negativo = ya vencido). */
  diasRestantes: number;
  creadoPor: string | null;
  creadoEn: string | null;
};

const TIPOS_VALIDOS = new Set<TipoRecordatorio>([
  "Contrato",
  "ObligacionLegal",
  "ExamenMedico",
  "CitaLegal",
  "Otro",
]);

function diasEntre(hoyIso: string, fechaIso: string): number {
  const [ya, ym, yd] = hoyIso.split("-").map(Number);
  const [fa, fm, fd] = fechaIso.split("-").map(Number);
  const hoyUtc = Date.UTC(ya, ym - 1, yd);
  const fechaUtc = Date.UTC(fa, fm - 1, fd);
  return Math.round((fechaUtc - hoyUtc) / 86_400_000);
}

/**
 * Para recurrentes: calcula la próxima ocurrencia (mes/día de `fechaBase`)
 * a partir de hoy. Si la ocurrencia de este año ya pasó, salta al próximo.
 */
function proximaOcurrencia(fechaBase: string, hoyIso: string): string {
  const [, m, d] = fechaBase.split("-");
  const anioHoy = Number(hoyIso.slice(0, 4));
  const candidataEsteAnio = `${anioHoy}-${m}-${d}`;
  return diasEntre(hoyIso, candidataEsteAnio) >= 0
    ? candidataEsteAnio
    : `${anioHoy + 1}-${m}-${d}`;
}

function mapRecordatorio(r: RowDataPacket, hoyIso: string): Recordatorio {
  const recurrente = Boolean(r.recurrente);
  const fechaBase = String(r.fecha).slice(0, 10);
  const fecha = recurrente ? proximaOcurrencia(fechaBase, hoyIso) : fechaBase;
  const anioOcurrencia = Number(fecha.slice(0, 4));
  const atendido = recurrente
    ? Number(r.atendido_anio) === anioOcurrencia
    : r.atendido_en != null;

  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    tipo: String(r.tipo) as TipoRecordatorio,
    titulo: String(r.titulo),
    fecha,
    recurrente,
    diasAvisoPrevio: Number(r.dias_aviso_previo ?? 7),
    empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
    empleadoNombre: r.empleado_nombre ? String(r.empleado_nombre) : null,
    notas: r.notas ? String(r.notas) : null,
    atendido,
    diasRestantes: diasEntre(hoyIso, fecha),
    creadoPor: r.creado_por ? String(r.creado_por) : null,
    creadoEn: r.creado_en ? String(r.creado_en) : null,
  };
}

const SELECT_BASE = `
  SELECT rec.*, e.nombre AS empleado_nombre
  FROM rrhh_recordatorios rec
  LEFT JOIN empleados e
    ON e.id = rec.empleado_id AND e.empresa_id = rec.empresa_id
`;

/**
 * Licencias de conducir por vencer, generadas al vuelo desde
 * empleados.licencia_vence (no se duplican en rrhh_recordatorios).
 * Solo trae empleados activos con licencia_vence dentro de +/- 1 año, para
 * no barrer toda la tabla en empresas grandes.
 */
async function licenciasComoRecordatorios(
  empresaId: number,
  hoyIso: string,
): Promise<Recordatorio[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre, licencia_vence
     FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo' AND licencia_vence IS NOT NULL
       AND licencia_vence BETWEEN DATE_SUB(?, INTERVAL 1 YEAR) AND DATE_ADD(?, INTERVAL 1 YEAR)`,
    [empresaId, hoyIso, hoyIso],
  );
  return rows.map((r) => {
    const fecha = String(r.licencia_vence).slice(0, 10);
    return {
      id: null,
      empresaId,
      tipo: "Licencia" as TipoRecordatorio,
      titulo: `Licencia de conducir — ${String(r.nombre)}`,
      fecha,
      recurrente: false,
      diasAvisoPrevio: 30,
      empleadoId: Number(r.id),
      empleadoNombre: String(r.nombre),
      notas: null,
      atendido: false, // se renueva la licencia -> cambia licencia_vence -> desaparece de aquí
      diasRestantes: diasEntre(hoyIso, fecha),
      creadoPor: null,
      creadoEn: null,
    };
  });
}

/**
 * Todos los recordatorios vigentes de la empresa (guardados + licencias
 * automáticas), ordenados por los que vencen antes. `soloPendientesProximos`
 * filtra a los no atendidos dentro de su ventana de aviso (para el
 * dashboard); sin ese flag trae todo (para la pantalla de administración).
 */
export async function listarRecordatorios(
  empresaId: number,
  opts?: { soloPendientesProximos?: boolean },
): Promise<Recordatorio[]> {
  const hoyIso = hoyLocal();
  const [rows, licencias] = await Promise.all([
    query<RowDataPacket[]>(
      `${SELECT_BASE} WHERE rec.empresa_id = ? ORDER BY rec.fecha`,
      [empresaId],
    ),
    licenciasComoRecordatorios(empresaId, hoyIso),
  ]);

  let todos = [...rows.map((r) => mapRecordatorio(r, hoyIso)), ...licencias];

  if (opts?.soloPendientesProximos) {
    todos = todos.filter(
      (r) => !r.atendido && r.diasRestantes <= r.diasAvisoPrevio,
    );
  }

  return todos.sort((a, b) => a.diasRestantes - b.diasRestantes);
}

export async function crearRecordatorio(input: {
  empresaId: number;
  tipo: TipoRecordatorio;
  titulo: string;
  fecha: string; // YYYY-MM-DD
  recurrente?: boolean;
  diasAvisoPrevio?: number;
  empleadoId?: number | null;
  notas?: string | null;
  creadoPor: string;
}): Promise<{ ok: boolean; mensaje: string; id?: number }> {
  const titulo = input.titulo.trim();
  if (!titulo) return { ok: false, mensaje: "El título es obligatorio." };
  if (!TIPOS_VALIDOS.has(input.tipo)) {
    return { ok: false, mensaje: "Tipo de recordatorio inválido." };
  }
  if (!input.fecha || Number.isNaN(Date.parse(input.fecha))) {
    return { ok: false, mensaje: "Fecha inválida." };
  }
  if (input.empleadoId) {
    const emp = await query<RowDataPacket[]>(
      `SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [input.empleadoId, input.empresaId],
    );
    if (!emp[0]) {
      return { ok: false, mensaje: "El empleado indicado no existe en esta empresa." };
    }
  }

  const result = await execute(
    `INSERT INTO rrhh_recordatorios
      (empresa_id, tipo, titulo, fecha, recurrente, dias_aviso_previo, empleado_id, notas, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.empresaId,
      input.tipo,
      titulo,
      input.fecha,
      input.recurrente ? 1 : 0,
      input.diasAvisoPrevio ?? 7,
      input.empleadoId || null,
      input.notas?.trim() || null,
      input.creadoPor,
    ],
  );
  return {
    ok: true,
    mensaje: "Recordatorio creado.",
    id: Number((result as ResultSetHeader).insertId),
  };
}

export async function actualizarRecordatorio(
  empresaId: number,
  id: number,
  patch: {
    titulo?: string;
    fecha?: string;
    recurrente?: boolean;
    diasAvisoPrevio?: number;
    empleadoId?: number | null;
    notas?: string | null;
  },
): Promise<{ ok: boolean; mensaje: string }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM rrhh_recordatorios WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  if (!rows[0]) return { ok: false, mensaje: "Recordatorio no encontrado." };

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.titulo !== undefined) {
    const t = patch.titulo.trim();
    if (!t) return { ok: false, mensaje: "El título es obligatorio." };
    sets.push("titulo = ?");
    params.push(t);
  }
  if (patch.fecha !== undefined) {
    sets.push("fecha = ?");
    params.push(patch.fecha);
  }
  if (patch.recurrente !== undefined) {
    sets.push("recurrente = ?");
    params.push(patch.recurrente ? 1 : 0);
  }
  if (patch.diasAvisoPrevio !== undefined) {
    sets.push("dias_aviso_previo = ?");
    params.push(patch.diasAvisoPrevio);
  }
  if (patch.empleadoId !== undefined) {
    sets.push("empleado_id = ?");
    params.push(patch.empleadoId);
  }
  if (patch.notas !== undefined) {
    sets.push("notas = ?");
    params.push(patch.notas || null);
  }
  if (sets.length === 0) return { ok: false, mensaje: "Nada que actualizar." };

  params.push(id, empresaId);
  await execute(
    `UPDATE rrhh_recordatorios SET ${sets.join(", ")} WHERE id = ? AND empresa_id = ?`,
    params,
  );
  return { ok: true, mensaje: "Recordatorio actualizado." };
}

/**
 * Marca la ocurrencia vigente como atendida. Para recurrentes solo aplica
 * al año en curso — al llegar el próximo año vuelve a quedar pendiente
 * automáticamente, sin que nadie tenga que reactivarlo.
 */
export async function marcarRecordatorioAtendido(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT recurrente FROM rrhh_recordatorios WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  if (!rows[0]) return { ok: false, mensaje: "Recordatorio no encontrado." };

  const hoyIso = hoyLocal();
  if (Number(rows[0].recurrente)) {
    await execute(
      `UPDATE rrhh_recordatorios SET atendido_anio = ? WHERE id = ? AND empresa_id = ?`,
      [Number(hoyIso.slice(0, 4)), id, empresaId],
    );
  } else {
    await execute(
      `UPDATE rrhh_recordatorios SET atendido_en = ? WHERE id = ? AND empresa_id = ?`,
      [hoyIso, id, empresaId],
    );
  }
  return { ok: true, mensaje: "Recordatorio marcado como atendido." };
}

export async function eliminarRecordatorio(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const r = await execute(
    `DELETE FROM rrhh_recordatorios WHERE id = ? AND empresa_id = ?`,
    [id, empresaId],
  );
  const afectadas = Number((r as ResultSetHeader).affectedRows ?? 0);
  return afectadas > 0
    ? { ok: true, mensaje: "Recordatorio eliminado." }
    : { ok: false, mensaje: "Recordatorio no encontrado." };
}