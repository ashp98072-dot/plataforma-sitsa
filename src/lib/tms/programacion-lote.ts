import { huellaAvisosCopia, MSG_AVISOS_SIN_ACEPTAR } from "@/lib/tms/programacion-copia-avisos";
import { resolverUnidadTmsSoloLectura, resolverUnidadTmsTx } from "@/lib/tms/unidad-canonica";
import { abrirLectorVistaPrevia, errorVistaPrevia, PRESUPUESTO_VISTA_PREVIA_MS, type LectorVistaPrevia } from "@/lib/tms/lector-vista-previa";
import { ErrorPlazoOperacion, plazoRestanteMs } from "@/lib/db-plazo";
import { ErrorCB2 } from "@/lib/flota/cb2/model";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { hoyLocal } from "@/lib/rrhh/dates";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { asegurarCodigoPlanUnicoTx } from "@/lib/tms/codigo-plan";
import { CodigoPlanAgotadoError, detalleErrorSqlUsuario, insertarPlanConCodigoUnico, resumenErrorSql } from "@/lib/tms/codigo-plan-colision";
import { personalDesdeEmpleado } from "@/lib/tms/personal-resolucion";
import { guardarAuxiliaresPlan, upsertLugar } from "@/lib/tms/plan-comunes";
import { guardarPilotoExtraPlan } from "@/lib/tms/piloto-extra";
import { guardarParadasPlan, type ParadaInput } from "@/lib/tms/paradas";
import { tarifasActivasDeVariasRutas } from "@/lib/tms/ruta-tarifas";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { resolverTcInterno } from "@/lib/tms/tc-plan";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import type { RecursoDia } from "@/lib/tms/disponibilidad-programacion-dia";
import {
  mensajeConflictoProgramacionIntervalo,
  primerConflictoProgramacionIntervalo,
  ventanaProgramacionSegura,
  ventanasProgramacionSeSolapan,
  type VentanaProgramacion,
} from "@/lib/tms/disponibilidad-programacion-intervalos";
import { regresoTrasladado } from "@/lib/tms/programacion-copia-ventana";

/**
 * TMS-PROGRAMACION-LOTE-1 (PR A) — MOTOR REUTILIZABLE de creación de planes por lote.
 *
 * Recibe BORRADORES normalizados (`BorradorLote`, ya con ids; nunca texto libre del Excel) y:
 *   1. resuelve/revalida cada fila contra datos REALES de la empresa (ruta, cliente, personal, unidad, TC, tarifa);
 *   2. comprueba disponibilidad POR INTERVALOS contra viajes existentes (primerConflictoProgramacionIntervalo, la
 *      MISMA política de Programación manual: piloto, auxiliar, unidad, TC; sin hora o sin regreso = todo fecha_plan)
 *      y colisiones DENTRO del lote con esa misma comparación de ventanas;
 *   3. (confirmar) toma el candado por empresa `tms_traslape_<empresa>` — el mismo del POST manual y la
 *      importación Excel —, REVALIDA todo bajo el candado y, solo si el 100% pasa, abre UNA transacción y
 *      crea todos los planes (auxiliares, paradas, viáticos por configuración vigente, trazabilidad de origen
 *      y auditoría). Cualquier fallo => ROLLBACK completo (todo o nada) y errores por fila.
 *
 * Reutiliza las MISMAS piezas que el POST manual y el importador (personalDesdeEmpleado, upsertLugar,
 * guardarAuxiliaresPlan, guardarParadasPlan, sincronizarViaticosPlan, resolverTcInterno). La generación de código
 * usa la variante TRANSACTION-AWARE (asegurarCodigoPlanUnicoTx, ver codigo-plan.ts) porque aquí SÍ hay varias
 * filas insertándose dentro de la MISMA transacción, y cada una debe ver los códigos que las anteriores ya
 * insertaron sin confirmar. No refactoriza el POST manual ni el importador (decisión de alcance del PR A).
 *
 * COPIA FIEL (decisión del propietario; SOLO este flujo — la programación ordinaria conserva todas sus reglas):
 *  - Nunca se copia historia operativa: estado (siempre 'Programado'), código, cierres, evidencias, kilometraje, cobros, facturas, pagos
 *    ni movimientos financieros; viáticos se recalculan por la configuración vigente; notas y referencia del cliente NO se copian.
 *  - Se copian los datos operativos y económicos del plan origen: ruta (re-resuelta), tarifa (vigente tal cual; histórica con su
 *    fotografía id/nombre/monto/moneda leída del plan origen en el servidor; sin tarifa = sin tarifa), costo operativo de referencia,
 *    costo tercerizado y datos externos, vehículo solicitado (sin dato o inexistente = sin él).
 *  - No bloquean, solo AVISAN (y exigen aceptación verificada en el servidor): ventana incompleta, solape entre filas del lote, recurso ocupado en
 *    el destino, personal inactivo / unidad o TC fuera de servicio o en taller / viaje en curso, ruta o vehículo solicitado inactivo,
 *    tarifa histórica y datos faltantes del origen (incluida una tarifa sin monto: la copia queda sin tarifa).
 *  - ORIGEN en cualquier estado: se cargan y validan viajes Programado, En curso, Cerrado y Cancelado (el estado nunca se copia).
 *
 *  SIGUEN IMPIDIENDO GUARDAR (todo el lote se rechaza, no se crea nada) — todas son INTEGRIDAD de datos o SEGURIDAD, no reglas operativas:
 *   · Referencias rotas o ajenas: ruta, cliente, empleado, unidad (que no exista en Flota) o TC inexistentes/inaccesibles para ESTA empresa
 *     (FK / aislamiento multiempresa); piloto extra inexistente.
 *   · Identidad de la unidad TMS (#624): la placa choca con otra identidad (no se puede resolver `unidad_id` sin duplicar/fusionar unidades).
 *   · Estructura inválida: tercerizado con recursos internos o propio con datos externos (convertiría el tipo de viaje), la misma persona dos veces
 *     en un viaje, más de 8 auxiliares, TC con la misma placa que la unidad, placa de TC usada como unidad, textos que exceden la columna
 *     (truncarlos alteraría el dato), costo tercerizado negativo, hora con formato inválido, regreso editado inválido.
 *   · Tarifa inyectada: una tarifa no vigente que NO es la del propio plan origen (el cliente no puede fijar montos).
 *   · Anti-duplicado: ya existe una copia NO cancelada de ese origen para esa fecha destino (una copia destino Cancelada permite re-copiar).
 *   · Seguridad/consistencia: permisos, empresa de la sesión, origen que no es de esa empresa/fecha, más de MAX_FILAS_LOTE filas, aceptación de
 *     avisos ausente o desactualizada, tarifa vigente distinta a la de la vista previa, y cualquier error de base de datos (rollback atómico).
 *
 *  NO SE PUEDE COPIAR EXACTAMENTE (se copia lo posible, con aviso; nunca se inventa):
 *   · Personal inactivo: se reutiliza su registro de personal existente (si no existe, el lote se rechaza: no se crea personal inactivo).
 *   · Vehículo solicitado inexistente en el catálogo de la empresa: queda NULL (la FK impide el id). Inactivo: se conserva con aviso.
 *   · Tarifa histórica sin monto guardado en el origen: la copia queda sin tarifa. Piloto externo sin nombre: queda sin él.
 *   · No se copian por diseño: estado, código, cierres, evidencias, kilometraje, cobros/facturas/pagos/movimientos, viáticos del origen (se
 *     recalculan con la configuración vigente), notas y referencia del cliente.
 */
export const MAX_FILAS_LOTE = 200;
export const MAX_AUXILIARES = 8;
const LOCK_TIMEOUT_SEGUNDOS = 8; // igual que planes/route.ts y programacion-import.ts
const HORA_RE = /^\d{2}:\d{2}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ExternoLote = {
  pilotoExternoNombre: string;
  auxiliaresExternos: string[];
  unidadExternaPlaca: string;
  unidadExternaDescripcion: string;
  transportistaExterno: string;
  costoTercerizado: number | null;
  tcExternoPlaca: string;
};

