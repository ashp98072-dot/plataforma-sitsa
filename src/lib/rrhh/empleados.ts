import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { toIsoDate, hoyLocal } from "./dates";
import { asegurarSchemaEmpleados } from "./empleados-schema";

export type Empleado = {
  id: number;
  numeroEmpleado: string;
  codigo: string;
  nombre: string;
  puesto: string;
  categoriaOps: string;
  tipoHorario: string;
  fechaAlta: string;
  fechaInicioLaboral: string | null;
  horaEntradaTeorica: string;
  horaSalidaTeorica: string;
  estado: string;
  docsCount?: number;
  dpi?: string;
  nit?: string;
  igss?: string;
  irtra?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  sexo?: string;
  fechaNacimiento?: string | null;
  tipoContrato?: string;
  formaPago?: string;
  sueldoBase?: number | null;
  bonoIncentivo?: number | null;
  bonoHerramientas?: number | null;
  profesion?: string;
  primerNombre?: string;
  segundoNombre?: string;
  tercerNombre?: string;
  cuartoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  apellidoCasada?: string;
  paisOrigen?: string;
  municipio?: string;
  etnia?: string;
  religion?: string;
  idioma?: string;
  licenciaNumero?: string;
  licenciaTipo?: string;
  licenciaVence?: string | null;
  fechaEgreso?: string | null;
  observaciones?: string;
  cuentaBancaria?: string;
  tipoCuenta?: string;
  banco?: string;
  contactoEmergencia?: string;
  supervisorId?: number | null;
  supervisorNombre?: string | null;
  centroCostoId?: number | null;
  /** Fase H1: elegibilidad individual para pago de horas extra. Default false. */
  horasExtraHabilitado?: boolean;
};

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * true SOLO si el error es específicamente "columna desconocida"
 * (ER_BAD_FIELD_ERROR / errno 1054) — es decir, la migración que agrega esa
 * columna todavía no se aplicó en esta base. Se usa para decidir si
 * crearEmpleado/actualizarEmpleado deben degradar a un INSERT/UPDATE mínimo
 * (compatibilidad con una base sin migrar). Cualquier otro error (FK,
 * tabla inexistente, duplicado, validación, etc.) NO debe camuflarse como
 * "hay que degradar" — debe abortar toda la transacción.
 */
function esColumnaDesconocida(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.code === "ER_BAD_FIELD_ERROR" || err?.errno === 1054;
}

function componerNombre(parts: {
  primerNombre?: string;
  segundoNombre?: string;
  tercerNombre?: string;
  cuartoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  apellidoCasada?: string;
  nombre?: string;
}): string {
  const nombres = [
    parts.primerNombre,
    parts.segundoNombre,
    parts.tercerNombre,
    parts.cuartoNombre,
  ]
    .map((x) => (x ?? "").trim())
    .filter(Boolean);
  const apellidos = [
    parts.primerApellido,
    parts.segundoApellido,
    parts.apellidoCasada,
  ]
    .map((x) => (x ?? "").trim())
    .filter(Boolean);
  const full = [...nombres, ...apellidos].join(" ").replace(/\s+/g, " ").trim();
  return full || (parts.nombre ?? "").trim();
}

