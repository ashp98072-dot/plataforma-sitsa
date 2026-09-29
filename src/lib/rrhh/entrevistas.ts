import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { componerNombreCompleto, type PartesNombreCompleto } from "./nombre-completo";
import { permisosEfectivos, tienePermiso } from "@/lib/permisos";
import type { RolGlobal } from "@/lib/roles";

export type EstadoEntrevista =
  | "Programada"
  | "Realizada"
  | "Cancelada"
  | "No asistió";
export type ResultadoEntrevista = "Pendiente" | "Aprobado" | "Rechazado";
export type ModalidadEntrevista = "Presencial" | "Virtual";

/**
 * RRHH-ENTREVISTAS-IDENTIDAD-1 — identidad estructurada del candidato, opcional (entrevistas históricas la tienen en
 * NULL). `candidatoNombre` sigue siendo el nombre completo persistido/derivado — nunca se elimina, se usa en
 * calendario, listados, portal, expediente, documentos e historial. Ver src/lib/rrhh/nombre-completo.ts.
 */
export type Entrevista = {
  id: number;
  empresaId: number;
  candidatoNombre: string;
  candidatoPrimerNombre: string | null;
  candidatoSegundoNombre: string | null;
  candidatoTercerNombre: string | null;
  candidatoCuartoNombre: string | null;
  candidatoPrimerApellido: string | null;
  candidatoSegundoApellido: string | null;
  candidatoApellidoCasada: string | null;
  candidatoTelefono: string | null;
  candidatoEmail: string | null;
  puesto: string;
  /** ISO completo "YYYY-MM-DDTHH:mm:ss" en hora local del servidor. */
  fechaHora: string;
  /** Histórico (RRHH-ENTREVISTAS-1). Se conserva para compatibilidad — ver ATRACCION-TALENTO-2. */
  entrevistadorEmpleadoId: number | null;
  entrevistadorNombre?: string;
  /**
   * ATRACCION-TALENTO-2 — el entrevistador principal AHORA es un usuario del
   * sistema (no obligatoriamente un empleado). Precedencia de visualización:
   * entrevistadorUsuarioId > entrevistadorEmpleadoId (histórico) > ninguno —
   * ver resolverEntrevistadorMostrado().
   */
  entrevistadorUsuarioId: number | null;
  entrevistadorUsuarioNombre?: string;
  /** Auxiliar de entrevista (opcional), también un usuario. Sin equivalente histórico. */
  auxiliarUsuarioId: number | null;
  auxiliarUsuarioNombre?: string;
  modalidad: ModalidadEntrevista;
  lugarOEnlace: string | null;
  estado: EstadoEntrevista;
  resultado: ResultadoEntrevista;
  notas: string | null;
  creadoPor: string | null;
  creadoEn: string;
};

const ESTADOS_VALIDOS = new Set<EstadoEntrevista>([
  "Programada",
  "Realizada",
  "Cancelada",
  "No asistió",
]);
const RESULTADOS_VALIDOS = new Set<ResultadoEntrevista>([
  "Pendiente",
  "Aprobado",
  "Rechazado",
]);

/** ATRACCION-TALENTO-2 — nombre visible de un usuario: nombre.trim() o fallback a username. */
function nombreVisibleUsuario(nombre: unknown, username: unknown): string {
  const n = nombre != null ? String(nombre).trim() : "";
  return n || String(username);
}