export type BorradorLote = {
  /** Número de fila que ve el usuario en la vista previa (para mensajes). */
  fila: number;
  /** Plan del que nace la copia (trazabilidad + anti-duplicado). */
  origenPlanId: number | null;
  rutaId: number | null;
  clienteId: number | null;
  horaCarga: string | null;
  /**
   * A2.2 — traslado del regreso estimado (lo pone el SERVIDOR desde el plan origen; nunca el cliente): desfase en
   * días respecto a la fecha_plan del origen y hora. `null`/ausente = el origen no tenía regreso (reserva diaria).
   */
  regresoOffsetDias?: number | null;
  regresoHora?: string | null;
  /** Edición explícita de la fecha/hora de regreso de la copia; validada por el servidor. */
  regresoEditado?: string | null;
  tipoTraslado: string | null;
  tipoViaje: "Propio" | "Tercerizado";
  unidadPlaca: string | null;
  tcVehiculoId: number | null;
  pilotoEmpleadoId: number | null;
  /** PILOTO EXTRA (empleado de RRHH con puesto de piloto; máximo 1). Ausente/null = el viaje no lo tiene. Solo viajes Propios. */
  pilotoExtraEmpleadoId?: number | null;
  auxiliarEmpleadoIds: number[];
  tarifaId: number | null;
  externo: ExternoLote | null;
  /** Las pone el SERVIDOR (desde el plan origen); nunca se aceptan del cliente. */
  paradas: ParadaInput[];
  /**
   * VEHÍCULO SOLICITADO — lo pone el SERVIDOR desde el plan origen (nunca el cliente). Es OBLIGATORIO: la copia hereda lo que el cliente pidió en el
   * viaje origen y solo si ese perfil sigue activo en esta empresa. Un origen sin vehículo (histórico) o con un perfil inexistente/inactivo/de otra
   * empresa BLOQUEA el lote entero (todo o nada) antes de cualquier INSERT; jamás se infiere de la placa, la unidad ni la tarifa.
   */
  vehiculoSolicitadoPerfilId?: number | null;
};

export type TarifaResuelta = { id: number; nombre: string; monto: number; moneda: string };

type Resuelto = {
  clienteId: number | null;
  rutaId: number | null;
  rutaCodigo: string | null;
  destino: string | null;
  lugarCarga: string | null;
  contacto: { nombre: string | null; cargo: string | null; telefono: string | null };
  tarifa: TarifaResuelta | null;
  unidad: { placa: string; flotaVehiculoId: number | null } | null;
  tc: { vehiculoId: number; placa: string } | null;
  pilotoNombre: string | null;
  auxiliaresNombres: string[];
  /** Perfil de vehículo solicitado heredado del origen y re-validado contra el catálogo ACTIVO de la empresa (id + nombre vigente para la fotografía). */
  vehiculo: { id: number; nombre: string } | null;
  /** Costo operativo de referencia del origen (dato económico informativo; no es cobro ni movimiento). */
  costoReferencia: number | null;
};

export type ResultadoFilaLote = {
  fila: number;
  estado: "ok" | "error";
  errores: string[];
  /** Solo si estado = ok: lo que se creará (tarifa efectiva incluida). */
  tarifa: TarifaResuelta | null;
  /**
   * DIAGNÓSTICO por fila (solo números de fila y tipos de recurso, sin nombres ni placas): si la fila no tiene hora/regreso válido (reserva todo el día),
   * a cuántas otras filas bloquea y por qué tipo de recurso compartido.
   */
  diagnostico?: { horaInvalida: boolean; regresoInvalido: boolean; filasAfectadas: number[]; recursosCompartidos: string[] };
  /**
   * Choques DENTRO del lote por recurso. `causa = dia_completo`: alguna de las filas no tiene hora o regreso válido y por eso reserva todo el día;
   * `solape`: las ventanas se cruzan de verdad (no se relaja).
   */
  conflictos?: ConflictoLote[];
  /**
   * AVISOS que NO bloquean (la copia es fiel al origen): la fila se crea igual. `ventana_incompleta`: comparte recurso con otras filas del lote y alguna no
   * tiene hora/regreso válido (reserva todo el día); `destino_ocupado`: el recurso ya tiene otro viaje en la fecha destino.
   */
  avisos?: AvisoLote[];
};

export type ConflictoLote = { recurso: "persona" | "unidad" | "tc"; filas: number[]; causa: "dia_completo" | "solape" };
/**
 * Aviso con datos ESTRUCTURADOS: lo que define materialmente el conflicto es `tipo`, `recurso` (qué recurso afecta), `ocupadoPor` (viaje existente que lo ocupa,
 * solo en `destino_ocupado`) y `filas` (filas relacionadas del lote, solo en `ventana_incompleta`). `mensaje` es solo presentación y NO se usa para decidir ni para aceptar.
 */
export type TipoAvisoLote =
  | "ventana_incompleta" | "destino_ocupado"
  | "solape_lote"            // dos filas del lote con ventanas conocidas que se cruzan (el origen ya lo tenía así)
  | "tarifa_historica"       // la tarifa del origen ya no es vigente: se copia su fotografía (id, nombre, monto, moneda)
  | "recurso_no_disponible"  // personal inactivo, unidad/TC fuera de servicio o en taller, ruta/vehículo solicitado inactivo, viaje en curso
  | "dato_incompleto";       // el origen no tiene el dato: se copia sin él (nunca se inventa)
export type AvisoLote = {
  tipo: TipoAvisoLote;
  recurso: { tipo: string; id: string };
  filas?: number[];
  ocupadoPor?: { planId: number };
  mensaje: string;
};

type FilaInterna = {
  borrador: BorradorLote; errores: string[]; resuelto: Resuelto | null; recursos: RecursoDia[]; filasAfectadas?: Set<number>; recursosCompartidos?: Set<string>;
  conflictos?: ConflictoLote[]; avisos?: AvisoLote[];
};

const fmt = (iso: string) => iso.split("-").reverse().join("/");

/** Regreso estimado de la fila para la fecha destino ("YYYY-MM-DDTHH:mm") o null (sin regreso: reserva diaria). */
export function regresoDestinoDeBorrador(b: Pick<BorradorLote, "regresoOffsetDias" | "regresoHora">, fechaDestino: string): string | null {
  return b.regresoOffsetDias != null && b.regresoHora ? regresoTrasladado(fechaDestino, { offsetDias: b.regresoOffsetDias, hora: b.regresoHora }) : null;
}

/**
 * Regreso que se PERSISTE para la fila: exactamente el de la ventana validada. Si el regreso derivado es incoherente
 * con la hora de carga efectiva de la fila (p. ej. la hora se editó en la vista previa), la validación cae a reserva
 * diaria y aquí devuelve null: nunca se guarda un regreso que la validación no usó.
 */
export function regresoPersistidoDeBorrador(b: Pick<BorradorLote, "horaCarga" | "regresoOffsetDias" | "regresoHora">, fechaDestino: string): string | null {
  return ventanaDeBorrador(b, fechaDestino).regresoEstimado;
}

/** Ventana de reserva de la fila en la fecha destino (misma política que POST/PATCH/importación). */
export function ventanaDeBorrador(b: Pick<BorradorLote, "horaCarga" | "regresoOffsetDias" | "regresoHora">, fechaDestino: string): VentanaProgramacion {
  return ventanaProgramacionSegura({ fechaPlan: fechaDestino, horaCarga: b.horaCarga || null, regresoEstimado: regresoDestinoDeBorrador(b, fechaDestino) });
}
const norm = (s: string) => s.trim().toUpperCase();
const ids = (l: number[]) => `(${l.map(() => "?").join(",")})`;

/** Migración de `tms_plan_origen` aún sin aplicar (tabla inexistente). */
const sinTabla = (e: unknown) => {
  const x = e as { code?: string; errno?: number };
  return x?.code === "ER_NO_SUCH_TABLE" || x?.errno === 1146;
};
export const MSG_MIGRACION_ORIGEN = "Falta aplicar la migración de trazabilidad de origen (tms_plan_origen). No se creó ningún viaje.";

/**
 * Ya existe una copia NO cancelada de estos planes origen para esta fecha destino. Un plan destino Cancelado
 * NO cuenta (se puede volver a generar); el historial de intentos anteriores se conserva en tms_plan_origen.
 * Índice: (empresa_id, tipo, fecha_destino, plan_origen_id). `null` = la tabla aún no existe.
 */