function mapEmpleado(row: RowDataPacket): Empleado {
  return {
    id: Number(row.id),
    numeroEmpleado: str(row.numero_empleado),
    codigo: str(row.codigo),
    nombre: str(row.nombre),
    puesto: str(row.puesto),
    categoriaOps: str(row.categoria_ops),
    tipoHorario: String(row.tipo_horario ?? "Fijo").includes("Variable")
      ? "Variable"
      : "Fijo",
    fechaAlta: toIsoDate(row.fecha_alta as string | Date | null) ?? "",
    fechaInicioLaboral: toIsoDate(
      row.fecha_inicio_laboral as string | Date | null,
    ),
    horaEntradaTeorica: str(row.hora_entrada_teorica || "07:00:00"),
    horaSalidaTeorica: str(row.hora_salida_teorica || "16:00:00"),
    estado: str(row.estado || "Activo"),
    dpi: str(row.dpi),
    nit: str(row.nit),
    igss: str(row.igss),
    irtra: str(row.irtra),
    telefono: str(row.telefono),
    email: str(row.email),
    direccion: str(row.direccion),
    sexo: str(row.sexo),
    fechaNacimiento: toIsoDate(row.fecha_nacimiento as string | Date | null),
    tipoContrato: str(row.tipo_contrato || "fijo"),
    formaPago: str(row.forma_pago || "transferencia"),
    sueldoBase: numOrNull(row.sueldo_base),
    bonoIncentivo: numOrNull(row.bono_incentivo),
    bonoHerramientas: numOrNull(row.bono_herramientas),
    profesion: str(row.profesion),
    primerNombre: str(row.primer_nombre),
    segundoNombre: str(row.segundo_nombre),
    tercerNombre: str(row.tercer_nombre),
    cuartoNombre: str(row.cuarto_nombre),
    primerApellido: str(row.primer_apellido),
    segundoApellido: str(row.segundo_apellido),
    apellidoCasada: str(row.apellido_casada),
    paisOrigen: str(row.pais_origen),
    municipio: str(row.municipio),
    etnia: str(row.etnia),
    religion: str(row.religion),
    idioma: str(row.idioma),
    licenciaNumero: str(row.licencia_numero),
    licenciaTipo: str(row.licencia_tipo),
    licenciaVence: toIsoDate(row.licencia_vence as string | Date | null),
    fechaEgreso: toIsoDate(row.fecha_egreso as string | Date | null),
    observaciones: str(row.observaciones),
    cuentaBancaria: str(row.cuenta_bancaria),
    tipoCuenta: str(row.tipo_cuenta),
    banco: str(row.banco),
    contactoEmergencia: str(row.contacto_emergencia),
    supervisorId: row.supervisor_id != null ? Number(row.supervisor_id) : null,
    supervisorNombre: row.supervisor_nombre != null ? str(row.supervisor_nombre) : null,
    centroCostoId: row.centro_costo_id != null ? Number(row.centro_costo_id) : null,
    horasExtraHabilitado: Number(row.horas_extra_habilitado ?? 0) === 1,
  };
}

/** Columnas de planilla / combos (sin sueldos, observaciones, demografía…). */
const COLUMNAS_LISTA = `id, numero_empleado, codigo, nombre, puesto, categoria_ops, tipo_horario,
  fecha_alta, fecha_inicio_laboral, hora_entrada_teorica, hora_salida_teorica,
  estado, dpi, tipo_contrato, forma_pago, supervisor_id`;

export async function listarEmpleados(
  empresaId: number,
  filtro = "",
  opts?: {
    completo?: boolean;
    conDocs?: boolean;
    tipoContrato?: string;
    formaPago?: string;
    estado?: string;
  },
): Promise<Empleado[]> {
  await asegurarSchemaEmpleados().catch(() => undefined);
  const f = filtro.trim();
  const cols = opts?.completo ? "*" : COLUMNAS_LISTA;
  const where: string[] = ["empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (f) {
    where.push(
      `(nombre LIKE ? OR numero_empleado LIKE ? OR codigo LIKE ? OR dpi LIKE ?)`,
    );

    const like = `%${f}%`;

    params.push(like, like, like, like);
  }
  if (opts?.tipoContrato) {
    where.push(`LOWER(COALESCE(tipo_contrato,'')) = ?`);
    params.push(opts.tipoContrato.toLowerCase());
  }
  if (opts?.formaPago) {
    where.push(`LOWER(COALESCE(forma_pago,'')) = ?`);
    params.push(opts.formaPago.toLowerCase());
  }
  if (opts?.estado) {
    where.push(`estado = ?`);
    params.push(opts.estado);
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT ${cols} FROM empleados
     WHERE ${where.join(" AND ")}
     ORDER BY nombre`,
    params,
  );
  const empleados = rows.map(mapEmpleado);
  const conDocs = opts?.conDocs ?? !opts?.completo;
  if (conDocs) {
    try {
      const { contarDocumentosPorEmpleado } = await import("./documentos");
      const counts = await contarDocumentosPorEmpleado(
        empresaId,
        empleados.map((e) => e.id),
      );
      for (const e of empleados) e.docsCount = counts.get(e.id) ?? 0;
    } catch {
      for (const e of empleados) e.docsCount = 0;
    }
  }
  return empleados;
}

export async function obtenerEmpleado(
  empresaId: number,
  id: number,
): Promise<Empleado | null> {
  await asegurarSchemaEmpleados().catch(() => undefined);
  const rows = await query<RowDataPacket[]>(
    `SELECT e.*, sup.nombre AS supervisor_nombre
     FROM empleados e
     LEFT JOIN empleados sup ON sup.id = e.supervisor_id
     WHERE e.id = ? AND e.empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapEmpleado(rows[0]) : null;
}

export async function obtenerEmpleadoPorCodigo(
  empresaId: number,
  codigo: string,
): Promise<Empleado | null> {
  await asegurarSchemaEmpleados().catch(() => undefined);
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM empleados WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
    [empresaId, codigo.trim()],
  );
  return rows[0] ? mapEmpleado(rows[0]) : null;
}