function mapEntrevista(r: RowDataPacket): Entrevista {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    candidatoNombre: String(r.candidato_nombre),
    candidatoPrimerNombre: r.candidato_primer_nombre ? String(r.candidato_primer_nombre) : null,
    candidatoSegundoNombre: r.candidato_segundo_nombre ? String(r.candidato_segundo_nombre) : null,
    candidatoTercerNombre: r.candidato_tercer_nombre ? String(r.candidato_tercer_nombre) : null,
    candidatoCuartoNombre: r.candidato_cuarto_nombre ? String(r.candidato_cuarto_nombre) : null,
    candidatoPrimerApellido: r.candidato_primer_apellido ? String(r.candidato_primer_apellido) : null,
    candidatoSegundoApellido: r.candidato_segundo_apellido ? String(r.candidato_segundo_apellido) : null,
    candidatoApellidoCasada: r.candidato_apellido_casada ? String(r.candidato_apellido_casada) : null,
    candidatoTelefono: r.candidato_telefono ? String(r.candidato_telefono) : null,
    candidatoEmail: r.candidato_email ? String(r.candidato_email) : null,
    puesto: String(r.puesto),
    fechaHora: String(r.fecha_hora_iso ?? r.fecha_hora)
      .slice(0, 19)
      .replace(" ", "T"),
    entrevistadorEmpleadoId:
      r.entrevistador_empleado_id != null
        ? Number(r.entrevistador_empleado_id)
        : null,
    entrevistadorNombre: r.entrevistador_nombre
      ? String(r.entrevistador_nombre)
      : undefined,
    entrevistadorUsuarioId:
      r.entrevistador_usuario_id != null
        ? Number(r.entrevistador_usuario_id)
        : null,
    entrevistadorUsuarioNombre: r.entrevistador_usuario_username
      ? nombreVisibleUsuario(r.entrevistador_usuario_nombre, r.entrevistador_usuario_username)
      : undefined,
    auxiliarUsuarioId:
      r.auxiliar_usuario_id != null ? Number(r.auxiliar_usuario_id) : null,
    auxiliarUsuarioNombre: r.auxiliar_usuario_username
      ? nombreVisibleUsuario(r.auxiliar_usuario_nombre, r.auxiliar_usuario_username)
      : undefined,
    modalidad: (String(r.modalidad) as ModalidadEntrevista) || "Presencial",
    lugarOEnlace: r.lugar_o_enlace ? String(r.lugar_o_enlace) : null,
    estado: String(r.estado) as EstadoEntrevista,
    resultado: String(r.resultado ?? "Pendiente") as ResultadoEntrevista,
    notas: r.notas ? String(r.notas) : null,
    creadoPor: r.creado_por ? String(r.creado_por) : null,
    creadoEn: String(r.creado_en),
  };
}

/**
 * ATRACCION-TALENTO-2 — dos JOIN adicionales contra `usuarios` (entrevistador
 * principal y auxiliar), SIN filtrar por `activo`: si el usuario luego se
 * desactiva, la entrevista histórica debe seguir mostrando su nombre (punto
 * 28 del ticket). El catálogo para NUEVAS asignaciones sí filtra activos —
 * ver listarUsuariosEntrevistadores().
 */
const SELECT_BASE = `
  SELECT ent.*,
         DATE_FORMAT(ent.fecha_hora, '%Y-%m-%dT%H:%i:%s') AS fecha_hora_iso,
         e.nombre AS entrevistador_nombre,
         ue.nombre AS entrevistador_usuario_nombre, ue.username AS entrevistador_usuario_username,
         ua.nombre AS auxiliar_usuario_nombre, ua.username AS auxiliar_usuario_username
  FROM entrevistas ent
  LEFT JOIN empleados e
    ON e.id = ent.entrevistador_empleado_id AND e.empresa_id = ent.empresa_id
  LEFT JOIN usuarios ue ON ue.id = ent.entrevistador_usuario_id
  LEFT JOIN usuarios ua ON ua.id = ent.auxiliar_usuario_id
`;


/** Obtiene una entrevista aislada por empresa para reutilizar sus datos en el alta. */
export async function obtenerEntrevista(
  empresaId: number,
  id: number,
): Promise<Entrevista | null> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT_BASE}
     WHERE ent.empresa_id = ? AND ent.id = ?
     LIMIT 1`,
    [empresaId, id],
  );
  return rows[0] ? mapEntrevista(rows[0]) : null;
}

/** Todas las entrevistas de un mes calendario (para el calendario de RRHH). */
export async function listarEntrevistasPorMes(
  empresaId: number,
  anio: number,
  mes: number, // 1-12
): Promise<Entrevista[]> {
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01 00:00:00`;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = `${anio}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")} 23:59:59`;
  const rows = await query<RowDataPacket[]>(
    `${SELECT_BASE}
     WHERE ent.empresa_id = ? AND ent.fecha_hora BETWEEN ? AND ?
     ORDER BY ent.fecha_hora`,
    [empresaId, desde, hasta],
  );
  return rows.map(mapEntrevista);
}

