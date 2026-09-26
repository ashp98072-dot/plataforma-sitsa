import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarParadasDePlanes, type ParadaInput } from "@/lib/tms/paradas";
import { tarifasActivasDeVariasRutas } from "@/lib/tms/ruta-tarifas";
import { MAX_AUXILIARES, MAX_FILAS_LOTE, type BorradorLote } from "@/lib/tms/programacion-lote";
import { calcularTrasladoRegreso } from "@/lib/tms/programacion-copia-ventana";

/**
 * TMS-PROGRAMACION-LOTE-1 (PR A) — COPIAR PROGRAMACIÓN de otra fecha.
 *
 * Lee (SOLO LECTURA) los planes de la fecha origen y arma BORRADORES editables para la fecha destino. Se copia
 * únicamente la CONFIGURACIÓN de programación (cliente, ruta, hora, tipo de traslado, tipo de viaje, unidad, TC,
 * piloto, auxiliares, paradas y, en tercerizados, los campos externos). NUNCA: código, estado, cierre, evidencias,
 * viaje físico (flota_viajes), horas/km reales, facturación/pagos, bitácora, gastos, solicitudes de cliente,
 * snapshots viejos de tarifa/contacto ni montos de viáticos — todo eso lo genera de nuevo el motor de lote.
 * Los Cerrados sirven como origen; los Cancelados se excluyen.
 */
export type OrigenFila = {
  planId: number;
  codigo: string;
  estado: string;
  clienteNombre: string | null;
  rutaCodigo: string | null;
  pilotoNombre: string | null;
  /** Piloto extra del viaje origen (informativo; se copia si sigue disponible). */
  pilotoExtraNombre?: string | null;
  auxiliaresNombres: string[];
  unidadPlaca: string | null;
  tcPlaca: string | null;
};

export type FilaCopia = { borrador: BorradorLote; origen: OrigenFila; advertencias: string[] };

const texto = (v: unknown): string | null => {
  const t = v == null ? "" : String(v).trim();
  return t ? t : null;
};

/**
 * A2.2 — el regreso estimado del origen se traslada al destino conservando hora y desfase en días respecto a su
 * fecha_plan (ver programacion-copia-ventana.ts). Lo calcula SIEMPRE el servidor desde el plan origen.
 */
function trasladoDeOrigen(fechaOrigen: string, horaCargaOrigen: unknown, regresoOrigen: unknown): Pick<BorradorLote, "regresoOffsetDias" | "regresoHora"> {
  const t = calcularTrasladoRegreso(fechaOrigen, horaCargaOrigen == null ? null : String(horaCargaOrigen), regresoOrigen == null ? null : String(regresoOrigen));
  return { regresoOffsetDias: t ? t.offsetDias : null, regresoHora: t ? t.hora : null };
}