export async function codigoDuplicado(
  empresaId: number,
  codigo: string,
  idExcluir?: number | null,
): Promise<boolean> {
  if (idExcluir != null) {
    const rows = await query<RowDataPacket[]>(
      `SELECT id FROM empleados
       WHERE empresa_id = ? AND codigo = ? AND id != ? LIMIT 1`,
      [empresaId, codigo.trim(), idExcluir],
    );
    return rows.length > 0;
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM empleados WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
    [empresaId, codigo.trim()],
  );
  return rows.length > 0;
}

/**
 * Valida que un supervisor propuesto sea utilizable: debe existir en la misma
 * empresa (aislamiento multiempresa) y no puede ser el propio empleado (evita
 * un caso trivial de referencia circular a sí mismo). No recorre la cadena
 * completa de supervisores; eso se deja para una validación futura si hace falta.
 */
export async function supervisorValido(
  empresaId: number,
  supervisorId: number,
  idPropio?: number | null,
): Promise<boolean> {
  if (idPropio != null && supervisorId === idPropio) return false;
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [supervisorId, empresaId],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Múltiples supervisores por empleado (tabla puente empleado_supervisores).
// empleados.supervisor_id se sigue escribiendo en paralelo (= primer
// supervisor de la lista, o NULL si no hay ninguno) como compatibilidad
// legado — ver paramsFicha(). No se modificó supervisorValido() (arriba):
// queda intacta para no romper ningún llamador existente; la validación
// múltiple vive en supervisoresValidos(), una función nueva y separada.
// ---------------------------------------------------------------------------

/**
 * Valida una lista de supervisores propuestos para un empleado: cada uno
 * debe existir, pertenecer a la misma empresa y estar Activo; ninguno puede
 * ser el propio empleado (`idPropio`). Duplicados en la lista de entrada se
 * ignoran (se deduplica antes de validar). Lista vacía es válida (sin
 * supervisores).
 */
export async function supervisoresValidos(
  empresaId: number,
  supervisorIds: number[],
  idPropio?: number | null,
): Promise<{ ok: true; ids: number[] } | { ok: false; mensaje: string }> {
  const unicos = Array.from(
    new Set(supervisorIds.filter((n) => Number.isInteger(n) && n > 0)),
  );
  if (idPropio != null && unicos.includes(idPropio)) {
    return {
      ok: false,
      mensaje: "Un empleado no puede ser su propio supervisor.",
    };
  }
  if (unicos.length === 0) return { ok: true, ids: [] };
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo' AND id IN (${unicos.map(() => "?").join(",")})`,
    [empresaId, ...unicos],
  );
  const validos = new Set(rows.map((r) => Number(r.id)));
  const invalidos = unicos.filter((id) => !validos.has(id));
  if (invalidos.length > 0) {
    return {
      ok: false,
      mensaje: `Supervisor(es) inválido(s), inactivo(s) o de otra empresa: ${invalidos.join(", ")}.`,
    };
  }
  return { ok: true, ids: unicos };
}

