import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { kmPendienteServicio } from "@/lib/flota/import-excel";
import { listarVehiculosParaAlertasKm } from "@/lib/flota/acceso";
import { KM_INTERVALO_SERVICIO_DEFAULT } from "@/lib/flota/constants";
import { permisosEfectivos, tienePermiso } from "@/lib/permisos";
import type { RolGlobal } from "@/lib/roles";
import { listarRecordatorios } from "@/lib/rrhh/recordatorios";
import { ahoraLocal, formatearTimestampVisible } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string }> };

type AlertaCache = {
  at: number;
  alertas: number;
  muestras: string[];
};
const alertasKmCache = new Map<number, AlertaCache>();
const ALERTAS_TTL_MS = 90_000;

export type NotificacionItem = {
  id: string;
  tipo: "aprobacion" | "alerta" | "mensaje";
  titulo: string;
  detalle: string;
  enlace: string;
  creadoAt: string | null;
  refTipo?: string;
  refId?: number;
  acciones?: ("aprobar" | "rechazar")[];
};

/**
 * Feed unificado: aprobaciones operativas, alertas de Flota y alertas de RRHH.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenant(slug);
  if (guard.error) return guard.error;

  const items: NotificacionItem[] = [];
  const rol = guard.session.rol;
  const puedeAprobar =
    rol === "Admin" ||
    rol === "Operaciones" ||
    rol === "CoordinadorPredios";

  // OPS-1: perms se calcula UNA vez aquí y se reutiliza en todas las
  // secciones de abajo (antes cada sección recalculaba las suyas por
  // separado) — mismo criterio ya usado en la sección de recordatorios,
  // ahora extendido a viáticos/cierre/facturación. Admin siempre puede
  // ver todo, sin consultar la matriz.
  const empresaId = guard.empresa.id;
  const perms =
    rol === "Admin" ? null : await permisosEfectivos(guard.session.id, rol as RolGlobal);
  const puede = (modulo: string, accion: "ver" | "editar" = "ver") =>
    rol === "Admin" || Boolean(perms && tienePermiso(perms, modulo, accion));

  // Permisos externos pendientes
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, piloto_nombre, motivo, solicitado_por, creado_at
       FROM flota_permisos_externos
       WHERE empresa_id = ? AND estado = 'pendiente'
       ORDER BY creado_at DESC
       LIMIT 30`,
      [guard.empresa.id],
    );
    for (const r of rows) {
      if (!puedeAprobar) continue;
      items.push({
        id: `permiso-${r.id}`,
        tipo: "aprobacion",
        titulo: `Piloto externo: ${r.piloto_nombre}`,
        detalle: `${r.motivo ?? ""}${
          r.solicitado_por ? ` · Solicitó: ${r.solicitado_por}` : ""
        }`,
        enlace: `/e/${slug}/flota?tab=piloto`,
        creadoAt: r.creado_at ? String(r.creado_at) : null,
        refTipo: "permiso_externo",
        refId: Number(r.id),
        acciones: ["aprobar", "rechazar"],
      });
    }
  } catch {
    /* tabla ausente */
  }

  // Alertas de servicio (km) — query liviana + TTL (sin sync KM / schema)
  if (puedeAprobar) {
    try {
      const empresaId = guard.empresa.id;
      const hit = alertasKmCache.get(empresaId);
      let alertas: number;
      let muestras: string[];
      if (hit && Date.now() - hit.at < ALERTAS_TTL_MS) {
        alertas = hit.alertas;
        muestras = hit.muestras;
      } else {
        const vehiculos = await listarVehiculosParaAlertasKm(empresaId);
        alertas = 0;
        muestras = [];
        for (const v of vehiculos) {
          if (Number(v.activo ?? 1) === 0) continue;
          const pend = kmPendienteServicio(
            Number(v.km_actual ?? 0),
            v.km_ultimo_servicio == null ? null : Number(v.km_ultimo_servicio),
            Number(v.km_intervalo_servicio ?? KM_INTERVALO_SERVICIO_DEFAULT),
          );
          if (pend != null && pend <= 1500) {
            alertas += 1;
            if (muestras.length < 3) {
              muestras.push(
                `${v.placa}${pend <= 0 ? " (vencido)" : ` (${pend} km)`}`,
              );
            }
          }
        }
        alertasKmCache.set(empresaId, {
          at: Date.now(),
          alertas,
          muestras,
        });
      }
      if (alertas > 0) {
        items.push({
          id: "alerta-servicio",
          tipo: "alerta",
          titulo: `${alertas} unidad(es) cerca de servicio`,
          detalle: muestras.join(", ") + (alertas > 3 ? "…" : ""),
          enlace: `/e/${slug}/flota?tab=dashboard`,
          creadoAt: null,
        });
      }
    } catch {
      /* ok */
    }
  }

  // Recordatorios urgentes — cada tipo se muestra solo a quien le corresponde:
  // Licencia de conducir y papelería de vehículo son asunto de Flota (los
  // pilotos/vehículos no pueden operar sin eso), el resto es asunto de RRHH.
  try {
    const puedeFlota =
      rol === "Admin" || (perms && tienePermiso(perms, "flota_vehiculos", "ver"));
    const puedeRrhh =
      rol === "Admin" ||
      rol === "RRHH" ||
      (perms && tienePermiso(perms, "recordatorios", "ver"));

    if (puedeFlota || puedeRrhh) {
      const recordatorios = await listarRecordatorios(guard.empresa.id, {
        soloPendientesProximos: true,
      });
      for (const r of recordatorios) {
        const esDeFlota = r.tipo === "Licencia" || r.tipo === "DocumentoVehiculo";
        if (esDeFlota && !puedeFlota) continue;
        if (!esDeFlota && !puedeRrhh) continue;
        items.push({
          id: r.id != null ? `recordatorio-${r.id}` : `recordatorio-${r.tipo}-${r.titulo}-${r.fecha}`,
          tipo: "alerta",
          titulo: r.titulo,
          detalle:
            r.diasRestantes < 0
              ? `Vencido hace ${Math.abs(r.diasRestantes)} día(s)`
              : r.diasRestantes === 0
                ? "Vence hoy"
                : `Vence en ${r.diasRestantes} día(s)`,
          enlace: esDeFlota
            ? `/e/${slug}/flota?tab=vehiculos`
            : `/e/${slug}/rrhh/recordatorios`,
          creadoAt: null,
        });
      }
    }
  } catch (e) {
    console.error("[notificaciones] recordatorios:", e);
  }

  // Alertas de vacaciones para RRHH. Son derivadas y de solo lectura: el
  // polling no crea recordatorios ni modifica saldos. Los IDs son estables,
  // por lo que cada recarga reemplaza el feed y no duplica notificaciones.
  try {
    const puedeVacaciones =
      rol === "Admin" ||
      rol === "RRHH" ||
      (perms && tienePermiso(perms, "vacaciones", "ver"));

    if (puedeVacaciones) {
      const solicitudes = await query<RowDataPacket[]>(
        `SELECT sv.id, sv.dias_habiles, sv.fecha_inicio, sv.fecha_fin,
                sv.creado_en, e.nombre AS empleado_nombre
         FROM solicitudes_vacaciones sv
         INNER JOIN empleados e
           ON e.id = sv.id_empleado AND e.empresa_id = sv.empresa_id
         WHERE sv.empresa_id = ? AND sv.estado = 'Pendiente'
         ORDER BY sv.creado_en ASC`,
        [guard.empresa.id],
      ).catch(() => [] as RowDataPacket[]);

      for (const solicitud of solicitudes) {
        items.push({
          id: `vacaciones-solicitud-${Number(solicitud.id)}`,
          tipo: "aprobacion",
          titulo: `Vacaciones pendientes — ${String(solicitud.empleado_nombre)}`,
          detalle: `${Number(solicitud.dias_habiles)} día(s) · ${String(solicitud.fecha_inicio).slice(0, 10)} al ${String(solicitud.fecha_fin).slice(0, 10)}`,
          enlace: `/e/${slug}/rrhh/vacaciones`,
          creadoAt: solicitud.creado_en ? String(solicitud.creado_en) : null,
        });
      }

      const saldos = await query<RowDataPacket[]>(
        `SELECT e.id, e.nombre, ROUND(SUM(s.dias_disponibles), 2) AS dias_disponibles
         FROM saldos_vacaciones s
         INNER JOIN empleados e
           ON e.id = s.id_empleado AND e.empresa_id = s.empresa_id
         WHERE s.empresa_id = ? AND s.estado = 'Vigente'
           AND e.estado = 'Activo' AND s.dias_disponibles > 0
         GROUP BY e.id, e.nombre
         HAVING SUM(s.dias_disponibles) >= 15
         ORDER BY dias_disponibles DESC, e.nombre`,
        [guard.empresa.id],
      ).catch(() => [] as RowDataPacket[]);

      for (const saldo of saldos) {
        const dias = Number(saldo.dias_disponibles);
        items.push({
          id: `vacaciones-saldo-15-${Number(saldo.id)}`,
          tipo: "alerta",
          titulo: `Vacaciones acumuladas — ${String(saldo.nombre)}`,
          detalle: `${dias.toLocaleString("es-GT", { maximumFractionDigits: 2 })} días disponibles; alcanzó el umbral de 15 días.`,
          enlace: `/e/${slug}/rrhh/vacaciones`,
          creadoAt: null,
        });
      }
    }
  } catch (e) {
    console.error("[notificaciones] vacaciones:", e);
  }

  // OPS-1 — alertas derivadas de estados reales, reutilizando esta MISMA
  // campana (sin tabla de notificaciones nueva, sin segundo sistema): cada
  // conteo es un COUNT(...) directo sobre la máquina de estados ya
  // existente, gateado por el permiso explícito correspondiente — nunca
  // por rol. Un usuario sin el permiso simplemente no ve esa fila (ni el
  // conteo se calcula para él).
  if (puede("viaticos_autorizar", "ver")) {
    try {
      const rows = await query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM tms_viaticos WHERE empresa_id = ? AND estado = 'PROGRAMADO'`,
        [empresaId],
      );
      const c = Number(rows[0]?.c ?? 0);
      if (c > 0) {
        items.push({
          id: "alerta-viaticos-autorizar",
          tipo: "alerta",
          titulo: "Viáticos pendientes de autorización",
          detalle: `${c} viático(s) en estado PROGRAMADO`,
          enlace: `/e/${slug}/viaticos`,
          creadoAt: null,
        });
      }
    } catch (e) {
      console.error("[notificaciones] viaticos_autorizar:", e);
    }
  }

  if (puede("viaticos_pagar", "ver")) {
    try {
      const rows = await query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM tms_viaticos WHERE empresa_id = ? AND estado = 'AUTORIZADO'`,
        [empresaId],
      );
      const c = Number(rows[0]?.c ?? 0);
      if (c > 0) {
        items.push({
          id: "alerta-viaticos-pagar",
          tipo: "alerta",
          titulo: "Viáticos por pagar",
          detalle: `${c} viático(s) autorizado(s), pendiente de entrega`,
          enlace: `/e/${slug}/viaticos`,
          creadoAt: null,
        });
      }
    } catch (e) {
      console.error("[notificaciones] viaticos_pagar:", e);
    }
  }

  if (puede("viajes_cerrar", "ver")) {
    try {
      // OPS-1 (corregido): mismo criterio que el pendiente_cierre calculado
      // en GET /tms/planes — ya no es estado = 'Descargado' únicamente,
      // sino "no Cerrado/Cancelado" + llegada real registrada en
      // flota_viajes para ese plan.
      const rows = await query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM tms_planes_viaje p
         WHERE p.empresa_id = ?
           AND p.estado NOT IN ('Cerrado', 'Cancelado')
           AND EXISTS (
             SELECT 1 FROM flota_viajes fv
             WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
           )`,
        [empresaId],
      );
      const c = Number(rows[0]?.c ?? 0);
      if (c > 0) {
        items.push({
          id: "alerta-viajes-cerrar",
          tipo: "alerta",
          titulo: "Viajes pendientes de cierre",
          detalle: `${c} viaje(s) con llegada registrada, sin cierre administrativo`,
          enlace: `/e/${slug}/programacion`,
          creadoAt: null,
        });
      }
    } catch (e) {
      console.error("[notificaciones] viajes_cerrar:", e);
    }
  }

  // OPS-4.2d — "Viaje atrasado": viaje físicamente iniciado (En ruta /
  // Cargado — mismo criterio de OPS-4.2b, ver
  // ESTADOS_OCUPACION_INDEFINIDA_SIN_LLEGADA en
  // src/lib/tms/disponibilidad-traslapes.ts, no importado aquí para no
  // crear una dependencia cruzada — mismo criterio que ya justifica
  // SQL_LLEGADA_TECNICA en ese archivo) cuyo regreso_estimado ya venció
  // y que TODAVÍA no registra llegada técnica.
  //
  // Deliberadamente EXCLUYE "Programado": un Programado vencido es "no
  // iniciado"/"programación vencida", un concepto distinto que no se
  // mezcla aquí (ver ticket OPS-4.2d).
  //
  // "Llegada técnica" es EXACTAMENTE el mismo NOT EXISTS que la alerta
  // "Viajes pendientes de cierre" de arriba usa en positivo — ambas
  // alertas son mutuamente excluyentes por diseño: si YA hay llegada,
  // el viaje aparece ahí como "pendiente de cierre", nunca aquí como
  // "atrasado". Evidencias NO cuentan como llegada — no se consultan.
  //
  // "Ahora" se resuelve con ahoraLocal() (America/Guatemala vía
  // Intl.DateTimeFormat, ver src/lib/rrhh/dates.ts) y se pasa como
  // parámetro — NO se usa NOW() de MySQL (el timezone de la conexión no
  // está garantizado) ni new Date().toISOString() (UTC).
  //
  // Una notificación POR PLAN (a diferencia de las alertas agregadas de
  // arriba) — id estable `viaje-atrasado-${id}` para que el polling no
  // duplique entradas. Mismo permiso que ya usa Programación
  // (programacion:ver — Gerente/Jefe/Auxiliar de Operaciones lo traen
  // por defecto, Facturador no).
  if (puede("programacion", "ver")) {
    try {
      // CORRECCIÓN PR #85: sin LIMIT — un viaje atrasado real nunca debe
      // quedar invisible para Operaciones solo porque hay más de N. La
      // query ya está acotada por empresa/estado/regreso_estimado/
      // llegada técnica; no hace falta (ni corresponde en este ticket)
      // paginación ni un COUNT aparte.
      const rows = await query<RowDataPacket[]>(
        `SELECT p.id, p.codigo, p.regreso_estimado
         FROM tms_planes_viaje p
         WHERE p.empresa_id = ?
           AND p.estado IN ('En ruta', 'Cargado')
           AND p.regreso_estimado IS NOT NULL
           AND p.regreso_estimado < ?
           AND NOT EXISTS (
             SELECT 1 FROM flota_viajes fv
             WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
           )
         ORDER BY p.regreso_estimado ASC`,
        [empresaId, ahoraLocal()],
      );
      for (const r of rows) {
        items.push({
          id: `viaje-atrasado-${Number(r.id)}`,
          tipo: "alerta",
          titulo: "Viaje atrasado",
          detalle: `El viaje ${String(r.codigo)} superó su regreso estimado (${formatearTimestampVisible(r.regreso_estimado as string | Date | null)}) y aún no registra llegada.`,
          enlace: `/e/${slug}/programacion`,
          creadoAt: null,
        });
      }
    } catch (e) {
      console.error("[notificaciones] viajes_atrasados:", e);
    }
  }

  // OPS-1 (punto 17): todavía NO existe tabla de facturas — "facturable"
  // en esta fase es únicamente estado = 'Cerrado'. Deliberadamente NO se
  // llama "sin facturar" (eso implicaría saber si ya se facturó, lo cual
  // requiere FACT-1 con su propia tabla y un NOT EXISTS contra ella).
  if (puede("facturacion", "ver")) {
    try {
      const rows = await query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM tms_planes_viaje WHERE empresa_id = ? AND estado = 'Cerrado'`,
        [empresaId],
      );
      const c = Number(rows[0]?.c ?? 0);
      if (c > 0) {
        items.push({
          id: "alerta-viajes-facturables",
          tipo: "alerta",
          titulo: "Viajes cerrados listos para facturación",
          detalle: `${c} viaje(s) cerrado(s)`,
          enlace: `/e/${slug}/tms`,
          creadoAt: null,
        });
      }
    } catch (e) {
      console.error("[notificaciones] viajes_facturables:", e);
    }
  }

  return NextResponse.json({
    notificaciones: items,
    pendientes: items.filter((i) => i.tipo === "aprobacion").length,
  });
}