export async function copiasVigentesDeOrigen(empresaId: number, fechaDestino: string, origenIds: number[]): Promise<Map<number, string> | null> {
  const mapa = new Map<number, string>();
  const lista = [...new Set(origenIds.filter((n) => n > 0))];
  if (!lista.length) return mapa;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT o.plan_origen_id, p.codigo
       FROM tms_plan_origen o
       INNER JOIN tms_planes_viaje p ON p.id = o.plan_id AND p.empresa_id = o.empresa_id
       WHERE o.empresa_id = ? AND o.tipo = 'COPIA' AND o.fecha_destino = ?
         AND o.plan_origen_id IN ${ids(lista)} AND p.estado <> 'Cancelado'`,
      [empresaId, fechaDestino, ...lista],
    );
    for (const r of rows) mapa.set(Number(r.plan_origen_id), String(r.codigo));
    return mapa;
  } catch (e) {
    if (sinTabla(e)) return null;
    throw e;
  }
}

/** Clave de un viaje PROPIO "gemelo": misma ruta + misma hora de carga + misma unidad + mismo piloto (empleado). */
export const claveGemelo = (rutaId: number, hora: string, placa: string, pilotoEmpleadoId: number) => `${rutaId}|${hora}|${norm(placa)}|${pilotoEmpleadoId}`;

/**
 * ANTI-DUPLICADO POR CONTENIDO (TMS-PROGRAMACION-DUPLICADA-1). El anti-duplicado por `tms_plan_origen` solo ve copias previas del MISMO plan
 * origen: no detecta que el destino YA tenga el mismo viaje porque lo creó la importación de Excel, el alta manual o la copia de OTRO día
 * origen con idéntica programación. Aquí se buscan, en la fecha destino, viajes PROPIOS no cancelados con la misma ruta, la misma hora de
 * carga (no nula), la misma unidad y el mismo piloto — una combinación físicamente imposible de ser dos viajes distintos (la unidad y el piloto
 * no pueden salir dos veces a la misma hora). Solo lectura, acotada a la empresa. Devuelve clave → código del plan existente.
 */
export async function gemelosExactosEnDestino(empresaId: number, fechaDestino: string): Promise<Map<string, string>> {
  const rows = await query<RowDataPacket[]>(
    `SELECT p.id AS plan_gemelo_id, p.codigo, p.ruta_id, LEFT(p.hora_carga, 5) AS hora, u.placa AS unidad_placa, tp.id_empleado AS piloto_empleado_id
     FROM tms_planes_viaje p
     INNER JOIN tms_unidades u ON u.id = p.unidad_id AND u.empresa_id = p.empresa_id
     INNER JOIN tms_personal tp ON tp.id = p.piloto_id AND tp.empresa_id = p.empresa_id
     WHERE p.empresa_id = ? AND p.fecha_plan = ? AND p.estado <> 'Cancelado' AND p.tipo_viaje = 'Propio'
       AND p.hora_carga IS NOT NULL AND p.hora_carga <> '' AND p.ruta_id IS NOT NULL AND tp.id_empleado IS NOT NULL
     ORDER BY p.id`,
    [empresaId, fechaDestino],
  );
  const mapa = new Map<string, string>();
  for (const r of rows) {
    const k = claveGemelo(Number(r.ruta_id), String(r.hora), String(r.unidad_placa), Number(r.piloto_empleado_id));
    if (!mapa.has(k)) mapa.set(k, String(r.codigo));
  }
  return mapa;
}

/**
 * Resuelve y valida TODAS las filas (solo lectura). Cada fila sale `ok` o `error` con mensajes claros.
 * `filasInternas` se reutiliza al confirmar para crear sin volver a resolver.
 */
async function resolverYValidar(empresaId: number, fechaDestino: string, borradores: BorradorLote[], identidadEstricta = false): Promise<FilaInterna[]> {
  const rutaIds = [...new Set(borradores.map((b) => b.rutaId).filter((n): n is number => n != null))];
  const clienteIds = [...new Set(borradores.filter((b) => b.rutaId == null).map((b) => b.clienteId).filter((n): n is number => n != null))];
  const empleadoIds = [...new Set(borradores.flatMap((b) => [b.pilotoEmpleadoId, b.pilotoExtraEmpleadoId ?? null, ...b.auxiliarEmpleadoIds]).filter((n): n is number => n != null))];
  const origenIds = borradores.map((b) => b.origenPlanId).filter((n): n is number => n != null);
  const perfilIds = [...new Set(borradores.map((b) => b.vehiculoSolicitadoPerfilId).filter((n): n is number => n != null && n > 0))];

  const [rutasRows, clientesRows, empleadosRows, personalRows, unidadesRows, disp, tarifas, copias, perfilesRows, origenRows, gemelos] = await Promise.all([
    rutaIds.length
      ? query<RowDataPacket[]>(
          `SELECT r.id, r.codigo, r.cliente_id, r.activo, r.lugar_carga_texto, r.destino_descripcion,
                  ct.nombre AS contacto_nombre, ct.cargo AS contacto_cargo, ct.telefono AS contacto_telefono
           FROM tms_cliente_rutas r
           LEFT JOIN tms_cliente_contactos ct ON ct.id = r.contacto_cliente_id
           WHERE r.empresa_id = ? AND r.id IN ${ids(rutaIds)}`,
          [empresaId, ...rutaIds],
        )
      : Promise.resolve([] as RowDataPacket[]),
    clienteIds.length
      ? query<RowDataPacket[]>(`SELECT id FROM tms_clientes WHERE empresa_id = ? AND id IN ${ids(clienteIds)}`, [empresaId, ...clienteIds])
      : Promise.resolve([] as RowDataPacket[]),
    empleadoIds.length
      ? query<RowDataPacket[]>(`SELECT id, nombre, estado, puesto, categoria_ops FROM empleados WHERE empresa_id = ? AND id IN ${ids(empleadoIds)}`, [empresaId, ...empleadoIds])
      : Promise.resolve([] as RowDataPacket[]),
    empleadoIds.length
      ? query<RowDataPacket[]>(`SELECT id, tipo, id_empleado FROM tms_personal WHERE empresa_id = ? AND id_empleado IN ${ids(empleadoIds)} ORDER BY id`, [empresaId, ...empleadoIds])
      : Promise.resolve([] as RowDataPacket[]),
    query<RowDataPacket[]>("SELECT id, placa FROM tms_unidades WHERE empresa_id = ?", [empresaId]),
    listarDisponibilidadVehiculos(empresaId),
    tarifasActivasDeVariasRutas(empresaId, rutaIds),
    copiasVigentesDeOrigen(empresaId, fechaDestino, origenIds),
    // Perfiles de vehículo solicitado de ESTA empresa entre los heredados (un id de otra empresa simplemente no aparece; uno inactivo se copia con aviso).
    perfilIds.length
      ? query<RowDataPacket[]>(`SELECT id, nombre, activo FROM tms_cotizacion_costeo_perfiles WHERE empresa_id = ? AND id IN ${ids(perfilIds)}`, [empresaId, ...perfilIds])
      : Promise.resolve([] as RowDataPacket[]),
    // Fotografía económica del PLAN ORIGEN (siempre del servidor y de ESTA empresa; jamás del cliente): tarifa histórica y costo operativo de referencia.
    origenIds.length
      ? query<RowDataPacket[]>(`SELECT id, tarifa_id, tarifa_nombre_historico, tarifa_monto_historico, tarifa_comercial, tarifa_moneda_historico, costo_operativo_referencia
                                FROM tms_planes_viaje WHERE empresa_id = ? AND id IN ${ids(origenIds)}`, [empresaId, ...origenIds])
      : Promise.resolve([] as RowDataPacket[]),
    gemelosExactosEnDestino(empresaId, fechaDestino),
  ]);

  const perfilesCatalogo = new Map(perfilesRows.map((r) => [Number(r.id), { nombre: String(r.nombre), activo: Number(r.activo ?? 1) === 1 }]));
  const origenes = new Map(origenRows.map((r) => [Number(r.id), r]));
  const rutas = new Map(rutasRows.map((r) => [Number(r.id), r]));
  const clientesOk = new Set(clientesRows.map((r) => Number(r.id)));
  const empleados = new Map(empleadosRows.map((r) => [Number(r.id), r]));
  const personalPorEmpleado = new Map<number, number>();
  for (const p of personalRows) if (!personalPorEmpleado.has(Number(p.id_empleado))) personalPorEmpleado.set(Number(p.id_empleado), Number(p.id));
  const unidadIdPorPlaca = new Map(unidadesRows.map((u) => [norm(String(u.placa)), Number(u.id)]));
  const vehiculos = new Map(disp.vehiculos.map((v) => [norm(v.placa), v]));

  // Personal con viaje en curso HOY (mismo control que el POST manual cuando la fecha es hoy).
  const enCurso = new Map<number, string>();
  if (fechaDestino === hoyLocal()) {
    try {
      for (const p of await listarDisponibilidadPersonal(empresaId, fechaDestino)) if (p.viajeActual != null) enCurso.set(p.personalId, p.nombre);
    } catch { /* si falla la disponibilidad de hoy no se bloquea (igual que el POST manual) */ }
  }

  const internas: FilaInterna[] = [];
  for (const b of borradores) {
    const errores: string[] = [];
    const recursos: RecursoDia[] = [];
    const res: Resuelto = { clienteId: null, rutaId: null, rutaCodigo: null, destino: null, lugarCarga: null, contacto: { nombre: null, cargo: null, telefono: null },
      tarifa: null, unidad: null, tc: null, pilotoNombre: null, auxiliaresNombres: [], vehiculo: null, costoReferencia: null };
    const avisos: AvisoLote[] = [];
    const avisar = (tipo: TipoAvisoLote, recurso: { tipo: string; id: string }, mensaje: string) => avisos.push({ tipo, recurso, mensaje: `${mensaje} Se copia igual que el origen.` });
    const origenPlan = b.origenPlanId != null ? origenes.get(b.origenPlanId) : undefined;
    if (origenPlan?.costo_operativo_referencia != null) res.costoReferencia = Number(origenPlan.costo_operativo_referencia);

    if (b.horaCarga && !HORA_RE.test(b.horaCarga)) errores.push(`Hora inválida: "${b.horaCarga}" (HH:mm).`);

    // --- vehículo solicitado (heredado del origen; nunca inferido). Copia fiel: sin dato o con perfil inexistente se copia SIN él (aviso); inactivo se copia con aviso. ---
    if (b.vehiculoSolicitadoPerfilId == null) {
      avisar("dato_incompleto", { tipo: "dato", id: "vehiculo_solicitado" }, "El viaje origen no tiene vehículo solicitado: la copia queda sin él.");
    } else {
      const perfil = perfilesCatalogo.get(b.vehiculoSolicitadoPerfilId);
      if (!perfil) avisar("dato_incompleto", { tipo: "dato", id: "vehiculo_solicitado" }, "El vehículo solicitado del viaje origen ya no existe en el catálogo de esta empresa: la copia queda sin él.");
      else {
        res.vehiculo = { id: b.vehiculoSolicitadoPerfilId, nombre: perfil.nombre };
        if (!perfil.activo) avisar("recurso_no_disponible", { tipo: "vehiculo_solicitado", id: String(b.vehiculoSolicitadoPerfilId) }, `El vehículo solicitado "${perfil.nombre}" está inactivo en el catálogo.`);
      }
    }

    // --- ruta / cliente / tarifa (la ruta se re-resuelve; la TARIFA se copia fiel: vigente tal cual, histórica con su fotografía, ausente = sin tarifa) ---
    // Una tarifa solo puede venir de (a) el catálogo VIGENTE de la ruta o (b) la fotografía del propio plan origen cuando su `tarifa_id` coincide con la pedida:
    // el cliente no puede inyectar montos. Si no hay tarifa en el origen, la copia nace sin tarifa (no se asigna la predeterminada).
    const tarifaHistorica = (): TarifaResuelta | null => {
      if (b.tarifaId == null || !origenPlan || Number(origenPlan.tarifa_id) !== b.tarifaId) return null;
      const monto = origenPlan.tarifa_monto_historico ?? origenPlan.tarifa_comercial;
      if (monto == null) return null;
      return { id: b.tarifaId, nombre: String(origenPlan.tarifa_nombre_historico ?? ""), monto: Number(monto), moneda: String(origenPlan.tarifa_moneda_historico ?? "") };
    };
    const aplicarTarifaFaltante = () => {
      const h = tarifaHistorica();
      // El origen SÍ tenía esa tarifa pero sin monto guardado: no se puede fotografiar y NO se inventa un monto; la copia nace sin tarifa (aviso), no bloquea.
      if (!h && b.tarifaId != null && origenPlan && Number(origenPlan.tarifa_id) === b.tarifaId) {
        avisar("dato_incompleto", { tipo: "dato", id: "tarifa" }, "El viaje origen tiene una tarifa sin monto registrado: la copia queda sin tarifa.");
        return;
      }
      if (h) { res.tarifa = h; avisar("tarifa_historica", { tipo: "tarifa", id: String(h.id) }, `La tarifa del viaje origen${h.nombre ? ` "${h.nombre}"` : ""} ya no es una tarifa vigente de esta ruta: se conserva tal como estaba.`); }
      else errores.push("La tarifa seleccionada no es una tarifa vigente de esta ruta.");
    };
    if (b.rutaId != null) {
      const ruta = rutas.get(b.rutaId);
      if (!ruta) errores.push("La ruta del viaje no existe en esta empresa.");
      else {
        if (Number(ruta.activo ?? 0) !== 1) avisar("recurso_no_disponible", { tipo: "ruta", id: String(ruta.id) }, `La ruta "${String(ruta.codigo)}" está inactiva.`);
        res.rutaId = Number(ruta.id);
        res.rutaCodigo = String(ruta.codigo);
        res.clienteId = Number(ruta.cliente_id);
        res.destino = ruta.destino_descripcion != null ? String(ruta.destino_descripcion) : null;
        res.lugarCarga = ruta.lugar_carga_texto != null ? String(ruta.lugar_carga_texto) : null;
        res.contacto = {
          nombre: ruta.contacto_nombre != null ? String(ruta.contacto_nombre) : null,
          cargo: ruta.contacto_cargo != null ? String(ruta.contacto_cargo) : null,
          telefono: ruta.contacto_telefono != null ? String(ruta.contacto_telefono) : null,
        };
        if (b.tarifaId != null) {
          const elegida = (tarifas.get(res.rutaId)?.tarifas ?? []).find((t) => t.id === b.tarifaId);
          if (elegida) res.tarifa = { id: elegida.id, nombre: elegida.nombre, monto: elegida.monto, moneda: elegida.moneda };
          else aplicarTarifaFaltante();
        }
      }
    } else {
      if (b.tarifaId != null) aplicarTarifaFaltante();
      if (b.clienteId != null) {
        if (clientesOk.has(b.clienteId)) res.clienteId = b.clienteId;
        else errores.push("El cliente del viaje no existe en esta empresa.");
      }
    }

    if (b.tipoViaje === "Tercerizado") {
      // Tercerizado: solo texto externo; NO se aplican recursos ni disponibilidad de flota/personal interno.
      const x = b.externo;
      if (b.unidadPlaca || b.tcVehiculoId != null || b.pilotoEmpleadoId != null || b.pilotoExtraEmpleadoId != null || b.auxiliarEmpleadoIds.length) {
        errores.push("Un viaje tercerizado no usa recursos internos (unidad, TC, piloto, piloto extra ni auxiliares).");
      }
      if (!x || !x.pilotoExternoNombre.trim()) avisar("dato_incompleto", { tipo: "dato", id: "piloto_externo" }, "El viaje tercerizado del origen no tiene nombre del piloto externo: la copia queda sin él.");
      if (x) {
        if (x.pilotoExternoNombre.length > 160 || x.unidadExternaDescripcion.length > 160 || x.transportistaExterno.length > 160) errores.push("Algún dato externo supera 160 caracteres.");
        if (x.unidadExternaPlaca.length > 40 || x.tcExternoPlaca.length > 40) errores.push("La placa externa (unidad o TC) supera 40 caracteres.");
        if (x.auxiliaresExternos.length > MAX_AUXILIARES) errores.push(`Máximo ${MAX_AUXILIARES} auxiliares externos.`);
        if (x.costoTercerizado != null && !(x.costoTercerizado >= 0)) errores.push("El costo tercerizado no puede ser negativo.");
      }
    } else {
      if (b.externo) errores.push("Un viaje propio no lleva datos de tercerizado.");
      // --- personal ---
      const extraId = b.pilotoExtraEmpleadoId ?? null;
      const todos = [b.pilotoEmpleadoId, extraId, ...b.auxiliarEmpleadoIds].filter((n): n is number => n != null);
      if (b.auxiliarEmpleadoIds.length > MAX_AUXILIARES) errores.push(`Máximo ${MAX_AUXILIARES} auxiliares por viaje.`);
      if (new Set(todos).size !== todos.length) errores.push("El piloto, el piloto extra y los auxiliares no pueden repetirse en el mismo viaje.");
      const rolDe = (id: number) => (id === b.pilotoEmpleadoId ? "piloto" : id === extraId ? "piloto extra" : "auxiliar");
      for (const id of todos) {
        const e = empleados.get(id);
        if (!e) errores.push(`El ${rolDe(id)} seleccionado no existe en esta empresa.`);
        else {
          if (String(e.estado ?? "").toLowerCase() !== "activo") avisar("recurso_no_disponible", { tipo: "persona", id: String(id) }, `${String(e.nombre)} está inactivo.`);
          if (id === extraId && !(String(e.categoria_ops ?? "") === "Piloto" || String(e.puesto ?? "").toLowerCase().includes("piloto") || String(e.categoria_ops ?? "").toLowerCase().includes("piloto"))) {
            avisar("recurso_no_disponible", { tipo: "persona", id: String(id) }, `${String(e.nombre)} no tiene puesto de piloto.`);
          }
          if (id === b.pilotoEmpleadoId) res.pilotoNombre = String(e.nombre);
          else if (id !== extraId) res.auxiliaresNombres.push(String(e.nombre));
          const pid = personalPorEmpleado.get(id);
          // El piloto extra consume disponibilidad EXACTAMENTE igual que el principal (rol piloto, mismo motor por intervalos).
          if (pid != null) recursos.push({ tipo: id === b.pilotoEmpleadoId || id === extraId ? "piloto" : "auxiliar", id: pid });
          const ocupado = pid != null ? enCurso.get(pid) : undefined;
          if (ocupado !== undefined) avisar("recurso_no_disponible", { tipo: "persona", id: String(id) }, id === b.pilotoEmpleadoId || id === extraId ? `El ${rolDe(id)} seleccionado tiene un viaje en curso.` : `El auxiliar ${ocupado} tiene un viaje en curso.`);
        }
      }
      // --- unidad (misma regla que el POST manual: existe, no es TC, disponible) ---
      if (b.unidadPlaca?.trim()) {
        const placa = norm(b.unidadPlaca);
        const v = vehiculos.get(placa);
        if (!v) errores.push(`La unidad con placa "${placa}" no existe en el sistema.`);
        else if (v.tipoUnidad === "TC") errores.push(`La placa ${placa} está clasificada como TC: asígnala en el campo TC, no como Unidad.`);
        else {
          if (!v.puedeEnviar) avisar("recurso_no_disponible", { tipo: "unidad", id: placa }, `La unidad ${placa} no está disponible: ${v.motivoNoDisponible ?? v.estadoDisponibilidad}.`);
          res.unidad = { placa: v.placa, flotaVehiculoId: v.id };
          const uid = unidadIdPorPlaca.get(placa);
          if (uid != null) recursos.push({ tipo: "unidad", id: uid });
        }
      }
      // --- TC interno (misma resolución que Programación manual: acceso, tipo TC, activo, fuera de taller) ---
      if (b.tcVehiculoId != null) {
        let tc = await resolverTcInterno(empresaId, b.tcVehiculoId);
        if (!tc.ok && tc.status === 409) {
          // TC inactivo o en taller (existe y es accesible): se copia igual que el origen, con aviso.
          const v = await obtenerVehiculoAccesible(empresaId, b.tcVehiculoId, "v.id, v.placa");
          if (v) { avisar("recurso_no_disponible", { tipo: "tc", id: String(v.id) }, tc.error); tc = { ok: true, vehiculoId: Number(v.id), placa: String(v.placa ?? "").toUpperCase() }; }
        }
        if (!tc.ok) errores.push(tc.error);
        else if (res.unidad && norm(res.unidad.placa) === norm(tc.placa)) errores.push(`El TC ${tc.placa} no puede ser la misma placa que la unidad del viaje.`);
        else {
          res.tc = { vehiculoId: tc.vehiculoId, placa: tc.placa };
          recursos.push({ tipo: "tc", id: tc.vehiculoId });
        }
      }
    }

    // --- trazabilidad / anti-duplicado (solo copia no cancelada del mismo plan origen y fecha) ---
    if (b.origenPlanId != null && copias?.has(b.origenPlanId)) errores.push(`Este viaje ya fue copiado para esta fecha (${copias.get(b.origenPlanId)}).`);

    // --- anti-duplicado por CONTENIDO: el destino ya tiene un viaje propio no cancelado con la misma ruta, hora, unidad y piloto (creado por Excel, a mano o por otra copia). BLOQUEA: no es un recurso "ocupado", es el mismo viaje. ---
    if (b.tipoViaje === "Propio" && b.rutaId != null && b.horaCarga && b.unidadPlaca?.trim() && b.pilotoEmpleadoId != null) {
      const gemelo = gemelos.get(claveGemelo(b.rutaId, b.horaCarga, b.unidadPlaca, b.pilotoEmpleadoId));
      if (gemelo) errores.push(`Posible duplicado: la fecha destino ya tiene el viaje ${gemelo} con la misma ruta, hora, unidad y piloto. No se copia para no duplicar la programación.`);
    }

    // --- disponibilidad diaria contra viajes ya existentes (solo si no hay errores previos de resolución) ---
    // COPIA FIEL AL ORIGEN: que el recurso ya tenga otro viaje en la fecha destino NO bloquea; se avisa y la fila se crea igual (decisión del propietario).
    // El resto de controles de disponibilidad (unidad/TC fuera de servicio, personal inactivo, viaje en curso…) siguen bloqueando.
    if (!errores.length && recursos.length) {
      const conflicto = await primerConflictoProgramacionIntervalo(empresaId, recursos, ventanaDeBorrador(b, fechaDestino), []);
      if (conflicto) avisos.push({ tipo: "destino_ocupado", recurso: { tipo: conflicto.tipo, id: String(conflicto.id) }, ocupadoPor: { planId: conflicto.planIdConflicto }, mensaje: `${mensajeConflictoProgramacionIntervalo(conflicto)} Se copia igual que el origen.` });
    }
    internas.push({ borrador: b, errores, resuelto: errores.length ? null : res, recursos, ...(avisos.length ? { avisos } : {}) });
  }

  // --- identidad de la unidad TMS (#624), SOLO LECTURA REAL ---
  // Antes el conflicto de identidad solo aparecía al CONFIRMAR (la vista previa decía «OK» y después fallaba el lote entero). Se aplican las MISMAS reglas del resolvedor real, solo para unidades que YA tienen
  // fila en tms_unidades, con su variante de LECTURA (`resolverUnidadTmsSoloLectura`: sin FOR UPDATE y sin INSERT) sobre un lector dedicado que: rechaza todo lo que no sea un SELECT puro, reutiliza los
  // metadatos/listas ya consultados en la operación (una consulta por sentencia distinta, no por unidad) y limita el tiempo de TODA la operación. La vista previa nunca espera bloqueos de otras transacciones.
  // Un conflicto de identidad (ErrorCB2) marca esa fila con error. Un fallo TÉCNICO (bloqueo, tiempo agotado, base caída) NO se oculta: en la vista previa (`identidadEstricta`) sube como ErrorVistaPrevia
  // con un mensaje controlado (sin texto SQL); en la confirmación no es fatal porque la transacción real vuelve a validar la identidad con bloqueo y es la autoridad.
  const porIdentidad = internas.filter((f) => !f.errores.length && f.borrador.tipoViaje === "Propio" && f.resuelto?.unidad && unidadIdPorPlaca.has(norm(f.resuelto.unidad.placa)));
  if (porIdentidad.length) {
    let lector: LectorVistaPrevia | null = null;
    try {
      // El presupuesto del lector nunca excede lo que resta del plazo de la operación que lo contiene (GET/validar).
      lector = await abrirLectorVistaPrevia(getPool(), { empresaId, presupuestoMs: Math.min(PRESUPUESTO_VISTA_PREVIA_MS, plazoRestanteMs()) });
      const vistas = new Map<string, string | null>();   // placa+vehículo → motivo (una sola resolución por unidad)
      for (const f of porIdentidad) {
        const u = f.resuelto!.unidad!; const clave = `${norm(u.placa)}|${u.flotaVehiculoId ?? ""}`;
        if (!vistas.has(clave)) {
          try { await resolverUnidadTmsSoloLectura(lector, empresaId, u.placa, u.flotaVehiculoId); vistas.set(clave, null); }
          catch (e) { if (e instanceof ErrorCB2) vistas.set(clave, e.message); else throw e; }   // el primer fallo técnico detiene la verificación: sin esperas acumuladas por unidad
        }
        const motivo = vistas.get(clave);
        if (motivo) { f.errores.push(`Unidad ${norm(u.placa)}: ${motivo}`); f.resuelto = null; }
      }
    } catch (e) {
      const controlado = e instanceof ErrorPlazoOperacion ? e : errorVistaPrevia(e);   // el plazo vencido de la operación conserva su mensaje
      console.error("resolverYValidar: verificación de identidad de unidades no completada", { codigo: controlado.codigo });   // solo el código; nunca datos de la empresa
      if (identidadEstricta) throw controlado;
    } finally {
      await lector?.liberar().catch(() => undefined);
    }
  }

  // --- colisiones DENTRO del lote (A2.2): la misma persona / unidad / TC en dos filas cuyas VENTANAS se solapan ---
  // Misma política que la comparación contra BD: [hora, regreso) semiabierto; sin hora o sin regreso = todo fecha_plan.
  // La persona se identifica por empleado (piloto vs auxiliar de la misma persona física = conflicto).
  const uso = new Map<string, { fila: number; etiqueta: string }[]>();
  const anotar = (clave: string, fila: number, etiqueta: string) => uso.set(clave, [...(uso.get(clave) ?? []), { fila, etiqueta }]);
  for (const f of internas) {
    const b = f.borrador;
    if (b.tipoViaje !== "Propio") continue;
    for (const id of [b.pilotoEmpleadoId, b.pilotoExtraEmpleadoId ?? null, ...b.auxiliarEmpleadoIds]) if (id != null) anotar(`persona:${id}`, b.fila, `${empleados.get(id)?.nombre ?? `#${id}`}`);
    if (b.unidadPlaca?.trim()) anotar(`unidad:${norm(b.unidadPlaca)}`, b.fila, `unidad ${norm(b.unidadPlaca)}`);
    if (b.tcVehiculoId != null) anotar(`tc:${b.tcVehiculoId}`, b.fila, `TC #${b.tcVehiculoId}`);
  }
  const ventanaPorFila = new Map(internas.map((f) => [f.borrador.fila, ventanaDeBorrador(f.borrador, fechaDestino)]));
  // Una ventana SIN hora o SIN regreso válido reserva TODO el día (política vigente, no se relaja): se identifica qué falta para poder señalar el origen.
  const faltante = (n: number): "hora" | "regreso" | "hora_y_regreso" | null => {
    const v = ventanaPorFila.get(n)!;
    return !v.horaCarga && !v.regresoEstimado ? "hora_y_regreso" : !v.horaCarga ? "hora" : !v.regresoEstimado ? "regreso" : null;
  };
  const textoFalta = (n: number) => { const x = faltante(n); return `fila ${n}: sin ${x === "hora" ? "hora de carga" : x === "regreso" ? "regreso estimado" : "hora de carga ni regreso estimado"}`; };
  const marcadas = new Set<string>(); // "clave|fila": un mensaje por recurso y fila
  for (const [clave, usos] of uso) {
    const filas = [...new Set(usos.map((u) => u.fila))];
    if (filas.length < 2) continue;
    const recurso: ConflictoLote["recurso"] = clave.startsWith("persona:") ? "persona" : clave.startsWith("unidad:") ? "unidad" : "tc";
    for (const f of internas) {
      const fila = f.borrador.fila;
      if (!filas.includes(fila)) continue;
      const otras = filas.filter((n) => n !== fila && ventanasProgramacionSeSolapan(ventanaPorFila.get(fila)!, ventanaPorFila.get(n)!));
      if (!otras.length || marcadas.has(`${clave}|${fila}`)) continue;
      marcadas.add(`${clave}|${fila}`);
      if (!ventanaPorFila.get(fila)!.horaCarga || !ventanaPorFila.get(fila)!.regresoEstimado) {
        f.filasAfectadas ??= new Set<number>();
        for (const otra of otras) f.filasAfectadas.add(otra);
        f.recursosCompartidos ??= new Set<string>();
        f.recursosCompartidos.add(clave.startsWith("persona:") ? "personal" : clave.startsWith("unidad:") ? "unidad" : "remolque");
      }
      const etiqueta = usos[0].etiqueta;
      const que = clave.startsWith("unidad:") ? "la" : clave.startsWith("tc:") ? "el" : "";
      const incompletas = [fila, ...otras].filter((n) => faltante(n) !== null);
      const causa: ConflictoLote["causa"] = incompletas.length ? "dia_completo" : "solape";
      const quien = clave.startsWith("persona:") ? `${etiqueta} está asignado` : `${que === "la" ? "La" : "El"} ${etiqueta} está asignad${que === "la" ? "a" : "o"}`;
      f.conflictos = [...(f.conflictos ?? []), { recurso, filas: otras, causa }];
      if (causa === "dia_completo") {
        // COPIA FIEL: sin hora/regreso válido el recurso «reserva todo el día», pero esos viajes ya conviven así en el origen. Se AVISA y no se bloquea.
        f.avisos = [...(f.avisos ?? []), { tipo: "ventana_incompleta", recurso: { tipo: recurso, id: clave.slice(clave.indexOf(":") + 1) }, filas: otras, mensaje: `${quien} también en la fila ${otras.join(", ")} de este mismo lote. Alguna fila no tiene hora o regreso válido: se reserva todo el día (${incompletas.map(textoFalta).join("; ")}). Se copia igual que el origen.` }];
      } else {
        // Solape con ventanas conocidas: el origen ya lo tenía así (datos históricos). Copia fiel: se AVISA, no se bloquea.
        f.avisos = [...(f.avisos ?? []), { tipo: "solape_lote", recurso: { tipo: recurso, id: clave.slice(clave.indexOf(":") + 1) }, filas: otras, mensaje: `${quien} también en la fila ${otras.join(", ")} de este mismo lote. Los horarios se solapan. Se copia igual que el origen.` }];
      }
    }
  }
  return internas;
}