/**
 * Reemplaza todas las relaciones de supervisor de `empleadoId` en
 * empleado_supervisores por `supervisorIds` (ya validados por
 * supervisoresValidos). Recibe `conn`: participa en la MISMA transacción
 * que el INSERT/UPDATE de `empleados` en crearEmpleado/actualizarEmpleado
 * — no abre ninguna transacción propia. Así, si algo falla en cualquiera de
 * los dos pasos, el rollback deshace ambos (el empleado, su supervisor_id
 * legado, y las relaciones de la tabla puente) como una sola unidad.
 */
export async function sincronizarSupervisoresEmpleado(
  conn: PoolConnection,
  empresaId: number,
  empleadoId: number,
  supervisorIds: number[],
): Promise<void> {
  await conn.execute(
    `DELETE FROM empleado_supervisores WHERE empresa_id = ? AND empleado_id = ?`,
    [empresaId, empleadoId],
  );
  for (const supervisorId of supervisorIds) {
    await conn.execute(
      `INSERT INTO empleado_supervisores (empresa_id, empleado_id, supervisor_id)
       VALUES (?, ?, ?)`,
      [empresaId, empleadoId, supervisorId],
    );
  }
}

/** Supervisores actualmente asignados a un empleado (para cargar la ficha al editar). */
export async function listarSupervisoresDeEmpleado(
  empresaId: number,
  empleadoId: number,
): Promise<{ id: number; nombre: string; numeroEmpleado: string; codigo: string }[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT sup.id, sup.nombre, sup.numero_empleado, sup.codigo
     FROM empleado_supervisores es
     INNER JOIN empleados sup ON sup.id = es.supervisor_id AND sup.empresa_id = es.empresa_id
     WHERE es.empresa_id = ? AND es.empleado_id = ?
     ORDER BY sup.nombre`,
    [empresaId, empleadoId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nombre: str(r.nombre),
    numeroEmpleado: str(r.numero_empleado),
    codigo: str(r.codigo),
  }));
}

/** Lista simple (id, nombre) para poblar el selector de supervisor en la ficha. */
export async function listarEmpleadosParaSupervisor(
  empresaId: number,
  excluirId?: number | null,
): Promise<{ id: number; nombre: string }[]> {
  const where: string[] = ["empresa_id = ?", "estado = 'Activo'"];
  const params: (string | number)[] = [empresaId];
  if (excluirId != null) {
    where.push("id != ?");
    params.push(excluirId);
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre FROM empleados WHERE ${where.join(" AND ")} ORDER BY nombre`,
    params,
  );
  return rows.map((r) => ({ id: Number(r.id), nombre: str(r.nombre) }));
}

