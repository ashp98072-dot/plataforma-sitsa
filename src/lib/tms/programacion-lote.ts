import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { hoyLocal } from "@/lib/rrhh/dates";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { asegurarCodigoPlanUnico } from "@/lib/tms/codigo-plan";
import { personalDesdeEmpleado } from "@/lib/tms/personal-resolucion";
import { guardarAuxiliaresPlan, upsertLugar } from "@/lib/tms/plan-comunes";
import { guardarParadasPlan, type ParadaInput } from "@/lib/tms/paradas";
import { tarifasActivasDeVariasRutas } from "@/lib/tms/ruta-tarifas";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { resolverTcInterno } from "@/lib/tms/tc-plan";
import { mensajeConflictoProgramacionDia, primerConflictoProgramacionDia, type RecursoDia } from "@/lib/tms/disponibilidad-programacion-dia";

/**
 * TMS-PROGRAMACION-LOTE-1 (PR A) — MOTOR REUTILIZABLE de creación de planes por lote.
 *
 * Recibe BORRADORES normalizados (`BorradorLote`, ya con ids; nunca texto libre del Excel) y:
 *   1. resuelve/revalida cada fila contra datos REALES de la empresa (ruta, cliente, personal, unidad, TC, tarifa);
 *   2. comprueba disponibilidad diaria contra viajes existentes (primerConflictoProgramacionDia, la MISMA
 *      política de Programación manual: piloto, auxiliar, unidad, TC) y colisiones DENTRO del lote;
 *   3. (confirmar) toma el candado por empresa `tms_traslape_<empresa>` — el mismo del POST manual y la
 *      importación Excel —, REVALIDA todo bajo el candado y, solo si el 100% pasa, abre UNA transacción y
 *      crea todos los planes (auxiliares, paradas, viáticos por configuración vigente, trazabilidad de origen
 *      y auditoría). Cualquier fallo => ROLLBACK completo (todo o nada) y errores por fila.
 *
 * Reutiliza las MISMAS piezas que el POST manual y el importador (personalDesdeEmpleado, upsertLugar,
 * guardarAuxiliaresPlan, guardarParadasPlan, sincronizarViaticosPlan, asegurarCodigoPlanUnico,
 * resolverTcInterno). No refactoriza el POST manual ni el importador (decisión de alcance del PR A).
 *
 * Nunca se copia historia operativa: los planes nuevos nacen 'Programado', con snapshots NUEVOS de ruta y
 * tarifa; la tarifa solo puede ser una tarifa VIGENTE del catálogo de la ruta (sin monto libre).
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
  tipoTraslado: string | null;
  tipoViaje: "Propio" | "Tercerizado";
  unidadPlaca: string | null;
  tcVehiculoId: number | null;
  pilotoEmpleadoId: number | null;
  auxiliarEmpleadoIds: number[];
  tarifaId: number | null;
  externo: ExternoLote | null;
  /** Las pone el SERVIDOR (desde el plan origen); nunca se aceptan del cliente. */
  paradas: ParadaInput[];
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
};

export type ResultadoFilaLote = {
  fila: number;
  estado: "ok" | "error";
  errores: string[];
  /** Solo si estado = ok: lo que se creará (tarifa efectiva incluida). */
  tarifa: TarifaResuelta | null;
};

type FilaInterna = { borrador: BorradorLote; errores: string[]; resuelto: Resuelto | null; recursos: RecursoDia[] };

const fmt = (iso: string) => iso.split("-").reverse().join("/");
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

/**
 * Resuelve y valida TODAS las filas (solo lectura). Cada fila sale `ok` o `error` con mensajes claros.
 * `filasInternas` se reutiliza al confirmar para crear sin volver a resolver.
 */
