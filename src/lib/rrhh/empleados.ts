import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { toIsoDate } from "./dates";
import { asegurarSchemaEmpleados } from "./empleados-schema";

export type Empleado = {
  id: number;
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
};

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  };
}

/** Columnas de planilla / combos (sin sueldos, observaciones, demografía…). */
const COLUMNAS_LISTA = `id, codigo, nombre, puesto, categoria_ops, tipo_horario,
  fecha_alta, fecha_inicio_laboral, hora_entrada_teorica, hora_salida_teorica,
  estado, dpi`;

export async function listarEmpleados(
  empresaId: number,
  filtro = "",
  opts?: { completo?: boolean; conDocs?: boolean },
): Promise<Empleado[]> {
  await asegurarSchemaEmpleados().catch(() => undefined);
  const f = filtro.trim();
  const cols = opts?.completo ? "*" : COLUMNAS_LISTA;
  const rows = f
    ? await query<RowDataPacket[]>(
        `SELECT ${cols} FROM empleados
         WHERE empresa_id = ? AND (nombre LIKE ? OR codigo LIKE ? OR dpi LIKE ?)
         ORDER BY nombre`,
        [empresaId, `%${f}%`, `%${f}%`, `%${f}%`],
      )
    : await query<RowDataPacket[]>(
        `SELECT ${cols} FROM empleados WHERE empresa_id = ? ORDER BY nombre`,
        [empresaId],
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
    `SELECT * FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1`,
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
    fechaEgreso: data.fechaEgreso || null,
    observaciones: data.observaciones?.trim() || null,
    cuentaBancaria: data.cuentaBancaria?.trim() || null,
    tipoCuenta: data.tipoCuenta?.trim() || null,
    banco: data.banco?.trim() || null,
    contactoEmergencia: data.contactoEmergencia?.trim() || null,
  };
}

export async function crearEmpleado(
  empresaId: number,
  data: EmpleadoInput,
): Promise<number> {
  await asegurarSchemaEmpleados().catch(() => undefined);
  const f = paramsFicha(data);
  if (!f.nombre) throw new Error("El nombre del empleado es obligatorio.");
  try {
    const result = await execute(
      `INSERT INTO empleados (
        empresa_id, codigo, nombre, puesto, categoria_ops, tipo_horario,
        fecha_alta, fecha_inicio_laboral, hora_entrada_teorica, hora_salida_teorica, estado,
        dpi, nit, igss, irtra, telefono, email, direccion, sexo, fecha_nacimiento,
        tipo_contrato, forma_pago, sueldo_base, bono_incentivo, bono_herramientas, profesion,
        primer_nombre, segundo_nombre, tercer_nombre, cuarto_nombre,
        primer_apellido, segundo_apellido, apellido_casada,
        pais_origen, municipio, etnia, religion, idioma,
        licencia_numero, licencia_tipo, licencia_vence, fecha_egreso, observaciones,
        cuenta_bancaria, tipo_cuenta, banco, contacto_emergencia
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,
        ?,?,?,?,?,?,?,
        ?,?,?,?,?,
        ?,?,?,?,?,
        ?,?,?,?
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
      ],
    );
    return Number((result as ResultSetHeader).insertId);
  } catch {
    const result = await execute(
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
    return Number((result as ResultSetHeader).insertId);
  }
}

export async function actualizarEmpleado(
  empresaId: number,
  id: number,
  data: EmpleadoInput,
): Promise<boolean> {
  await asegurarSchemaEmpleados().catch(() => undefined);
  const f = paramsFicha(data);
  if (!f.nombre) throw new Error("El nombre del empleado es obligatorio.");
  try {
    const result = await execute(
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
        cuenta_bancaria=?, tipo_cuenta=?, banco=?, contacto_emergencia=?
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
        id,
        empresaId,
      ],
    );
    return result.affectedRows > 0;
  } catch {
    const result = await execute(
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
    return result.affectedRows > 0;
  }
}

export async function eliminarEmpleado(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const emp = await obtenerEmpleado(empresaId, id);
  if (!emp) return { ok: false, mensaje: "Empleado no encontrado." };
  const result = await execute(
    "DELETE FROM empleados WHERE id = ? AND empresa_id = ?",
    [id, empresaId],
  );
  if (result.affectedRows === 0) {
    return { ok: false, mensaje: "No se pudo eliminar." };
  }
  return {
    ok: true,
    mensaje: `Empleado '${emp.nombre}' eliminado.`,
  };
}

export { CATEGORIAS_OPS } from "./categorias-ops";
