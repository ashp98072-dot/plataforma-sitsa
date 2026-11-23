import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { query } from "@/lib/db";
import { destinoPagoEmpleado } from "@/lib/tms/destino-pago-empleado";
import { CATEGORIAS_GASTO, METODOS_PAGO_GASTO, normalizarDestinoPago } from "@/lib/tms/gastos";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";

/**
 * FONDOS DIARIOS (Fase 3) — «Otros fondos del viaje»: gastos adicionales de un viaje (hospedaje, combustible, mantenimiento, cuadrilla extra, peajes, parqueo, otros) que se capturan
 * en Programación y se consolidan, junto con los viáticos, en la MISMA solicitud diaria de su empresa requirente y fecha (fondos-diarios.ts: una sola lógica de consolidación).
 *
 * Reglas:
 *  · La categoría sale del catálogo compartido de Fondos/Gastos (CATEGORIAS_GASTO) SIN «Viáticos» (ya los genera tms_viaticos: evita pagar dos veces el mismo concepto) ni «Reintegro de gastos».
 *  · El beneficiario es un EMPLEADO de RRHH de ESTA empresa (piloto, auxiliar u otro). Cuenta/teléfono: se sugiere desde RRHH si se deja vacío y se puede corregir.
 *  · Un otro fondo ya incluido en una solicitud AUTORIZADA/LIQUIDADA no se puede modificar ni retirar desde Programación (el dinero ya fue autorizado; no se reescribe).
 *  · La unidad, el cliente, la fecha, el viaje y la empresa requirente NO se capturan: se heredan del viaje al sincronizar.
 *  · Sin la migración (sql/migrate-2026-12-fondos-otros.sql) la sección no existe: detección por sonda con caché.
 */

/** Categorías permitidas en «Otros fondos»: el catálogo compartido sin los conceptos que se generan por otra vía. */
export const CATEGORIAS_OTROS_FONDOS: readonly string[] = CATEGORIAS_GASTO.filter((c) => c !== "Viáticos" && c !== "Reintegro de gastos");
export const MAX_OTROS_FONDOS_POR_VIAJE = 30;
export const MONTO_MAXIMO_OTRO_FONDO = 9_999_999.99;

const dinero = z.number().refine(Number.isFinite, "Monto inválido").refine((n) => n > 0, "El monto debe ser mayor que cero.").refine((n) => n <= MONTO_MAXIMO_OTRO_FONDO, "El monto es demasiado grande.")
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "El monto admite máximo 2 decimales.");

export const otroFondoSchema = z.object({
  /** Presente = línea existente del viaje (se conserva su identificador); ausente = nueva. */
  id: z.number().int().positive().optional(),
  categoria: z.string().refine((c) => CATEGORIAS_OTROS_FONDOS.includes(c), "Categoría no válida para otros fondos."),
  monto: dinero,
  descripcion: z.string().trim().max(300).nullable().optional(),
  empleadoId: z.number().int().positive(),
  metodoPago: z.enum(METODOS_PAGO_GASTO).nullable().optional(),
  cuenta: z.string().trim().max(100).nullable().optional(),
}).strict();
export type OtroFondoEntrada = z.infer<typeof otroFondoSchema>;
export const otrosFondosSchema = z.array(otroFondoSchema).max(MAX_OTROS_FONDOS_POR_VIAJE, `Máximo ${MAX_OTROS_FONDOS_POR_VIAJE} otros fondos por viaje.`)
  .refine((l) => new Set(l.filter((x) => x.id != null).map((x) => x.id)).size === l.filter((x) => x.id != null).length, "Hay otros fondos repetidos.");

export type OtroFondoPlan = {
  id: number; planId: number; categoria: string; monto: number; descripcion: string | null; empleadoId: number; empleadoNombre: string | null;
  metodoPago: string | null; cuenta: string | null;
  /** Ya está en una solicitud autorizada/liquidada: solo lectura en Programación. */
  bloqueado: boolean;
};

export { otrosFondosInstalado, reiniciarDeteccionOtrosFondos } from "@/lib/tms/plan-otros-fondos-instalado";

// ------------------------------------------------------------------------------------------------------------------ lectura
const num = (v: unknown) => Number(v ?? 0);
function mapFila(r: RowDataPacket, bloqueados: Set<number>): OtroFondoPlan {
  return { id: num(r.id), planId: num(r.plan_id), categoria: String(r.categoria), monto: num(r.monto), descripcion: r.descripcion != null ? String(r.descripcion) : null, empleadoId: num(r.empleado_id),
    empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : null, metodoPago: r.metodo_pago != null ? String(r.metodo_pago) : null, cuenta: r.cuenta != null ? String(r.cuenta) : null, bloqueado: bloqueados.has(num(r.id)) };
}

