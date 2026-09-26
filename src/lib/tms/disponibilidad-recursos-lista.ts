import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import {
  ESTADOS_CANDIDATOS_TRASLAPE,
  SQL_HORA_LLEGADA_REAL,
  SQL_LLEGADA_TECNICA,
  prefiltroOcupacion,
  primerCandidatoQueOcupa,
  type IntervaloConsulta,
} from "./disponibilidad-traslapes";

/**
 * PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1 — versión EN LOTE de
 * `primerConflictoTraslape` (disponibilidad-traslapes.ts): en vez de
 * comprobar un recurso puntual ya elegido, calcula de una sola vez qué
 * pilotos/auxiliares/unidades de TODA la empresa chocan con el intervalo
 * del viaje que se está armando — para pintar el badge "Asignado ·
 * PLAN-XXX" en los buscadores de Programación sin filtrar los que ya están
 * ocupados de la lista (el usuario debe poder verlos).
 *
 * Reutiliza EXACTAMENTE el mismo criterio de "ocupación real" (nunca la
 * fecha_plan+hora_carga→regreso_estimado a secas): mismos estados
 * candidatos, mismo prefiltro SQL y mismo desempate en JS
 * (primerCandidatoQueOcupa, exportado desde disponibilidad-traslapes.ts) —
 * ninguna regla de negocio se duplica aquí, solo cambia la FORMA de la
 * consulta (todos los recursos de la empresa en una sola query, agrupados
 * en JS, en vez de una query por recurso ya elegido).
 */

export type ConflictoRecursoLista = {
  planId: number;
  planCodigo: string;
  /** "YYYY-MM-DD HH:mm:ss" — igual formato que ConflictoTraslape.inicioConflicto. */
  horaInicio: string;
  /** `null` = viaje físicamente activo sin llegada técnica registrada (ver disponibilidad-traslapes.ts) — sin fin real conocido, nunca inventado. */
  horaFin: string | null;
};

const CANDIDATOS_PLACEHOLDERS = ESTADOS_CANDIDATOS_TRASLAPE.map(() => "?").join(",");

function aConflicto(c: { planId: number; codigo: string; inicioConflicto: string; finConflicto: string | null }): ConflictoRecursoLista {
  return { planId: c.planId, planCodigo: c.codigo, horaInicio: c.inicioConflicto, horaFin: c.finConflicto };
}

/**
 * Piloto/auxiliar ocupado, por `empleados.id` — mismo id que ya usan los
 * buscadores de Programación (PilotoSelect/AuxiliaresSelect leen su catálogo
 * de /rrhh/personal-ops, que devuelve filas de `empleados`, no de
 * `tms_personal`). `tms_personal.id_empleado` es el puente real entre
 * ambos — el mismo que resuelve/llena `personalDesdeEmpleado` al guardar un
 * plan (ver personal-resolucion.ts) — así que agrupar por `id_empleado` da
 * exactamente el mismo recurso físico que el desplegable está mostrando.
 * Personal sin vínculo a RRHH (`id_empleado IS NULL`) no puede aparecer en
 * ese catálogo de todas formas, así que se excluye de la consulta.
 */