export async function cargarCopiaDeFecha(empresaId: number, fechaOrigen: string): Promise<FilaCopia[]> {
  const planes = await query<RowDataPacket[]>(
    `SELECT p.id, p.codigo, p.estado, p.cliente_id, c.nombre AS cliente_nombre, p.ruta_id, p.ruta_codigo_historico,
            p.hora_carga, DATE_FORMAT(p.regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado, p.tipo_traslado, p.tipo_viaje, u.placa AS unidad_placa,
            p.tc_vehiculo_id, p.tc_placa_historica, p.tc_externo_placa,
            pil.id_empleado AS piloto_empleado_id, pil.nombre AS piloto_nombre,
            aux1.id_empleado AS aux1_empleado_id, aux1.nombre AS aux1_nombre,
            p.piloto_externo_nombre, p.auxiliares_externos, p.unidad_externa_placa, p.unidad_externa_descripcion,
            p.transportista_externo, p.costo_tercerizado
     FROM tms_planes_viaje p
     LEFT JOIN tms_clientes c ON c.id = p.cliente_id AND c.empresa_id = p.empresa_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     LEFT JOIN tms_personal aux1 ON aux1.id = p.auxiliar_id
     WHERE p.empresa_id = ? AND p.fecha_plan = ? AND p.estado <> 'Cancelado'
     ORDER BY p.hora_carga IS NULL, p.hora_carga, p.id`,
    [empresaId, fechaOrigen],
  );
  if (!planes.length) return [];
  const planIds = planes.map((p) => Number(p.id));
  const [extraRows, auxRows, paradasMap] = await Promise.all([
    // Piloto extra de los planes origen (una consulta; tolera que la tabla aún no exista).
    query<RowDataPacket[]>(
      `SELECT x.plan_id, tp.id_empleado, tp.nombre
       FROM tms_plan_pilotos_adicionales x
       INNER JOIN tms_personal tp ON tp.id = x.personal_id AND tp.empresa_id = ?
       WHERE x.plan_id IN (${planIds.map(() => "?").join(",")})
       ORDER BY x.plan_id, x.orden`,
      [empresaId, ...planIds],
    ).catch(() => [] as RowDataPacket[]),
    query<RowDataPacket[]>(
      `SELECT pa.plan_id, pa.orden, tp.id_empleado, tp.nombre
       FROM tms_plan_auxiliares pa
       INNER JOIN tms_personal tp ON tp.id = pa.personal_id AND tp.empresa_id = ?
       WHERE pa.plan_id IN (${planIds.map(() => "?").join(",")})
       ORDER BY pa.plan_id, pa.orden`,
      [empresaId, ...planIds],
    ).catch(() => [] as RowDataPacket[]),
    listarParadasDePlanes(planIds),
  ]);
  const extraPorPlan = new Map<number, RowDataPacket>();
  for (const x of extraRows) if (!extraPorPlan.has(Number(x.plan_id))) extraPorPlan.set(Number(x.plan_id), x);
  const auxPorPlan = new Map<number, RowDataPacket[]>();
  for (const a of auxRows) auxPorPlan.set(Number(a.plan_id), [...(auxPorPlan.get(Number(a.plan_id)) ?? []), a]);

  return planes.map((p, i) => {
    const id = Number(p.id);
    const tercerizado = String(p.tipo_viaje ?? "Propio") === "Tercerizado";
    const advertencias: string[] = [];
    // Auxiliares: tms_plan_auxiliares (hasta 8); planes antiguos: solo auxiliar_id.
    const auxFilas = auxPorPlan.get(id) ?? (p.aux1_nombre ? [{ id_empleado: p.aux1_empleado_id, nombre: p.aux1_nombre }] : []);
    const auxiliarEmpleadoIds: number[] = [];
    for (const a of auxFilas.slice(0, MAX_AUXILIARES)) {
      if (a.id_empleado != null) auxiliarEmpleadoIds.push(Number(a.id_empleado));
      else advertencias.push(`El auxiliar "${String(a.nombre)}" no está vinculado a un empleado: selecciónalo.`);
    }
    const extra = tercerizado ? undefined : extraPorPlan.get(id);
    const pilotoExtraEmpleadoId = extra?.id_empleado != null ? Number(extra.id_empleado) : null;
    if (extra && pilotoExtraEmpleadoId == null) advertencias.push(`El piloto extra "${String(extra.nombre)}" no está vinculado a un empleado: no se copiará.`);
    const pilotoEmpleadoId = !tercerizado && p.piloto_empleado_id != null ? Number(p.piloto_empleado_id) : null;
    if (!tercerizado && p.piloto_nombre && pilotoEmpleadoId == null) advertencias.push(`El piloto "${String(p.piloto_nombre)}" no está vinculado a un empleado: selecciónalo.`);

    const paradas: ParadaInput[] = (paradasMap.get(id) ?? []).map((pp) => ({
      lugarNombre: String(pp.lugar_nombre), tipo: String(pp.tipo), requiereEvidencia: Boolean(pp.requiere_evidencia),
    }));

    const borrador: BorradorLote = {
      fila: i + 1,
      origenPlanId: id,
      rutaId: p.ruta_id != null ? Number(p.ruta_id) : null,
      clienteId: p.cliente_id != null ? Number(p.cliente_id) : null,
      horaCarga: p.hora_carga ? String(p.hora_carga).slice(0, 5) : null,
      ...trasladoDeOrigen(fechaOrigen, p.hora_carga, p.regreso_estimado),
      tipoTraslado: texto(p.tipo_traslado),
      tipoViaje: tercerizado ? "Tercerizado" : "Propio",
      unidadPlaca: tercerizado ? null : texto(p.unidad_placa),
      tcVehiculoId: !tercerizado && p.tc_vehiculo_id != null ? Number(p.tc_vehiculo_id) : null,
      pilotoEmpleadoId,
      pilotoExtraEmpleadoId,
      auxiliarEmpleadoIds: tercerizado ? [] : auxiliarEmpleadoIds,
      tarifaId: null, // NUNCA la del origen: el motor toma la vigente/predeterminada de la ruta
      externo: tercerizado ? {
        pilotoExternoNombre: texto(p.piloto_externo_nombre) ?? "",
        auxiliaresExternos: String(p.auxiliares_externos ?? "").split("\n").map((n) => n.trim()).filter(Boolean).slice(0, MAX_AUXILIARES),
        unidadExternaPlaca: texto(p.unidad_externa_placa) ?? "",
        unidadExternaDescripcion: texto(p.unidad_externa_descripcion) ?? "",
        transportistaExterno: texto(p.transportista_externo) ?? "",
        costoTercerizado: p.costo_tercerizado != null ? Number(p.costo_tercerizado) : null,
        tcExternoPlaca: texto(p.tc_externo_placa) ?? "",
      } : null,
      paradas,
    };
    return {
      borrador,
      advertencias,
      origen: {
        planId: id, codigo: String(p.codigo), estado: String(p.estado),
        clienteNombre: texto(p.cliente_nombre), rutaCodigo: texto(p.ruta_codigo_historico),
        pilotoNombre: tercerizado ? texto(p.piloto_externo_nombre) : texto(p.piloto_nombre),
        pilotoExtraNombre: extra ? texto(extra.nombre) : null,
        auxiliaresNombres: tercerizado ? borrador.externo!.auxiliaresExternos : auxFilas.map((a) => String(a.nombre)),
        unidadPlaca: tercerizado ? texto(p.unidad_externa_placa) : texto(p.unidad_placa),
        tcPlaca: tercerizado ? texto(p.tc_externo_placa) : texto(p.tc_placa_historica),
      },
    };
  });
}

