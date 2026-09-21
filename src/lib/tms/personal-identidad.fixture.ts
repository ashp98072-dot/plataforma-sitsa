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
  /** tms_plan_auxiliares.personal_id */
  auxiliares?: number[];
  llegada_tecnica?: 0 | 1;
  hora_llegada?: string | null;
  cerrado_en?: string | null;
};

export type ModeloPersonal = { personal: PersonalModelo[]; planes: PlanModelo[] };

export function emularConsultaConflictoPersonal(modelo: ModeloPersonal, sql: string, params: unknown[]): Record<string, unknown>[] {
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
    .filter((p) => (p.piloto_id != null && ids.has(p.piloto_id)) || (p.auxiliar_id != null && ids.has(p.auxiliar_id)) || (p.auxiliares ?? []).some((a) => ids.has(a)))
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