/** Ids de otros fondos ya cubiertos por una línea de solicitud NO pendiente y no rechazada (autorizada/liquidada): su dinero ya está comprometido. */
async function idsBloqueados(ejecutar: (sql: string, params: unknown[]) => Promise<RowDataPacket[]>, empresaId: number, planIds: number[]): Promise<Set<number>> {
  if (!planIds.length) return new Set();
  const rows = await ejecutar(
    `SELECT DISTINCT l.otro_fondo_id FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id
     WHERE l.empresa_id = ? AND l.origen = 'AUTO_OTRO' AND l.plan_id IN (${planIds.map(() => "?").join(",")}) AND s.estado NOT IN ('Pendiente', 'Rechazada')`,
    [empresaId, ...planIds],
  );
  return new Set(rows.map((r) => num(r.otro_fondo_id)));
}

/** Otros fondos de varios viajes (para el listado/edición de Programación). Solo con la migración aplicada. */
export async function listarOtrosFondosDePlanes(empresaId: number, planIds: number[]): Promise<Map<number, OtroFondoPlan[]>> {
  const mapa = new Map<number, OtroFondoPlan[]>();
  if (!planIds.length) return mapa;
  const marcas = planIds.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT o.id, o.plan_id, o.categoria, o.monto, o.descripcion, o.empleado_id, e.nombre AS empleado_nombre, o.metodo_pago, o.cuenta
     FROM tms_plan_otros_fondos o LEFT JOIN empleados e ON e.id = o.empleado_id AND e.empresa_id = o.empresa_id
     WHERE o.empresa_id = ? AND o.plan_id IN (${marcas}) ORDER BY o.id`, [empresaId, ...planIds]);
  const bloqueados = await idsBloqueados((sql, p) => query<RowDataPacket[]>(sql, p as never), empresaId, planIds);
  for (const r of rows) { const f = mapFila(r, bloqueados); (mapa.get(f.planId) ?? mapa.set(f.planId, []).get(f.planId)!).push(f); }
  return mapa;
}

/** Sugerencia de cuenta/teléfono desde RRHH para un empleado y método de pago (solo lectura; nunca modifica RRHH). */
export async function sugerirDestinoPago(empresaId: number, empleadoId: number, metodo: string | null): Promise<{ empleadoNombre: string; destino: string; tieneDato: boolean } | null> {
  const rows = await query<RowDataPacket[]>("SELECT nombre, cuenta_bancaria, telefono FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [empleadoId, empresaId]);
  if (!rows[0]) return null;
  const destino = destinoPagoEmpleado(metodo, { cuentaBancaria: rows[0].cuenta_bancaria != null ? String(rows[0].cuenta_bancaria) : null, telefono: rows[0].telefono != null ? String(rows[0].telefono) : null });
  return { empleadoNombre: String(rows[0].nombre ?? ""), destino, tieneDato: destino !== "" };
}

/** Empleados activos de la empresa para elegir beneficiario (sin datos bancarios: la cuenta se sugiere aparte, bajo demanda). */
export async function empleadosBeneficiarios(empresaId: number): Promise<{ id: number; nombre: string; puesto: string | null }[]> {
  const rows = await query<RowDataPacket[]>("SELECT id, nombre, puesto FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre LIMIT 1000", [empresaId]);
  return rows.map((r) => ({ id: num(r.id), nombre: String(r.nombre), puesto: r.puesto != null ? String(r.puesto) : null }));
}

// ------------------------------------------------------------------------------------------------------------------ escritura (dentro de la transacción del viaje)
const igual = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * Reemplaza la lista de otros fondos del viaje de forma DIFERENCIAL dentro de la transacción de Programación: los que traen `id` se conservan (mismo identificador), los nuevos se
 * insertan y los que ya no vienen se retiran. Un otro fondo ya autorizado (bloqueado) no se puede modificar ni retirar. Devuelve cuántos cambios hubo.
 * El cliente NO decide unidad, cliente, fecha ni empresa requirente: eso lo hereda la sincronización del viaje.
 */
export async function reemplazarOtrosFondosTx(conn: PoolConnection, empresaId: number, planId: number, entrada: OtroFondoEntrada[], usuario: string | null): Promise<number> {
  const [existentes] = await conn.query<RowDataPacket[]>("SELECT * FROM tms_plan_otros_fondos WHERE empresa_id = ? AND plan_id = ? ORDER BY id FOR UPDATE", [empresaId, planId]);
  const porId = new Map(existentes.map((e) => [num(e.id), e]));
  const bloqueados = await idsBloqueados(async (sql, p) => (await conn.query<RowDataPacket[]>(sql, p as never))[0], empresaId, [planId]);
  for (const x of entrada) if (x.id != null && !porId.has(x.id)) throw new ErrorDominioFormulario("Uno de los otros fondos no pertenece a este viaje.", 404);

  const empleadoIds = [...new Set(entrada.map((x) => x.empleadoId))];
  const empleados = new Map<number, RowDataPacket>();
  if (empleadoIds.length) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, nombre, cuenta_bancaria, telefono FROM empleados WHERE empresa_id = ? AND estado = 'Activo' AND id IN (${empleadoIds.map(() => "?").join(",")})`, [empresaId, ...empleadoIds]);
    for (const r of rows) empleados.set(num(r.id), r);
  }

  let cambios = 0;
  const conservados = new Set<number>();
  for (const [i, x] of entrada.entries()) {
    const n = i + 1;
    const empleado = empleados.get(x.empleadoId);
    if (!empleado) throw new ErrorDominioFormulario(`Otro fondo ${n}: el beneficiario no es un empleado activo de esta empresa.`);
    const metodo = x.metodoPago ?? null;
    // Cuenta/teléfono: lo escrito (corrección autorizada) o, si se dejó vacío, la sugerencia de RRHH. «Transferencia móvil» exige un número válido.
    const sugerida = destinoPagoEmpleado(metodo, { cuentaBancaria: empleado.cuenta_bancaria != null ? String(empleado.cuenta_bancaria) : null, telefono: empleado.telefono != null ? String(empleado.telefono) : null });
    let cuenta: string | null;
    try { cuenta = normalizarDestinoPago(metodo, x.cuenta?.trim() ? x.cuenta : sugerida || null); }
    catch (e) { throw e instanceof ErrorDominioFormulario ? new ErrorDominioFormulario(`Otro fondo ${n}: ${e.message}`) : e; }
    const descripcion = x.descripcion?.trim() || null;

    if (x.id == null) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO tms_plan_otros_fondos (empresa_id, plan_id, categoria, monto, descripcion, empleado_id, metodo_pago, cuenta, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, planId, x.categoria, x.monto, descripcion, x.empleadoId, metodo, cuenta, usuario]);
      cambios++;
      continue;
    }
    conservados.add(x.id);
    const previo = porId.get(x.id)!;
    const cambiaOrigen = previo.categoria !== x.categoria || Number(previo.monto).toFixed(2) !== x.monto.toFixed(2) || !igual(previo.descripcion, descripcion) || num(previo.empleado_id) !== x.empleadoId;
    const cambiaPago = !igual(previo.metodo_pago, metodo) || !igual(previo.cuenta, cuenta);
    if (!cambiaOrigen && !cambiaPago) continue;
    if (bloqueados.has(x.id)) throw new ErrorDominioFormulario(`Otro fondo ${n}: ya está en una solicitud autorizada y no se puede modificar desde Programación. Agrega un nuevo otro fondo si hace falta (se enviará en una solicitud complementaria).`, 409);
    await conn.execute(
      `UPDATE tms_plan_otros_fondos SET categoria = ?, monto = ?, descripcion = ?, empleado_id = ?, metodo_pago = ?, cuenta = ?, pago_pendiente_sync = IF(?, 1, pago_pendiente_sync) WHERE id = ? AND empresa_id = ? AND plan_id = ?`,
      [x.categoria, x.monto, descripcion, x.empleadoId, metodo, cuenta, cambiaPago ? 1 : 0, x.id, empresaId, planId]);
    cambios++;
  }
  for (const e of existentes) {
    const id = num(e.id);
    if (conservados.has(id)) continue;
    if (bloqueados.has(id)) throw new ErrorDominioFormulario("No se puede retirar un otro fondo que ya está en una solicitud autorizada.", 409);
    await conn.execute("DELETE FROM tms_plan_otros_fondos WHERE id = ? AND empresa_id = ? AND plan_id = ?", [id, empresaId, planId]);
    cambios++;
  }
  return cambios;
}
