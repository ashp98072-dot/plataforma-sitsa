import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
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
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { hoyLocal, toIsoDate } from "@/lib/rrhh/dates";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import {
  ESTADOS_QUE_RESERVAN_RECURSOS,
  finViajeDesdeInput,
  inicioViaje,
  mensajeConflicto,
  primerConflictoTraslape,
  type RecursoAValidar,
} from "@/lib/tms/disponibilidad-traslapes";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";

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
const ESTADOS_SOLO_NOTAS = new Set(["En ruta"]);
const ESTADOS_BLOQUEADOS = new Set(["Cerrado", "Cancelado"]);

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
 * Fase P5.1b: helper conn-aware para escrituras. Si se pasa `conn` (dentro
 * de una transacción de Programación), usa esa misma conexión; si no,
 * mantiene exactamente el comportamiento actual (pool global vía @/lib/db).
 * Mismo patrón que runExecute en src/lib/tms/paradas.ts.
 */
async function runExecute(
  conn: PoolConnection | undefined,
  sql: string,
  params: SqlParams = [],
): Promise<ResultSetHeader> {
  if (conn) {
    const [result] = await conn.execute<ResultSetHeader>(sql, params);
    return result;
  }
  return execute(sql, params);
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

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const condiciones = ["p.empresa_id = ?"];
  const paramsRows: SqlParams = [guard.empresa.id];
  if (usarRangoFecha) {
    condiciones.push("p.fecha_plan BETWEEN ? AND ?");
    paramsRows.push(fechaDesdeParam as string, fechaHastaParam as string);
  }
  if (pendienteCierreParam) {
    condiciones.push(SQL_PENDIENTE_CIERRE);
  }
  // LIMIT: "pendienteCierre=1" es justamente la vista que NUNCA debe poder
  // perder un registro por límite — el volumen esperado es bajo (viajes ya
  // finalizados, aún no cerrados), así que se deja sin límite. El GET sin
  // filtros (compat) y el filtro por rango de fecha conservan el límite de
  // seguridad de siempre.
  const limitSql = pendienteCierreParam ? "" : "LIMIT 200";

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
              p.tipo_traslado, p.notas,
              DATE_FORMAT(p.regreso_estimado, '%Y-%m-%dT%H:%i') AS regreso_estimado,
              p.tarifa_comercial, p.referencia_cliente, p.ruta_id, p.ruta_codigo_historico,
              p.lugar_descarga_historico, p.contacto_nombre_historico, p.contacto_cargo_historico,
              p.contacto_telefono_historico,
              c.nombre AS cliente, u.placa, pil.nombre AS piloto, aux.nombre AS auxiliar,
              p.piloto_id, p.auxiliar_id, pil.id_empleado AS piloto_empleado_id,
              emp_pil.telefono AS piloto_telefono,
              aux.id_empleado AS auxiliar_empleado_id,
              emp_aux.telefono AS auxiliar_telefono,
              COALESCE(ev.cnt, 0) AS evidencias
       FROM tms_planes_viaje p
       LEFT JOIN tms_clientes c ON c.id = p.cliente_id
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id
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
  const [paradasMap, auxMap] = await Promise.all([
    listarParadasDePlanes(planIds),
    auxiliaresDePlanes(planIds),
  ]);

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
      paradas,
      paradasPendientes: paradas.filter(
        (p) => p.requiere_evidencia && p.evidencias < 1,
      ).length,
    };
  });

  const vehiculos = disp?.vehiculos ?? [];
  const placasFlota = placasDisponiblesParaPlan(vehiculos);
  const vehiculosDisponibles = vehiculos
    .filter((v) => v.puedeEnviar)
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
  const estadoVehiculos = vehiculos.map((v) => ({
    placa: v.placa,
    estadoDisponibilidad: v.estadoDisponibilidad,
    motivoNoDisponible: v.motivoNoDisponible,
  }));

  return NextResponse.json(
    {
      planes,
      placasFlota,
      vehiculosDisponibles,
      estadoVehiculos,
      resumenFlota,
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

async function personalDesdeEmpleado(
  empresaId: number,
  empleadoId: number | undefined,
  tipo: "Piloto" | "Auxiliar",
): Promise<number | null> {
  if (!empleadoId) return null;
  const emp = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre FROM empleados
     WHERE id = ? AND empresa_id = ? AND estado = 'Activo' LIMIT 1`,
    [empleadoId, empresaId],
  );
  if (!emp[0]) return null;
  const codigo = String(emp[0].codigo);
  const nombre = String(emp[0].nombre);
  const existing = await query<RowDataPacket[]>(
    `SELECT id FROM tms_personal
     WHERE empresa_id = ? AND codigo = ? AND tipo = ? LIMIT 1`,
    [empresaId, codigo, tipo],
  );
  if (existing[0]) {
    await execute(
      `UPDATE tms_personal SET id_empleado = ?, nombre = ?
       WHERE id = ? AND empresa_id = ?
         AND (id_empleado IS NULL OR id_empleado = ?)`,
      [empleadoId, nombre, existing[0].id, empresaId, empleadoId],
    );
    return Number(existing[0].id);
  }
  const r = await execute(
    `INSERT INTO tms_personal
      (empresa_id, codigo, nombre, tipo, estado, id_empleado)
     VALUES (?, ?, ?, ?, 'Activo', ?)`,
    [empresaId, codigo, nombre, tipo, empleadoId],
  );
  return Number(r.insertId);
}

/**
 * Fase P5.1a: valida un personal_id EXACTO (sin resolver/auto-crear por
 * nombre o id_empleado) — existe, pertenece a la empresa, es del tipo
 * esperado y está activo. Usado exclusivamente por los campos nuevos
 * pilotoPersonalId/auxiliarPersonalIds de Programación.
 */
async function validarPersonalId(
  empresaId: number,
  personalId: number,
  tipoEsperado: "Piloto" | "Auxiliar",
): Promise<{ id: number; nombre: string } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre FROM tms_personal
     WHERE id = ? AND empresa_id = ? AND tipo = ? AND estado = 'Activo' LIMIT 1`,
    [personalId, empresaId, tipoEsperado],
  );
  return rows[0]
    ? { id: Number(rows[0].id), nombre: String(rows[0].nombre) }
    : null;
}

async function upsertLugar(
  empresaId: number,
  nombre: string | undefined,
  tipo: string,
): Promise<number | null> {
  if (!nombre?.trim()) return null;
  const existing = await query<RowDataPacket[]>(
    "SELECT id FROM tms_lugares WHERE empresa_id = ? AND nombre = ? LIMIT 1",
    [empresaId, nombre.trim()],
  );
  if (existing[0]) return Number(existing[0].id);
  const r = await execute(
    "INSERT INTO tms_lugares (empresa_id, nombre, tipo) VALUES (?, ?, ?)",
    [empresaId, nombre.trim(), tipo],
  );
  return Number(r.insertId);
}

/**
 * Fase P5.1b: `conn` opcional — si viene (dentro de una transacción de
 * Programación), el DELETE + INSERTs usan esa misma conexión y los errores
 * SE PROPAGAN (para que el caller pueda hacer ROLLBACK) en vez de
 * silenciarse. Sin `conn`, comportamiento IDÉNTICO al actual: pool global
 * y errores silenciados (tolerancia histórica a "tabla aún no existe") —
 * compatibilidad total con el POST y con el resto del PATCH legado, que
 * siguen llamándola sin `conn`. No se duplica la función: una sola función,
 * dos ramas de manejo de errores según haya o no transacción activa.
 */
async function guardarAuxiliaresPlan(
  planId: number,
  personalIds: number[],
  conn?: PoolConnection,
): Promise<void> {
  async function escribir(): Promise<void> {
    await runExecute(conn, "DELETE FROM tms_plan_auxiliares WHERE plan_id = ?", [
      planId,
    ]);
    let orden = 1;
    for (const pid of personalIds.slice(0, 8)) {
      await runExecute(
        conn,
        `INSERT INTO tms_plan_auxiliares (plan_id, personal_id, orden)
         VALUES (?, ?, ?)`,
        [planId, pid, orden++],
      );
    }
  }
  if (conn) {
    await escribir();
    return;
  }
  try {
    await escribir();
  } catch {
    /* tabla aún no existe (comportamiento legado, sin conn) */
  }
}

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
  let clienteId: number | null = null;
  let unidadId: number | null = null;
  let pilotoId: number | null = null;

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
  // Mejora Programación (Opción A) — mapa empleadoId (RRHH) -> personalId
  // (tms_personal, recién resuelto) SOLO para el personal ligado a RRHH —
  // es la clave para traducir viaticosAsignados (que llega en espacio de
  // empleadoId, el único que el cliente conoce antes de guardar) al
  // personalId real que espera sincronizarViaticosPlan.
  const empleadoIdAPersonalId = new Map<number, number>();

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
  const auxPersonalIds: number[] = [];
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
  const auxiliarId = auxPersonalIds[0] ?? null;

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

  // VIAT-2: recursos que este plan reservaría (piloto + cada auxiliar +
  // unidad) y su intervalo real (fecha_plan+hora_carga → regreso_estimado).
  // Sin "misma fecha" — dos viajes el mismo día que no se traslapan en hora
  // están permitidos (ver disponibilidad-traslapes.ts).
  const recursosNuevoPlan: RecursoAValidar[] = [
    ...(pilotoId ? [{ tipo: "piloto" as const, id: pilotoId }] : []),
    ...auxPersonalIds.map((id) => ({ tipo: "auxiliar" as const, id })),
    ...(unidadId ? [{ tipo: "unidad" as const, id: unidadId }] : []),
  ];
  const finNuevo = finViajeDesdeInput(d.regresoEstimado);
  if (recursosNuevoPlan.length && !finNuevo) {
    return NextResponse.json(
      {
        error:
          "Indica el regreso estimado: es obligatorio para poder validar disponibilidad y guardar la programación cuando hay piloto, auxiliares o unidad asignados.",
      },
      { status: 400 },
    );
  }
  const intervaloNuevo = finNuevo
    ? { inicio: inicioViaje(d.fechaPlan, d.horaCarga), fin: finNuevo }
    : null;

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
  try {
    if (lockConn && intervaloNuevo) {
      try {
        await lockConn.query("SELECT GET_LOCK(?, 8) AS l", [lockKey]);
      } catch {
        /* ok */
      }
      const conflicto = await primerConflictoTraslape(
        empresaId,
        recursosNuevoPlan,
        intervaloNuevo,
        null,
      );
      if (conflicto) {
        return NextResponse.json({ error: mensajeConflicto(conflicto) }, { status: 409 });
      }
    }

    await conn.beginTransaction();

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [result] = await conn.execute<ResultSetHeader>(
          `INSERT INTO tms_planes_viaje
            (empresa_id, codigo, cliente_id, lugar_carga_id, lugar_descarga_id, unidad_id, piloto_id, auxiliar_id, fecha_plan, hora_carga, tipo_traslado, regreso_estimado, tarifa_comercial, referencia_cliente, ruta_id, ruta_codigo_historico, lugar_descarga_historico, contacto_nombre_historico, contacto_cargo_historico, contacto_telefono_historico, notas, estado)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Programado')`,
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
            d.tarifaComercial ?? null,
            d.referenciaCliente?.trim() || null,
            d.rutaId ?? null,
            d.rutaCodigo?.trim() || null,
            d.lugarDescargaHistorico?.trim() || null,
            d.contactoNombreHistorico?.trim() || null,
            d.contactoCargoHistorico?.trim() || null,
            d.contactoTelefonoHistorico?.trim() || null,
            d.notas ?? null,
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
      await guardarParadasPlan(empresaId, planId, paradasInput, conn);
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
      try {
        await lockConn.query("SELECT RELEASE_LOCK(?) AS l", [lockKey]);
      } catch {
        /* ok */
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
    detalle: `Plan #${planId} ${codigoFinal} · fecha ${d.fechaPlan} · piloto ${d.pilotoNombre?.trim() || "—"} · placa ${(d.placa || "").toUpperCase() || "—"} · ${paradasInput.length} parada(s)${paradasTxt ? `: ${paradasTxt}` : ""}`,
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
  estado: z
    .enum(["Programado", "En ruta", "Cargado", "Cancelado"])
    .optional(),
  notas: z.string().optional(),
  horaCarga: z.string().optional(),
  regresoEstimado: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional(),
  tarifaComercial: z.number().nonnegative().nullable().optional(),
  referenciaCliente: z.string().max(160).nullable().optional(),
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
});

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

  // Fase P5.1c: SELECT ampliado — se agregan fecha_plan, piloto_id y
  // flota_vehiculo_id (antes no se traían) para poder calcular la fecha
  // efectiva y revalidar disponibilidad de los recursos YA asignados
  // cuando cambia la fecha (ver "revalidación al cambiar fecha").
  // VIAT-2: se agregan unidad_id y regreso_estimado (antes no se traían)
  // para poder calcular el intervalo EFECTIVO del plan (recursos ya
  // asignados que esta solicitud no toca) al validar traslapes.
  const plan = await query<RowDataPacket[]>(
    `SELECT p.id, p.codigo, p.estado, p.fecha_plan, p.hora_carga, p.notas,
            p.piloto_id, p.unidad_id, p.regreso_estimado,
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
    regresoEstimado:
      plan[0].regreso_estimado != null
        ? String(plan[0].regreso_estimado).slice(0, 19).replace("T", " ")
        : null,
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
  };
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
  const tocaPiloto = d.pilotoNombre != null || d.pilotoPersonalId != null;
  const tocaAuxiliares =
    d.auxiliarEmpleadoIds != null ||
    d.auxiliarNombres != null ||
    d.auxiliarNombre != null ||
    d.auxiliarPersonalIds != null;
  const tocaUnidad = d.placa != null || d.flotaVehiculoId != null;
  const tocaFecha = d.fechaPlan != null;
  const tocaParadas = d.paradas != null;
  const tocaHora = d.horaCarga != null;
  const tocaComercial =
    d.regresoEstimado !== undefined ||
    d.tarifaComercial !== undefined ||
    d.referenciaCliente !== undefined;

  if (ESTADOS_BLOQUEADOS.has(antes.estado)) {
    return NextResponse.json(
      {
        error: `Este plan está en estado "${antes.estado}" y ya no admite modificaciones desde Programación.`,
      },
      { status: 409 },
    );
  }
  if (ESTADOS_SOLO_NOTAS.has(antes.estado) && !antes.pendienteCierre) {
    // En ruta SIN llegada registrada — comportamiento sin cambios: solo
    // notas. piloto/auxiliares/unidad/fecha/paradas/hora/comercial siguen
    // bloqueados exactamente igual que antes de OPS-3.2b.
    const camposNoPermitidos: string[] = [];
    if (tocaPiloto) camposNoPermitidos.push("piloto");
    if (tocaAuxiliares) camposNoPermitidos.push("auxiliares");
    if (tocaUnidad) camposNoPermitidos.push("unidad");
    if (tocaFecha) camposNoPermitidos.push("fecha");
    if (tocaParadas) camposNoPermitidos.push("paradas");
    if (tocaHora) camposNoPermitidos.push("hora de carga");
    if (tocaComercial) camposNoPermitidos.push("datos comerciales/regreso estimado");
    if (camposNoPermitidos.length) {
      return NextResponse.json(
        {
          error: `El plan está "${antes.estado}"; solo se pueden editar notas mientras está en ruta (no permitido: ${camposNoPermitidos.join(", ")}).`,
        },
        { status: 409 },
      );
    }
  } else if (ESTADOS_SOLO_NOTAS.has(antes.estado) && antes.pendienteCierre) {
    // OPS-3.2b — En ruta CON llegada registrada (pendiente de cierre):
    // reconciliación administrativa. Se habilitan notas, tarifa
    // comercial, referencia de cliente, regreso estimado, y los snapshots
    // de ruta/lugar de descarga/contacto (estos últimos ya eran editables
    // sin gate en cualquier estado — no se tocan aquí, ver comentario más
    // abajo). piloto/auxiliares/unidad/fecha/hora/paradas SIGUEN
    // bloqueados — quedan para OPS-3.2c/3.2d. `tocaComercial` NO se
    // revisa en esta rama a propósito: es justo lo que este PR habilita.
    const camposNoPermitidos: string[] = [];
    if (tocaPiloto) camposNoPermitidos.push("piloto");
    if (tocaAuxiliares) camposNoPermitidos.push("auxiliares");
    if (tocaUnidad) camposNoPermitidos.push("unidad");
    if (tocaFecha) camposNoPermitidos.push("fecha");
    if (tocaParadas) camposNoPermitidos.push("paradas");
    if (tocaHora) camposNoPermitidos.push("hora de carga");
    if (camposNoPermitidos.length) {
      return NextResponse.json(
        {
          error: `El plan está "${antes.estado}" (pendiente de cierre); no se puede modificar: ${camposNoPermitidos.join(", ")}. Antes del cierre solo se pueden corregir notas, tarifa comercial, referencia de cliente, regreso estimado y los datos de ruta/contacto.`,
        },
        { status: 409 },
      );
    }
  }

  // Fase P5.1c — FECHA EFECTIVA Y FECHA PASADA. "hoy" se calcula en
  // America/Guatemala (hoyLocal(), ya existente y reutilizado en el resto
  // del proyecto) — nunca con new Date().toISOString(), que es UTC y puede
  // desfasar un día cerca de medianoche. Aplica únicamente al PATCH de
  // Programación (no se toca el POST ni su comportamiento histórico).
  const hoy = hoyLocal();
  const fechaEfectiva = d.fechaPlan ?? antes.fechaPlan;
  if (fechaEfectiva && fechaEfectiva < hoy) {
    return NextResponse.json(
      { error: "No se puede reprogramar un viaje hacia una fecha pasada." },
      { status: 400 },
    );
  }
  const esHoy = fechaEfectiva === hoy;
  // Si la fecha cambia, los recursos YA asignados (que no cambian de ID en
  // este mismo request) deben revalidarse contra la NUEVA fecha — cambia el
  // contexto temporal de toda la asignación.
  const fechaCambia = d.fechaPlan != null && d.fechaPlan !== antes.fechaPlan;
  if (d.regresoEstimado) {
    const horaEfectiva = d.horaCarga ?? antes.hora ?? "00:00";
    const salidaProgramada = `${fechaEfectiva}T${(horaEfectiva || "00:00").slice(0, 5)}`;
    if (d.regresoEstimado <= salidaProgramada) {
      return NextResponse.json(
        { error: "El regreso estimado debe ser posterior a la salida programada." },
        { status: 400 },
      );
    }
  }

  let pilotoId: number | undefined;
  let auxiliarId: number | null | undefined;
  let unidadId: number | undefined;

  if (d.pilotoNombre?.trim()) {
    const existingPil = await query<RowDataPacket[]>(
      `SELECT id FROM tms_personal
       WHERE empresa_id = ? AND tipo = 'Piloto' AND LOWER(TRIM(nombre)) = LOWER(?)
       LIMIT 1`,
      [empresaId, d.pilotoNombre.trim()],
    );
    if (existingPil[0]) {
      pilotoId = Number(existingPil[0].id);
    } else {
      const r = await execute(
        "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Piloto')",
        [empresaId, d.pilotoNombre.trim()],
      );
      pilotoId = Number(r.insertId);
    }
  }

  // Fase P5.1a: campo por ID exclusivo de Programación. Se evalúa DESPUÉS
  // del bloque por nombre a propósito — si un request trajera ambos (no
  // debería ocurrir en uso normal), el id validado tiene precedencia.
  if (d.pilotoPersonalId != null) {
    const piloto = await validarPersonalId(empresaId, d.pilotoPersonalId, "Piloto");
    if (!piloto) {
      return NextResponse.json(
        { error: "El piloto seleccionado no existe o no pertenece a esta empresa." },
        { status: 400 },
      );
    }
    pilotoId = piloto.id;
  }

  // Fase P5.1b: de aquí en adelante solo RESOLUCIÓN/VALIDACIÓN (sin tocar
  // tms_unidades, tms_planes_viaje ni tms_plan_auxiliares todavía) — las 4
  // escrituras relacionadas se ejecutan más abajo dentro de una única
  // transacción. personalDesdeEmpleado()/el alta por nombre SÍ pueden
  // crear filas en tms_personal aquí (fuera de la transacción): es el
  // mismo patrón, sin envolver, que ya usa el POST para clientes/personal
  // nuevos — no es una de las 4 escrituras que P5.1b debe hacer atómicas.
  const actualizarAux =
    d.auxiliarEmpleadoIds != null ||
    d.auxiliarNombres != null ||
    d.auxiliarNombre != null;
  let auxPersonalIdsLegado: number[] | undefined;
  if (actualizarAux) {
    const auxPersonalIds: number[] = [];
    for (const eid of (d.auxiliarEmpleadoIds ?? []).slice(0, 8)) {
      const pid = await personalDesdeEmpleado(empresaId, eid, "Auxiliar");
      if (pid) auxPersonalIds.push(pid);
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
        const id = Number(existing[0].id);
        if (!auxPersonalIds.includes(id)) auxPersonalIds.push(id);
        continue;
      }
      const r = await execute(
        "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Auxiliar')",
        [empresaId, nombre],
      );
      auxPersonalIds.push(Number(r.insertId));
    }
    auxiliarId = auxPersonalIds[0] ?? null;
    auxPersonalIdsLegado = auxPersonalIds;
  }

  // Fase P5.1a: campo por ID exclusivo de Programación. Igual que piloto,
  // se evalúa después del bloque por nombre/id_empleado y tiene precedencia
  // si ambos vinieran en el mismo request. Fase P5.1b: solo valida aquí —
  // el reemplazo real de tms_plan_auxiliares se hace dentro de la
  // transacción, más abajo.
  let auxPersonalIdsNuevo: number[] | undefined;
  if (d.auxiliarPersonalIds != null) {
    const auxIds: number[] = [];
    for (const pid of d.auxiliarPersonalIds.slice(0, 8)) {
      const aux = await validarPersonalId(empresaId, pid, "Auxiliar");
      if (!aux) {
        return NextResponse.json(
          {
            error: `Un auxiliar seleccionado no existe o no pertenece a esta empresa (id ${pid}).`,
          },
          { status: 400 },
        );
      }
      if (!auxIds.includes(aux.id)) auxIds.push(aux.id);
    }
    auxiliarId = auxIds[0] ?? null;
    auxPersonalIdsNuevo = auxIds;
  }

  // Mejora Programación — bloquear el cambio de personal si a quien se
  // quita/reemplaza ya se le procesó un viático (AUTORIZADO/ENTREGADO/
  // LIQUIDADO). Solo corre si esta solicitud REALMENTE toca piloto y/o
  // auxiliares (mismo gate que ya decide si se llama a
  // sincronizarViaticosPlan más abajo) — editar notas/tarifa/hora/etc. sin
  // tocar personal nunca se bloquea por esto. Se calcula el personal
  // REALMENTE removido (antes menos el conjunto final que aplicaría este
  // PATCH) y se consulta su viático ANTES de escribir nada — 409 sin
  // ningún cambio si alguno no está PROGRAMADO.
  const cambiaPersonal = pilotoId !== undefined || auxPersonalIdsLegado != null || auxPersonalIdsNuevo != null;
  if (cambiaPersonal) {
    const pilotoFinal = pilotoId !== undefined ? pilotoId : antes.pilotoId;
    const auxiliaresFinal = auxPersonalIdsNuevo ?? auxPersonalIdsLegado ?? antesAuxiliaresIds;

    const removidos: { personalId: number; nombre: string }[] = [];
    if (antes.pilotoId != null && antes.pilotoId !== pilotoFinal) {
      removidos.push({ personalId: antes.pilotoId, nombre: antes.piloto || `Piloto #${antes.pilotoId}` });
    }
    antesAuxiliaresIds.forEach((id, i) => {
      if (!auxiliaresFinal.includes(id)) {
        removidos.push({ personalId: id, nombre: antesAuxiliaresNombres[i] || `Auxiliar #${id}` });
      }
    });

    if (removidos.length) {
      const viaticosRemovidos = await query<RowDataPacket[]>(
        `SELECT personal_id, estado FROM tms_viaticos
         WHERE plan_id = ? AND personal_id IN (${removidos.map(() => "?").join(",")}) AND estado != 'PROGRAMADO'`,
        [d.id, ...removidos.map((r) => r.personalId)],
      );
      if (viaticosRemovidos.length) {
        const estadoPorPersonal = new Map(viaticosRemovidos.map((r) => [Number(r.personal_id), String(r.estado)]));
        const bloqueados = removidos.filter((r) => estadoPorPersonal.has(r.personalId));
        const detalle = bloqueados
          .map((b) => `${b.nombre} (viático ${estadoPorPersonal.get(b.personalId)!.toLowerCase()})`)
          .join(", ");
        return NextResponse.json(
          {
            error:
              bloqueados.length === 1
                ? `No se puede quitar a ${bloqueados[0].nombre} del viaje porque su viático ya fue ${estadoPorPersonal.get(bloqueados[0].personalId)!.toLowerCase()}.`
                : `No se puede modificar el personal del viaje: ${detalle} — su(s) viático(s) ya fue(ron) procesado(s).`,
          },
          { status: 409 },
        );
      }
    }
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

  // Fase P5.1c — DISPONIBILIDAD. Exclusiva de los campos por ID de
  // Programación (pilotoPersonalId/auxiliarPersonalIds/flotaVehiculoId) —
  // los campos legado (pilotoNombre/auxiliar*/placa) NO se validan aquí,
  // igual que en P5.1a, para no cambiar el comportamiento ya existente de
  // TMS (staff). Se valida: (a) el recurso NUEVO si viene en el payload, o
  // (b) el recurso YA asignado si la fecha cambió y no viene un id nuevo
  // para ese recurso (revalidación por cambio de fecha). Todo esto corre
  // ANTES de abrir la transacción.
  const pilotoIdParaValidar =
    d.pilotoPersonalId != null
      ? (pilotoId ?? null)
      : fechaCambia && antes.pilotoId != null
        ? antes.pilotoId
        : null;
  const auxiliaresIdsParaValidar: number[] =
    d.auxiliarPersonalIds != null
      ? (auxPersonalIdsNuevo ?? [])
      : fechaCambia
        ? antesAuxiliaresIds
        : [];
  const vehiculoIdParaValidar =
    d.flotaVehiculoId != null
      ? d.flotaVehiculoId
      : fechaCambia && antes.flotaVehiculoId != null
        ? antes.flotaVehiculoId
        : null;

  const advertencias: AdvertenciaPatch[] = [];

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
    for (const r of recursos) {
      const disp = personalDisp.find((p) => p.personalId === r.personalId);
      // No debería faltar (tms_personal ya se validó antes) — si por alguna
      // inconsistencia no aparece, no se bloquea por un dato que no se pudo
      // verificar (mismo criterio de "no bloquear por falla ajena" que ya
      // usa el POST con la disponibilidad de placa).
      if (!disp) continue;
      const etiqueta =
        r.rol === "piloto" ? "El piloto seleccionado" : `El auxiliar ${disp.nombre}`;

      if (disp.incidenciasBloqueantes.length > 0) {
        const inc = disp.incidenciasBloqueantes[0];
        return NextResponse.json(
          {
            error: `${etiqueta} tiene una incidencia (${inc.tipo}) del ${inc.fechaInicio} al ${inc.fechaFin} que cubre el ${fechaEfectiva}.`,
          },
          { status: 409 },
        );
      }
      if (disp.viajeActual != null) {
        if (esHoy) {
          return NextResponse.json(
            { error: `${etiqueta} tiene un viaje en curso.` },
            { status: 409 },
          );
        }
        // Futuro: el viaje abierto ahora mismo NO bloquea — no se conoce
        // cuándo terminará y no se inventa una duración estimada.
        advertencias.push({
          tipo: r.rol === "piloto" ? "viaje_actual_piloto" : "viaje_actual_auxiliar",
          mensaje: `${disp.nombre} está actualmente en ruta. Esto no impide su programación para el ${fechaEfectiva}.`,
        });
      } else if (disp.estadoDisponibilidad === "no_disponible") {
        // Por eliminación (ya se descartaron incidencia bloqueante y viaje
        // actual arriba): personal inactivo o empleado de baja — hecho
        // estructural, bloquea siempre sin importar la fecha.
        return NextResponse.json(
          {
            error: `${etiqueta} no está activo o el empleado vinculado está de baja.`,
          },
          { status: 409 },
        );
      }
      for (const otro of disp.otrosPlanesDelDia) {
        if (otro.planId === d.id) continue; // nunca advertir contra el propio plan
        advertencias.push({
          tipo: r.rol === "piloto" ? "otro_plan_dia_piloto" : "otro_plan_dia_auxiliar",
          mensaje: `${disp.nombre} ya tiene otro plan el mismo día (${otro.planCodigo}).`,
        });
      }
      for (const a of disp.advertencias) {
        if (a.tipo === "incidencia_informativa") {
          advertencias.push({
            tipo:
              r.rol === "piloto"
                ? "incidencia_informativa_piloto"
                : "incidencia_informativa_auxiliar",
            mensaje: `${disp.nombre} tiene una incidencia informativa (${a.incidencia.tipo}) el ${fechaEfectiva}.`,
          });
        }
      }
    }
  }

  if (vehiculoIdParaValidar != null) {
    const dispVeh = await listarDisponibilidadVehiculos(empresaId);
    const v = dispVeh.vehiculos.find((x) => x.id === vehiculoIdParaValidar);
    if (v) {
      if (v.estadoDisponibilidad === "inactivo") {
        return NextResponse.json(
          { error: "La unidad seleccionada está inactiva." },
          { status: 409 },
        );
      }
      if (v.estadoDisponibilidad === "en_taller") {
        if (esHoy) {
          return NextResponse.json(
            { error: "La unidad seleccionada está actualmente en taller." },
            { status: 409 },
          );
        }
        // Futuro: no bloquea, pero SIN fecha de salida conocida — el
        // sistema no tiene ese dato y no se inventa. Advertencia fuerte.
        advertencias.push({
          tipo: "vehiculo_en_taller",
          mensaje: `La unidad ${v.placa} está actualmente en taller y no tiene fecha de salida registrada. Verifique su disponibilidad antes de confirmar.`,
        });
      } else if (v.estadoDisponibilidad === "en_ruta") {
        if (esHoy) {
          return NextResponse.json(
            {
              error: `La unidad seleccionada está actualmente en ruta${v.viajeAbierto ? ` con ${v.viajeAbierto.pilotoNombre}` : ""}.`,
            },
            { status: 409 },
          );
        }
        advertencias.push({
          tipo: "vehiculo_en_ruta",
          mensaje: `La unidad ${v.placa} está actualmente en ruta. Esto no impide su programación para el ${fechaEfectiva}.`,
        });
      }
    }
  }

  // Fase P5.1b: TODO O NADA. Las 4 escrituras relacionadas de una
  // modificación de Programación —upsert de tms_unidades, UPDATE de
  // tms_planes_viaje, reemplazo de tms_plan_auxiliares y reemplazo de
  // tms_plan_paradas— comparten una única conexión/transacción: si
  // cualquiera falla, se revierten todas. La conexión se abre lo más tarde
  // posible (todas las validaciones de arriba ya corrieron) y se libera
  // siempre en el `finally`, sin excepción.
  const conn = await getPool().getConnection();
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
    // verificación antes de que cualquiera escriba. Se omite si el estado
    // efectivo ya no reserva recursos (Descargado/Cerrado/Cancelado) — no
    // tiene sentido validar disponibilidad de algo que se está liberando.
    const estadoEfectivo = d.estado ?? antes.estado;
    if ((ESTADOS_QUE_RESERVAN_RECURSOS as readonly string[]).includes(estadoEfectivo)) {
      const pilotoEfectivo = pilotoId ?? antes.pilotoId;
      const unidadEfectiva = unidadId ?? antes.unidadId;
      const auxiliaresEfectivos = auxPersonalIdsNuevo ?? auxPersonalIdsLegado ?? antesAuxiliaresIds;
      const recursosEfectivos: RecursoAValidar[] = [
        ...(pilotoEfectivo ? [{ tipo: "piloto" as const, id: pilotoEfectivo }] : []),
        ...auxiliaresEfectivos.map((id) => ({ tipo: "auxiliar" as const, id })),
        ...(unidadEfectiva ? [{ tipo: "unidad" as const, id: unidadEfectiva }] : []),
      ];
      if (recursosEfectivos.length) {
        const fechaEfectivaPlan = d.fechaPlan ?? antes.fechaPlan;
        const horaEfectivaCarga = d.horaCarga ?? antes.hora;
        const finEfectivo =
          d.regresoEstimado !== undefined
            ? finViajeDesdeInput(d.regresoEstimado)
            : antes.regresoEstimado;
        if (!finEfectivo) {
          await conn.rollback();
          return NextResponse.json(
            {
              error:
                "Indica el regreso estimado: es obligatorio para poder validar disponibilidad y guardar la programación cuando hay piloto, auxiliares o unidad asignados.",
            },
            { status: 400 },
          );
        }
        try {
          await conn.query("SELECT GET_LOCK(?, 8) AS l", [`tms_traslape_${empresaId}`]);
        } catch {
          /* ok */
        }
        const conflicto = await primerConflictoTraslape(
          empresaId,
          recursosEfectivos,
          { inicio: inicioViaje(fechaEfectivaPlan, horaEfectivaCarga), fin: finEfectivo },
          d.id,
          conn,
        );
        try {
          await conn.query("SELECT RELEASE_LOCK(?) AS l", [`tms_traslape_${empresaId}`]);
        } catch {
          /* ok */
        }
        if (conflicto) {
          await conn.rollback();
          return NextResponse.json({ error: mensajeConflicto(conflicto) }, { status: 409 });
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
        referencia_cliente = CASE WHEN ? THEN ? ELSE referencia_cliente END,
        ruta_id = COALESCE(?, ruta_id),
        ruta_codigo_historico = COALESCE(?, ruta_codigo_historico),
        lugar_descarga_historico = COALESCE(?, lugar_descarga_historico),
        contacto_nombre_historico = COALESCE(?, contacto_nombre_historico),
        contacto_cargo_historico = COALESCE(?, contacto_cargo_historico),
        contacto_telefono_historico = COALESCE(?, contacto_telefono_historico)
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
        d.tarifaComercial !== undefined,
        d.tarifaComercial ?? null,
        d.referenciaCliente !== undefined,
        d.referenciaCliente?.trim() || null,
        d.rutaId ?? null,
        d.rutaCodigo?.trim() || null,
        d.lugarDescargaHistorico?.trim() || null,
        d.contactoNombreHistorico?.trim() || null,
        d.contactoCargoHistorico?.trim() || null,
        d.contactoTelefonoHistorico?.trim() || null,
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
      await guardarParadasPlan(empresaId, d.id, paradasInput, conn);
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
  if (tocaComercial) cambios.push("datos comerciales/regreso estimado actualizados");
  if (paradasInput != null) {
    cambios.push(`paradas redefinidas (${paradasAntesCount} → ${paradasInput.length})`);
  }
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
