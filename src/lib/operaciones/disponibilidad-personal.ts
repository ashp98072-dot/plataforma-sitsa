import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { listarParadasDePlanes, type PlanParada } from "@/lib/tms/paradas";

/**
 * Disponibilidad operativa REAL de pilotos y auxiliares para Programación.
 * Módulo aditivo: no modifica TMS, Flota, Portal ni RRHH; solo lee.
 *
 * Deliberadamente NO usa:
 * - hora_entrada_teorica / hora_salida_teorica (pertenecen a RRHH/asistencia,
 *   no a disponibilidad logística — los pilotos no tienen horario fijo);
 * - ninguna duración/hora fin estimada (no existe ese dato hoy; no se
 *   inventa una regla de negocio nueva para suplirlo).
 *
 * Fuente de verdad de "no disponible" son hechos reales: viaje abierto en
 * Flota, incidencia RRHH clasificada como bloqueante, o personal/empleado
 * inactivo. "Otro plan el mismo día" es SIEMPRE informativo — un piloto o
 * auxiliar puede tener varios viajes el mismo día.
 */

// ---------------------------------------------------------------------------
// Clasificación de incidencias — vive ÚNICAMENTE aquí, no en periodos.ts ni
// en ningún archivo de RRHH. No cambia el catálogo TIPOS_INCIDENCIA.
// ---------------------------------------------------------------------------

const INCIDENCIAS_BLOQUEANTES = new Set([
  "Vacaciones",
  "Permiso con goce",
  "Permiso sin goce",
  "IGSS",
  "Fallecimiento de Familiar",
  "Nacimiento de Hijo",
  "Enfermedad",
  "Sin Goce de Salario",
  "Matrimonio",
  "Citaciones Judiciales",
  "A cuenta de Vacaciones",
  "Falta",
  "Suspensión",
]);

const INCIDENCIAS_INFORMATIVAS = new Set(["Médico", "Cumpleaños", "Otro"]);

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type EstadoDisponibilidad =
  | "disponible"
  | "no_disponible"
  | "verificacion_parcial";

export type ViajeActualPersonal = {
  flotaViajeId: number;
  horaSalidaReal: string;
  placa: string | null;
  planId: number | null;
  planCodigo: string | null;
  rol: "piloto" | "auxiliar";
};

export type OtroPlanDelDia = {
  planId: number;
  planCodigo: string;
  horaCarga: string | null;
  placa: string | null;
  origen: string | null;
  destino: string | null;
};

export type IncidenciaPersonal = {
  id: number;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
};

export type AdvertenciaPersonal =
  | { tipo: "otro_plan_dia"; plan: OtroPlanDelDia }
  | { tipo: "incidencia_informativa"; incidencia: IncidenciaPersonal }
  | { tipo: "sin_vinculo_empleado" };

export type DisponibilidadPersonal = {
  personalId: number;
  empleadoId: number | null;
  nombre: string;
  tipo: string; // "Piloto" | "Auxiliar"
  estadoDisponibilidad: EstadoDisponibilidad;
  /** === (estadoDisponibilidad === "disponible"). Nunca true en verificacion_parcial. */
  disponible: boolean;
  viajeActual: ViajeActualPersonal | null;
  otrosPlanesDelDia: OtroPlanDelDia[];
  incidenciasBloqueantes: IncidenciaPersonal[];
  advertencias: AdvertenciaPersonal[];
};

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Origen (primera parada tipo Carga) y destino (última Descarga/Entrega). */
function origenDestino(paradas: PlanParada[]): {
  origen: string | null;
  destino: string | null;
} {
  if (!paradas.length) return { origen: null, destino: null };
  const ordenadas = [...paradas].sort((a, b) => a.orden - b.orden);
  const origen = ordenadas.find((p) => p.tipo === "Carga")?.lugar_nombre ?? null;
  const destino =
    [...ordenadas].reverse().find((p) => p.tipo === "Descarga" || p.tipo === "Entrega")
      ?.lugar_nombre ?? null;
  return { origen, destino };
}

