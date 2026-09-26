/**
 * Modelo en memoria de tms_personal + planes para probar la IDENTIDAD de personal en la validación de
 * traslapes (disponibilidad-traslapes.ts → buscarConflictoPersonal) sin una base real.
 *
 * `emularConsultaConflictoPersonal` reproduce, sobre el modelo, las condiciones de JOIN/WHERE de esa
 * consulta (mismas reglas: misma empresa, equivalencia por id_empleado sin importar tipo, o la misma fila
 * cuando no hay id_empleado, estados candidatos, exclusión del propio plan). Las pruebas la acompañan con
 * aserciones sobre el TEXTO del SQL real para que ambos no puedan divergir sin que falle una prueba. La
 * decisión final (ocupación real, solape) es la del código de producción, no la de este emulador.
 */
export type PersonalModelo = { id: number; empresa_id: number; nombre: string; tipo: "Piloto" | "Auxiliar"; id_empleado: number | null; codigo?: string };

export type PlanModelo = {
  id: number;
  empresa_id: number;
  codigo: string;
  estado: string;
  /** "YYYY-MM-DD HH:mm:ss" */
  inicio: string;
  regreso_estimado: string | null;
  piloto_id?: number | null;
  auxiliar_id?: number | null;
  /** tms_plan_pilotos_adicionales.personal_id (piloto EXTRA; máximo 1). */
  pilotoExtra?: number | null;
  /** tms_plan_auxiliares.personal_id */
  auxiliares?: number[];
  llegada_tecnica?: 0 | 1;
  hora_llegada?: string | null;
  cerrado_en?: string | null;
  /** Solo política por intervalos (A2.1): hora_carga guardada del plan. Por defecto, la hora de `inicio`. `null` = plan sin hora. */
  hora_carga?: string | null;
};

export type ModeloPersonal = { personal: PersonalModelo[]; planes: PlanModelo[] };

/**
 * A2.1 — emula la consulta de PERSONAL del motor por intervalos (disponibilidad-programacion-intervalos.ts):
 * `p.fecha_plan <= ?` y (`p.fecha_plan >= ?` o `p.regreso_estimado > ?`), equivalencia por id_empleado, estados y
 * `p.id NOT IN (…)`. Devuelve las columnas que lee el motor; la decisión de solape es del código de producción.
 */
function emularIntervalosPersonal(modelo: ModeloPersonal, sql: string, params: unknown[]): Record<string, unknown>[] {
  const nExcluidos = (/p\.id NOT IN \(([?,]+)\)/.exec(sql)?.[1].split(",").length) ?? 0;
  const empresaId = Number(params[0]);
  const estados = params.slice(1, 6) as string[];
  const fechaFin = String(params[6]);
  const fechaInicio = String(params[7]);
  const inicioVentana = String(params[8]);
  const excluidos = (nExcluidos ? params.slice(-nExcluidos) : []).map(Number);
  const ids = params.slice(10, params.length - nExcluidos).map(Number);
  return modelo.personal.filter((tp) => tp.empresa_id === empresaId && ids.includes(tp.id)).flatMap((tp) => {
    const equivalentes = new Set(modelo.personal.filter((eq) => eq.empresa_id === empresaId &&
      (eq.id === tp.id || (tp.id_empleado !== null && eq.id_empleado === tp.id_empleado))).map((eq) => eq.id));
    return modelo.planes.filter((p) => {
      const fecha = p.inicio.slice(0, 10);
      const regreso = p.regreso_estimado;
      return p.empresa_id === empresaId && estados.includes(p.estado) && !excluidos.includes(p.id)
        && fecha <= fechaFin && (fecha >= fechaInicio || (regreso != null && regreso > inicioVentana))
        && ((p.piloto_id != null && equivalentes.has(p.piloto_id)) || (p.auxiliar_id != null && equivalentes.has(p.auxiliar_id)) ||
          (p.pilotoExtra != null && equivalentes.has(p.pilotoExtra)) || (p.auxiliares ?? []).some((id) => equivalentes.has(id)));
    }).map((p) => ({
      recurso_id: tp.id, nombre: tp.nombre, plan_id: p.id, codigo: p.codigo, fecha_plan: p.inicio.slice(0, 10),
      hora_carga: p.hora_carga !== undefined ? p.hora_carga : p.inicio.slice(11, 19), regreso_estimado: p.regreso_estimado,
    }));
  });
}