/** Entrevistas asignadas a UN entrevistador (portal del supervisor). */
export async function listarEntrevistasPorEntrevistador(
  empresaId: number,
  empleadoId: number,
  opts?: { soloProximas?: boolean },
): Promise<Entrevista[]> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT_BASE}
     WHERE ent.empresa_id = ? AND ent.entrevistador_empleado_id = ?
       ${opts?.soloProximas ? "AND ent.fecha_hora >= NOW() AND ent.estado = 'Programada'" : ""}
     ORDER BY ent.fecha_hora ${opts?.soloProximas ? "ASC" : "DESC"}
     LIMIT 100`,
    [empresaId, empleadoId],
  );
  return rows.map(mapEntrevista);
}

/**
 * RRHH-ENTREVISTAS-IDENTIDAD-1 — para una entrevista NUEVA, primer nombre y primer apellido son obligatorios
 * (backend valida, nunca depende solo del frontend); el resto de la identidad es opcional. `candidato_nombre` se
 * RECOMPONE aquí desde las partes — nunca se confía en un nombre completo enviado por el cliente.
 */
export async function crearEntrevista(input: {
  empresaId: number;
  candidatoPrimerNombre: string;
  candidatoSegundoNombre?: string | null;
  candidatoTercerNombre?: string | null;
  candidatoCuartoNombre?: string | null;
  candidatoPrimerApellido: string;
  candidatoSegundoApellido?: string | null;
  candidatoApellidoCasada?: string | null;
  candidatoTelefono?: string | null;
  candidatoEmail?: string | null;
  puesto: string;
  fechaHora: string; // "YYYY-MM-DDTHH:mm"
  // ATRACCION-TALENTO-2 (corrección pre-SQL) — una entrevista NUEVA nunca usa el modelo histórico de empleado:
  // deliberadamente esta función NO acepta entrevistadorEmpleadoId (el INSERT siempre lo deja NULL). Solo
  // actualizarEntrevista() puede leer/preservar ese campo para entrevistas YA existentes creadas antes de este ticket.
  entrevistadorUsuarioId?: number | null;
  auxiliarUsuarioId?: number | null;
  modalidad?: ModalidadEntrevista;
  lugarOEnlace?: string | null;
  notas?: string | null;
  creadoPor: string;
}): Promise<{ ok: boolean; mensaje: string; id?: number }> {
  const partes: PartesNombreCompleto = {
    primerNombre: input.candidatoPrimerNombre ?? "",
    segundoNombre: input.candidatoSegundoNombre ?? "",
    tercerNombre: input.candidatoTercerNombre ?? "",
    cuartoNombre: input.candidatoCuartoNombre ?? "",
    primerApellido: input.candidatoPrimerApellido ?? "",
    segundoApellido: input.candidatoSegundoApellido ?? "",
    apellidoCasada: input.candidatoApellidoCasada ?? "",
  };
  const puesto = input.puesto.trim();
  if (!partes.primerNombre.trim() || !partes.primerApellido.trim() || !puesto) {
    return { ok: false, mensaje: "Primer nombre, primer apellido y puesto son obligatorios." };
  }
  if (!input.fechaHora || Number.isNaN(Date.parse(input.fechaHora))) {
    return { ok: false, mensaje: "Fecha y hora inválidas." };
  }

  // ATRACCION-TALENTO-2 (secciones 6-7, 26) — el backend SIEMPRE valida, nunca confía en los IDs que manda el
  // navegador: cada usuario debe existir, estar activo, tener acceso a esta empresa y ser elegible para entrevistas
  // (mismo catálogo que expone /rrhh/entrevistas/usuarios). El auxiliar nunca puede ser el mismo usuario que el
  // entrevistador principal.
  if (input.entrevistadorUsuarioId && input.auxiliarUsuarioId && input.entrevistadorUsuarioId === input.auxiliarUsuarioId) {
    return { ok: false, mensaje: "El auxiliar no puede ser el mismo usuario que el entrevistador principal." };
  }
  if (input.entrevistadorUsuarioId && !(await esUsuarioElegibleEntrevista(input.empresaId, input.entrevistadorUsuarioId))) {
    return { ok: false, mensaje: "El entrevistador principal no es un usuario elegible de esta empresa." };
  }
  if (input.auxiliarUsuarioId && !(await esUsuarioElegibleEntrevista(input.empresaId, input.auxiliarUsuarioId))) {
    return { ok: false, mensaje: "El auxiliar no es un usuario elegible de esta empresa." };
  }

  const nombreCompleto = componerNombreCompleto(partes);
  const soloVacio = (v: string) => v.trim() || null;
  const result = await execute(
    `INSERT INTO entrevistas
      (empresa_id, candidato_nombre, candidato_primer_nombre, candidato_segundo_nombre, candidato_tercer_nombre,
       candidato_cuarto_nombre, candidato_primer_apellido, candidato_segundo_apellido, candidato_apellido_casada,
       candidato_telefono, candidato_email, puesto,
       fecha_hora, entrevistador_empleado_id, entrevistador_usuario_id, auxiliar_usuario_id,
       modalidad, lugar_o_enlace, notas, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.empresaId,
      nombreCompleto,
      soloVacio(partes.primerNombre), soloVacio(partes.segundoNombre), soloVacio(partes.tercerNombre), soloVacio(partes.cuartoNombre),
      soloVacio(partes.primerApellido), soloVacio(partes.segundoApellido), soloVacio(partes.apellidoCasada),
      input.candidatoTelefono?.trim() || null,
      input.candidatoEmail?.trim() || null,
      puesto,
      input.fechaHora.replace("T", " "),
      null, // entrevistador_empleado_id — SIEMPRE NULL en altas nuevas; el modelo histórico de empleado no se acepta al crear.
      input.entrevistadorUsuarioId || null,
      input.auxiliarUsuarioId || null,
      input.modalidad ?? "Presencial",
      input.lugarOEnlace?.trim() || null,
      input.notas?.trim() || null,
      input.creadoPor,
    ],
  );
  return {
    ok: true,
    mensaje: "Entrevista programada.",
    id: Number((result as ResultSetHeader).insertId),
  };
}