export async function listarConflictosPersonal(
  empresaId: number,
  intervalo: IntervaloConsulta,
  excluirPlanId: number | null,
): Promise<Map<number, ConflictoRecursoLista>> {
  const prefiltro = prefiltroOcupacion(intervalo);
  const rows = await query<RowDataPacket[]>(
    `SELECT tp.id_empleado AS empleado_id, p.id AS plan_id, p.codigo, p.estado,
            DATE_FORMAT(TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')), '%Y-%m-%d %H:%i:%s') AS inicio,
            DATE_FORMAT(p.regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado,
            ${SQL_LLEGADA_TECNICA} AS llegada_tecnica,
            DATE_FORMAT(${SQL_HORA_LLEGADA_REAL}, '%Y-%m-%d %H:%i:%s') AS hora_llegada,
            DATE_FORMAT(p.cerrado_en, '%Y-%m-%d %H:%i:%s') AS cerrado_en
     FROM tms_personal tp
     INNER JOIN tms_planes_viaje p
       ON p.empresa_id = tp.empresa_id
      AND (p.piloto_id = tp.id OR p.auxiliar_id = tp.id
           OR EXISTS (SELECT 1 FROM tms_plan_auxiliares pa WHERE pa.plan_id = p.id AND pa.personal_id = tp.id)
           OR EXISTS (SELECT 1 FROM tms_plan_pilotos_adicionales pe WHERE pe.plan_id = p.id AND pe.personal_id = tp.id))
     WHERE tp.empresa_id = ? AND tp.id_empleado IS NOT NULL
       AND p.estado IN (${CANDIDATOS_PLACEHOLDERS})
       ${excluirPlanId ? "AND p.id != ?" : ""}
       ${prefiltro.sql}
     ORDER BY tp.id_empleado, inicio`,
    [
      empresaId,
      ...ESTADOS_CANDIDATOS_TRASLAPE,
      ...(excluirPlanId ? [excluirPlanId] : []),
      ...prefiltro.params,
    ],
  );

  const porEmpleado = new Map<number, RowDataPacket[]>();
  for (const r of rows) {
    const empleadoId = Number(r.empleado_id);
    const arr = porEmpleado.get(empleadoId) ?? [];
    arr.push(r);
    porEmpleado.set(empleadoId, arr);
  }

  const resultado = new Map<number, ConflictoRecursoLista>();
  for (const [empleadoId, filas] of porEmpleado) {
    // "codigo" como nombreCampo: el listado no necesita el `.nombre` que
    // devuelve primerCandidatoQueOcupa (el llamador ya conoce el nombre
    // del piloto/auxiliar por su propio catálogo) — aConflicto lo descarta.
    const candidato = primerCandidatoQueOcupa(filas, "codigo", intervalo);
    if (candidato) resultado.set(empleadoId, aConflicto(candidato));
  }
  return resultado;
}

/** Unidad ocupada, por `tms_unidades.placa` (en mayúsculas) — mismo valor que ya usa PlacaSelect como llave de cada opción. */
export async function listarConflictosUnidades(
  empresaId: number,
  intervalo: IntervaloConsulta,
  excluirPlanId: number | null,
): Promise<Map<string, ConflictoRecursoLista>> {
  const prefiltro = prefiltroOcupacion(intervalo);
  const rows = await query<RowDataPacket[]>(
    `SELECT u.placa, p.id AS plan_id, p.codigo, p.estado,
            DATE_FORMAT(TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')), '%Y-%m-%d %H:%i:%s') AS inicio,
            DATE_FORMAT(p.regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado,
            ${SQL_LLEGADA_TECNICA} AS llegada_tecnica,
            DATE_FORMAT(${SQL_HORA_LLEGADA_REAL}, '%Y-%m-%d %H:%i:%s') AS hora_llegada,
            DATE_FORMAT(p.cerrado_en, '%Y-%m-%d %H:%i:%s') AS cerrado_en
     FROM tms_unidades u
     INNER JOIN tms_planes_viaje p ON p.empresa_id = u.empresa_id AND p.unidad_id = u.id
     WHERE u.empresa_id = ?
       AND p.estado IN (${CANDIDATOS_PLACEHOLDERS})
       ${excluirPlanId ? "AND p.id != ?" : ""}
       ${prefiltro.sql}
     ORDER BY u.placa, inicio`,
    [
      empresaId,
      ...ESTADOS_CANDIDATOS_TRASLAPE,
      ...(excluirPlanId ? [excluirPlanId] : []),
      ...prefiltro.params,
    ],
  );

  const porPlaca = new Map<string, RowDataPacket[]>();
  for (const r of rows) {
    const placa = String(r.placa).toUpperCase();
    const arr = porPlaca.get(placa) ?? [];
    arr.push(r);
    porPlaca.set(placa, arr);
  }

  const resultado = new Map<string, ConflictoRecursoLista>();
  for (const [placa, filas] of porPlaca) {
    const candidato = primerCandidatoQueOcupa(filas, "codigo", intervalo);
    if (candidato) resultado.set(placa, aConflicto(candidato));
  }
  return resultado;
}