/**
 * Personal para la copia: lo normal es `personalDesdeEmpleado` (empleado ACTIVO; crea/sincroniza su registro de personal). Si el empleado del origen ya está INACTIVO
 * la copia fiel conserva su asignación usando el registro de personal que YA existe (solo lectura, misma empresa): no se crea ni se modifica personal.
 */
async function personalOCopiaFiel(empresaId: number, empleadoId: number, tipo: "Piloto" | "Auxiliar", conn: PoolConnection): Promise<number | null> {
  const activo = await personalDesdeEmpleado(empresaId, empleadoId, tipo, conn);
  if (activo) return activo;
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT p.id FROM tms_personal p JOIN empleados e ON e.id = p.id_empleado AND e.empresa_id = p.empresa_id
     WHERE p.empresa_id = ? AND p.id_empleado = ? ORDER BY (p.tipo = ?) DESC, p.id LIMIT 1`,
    [empresaId, empleadoId, tipo],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

const aResultado = (f: FilaInterna, fechaDiagnostico: string): ResultadoFilaLote => ({
  fila: f.borrador.fila,
  estado: f.errores.length ? "error" : "ok",
  errores: f.errores,
  tarifa: f.errores.length ? null : f.resuelto?.tarifa ?? null,
  diagnostico: { horaInvalida: !ventanaDeBorrador(f.borrador, fechaDiagnostico).horaCarga, regresoInvalido: !ventanaDeBorrador(f.borrador, fechaDiagnostico).regresoEstimado, filasAfectadas: [...(f.filasAfectadas ?? [])].sort((a, b) => a - b), recursosCompartidos: [...(f.recursosCompartidos ?? [])] },
  ...(f.conflictos ? { conflictos: f.conflictos } : {}),
  ...(f.avisos?.length ? { avisos: f.avisos } : {}),
});

/**
 * SOLO LECTURA: valida el lote para la fecha destino (preview / revalidación tras editar).
 * La vista previa es ORIENTATIVA: describe el estado en el momento de consultar y puede quedar desactualizada si otro usuario cambia unidades, personal o viajes después (disponibilidad, identidad de la
 * unidad TMS). La AUTORIDAD FINAL es `confirmarLote`: revalida todo bajo el candado por empresa y dentro de su transacción (todo o nada); si algo cambió, rechaza con la fila y el motivo reales.
 */
export async function validarLote(empresaId: number, fechaDestino: string, borradores: BorradorLote[]): Promise<ResultadoFilaLote[]> {
  if (!FECHA_RE.test(fechaDestino)) throw new Error("Fecha destino inválida.");
  return (await resolverYValidar(empresaId, fechaDestino, borradores, true)).map((f) => aResultado(f, fechaDestino));
}

export type ResultadoConfirmarLote =
  | { ok: true; planIds: number[]; codigos: string[] }
  | { ok: false; status: 400 | 403 | 409 | 500 | 503; error: string; erroresPorFila?: { fila: number; errores: string[] }[]; /** Los avisos vigentes no coinciden con los aceptados (o no se aceptaron): la pantalla debe revalidar. */ requiereRevalidar?: boolean };

export type OrigenLote = { tipo: "COPIA"; fechaOrigen: string };

/**
 * Crea el lote COMPLETO o nada. Bajo el candado por empresa revalida todo (nunca confía en una vista
 * previa anterior); si una fila falla => nada se crea y se devuelven errores por fila. Un error inesperado
 * dentro de la transacción => rollback total (planes, auxiliares, paradas, viáticos, origen y auditoría).
 */
export async function confirmarLote(
  empresaId: number,
  usuario: string,
  fechaDestino: string,
  origen: OrigenLote,
  borradores: BorradorLote[],
  tarifasEsperadas?: { fila: number; tarifa: { id: number; monto: number; moneda: string } | null }[],
  /** Huella de los avisos que el usuario aceptó (ver programacion-copia-avisos.ts). Obligatoria y vigente si la copia tiene CUALQUIER aviso. */
  avisosAceptados?: string,
): Promise<ResultadoConfirmarLote> {
  if (!FECHA_RE.test(fechaDestino)) return { ok: false, status: 400, error: "Fecha destino inválida." };
  if (!borradores.length) return { ok: false, status: 400, error: "No hay filas para crear." };
  if (borradores.length > MAX_FILAS_LOTE) return { ok: false, status: 400, error: `Máximo ${MAX_FILAS_LOTE} filas por lote.` };

  // La trazabilidad es obligatoria: sin la tabla no se crea nada (no habría anti-duplicado).
  try {
    await query("SELECT 1 FROM tms_plan_origen LIMIT 1");
  } catch (e) {
    if (sinTabla(e)) return { ok: false, status: 409, error: MSG_MIGRACION_ORIGEN };
    throw e;
  }

  const lockKey = `tms_traslape_${empresaId}`;
  const lockConn = await getPool().getConnection();
  let lockAdquirido = false;
  try {
    let lockRows: RowDataPacket[] = [];
    try {
      [lockRows] = await lockConn.query<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS l", [lockKey, LOCK_TIMEOUT_SEGUNDOS]);
    } catch {
      lockRows = [];
    }
    lockAdquirido = Number(lockRows[0]?.l) === 1;
    if (!lockAdquirido) {
      return { ok: false, status: 409, error: "No se pudo validar la disponibilidad de recursos porque hay otra operación en curso. Intenta de nuevo." };
    }

    // Revalidación COMPLETA bajo el candado (también detecta una copia hecha entre la vista previa y ahora).
    const filas = await resolverYValidar(empresaId, fechaDestino, borradores);
    if (tarifasEsperadas) {
      const expectativas = new Map(tarifasEsperadas.map((t) => [t.fila, t.tarifa]));
      for (const f of filas) {
        const anterior = expectativas.get(f.borrador.fila);
        const vigente = f.resuelto?.tarifa ?? null;
        if (!expectativas.has(f.borrador.fila) || (anterior === null) !== (vigente === null) || (anterior && vigente && (anterior.id !== vigente.id || anterior.monto !== vigente.monto || anterior.moneda !== vigente.moneda))) {
          f.errores.push("La tarifa vigente cambió desde la vista previa. Vuelve a validar antes de confirmar.");
        }
      }
    }
    const malas = filas.filter((f) => f.errores.length);
    if (malas.length) {
      return {
        ok: false, status: 409,
        error: `${malas.length} de ${filas.length} fila(s) no pasaron la validación. No se creó ningún viaje (todo o nada).`,
        erroresPorFila: malas.map((f) => ({ fila: f.borrador.fila, errores: f.errores })),
      };
    }
    // COPIA FIEL: los avisos no bloquean, pero la ACEPTACIÓN es obligatoria y se verifica AQUÍ, bajo el candado, contra los avisos VIGENTES (no contra lo que el
    // cliente vio): ausente o desactualizada ⇒ se rechaza sin escribir nada. Así una llamada directa a la API no puede omitirla.
    const huellaVigente = huellaAvisosCopia({ empresaId, fechaOrigen: origen.fechaOrigen, fechaDestino }, filas.map((f) => ({ fila: f.borrador.fila, avisos: f.avisos })));
    if (huellaVigente !== "" && avisosAceptados !== huellaVigente) {
      return { ok: false, status: 409, error: MSG_AVISOS_SIN_ACEPTAR, requiereRevalidar: true };
    }

    const conn = await getPool().getConnection();
    const planIds: number[] = [];
    const codigos: string[] = [];
    let unidadActual: string | null = null;   // placa de la unidad que se estaba resolviendo
    let filaActual: number | null = null;   // fila en proceso: permite decir QUÉ fila rechazó el resolvedor de identidad
    try {
      await conn.beginTransaction();
      for (const f of filas) {
        const b = f.borrador;
        filaActual = b.fila;
        unidadActual = null;   // cada fila empieza sin unidad: un ErrorCB2 posterior jamás hereda la placa de la fila anterior
        const r = f.resuelto as Resuelto;
        const esTerc = b.tipoViaje === "Tercerizado";
        const x = b.externo;

        let unidadId: number | null = null;
        let pilotoId: number | null = null;
        let pilotoExtraId: number | null = null;
        const auxIds: number[] = [];
        if (!esTerc) {
          if (r.unidad) {
            unidadActual = r.unidad.placa;
            unidadId = await resolverUnidadTmsTx(conn,empresaId,r.unidad.placa,r.unidad.flotaVehiculoId);
          }
          if (b.pilotoEmpleadoId != null) {
            pilotoId = await personalOCopiaFiel(empresaId, b.pilotoEmpleadoId, "Piloto", conn);
            if (!pilotoId) throw new Error(`Fila ${b.fila}: no se pudo resolver el piloto.`);
          }
          if (b.pilotoExtraEmpleadoId != null) {
            pilotoExtraId = await personalOCopiaFiel(empresaId, b.pilotoExtraEmpleadoId, "Piloto", conn);
            if (!pilotoExtraId) throw new Error(`Fila ${b.fila}: no se pudo resolver el piloto extra.`);
          }
          for (const eid of b.auxiliarEmpleadoIds) {
            const pid = await personalOCopiaFiel(empresaId, eid, "Auxiliar", conn);
            if (!pid) throw new Error(`Fila ${b.fila}: no se pudo resolver un auxiliar.`);
            auxIds.push(pid);
          }
        }

        // Paradas: las del plan origen (planificación); si no tiene, las derivadas de la ruta viva.
        const paradas: ParadaInput[] = b.paradas.length ? b.paradas : [
          ...(r.lugarCarga?.trim() ? [{ lugarNombre: r.lugarCarga.trim(), tipo: "Carga", requiereEvidencia: true }] : []),
          ...(r.destino?.trim() ? [{ lugarNombre: r.destino.trim(), tipo: "Descarga", requiereEvidencia: true }] : []),
        ];
        const lugarCargaId = await upsertLugar(empresaId, paradas.find((p) => p.tipo === "Carga")?.lugarNombre, "Carga", conn);
        const lugarDescargaId = await upsertLugar(empresaId, paradas.find((p) => p.tipo === "Descarga" || p.tipo === "Entrega")?.lugarNombre, "Descarga", conn);

        // PROGRAMACION-COPIA-LOTE-TX-1 — transaction-aware: consulta con la MISMA conexión `conn`, así ve los
        // códigos que esta misma transacción ya insertó (sin commit todavía) en filas anteriores del lote. Antes
        // usaba la variante del pool (conexión distinta): dos filas del mismo lote podían proponerse el mismo
        // código porque ninguna veía el INSERT sin confirmar de la otra — "uno por uno" funcionaba porque cada
        // copia individual era su PROPIA transacción, sin nadie más compitiendo dentro de ella.
        const codigoInicial = await asegurarCodigoPlanUnicoTx(conn, empresaId, fechaDestino, null);
        // URGENTE — SOLO una colisión real del UNIQUE (empresa_id, codigo) reintenta con otro código (helper compartido
        // con el alta individual). Cualquier otro error del INSERT (columna inexistente, FK, trigger, timeout…) se
        // propaga: el catch exterior hace el rollback total real. Antes el usuario solo veía un mensaje genérico; ahora
        // el error indica la fila y el código SQL, y el detalle completo queda en la bitácora del servidor.
        let planId = 0;
        let codigo = codigoInicial;
        try {
          const alta = await insertarPlanConCodigoUnico({
            empresaId,
            codigoInicial,
            siguienteCodigo: () => asegurarCodigoPlanUnicoTx(conn, empresaId, fechaDestino, null),
            intentarInsertar: async (codigoIntento) => {
                const [ins] = await conn.execute<ResultSetHeader>(
                  `INSERT INTO tms_planes_viaje
                    (empresa_id, codigo, cliente_id, lugar_carga_id, lugar_descarga_id, unidad_id, piloto_id, auxiliar_id, fecha_plan, hora_carga, tipo_traslado, regreso_estimado, tarifa_comercial, tarifa_id, tarifa_nombre_historico, tarifa_monto_historico, tarifa_moneda_historico, costo_operativo_referencia, referencia_cliente, ruta_id, ruta_codigo_historico, lugar_descarga_historico, contacto_nombre_historico, contacto_cargo_historico, contacto_telefono_historico, notas, estado, tipo_viaje, piloto_externo_nombre, auxiliares_externos, unidad_externa_placa, unidad_externa_descripcion, transportista_externo, costo_tercerizado, tc_vehiculo_id, tc_placa_historica, tc_externo_placa, vehiculo_solicitado_perfil_id, vehiculo_solicitado_nombre)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 'Programado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    empresaId, codigoIntento, r.clienteId, lugarCargaId, lugarDescargaId, unidadId, pilotoId, auxIds[0] ?? null, fechaDestino,
                    b.horaCarga, b.tipoTraslado, regresoPersistidoDeBorrador(b, fechaDestino)?.replace("T", " ") ?? null,
                    r.tarifa?.monto ?? null, r.tarifa?.id ?? null, r.tarifa?.nombre || null, r.tarifa?.monto ?? null, r.tarifa?.moneda || null, r.costoReferencia,
                    r.rutaId, r.rutaCodigo, r.destino, r.contacto.nombre, r.contacto.cargo, r.contacto.telefono,
                    b.tipoViaje,
                    esTerc ? (x?.pilotoExternoNombre.trim() || null) : null,
                    esTerc ? (x?.auxiliaresExternos.map((n) => n.trim()).filter(Boolean).slice(0, MAX_AUXILIARES).join("\n") || null) : null,
                    esTerc ? (norm(x?.unidadExternaPlaca ?? "") || null) : null,
                    esTerc ? (x?.unidadExternaDescripcion.trim() || null) : null,
                    esTerc ? (x?.transportistaExterno.trim() || null) : null,
                    esTerc ? (x?.costoTercerizado ?? null) : null,
                    r.tc?.vehiculoId ?? null, r.tc?.placa ?? null,
                    esTerc ? (norm(x?.tcExternoPlaca ?? "") || null) : null,
                    r.vehiculo?.id ?? null, r.vehiculo?.nombre ?? null, // heredado del origen; null si el origen no lo tenía (aviso `dato_incompleto`)
                  ],
                );
              return Number(ins.insertId);
            },
          });
          planId = alta.planId;
          codigo = alta.codigo;
        } catch (errInsert) {
          if (errInsert instanceof CodigoPlanAgotadoError) throw new Error(`Fila ${b.fila}: no se pudo generar un código de plan único.`);
          console.error(`confirmarLote: INSERT tms_planes_viaje falló en la fila ${b.fila}`, resumenErrorSql(errInsert));
          throw new Error(`Fila ${b.fila}: no se pudo guardar el viaje (error de base de datos${detalleErrorSqlUsuario(errInsert) ? ` ${detalleErrorSqlUsuario(errInsert)}` : ""}).`, { cause: errInsert });
        }

        await guardarAuxiliaresPlan(planId, auxIds, conn);
        // Piloto extra copiado (revalidado arriba con las mismas reglas de disponibilidad): misma transacción del lote.
        if (pilotoExtraId != null) await guardarPilotoExtraPlan(empresaId, planId, pilotoExtraId, conn);
        if (paradas.length) {
          const rp = await guardarParadasPlan(empresaId, planId, paradas, conn);
          if (!rp.ok) throw new Error(`Fila ${b.fila}: ${rp.error}`);
        }
        // Viáticos: SIEMPRE por la configuración vigente (nunca se copian montos ni ajustes del origen).
        await sincronizarViaticosPlan(empresaId, planId, { piloto: pilotoId, pilotoExtra: pilotoExtraId, auxiliares: auxIds }, conn);
        await conn.execute(
          `INSERT INTO tms_plan_origen (empresa_id, plan_id, tipo, plan_origen_id, fecha_destino, creado_por)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [empresaId, planId, origen.tipo, b.origenPlanId, fechaDestino, usuario],
        );
        planIds.push(planId);
        codigos.push(codigo);
      }
      await registrarAuditoriaTx(conn, {
        empresaId, usuario, accion: "copiar_programacion", modulo: "tms",
        detalle: `Copió programación ${fmt(origen.fechaOrigen)} → ${fmt(fechaDestino)}. ${planIds.length} plan(es) creados: ${codigos.join(", ")}.`.slice(0, 2000),
      });
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      console.error("confirmarLote (rollback total)", e);
      // #624: el resolvedor de unidad TMS RECHAZA a propósito identidades en conflicto (p. ej. una unidad histórica sin vínculo a Flota con la misma placa) con un ErrorCB2 y su estado HTTP.
      // Antes se perdía en el mensaje genérico («No se pudo crear el lote»). Se informa fila, motivo y estado reales; la transacción ya se revirtió y NO se relaja ninguna validación.
      if (e instanceof ErrorCB2 && [400, 403, 409, 503].includes(e.status)) return { ok: false, status: e.status as 400 | 403 | 409 | 503, error: `${filaActual != null ? `Fila ${filaActual}${unidadActual ? ` (unidad ${unidadActual})` : ""}: ` : ""}${e.message} No se creó ningún viaje.` };
      return { ok: false, status: 500, error: e instanceof Error && /^Fila \d+:/.test(e.message) ? `${e.message} No se creó ningún viaje.` : "No se pudo crear el lote. No se guardó ningún cambio." };
    } finally {
      conn.release();
    }
    return { ok: true, planIds, codigos };
  } finally {
    if (lockAdquirido) {
      try { await lockConn.query("SELECT RELEASE_LOCK(?) AS l", [lockKey]); } catch { /* ok */ }
    }
    lockConn.release();
  }
}