/**
 * Filas que llegan del cliente al validar/confirmar: el cliente solo aporta las EDICIONES permitidas. Todo lo
 * demás (paradas, origen) se vuelve a leer del plan origen en el servidor y se exige que sea de ESTA empresa, de la
 * fecha origen indicada y que NO esté Cancelado (igual que la carga inicial; un Cerrado sí es origen válido — no
 * confundir con la regla del plan DESTINO cancelado, que sí permite volver a copiar) — nunca se confía en ids o paradas enviados por el cliente.
 */
export type EdicionFilaCopia = Omit<BorradorLote, "paradas" | "regresoOffsetDias" | "regresoHora">;

export async function borradoresDesdeCliente(
  empresaId: number,
  fechaOrigen: string,
  filas: EdicionFilaCopia[],
): Promise<{ ok: true; borradores: BorradorLote[] } | { ok: false; error: string }> {
  if (filas.length > MAX_FILAS_LOTE) return { ok: false, error: `Máximo ${MAX_FILAS_LOTE} filas por lote.` };
  const origenIds = [...new Set(filas.map((f) => f.origenPlanId).filter((n): n is number => n != null))];
  if (filas.some((f) => f.origenPlanId == null)) return { ok: false, error: "Cada fila debe provenir de un viaje de la fecha origen." };
  if (new Set(filas.map((f) => f.origenPlanId)).size !== filas.length) return { ok: false, error: "Un mismo viaje origen no puede copiarse dos veces en el lote." };
  const validos = origenIds.length
    ? await query<RowDataPacket[]>(
        `SELECT id, hora_carga, DATE_FORMAT(regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ? AND estado <> 'Cancelado' AND id IN (${origenIds.map(() => "?").join(",")})`,
        [empresaId, fechaOrigen, ...origenIds],
      )
    : [];
  if (validos.length !== origenIds.length) return { ok: false, error: "Algún viaje origen no existe, está cancelado o no pertenece a la fecha/empresa indicada." };
  const paradasMap = await listarParadasDePlanes(origenIds);
  const origenPorId = new Map(validos.map((v) => [Number(v.id), v])); // hora_carga y regreso del ORIGEN (nunca del cliente)
  return {
    ok: true,
    borradores: filas.map((f) => ({
      ...f,
      ...trasladoDeOrigen(fechaOrigen, origenPorId.get(f.origenPlanId as number)?.hora_carga, origenPorId.get(f.origenPlanId as number)?.regreso_estimado), // del ORIGEN en servidor, nunca del cliente
      paradas: (paradasMap.get(f.origenPlanId as number) ?? []).map((pp) => ({
        lugarNombre: String(pp.lugar_nombre), tipo: String(pp.tipo), requiereEvidencia: Boolean(pp.requiere_evidencia),
      })),
    })),
  };
}

export type CatalogosCopia = {
  empleados: { id: number; codigo: string; nombre: string }[];
  unidades: { placa: string; disponible: boolean; motivo: string | null }[];
  tcs: { id: number; placa: string; disponible: boolean; motivo: string | null }[];
  tarifasPorRuta: Record<number, { id: number; nombre: string; monto: number; moneda: string; predeterminada: boolean }[]>;
};

/** Opciones para editar la vista previa: solo lo que el motor aceptaría (empleados activos, unidades/TC de Flota, tarifas vigentes). */
export async function catalogosParaCopia(empresaId: number, rutaIds: number[]): Promise<CatalogosCopia> {
  const [empleados, disp, tarifas] = await Promise.all([
    query<RowDataPacket[]>(`SELECT id, codigo, nombre FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre`, [empresaId]),
    listarDisponibilidadVehiculos(empresaId),
    tarifasActivasDeVariasRutas(empresaId, rutaIds),
  ]);
  const activos = disp.vehiculos.filter((v) => v.activo);
  return {
    empleados: empleados.map((e) => ({ id: Number(e.id), codigo: String(e.codigo ?? ""), nombre: String(e.nombre) })),
    unidades: activos.filter((v) => v.tipoUnidad !== "TC").map((v) => ({ placa: v.placa, disponible: v.puedeEnviar, motivo: v.puedeEnviar ? null : v.motivoNoDisponible ?? v.estadoDisponibilidad })),
    tcs: activos.filter((v) => v.tipoUnidad === "TC").map((v) => ({ id: v.id, placa: v.placa, disponible: v.puedeEnviar, motivo: v.puedeEnviar ? null : v.motivoNoDisponible ?? v.estadoDisponibilidad })),
    tarifasPorRuta: Object.fromEntries([...tarifas.entries()].map(([id, t]) => [id, t.tarifas.map((x) => ({ id: x.id, nombre: x.nombre, monto: x.monto, moneda: x.moneda, predeterminada: x.predeterminada }))])),
  };
}