export type EmpleadoInput = {
  codigo: string;
  nombre?: string;
  puesto?: string;
  categoriaOps?: string;
  tipoHorario: "Fijo" | "Variable";
  fechaAlta: string;
  fechaInicioLaboral?: string | null;
  horaEntradaTeorica: string;
  horaSalidaTeorica: string;
  estado: "Activo" | "Baja";
  dpi?: string;
  nit?: string;
  igss?: string;
  irtra?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  sexo?: string;
  fechaNacimiento?: string | null;
  tipoContrato?: string;
  formaPago?: string;
  sueldoBase?: number | null;
  bonoIncentivo?: number | null;
  bonoHerramientas?: number | null;
  profesion?: string;
  primerNombre?: string;
  segundoNombre?: string;
  tercerNombre?: string;
  cuartoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  apellidoCasada?: string;
  paisOrigen?: string;
  municipio?: string;
  etnia?: string;
  religion?: string;
  idioma?: string;
  licenciaNumero?: string;
  licenciaTipo?: string;
  licenciaVence?: string | null;
  fechaEgreso?: string | null;
  observaciones?: string;
  cuentaBancaria?: string;
  tipoCuenta?: string;
  banco?: string;
  contactoEmergencia?: string;
  /**
   * Lista de supervisores (múltiples). Distingue explícitamente "campo
   * omitido" de "array vacío" — no son lo mismo:
   * - undefined (campo omitido, p.ej. una fila del importador Excel que no
   *   conoce este concepto): en crearEmpleado() se trata como sin
   *   supervisores; en actualizarEmpleado() significa "no tocar" — se
   *   preservan supervisor_id y las relaciones de empleado_supervisores tal
   *   como están.
   * - [] (array vacío explícito, p.ej. la ficha al quitar todos los
   *   supervisores): quita todas las relaciones, supervisor_id → NULL.
   * - [ids] (uno o varios): reemplaza la lista completa de relaciones,
   *   supervisor_id → primer elemento.
   * La ficha de RRHH siempre envía este campo (nunca omitido), así que para
   * ese flujo [] sigue significando "Sin supervisores" y [ids] reemplaza,
   * sin cambios de comportamiento.
   */
  supervisorIds?: number[];
  /** Fase H1: solo RRHH/admin la cambia, desde la edición de empleado. */
  horasExtraHabilitado?: boolean;
};

function paramsFicha(data: EmpleadoInput) {
  const nombre = componerNombre(data);
  return {
    nombre,
    cat: data.categoriaOps?.trim() || null,
    dpi: data.dpi?.trim() || null,
    nit: data.nit?.trim() || null,
    igss: data.igss?.trim() || null,
    irtra: data.irtra?.trim() || null,
    telefono: data.telefono?.trim() || null,
    email: data.email?.trim() || null,
    direccion: data.direccion?.trim() || null,
    sexo: data.sexo?.trim() || null,
    fechaNacimiento: data.fechaNacimiento || null,
    tipoContrato: data.tipoContrato?.trim() || "fijo",
    formaPago: data.formaPago?.trim() || "transferencia",
    sueldoBase: data.sueldoBase ?? null,
    bonoIncentivo: data.bonoIncentivo ?? null,
    bonoHerramientas: data.bonoHerramientas ?? null,
    profesion: data.profesion?.trim() || null,
    primerNombre: data.primerNombre?.trim() || null,
    segundoNombre: data.segundoNombre?.trim() || null,
    tercerNombre: data.tercerNombre?.trim() || null,
    cuartoNombre: data.cuartoNombre?.trim() || null,
    primerApellido: data.primerApellido?.trim() || null,
    segundoApellido: data.segundoApellido?.trim() || null,
    apellidoCasada: data.apellidoCasada?.trim() || null,
    paisOrigen: data.paisOrigen?.trim() || null,
    municipio: data.municipio?.trim() || null,
    etnia: data.etnia?.trim() || null,
    religion: data.religion?.trim() || null,
    idioma: data.idioma?.trim() || null,
    licenciaNumero: data.licenciaNumero?.trim() || null,
    licenciaTipo: data.licenciaTipo?.trim() || null,
    licenciaVence: data.licenciaVence || null,
    // Si se marca "Baja" sin indicar fecha, se autocompleta con hoy para no
    // perder el dato — necesario para reportes de bajas por mes (dashboard
    // gerencial). Si el usuario sí indicó una fecha (p.ej. baja retroactiva),
    // se respeta esa fecha y no se sobrescribe.
    fechaEgreso:
      data.fechaEgreso || (data.estado === "Baja" ? hoyLocal() : null),
    observaciones: data.observaciones?.trim() || null,
    cuentaBancaria: data.cuentaBancaria?.trim() || null,
    tipoCuenta: data.tipoCuenta?.trim() || null,
    banco: data.banco?.trim() || null,
    contactoEmergencia: data.contactoEmergencia?.trim() || null,
    // Compat legado: primer supervisor de la lista, o null si no hay
    // ninguno. Única fuente de esta derivación en todo el módulo.
    supervisorId:
      data.supervisorIds && data.supervisorIds.length > 0
        ? data.supervisorIds[0]
        : null,
    horasExtraHabilitado: data.horasExtraHabilitado ? 1 : 0,
  };
}