/**
 * Actualiza campos de la entrevista. Usado tanto por RRHH (reprogramar,
 * reasignar entrevistador, cancelar) como por el entrevistador desde el
 * portal (marcar estado/resultado/notas después de realizarla) — el
 * caller decide qué campos permite tocar cada uno, esta función no
 * distingue el origen.
 */
/**
 * RRHH-ENTREVISTAS-IDENTIDAD-1 (punto 13) — antes NO permitía editar candidatoNombre/candidatoTelefono/
 * candidatoEmail/puesto aunque el formulario los mostraba como editables (causa raíz de "no deja editar"). Ahora sí:
 * nombres/apellidos separados, teléfono, email y puesto son editables. Cuando se toca CUALQUIER parte de la
 * identidad, `candidato_nombre` se RECOMPONE server-side a partir de las partes ya guardadas fusionadas con las que
 * llegan en el patch — nunca se confía en un nombre completo enviado por el cliente. Si el patch no toca identidad,
 * `candidato_nombre` (histórico o ya estructurado) queda intacto.
 */
export async function actualizarEntrevista(
  empresaId: number,
  id: number,
  patch: {
    candidatoPrimerNombre?: string;
    candidatoSegundoNombre?: string | null;
    candidatoTercerNombre?: string | null;
    candidatoCuartoNombre?: string | null;
    candidatoPrimerApellido?: string;
    candidatoSegundoApellido?: string | null;
    candidatoApellidoCasada?: string | null;
    candidatoTelefono?: string | null;
    candidatoEmail?: string | null;
    puesto?: string;
    fechaHora?: string;
    entrevistadorEmpleadoId?: number | null;
    entrevistadorUsuarioId?: number | null;
    auxiliarUsuarioId?: number | null;
    modalidad?: ModalidadEntrevista;
    lugarOEnlace?: string | null;
    estado?: EstadoEntrevista;
    resultado?: ResultadoEntrevista;
    notas?: string | null;
  },
): Promise<{ ok: boolean; mensaje: string }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT candidato_primer_nombre, candidato_segundo_nombre, candidato_tercer_nombre, candidato_cuarto_nombre,
            candidato_primer_apellido, candidato_segundo_apellido, candidato_apellido_casada, candidato_nombre,
            entrevistador_usuario_id, auxiliar_usuario_id
     FROM entrevistas WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  const actual = rows[0];
  if (!actual) return { ok: false, mensaje: "Entrevista no encontrada." };

  if (patch.estado && !ESTADOS_VALIDOS.has(patch.estado)) {
    return { ok: false, mensaje: "Estado inválido." };
  }
  if (patch.resultado && !RESULTADOS_VALIDOS.has(patch.resultado)) {
    return { ok: false, mensaje: "Resultado inválido." };
  }
  if (patch.puesto !== undefined && !patch.puesto.trim()) {
    return { ok: false, mensaje: "El puesto no puede quedar vacío." };
  }
  const IDENT_KEYS = [
    "candidatoPrimerNombre", "candidatoSegundoNombre", "candidatoTercerNombre", "candidatoCuartoNombre",
    "candidatoPrimerApellido", "candidatoSegundoApellido", "candidatoApellidoCasada",
  ] as const;
  const tocaIdentidad = IDENT_KEYS.some((k) => patch[k] !== undefined);
  if (tocaIdentidad) {
    // Primer nombre/apellido nunca pueden quedar vacíos una vez que se edita la identidad (mismo mínimo que al crear).
    const primerNombre = patch.candidatoPrimerNombre !== undefined ? patch.candidatoPrimerNombre : (actual.candidato_primer_nombre ?? "");
    const primerApellido = patch.candidatoPrimerApellido !== undefined ? patch.candidatoPrimerApellido : (actual.candidato_primer_apellido ?? "");
    if (!String(primerNombre).trim() || !String(primerApellido).trim()) {
      return { ok: false, mensaje: "Primer nombre y primer apellido son obligatorios." };
    }
  }

  // ATRACCION-TALENTO-2 (secciones 6-7, 26) — valida contra los valores EFECTIVOS resultantes (lo que llega en el
  // patch, o si no se toca, lo que ya estaba guardado) para que un PATCH que solo cambia uno de los dos igual detecte
  // que quedarían iguales al otro ya existente. Backend nunca confía en los IDs del cliente.
  const entrevistadorUsuarioIdEfectivo =
    patch.entrevistadorUsuarioId !== undefined
      ? patch.entrevistadorUsuarioId
      : actual.entrevistador_usuario_id != null ? Number(actual.entrevistador_usuario_id) : null;
  const auxiliarUsuarioIdEfectivo =
    patch.auxiliarUsuarioId !== undefined
      ? patch.auxiliarUsuarioId
      : actual.auxiliar_usuario_id != null ? Number(actual.auxiliar_usuario_id) : null;
  if (
    entrevistadorUsuarioIdEfectivo != null &&
    auxiliarUsuarioIdEfectivo != null &&
    entrevistadorUsuarioIdEfectivo === auxiliarUsuarioIdEfectivo
  ) {
    return { ok: false, mensaje: "El auxiliar no puede ser el mismo usuario que el entrevistador principal." };
  }
  if (patch.entrevistadorUsuarioId != null && !(await esUsuarioElegibleEntrevista(empresaId, patch.entrevistadorUsuarioId))) {
    return { ok: false, mensaje: "El entrevistador principal no es un usuario elegible de esta empresa." };
  }
  if (patch.auxiliarUsuarioId != null && !(await esUsuarioElegibleEntrevista(empresaId, patch.auxiliarUsuarioId))) {
    return { ok: false, mensaje: "El auxiliar no es un usuario elegible de esta empresa." };
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.fechaHora !== undefined) {
    sets.push("fecha_hora = ?");
    params.push(patch.fechaHora.replace("T", " "));
  }
  if (patch.entrevistadorUsuarioId !== undefined) {
    // ATRACCION-TALENTO-2 (sección 3) — cambiar explícitamente el entrevistador (ahora un usuario) limpia el
    // empleado histórico, salvo que el mismo PATCH también lo esté fijando explícitamente. Editar solo otros campos
    // (fecha, notas, resultado, etc.) nunca toca ninguno de los dos.
    sets.push("entrevistador_usuario_id = ?");
    params.push(patch.entrevistadorUsuarioId);
    if (patch.entrevistadorEmpleadoId === undefined) {
      sets.push("entrevistador_empleado_id = ?");
      params.push(null);
    }
  }
  if (patch.auxiliarUsuarioId !== undefined) {
    sets.push("auxiliar_usuario_id = ?");
    params.push(patch.auxiliarUsuarioId);
  }
  if (patch.entrevistadorEmpleadoId !== undefined) {
    sets.push("entrevistador_empleado_id = ?");
    params.push(patch.entrevistadorEmpleadoId);
  }
  if (patch.modalidad !== undefined) {
    sets.push("modalidad = ?");
    params.push(patch.modalidad);
  }
  if (patch.lugarOEnlace !== undefined) {
    sets.push("lugar_o_enlace = ?");
    params.push(patch.lugarOEnlace || null);
  }
  if (patch.estado !== undefined) {
    sets.push("estado = ?");
    params.push(patch.estado);
  }
  if (patch.resultado !== undefined) {
    sets.push("resultado = ?");
    params.push(patch.resultado);
  }
  if (patch.notas !== undefined) {
    sets.push("notas = ?");
    params.push(patch.notas || null);
  }
  if (patch.puesto !== undefined) {
    sets.push("puesto = ?");
    params.push(patch.puesto.trim());
  }
  if (patch.candidatoTelefono !== undefined) {
    sets.push("candidato_telefono = ?");
    params.push(patch.candidatoTelefono?.trim() || null);
  }
  if (patch.candidatoEmail !== undefined) {
    sets.push("candidato_email = ?");
    params.push(patch.candidatoEmail?.trim() || null);
  }
  if (tocaIdentidad) {
    const soloVacio = (v: string) => (v.trim() ? v.trim() : null);
    const partes: PartesNombreCompleto = {
      primerNombre: (patch.candidatoPrimerNombre !== undefined ? patch.candidatoPrimerNombre : (actual.candidato_primer_nombre ?? "")) as string,
      segundoNombre: (patch.candidatoSegundoNombre !== undefined ? patch.candidatoSegundoNombre : (actual.candidato_segundo_nombre ?? "")) as string,
      tercerNombre: (patch.candidatoTercerNombre !== undefined ? patch.candidatoTercerNombre : (actual.candidato_tercer_nombre ?? "")) as string,
      cuartoNombre: (patch.candidatoCuartoNombre !== undefined ? patch.candidatoCuartoNombre : (actual.candidato_cuarto_nombre ?? "")) as string,
      primerApellido: (patch.candidatoPrimerApellido !== undefined ? patch.candidatoPrimerApellido : (actual.candidato_primer_apellido ?? "")) as string,
      segundoApellido: (patch.candidatoSegundoApellido !== undefined ? patch.candidatoSegundoApellido : (actual.candidato_segundo_apellido ?? "")) as string,
      apellidoCasada: (patch.candidatoApellidoCasada !== undefined ? patch.candidatoApellidoCasada : (actual.candidato_apellido_casada ?? "")) as string,
    };
    sets.push("candidato_primer_nombre = ?", "candidato_segundo_nombre = ?", "candidato_tercer_nombre = ?", "candidato_cuarto_nombre = ?",
      "candidato_primer_apellido = ?", "candidato_segundo_apellido = ?", "candidato_apellido_casada = ?", "candidato_nombre = ?");
    params.push(
      soloVacio(partes.primerNombre), soloVacio(partes.segundoNombre), soloVacio(partes.tercerNombre), soloVacio(partes.cuartoNombre),
      soloVacio(partes.primerApellido), soloVacio(partes.segundoApellido), soloVacio(partes.apellidoCasada),
      componerNombreCompleto(partes) || String(actual.candidato_nombre),
    );
  }
  if (sets.length === 0) {
    return { ok: false, mensaje: "Nada que actualizar." };
  }

  params.push(id, empresaId);
  await execute(
    `UPDATE entrevistas SET ${sets.join(", ")} WHERE id = ? AND empresa_id = ?`,
    params,
  );
  return { ok: true, mensaje: "Entrevista actualizada." };
}