/** Unión personal_id de tms_plan_auxiliares + auxiliar_id legado, sin duplicar. */
function auxiliaresDePlan(
  planId: number,
  auxMap: Map<number, number[]>,
  auxiliarIdLegado: number | null,
): number[] {
  const ids = new Set(auxMap.get(planId) ?? []);
  if (auxiliarIdLegado != null) ids.add(auxiliarIdLegado);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

export async function listarDisponibilidadPersonal(
  empresaId: number,
  fecha: string, // YYYY-MM-DD — el día evaluado (planes "del día")
): Promise<DisponibilidadPersonal[]> {
  // 1) Personal (Piloto + Auxiliar) + estado del empleado vinculado, en una sola query.
  const personalRows = await query<RowDataPacket[]>(
    `SELECT tp.id, tp.id_empleado, tp.nombre, tp.tipo, tp.estado AS personal_estado,
            e.estado AS empleado_estado
     FROM tms_personal tp
     LEFT JOIN empleados e ON e.id = tp.id_empleado
     WHERE tp.empresa_id = ?`,
    [empresaId],
  ).catch(() => [] as RowDataPacket[]);

  // 2) Viajes reales abiertos de la empresa — piloto vía empleado_id, y el
  //    plan vinculado (si existe) para poder resolver auxiliares en el paso 3.
  const abiertosRows = await query<RowDataPacket[]>(
    `SELECT fv.id, fv.empleado_id, fv.plan_id, fv.hora_salida,
            ve.placa, tpv.codigo AS plan_codigo, tpv.auxiliar_id AS plan_auxiliar_id
     FROM flota_viajes fv
     LEFT JOIN flota_vehiculos ve ON ve.id = fv.vehiculo_id
     LEFT JOIN tms_planes_viaje tpv ON tpv.id = fv.plan_id
     WHERE fv.empresa_id = ? AND fv.estado = 'abierto'`,
    [empresaId],
  ).catch(() => [] as RowDataPacket[]);

  const planIdsAbiertos = [
    ...new Set(
      abiertosRows.map((r) => (r.plan_id != null ? Number(r.plan_id) : null)).filter((id): id is number => id != null),
    ),
  ];

  // 3) Auxiliares (N) de los planes vinculados a viajes abiertos — SOLO si
  //    el viaje abierto tiene plan_id. Si no lo tiene, no hay forma de saber
  //    qué auxiliares participan (limitación real, documentada, no se inventa).
  const auxAbiertosMap = new Map<number, number[]>();
  if (planIdsAbiertos.length) {
    const rows = await query<RowDataPacket[]>(
      `SELECT plan_id, personal_id FROM tms_plan_auxiliares WHERE plan_id IN (${planIdsAbiertos
        .map(() => "?")
        .join(",")})`,
      planIdsAbiertos,
    ).catch(() => [] as RowDataPacket[]);
    for (const r of rows) {
      const pid = Number(r.plan_id);
      const list = auxAbiertosMap.get(pid) ?? [];
      list.push(Number(r.personal_id));
      auxAbiertosMap.set(pid, list);
    }
  }

  // Mapea personalId -> viaje actual (piloto directo, o auxiliar vía plan_id).
  const viajeActualPorPersonal = new Map<number, ViajeActualPersonal>();
  for (const r of abiertosRows) {
    const planId = r.plan_id != null ? Number(r.plan_id) : null;
    const planCodigo = r.plan_codigo != null ? String(r.plan_codigo) : null;
    const placa = r.placa != null ? String(r.placa) : null;
    const horaSalidaReal = String(r.hora_salida);

    // Piloto: por empleado_id del viaje real -> buscamos su fila de tms_personal.
    const empleadoIdPiloto = r.empleado_id != null ? Number(r.empleado_id) : null;
    if (empleadoIdPiloto != null) {
      const personalPiloto = personalRows.find(
        (p) => p.id_empleado != null && Number(p.id_empleado) === empleadoIdPiloto,
      );
      if (personalPiloto) {
        viajeActualPorPersonal.set(Number(personalPiloto.id), {
          flotaViajeId: Number(r.id),
          horaSalidaReal,
          placa,
          planId,
          planCodigo,
          rol: "piloto",
        });
      }
    }

    // Auxiliar: solo si el viaje abierto tiene plan_id vinculado.
    if (planId != null) {
      const auxiliarIdLegado =
        r.plan_auxiliar_id != null ? Number(r.plan_auxiliar_id) : null;
      const auxIds = auxiliaresDePlan(planId, auxAbiertosMap, auxiliarIdLegado);
      for (const personalId of auxIds) {
        if (viajeActualPorPersonal.has(personalId)) continue; // ya tiene viaje (p.ej. piloto)
        viajeActualPorPersonal.set(personalId, {
          flotaViajeId: Number(r.id),
          horaSalidaReal,
          placa,
          planId,
          planCodigo,
          rol: "auxiliar",
        });
      }
    }
  }

  // 4) Planes del día (Programado / En ruta) — para advertencia "otro plan el mismo día".
  const planesDiaRows = await query<RowDataPacket[]>(
    `SELECT p.id, p.codigo, p.hora_carga, p.piloto_id, p.auxiliar_id, u.placa
     FROM tms_planes_viaje p
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     WHERE p.empresa_id = ? AND p.fecha_plan = ? AND p.estado IN ('Programado', 'En ruta')`,
    [empresaId, fecha],
  ).catch(() => [] as RowDataPacket[]);

  const planIdsDia = planesDiaRows.map((r) => Number(r.id));

  // 5) Auxiliares (N) de los planes del día.
  const auxDiaMap = new Map<number, number[]>();
  if (planIdsDia.length) {
    const rows = await query<RowDataPacket[]>(
      `SELECT plan_id, personal_id FROM tms_plan_auxiliares WHERE plan_id IN (${planIdsDia
        .map(() => "?")
        .join(",")})`,
      planIdsDia,
    ).catch(() => [] as RowDataPacket[]);
    for (const r of rows) {
      const pid = Number(r.plan_id);
      const list = auxDiaMap.get(pid) ?? [];
      list.push(Number(r.personal_id));
      auxDiaMap.set(pid, list);
    }
  }

  // Reutiliza el helper ya existente de paradas (no se duplica su SQL) para
  // poder mostrar origen/destino de cada plan del día.
  const paradasDiaMap = planIdsDia.length
    ? await listarParadasDePlanes(planIdsDia).catch(() => new Map<number, PlanParada[]>())
    : new Map<number, PlanParada[]>();

  // Mapea personalId -> lista de otros planes del día en que participa.
  const planesDiaPorPersonal = new Map<number, OtroPlanDelDia[]>();
  function agregarPlanDia(personalId: number, plan: OtroPlanDelDia) {
    const list = planesDiaPorPersonal.get(personalId) ?? [];
    list.push(plan);
    planesDiaPorPersonal.set(personalId, list);
  }
  for (const r of planesDiaRows) {
    const planId = Number(r.id);
    const { origen, destino } = origenDestino(paradasDiaMap.get(planId) ?? []);
    const plan: OtroPlanDelDia = {
      planId,
      planCodigo: String(r.codigo),
      horaCarga: r.hora_carga != null ? String(r.hora_carga) : null,
      placa: r.placa != null ? String(r.placa) : null,
      origen,
      destino,
    };
    if (r.piloto_id != null) agregarPlanDia(Number(r.piloto_id), plan);
    const auxiliarIdLegado = r.auxiliar_id != null ? Number(r.auxiliar_id) : null;
    for (const personalId of auxiliaresDePlan(planId, auxDiaMap, auxiliarIdLegado)) {
      agregarPlanDia(personalId, plan);
    }
  }

  // 6) Incidencias que cubren `fecha`, solo para los empleados vinculados.
  const empleadoIds = [
    ...new Set(
      personalRows
        .map((p) => (p.id_empleado != null ? Number(p.id_empleado) : null))
        .filter((id): id is number => id != null),
    ),
  ];
  const incidenciasPorEmpleado = new Map<number, IncidenciaPersonal[]>();
  if (empleadoIds.length) {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, id_empleado, tipo, fecha_inicio, fecha_fin
       FROM incidencias
       WHERE empresa_id = ? AND id_empleado IN (${empleadoIds.map(() => "?").join(",")})
         AND fecha_inicio <= ? AND fecha_fin >= ?`,
      [empresaId, ...empleadoIds, fecha, fecha],
    ).catch(() => [] as RowDataPacket[]);
    for (const r of rows) {
      const empId = Number(r.id_empleado);
      const list = incidenciasPorEmpleado.get(empId) ?? [];
      list.push({
        id: Number(r.id),
        tipo: String(r.tipo),
        fechaInicio: String(r.fecha_inicio).slice(0, 10),
        fechaFin: String(r.fecha_fin).slice(0, 10),
      });
      incidenciasPorEmpleado.set(empId, list);
    }
  }

  // ---- Ensamblado final ----
  const resultado: DisponibilidadPersonal[] = personalRows.map((p) => {
    const personalId = Number(p.id);
    const empleadoId = p.id_empleado != null ? Number(p.id_empleado) : null;
    const personalActivo = String(p.personal_estado ?? "") === "Activo";
    const empleadoEstado = p.empleado_estado != null ? String(p.empleado_estado) : null;

    const viajeActual = viajeActualPorPersonal.get(personalId) ?? null;
    const otrosPlanesDelDia = planesDiaPorPersonal.get(personalId) ?? [];

    const incidenciasDelDia =
      empleadoId != null ? incidenciasPorEmpleado.get(empleadoId) ?? [] : [];
    const incidenciasBloqueantes = incidenciasDelDia.filter((i) =>
      INCIDENCIAS_BLOQUEANTES.has(i.tipo),
    );
    const incidenciasInformativas = incidenciasDelDia.filter((i) =>
      INCIDENCIAS_INFORMATIVAS.has(i.tipo),
    );

    const advertencias: AdvertenciaPersonal[] = [];
    for (const plan of otrosPlanesDelDia) {
      advertencias.push({ tipo: "otro_plan_dia", plan });
    }
    for (const incidencia of incidenciasInformativas) {
      advertencias.push({ tipo: "incidencia_informativa", incidencia });
    }
    if (empleadoId == null) {
      advertencias.push({ tipo: "sin_vinculo_empleado" });
    }

    // Reglas en orden — un hecho negativo duro siempre gana.
    let estadoDisponibilidad: EstadoDisponibilidad;
    if (!personalActivo) {
      estadoDisponibilidad = "no_disponible";
    } else if (empleadoId != null && empleadoEstado !== "Activo") {
      estadoDisponibilidad = "no_disponible";
    } else if (viajeActual !== null) {
      estadoDisponibilidad = "no_disponible";
    } else if (incidenciasBloqueantes.length > 0) {
      estadoDisponibilidad = "no_disponible";
    } else if (empleadoId == null) {
      estadoDisponibilidad = "verificacion_parcial";
    } else {
      estadoDisponibilidad = "disponible";
    }

    return {
      personalId,
      empleadoId,
      nombre: String(p.nombre),
      tipo: String(p.tipo),
      estadoDisponibilidad,
      disponible: estadoDisponibilidad === "disponible",
      viajeActual,
      otrosPlanesDelDia,
      incidenciasBloqueantes,
      advertencias,
    };
  });

  return resultado;
}
