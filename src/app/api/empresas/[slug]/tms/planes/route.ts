import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoria, registrarAuditoriaTx } from "@/lib/auditoria";
import { requireTenantProgramacion, requireTenantProgramacionOTms } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import {
  listarDisponibilidadVehiculos,
  placasDisponiblesParaPlan,
} from "@/lib/operaciones/disponibilidad";
import {
  asegurarCodigoPlanUnico,
  generarCodigoPlan,
} from "@/lib/tms/codigo-plan";
import {
  guardarParadasPlan,
  listarParadasDePlanes,
  type ParadaInput,
} from "@/lib/tms/paradas";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { vehiculoPorPlaca } from "@/lib/flota/pilotos";
import { debeLimpiarTarifaPorCambioDeRuta, tarifaParaSnapshot, tarifasActivasDeVariasRutas } from "@/lib/tms/ruta-tarifas";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { ahoraLocal, hoyLocal, toIsoDate } from "@/lib/rrhh/dates";
import { listarViaticosRechazadosDelPlan, personalRecienAsignadoDelPlan, sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { planesConCierreManual } from "@/lib/tms/cierre-manual-planes";
import { SQL_HORA_LLEGADA_REAL } from "@/lib/tms/disponibilidad-traslapes";
import type { RecursoDia } from "@/lib/tms/disponibilidad-programacion-dia";
import {
  mensajeConflictoProgramacionIntervalo,
  primerConflictoProgramacionIntervalo,
  ventanaProgramacionSegura,
} from "@/lib/tms/disponibilidad-programacion-intervalos";
import { resolverTcInterno } from "@/lib/tms/tc-plan";
import {
  calcularCambiosRecursos,
  camposTocados,
  evaluarDisponibilidadPersonal,
  evaluarDisponibilidadUnidad,
  personalQueSale,
  resolverCambioTc,
  resolverSeleccionPersonal,
  validarEstadoEditable,
  validarFechaNoPasada,
  validarMotivoCambioRecursos,
  validarRegresoPosteriorASalida,
  validarRemocionConViaticos,
} from "@/lib/tms/programacion-validacion-recursos";
import { esTc, normalizarTipoUnidad } from "@/lib/flota/tipo-unidad";
import { personalDesdeEmpleado } from "@/lib/tms/personal-resolucion";
import { upsertLugar, guardarAuxiliaresPlan } from "@/lib/tms/plan-comunes";
import type { ResultSetHeader } from "mysql2/promise";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Fase P5.1c: mensaje informativo devuelto junto a un PATCH exitoso — nunca
 * bloquea el guardado, solo advierte (viaje/estado actual, otro plan del
 * día, incidencia informativa). Pensado para que P5.2 (UI) lo muestre en el
 * modal; se agrega de forma aditiva, ningún consumidor existente lo lee hoy.
 */
type AdvertenciaPatch = { tipo: string; mensaje: string };

/**
 * Fase P5.1c (ajuste final confirmado) + OPS-1 (revisión): reglas por
 * estado del plan para ediciones desde Programación. "Programado" Y
 * "Cargado" (no listados aquí) admiten edición operativa completa —
 * "Cargado" NO se trata como "En ruta". "En ruta" admite únicamente notas
 * (bloquea piloto, auxiliares, unidad, fecha, paradas y horaCarga —
 * horaCarga es planificación; la hora real de salida vive en
 * flota_viajes.hora_salida y no debe alterarse retrospectivamente una vez
 * iniciado el viaje).
 *
 * OPS-1: "Descargado" (operación finalizada por el piloto, pendiente de
 * cierre administrativo) YA NO bloquea edición — Operaciones necesita
 * poder corregir lo que realmente ocurrió (destino, tarifa, personal,
 * observaciones…) ANTES del cierre, porque la ejecución real puede haber
 * diferido de lo programado. Las protecciones existentes (disponibilidad,
 * traslapes, viáticos ya avanzados, snapshots históricos) siguen
 * aplicando sin cambios — "editable" no significa "sin reglas". Solo
 * "Cerrado" y "Cancelado" bloquean toda edición; el cierre en sí (
 * Descargado -> Cerrado) es una acción aparte, ver
 * /tms/planes/[id]/cerrar y src/lib/tms/cierre-viaje.ts — nunca ocurre
 * vía este PATCH general.
 */
// ESTADOS_SOLO_NOTAS / ESTADOS_BLOQUEADOS viven ahora en programacion-validacion-recursos.ts (PR-0 edición rápida).

/**
 * OPS-2.1: misma definición que la columna calculada de GET — un alias de
 * SELECT no se puede reutilizar en WHERE, así que se comparte esta
 * constante en vez de escribir la condición dos veces "a mano". OJO: es la
 * MISMA definición que ya usan notificaciones/route.ts (alerta "Viajes
 * pendientes de cierre") y cierre-viaje.ts — esos dos archivos quedan
 * fuera del alcance de este módulo, así que la constante vive solo aquí;
 * si algún día diverge, extraerla a un helper compartido sería lo
 * correcto. Movida a nivel de módulo en OPS-3.2b para que tanto GET como
 * PATCH puedan reutilizarla (antes vivía solo dentro de GET).
 */
const SQL_PENDIENTE_CIERRE = `(
                p.estado NOT IN ('Cerrado', 'Cancelado')
                AND EXISTS (
                  SELECT 1 FROM flota_viajes fv
                  WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
                )
              )`;

/**
 * OPS-4.2e: indicador derivado "Viaje atrasado" para la lista de
 * Programación/TMS — MISMO criterio ya aprobado en OPS-4.2d (alerta de
 * la campana en notificaciones/route.ts): viaje físicamente iniciado (En
 * ruta/Cargado) cuyo regreso_estimado ya venció y que TODAVÍA no
 * registra llegada técnica. "Programado" vencido queda deliberadamente
 * FUERA — es "no iniciado", no "atrasado" (posible señal futura aparte,
 * no este ticket).
 *
 * "Llegada técnica" es el mismo EXISTS flota_viajes...estado='cerrado'
 * que ya usa SQL_PENDIENTE_CIERRE arriba, aquí en NOT — por diseño,
 * "atrasado" y "pendiente_cierre" son mutuamente excluyentes: si ya hay
 * llegada, el plan es "pendiente de cierre", nunca "atrasado". No se
 * importa desde notificaciones/route.ts (mismo criterio de aislamiento
 * ya documentado para SQL_PENDIENTE_CIERRE: dos rutas de API distintas,
 * si algún día diverge, extraerla a un helper compartido sería lo
 * correcto).
 *
 * Requiere UN parámetro posicional ("ahora", ver ahoraLocal() más abajo)
 * — a diferencia de SQL_PENDIENTE_CIERRE, que no necesita ninguno.
 */
const SQL_ATRASADO = `(
                p.estado IN ('En ruta', 'Cargado')
                AND p.regreso_estimado IS NOT NULL
                AND p.regreso_estimado < ?
                AND NOT EXISTS (
                  SELECT 1 FROM flota_viajes fv
                  WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
                )
              )`;

/** Viático de un viaje tal como lo necesita la edición rápida (ids de tms_personal). */
type ViaticoPlanLista = { personalId: number; rol: string; montoSugerido: number; montoAsignado: number; estado: string };

/** Viáticos de varios viajes en UNA consulta (acotada por empresa). Sin tabla/columna aún: lista vacía, nunca rompe el GET. */
async function viaticosDePlanes(empresaId: number, planIds: number[]): Promise<Map<number, ViaticoPlanLista[]>> {
  const map = new Map<number, ViaticoPlanLista[]>();
  const ids = [...new Set(planIds.filter((id) => id > 0))];
  if (!ids.length) return map;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT plan_id, personal_id, rol, monto_sugerido, monto_asignado, estado
       FROM tms_viaticos WHERE empresa_id = ? AND plan_id IN (${ids.map(() => "?").join(",")})
       ORDER BY plan_id, personal_id`,
      [empresaId, ...ids],
    );
    for (const r of rows) {
      const pid = Number(r.plan_id);
      map.set(pid, [...(map.get(pid) ?? []), {
        personalId: Number(r.personal_id), rol: String(r.rol ?? ""), montoSugerido: Number(r.monto_sugerido ?? 0),
        montoAsignado: Number(r.monto_asignado ?? 0), estado: String(r.estado ?? "PROGRAMADO"),
      }]);
    }
  } catch {
    /* tabla aún no existe */
  }
  return map;
}

/** Auxiliar de un plan con su id real de tms_personal (Fase P4.3). */
type AuxiliarPlan = {
  personalId: number;
  empleadoId: number | null;
  nombre: string;
  telefono: string | null;
};

async function auxiliaresDePlanes(
  planIds: number[],
): Promise<Map<number, AuxiliarPlan[]>> {
  const map = new Map<number, AuxiliarPlan[]>();
  const ids = [...new Set(planIds.map(Number).filter((id) => id > 0))];
  if (!ids.length) return map;
  try {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await query<RowDataPacket[]>(
      `SELECT a.plan_id, a.personal_id, per.id_empleado, per.nombre, emp.telefono
       FROM tms_plan_auxiliares a
       INNER JOIN tms_personal per ON per.id = a.personal_id
       LEFT JOIN empleados emp
         ON emp.id = per.id_empleado AND emp.empresa_id = per.empresa_id
       WHERE a.plan_id IN (${placeholders})
       ORDER BY a.plan_id, a.orden, a.id`,
      ids,
    );
    for (const r of rows) {
      const pid = Number(r.plan_id);
      const list = map.get(pid) ?? [];
      list.push({
        personalId: Number(r.personal_id),
        empleadoId: r.id_empleado != null ? Number(r.id_empleado) : null,
        nombre: String(r.nombre),
        telefono: r.telefono ? String(r.telefono) : null,
      });
      map.set(pid, list);
    }
  } catch {
    /* tabla aún no existe */
  }
  return map;
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  // Corrección de matriz de permisos: este GET alimenta tanto el tablero
  // de Programación como la tabla de solo lectura de TMS — acepta
  // programacion:ver O tms:ver (nunca exige ambos).
  const guard = await requireTenantProgramacionOTms(slug);
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  if (url.searchParams.get("nextCodigo") === "1") {
    const fecha =
      url.searchParams.get("fecha") ||
      new Date().toISOString().slice(0, 10);
    const codigo = await generarCodigoPlan(guard.empresa.id, fecha);
    return NextResponse.json(
      { codigo },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // OPS-2.1 — filtros servidor OPCIONALES para que el LIMIT 200 de abajo
  // deje de poder "perder" viajes silenciosamente conforme crece el
  // historial (hallazgo de la auditoría). Sin parámetros, el comportamiento
  // es EXACTAMENTE el de antes (compat: plan-form.tsx y cualquier otro
  // consumidor que llame el GET sin querystring). Nombres alineados con el
  // precedente ya existente en /tms/programacion/reporte (fechaDesde/
  // fechaHasta), no se inventan nombres nuevos.
  const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const fechaDesdeParam = url.searchParams.get("fechaDesde");
  const fechaHastaParam = url.searchParams.get("fechaHasta");
  if (fechaDesdeParam && !FECHA_RE.test(fechaDesdeParam)) {
    return NextResponse.json(
      { error: "fechaDesde inválida; usa YYYY-MM-DD." },
      { status: 400 },
    );
  }
  if (fechaHastaParam && !FECHA_RE.test(fechaHastaParam)) {
    return NextResponse.json(
      { error: "fechaHasta inválida; usa YYYY-MM-DD." },
      { status: 400 },
    );
  }
  // El rango solo se aplica si vienen los DOS extremos — un solo extremo
  // suelto se ignora en vez de interpretarlo a medias.
  const usarRangoFecha = Boolean(fechaDesdeParam && fechaHastaParam);
  const pendienteCierreParam = url.searchParams.get("pendienteCierre") === "1";
  // TMS-PROGRAMACION-NAVEGACION-DIRECTA-PLAN: ?id=<planId> — trae un plan
  // puntual por su id, SIN depender del rango Hoy/Mañana/Semana (que solo
  // cubre hoy en adelante) ni del filtro de pendientes de cierre. Nunca
  // confía en el id a secas: se AND-ea con `p.empresa_id = ?` igual que
  // cualquier otra condición de este mismo WHERE — un id de otra empresa
  // simplemente no matchea ninguna fila (0 resultados, nunca la fila de
  // otra empresa). Reutiliza EXACTAMENTE el mismo SELECT/enriquecimiento
  // de abajo (paradas, auxiliares, disponibilidad) — no es un endpoint
  // paralelo, es la misma consulta con una condición adicional.
  const idParam = url.searchParams.get("id");
  const idNum = idParam ? Number(idParam) : null;
  // AJUSTE PRE-MERGE PR #175 (punto 2): entero positivo estricto — 31.5,
  // -1, 0 o cualquier valor no numérico ("abc") se rechazan por igual.
  // Number.isFinite() por sí solo aceptaba decimales (31.5), que no tiene
  // sentido como id de fila.
  const usarId = idNum != null && Number.isInteger(idNum) && idNum > 0;
  if (idParam && !usarId) {
    return NextResponse.json({ error: "id inválido." }, { status: 400 });
  }

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const condiciones = ["p.empresa_id = ?"];
  // OPS-4.2e: "ahora" en Guatemala (ahoraLocal(), no NOW() de MySQL ni
  // Date().toISOString()) para el indicador derivado `atrasado` —
  // SQL_ATRASADO va en la lista SELECT (antes del WHERE en el texto de
  // la query), así que su `?` debe ser el PRIMER parámetro posicional.
  const ahora = ahoraLocal();
  const paramsRows: SqlParams = [ahora, guard.empresa.id];
  // AJUSTE PRE-MERGE PR #175 (punto 1) — `id=` tiene PRECEDENCIA
  // ABSOLUTA: si viene, es el ÚNICO filtro adicional al WHERE (además de
  // empresa_id), sin importar que fechaDesde/fechaHasta/pendienteCierre
  // también vengan en la misma URL. El objetivo del ticket es que un
  // plan puntual se resuelva SIEMPRE, independientemente de cualquier
  // filtro operativo — mezclar `id=31` con un `fechaDesde/fechaHasta`
  // que no coincida con la fecha real del plan #31 lo haría desaparecer
  // otra vez (exactamente el bug original que este ticket corrige), y
  // pendienteCierre=1 lo ocultaría si el plan no está pendiente de
  // cierre. `usarRangoFecha`/`pendienteCierreParam` siguen calculándose
  // arriba (siguen aplicando su propia validación de fecha), pero no
  // participan del WHERE cuando usarId es true.
  if (usarId) {
    condiciones.push("p.id = ?");
    paramsRows.push(idNum as number);
  } else {
    if (usarRangoFecha) {
      condiciones.push("p.fecha_plan BETWEEN ? AND ?");
      paramsRows.push(fechaDesdeParam as string, fechaHastaParam as string);
    }
    if (pendienteCierreParam) {
      condiciones.push(SQL_PENDIENTE_CIERRE);
    }
  }
  // LIMIT: "pendienteCierre=1" y "id=" son vistas puntuales que NUNCA deben
  // poder perder un registro por límite (la primera por volumen bajo, la
  // segunda porque es a lo sumo 1 fila) — se dejan sin límite. El GET sin
  // filtros (compat) y el filtro por rango de fecha conservan el límite de
  // seguridad de siempre.
  const limitSql = pendienteCierreParam || usarId ? "" : "LIMIT 200";

  const [rows, disp] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT p.id, p.codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
              p.hora_carga, p.estado, p.cerrado_por,
              DATE_FORMAT(p.cerrado_en, '%Y-%m-%dT%H:%i') AS cerrado_en,
              -- OPS-1 (corregido): "pendiente de cierre" ya no es un valor
              -- de estado (marcarPlanDescargado ya no se invoca desde
              -- llegada) — se calcula: el plan no está Cerrado/Cancelado Y
              -- ya existe un registro de llegada real en flota_viajes para
              -- este plan. Cubre tanto viajes nuevos ("En ruta" + llegada)
              -- como el histórico "Descargado" (que siempre tuvo su
              -- flota_viajes en 'cerrado' antes de marcarse así).
              ${SQL_PENDIENTE_CIERRE} AS pendiente_cierre,
              -- OPS-4.2e: indicador derivado, mutuamente excluyente con
              -- pendiente_cierre por diseño (ver SQL_ATRASADO arriba).
              ${SQL_ATRASADO} AS atrasado,
              p.tipo_traslado, p.notas,
              DATE_FORMAT(p.regreso_estimado, '%Y-%m-%dT%H:%i') AS regreso_estimado,
              -- Regreso REAL: fuente única flota_viajes.hora_llegada (llegada
              -- física registrada por Flota/Piloto). NULL si no hubo llegada
              -- (p. ej. cierre manual). No se duplica en tms_planes_viaje y
              -- cerrado_en NUNCA se presenta como llegada.
              DATE_FORMAT(${SQL_HORA_LLEGADA_REAL}, '%Y-%m-%dT%H:%i') AS regreso_real,
              p.tarifa_comercial, p.tarifa_id, p.tarifa_nombre_historico, p.tarifa_monto_historico, p.tarifa_moneda_historico,
              p.costo_operativo_referencia, p.referencia_cliente, p.ruta_id, p.ruta_codigo_historico,
              p.lugar_descarga_historico, p.contacto_nombre_historico, p.contacto_cargo_historico,
              p.contacto_telefono_historico,
              -- PROGRAMACION-VIAJES-TERCERIZADOS-1
              p.tipo_viaje, p.piloto_externo_nombre, p.auxiliares_externos, p.unidad_externa_placa,
              p.unidad_externa_descripcion, p.transportista_externo, p.costo_tercerizado,
              -- PROGRAMACION-TC-CAJA-REMOLQUE-1: TC del viaje. "tc" es el valor a
              -- mostrar (Tercerizado: snapshot externo; Propio: placa del TC interno
              -- o, si el vehículo ya no existe, su fotografía).
              p.tc_vehiculo_id, p.tc_placa_historica, p.tc_externo_placa,
              CASE WHEN p.tipo_viaje = 'Tercerizado' THEN p.tc_externo_placa
                   ELSE COALESCE(tcv.placa, p.tc_placa_historica) END AS tc,
              c.nombre AS cliente, u.placa, pil.nombre AS piloto, aux.nombre AS auxiliar,
              -- EDICIÓN RÁPIDA PR-3 (aditivo): vehículo de Flota de la unidad (mismo JOIN que ya da la placa).
              u.flota_vehiculo_id,
              p.piloto_id, p.auxiliar_id, pil.id_empleado AS piloto_empleado_id,
              emp_pil.telefono AS piloto_telefono,
              aux.id_empleado AS auxiliar_empleado_id,
              emp_aux.telefono AS auxiliar_telefono,
              COALESCE(ev.cnt, 0) AS evidencias
       FROM tms_planes_viaje p
       LEFT JOIN tms_clientes c ON c.id = p.cliente_id
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id
       LEFT JOIN flota_vehiculos tcv ON tcv.id = p.tc_vehiculo_id
       LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
       LEFT JOIN empleados emp_pil
         ON emp_pil.id = pil.id_empleado AND emp_pil.empresa_id = p.empresa_id
       LEFT JOIN tms_personal aux ON aux.id = p.auxiliar_id
       LEFT JOIN empleados emp_aux
         ON emp_aux.id = aux.id_empleado AND emp_aux.empresa_id = p.empresa_id
       LEFT JOIN (
         SELECT plan_id, COUNT(*) AS cnt
         FROM tms_evidencias
         GROUP BY plan_id
       ) ev ON ev.plan_id = p.id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY p.fecha_plan DESC, p.id DESC
       ${limitSql}`,
      paramsRows,
    ),
    listarDisponibilidadVehiculos(guard.empresa.id).catch(() => null),
  ]);

  const planIds = rows.map((r) => Number(r.id));
  const [paradasMap, auxMap, cierreManualIds] = await Promise.all([
    listarParadasDePlanes(planIds),
    auxiliaresDePlanes(planIds),
    planesConCierreManual(
      guard.empresa.id,
      rows.filter((r) => r.estado === "Cerrado").map((r) => Number(r.id)),
    ),
  ]);
  // EDICIÓN RÁPIDA (aditivo, en lote y DESPUÉS de las lecturas previas): viáticos por viaje y tarifas ACTIVAS por ruta.
  const viaticosMap = await viaticosDePlanes(guard.empresa.id, planIds);
  const tarifasPorRuta = await tarifasActivasDeVariasRutas(guard.empresa.id, rows.map((r) => Number(r.ruta_id)).filter((n) => n > 0)).catch(
    () => new Map<number, { tarifas: unknown[]; predeterminadaId: number | null }>(),
  );

  const planes = rows.map((r) => {
    const id = Number(r.id);
    // piloto_id/auxiliar_id se separan del resto para no duplicarlos en el
    // payload junto a sus versiones camelCase (pilotoId/auxiliaresDetalle).
    const {
      piloto_id,
      auxiliar_id,
      piloto_empleado_id,
      piloto_telefono,
      auxiliar_empleado_id,
      auxiliar_telefono,
      flota_vehiculo_id,
      ...resto
    } = r;
    const pilotoId = piloto_id != null ? Number(piloto_id) : null;

    const extras = auxMap.get(id) ?? [];
    // Fase P4.3: misma semántica de siempre — si tms_plan_auxiliares tiene
    // filas para este plan, se usan esas (ya con personal_id real); si no,
    // fallback al auxiliar_id legado de la columna singular de la propia
    // tms_planes_viaje (que SÍ es un personal_id real, vía su FK). No es
    // una unión de ambos — es "preferir lo nuevo, si no hay, usar lo
    // legado", igual que el comportamiento previo para `auxiliares`.
    const auxiliaresDetalle: AuxiliarPlan[] =
      extras.length > 0
        ? extras
        : auxiliar_id != null && r.auxiliar
          ? [{
              personalId: Number(auxiliar_id),
              empleadoId: auxiliar_empleado_id != null ? Number(auxiliar_empleado_id) : null,
              nombre: String(r.auxiliar),
              telefono: auxiliar_telefono ? String(auxiliar_telefono) : null,
            }]
          : [];
    const auxList = auxiliaresDetalle.map((a) => a.nombre);
    const paradas = paradasMap.get(id) ?? [];
    return {
      ...resto,
      // Aditivo: el cierre fue manual (sin llegada física). Solo aplica a Cerrado.
      cierre_manual: cierreManualIds.has(id),
      // Aditivo (Fase P4.3): id real del piloto, cuando existe.
      pilotoId,
      pilotoEmpleadoId: piloto_empleado_id != null ? Number(piloto_empleado_id) : null,
      pilotoTelefono: piloto_telefono ? String(piloto_telefono) : null,
      auxiliares: auxList,
      auxiliar: auxList.join(", ") || null,
      // Aditivo (Fase P4.3): auxiliares con su personal_id real. No
      // reemplaza `auxiliares` (string[]) — TMS y otros consumidores
      // existentes siguen leyendo ese campo tal cual.
      auxiliaresDetalle,
      // EDICIÓN RÁPIDA PR-3 (aditivo): ids EXACTOS que el validador de edición rápida compara como snapshot —
      // unidad por flota_vehiculos.id y auxiliares SOLO de tms_plan_auxiliares (sin el fallback legado de
      // auxiliaresDetalle), en su orden (el primero es el principal).
      flotaVehiculoId: flota_vehiculo_id != null ? Number(flota_vehiculo_id) : null,
      auxiliarPersonalIds: extras.map((a) => a.personalId),
      // EDICIÓN RÁPIDA (aditivo): viáticos del viaje por tms_personal.id (mismo espacio de ids que piloto/auxiliares),
      // para el snapshot de concurrencia y para mostrar/editar montos. Ver viaticosDePlanes.
      viaticos: viaticosMap.get(id) ?? [],
      paradas,
      paradasPendientes: paradas.filter(
        (p) => p.requiere_evidencia && p.evidencias < 1,
      ).length,
    };
  });

  const vehiculos = disp?.vehiculos ?? [];
  // PROGRAMACION-TC-CAJA-REMOLQUE-1: los TC nunca se ofrecen como Unidad
  // (selector propio de TC en el formulario). `estadoVehiculos` (abajo) sí
  // los trae todos, con `tipoUnidad`, para que el cliente los separe.
  const placasFlota = placasDisponiblesParaPlan(vehiculos.filter((v) => !esTc(v.tipoUnidad)));
  const vehiculosDisponibles = vehiculos
    .filter((v) => v.puedeEnviar && !esTc(v.tipoUnidad))
    .map((v) => ({
      placa: v.placa,
      marca: v.marca,
      modelo: v.modelo,
      compartido: v.compartido,
      esPropio: v.esPropio,
    }));
  const resumenFlota = disp?.resumen ?? {
    total: 0,
    disponibles: placasFlota.length,
    enTaller: 0,
    enRuta: 0,
    inactivos: 0,
    propios: 0,
    compartidos: 0,
  };
  // Fase P3 (Programación): estado real por placa, sin queries nuevas — ya
  // estaba calculado en `vehiculos` (listarDisponibilidadVehiculos), solo
  // se exponía filtrado/recortado como vehiculosDisponibles. No cambia
  // listarDisponibilidadVehiculos ni la lógica de disponibilidad.
  //
  // PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1: se agregan marca/modelo/
  // compartido (mismos campos que ya trae `vehiculos`, sin query nueva) para
  // que PlacaSelect pueda mostrar TODAS las unidades (incluidas taller/en
  // ruta/inactivas) con su propio motivo, en vez de solo las que ya venían
  // filtradas en vehiculosDisponibles — ese campo NO se toca, sigue igual
  // para cualquier otro consumidor.
  const estadoVehiculos = vehiculos.map((v) => ({
    // PROGRAMACION-TC-CAJA-REMOLQUE-1: id de flota_vehiculos — el selector de TC
    // manda tcVehiculoId (el servidor lo revalida: acceso + clasificación).
    id: v.id,
    placa: v.placa,
    marca: v.marca,
    modelo: v.modelo,
    compartido: v.compartido,
    esPropio: v.esPropio,
    estadoDisponibilidad: v.estadoDisponibilidad,
    motivoNoDisponible: v.motivoNoDisponible,
    tipoUnidad: normalizarTipoUnidad(v.tipoUnidad),
  }));

  return NextResponse.json(
    {
      planes,
      placasFlota,
      vehiculosDisponibles,
      estadoVehiculos,
      resumenFlota,
      // EDICIÓN RÁPIDA (aditivo): { [rutaId]: [{ id, nombre, monto, moneda, predeterminada }] } de las rutas presentes.
      tarifasPorRuta: Object.fromEntries([...tarifasPorRuta.entries()].map(([rutaId, t]) => [rutaId, t.tarifas])),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.object({
  codigo: z.string().optional(),
  fechaPlan: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horaCarga: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).optional(),
  tipoTraslado: z.string().optional(),
  regresoEstimado: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  tarifaComercial: z.number().nonnegative().optional(),
  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§2) — id de la opción de
  // tarifa del catálogo (tms_ruta_tarifas) elegida para este viaje; se
  // valida contra la ruta y la empresa y se snapshotea (nombre/monto/
  // moneda) en tms_planes_viaje.
  tarifaId: z.number().int().positive().optional(),
  // TMS-GASTOS-REPORTES-1 (bloqueo 2): fotografía histórica del costo
  // operativo de referencia de la ruta usada, al momento de crear el
  // plan — mismo criterio que tarifaComercial arriba. Cambios futuros en
  // tms_cliente_rutas.costo_operativo NUNCA alteran este valor ya
  // guardado (ver aplicarDefaultsRutaSinSobrescribir en ruta-defaults.ts).
  costoOperativoReferencia: z.number().nonnegative().optional(),
  referenciaCliente: z.string().max(160).optional(),
  notas: z.string().optional(),
  clienteId: z.number().int().positive().optional(),
  clienteNombre: z.string().optional(),
  placa: z.string().optional(),
  pilotoNombre: z.string().optional(),
  auxiliarNombre: z.string().optional(),
  auxiliarNombres: z.array(z.string().min(2)).max(8).optional(),
  pilotoEmpleadoId: z.number().int().positive().optional(),
  auxiliarEmpleadoId: z.number().int().positive().optional(),
  auxiliarEmpleadoIds: z.array(z.number().int().positive()).max(8).optional(),
  // PROGRAMACION-VIAJES-TERCERIZADOS-1 — 'Propio' (default, compatibilidad
  // con el flujo de siempre) | 'Tercerizado' (la empresa sigue cobrando el
  // servicio; lo ejecuta otra empresa/proveedor). Los 6 campos *Externo*
  // solo aplican cuando tipoViaje = 'Tercerizado' — ver validación más
  // abajo (nunca se confía en que el cliente HTTP mande el tipo correcto
  // sin datos, o datos sin el tipo correcto).
  tipoViaje: z.enum(["Propio", "Tercerizado"]).optional(),
  pilotoExternoNombre: z.string().max(160).optional(),
  auxiliaresExternos: z.array(z.string().min(1).max(160)).max(8).optional(),
  unidadExternaPlaca: z.string().max(40).optional(),
  unidadExternaDescripcion: z.string().max(160).optional(),
  transportistaExterno: z.string().max(160).optional(),
  costoTercerizado: z.number().nonnegative().optional(),
  // PROGRAMACION-TC-CAJA-REMOLQUE-1 — TC/caja/remolque del viaje. Propio:
  // `tcVehiculoId` (flota_vehiculos.id, clasificado como TC; opcional).
  // Tercerizado: `tcExternoPlaca` (solo texto, snapshot). Nunca se mezclan.
  tcVehiculoId: z.number().int().positive().optional(),
  tcExternoPlaca: z.string().max(40).optional(),
  lugarCarga: z.string().optional(),
  lugarDescarga: z.string().optional(),
  // VIAT-4/VIAT-4b: de qué ruta maestra (tms_cliente_rutas) salió la
  // fotografía copiada a este viaje — puramente informativo/histórico,
  // ver sql/migrate-2026-08-viat-4-contactos-rutas.sql y
  // sql/migrate-2026-08-viat-4b-rutas-correcciones.sql. El reporte
  // tradicional lee lugarDescargaHistorico directamente, nunca "primera
  // parada". contacto*Historico es la copia de nombre/cargo/teléfono en
  // el momento — un cambio posterior del contacto del cliente no debe
  // alterar este viaje ya creado.
  rutaId: z.number().int().positive().optional(),
  rutaCodigo: z.string().max(40).optional(),
  lugarDescargaHistorico: z.string().max(300).optional(),
  contactoNombreHistorico: z.string().max(160).optional(),
  contactoCargoHistorico: z.string().max(120).optional(),
  contactoTelefonoHistorico: z.string().max(80).optional(),
  paradas: z
    .array(
      z.object({
        lugarNombre: z.string().min(1),
        tipo: z.enum(["Carga", "Descarga", "Entrega"]).optional(),
        requiereEvidencia: z.boolean().optional(),
        // VIAT-1: referencia opcional a la ubicación guardada del cliente
        // (tms_cliente_ubicaciones) de la que salió esta parada.
        clienteUbicacionId: z.number().int().positive().optional(),
      }),
    )
    .max(20)
    .optional(),
  // Mejora Programación (Opción A) — viáticos definidos desde el PRIMER
  // guardado del viaje. `empleadoId` aquí es el id de RRHH (empleados.id)
  // — el MISMO espacio de ids que pilotoEmpleadoId/auxiliarEmpleadoIds
  // (deliberadamente NO se llama "personalId": en TMS ese nombre ya
  // designa tms_personal.id, un id interno resuelto server-side que el
  // cliente nunca conoce antes de guardar el plan — no se expone). Se
  // valida más abajo que cada empleadoId corresponda realmente al
  // piloto/auxiliares RESUELTOS de este mismo POST — nunca se confía en
  // lo que mande el cliente HTTP.
  viaticosAsignados: z
    .array(
      z.object({
        empleadoId: z.number().int().positive(),
        montoAsignado: z.number().min(0),
      }),
    )
    .max(9)
    .optional()
    .refine((arr) => !arr || new Set(arr.map((x) => x.empleadoId)).size === arr.length, {
      message: "No se permiten empleadoId duplicados en viaticosAsignados.",
    }),
});

// TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 1): `personalDesdeEmpleado` y
// `validarPersonalId` se extrajeron a `@/lib/tms/personal-resolucion`
// (mismo código, sin cambios de comportamiento) para que la futura
// importación masiva de Programación pueda reutilizarlas sin duplicar
// lógica — ver import arriba.

// TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 5): `upsertLugar` y
// `guardarAuxiliaresPlan` se extrajeron a `@/lib/tms/plan-comunes`
// (mismo código, sin cambios de comportamiento) para que
// confirmarImportacionProgramacion pueda reutilizarlas sin duplicar
// lógica — ver import arriba.

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  // Corrección de matriz de permisos: crear un viaje es una acción propia
  // de Programación — ya no basta con "tms:editar" genérico.
  const guard = await requireTenantProgramacion(slug, "crear");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const empresaId = guard.empresa.id;
  const salidaProgramada = `${d.fechaPlan}T${(d.horaCarga || "00:00").slice(0, 5)}`;
  if (d.regresoEstimado && d.regresoEstimado <= salidaProgramada) {
    return NextResponse.json(
      { error: "El regreso estimado debe ser posterior a la salida programada." },
      { status: 400 },
    );
  }
  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§2/§5) — snapshot de la
  // tarifa elegida: se valida contra ESTA empresa y la ruta del viaje, y
  // se congela nombre/monto/moneda. Si cambia la tarifa maestra después,
  // este viaje NO cambia (el snapshot es la fuente para los reportes de
  // "qué tarifa se usó"; el monto de ingresos sigue en tarifa_comercial).
  const snapshotTarifa =
    d.tarifaId && d.rutaId ? await tarifaParaSnapshot(empresaId, d.rutaId, d.tarifaId) : null;
  if (d.tarifaId && !snapshotTarifa) {
    return NextResponse.json(
      { error: "La tarifa seleccionada no pertenece a esa ruta de esta empresa o no está activa." },
      { status: 400 },
    );
  }
  // El monto del viaje se DERIVA de la tarifa elegida, pero sigue siendo
  // editable como override manual (si el usuario mandó tarifaComercial).
  const tarifaComercialFinal = d.tarifaComercial ?? snapshotTarifa?.monto ?? null;

  // PROGRAMACION-VIAJES-TERCERIZADOS-1 — 'Propio' (default) usa los
  // catálogos internos tal cual siempre (bloque más abajo, sin cambios de
  // comportamiento); 'Tercerizado' NUNCA toca tms_personal/tms_unidades —
  // solo guarda el snapshot de texto capturado. Validado aquí, antes de
  // escribir nada: un Tercerizado sin al menos el nombre del piloto
  // externo no tiene sentido operativo.
  const tipoViaje = d.tipoViaje === "Tercerizado" ? "Tercerizado" : "Propio";
  const esTercerizado = tipoViaje === "Tercerizado";
  if (esTercerizado && !d.pilotoExternoNombre?.trim()) {
    return NextResponse.json(
      { error: "Un viaje tercerizado requiere el nombre del piloto externo." },
      { status: 400 },
    );
  }
  const opcional = (v: string | null | undefined): string | null => { const t = (v ?? "").trim(); return t ? t : null; };
  const snapshotTercerizado = {
    pilotoExternoNombre: esTercerizado ? opcional(d.pilotoExternoNombre) : null,
    auxiliaresExternos: esTercerizado ? opcional((d.auxiliaresExternos ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 8).join("\n")) : null,
    unidadExternaPlaca: esTercerizado ? opcional(d.unidadExternaPlaca?.trim().toUpperCase()) : null,
    unidadExternaDescripcion: esTercerizado ? opcional(d.unidadExternaDescripcion) : null,
    transportistaExterno: esTercerizado ? opcional(d.transportistaExterno) : null,
    costoTercerizado: esTercerizado ? (d.costoTercerizado ?? null) : null,
    tcExternoPlaca: esTercerizado ? opcional(d.tcExternoPlaca?.trim().toUpperCase()) : null,
  };
  // Un viaje Tercerizado NUNCA acepta un TC interno como sustituto del
  // snapshot externo (mismo criterio que piloto/unidad).
  if (esTercerizado && d.tcVehiculoId != null) {
    return NextResponse.json(
      { error: "Un viaje tercerizado no usa TC interno: captura el TC externo como texto." },
      { status: 400 },
    );
  }

  let clienteId: number | null = null;
  let unidadId: number | null = null;
  let pilotoId: number | null = null;
  // Declaradas aquí (antes del bloque `if (tipoViaje === "Propio")` de
  // abajo) para que sigan en [] / null cuando el viaje es Tercerizado —
  // eso basta para que primerConflictoTraslape/sincronizarViaticosPlan
  // (más abajo, sin cambios) no encuentren ningún recurso interno que
  // validar ni ningún viático que crear, sin necesidad de un `if`
  // adicional en ninguno de los dos.
  const auxPersonalIds: number[] = [];
  let auxiliarId: number | null = null;
  // Mejora Programación (Opción A) — mapa empleadoId (RRHH) -> personalId
  // (tms_personal, recién resuelto) SOLO para el personal ligado a RRHH —
  // es la clave para traducir viaticosAsignados (que llega en espacio de
  // empleadoId, el único que el cliente conoce antes de guardar) al
  // personalId real que espera sincronizarViaticosPlan. Vacío en un viaje
  // Tercerizado: no hay personal interno que resolver, así que cualquier
  // viaticosAsignados que llegara (no debería) no calza con nada y se
  // rechaza más abajo, igual que ya pasaría con un empleadoId inventado.
  const empleadoIdAPersonalId = new Map<number, number>();

  const codigo = await asegurarCodigoPlanUnico(
    empresaId,
    d.fechaPlan,
    d.codigo,
  );

  if (d.clienteId) {
    const found = await query<RowDataPacket[]>(
      "SELECT id FROM tms_clientes WHERE empresa_id = ? AND id = ? LIMIT 1",
      [empresaId, d.clienteId],
    );
    if (found[0]) clienteId = Number(found[0].id);
  }
  if (!clienteId && d.clienteNombre?.trim()) {
    const found = await query<RowDataPacket[]>(
      "SELECT id FROM tms_clientes WHERE empresa_id = ? AND nombre = ? LIMIT 1",
      [empresaId, d.clienteNombre.trim()],
    );
    if (found[0]) {
      clienteId = Number(found[0].id);
    } else {
      try {
        const { crearClienteDesdeTms } = await import(
          "@/lib/clientes/repository"
        );
        const created = await crearClienteDesdeTms(empresaId, {
          nombre: d.clienteNombre.trim(),
        });
        clienteId = created.tmsClienteId;
      } catch {
        const r = await execute(
          "INSERT INTO tms_clientes (empresa_id, nombre) VALUES (?, ?)",
          [empresaId, d.clienteNombre.trim()],
        );
        clienteId = Number(r.insertId);
      }
    }
  }
  // PROGRAMACION-VIAJES-TERCERIZADOS-1 — TODO este bloque (placa, piloto,
  // auxiliares: catálogos internos de Flota/RRHH) es EXCLUSIVO de
  // 'Propio' — código sin cambios de comportamiento respecto a antes de
  // este ticket. Un viaje 'Tercerizado' nunca lo ejecuta: unidadId/
  // pilotoId quedan NULL y auxPersonalIds vacío (declarados arriba), así
  // que ni se crea un tms_personal/tms_unidades para el recurso externo,
  // ni primerConflictoTraslape/sincronizarViaticosPlan (más abajo)
  // encuentran nada que validar o que generar.
  if (tipoViaje === "Propio") {
    if (d.placa?.trim()) {
      const placaNorm = d.placa.trim().toUpperCase();
      // Fase A4.2: si listarDisponibilidadVehiculos (server-side, ya valida
      // acceso propio/compartido contra Flota) encontró el vehículo real,
      // guardamos también su id en tms_unidades.flota_vehiculo_id. Nunca se
      // confía en un id enviado por el cliente — sale exclusivamente de esta
      // consulta ya validada.
      let flotaVehiculoId: number | null = null;
      try {
        const dispCheck = await listarDisponibilidadVehiculos(empresaId);
        const v = dispCheck.vehiculos.find(
          (x) => x.placa.toUpperCase() === placaNorm,
        );
        if (v && esTc(v.tipoUnidad)) {
          return NextResponse.json(
            { error: `La placa ${placaNorm} está clasificada como TC: asígnala en el campo TC, no como Unidad.` },
            { status: 400 },
          );
        }
        if (v && !v.puedeEnviar) {
          return NextResponse.json(
            {
              error: `La placa ${placaNorm} no está disponible: ${v.motivoNoDisponible ?? v.estadoDisponibilidad}.`,
            },
            { status: 400 },
          );
        }
        flotaVehiculoId = v?.id ?? null;
      } catch {
        /* si falla disponibilidad, no bloquear creación */
      }
      const r = await execute(
        `INSERT INTO tms_unidades (empresa_id, placa, tipo, flota_vehiculo_id)
         VALUES (?, ?, 'Camion', ?)
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           flota_vehiculo_id = COALESCE(flota_vehiculo_id, VALUES(flota_vehiculo_id))`,
        [empresaId, placaNorm, flotaVehiculoId],
      );
      unidadId = Number(r.insertId);
    }

    pilotoId = await personalDesdeEmpleado(
      empresaId,
      d.pilotoEmpleadoId,
      "Piloto",
    );
    if (!pilotoId && d.pilotoNombre?.trim()) {
      const r = await execute(
        "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Piloto')",
        [empresaId, d.pilotoNombre.trim()],
      );
      pilotoId = Number(r.insertId);
    }
    if (pilotoId && d.pilotoEmpleadoId) empleadoIdAPersonalId.set(d.pilotoEmpleadoId, pilotoId);

    const auxIdsRaw =
      d.auxiliarEmpleadoIds?.length
        ? d.auxiliarEmpleadoIds
        : d.auxiliarEmpleadoId
          ? [d.auxiliarEmpleadoId]
          : [];
    for (const eid of auxIdsRaw.slice(0, 8)) {
      const pid = await personalDesdeEmpleado(empresaId, eid, "Auxiliar");
      if (pid) {
        auxPersonalIds.push(pid);
        empleadoIdAPersonalId.set(eid, pid);
      }
    }
    const nombresAux = [
      ...(d.auxiliarNombres ?? []),
      ...(d.auxiliarNombre?.trim() ? [d.auxiliarNombre.trim()] : []),
    ];
    for (const nom of nombresAux) {
      if (auxPersonalIds.length >= 8) break;
      const nombre = nom.trim();
      if (nombre.length < 2) continue;
      const existing = await query<RowDataPacket[]>(
        `SELECT id FROM tms_personal
         WHERE empresa_id = ? AND tipo = 'Auxiliar' AND LOWER(TRIM(nombre)) = LOWER(?)
         LIMIT 1`,
        [empresaId, nombre],
      );
      if (existing[0]) {
        auxPersonalIds.push(Number(existing[0].id));
        continue;
      }
      const r = await execute(
        "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Auxiliar')",
        [empresaId, nombre],
      );
      auxPersonalIds.push(Number(r.insertId));
    }
    auxiliarId = auxPersonalIds[0] ?? null;
  }

  // PROGRAMACION-TC-CAJA-REMOLQUE-1 — TC INTERNO (solo Propio, opcional):
  // se valida en servidor (acceso de la empresa + clasificación TC) y
  // queda en su propia columna, nunca en unidad_id. La disponibilidad por
  // fecha se valida más abajo junto con piloto/auxiliares/unidad.
  let tcVehiculoId: number | null = null;
  let tcPlacaHistorica: string | null = null;
  if (tipoViaje === "Propio" && d.tcVehiculoId != null) {
    const tc = await resolverTcInterno(empresaId, d.tcVehiculoId);
    if (!tc.ok) return NextResponse.json({ error: tc.error }, { status: tc.status });
    tcVehiculoId = tc.vehiculoId;
    tcPlacaHistorica = tc.placa;
  }

  // Mejora Programación (Opción A) — validar viaticosAsignados ANTES de
  // escribir absolutamente nada: cada empleadoId debe corresponder
  // realmente al piloto/auxiliares RESUELTOS arriba (empleadoIdAPersonalId
  // -- nunca se confía en lo que mande el cliente). Si algo no calza, 400
  // inmediato, sin crear el plan (CASO E). Aquí es donde empleadoId se
  // traduce al personalId real (tms_personal.id) que espera
  // sincronizarViaticosPlan — el único lugar de todo el flujo donde ese id
  // interno aparece, nunca antes.
  const viaticosOverrides: { personalId: number; montoAsignado: number }[] = [];
  if (d.viaticosAsignados?.length) {
    for (const item of d.viaticosAsignados) {
      const personalIdReal = empleadoIdAPersonalId.get(item.empleadoId);
      if (personalIdReal == null) {
        return NextResponse.json(
          {
            error: `El personal indicado en viáticos (empleado #${item.empleadoId}) no corresponde al piloto/auxiliares de este viaje.`,
          },
          { status: 400 },
        );
      }
      viaticosOverrides.push({ personalId: personalIdReal, montoAsignado: item.montoAsignado });
    }
  }

  // Paradas: array nuevo o compatibilidad con 2 campos clásicos
  const paradasInput: ParadaInput[] = (d.paradas ?? []).filter((p) =>
    p.lugarNombre?.trim(),
  );
  if (!paradasInput.length) {
    if (d.lugarCarga?.trim()) {
      paradasInput.push({
        lugarNombre: d.lugarCarga.trim(),
        tipo: "Carga",
        requiereEvidencia: true,
      });
    }
    if (d.lugarDescarga?.trim()) {
      paradasInput.push({
        lugarNombre: d.lugarDescarga.trim(),
        tipo: "Descarga",
        requiereEvidencia: true,
      });
    }
  }

  const lugarCargaId = await upsertLugar(
    empresaId,
    paradasInput.find((p) => p.tipo === "Carga")?.lugarNombre || d.lugarCarga,
    "Carga",
  );
  const lugarDescargaId = await upsertLugar(
    empresaId,
    paradasInput.find((p) => p.tipo === "Descarga" || p.tipo === "Entrega")
      ?.lugarNombre || d.lugarDescarga,
    "Descarga",
  );

  // Piloto, auxiliares y unidad quedan ocupados durante toda fecha_plan.
  // La hora y el regreso estimado no modifican esta reserva diaria.
  const recursosNuevoPlan: RecursoDia[] = [
    ...(pilotoId ? [{ tipo: "piloto" as const, id: pilotoId }] : []),
    ...auxPersonalIds.map((id) => ({ tipo: "auxiliar" as const, id })),
    ...(unidadId ? [{ tipo: "unidad" as const, id: unidadId }] : []),
    // PROGRAMACION-TC-CAJA-REMOLQUE-1: el TC interno entra a la misma reserva diaria.
    ...(tcVehiculoId ? [{ tipo: "tc" as const, id: tcVehiculoId }] : []),
  ];
  const validarDiaNuevo = recursosNuevoPlan.length > 0;

  // OPS-4.2c: disponibilidad FÍSICA actual (viaje realmente abierto en
  // Flota, flota_viajes.estado='abierto') — protección complementaria a
  // la reserva por fecha_plan de más abajo. El POST nunca la había consultado para
  // piloto/auxiliares (solo para la unidad, vía listarDisponibilidadVehiculos
  // arriba) — hueco detectado en OPS-4.1.
  //
  // Mismo criterio ya usado por el PATCH (bloque VIAT-2/OPS-3.2c más
  // abajo en este archivo, sin duplicar su lógica de incidencias/otros
  // planes del día — aquí SOLO el hecho físico "viaje en curso" que pidió
  // este ticket): solo aplica para HOY. Un viaje abierto ahora mismo NO
  // debe bloquear una programación futura — no se sabe cuándo terminará
  // y no se inventa una duración estimada; la protección de días futuros
  // corresponde exclusivamente a las asignaciones de esa fecha_plan.
  //
  // Una sola llamada a listarDisponibilidadPersonal (piloto + auxiliares
  // juntos, vía un Map por personalId) — nunca una por recurso, evita N+1.
  // Sin piloto ni auxiliares, o si no es hoy, no se ejecuta en absoluto.
  const esHoyPost = d.fechaPlan === hoyLocal();
  if (esHoyPost && (pilotoId != null || auxPersonalIds.length > 0)) {
    const personalDisp = await listarDisponibilidadPersonal(empresaId, d.fechaPlan);
    const dispPorPersonalId = new Map(personalDisp.map((p) => [p.personalId, p]));
    const recursosFisicos: { personalId: number; rol: "piloto" | "auxiliar" }[] = [
      ...(pilotoId != null ? [{ personalId: pilotoId, rol: "piloto" as const }] : []),
      ...auxPersonalIds.map((id) => ({ personalId: id, rol: "auxiliar" as const })),
    ];
    for (const r of recursosFisicos) {
      const disp = dispPorPersonalId.get(r.personalId);
      // No debería faltar (tms_personal ya se resolvió arriba) — si por
      // alguna inconsistencia no aparece, no se bloquea por un dato que
      // no se pudo verificar (mismo criterio ya usado por el PATCH y por
      // la disponibilidad de placa de este mismo POST).
      if (!disp) continue;
      if (disp.viajeActual != null) {
        const etiqueta =
          r.rol === "piloto" ? "El piloto seleccionado" : `El auxiliar ${disp.nombre}`;
        return NextResponse.json(
          { error: `${etiqueta} tiene un viaje en curso.` },
          { status: 409 },
        );
      }
    }
  }

  let planId = 0;
  let codigoFinal = codigo;
  // VIAT-2 (concurrencia): candado con nombre por empresa, igual patrón que
  // ya usa portal/viajes/route.ts para la exclusividad de unidad en salida
  // — evita la ventana SELECT (verificar traslape) -> INSERT donde dos
  // solicitudes concurrentes pasarían la verificación antes de que
  // cualquiera escriba. Se libera siempre en el finally, sin excepción.
  const lockKey = `tms_traslape_${empresaId}`;
  const lockConn = recursosNuevoPlan.length ? await getPool().getConnection() : null;
  // Mejora Programación (Opción A, punto 4) — el alta completa (plan +
  // auxiliares + paradas + viáticos) ahora es UNA transacción real: si
  // sincronizarViaticosPlan falla, TODO se revierte (incluido el plan
  // recién insertado) en vez de dejar un plan creado con viáticos a
  // medias. `conn` es independiente de `lockConn` (que solo sirve para el
  // candado GET_LOCK/RELEASE_LOCK del chequeo de traslapes, sin relación
  // con la atomicidad de la escritura).
  const conn = await getPool().getConnection();
  // CORRECCIÓN PR #81: solo true si GET_LOCK devolvió realmente 1 (ver
  // comentario dentro del try) — gatea el RELEASE_LOCK del finally, igual
  // que `lockTraslapeAdquirido` en el PATCH de más abajo.
  let lockTraslapePostAdquirido = false;
  try {
    if (lockConn && validarDiaNuevo) {
      // CORRECCIÓN PR #81: GET_LOCK() de MySQL NO lanza excepción cuando no
      // consigue el candado — retorna 1 (adquirido), 0 (timeout) o NULL
      // (error). Hay que leer el valor real de `l`: sin candado
      // confirmado, primerConflictoTraslape no tiene exclusión mutua real
      // contra otra transacción concurrente, así que no debe correr, y
      // esta solicitud no debe crear el plan.
      let lockRows: RowDataPacket[] = [];
      try {
        [lockRows] = await lockConn.query<RowDataPacket[]>(
          "SELECT GET_LOCK(?, 8) AS l",
          [lockKey],
        );
      } catch {
        lockRows = [];
      }
      lockTraslapePostAdquirido = Number(lockRows[0]?.l) === 1;
      if (!lockTraslapePostAdquirido) {
        return NextResponse.json(
          {
            error:
              "No se pudo validar la disponibilidad de recursos porque hay otra operación en curso. Intenta de nuevo.",
          },
          { status: 409 },
        );
      }
      // A2.1 — política por intervalos: [fecha+hora, regreso); sin hora o sin regreso reserva todo fecha_plan.
      const conflicto = await primerConflictoProgramacionIntervalo(
        empresaId,
        recursosNuevoPlan,
        ventanaProgramacionSegura({ fechaPlan: d.fechaPlan, horaCarga: d.horaCarga ?? null, regresoEstimado: d.regresoEstimado ?? null }),
        [],
      );
      if (conflicto) {
        return NextResponse.json({ error: mensajeConflictoProgramacionIntervalo(conflicto) }, { status: 409 });
      }
    }

    await conn.beginTransaction();

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [result] = await conn.execute<ResultSetHeader>(
          `INSERT INTO tms_planes_viaje
            (empresa_id, codigo, cliente_id, lugar_carga_id, lugar_descarga_id, unidad_id, piloto_id, auxiliar_id, fecha_plan, hora_carga, tipo_traslado, regreso_estimado, tarifa_comercial, tarifa_id, tarifa_nombre_historico, tarifa_monto_historico, tarifa_moneda_historico, costo_operativo_referencia, referencia_cliente, ruta_id, ruta_codigo_historico, lugar_descarga_historico, contacto_nombre_historico, contacto_cargo_historico, contacto_telefono_historico, notas, estado, tipo_viaje, piloto_externo_nombre, auxiliares_externos, unidad_externa_placa, unidad_externa_descripcion, transportista_externo, costo_tercerizado, tc_vehiculo_id, tc_placa_historica, tc_externo_placa)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Programado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            empresaId,
            codigoFinal,
            clienteId,
            lugarCargaId,
            lugarDescargaId,
            unidadId,
            pilotoId,
            auxiliarId,
            d.fechaPlan,
            d.horaCarga ?? null,
            d.tipoTraslado ?? null,
            d.regresoEstimado?.replace("T", " ") ?? null,
            tarifaComercialFinal,
            snapshotTarifa?.id ?? null,
            snapshotTarifa?.nombre ?? null,
            snapshotTarifa?.monto ?? null,
            snapshotTarifa?.moneda ?? null,
            d.costoOperativoReferencia ?? null,
            d.referenciaCliente?.trim() || null,
            d.rutaId ?? null,
            d.rutaCodigo?.trim() || null,
            d.lugarDescargaHistorico?.trim() || null,
            d.contactoNombreHistorico?.trim() || null,
            d.contactoCargoHistorico?.trim() || null,
            d.contactoTelefonoHistorico?.trim() || null,
            d.notas ?? null,
            tipoViaje,
            snapshotTercerizado.pilotoExternoNombre,
            snapshotTercerizado.auxiliaresExternos,
            snapshotTercerizado.unidadExternaPlaca,
            snapshotTercerizado.unidadExternaDescripcion,
            snapshotTercerizado.transportistaExterno,
            snapshotTercerizado.costoTercerizado,
            tcVehiculoId,
            tcPlacaHistorica,
            snapshotTercerizado.tcExternoPlaca,
          ],
        );
        planId = Number(result.insertId);
        break;
      } catch {
        codigoFinal = await asegurarCodigoPlanUnico(
          empresaId,
          d.fechaPlan,
          null,
        );
      }
    }
    if (!planId) {
      await conn.rollback();
      return NextResponse.json(
        { error: "No se pudo generar un código de plan único. Intenta de nuevo." },
        { status: 409 },
      );
    }
    await guardarAuxiliaresPlan(planId, auxPersonalIds, conn);
    if (paradasInput.length) {
      // OPS-3.2d: plan recién creado — guardarParadasPlan nunca puede
      // rechazar aquí (no hay paradas previas ni evidencia posible), pero
      // se revisa el resultado igual, por consistencia con el PATCH.
      const rParadas = await guardarParadasPlan(empresaId, planId, paradasInput, conn);
      if (!rParadas.ok) {
        await conn.rollback();
        return NextResponse.json({ error: rParadas.error }, { status: 409 });
      }
    }
    // VIAT-0 + mejora Programación: crea/actualiza el viático de cada
    // piloto/auxiliar recién asignado — con el monto explícito de
    // viaticosOverrides si el POST lo trajo, o el sugerido si no. Ahora SÍ
    // forma parte de la transacción del alta: si esto falla, se revierte
    // todo (antes se tragaba el error para no bloquear la creación del
    // plan; el negocio confirmó que ya no debe ser así).
    await sincronizarViaticosPlan(
      empresaId,
      planId,
      { piloto: pilotoId, auxiliares: auxPersonalIds },
      conn,
      viaticosOverrides,
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error("POST tms/planes (transacción de alta)", e);
    return NextResponse.json(
      { error: "No se pudo crear el viaje. No se guardó ningún cambio." },
      { status: 500 },
    );
  } finally {
    conn.release();
    if (lockConn) {
      // CORRECCIÓN PR #81: RELEASE_LOCK solo si realmente se adquirió
      // (lockTraslapePostAdquirido) — no llamarlo porque GET_LOCK devolvió
      // 0/NULL o lanzó excepción, eso liberaría un candado que esta sesión
      // nunca tuvo (a lo sumo un no-op de MySQL, pero no hay que asumirlo).
      if (lockTraslapePostAdquirido) {
        try {
          await lockConn.query("SELECT RELEASE_LOCK(?) AS l", [lockKey]);
        } catch {
          /* ok */
        }
      }
      lockConn.release();
    }
  }
  // Si se llega aquí, el commit fue exitoso: plan + auxiliares + paradas +
  // viáticos quedaron guardados juntos. Cualquier salida sin eso (conflicto
  // de traslape, código único no generado, o fallo en cualquier escritura
  // de la transacción) ya retornó dentro del try/catch/finally de arriba.

  const paradasTxt = paradasInput
    .map((p, i) => `${i + 1}.${p.lugarNombre}(${p.tipo ?? "?"})`)
    .join("; ");
  await registrarAuditoria({
    empresaId,
    usuario: guard.session.username,
    accion: "crear_ruta",
    modulo: "tms",
    detalle: `Plan #${planId} ${codigoFinal} · fecha ${d.fechaPlan} · tipo ${tipoViaje} · piloto ${(esTercerizado ? snapshotTercerizado.pilotoExternoNombre : d.pilotoNombre?.trim()) || "—"} · placa ${(esTercerizado ? snapshotTercerizado.unidadExternaPlaca : (d.placa || "").toUpperCase()) || "—"} · TC ${(esTercerizado ? snapshotTercerizado.tcExternoPlaca : tcPlacaHistorica) || "—"} · ${paradasInput.length} parada(s)${paradasTxt ? `: ${paradasTxt}` : ""}`,
  });

  return NextResponse.json({
    id: planId,
    codigo: codigoFinal,
    mensaje: `Plan ${codigoFinal} creado${
      auxPersonalIds.length > 1
        ? ` con ${auxPersonalIds.length} auxiliares`
        : ""
    }${paradasInput.length ? ` · ${paradasInput.length} parada(s)` : ""}.`,
  });
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  pilotoNombre: z.string().optional(),
  auxiliarNombre: z.string().optional(),
  auxiliarNombres: z.array(z.string().min(2)).max(8).optional(),
  auxiliarEmpleadoIds: z.array(z.number().int().positive()).max(8).optional(),
  placa: z.string().optional(),
  // OPS-1 (corregido) — hallazgo real durante la revisión: este PATCH
  // genérico aceptaba "Cerrado" (y "Descargado") como cualquier otro
  // valor de estado, lo que permitía a CUALQUIER usuario con edición de
  // TMS cerrar administrativamente un plan sin el permiso
  // `viajes_cerrar:editar` y sin pasar por la transición atómica de
  // src/lib/tms/cierre-viaje.ts (sin cerrado_por/cerrado_en). El cierre
  // ahora es EXCLUSIVO de POST /tms/planes/[id]/cerrar. "Descargado" se
  // retira también: ya no se genera para viajes nuevos (ver
  // marcarPlanDescargado en planes-salida.ts) y no tiene sentido que
  // este formulario general lo re-introduzca a mano.
  //
  // OPS-AJUSTES: mismo hallazgo, ahora con "En ruta" — este PATCH
  // también lo aceptaba como cualquier otro valor, permitiendo a
  // cualquier usuario con programacion:editar forzar el inicio del
  // viaje sin pasar por el piloto (Portal) ni por Flota registrando en
  // su nombre. La transición real Programado/Cargado → "En ruta" sigue
  // siendo EXCLUSIVA de marcarPlanEnRuta() (src/lib/tms/planes-salida.ts),
  // invocada solo desde /api/portal/viajes y
  // /api/empresas/[slug]/flota/viajes — nunca desde aquí. Confirmado por
  // grep que ningún caller legítimo de este PATCH envía "En ruta" hoy.
  estado: z
    .enum(["Programado", "Cargado", "Cancelado"])
    .optional(),
  // OPS-AJUSTES (sección 3) — motivo obligatorio para cambios sensibles
  // de piloto/unidad/auxiliares (verificado más abajo, después de
  // calcular `cambios`, porque solo ahí se sabe si esos campos realmente
  // cambiaron respecto al valor anterior — un PATCH que reenvía el mismo
  // piloto no debe exigir motivo).
  motivoCambio: z.string().trim().max(300).optional(),
  notas: z.string().optional(),
  horaCarga: z.string().optional(),
  regresoEstimado: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional(),
  tarifaComercial: z.number().nonnegative().nullable().optional(),
  costoOperativoReferencia: z.number().nonnegative().nullable().optional(),
  referenciaCliente: z.string().max(160).nullable().optional(),
  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§2) — cambiar la tarifa
  // del viaje re-snapshotea nombre/monto/moneda; `null` la quita.
  tarifaId: z.number().int().positive().nullable().optional(),
  // VIAT-4/VIAT-4b: igual que en el POST — fotografía histórica de la
  // ruta usada.
  rutaId: z.number().int().positive().optional(),
  rutaCodigo: z.string().max(40).optional(),
  lugarDescargaHistorico: z.string().max(300).optional(),
  contactoNombreHistorico: z.string().max(160).optional(),
  contactoCargoHistorico: z.string().max(120).optional(),
  contactoTelefonoHistorico: z.string().max(80).optional(),
  paradas: z
    .array(
      z.object({
        lugarNombre: z.string().min(1),
        tipo: z.enum(["Carga", "Descarga", "Entrega"]).optional(),
        requiereEvidencia: z.boolean().optional(),
        // VIAT-1: referencia opcional a la ubicación guardada del cliente
        // (tms_cliente_ubicaciones) de la que salió esta parada.
        clienteUbicacionId: z.number().int().positive().optional(),
        // OPS-3.2d: identidad de la parada YA EXISTENTE
        // (tms_plan_paradas.id) — ausente = parada nueva. Nunca se confía
        // en este id sin validarlo contra el plan real, ver
        // guardarParadasPlan en src/lib/tms/paradas.ts.
        id: z.number().int().positive().optional(),
      }),
    )
    .max(20)
    .optional(),
  // --- Fase P5.1a: campos por ID, exclusivos de Programación. Aditivos —
  // no reemplazan pilotoNombre/auxiliarNombres/auxiliarEmpleadoIds/placa,
  // que TMS (staff) sigue usando tal cual. Si un request trae ambos (ID y
  // nombre) para el mismo recurso, el campo por ID tiene precedencia por
  // aplicarse después en el código.
  fechaPlan: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).")
    .optional(),
  pilotoPersonalId: z.number().int().positive().optional(),
  auxiliarPersonalIds: z.array(z.number().int().positive()).max(8).optional(),
  flotaVehiculoId: z.number().int().positive().optional(),
  // PROGRAMACION-VIAJES-TERCERIZADOS-1 — un PATCH que trae `tipoViaje` se
  // atiende en patchTipoViaje() (aislado del resto de este archivo, ver
  // comentario ahí) — nunca en el flujo normal de abajo, que no conoce el
  // concepto de viaje tercerizado.
  tipoViaje: z.enum(["Propio", "Tercerizado"]).optional(),
  pilotoExternoNombre: z.string().max(160).optional(),
  auxiliaresExternos: z.array(z.string().min(1).max(160)).max(8).optional(),
  unidadExternaPlaca: z.string().max(40).optional(),
  unidadExternaDescripcion: z.string().max(160).optional(),
  transportistaExterno: z.string().max(160).optional(),
  costoTercerizado: z.number().nonnegative().nullable().optional(),
  // PROGRAMACION-TC-CAJA-REMOLQUE-1 — `null` (o "" en tcExternoPlaca) quita el TC.
  tcVehiculoId: z.number().int().positive().nullable().optional(),
  tcExternoPlaca: z.string().max(40).nullable().optional(),
});