export type EntrevistadorOpt = { id: number; codigo: string; nombre: string };

/**
 * ATRACCION-TALENTO-1 (corrección post-revisión) — catálogo MÍNIMO de
 * empleados activos para el selector de entrevistador, usado tanto por
 * Entrevistas como por Reportes de Atracción. Deliberadamente una consulta
 * propia (NO reutiliza listarEmpleados/Empleado): expone únicamente
 * id/codigo/nombre — nunca sueldo, DPI, NIT, banco, cuenta, teléfono,
 * email ni ningún otro dato sensible del expediente. Tenant siempre por
 * empresaId (nunca confiado del cliente).
 */
export async function listarEntrevistadoresActivos(
  empresaId: number,
): Promise<EntrevistadorOpt[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo'
     ORDER BY nombre`,
    [empresaId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    codigo: String(r.codigo ?? ""),
    nombre: String(r.nombre),
  }));
}

export type UsuarioEntrevistaOpt = { id: number; nombre: string; username: string; rol: string };

/**
 * ATRACCION-TALENTO-2 (secciones 4-8) — catálogo de usuarios elegibles como
 * entrevistador principal/auxiliar: activos, con acceso real a la empresa
 * (usuario_empresa o acceso_todas_empresas) y con permiso efectivo
 * `entrevistas:ver` (Admin pasa siempre, igual que requireTenantRrhh — el
 * resto se resuelve con permisosEfectivos()/tienePermiso(), NUNCA asumiendo
 * que el rol RRHH por sí solo implica el permiso si fue revocado
 * explícitamente). Primero se acota a activos+acceso a la empresa (una sola
 * consulta) y solo sobre ESE conjunto se resuelve el permiso efectivo — no
 * se cargan ni se evalúan todos los usuarios del sistema.
 */
export async function listarUsuariosEntrevistadores(
  empresaId: number,
): Promise<UsuarioEntrevistaOpt[]> {
  const candidatos = await query<RowDataPacket[]>(
    `SELECT id, username, nombre, rol_global
     FROM usuarios
     WHERE activo = 1
       AND (acceso_todas_empresas = 1 OR EXISTS (
         SELECT 1 FROM usuario_empresa ue WHERE ue.usuario_id = usuarios.id AND ue.empresa_id = ?
       ))
     ORDER BY COALESCE(NULLIF(TRIM(nombre), ''), username)`,
    [empresaId],
  );
  const elegibles: UsuarioEntrevistaOpt[] = [];
  for (const row of candidatos) {
    const rol = String(row.rol_global) as RolGlobal;
    let permitido = rol === "Admin";
    if (!permitido) {
      const perms = await permisosEfectivos(Number(row.id), rol);
      permitido = tienePermiso(perms, "entrevistas", "ver");
    }
    if (!permitido) continue;
    elegibles.push({
      id: Number(row.id),
      nombre: nombreVisibleUsuario(row.nombre, row.username),
      username: String(row.username),
      rol,
    });
  }
  return elegibles;
}

/** Valida que `usuarioId` esté en el catálogo de elegibles de esta empresa (mismo patrón que reemplazarResponsables()). */
async function esUsuarioElegibleEntrevista(empresaId: number, usuarioId: number): Promise<boolean> {
  const elegibles = await listarUsuariosEntrevistadores(empresaId);
  return elegibles.some((u) => u.id === usuarioId);
}

/**
 * ATRACCION-TALENTO-2 (sección 12) — catálogo REAL de puestos de la empresa:
 * unión de `empleados.puesto` (plazas ya existentes) y `entrevistas.puesto`
 * (puestos ya usados en reclutamientos anteriores, incluida "Otro puesto"
 * escrito libremente) — nunca mezcla puestos de otra empresa. PUESTOS_MONACO
 * (src/lib/rrhh/categorias-ops.ts) es una lista estática distinta, no se toca.
 */
export async function listarPuestosDisponibles(empresaId: number): Promise<string[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT DISTINCT puesto FROM (
       SELECT TRIM(puesto) AS puesto FROM empleados WHERE empresa_id = ? AND TRIM(COALESCE(puesto, '')) <> ''
       UNION
       SELECT TRIM(puesto) AS puesto FROM entrevistas WHERE empresa_id = ? AND TRIM(COALESCE(puesto, '')) <> ''
     ) t
     ORDER BY puesto`,
    [empresaId, empresaId],
  );
  return rows.map((r) => String(r.puesto));
}

export async function eliminarEntrevista(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const r = await execute(
    `DELETE FROM entrevistas WHERE id = ? AND empresa_id = ?`,
    [id, empresaId],
  );
  const afectadas = Number((r as ResultSetHeader).affectedRows ?? 0);
  return afectadas > 0
    ? { ok: true, mensaje: "Entrevista eliminada." }
    : { ok: false, mensaje: "Entrevista no encontrada." };
}