async function resolverYValidar(empresaId: number, fechaDestino: string, borradores: BorradorLote[]): Promise<FilaInterna[]> {
  const rutaIds = [...new Set(borradores.map((b) => b.rutaId).filter((n): n is number => n != null))];
  const clienteIds = [...new Set(borradores.filter((b) => b.rutaId == null).map((b) => b.clienteId).filter((n): n is number => n != null))];
  const empleadoIds = [...new Set(borradores.flatMap((b) => [b.pilotoEmpleadoId, ...b.auxiliarEmpleadoIds]).filter((n): n is number => n != null))];
  const origenIds = borradores.map((b) => b.origenPlanId).filter((n): n is number => n != null);

  const [rutasRows, clientesRows, empleadosRows, personalRows, unidadesRows, disp, tarifas, copias] = await Promise.all([
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
      ? query<RowDataPacket[]>(`SELECT id, nombre, estado FROM empleados WHERE empresa_id = ? AND id IN ${ids(empleadoIds)}`, [empresaId, ...empleadoIds])
      : Promise.resolve([] as RowDataPacket[]),
    empleadoIds.length
      ? query<RowDataPacket[]>(`SELECT id, tipo, id_empleado FROM tms_personal WHERE empresa_id = ? AND id_empleado IN ${ids(empleadoIds)} ORDER BY id`, [empresaId, ...empleadoIds])
      : Promise.resolve([] as RowDataPacket[]),
    query<RowDataPacket[]>("SELECT id, placa FROM tms_unidades WHERE empresa_id = ?", [empresaId]),
    listarDisponibilidadVehiculos(empresaId),
    tarifasActivasDeVariasRutas(empresaId, rutaIds),
    copiasVigentesDeOrigen(empresaId, fechaDestino, origenIds),
  ]);

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
      tarifa: null, unidad: null, tc: null, pilotoNombre: null, auxiliaresNombres: [] };

    if (b.horaCarga && !HORA_RE.test(b.horaCarga)) errores.push(`Hora inválida: "${b.horaCarga}" (HH:mm).`);

    // --- ruta / cliente / tarifa (siempre re-resueltos: nunca se copia el snapshot del viaje origen) ---
    if (b.rutaId != null) {
      const ruta = rutas.get(b.rutaId);
      if (!ruta) errores.push("La ruta del viaje no existe en esta empresa.");
      else if (Number(ruta.activo ?? 0) !== 1) errores.push(`La ruta "${String(ruta.codigo)}" está inactiva.`);
      else {
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
        const opciones = tarifas.get(res.rutaId)?.tarifas ?? [];
        if (!opciones.length) {
          errores.push(`La ruta "${res.rutaCodigo}" no tiene una tarifa vigente.`);
        } else {
          const elegida = b.tarifaId != null
            ? opciones.find((t) => t.id === b.tarifaId)
            : opciones.find((t) => t.predeterminada) ?? opciones[0];
          if (!elegida) errores.push("La tarifa seleccionada no es una tarifa vigente de esta ruta.");
          else res.tarifa = { id: elegida.id, nombre: elegida.nombre, monto: elegida.monto, moneda: elegida.moneda };
        }
      }
    } else {
      if (b.tarifaId != null) errores.push("Un viaje sin ruta no tiene tarifa de catálogo.");
      if (b.clienteId != null) {
        if (clientesOk.has(b.clienteId)) res.clienteId = b.clienteId;
        else errores.push("El cliente del viaje no existe en esta empresa.");
      }
    }

    if (b.tipoViaje === "Tercerizado") {
      // Tercerizado: solo texto externo; NO se aplican recursos ni disponibilidad de flota/personal interno.
      const x = b.externo;
      if (b.unidadPlaca || b.tcVehiculoId != null || b.pilotoEmpleadoId != null || b.auxiliarEmpleadoIds.length) {
        errores.push("Un viaje tercerizado no usa recursos internos (unidad, TC, piloto ni auxiliares).");
      }
      if (!x || !x.pilotoExternoNombre.trim()) errores.push("Un viaje tercerizado requiere el nombre del piloto externo.");
      if (x) {
        if (x.pilotoExternoNombre.length > 160 || x.unidadExternaDescripcion.length > 160 || x.transportistaExterno.length > 160) errores.push("Algún dato externo supera 160 caracteres.");
        if (x.unidadExternaPlaca.length > 40 || x.tcExternoPlaca.length > 40) errores.push("La placa externa (unidad o TC) supera 40 caracteres.");
        if (x.auxiliaresExternos.length > MAX_AUXILIARES) errores.push(`Máximo ${MAX_AUXILIARES} auxiliares externos.`);
        if (x.costoTercerizado != null && !(x.costoTercerizado >= 0)) errores.push("El costo tercerizado no puede ser negativo.");
      }
    } else {
      if (b.externo) errores.push("Un viaje propio no lleva datos de tercerizado.");
      // --- personal ---
      const todos = [b.pilotoEmpleadoId, ...b.auxiliarEmpleadoIds].filter((n): n is number => n != null);
      if (b.auxiliarEmpleadoIds.length > MAX_AUXILIARES) errores.push(`Máximo ${MAX_AUXILIARES} auxiliares por viaje.`);
      if (new Set(todos).size !== todos.length) errores.push("El piloto y los auxiliares no pueden repetirse en el mismo viaje.");
      const rolDe = (id: number) => (id === b.pilotoEmpleadoId ? "piloto" : "auxiliar");
      for (const id of todos) {
        const e = empleados.get(id);
        if (!e) errores.push(`El ${rolDe(id)} seleccionado no existe en esta empresa.`);
        else if (String(e.estado ?? "").toLowerCase() !== "activo") errores.push(`${String(e.nombre)} está inactivo y no puede asignarse.`);
        else {
          if (id === b.pilotoEmpleadoId) res.pilotoNombre = String(e.nombre);
          else res.auxiliaresNombres.push(String(e.nombre));
          const pid = personalPorEmpleado.get(id);
          if (pid != null) recursos.push({ tipo: id === b.pilotoEmpleadoId ? "piloto" : "auxiliar", id: pid });
          const ocupado = pid != null ? enCurso.get(pid) : undefined;
          if (ocupado !== undefined) errores.push(id === b.pilotoEmpleadoId ? "El piloto seleccionado tiene un viaje en curso." : `El auxiliar ${ocupado} tiene un viaje en curso.`);
        }
      }
      // --- unidad (misma regla que el POST manual: existe, no es TC, disponible) ---
      if (b.unidadPlaca?.trim()) {
        const placa = norm(b.unidadPlaca);
        const v = vehiculos.get(placa);
        if (!v) errores.push(`La unidad con placa "${placa}" no existe en el sistema.`);
        else if (v.tipoUnidad === "TC") errores.push(`La placa ${placa} está clasificada como TC: asígnala en el campo TC, no como Unidad.`);
        else if (!v.puedeEnviar) errores.push(`La unidad ${placa} no está disponible: ${v.motivoNoDisponible ?? v.estadoDisponibilidad}.`);
        else {
          res.unidad = { placa: v.placa, flotaVehiculoId: v.id };
          const uid = unidadIdPorPlaca.get(placa);
          if (uid != null) recursos.push({ tipo: "unidad", id: uid });
        }
      }
      // --- TC interno (misma resolución que Programación manual: acceso, tipo TC, activo, fuera de taller) ---
      if (b.tcVehiculoId != null) {
        const tc = await resolverTcInterno(empresaId, b.tcVehiculoId);
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

    // --- disponibilidad diaria contra viajes ya existentes (solo si no hay errores previos de resolución) ---
    if (!errores.length && recursos.length) {
      const conflicto = await primerConflictoProgramacionDia(empresaId, recursos, fechaDestino, null);
      if (conflicto) errores.push(mensajeConflictoProgramacionDia(conflicto));
    }
    internas.push({ borrador: b, errores, resuelto: errores.length ? null : res, recursos });
  }

  // --- colisiones DENTRO del lote: la misma persona / unidad / TC en dos filas ---
  const uso = new Map<string, { fila: number; etiqueta: string }[]>();
  const anotar = (clave: string, fila: number, etiqueta: string) => uso.set(clave, [...(uso.get(clave) ?? []), { fila, etiqueta }]);
  for (const f of internas) {
    const b = f.borrador;
    if (b.tipoViaje !== "Propio") continue;
    for (const id of [b.pilotoEmpleadoId, ...b.auxiliarEmpleadoIds]) if (id != null) anotar(`persona:${id}`, b.fila, `${empleados.get(id)?.nombre ?? `#${id}`}`);
    if (b.unidadPlaca?.trim()) anotar(`unidad:${norm(b.unidadPlaca)}`, b.fila, `unidad ${norm(b.unidadPlaca)}`);
    if (b.tcVehiculoId != null) anotar(`tc:${b.tcVehiculoId}`, b.fila, `TC #${b.tcVehiculoId}`);
  }
  for (const [clave, usos] of uso) {
    const filas = [...new Set(usos.map((u) => u.fila))];
    if (filas.length < 2) continue;
    for (const f of internas) {
      if (!filas.includes(f.borrador.fila)) continue;
      const otras = filas.filter((n) => n !== f.borrador.fila);
      const etiqueta = usos[0].etiqueta;
      const que = clave.startsWith("unidad:") ? "la" : clave.startsWith("tc:") ? "el" : "";
      f.errores.push(`${clave.startsWith("persona:") ? `${etiqueta} está asignado` : `${que === "la" ? "La" : "El"} ${etiqueta} está asignad${que === "la" ? "a" : "o"}`} también en la fila ${otras.join(", ")} de este mismo lote.`);
      f.resuelto = null;
    }
  }
  return internas;
}

const aResultado = (f: FilaInterna): ResultadoFilaLote => ({
  fila: f.borrador.fila,
  estado: f.errores.length ? "error" : "ok",
  errores: f.errores,
  tarifa: f.errores.length ? null : f.resuelto?.tarifa ?? null,
});

/** SOLO LECTURA: valida el lote para la fecha destino (preview / revalidación tras editar). */
export async function validarLote(empresaId: number, fechaDestino: string, borradores: BorradorLote[]): Promise<ResultadoFilaLote[]> {
  if (!FECHA_RE.test(fechaDestino)) throw new Error("Fecha destino inválida.");
  return (await resolverYValidar(empresaId, fechaDestino, borradores)).map(aResultado);
}

export type ResultadoConfirmarLote =
  | { ok: true; planIds: number[]; codigos: string[] }
  | { ok: false; status: 400 | 409 | 500; error: string; erroresPorFila?: { fila: number; errores: string[] }[] };

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
    const malas = filas.filter((f) => f.errores.length);
    if (malas.length) {
      return {
        ok: false, status: 409,
        error: `${malas.length} de ${filas.length} fila(s) no pasaron la validación. No se creó ningún viaje (todo o nada).`,
        erroresPorFila: malas.map((f) => ({ fila: f.borrador.fila, errores: f.errores })),
      };
    }

    const conn = await getPool().getConnection();
    const planIds: number[] = [];
    const codigos: string[] = [];
    try {
      await conn.beginTransaction();
      for (const f of filas) {
        const b = f.borrador;
        const r = f.resuelto as Resuelto;
        const esTerc = b.tipoViaje === "Tercerizado";
        const x = b.externo;

        let unidadId: number | null = null;
        let pilotoId: number | null = null;
        const auxIds: number[] = [];
        if (!esTerc) {
          if (r.unidad) {
            const [ru] = await conn.execute<ResultSetHeader>(
              `INSERT INTO tms_unidades (empresa_id, placa, tipo, flota_vehiculo_id)
               VALUES (?, ?, 'Camion', ?)
               ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), flota_vehiculo_id = COALESCE(flota_vehiculo_id, VALUES(flota_vehiculo_id))`,
              [empresaId, r.unidad.placa, r.unidad.flotaVehiculoId],
            );
            unidadId = Number(ru.insertId);
          }
          if (b.pilotoEmpleadoId != null) {
            pilotoId = await personalDesdeEmpleado(empresaId, b.pilotoEmpleadoId, "Piloto", conn);
            if (!pilotoId) throw new Error(`Fila ${b.fila}: no se pudo resolver el piloto.`);
          }
          for (const eid of b.auxiliarEmpleadoIds) {
            const pid = await personalDesdeEmpleado(empresaId, eid, "Auxiliar", conn);
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

        let codigo = await asegurarCodigoPlanUnico(empresaId, fechaDestino, null);
        let planId = 0;
        for (let intento = 0; intento < 5 && !planId; intento++) {
          try {
            const [ins] = await conn.execute<ResultSetHeader>(
              `INSERT INTO tms_planes_viaje
                (empresa_id, codigo, cliente_id, lugar_carga_id, lugar_descarga_id, unidad_id, piloto_id, auxiliar_id, fecha_plan, hora_carga, tipo_traslado, regreso_estimado, tarifa_comercial, tarifa_id, tarifa_nombre_historico, tarifa_monto_historico, tarifa_moneda_historico, costo_operativo_referencia, referencia_cliente, ruta_id, ruta_codigo_historico, lugar_descarga_historico, contacto_nombre_historico, contacto_cargo_historico, contacto_telefono_historico, notas, estado, tipo_viaje, piloto_externo_nombre, auxiliares_externos, unidad_externa_placa, unidad_externa_descripcion, transportista_externo, costo_tercerizado, tc_vehiculo_id, tc_placa_historica, tc_externo_placa)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, 'Programado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                empresaId, codigo, r.clienteId, lugarCargaId, lugarDescargaId, unidadId, pilotoId, auxIds[0] ?? null, fechaDestino,
                b.horaCarga, b.tipoTraslado,
                r.tarifa?.monto ?? null, r.tarifa?.id ?? null, r.tarifa?.nombre ?? null, r.tarifa?.monto ?? null, r.tarifa?.moneda ?? null,
                r.rutaId, r.rutaCodigo, r.destino, r.contacto.nombre, r.contacto.cargo, r.contacto.telefono,
                b.tipoViaje,
                esTerc ? x!.pilotoExternoNombre.trim() : null,
                esTerc ? (x!.auxiliaresExternos.map((n) => n.trim()).filter(Boolean).slice(0, MAX_AUXILIARES).join("\n") || null) : null,
                esTerc ? (norm(x!.unidadExternaPlaca) || null) : null,
                esTerc ? (x!.unidadExternaDescripcion.trim() || null) : null,
                esTerc ? (x!.transportistaExterno.trim() || null) : null,
                esTerc ? x!.costoTercerizado : null,
                r.tc?.vehiculoId ?? null, r.tc?.placa ?? null,
                esTerc ? (norm(x!.tcExternoPlaca) || null) : null,
              ],
            );
            planId = Number(ins.insertId);
          } catch {
            codigo = await asegurarCodigoPlanUnico(empresaId, fechaDestino, null);
          }
        }
        if (!planId) throw new Error(`Fila ${b.fila}: no se pudo generar un código de plan único.`);

        await guardarAuxiliaresPlan(planId, auxIds, conn);
        if (paradas.length) {
          const rp = await guardarParadasPlan(empresaId, planId, paradas, conn);
          if (!rp.ok) throw new Error(`Fila ${b.fila}: ${rp.error}`);
        }
        // Viáticos: SIEMPRE por la configuración vigente (nunca se copian montos ni ajustes del origen).
        await sincronizarViaticosPlan(empresaId, planId, { piloto: pilotoId, auxiliares: auxIds }, conn);
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