/**
 * PROGRAMACION-VIAJES-TERCERIZADOS-1 — cambia el tipo de un plan (Propio
 * <-> Tercerizado) en un flujo PEQUEÑO y AISLADO, deliberadamente separado
 * del resto de PATCH (~800 líneas de reglas de tarifa/ruta/disponibilidad/
 * "motivo sensible" ya endurecidas, que no tienen por qué aprender este
 * concepto nuevo). Nunca se invoca junto con otros cambios del mismo PATCH
 * — el frontend, cuando el tipo cambia, manda ESTA llamada primero y
 * luego (si hace falta asignar piloto/auxiliares/unidad internos al volver
 * a Propio) un PATCH normal aparte, que sí pasa por toda la validación de
 * siempre.
 *
 * Tercerizado: limpia cualquier piloto_id/auxiliar_id/unidad_id interno
 * que hubiera quedado (nunca se mezcla un id interno con un snapshot
 * externo), guarda el snapshot de texto, vacía tms_plan_auxiliares y
 * sincroniza viáticos con recursos vacíos — sincronizarViaticosPlan ya
 * borra cualquier viático PROGRAMADO existente y no crea ninguno nuevo
 * cuando no hay piloto ni auxiliares (ver el propio archivo viaticos.ts),
 * así que NO hace falta un `if` especial para "no generar viáticos".
 *
 * Propio: limpia los snapshots externos. NO resuelve piloto/auxiliares/
 * unidad internos aquí — igual que un Propio recién creado sin esos
 * campos, quedan vacíos hasta el PATCH normal que sí los resuelve con
 * disponibilidad/motivo-sensible completos.
 */