export async function crearEmpleado(
  empresaId: number,
  data: EmpleadoInput,
): Promise<number> {
  await asegurarSchemaEmpleados().catch(() => undefined);

  const f = paramsFicha(data);

  if (!f.nombre) {
    throw new Error("El nombre del empleado es obligatorio.");
  }

  // Alta: todavía no existe el propio id, así que no hay auto-referencia
  // posible que validar (idPropio queda null). Alta también es el único
  // caso donde supervisorIds omitido (undefined) se trata igual que []
  // (nuevo empleado sin supervisores) — no hay nada previo que preservar.
  const supervisores = await supervisoresValidos(
    empresaId,
    data.supervisorIds ?? [],
    null,
  );
  if (!supervisores.ok) {
    throw new Error(supervisores.mensaje);
  }

  // Alta, numeración y sincronización de supervisores ocurren en UNA sola
  // transacción: si cualquier paso falla (incluida la tabla puente), se
  // revierte todo — nunca queda un empleado a medio guardar ni un
  // supervisor_id legado desincronizado de empleado_supervisores.
  const conn = await getPool().getConnection();
  let empleadoId: number;
  try {
    await conn.beginTransaction();

    // schemaCompleto=false solo si el motivo del fallo del INSERT completo
    // fue específicamente una columna inexistente (ver esColumnaDesconocida)
    // — en ese caso se degrada a un alta mínima y se omite la
    // sincronización de supervisores (la tabla puente tampoco existiría
    // todavía). Cualquier otro error se relanza y aborta la transacción.
    let schemaCompleto = true;
    try {
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO empleados (
          empresa_id, codigo, nombre, puesto, categoria_ops, tipo_horario,
          fecha_alta, fecha_inicio_laboral, hora_entrada_teorica, hora_salida_teorica, estado,
          dpi, nit, igss, irtra, telefono, email, direccion, sexo, fecha_nacimiento,
          tipo_contrato, forma_pago, sueldo_base, bono_incentivo, bono_herramientas, profesion,
          primer_nombre, segundo_nombre, tercer_nombre, cuarto_nombre,
          primer_apellido, segundo_apellido, apellido_casada,
          pais_origen, municipio, etnia, religion, idioma,
          licencia_numero, licencia_tipo, licencia_vence, fecha_egreso, observaciones,
          cuenta_bancaria, tipo_cuenta, banco, contacto_emergencia, supervisor_id
        ) VALUES (
          ?,?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,
          ?,?,?,?,?,?,?,
          ?,?,?,?,?,
          ?,?,?,?,?,
          ?,?,?,?,?
        )`,
        [
          empresaId,
          data.codigo.trim(),
          f.nombre,
          data.puesto ?? "",
          f.cat,
          data.tipoHorario,
          data.fechaAlta,
          data.fechaInicioLaboral ?? null,
          data.horaEntradaTeorica,
          data.horaSalidaTeorica,
          data.estado,
          f.dpi,
          f.nit,
          f.igss,
          f.irtra,
          f.telefono,
          f.email,
          f.direccion,
          f.sexo,
          f.fechaNacimiento,
          f.tipoContrato,
          f.formaPago,
          f.sueldoBase,
          f.bonoIncentivo,
          f.bonoHerramientas,
          f.profesion,
          f.primerNombre,
          f.segundoNombre,
          f.tercerNombre,
          f.cuartoNombre,
          f.primerApellido,
          f.segundoApellido,
          f.apellidoCasada,
          f.paisOrigen,
          f.municipio,
          f.etnia,
          f.religion,
          f.idioma,
          f.licenciaNumero,
          f.licenciaTipo,
          f.licenciaVence,
          f.fechaEgreso,
          f.observaciones,
          f.cuentaBancaria,
          f.tipoCuenta,
          f.banco,
          f.contactoEmergencia,
          f.supervisorId,
        ],
      );
      empleadoId = Number(result.insertId);
    } catch (e) {
      if (!esColumnaDesconocida(e)) throw e;
      schemaCompleto = false;
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO empleados (
          empresa_id, codigo, nombre, puesto, categoria_ops, tipo_horario,
          fecha_alta, fecha_inicio_laboral, hora_entrada_teorica, hora_salida_teorica, estado
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empresaId,
          data.codigo.trim(),
          f.nombre,
          data.puesto ?? "",
          f.cat,
          data.tipoHorario,
          data.fechaAlta,
          data.fechaInicioLaboral ?? null,
          data.horaEntradaTeorica,
          data.horaSalidaTeorica,
          data.estado,
        ],
      );
      empleadoId = Number(result.insertId);
    }

    await conn.execute(
      `UPDATE empleados
       SET numero_empleado = LPAD(id, 6, '0')
       WHERE id = ?
         AND (
           numero_empleado IS NULL
           OR numero_empleado = ''
         )`,
      [empleadoId],
    );

    if (schemaCompleto) {
      await sincronizarSupervisoresEmpleado(conn, empresaId, empleadoId, supervisores.ids);
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  return empleadoId;
}

export async function actualizarEmpleado(
  empresaId: number,
  id: number,
  data: EmpleadoInput,
): Promise<boolean> {
  await asegurarSchemaEmpleados().catch(() => undefined);
  const f = paramsFicha(data);
  if (!f.nombre) throw new Error("El nombre del empleado es obligatorio.");

  // undefined (campo omitido, p.ej. reimportación Excel) = "no tocar
  // relaciones de supervisor": ni supervisor_id legado ni
  // empleado_supervisores se modifican, se preservan tal como están. Solo
  // se valida/sincroniza cuando el campo SÍ viene presente ([] incluido —
  // eso sí significa "quitar todos", explícitamente).
  const tocaSupervisores = data.supervisorIds !== undefined;
  let supervisorIdsNuevos: number[] | undefined;
  if (tocaSupervisores) {
    const validados = await supervisoresValidos(
      empresaId,
      data.supervisorIds ?? [],
      id,
    );
    if (!validados.ok) {
      throw new Error(validados.mensaje);
    }
    supervisorIdsNuevos = validados.ids;
  }

  // Misma razón que en crearEmpleado: UPDATE de empleados + numero_empleado
  // (no aplica aquí) + sincronización de supervisores en UNA transacción.
  const conn = await getPool().getConnection();
  let affectedRows: number;
  try {
    await conn.beginTransaction();

    // Si no se debe tocar el supervisor (campo omitido), se conserva el
    // valor actual de la columna leyéndolo dentro de la MISMA transacción
    // y reescribiéndolo tal cual — el resultado neto es "no modificar",
    // sin tener que mantener una segunda variante del UPDATE sin esa
    // columna.
    let supervisorIdParaGuardar: number | null;
    if (tocaSupervisores) {
      supervisorIdParaGuardar =
        supervisorIdsNuevos && supervisorIdsNuevos.length > 0
          ? supervisorIdsNuevos[0]
          : null;
    } else {
      // defensivo: si esta base todavía no tiene la columna supervisor_id
      // (esColumnaDesconocida), no hay nada que preservar — se sigue de
      // largo y el INSERT/UPDATE completo de abajo fallará por el mismo
      // motivo y degradará a la variante mínima como ya hacía antes.
      let actualRows: RowDataPacket[] = [];
      try {
        [actualRows] = await conn.query<RowDataPacket[]>(
          `SELECT supervisor_id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1`,
          [id, empresaId],
        );
      } catch (e) {
        if (!esColumnaDesconocida(e)) throw e;
      }
      supervisorIdParaGuardar =
        actualRows[0]?.supervisor_id != null
          ? Number(actualRows[0].supervisor_id)
          : null;
    }

    let schemaCompleto = true;
    try {
      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE empleados SET
          codigo=?, nombre=?, puesto=?, categoria_ops=?, tipo_horario=?,
          fecha_alta=?, fecha_inicio_laboral=?,
          hora_entrada_teorica=?, hora_salida_teorica=?, estado=?,
          dpi=?, nit=?, igss=?, irtra=?, telefono=?, email=?, direccion=?, sexo=?, fecha_nacimiento=?,
          tipo_contrato=?, forma_pago=?, sueldo_base=?, bono_incentivo=?, bono_herramientas=?, profesion=?,
          primer_nombre=?, segundo_nombre=?, tercer_nombre=?, cuarto_nombre=?,
          primer_apellido=?, segundo_apellido=?, apellido_casada=?,
          pais_origen=?, municipio=?, etnia=?, religion=?, idioma=?,
          licencia_numero=?, licencia_tipo=?, licencia_vence=?, fecha_egreso=?, observaciones=?,
          cuenta_bancaria=?, tipo_cuenta=?, banco=?, contacto_emergencia=?, supervisor_id=?,
          horas_extra_habilitado=?
         WHERE id=? AND empresa_id=?`,
        [
          data.codigo.trim(),
          f.nombre,
          data.puesto ?? "",
          f.cat,
          data.tipoHorario,
          data.fechaAlta,
          data.fechaInicioLaboral ?? null,
          data.horaEntradaTeorica,
          data.horaSalidaTeorica,
          data.estado,
          f.dpi,
          f.nit,
          f.igss,
          f.irtra,
          f.telefono,
          f.email,
          f.direccion,
          f.sexo,
          f.fechaNacimiento,
          f.tipoContrato,
          f.formaPago,
          f.sueldoBase,
          f.bonoIncentivo,
          f.bonoHerramientas,
          f.profesion,
          f.primerNombre,
          f.segundoNombre,
          f.tercerNombre,
          f.cuartoNombre,
          f.primerApellido,
          f.segundoApellido,
          f.apellidoCasada,
          f.paisOrigen,
          f.municipio,
          f.etnia,
          f.religion,
          f.idioma,
          f.licenciaNumero,
          f.licenciaTipo,
          f.licenciaVence,
          f.fechaEgreso,
          f.observaciones,
          f.cuentaBancaria,
          f.tipoCuenta,
          f.banco,
          f.contactoEmergencia,
          supervisorIdParaGuardar,
          f.horasExtraHabilitado,
          id,
          empresaId,
        ],
      );
      affectedRows = result.affectedRows;
    } catch (e) {
      if (!esColumnaDesconocida(e)) throw e;
      schemaCompleto = false;
      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE empleados SET
          codigo=?, nombre=?, puesto=?, categoria_ops=?, tipo_horario=?,
          fecha_alta=?, fecha_inicio_laboral=?,
          hora_entrada_teorica=?, hora_salida_teorica=?, estado=?
         WHERE id=? AND empresa_id=?`,
        [
          data.codigo.trim(),
          f.nombre,
          data.puesto ?? "",
          f.cat,
          data.tipoHorario,
          data.fechaAlta,
          data.fechaInicioLaboral ?? null,
          data.horaEntradaTeorica,
          data.horaSalidaTeorica,
          data.estado,
          id,
          empresaId,
        ],
      );
      affectedRows = result.affectedRows;
    }

    if (affectedRows > 0 && schemaCompleto && supervisorIdsNuevos !== undefined) {
      await sincronizarSupervisoresEmpleado(conn, empresaId, id, supervisorIdsNuevos);
    }

    // Una baja conserva el expediente histórico, pero revoca inmediatamente
    // el acceso del colaborador al portal dentro de la misma transacción.
    if (affectedRows > 0 && data.estado === "Baja") {
      await conn.execute(
        `UPDATE colaborador_credenciales cc
         INNER JOIN empleados e ON e.id = cc.empleado_id
         SET cc.activo = 0
         WHERE cc.empleado_id = ? AND e.empresa_id = ?`,
        [id, empresaId],
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return affectedRows > 0;
}

export { CATEGORIAS_OPS, PUESTOS_MONACO } from "./categorias-ops";