export function emularConsultaConflictoPersonal(modelo: ModeloPersonal, sql: string, params: unknown[]): Record<string, unknown>[] {
  if (sql.includes("p.fecha_plan <= ?")) return emularIntervalosPersonal(modelo, sql, params);
  if (sql.includes("p.fecha_plan = ?")) {
    const empresaId = Number(params[0]);
    const fecha = String(params[1]);
    const estados = params.slice(2, 7) as string[];
    const ids = params.slice(7, sql.includes("p.id != ?") ? -1 : undefined).map(Number);
    const excluir = sql.includes("p.id != ?") ? Number(params.at(-1)) : null;
    return modelo.personal.filter((tp) => tp.empresa_id === empresaId && ids.includes(tp.id)).flatMap((tp) => {
      const equivalentes = new Set(modelo.personal.filter((eq) => eq.empresa_id === empresaId &&
        (eq.id === tp.id || (tp.id_empleado !== null && eq.id_empleado === tp.id_empleado))).map((eq) => eq.id));
      return modelo.planes.filter((p) => p.empresa_id === empresaId && p.inicio.slice(0, 10) === fecha &&
        estados.includes(p.estado) && p.id !== excluir &&
        ((p.piloto_id != null && equivalentes.has(p.piloto_id)) ||
          (p.auxiliar_id != null && equivalentes.has(p.auxiliar_id)) ||
          (p.pilotoExtra != null && equivalentes.has(p.pilotoExtra)) || (p.auxiliares ?? []).some((id) => equivalentes.has(id))))
        .map((p) => ({ recurso_id: tp.id, nombre: tp.nombre, plan_id: p.id, codigo: p.codigo, fecha }));
    });
  }
  const [personalId, empresaId] = params as [number, number];
  const excluirPlanId = sql.includes("p.id != ?") ? Number(params[6]) : null;
  const estadosCandidatos = params.slice(2, 6) as string[];

  const tp = modelo.personal.find((x) => x.id === personalId && x.empresa_id === empresaId);
  if (!tp) return [];
  // INNER JOIN tms_personal eq ON eq.empresa_id = tp.empresa_id AND (eq.id = tp.id OR (tp.id_empleado IS NOT NULL AND eq.id_empleado = tp.id_empleado))
  const equivalentes = modelo.personal.filter(
    (eq) => eq.empresa_id === tp.empresa_id && (eq.id === tp.id || (tp.id_empleado !== null && eq.id_empleado === tp.id_empleado)),
  );
  const ids = new Set(equivalentes.map((e) => e.id));
  return modelo.planes
    .filter((p) => p.empresa_id === tp.empresa_id)
    .filter((p) => (p.piloto_id != null && ids.has(p.piloto_id)) || (p.auxiliar_id != null && ids.has(p.auxiliar_id)) || (p.pilotoExtra != null && ids.has(p.pilotoExtra)) || (p.auxiliares ?? []).some((a) => ids.has(a)))
    .filter((p) => estadosCandidatos.includes(p.estado))
    .filter((p) => excluirPlanId == null || p.id !== excluirPlanId)
    .map((p) => ({
      recurso_nombre: tp.nombre,
      plan_id: p.id,
      codigo: p.codigo,
      estado: p.estado,
      inicio: p.inicio,
      regreso_estimado: p.regreso_estimado,
      llegada_tecnica: p.llegada_tecnica ?? 0,
      hora_llegada: p.hora_llegada ?? null,
      cerrado_en: p.cerrado_en ?? null,
    }));
}