async function patchTipoViaje(
  empresaId: number,
  d: z.infer<typeof patchSchema>,
  usuario?: string | null,
): Promise<NextResponse> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, estado, tipo_viaje FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [d.id, empresaId],
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "Plan no encontrado." }, { status: 404 });
  }
  const antes = {
    codigo: String(rows[0].codigo),
    estado: String(rows[0].estado),
    tipoViaje: String(rows[0].tipo_viaje ?? "Propio"),
  };
  if (antes.estado === "Cerrado" || antes.estado === "Cancelado") {
    return NextResponse.json({ error: `No se puede editar un plan ${antes.estado}.` }, { status: 400 });
  }
  const tipoViaje = d.tipoViaje === "Tercerizado" ? "Tercerizado" : "Propio";
  const esTercerizado = tipoViaje === "Tercerizado";
  if (esTercerizado && !d.pilotoExternoNombre?.trim()) {
    return NextResponse.json(
      { error: "Un viaje tercerizado requiere el nombre del piloto externo." },
      { status: 400 },
    );
  }
  const opcional = (v: string | null | undefined): string | null => { const t = (v ?? "").trim(); return t ? t : null; };
  // PROGRAMACION-TC-CAJA-REMOLQUE-1: un Tercerizado nunca acepta un TC interno.
  if (esTercerizado && d.tcVehiculoId != null) {
    return NextResponse.json(
      { error: "Un viaje tercerizado no usa TC interno: captura el TC externo como texto." },
      { status: 400 },
    );
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    if (esTercerizado) {
      await conn.execute(
        `UPDATE tms_planes_viaje SET
           tipo_viaje = 'Tercerizado', piloto_id = NULL, auxiliar_id = NULL, unidad_id = NULL,
           piloto_externo_nombre = ?, auxiliares_externos = ?, unidad_externa_placa = ?,
           unidad_externa_descripcion = ?, transportista_externo = ?, costo_tercerizado = ?,
           tc_vehiculo_id = NULL, tc_placa_historica = NULL, tc_externo_placa = ?
         WHERE id = ? AND empresa_id = ?`,
        [
          opcional(d.pilotoExternoNombre),
          opcional((d.auxiliaresExternos ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 8).join("\n")),
          opcional(d.unidadExternaPlaca?.trim().toUpperCase()),
          opcional(d.unidadExternaDescripcion),
          opcional(d.transportistaExterno),
          d.costoTercerizado ?? null,
          opcional(d.tcExternoPlaca?.trim().toUpperCase()),
          d.id,
          empresaId,
        ],
      );
      await guardarAuxiliaresPlan(d.id, [], conn);
      await sincronizarViaticosPlan(empresaId, d.id, { piloto: null, auxiliares: [] }, conn);
    } else {
      await conn.execute(
        `UPDATE tms_planes_viaje SET
           tipo_viaje = 'Propio', piloto_externo_nombre = NULL, auxiliares_externos = NULL,
           unidad_externa_placa = NULL, unidad_externa_descripcion = NULL, transportista_externo = NULL,
           costo_tercerizado = NULL, tc_externo_placa = NULL
         WHERE id = ? AND empresa_id = ?`,
        [d.id, empresaId],
      );
    }
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: usuario ?? null,
      accion: "editar_ruta",
      modulo: "tms",
      detalle: `Plan #${d.id} ${antes.codigo} · tipo ${antes.tipoViaje} -> ${tipoViaje}`,
    });
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error("PATCH tms/planes (tipoViaje)", e);
    return NextResponse.json(
      { error: "No se pudo actualizar el tipo de viaje. No se guardó ningún cambio." },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
  return NextResponse.json({ mensaje: "Plan actualizado.", id: d.id });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  // Corrección de matriz de permisos: editar un viaje es una acción propia
  // de Programación — ya no basta con "tms:editar" genérico.
  const guard = await requireTenantProgramacion(slug, "editar");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const empresaId = guard.empresa.id;

  // PROGRAMACION-VIAJES-TERCERIZADOS-1 — ver patchTipoViaje() arriba: un
  // PATCH que trae `tipoViaje` se resuelve ahí, aislado del resto de este
  // handler. Cualquier PATCH que NO lo traiga sigue exactamente el mismo
  // camino de siempre (todo lo de abajo, sin cambios).
  if (d.tipoViaje !== undefined) {
    return patchTipoViaje(empresaId, d, guard.session.username);
  }

  // Fase P5.1c: SELECT ampliado — se agregan fecha_plan, piloto_id y
  // flota_vehiculo_id (antes no se traían) para poder calcular la fecha
  // efectiva y revalidar disponibilidad de los recursos YA asignados
  // cuando cambia la fecha (ver "revalidación al cambiar fecha").
  // VIAT-2: se agregan unidad_id y regreso_estimado (antes no se traían)
  // para poder calcular el intervalo EFECTIVO del plan (recursos ya
  // asignados que esta solicitud no toca) al validar traslapes.
  const plan = await query<RowDataPacket[]>(
    `SELECT p.id, p.codigo, p.estado, p.fecha_plan, p.hora_carga, p.notas,
            p.piloto_id, p.unidad_id, DATE_FORMAT(p.regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado, p.ruta_id,
            p.tipo_viaje, p.tc_vehiculo_id,
            p.tarifa_comercial, p.tarifa_id, p.costo_operativo_referencia, p.referencia_cliente,
            u.placa, u.flota_vehiculo_id, pil.nombre AS piloto,
            ${SQL_PENDIENTE_CIERRE} AS pendiente_cierre
     FROM tms_planes_viaje p
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
    [d.id, empresaId],
  );
  if (!plan[0]) {
    return NextResponse.json({ error: "Plan no encontrado." }, { status: 404 });
  }
  const antes = {
    codigo: String(plan[0].codigo ?? ""),
    estado: String(plan[0].estado ?? ""),
    placa: plan[0].placa ? String(plan[0].placa) : "",
    piloto: plan[0].piloto ? String(plan[0].piloto) : "",
    hora: plan[0].hora_carga ? String(plan[0].hora_carga) : "",
    fechaPlan: toIsoDate(plan[0].fecha_plan) ?? "",
    pilotoId: plan[0].piloto_id != null ? Number(plan[0].piloto_id) : null,
    unidadId: plan[0].unidad_id != null ? Number(plan[0].unidad_id) : null,
    tipoViaje: String(plan[0].tipo_viaje ?? "Propio"),
    tcVehiculoId: plan[0].tc_vehiculo_id != null ? Number(plan[0].tc_vehiculo_id) : null,
    regresoEstimado:
      plan[0].regreso_estimado != null
        ? String(plan[0].regreso_estimado).slice(0, 19).replace("T", " ")
        : null,
    // OPS-AJUSTES (sección 4) — para que la bitácora muestre "Tarifa:
    // Q1,000 → Q1,200" en vez de un genérico "datos comerciales
    // actualizados". Solo lectura para el detalle de auditoría; no
    // cambia ninguna regla de negocio existente sobre estos campos.
    tarifaComercial:
      plan[0].tarifa_comercial != null ? Number(plan[0].tarifa_comercial) : null,
    costoOperativoReferencia:
      plan[0].costo_operativo_referencia != null ? Number(plan[0].costo_operativo_referencia) : null,
    referenciaCliente:
      plan[0].referencia_cliente != null ? String(plan[0].referencia_cliente) : null,
    flotaVehiculoId:
      plan[0].flota_vehiculo_id != null
        ? Number(plan[0].flota_vehiculo_id)
        : null,
    // OPS-3.2b: true cuando el plan no está Cerrado/Cancelado Y ya existe
    // un registro real de llegada en flota_viajes (misma definición que
    // GET, ver SQL_PENDIENTE_CIERRE) — distingue "En ruta sin llegada"
    // (solo notas, sin cambios) de "En ruta con llegada / pendiente de
    // cierre" (reconciliación administrativa habilitada más abajo).
    pendienteCierre: Number(plan[0].pendiente_cierre) === 1,
    rutaId: plan[0].ruta_id != null ? Number(plan[0].ruta_id) : null,
    tarifaId: plan[0].tarifa_id != null ? Number(plan[0].tarifa_id) : null,
  };

  // PROGRAMACION-TC-CAJA-REMOLQUE-1 — TC del viaje.
  //  - Tercerizado: solo `tcExternoPlaca` (texto); un TC interno se rechaza.
  //  - Propio: `tcVehiculoId` (null lo quita). Un TC DISTINTO al actual se
  //    valida en servidor (acceso + clasificación + activo/taller); el mismo
  //    TC no se re-valida por taller/inactivo (editar otros campos de un
  //    viaje no debe fallar porque el TC ya entró a taller). La
  //    disponibilidad por fecha va más abajo, bajo el candado por empresa.
  const cambioTc = await resolverCambioTc(
    empresaId,
    { tipoViaje: antes.tipoViaje, tcVehiculoId: antes.tcVehiculoId },
    { tcVehiculoId: d.tcVehiculoId, tcExternoPlaca: d.tcExternoPlaca },
  );
  if (!cambioTc.ok) return NextResponse.json({ error: cambioTc.error }, { status: cambioTc.status });
  const { escribirTcInterno, tcVehiculoIdNuevo, tcPlacaNueva, escribirTcExterno, tcExternoNuevo, tcEfectivo } = cambioTc;

  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§2/§5) — consistencia
  // tarifa↔ruta del viaje. `d.rutaId` (zod) es undefined o un id positivo,
  // nunca null; `antes.rutaId`/`antes.tarifaId` pueden ser null.
  const rutaEfectivaPatch = d.rutaId ?? antes.rutaId ?? null;
  const rutaCambio = d.rutaId !== undefined && d.rutaId !== antes.rutaId;

  // Caso 1 — el PATCH trae `tarifaId`: se valida contra la ruta EFECTIVA
  // (la nueva si cambió) + empresa y se snapshotea. `tarifaId: null`
  // limpia el snapshot. Un id que no pertenezca a esa ruta/empresa o que
  // no esté activo => 400 (nunca se guarda una tarifa ajena).
  const snapshotTarifaPatch =
    d.tarifaId != null && rutaEfectivaPatch != null
      ? await tarifaParaSnapshot(empresaId, rutaEfectivaPatch, d.tarifaId)
      : null;
  if (d.tarifaId != null && !snapshotTarifaPatch) {
    return NextResponse.json(
      { error: "La tarifa seleccionada no pertenece a la ruta del viaje en esta empresa o no está activa." },
      { status: 400 },
    );
  }

  // Caso 2 — el PATCH cambia `rutaId` pero NO trae `tarifaId`: NUNCA
  // conservar en silencio una tarifa de la ruta anterior. Se revalida la
  // tarifa ACTUAL del viaje contra la nueva ruta; si ya no pertenece, se
  // limpian tarifa_id + los 3 snapshots históricos (regla §2/§3 del
  // ticket). `tarifa_comercial` se conserva como monto manual/override —
  // ver el flag de abajo — para no perder el valor económico del viaje.
  let limpiarTarifaPorCambioRuta = false;
  if (d.tarifaId === undefined && rutaCambio && antes.tarifaId != null) {
    const sigueEnLaRuta =
      rutaEfectivaPatch != null
        ? await tarifaParaSnapshot(empresaId, rutaEfectivaPatch, antes.tarifaId)
        : null;
    limpiarTarifaPorCambioRuta = debeLimpiarTarifaPorCambioDeRuta({
      patchTraeTarifaId: d.tarifaId !== undefined,
      rutaCambio,
      antesTarifaId: antes.tarifaId,
      tarifaActualSigueEnRutaNueva: sigueEnLaRuta != null,
    });
  }
  // §2/§3 — se escribe el bloque de snapshot de tarifa si: el PATCH lo
  // trae explícito (id o null), o hay que limpiarlo por cambio de ruta.
  // En ambos casos de "limpiar" el valor efectivo es null (snapshotTarifa
  // Patch ya es null salvo cuando d.tarifaId trajo un id válido).
  const tarifaSnapshotTocado = d.tarifaId !== undefined || limpiarTarifaPorCambioRuta;

  // Auxiliares y paradas actuales del plan (antes de cualquier cambio) —
  // reutiliza los mismos helpers que ya usa GET, sin duplicar SQL. Sirven
  // para: (a) el detalle "antes → después" de la auditoría, y (b) revalidar
  // disponibilidad de los auxiliares YA asignados si la fecha cambia.
  const antesAuxMap = await auxiliaresDePlanes([d.id]);
  const antesAuxiliares = antesAuxMap.get(d.id) ?? [];
  const antesAuxiliaresIds = antesAuxiliares.map((a) => a.personalId);
  const antesAuxiliaresNombres = antesAuxiliares.map((a) => a.nombre);
  const paradasAntesMap = await listarParadasDePlanes([d.id]);
  const paradasAntesCount = (paradasAntesMap.get(d.id) ?? []).length;

  // Fase P5.1c — REGLAS POR ESTADO DEL PLAN. Se evalúa contra el estado
  // ANTES del cambio (si esta misma solicitud también transiciona el
  // estado, eso sigue permitido — solo se restringen piloto/auxiliares/
  // unidad/fecha/paradas/hora, nunca la transición de `estado` en sí).
  // Aplica por igual a los campos legado (nombre/placa) y a los nuevos por
  // ID — es una protección de integridad del viaje ya iniciado, no una
  // regla exclusiva de Programación (mismo criterio ya usado para bloquear
  // paradas en "En ruta").
  const toca = camposTocados(d);

  // OPS-AJUSTES (sección 3) — motivo obligatorio para cambios sensibles:
  // piloto, unidad y auxiliares. Se valida aquí, ANTES de cualquier
  // escritura (misma zona que los guards de ESTADOS_BLOQUEADOS/
  // ESTADOS_SOLO_NOTAS de abajo, que tampoco han escrito nada todavía) —
  // usa toca* (ya calculados arriba: "la solicitud incluye un valor para
  // este campo"), no una comparación contra el valor anterior, para
  // nunca dejar pasar un cambio real sin motivo registrado.
  const errorMotivo = validarMotivoCambioRecursos(toca, d.motivoCambio);
  if (errorMotivo) return NextResponse.json({ error: errorMotivo.error }, { status: errorMotivo.status });

  const errorEstado = validarEstadoEditable({ estado: antes.estado, pendienteCierre: antes.pendienteCierre }, toca);
  if (errorEstado) return NextResponse.json({ error: errorEstado.error }, { status: errorEstado.status });

  // Fase P5.1c — FECHA EFECTIVA Y FECHA PASADA. "hoy" se calcula en
  // America/Guatemala (hoyLocal(), ya existente y reutilizado en el resto
  // del proyecto) — nunca con new Date().toISOString(), que es UTC y puede
  // desfasar un día cerca de medianoche. Aplica únicamente al PATCH de
  // Programación (no se toca el POST ni su comportamiento histórico).
  const hoy = hoyLocal();
  const fechaEfectiva = d.fechaPlan ?? antes.fechaPlan;
  const errorFecha = validarFechaNoPasada(fechaEfectiva, hoy);
  if (errorFecha) return NextResponse.json({ error: errorFecha.error }, { status: errorFecha.status });
  const esHoy = fechaEfectiva === hoy;
  // Si la fecha cambia, los recursos YA asignados (que no cambian de ID en
  // este mismo request) deben revalidarse contra la NUEVA fecha — cambia el
  // contexto temporal de toda la asignación.
  const fechaCambia = d.fechaPlan != null && d.fechaPlan !== antes.fechaPlan;
  const errorRegreso = validarRegresoPosteriorASalida(d.regresoEstimado, fechaEfectiva, d.horaCarga ?? antes.hora ?? "00:00");
  if (errorRegreso) return NextResponse.json({ error: errorRegreso.error }, { status: errorRegreso.status });

  let unidadId: number | undefined;

  // Resolución de piloto/auxiliares (modo "escritura": idéntico al PATCH previo, puede crear tms_personal).
  const seleccion = await resolverSeleccionPersonal(empresaId, d, "escritura");
  if (!seleccion.ok) return NextResponse.json({ error: seleccion.error }, { status: seleccion.status });
  const { pilotoId, auxiliarId, auxPersonalIdsLegado, auxPersonalIdsNuevo } = seleccion;

  // OPS-3.2c (corrección) — recursos EFECTIVOS y si realmente CAMBIARON,
  // no solo si el campo vino en el request. El formulario real de
  // Programación reenvía normalmente piloto/placa/auxiliares actuales
  // aunque el usuario solo esté editando tarifa/notas/etc. — usar
  // "¿vino el campo?" (tocaPiloto/actualizarAux/placaNorm) como señal de
  // "cambió" habría revalidado disponibilidad de un recurso que no se
  // está reasignando, arriesgando un bloqueo falso (p.ej. el mismo
  // piloto ya ocupado en OTRO viaje que arrancó después de la llegada
  // de este). Se levantan aquí (antes usaban una versión local dentro
  // de `cambiaPersonal`) para reutilizarse también en la sección de
  // disponibilidad, más abajo — sin recalcular dos veces.
  const pilotoFinal = pilotoId !== undefined ? pilotoId : antes.pilotoId;
  const auxiliaresFinal = auxPersonalIdsNuevo ?? auxPersonalIdsLegado ?? antesAuxiliaresIds;
  // Comparación como CONJUNTOS — el orden en que el formulario mande los
  // auxiliares no representa una diferencia de asignación real.

  // Mejora Programación — bloquear el cambio de personal si a quien se
  // quita/reemplaza ya se le procesó un viático (AUTORIZADO/ENTREGADO/
  // LIQUIDADO). Solo corre si esta solicitud REALMENTE toca piloto y/o
  // auxiliares (mismo gate que ya decide si se llama a
  // sincronizarViaticosPlan más abajo) — editar notas/tarifa/hora/etc. sin
  // tocar personal nunca se bloquea por esto. Se calcula el personal
  // REALMENTE removido (antes menos el conjunto final que aplicaría este
  // PATCH) y se consulta su viático ANTES de escribir nada — 409 sin
  // ningún cambio si alguno no está PROGRAMADO. Nota: este gate sigue
  // siendo "¿vino el campo?" (no "¿cambió realmente?") a propósito — es
  // inofensivo dejarlo así porque `removidos` de abajo ya solo detecta
  // personal REALMENTE quitado comparando pilotoFinal/auxiliaresFinal
  // contra antes.*; si el campo vino pero nadie cambió, `removidos`
  // queda vacío y no se bloquea nada.
  const cambiaPersonal = pilotoId !== undefined || auxPersonalIdsLegado != null || auxPersonalIdsNuevo != null;
  if (cambiaPersonal) {
    const removidos = personalQueSale(
      { pilotoId: antes.pilotoId, piloto: antes.piloto, auxiliaresIds: antesAuxiliaresIds, auxiliaresNombres: antesAuxiliaresNombres },
      { pilotoId: pilotoFinal, auxiliaresIds: auxiliaresFinal },
    );
    const errorViaticos = await validarRemocionConViaticos(d.id, removidos);
    if (errorViaticos) return NextResponse.json({ error: errorViaticos.error }, { status: errorViaticos.status });
  }

  // Placa legada: solo normaliza el texto aquí. El upsert real de
  // tms_unidades (categoría 1 de la transacción) se ejecuta más abajo.
  const placaNorm = d.placa?.trim() ? d.placa.trim().toUpperCase() : undefined;

  // Fase P5.1a: vínculo real Flota/TMS (tms_unidades.flota_vehiculo_id),
  // exclusivo de Programación. obtenerVehiculoAccesible ya valida
  // multiempresa (propio o compartido vía flota_vehiculo_acceso) — nunca
  // se confía en el id solo por venir del cliente. Fase P5.1b: solo valida
  // aquí (lectura); el upsert real se ejecuta dentro de la transacción.
  let vehiculoAccesible: Awaited<
    ReturnType<typeof obtenerVehiculoAccesible>
  > = null;
  if (d.flotaVehiculoId != null) {
    vehiculoAccesible = await obtenerVehiculoAccesible(
      empresaId,
      d.flotaVehiculoId,
    );
    if (!vehiculoAccesible) {
      return NextResponse.json(
        { error: "La unidad seleccionada no existe o no es accesible para esta empresa." },
        { status: 400 },
      );
    }
  }

  const paradasInput = d.paradas
    ? d.paradas.filter((p) => p.lugarNombre?.trim())
    : undefined;

  // OPS-3.2c (corrección) — unidad EFECTIVA (mismo espacio flota_vehiculos.id
  // que ya usa flotaVehiculoId) y si realmente CAMBIÓ contra
  // antes.flotaVehiculoId. Se resuelve por placa vía vehiculoPorPlaca()
  // (mismo resolver multiempresa-seguro que ya usa el portal del piloto)
  // cuando no vino el campo por ID — necesario para poder COMPARAR, no
  // para decidir todavía si se valida disponibilidad (eso lo decide
  // unidadCambioReal más abajo).
  let unidadFinalId: number | null = antes.flotaVehiculoId ?? null;
  if (d.flotaVehiculoId != null) {
    unidadFinalId = d.flotaVehiculoId;
  } else if (placaNorm) {
    const vehiculoLegado = await vehiculoPorPlaca(empresaId, placaNorm);
    unidadFinalId = vehiculoLegado ? Number(vehiculoLegado.id) : null;
  }

  // Fase P5.1c — DISPONIBILIDAD.
  //
  // OPS-3.2c (corrección, dos pasadas):
  // 1) El comentario original decía que esta validación era exclusiva de
  //    los campos por ID (pilotoPersonalId/auxiliarPersonalIds/
  //    flotaVehiculoId) y que los campos LEGADO (pilotoNombre/auxiliar*/
  //    placa) no pasaban por aquí. Ese es justamente el camino que usa
  //    el formulario REAL de Programación (plan-form.tsx) — dejar ese
  //    hueco abierto habría permitido saltarse el bloqueo por incidencia/
  //    viaje técnico en curso/inactivo (traslapes y viáticos avanzados NO
  //    tenían este problema — esos ya validaban sin importar el origen
  //    del campo).
  // 2) Corrección siguiente: "¿vino el campo?" (tocaPiloto/actualizarAux/
  //    placaNorm) NO es lo mismo que "¿el recurso realmente cambió?" — el
  //    formulario reenvía normalmente los valores YA asignados aunque el
  //    usuario solo esté editando tarifa/notas. Revalidar disponibilidad
  //    de un recurso que no se está reasignando podía producir un
  //    bloqueo falso (p.ej. el mismo piloto ya ocupado en otro viaje que
  //    arrancó DESPUÉS de la llegada de este). Ahora se usa
  //    pilotoCambioReal/auxiliaresCambioReal/unidadCambioReal (arriba) —
  //    comparación contra `antes.*`, no presencia del campo.
  //
  // Se valida: (a) el recurso NUEVO si REALMENTE cambió (por nombre o
  // por ID), o (b) el recurso YA asignado si la fecha cambió y ese
  // recurso en particular no cambió (revalidación preexistente por
  // cambio de fecha). Todo esto corre ANTES de abrir la transacción.
  const {
    pilotoCambioReal,
    auxiliaresCambioReal,
    unidadCambioReal,
    pilotoIdParaValidar,
    auxiliaresIdsParaValidar,
    vehiculoIdParaValidar,
  } = calcularCambiosRecursos(
    { pilotoId: antes.pilotoId, auxiliaresIds: antesAuxiliaresIds, unidadFlotaId: antes.flotaVehiculoId ?? null },
    { pilotoId, auxiliaresIds: auxPersonalIdsNuevo ?? auxPersonalIdsLegado, unidadFlotaId: unidadFinalId },
    fechaCambia,
  );

  const advertencias: AdvertenciaPatch[] = [];

  // OPS-3.2c: aviso informativo (nunca bloquea) cuando REALMENTE se
  // reasigna piloto/unidad/auxiliares (no solo porque el campo vino en
  // el payload — ver pilotoCambioReal/auxiliaresCambioReal/
  // unidadCambioReal arriba) en un plan pendiente de cierre — deja claro
  // que esto es una corrección ADMINISTRATIVA de tms_planes_viaje; el
  // registro técnico de flota_viajes (piloto_nombre, vehiculo_id,
  // kilometraje, horas, evidencias) capturado durante la ejecución real
  // del viaje NO se toca ni se sincroniza automáticamente.
  if (antes.pendienteCierre && (pilotoCambioReal || auxiliaresCambioReal || unidadCambioReal)) {
    advertencias.push({
      tipo: "reasignacion_pre_cierre",
      mensaje:
        "Se actualizó la asignación administrativa del viaje. El registro técnico de Flota conserva los datos capturados durante la ejecución.",
    });
  }

  if (pilotoIdParaValidar != null || auxiliaresIdsParaValidar.length > 0) {
    const personalDisp = await listarDisponibilidadPersonal(
      empresaId,
      fechaEfectiva,
    );
    const recursos: { personalId: number; rol: "piloto" | "auxiliar" }[] = [];
    if (pilotoIdParaValidar != null) {
      recursos.push({ personalId: pilotoIdParaValidar, rol: "piloto" });
    }
    for (const pid of auxiliaresIdsParaValidar) {
      recursos.push({ personalId: pid, rol: "auxiliar" });
    }

    // PROGRAMACION-RECHAZADO-AVISO-1 — informativo, NUNCA bloquea (RECHAZADO
    // sigue siendo terminal por (plan_id, personal_id), sin cambios aquí).
    // `recursos` (arriba) NO es el conjunto correcto para este aviso:
    // también incluye al piloto/auxiliares YA asignados sin cambiar, cuando
    // `fechaCambia` dispara su revalidación de disponibilidad — usarlo tal
    // cual repetiría el aviso en un PATCH que solo cambia la fecha, sin
    // tocar personal. personalRecienAsignadoDelPlan() calcula el conjunto
    // correcto: solo quien REALMENTE se (re)asigna en esta solicitud.
    const rechazados = await listarViaticosRechazadosDelPlan(
      empresaId,
      d.id,
      personalRecienAsignadoDelPlan({
        pilotoCambioReal,
        pilotoFinal,
        auxiliaresCambioReal,
        auxiliaresFinal,
        antesAuxiliaresIds,
      }),
    );
    for (const rz of rechazados) {
      advertencias.push({
        tipo: "viatico_rechazado_mismo_plan",
        mensaje: `${rz.nombre || `Personal #${rz.personalId}`} ya tiene un viático rechazado para este viaje. No se generará una nueva solicitud de viático para este mismo plan.${
          rz.motivoRechazo ? ` Motivo del rechazo: ${rz.motivoRechazo}` : ""
        }`,
      });
    }

    const evaluacionPersonal = evaluarDisponibilidadPersonal(personalDisp, recursos, { fechaEfectiva, esHoy, planId: d.id });
    advertencias.push(...evaluacionPersonal.advertencias);
    if (evaluacionPersonal.error) return NextResponse.json({ error: evaluacionPersonal.error.error }, { status: evaluacionPersonal.error.status });
  }

  if (vehiculoIdParaValidar != null) {
    const dispVeh = await listarDisponibilidadVehiculos(empresaId);
    const evaluacionUnidad = evaluarDisponibilidadUnidad(dispVeh.vehiculos, vehiculoIdParaValidar, unidadCambioReal, { fechaEfectiva, esHoy });
    advertencias.push(...evaluacionUnidad.advertencias);
    if (evaluacionUnidad.error) return NextResponse.json({ error: evaluacionUnidad.error.error }, { status: evaluacionUnidad.error.status });
  }

  // Fase P5.1b: TODO O NADA. Las 4 escrituras relacionadas de una
  // modificación de Programación —upsert de tms_unidades, UPDATE de
  // tms_planes_viaje, reemplazo de tms_plan_auxiliares y reemplazo de
  // tms_plan_paradas— comparten una única conexión/transacción: si
  // cualquiera falla, se revierten todas. La conexión se abre lo más tarde
  // posible (todas las validaciones de arriba ya corrieron) y se libera
  // siempre en el `finally`, sin excepción.
  const conn = await getPool().getConnection();
  // OPS-3.3: bandera para liberar el GET_LOCK de traslapes (si se llegó a
  // adquirir) en el `finally` de abajo — ver el bloque VIAT-2 más adelante.
  let lockTraslapeAdquirido = false;
  try {
    await conn.beginTransaction();

    if (placaNorm) {
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO tms_unidades (empresa_id, placa, tipo)
         VALUES (?, ?, 'Camion')
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [empresaId, placaNorm],
      );
      unidadId = Number(r.insertId);
    }

    if (d.flotaVehiculoId != null && vehiculoAccesible) {
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO tms_unidades (empresa_id, placa, tipo, flota_vehiculo_id)
         VALUES (?, ?, 'Camion', ?)
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           flota_vehiculo_id = COALESCE(flota_vehiculo_id, VALUES(flota_vehiculo_id))`,
        [empresaId, String(vehiculoAccesible.placa).toUpperCase(), d.flotaVehiculoId],
      );
      unidadId = Number(r.insertId);
    }

    // VIAT-2: valida traslapes con el recurso EFECTIVO resultante (lo nuevo
    // si vino en esta solicitud, si no lo que el plan ya tenía) — misma
    // conexión/transacción que el UPDATE de abajo, y bajo el mismo GET_LOCK
    // por empresa que POST, para que dos ediciones concurrentes no pasen la
    // verificación antes de que cualquiera escriba.
    //
    // OPS-3.3 (corrección de carrera): el candado se libera en el `finally`
    // de esta función, DESPUÉS de conn.commit() (o conn.rollback()) — antes
    // se liberaba aquí mismo, justo después de leer el conflicto y ANTES de
    // escribir/confirmar. Bajo REPEATABLE READ eso dejaba una ventana real:
    // dos transacciones concurrentes podían adquirir el candado una tras
    // otra y terminar asignando el mismo recurso. El candado se mantiene
    // hasta commit. Además, la consulta diaria usa FOR UPDATE: PATCH pudo
    // haber establecido un snapshot REPEATABLE READ antes de GET_LOCK, y
    // necesita ver la escritura ya confirmada por quien obtuvo el candado
    // primero.
    //
    // Solo Cancelado libera la fecha. Descargado y Cerrado continúan
    // ocupando su fecha_plan, sin bloquear días posteriores.
    const estadoEfectivo = d.estado ?? antes.estado;
    if (estadoEfectivo !== "Cancelado") {
      const pilotoEfectivo = pilotoId ?? antes.pilotoId;
      const unidadEfectiva = unidadId ?? antes.unidadId;
      const auxiliaresEfectivos = auxPersonalIdsNuevo ?? auxPersonalIdsLegado ?? antesAuxiliaresIds;
      const recursosEfectivos: RecursoDia[] = [
        ...(pilotoEfectivo ? [{ tipo: "piloto" as const, id: pilotoEfectivo }] : []),
        ...auxiliaresEfectivos.map((id) => ({ tipo: "auxiliar" as const, id })),
        ...(unidadEfectiva ? [{ tipo: "unidad" as const, id: unidadEfectiva }] : []),
        // PROGRAMACION-TC-CAJA-REMOLQUE-1: el propio plan se autoexcluye (excluirPlanId = d.id).
        ...(tcEfectivo ? [{ tipo: "tc" as const, id: tcEfectivo }] : []),
      ];
      if (recursosEfectivos.length) {
        const fechaEfectivaPlan = d.fechaPlan ?? antes.fechaPlan;
        // CORRECCIÓN PR #81: GET_LOCK() de MySQL NO lanza excepción cuando
        // no consigue el candado — retorna 1 (adquirido), 0 (timeout) o
        // NULL (error). Un try/catch vacío alrededor de la llamada no basta
        // como gate de integridad: hay que leer el valor real de la
        // columna `l` y tratar cualquier cosa distinta de 1 (incluida una
        // excepción de la propia consulta) como "NO adquirido" — sin
        // candado real, primerConflictoTraslape ya no tiene exclusión
        // mutua contra otra transacción concurrente, así que no debe
        // correr, y esta solicitud no debe escribir nada.
        let lockRows: RowDataPacket[] = [];
        try {
          [lockRows] = await conn.query<RowDataPacket[]>(
            "SELECT GET_LOCK(?, 8) AS l",
            [`tms_traslape_${empresaId}`],
          );
        } catch {
          lockRows = [];
        }
        lockTraslapeAdquirido = Number(lockRows[0]?.l) === 1;
        if (!lockTraslapeAdquirido) {
          await conn.rollback();
          return NextResponse.json(
            {
              error:
                "No se pudo validar la disponibilidad de recursos porque hay otra operación en curso. Intenta de nuevo.",
            },
            { status: 409 },
          );
        }
        // A2.1 — ventana EFECTIVA del plan (lo que la solicitud cambia + lo ya guardado) contra los demás planes;
        // el propio plan se autoexcluye ([d.id]). La lectura sigue bajo el candado y con FOR UPDATE (conn).
        const conflicto = await primerConflictoProgramacionIntervalo(
          empresaId,
          recursosEfectivos,
          ventanaProgramacionSegura({
            fechaPlan: fechaEfectivaPlan,
            horaCarga: (d.horaCarga ?? antes.hora) || null,
            regresoEstimado: d.regresoEstimado !== undefined ? d.regresoEstimado : antes.regresoEstimado,
          }),
          [d.id],
          conn,
        );
        // OPS-3.3: el candado YA NO se libera aquí — se mantiene hasta el
        // `finally` de esta función (después de commit/rollback), incluso
        // en este `return` por conflicto (ver comentario arriba del bloque).
        if (conflicto) {
          await conn.rollback();
          return NextResponse.json({ error: mensajeConflictoProgramacionIntervalo(conflicto) }, { status: 409 });
        }
      }
    }

    // OPS-3.2a — guard atómico contra la carrera PATCH vs. cierre: si el
    // Jefe cierra el viaje (POST /planes/[id]/cerrar, atómico y ajeno a
    // este archivo) entre la lectura de `antes` (arriba, fuera de la
    // transacción) y este UPDATE, el WHERE de abajo ya no debe hacer
    // match — "estado = ?" compara contra el valor LEÍDO al inicio
    // (antes.estado), nunca contra el nuevo valor del body. Así, un
    // "Cerrado" recién puesto por el Jefe queda protegido: este UPDATE no
    // lo toca.
    const [patchResult] = await conn.execute<ResultSetHeader>(
      `UPDATE tms_planes_viaje SET
        fecha_plan = COALESCE(?, fecha_plan),
        piloto_id = COALESCE(?, piloto_id),
        auxiliar_id = COALESCE(?, auxiliar_id),
        unidad_id = COALESCE(?, unidad_id),
        estado = COALESCE(?, estado),
        notas = COALESCE(?, notas),
        hora_carga = COALESCE(?, hora_carga),
        regreso_estimado = CASE WHEN ? THEN ? ELSE regreso_estimado END,
        tarifa_comercial = CASE WHEN ? THEN ? ELSE tarifa_comercial END,
        tarifa_id = CASE WHEN ? THEN ? ELSE tarifa_id END,
        tarifa_nombre_historico = CASE WHEN ? THEN ? ELSE tarifa_nombre_historico END,
        tarifa_monto_historico = CASE WHEN ? THEN ? ELSE tarifa_monto_historico END,
        tarifa_moneda_historico = CASE WHEN ? THEN ? ELSE tarifa_moneda_historico END,
        costo_operativo_referencia = CASE WHEN ? THEN ? ELSE costo_operativo_referencia END,
        referencia_cliente = CASE WHEN ? THEN ? ELSE referencia_cliente END,
        ruta_id = COALESCE(?, ruta_id),
        ruta_codigo_historico = COALESCE(?, ruta_codigo_historico),
        lugar_descarga_historico = COALESCE(?, lugar_descarga_historico),
        contacto_nombre_historico = COALESCE(?, contacto_nombre_historico),
        contacto_cargo_historico = COALESCE(?, contacto_cargo_historico),
        contacto_telefono_historico = COALESCE(?, contacto_telefono_historico),
        tc_vehiculo_id = CASE WHEN ? THEN ? ELSE tc_vehiculo_id END,
        tc_placa_historica = CASE WHEN ? THEN ? ELSE tc_placa_historica END,
        tc_externo_placa = CASE WHEN ? THEN ? ELSE tc_externo_placa END
       WHERE id = ? AND empresa_id = ? AND estado = ?`,
      [
        d.fechaPlan ?? null,
        pilotoId ?? null,
        auxiliarId ?? null,
        unidadId ?? null,
        d.estado ?? null,
        d.notas ?? null,
        d.horaCarga ?? null,
        d.regresoEstimado !== undefined,
        d.regresoEstimado?.replace("T", " ") ?? null,
        // tarifa_comercial: override manual explícito, o derivado del
        // nuevo snapshot de tarifa cuando el PATCH cambió tarifaId sin
        // mandar monto.
        d.tarifaComercial !== undefined || snapshotTarifaPatch != null,
        d.tarifaComercial !== undefined ? (d.tarifaComercial ?? null) : (snapshotTarifaPatch?.monto ?? null),
        // Snapshot de la tarifa: se toca si el PATCH trae tarifaId
        // (positivo = nueva tarifa; null = quitar la tarifa del viaje) O
        // si cambió la ruta y la tarifa actual ya no pertenece a la nueva
        // (limpiarTarifaPorCambioRuta) — nunca queda ruta X + tarifa de
        // ruta Y. snapshotTarifaPatch es null salvo cuando d.tarifaId
        // trajo un id válido, así que el "limpiar" escribe null.
        tarifaSnapshotTocado,
        snapshotTarifaPatch?.id ?? null,
        tarifaSnapshotTocado,
        snapshotTarifaPatch?.nombre ?? null,
        tarifaSnapshotTocado,
        snapshotTarifaPatch?.monto ?? null,
        tarifaSnapshotTocado,
        snapshotTarifaPatch?.moneda ?? null,
        d.costoOperativoReferencia !== undefined,
        d.costoOperativoReferencia ?? null,
        d.referenciaCliente !== undefined,
        d.referenciaCliente?.trim() || null,
        d.rutaId ?? null,
        d.rutaCodigo?.trim() || null,
        d.lugarDescargaHistorico?.trim() || null,
        d.contactoNombreHistorico?.trim() || null,
        d.contactoCargoHistorico?.trim() || null,
        d.contactoTelefonoHistorico?.trim() || null,
        escribirTcInterno,
        tcVehiculoIdNuevo,
        escribirTcInterno,
        tcPlacaNueva,
        escribirTcExterno,
        tcExternoNuevo,
        d.id,
        empresaId,
        antes.estado,
      ],
    );

    if (patchResult.affectedRows === 0) {
      // Ambiguo a propósito: sin CLIENT_FOUND_ROWS (el pool de @/lib/db no
      // lo habilita), MySQL reporta affectedRows=0 tanto si el WHERE no
      // matcheó ninguna fila (el conflicto real que queremos detectar) COMO
      // si matcheó pero el SET resultante es idéntico al valor ya
      // guardado (nada que reportar — no es un conflicto). Para distinguir
      // los dos casos se re-consulta el estado DENTRO de la misma
      // transacción/conexión.
      //
      // CRÍTICO: tiene que ser una lectura ACTUAL (`FOR UPDATE`), no un
      // SELECT normal. Bajo REPEATABLE READ (aislamiento por defecto de
      // InnoDB/MySQL) un SELECT plano dentro de esta misma transacción
      // puede seguir viendo el snapshot consistente establecido por una
      // lectura anterior de la propia transacción (p.ej. la de
      // primerConflictoTraslape, que corre antes con este mismo `conn`) —
      // ese snapshot podría seguir mostrando "En ruta" aunque el commit
      // del Jefe (cierre) ya haya cambiado la fila a "Cerrado" en la base.
      // El propio UPDATE de arriba SÍ ve el dato real (todo DML hace
      // lectura actual, nunca snapshot, en cualquier nivel de
      // aislamiento) — por eso su affectedRows=0 ya fue correcto; lo que
      // hay que corregir es que la RE-CONSULTA lea igual de "actual" que
      // el UPDATE, o el diagnóstico podría concluir por error "valores
      // idénticos" cuando en realidad el estado sí cambió. `FOR UPDATE`
      // fuerza una lectura actual (bypassa el snapshot) y, de paso,
      // espera correctamente si otro cierre todavía está en vuelo
      // (bloqueado hasta que esa transacción haga commit/rollback).
      const [verifRows] = await conn.query<RowDataPacket[]>(
        `SELECT estado FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
        [d.id, empresaId],
      );
      const estadoActual = verifRows[0]?.estado != null ? String(verifRows[0].estado) : null;
      if (estadoActual !== antes.estado) {
        await conn.rollback();
        return NextResponse.json(
          {
            error:
              "El estado del viaje cambió mientras se guardaban los cambios. Recarga la información y vuelve a intentarlo.",
          },
          { status: 409 },
        );
      }
    }

    if (auxPersonalIdsLegado != null) {
      await guardarAuxiliaresPlan(d.id, auxPersonalIdsLegado, conn);
    }
    if (auxPersonalIdsNuevo != null) {
      await guardarAuxiliaresPlan(d.id, auxPersonalIdsNuevo, conn);
    }

    // VIAT-0 (punto 12): solo si esta solicitud realmente tocó piloto y/o
    // auxiliares — misma transacción/conexión que el UPDATE de arriba y que
    // guardarAuxiliaresPlan, así la asignación de personal y sus viáticos
    // quedan consistentes en un único commit/rollback. Usa el personal
    // EFECTIVO resultante (lo nuevo si vino en el request, si no lo que ya
    // tenía el plan) para que el sync siempre refleje quién queda
    // realmente asignado.
    if (pilotoId !== undefined || auxPersonalIdsLegado != null || auxPersonalIdsNuevo != null) {
      await sincronizarViaticosPlan(
        empresaId,
        d.id,
        {
          piloto: pilotoId ?? antes.pilotoId ?? null,
          auxiliares: auxPersonalIdsNuevo ?? auxPersonalIdsLegado ?? antesAuxiliaresIds,
        },
        conn,
      );
    }

    if (paradasInput != null) {
      // OPS-3.2d: guardado seguro por identidad (UPDATE in-place para
      // paradas con id, INSERT para nuevas, DELETE solo de las omitidas
      // SIN evidencia). Si intenta eliminar una con evidencia, o llega un
      // id que no pertenece a este plan, `ok:false` — rollback completo
      // de TODA la transacción (piloto/unidad/auxiliares/comercial que
      // este mismo PATCH también estuviera guardando NO se aplican
      // parcialmente).
      const rParadas = await guardarParadasPlan(empresaId, d.id, paradasInput, conn);
      if (!rParadas.ok) {
        await conn.rollback();
        return NextResponse.json({ error: rParadas.error }, { status: 409 });
      }
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error("PATCH tms/planes transacción", e);
    return NextResponse.json(
      { error: "No se pudo actualizar el plan. Intenta de nuevo." },
      { status: 500 },
    );
  } finally {
    // OPS-3.3: libera el candado de traslapes (si se adquirió) DESPUÉS de
    // que la transacción ya confirmó o revirtió — en CUALQUIER salida de
    // este try/catch (éxito, conflicto de traslape, error de escritura,
    // excepción). Debe ir ANTES de conn.release(): GET_LOCK/RELEASE_LOCK
    // son locks de sesión de MySQL, no de la transacción — si la conexión
    // vuelve al pool sin liberarlo, el lock queda retenido por esa sesión
    // y podría bloquear indefinidamente futuros traslapes de esta empresa
    // en cuanto esa conexión se reutilice para otra solicitud.
    if (lockTraslapeAdquirido) {
      try {
        await conn.query("SELECT RELEASE_LOCK(?) AS l", [`tms_traslape_${empresaId}`]);
      } catch {
        /* ok */
      }
    }
    conn.release();
  }

  // Solo se llega aquí si la transacción hizo COMMIT correctamente. Se
  // relee el estado final del plan (fuera de la transacción — ya no hay
  // nada que revertir) para construir un detalle de auditoría real
  // "antes → después", en vez de solo echar de vuelta el payload recibido.
  const despuesRows = await query<RowDataPacket[]>(
    `SELECT p.fecha_plan, u.placa, pil.nombre AS piloto
     FROM tms_planes_viaje p
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
    [d.id, empresaId],
  );
  const despuesAuxMap = await auxiliaresDePlanes([d.id]);
  const despues = {
    fechaPlan: toIsoDate(despuesRows[0]?.fecha_plan) || "",
    piloto: despuesRows[0]?.piloto ? String(despuesRows[0].piloto) : "",
    placa: despuesRows[0]?.placa ? String(despuesRows[0].placa) : "",
    auxiliares: (despuesAuxMap.get(d.id) ?? []).map((a) => a.nombre),
  };

  const cambios: string[] = [];
  if (d.estado && d.estado !== antes.estado) {
    cambios.push(`estado ${antes.estado} → ${d.estado}`);
  }
  if (despues.fechaPlan && despues.fechaPlan !== antes.fechaPlan) {
    cambios.push(`fecha ${antes.fechaPlan || "—"} → ${despues.fechaPlan}`);
  }
  if (despues.piloto !== antes.piloto) {
    cambios.push(`piloto ${antes.piloto || "—"} → ${despues.piloto || "—"}`);
  }
  if (despues.placa !== antes.placa) {
    cambios.push(`unidad ${antes.placa || "—"} → ${despues.placa || "—"}`);
  }
  const auxAntesTxt = antesAuxiliaresNombres.join(", ");
  const auxDespuesTxt = despues.auxiliares.join(", ");
  if (auxAntesTxt !== auxDespuesTxt) {
    cambios.push(
      `auxiliares [${auxAntesTxt || "—"}] → [${auxDespuesTxt || "—"}]`,
    );
  }
  if (d.horaCarga != null) {
    cambios.push(`hora → ${d.horaCarga}`);
  }
  if (d.notas != null) {
    cambios.push("notas actualizadas");
  }
  // OPS-AJUSTES (sección 4, ejemplo de bitácora "Tarifa: Q1,000 → Q1,200"):
  // mensaje específico para tarifa cuando realmente cambia; el resto de
  // "datos comerciales" (regreso estimado, referencia) conserva el
  // resumen genérico existente, sin ampliar más de lo pedido.
  if (d.tarifaComercial !== undefined && d.tarifaComercial !== antes.tarifaComercial) {
    cambios.push(`tarifa Q${antes.tarifaComercial ?? "—"} → Q${d.tarifaComercial ?? "—"}`);
  }
  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§2/§3) — deja rastro de
  // por qué el viaje quedó sin tarifa del catálogo tras cambiar de ruta.
  if (limpiarTarifaPorCambioRuta) {
    cambios.push("tarifa del catálogo desvinculada (no pertenece a la nueva ruta; monto conservado como override)");
  } else if (d.tarifaId !== undefined && d.tarifaId !== antes.tarifaId) {
    cambios.push(`tarifa del catálogo ${antes.tarifaId ?? "—"} → ${d.tarifaId ?? "—"}`);
  }
  if (d.costoOperativoReferencia !== undefined && d.costoOperativoReferencia !== antes.costoOperativoReferencia) {
    cambios.push(`costo operativo Q${antes.costoOperativoReferencia ?? "—"} → Q${d.costoOperativoReferencia ?? "—"}`);
  }
  if (d.regresoEstimado !== undefined || d.referenciaCliente !== undefined) {
    cambios.push("datos comerciales/regreso estimado actualizados");
  }
  if (paradasInput != null) {
    cambios.push(`paradas redefinidas (${paradasAntesCount} → ${paradasInput.length})`);
  }
  // OPS-AJUSTES (sección 4) — motivo del cambio, visible en la bitácora
  // junto al resto de "antes → después" de este mismo registro de
  // auditoría (no se crea un sistema de auditoría paralelo).
  if (d.motivoCambio?.trim()) cambios.push(`motivo: ${d.motivoCambio.trim()}`);
  // OPS-3.2b: distingue en la bitácora una corrección administrativa
  // pre-cierre de una edición común — mismo `detalle` "antes → después"
  // de siempre, solo cambia la etiqueta de `accion`. cancelar_ruta sigue
  // teniendo prioridad si la solicitud además cancela el viaje.
  const accion =
    d.estado === "Cancelado" && d.estado !== antes.estado
      ? "cancelar_ruta"
      : antes.estado === "En ruta" && antes.pendienteCierre
        ? "corregir_pre_cierre"
        : "editar_ruta";
  await registrarAuditoria({
    empresaId,
    usuario: guard.session.username,
    accion,
    modulo: "tms",
    detalle: `Plan #${d.id} ${antes.codigo}${
      cambios.length ? ` · ${cambios.join("; ")}` : " · sin cambios detectados"
    }`,
  });

  return NextResponse.json({ mensaje: "Plan actualizado.", advertencias });
}
