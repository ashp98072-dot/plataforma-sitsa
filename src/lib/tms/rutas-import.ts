import type { RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoErrorImport, identidadRutaImport } from "@/lib/import-errores";
import type { FilaRutaExcel } from "./rutas-import-excel";

/**
 * VIAT-5 (Operaciones > Rutas > Importar Excel) — dos fases:
 * `previsualizarImportacionRutas` (solo lectura, NO escribe nada) y
 * `confirmarImportacionRutas` (escribe dentro de una transacción). NO
 * modifica el modelo/arquitectura de Rutas (tms_cliente_rutas,
 * tms_cliente_ubicaciones, tms_cliente_contactos) ni sus funciones ya
 * existentes en src/lib/tms/cliente-rutas.ts — este módulo es aditivo y
 * autónomo, con sus propias consultas conn-aware para la escritura
 * transaccional (cliente-rutas.ts usa el pool global, no una conexión de
 * transacción, y no se le tocó la firma para no alterar su arquitectura).
 *
 * NUNCA convierte el Destino en paradas estructuradas — se guarda tal
 * cual en destino_descripcion (punto 2/6). Nunca acepta empresa_id desde
 * el Excel — siempre viene del parámetro `empresaId` (de la sesión/
 * tenant, resuelto por el endpoint antes de llamar aquí).
 */

/** trim + colapsa espacios + minúsculas — SOLO para comparar, nunca para guardar. */
function normalizar(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export type EstadoFilaRuta =
  | "nueva" // cliente resuelto, código no existe -> se crea
  | "actualizar" // código ya existe Y el usuario eligió actualizar
  | "omitir" // código ya existe, se omite (default)
  | "cliente_nuevo" // no hay cliente con ese nombre -> se crearía uno
  | "cliente_ambiguo" // hay candidatos parecidos, requiere elegir manualmente
  | "duplicado_en_archivo" // mismo código ya apareció antes en el mismo Excel
  | "error"; // fila inválida (p. ej. sin código)

export type CandidatoCliente = { id: number; nombre: string };

export type PreviewFilaRuta = {
  filaExcel: number;
  codigo: string;
  clienteExcel: string;
  lugarCargaExcel: string;
  horaExcel: string | null;
  contactoExcel: string;
  destinoExcel: string;
  estado: EstadoFilaRuta;
  detalle: string;
  /** Cliente ya resuelto (match exacto) o elegido manualmente. */
  clienteId: number | null;
  clienteNombre: string | null;
  /** Candidatos cuando estado = cliente_ambiguo (el usuario debe elegir uno, o "crear nuevo"). */
  clienteCandidatos: CandidatoCliente[];
  ubicacionId: number | null;
  ubicacionEsNueva: boolean;
  contactoId: number | null;
  contactoEsNuevo: boolean;
  rutaExistenteId: number | null;
  /** Cliente actualmente dueño de la ruta existente (solo si rutaExistenteId != null). */
  clienteActualId: number | null;
  clienteActualNombre: string | null;
  /** true si el cliente resuelto del Excel difiere del cliente actual de la ruta -> requiere confirmación explícita antes de reasignar. */
  cambioClienteDetectado: boolean;
};

export type ResumenPreviewRutas = {
  total: number;
  nuevas: number;
  actualizables: number;
  omitidas: number;
  clientesNuevos: number;
  clientesAmbiguos: number;
  duplicadosEnArchivo: number;
  errores: number;
};

/**
 * Fase A — SOLO LECTURA. Resuelve cliente/ubicación/contacto/código
 * existente para cada fila, sin escribir nada. Prioridad de match de
 * cliente (punto 3): 1) nombre normalizado EXACTO -> reutiliza; 2) sin
 * match exacto pero con candidatos "parecidos" (uno contiene al otro,
 * normalizado) -> cliente_ambiguo, requiere revisión manual; 3) sin
 * ningún candidato -> cliente_nuevo (se crearía al confirmar, pero
 * siempre visible en el preview para revisión, nunca silencioso).
 */
export async function previsualizarImportacionRutas(
  empresaId: number,
  filas: FilaRutaExcel[],
): Promise<{ filas: PreviewFilaRuta[]; resumen: ResumenPreviewRutas; erroresDetalle: string[] }> {
  const [clientes, ubicaciones, contactos, rutasExistentes] = await Promise.all([
    query<RowDataPacket[]>("SELECT id, nombre FROM tms_clientes WHERE empresa_id = ?", [empresaId]),
    query<RowDataPacket[]>(
      "SELECT id, cliente_id, nombre FROM tms_cliente_ubicaciones WHERE empresa_id = ? AND activo = 1",
      [empresaId],
    ),
    query<RowDataPacket[]>(
      "SELECT id, cliente_id, nombre FROM tms_cliente_contactos WHERE empresa_id = ? AND activo = 1",
      [empresaId],
    ),
    query<RowDataPacket[]>("SELECT id, codigo, cliente_id FROM tms_cliente_rutas WHERE empresa_id = ?", [empresaId]),
  ]);

  const clientesPorNombreExacto = new Map<string, CandidatoCliente>();
  const clientesLista: CandidatoCliente[] = clientes.map((c) => ({ id: Number(c.id), nombre: String(c.nombre) }));
  for (const c of clientesLista) clientesPorNombreExacto.set(normalizar(c.nombre), c);
  const nombrePorClienteId = new Map<number, string>();
  for (const c of clientesLista) nombrePorClienteId.set(c.id, c.nombre);

  const ubicacionesPorCliente = new Map<number, { id: number; nombreNorm: string }[]>();
  for (const u of ubicaciones) {
    const cid = Number(u.cliente_id);
    const list = ubicacionesPorCliente.get(cid) ?? [];
    list.push({ id: Number(u.id), nombreNorm: normalizar(String(u.nombre)) });
    ubicacionesPorCliente.set(cid, list);
  }

  const contactosPorCliente = new Map<number, { id: number; nombreNorm: string }[]>();
  for (const c of contactos) {
    const cid = Number(c.cliente_id);
    const list = contactosPorCliente.get(cid) ?? [];
    list.push({ id: Number(c.id), nombreNorm: normalizar(String(c.nombre)) });
    contactosPorCliente.set(cid, list);
  }

  const rutasPorCodigo = new Map<string, { id: number; clienteId: number }>();
  for (const r of rutasExistentes) rutasPorCodigo.set(String(r.codigo), { id: Number(r.id), clienteId: Number(r.cliente_id) });

  const codigosVistos = new Set<string>();
  const resultado: PreviewFilaRuta[] = [];
  const erroresDetalle: string[] = [];

  for (const f of filas) {
    const identidad = identidadRutaImport({ codigo: f.codigoExcel, cliente: f.clienteExcel });

    if (!f.codigoExcel) {
      const detalle = "Sin código — fila omitida.";
      erroresDetalle.push(formatoErrorImport({ filaExcel: f.filaExcel, identidad, detalle }));
      resultado.push(filaBase(f, "error", detalle));
      continue;
    }

    if (codigosVistos.has(f.codigoExcel)) {
      const detalle = `Código "${f.codigoExcel}" repetido dentro del mismo archivo — solo la primera aparición se procesa.`;
      erroresDetalle.push(formatoErrorImport({ filaExcel: f.filaExcel, identidad, detalle }));
      resultado.push(filaBase(f, "duplicado_en_archivo", detalle));
      continue;
    }
    codigosVistos.add(f.codigoExcel);

    if (!f.clienteExcel) {
      const detalle = "Sin cliente — fila omitida.";
      erroresDetalle.push(formatoErrorImport({ filaExcel: f.filaExcel, identidad, detalle }));
      resultado.push(filaBase(f, "error", detalle));
      continue;
    }

    const normCliente = normalizar(f.clienteExcel);
    const exacto = clientesPorNombreExacto.get(normCliente);
    const rutaExistente = rutasPorCodigo.get(f.codigoExcel) ?? null;
    const rutaExistenteId = rutaExistente?.id ?? null;
    const clienteActualId = rutaExistente?.clienteId ?? null;
    const clienteActualNombre = clienteActualId != null ? (nombrePorClienteId.get(clienteActualId) ?? null) : null;

    let clienteId: number | null = null;
    let clienteNombre: string | null = null;
    let clienteCandidatos: CandidatoCliente[] = [];
    let estado: EstadoFilaRuta;
    let detalle: string;
    let cambioClienteDetectado = false;

    if (exacto) {
      clienteId = exacto.id;
      clienteNombre = exacto.nombre;
      estado = rutaExistenteId ? "omitir" : "nueva";
      if (rutaExistenteId) {
        cambioClienteDetectado = clienteActualId != null && clienteActualId !== exacto.id;
        detalle = cambioClienteDetectado
          ? `Código ${f.codigoExcel} ya existe y pertenece a "${clienteActualNombre}" — el Excel trae un cliente distinto ("${exacto.nombre}"). Se omite por defecto; si se marca Actualizar, hay que confirmar explícitamente el cambio de cliente.`
          : `Código ${f.codigoExcel} ya existe (se omite por defecto; puede marcarse para actualizar).`;
      } else {
        detalle = `Cliente "${exacto.nombre}" reconocido — ruta nueva.`;
      }
    } else {
      // Sin match exacto: candidatos "parecidos" (contención normalizada en cualquier dirección).
      clienteCandidatos = clientesLista.filter(
        (c) => normalizar(c.nombre).includes(normCliente) || normCliente.includes(normalizar(c.nombre)),
      );
      if (clienteCandidatos.length) {
        estado = "cliente_ambiguo";
        detalle = `"${f.clienteExcel}" no coincide exactamente con ningún cliente — ${clienteCandidatos.length} candidato(s) parecido(s), requiere elegir manualmente.`;
      } else {
        estado = "cliente_nuevo";
        detalle = `No existe un cliente "${f.clienteExcel}" — se crearía uno nuevo al confirmar.`;
      }
    }

    // Ubicación/contacto solo se resuelven si ya hay un cliente cierto
    // (exacto) — para clientes ambiguos/nuevos se resuelven en confirmar,
    // una vez se sepa el cliente_id definitivo.
    let ubicacionId: number | null = null;
    let ubicacionEsNueva = false;
    let contactoId: number | null = null;
    let contactoEsNuevo = false;
    if (clienteId != null) {
      if (f.lugarCargaExcel) {
        const normLugar = normalizar(f.lugarCargaExcel);
        const match = (ubicacionesPorCliente.get(clienteId) ?? []).find((u) => u.nombreNorm === normLugar);
        if (match) ubicacionId = match.id;
        else ubicacionEsNueva = true;
      }
      if (f.contactoExcel) {
        const normContacto = normalizar(f.contactoExcel);
        const match = (contactosPorCliente.get(clienteId) ?? []).find((c) => c.nombreNorm === normContacto);
        if (match) contactoId = match.id;
        else contactoEsNuevo = true;
      }
    } else {
      if (f.lugarCargaExcel) ubicacionEsNueva = true;
      if (f.contactoExcel) contactoEsNuevo = true;
    }

    resultado.push({
      filaExcel: f.filaExcel,
      codigo: f.codigoExcel,
      clienteExcel: f.clienteExcel,
      lugarCargaExcel: f.lugarCargaExcel,
      horaExcel: f.horaExcel,
      contactoExcel: f.contactoExcel,
      destinoExcel: f.destinoExcel,
      estado,
      detalle,
      clienteId,
      clienteNombre,
      clienteCandidatos,
      ubicacionId,
      ubicacionEsNueva,
      contactoId,
      contactoEsNuevo,
      rutaExistenteId,
      clienteActualId,
      clienteActualNombre,
      cambioClienteDetectado,
    });
  }

  const resumen: ResumenPreviewRutas = {
    total: resultado.length,
    nuevas: resultado.filter((f) => f.estado === "nueva").length,
    actualizables: 0, // se decide en el frontend por fila existente; ver "omitir" abajo
    omitidas: resultado.filter((f) => f.estado === "omitir").length,
    clientesNuevos: resultado.filter((f) => f.estado === "cliente_nuevo").length,
    clientesAmbiguos: resultado.filter((f) => f.estado === "cliente_ambiguo").length,
    duplicadosEnArchivo: resultado.filter((f) => f.estado === "duplicado_en_archivo").length,
    errores: resultado.filter((f) => f.estado === "error").length,
  };

  return { filas: resultado, resumen, erroresDetalle };
}

function filaBase(f: FilaRutaExcel, estado: EstadoFilaRuta, detalle: string): PreviewFilaRuta {
  return {
    filaExcel: f.filaExcel,
    codigo: f.codigoExcel,
    clienteExcel: f.clienteExcel,
    lugarCargaExcel: f.lugarCargaExcel,
    horaExcel: f.horaExcel,
    contactoExcel: f.contactoExcel,
    destinoExcel: f.destinoExcel,
    estado,
    detalle,
    clienteId: null,
    clienteNombre: null,
    clienteCandidatos: [],
    ubicacionId: null,
    ubicacionEsNueva: false,
    contactoId: null,
    contactoEsNuevo: false,
    rutaExistenteId: null,
    clienteActualId: null,
    clienteActualNombre: null,
    cambioClienteDetectado: false,
  };
}

/** Decisión del frontend para UNA fila al confirmar (punto 8: default omitir). */
export type DecisionFilaRuta = {
  filaExcel: number;
  /** Si la fila quedó "cliente_ambiguo" o "cliente_nuevo", el usuario confirma/elige el cliente aquí. -1 = crear cliente nuevo con el nombre del Excel. */
  clienteIdElegido?: number | -1;
  /** Si el código ya existe: true = actualizar, false/ausente = omitir (default). */
  actualizarExistente?: boolean;
  /** Requerido cuando actualizar implica cambiar el cliente dueño de la ruta — nunca se reasigna sin esto. */
  confirmarCambioCliente?: boolean;
  /** Si la fila es "error"/"duplicado_en_archivo"/inválida: se ignora siempre, no hay decisión posible. */
};

export type ResultadoImportacionRutas = {
  procesadas: number;
  creadas: number;
  actualizadas: number;
  omitidas: number;
  clientesCreados: number;
  ubicacionesCreadas: number;
  contactosCreados: number;
  errores: number;
  erroresDetalle: string[];
};

/**
 * Fase B — escribe dentro de UNA transacción (punto 7: "no dejar una
 * importación parcialmente silenciosa"). Cada fila se valida de nuevo
 * contra el estado actual de la BD (por si algo cambió desde el
 * preview) antes de escribir; una fila inválida se cuenta como error y
 * se omite SIN abortar las demás — solo un fallo de BD realmente
 * inesperado (no una validación) revierte toda la transacción, para no
 * dejar la importación en un estado a medias por una causa que ningún
 * usuario pudo prever ni revisar en el preview.
 */
export async function confirmarImportacionRutas(
  empresaId: number,
  usuario: string,
  filas: FilaRutaExcel[],
  decisiones: DecisionFilaRuta[],
): Promise<ResultadoImportacionRutas> {
  const decisionPorFila = new Map(decisiones.map((d) => [d.filaExcel, d]));

  const resultado: ResultadoImportacionRutas = {
    procesadas: filas.length,
    creadas: 0,
    actualizadas: 0,
    omitidas: 0,
    clientesCreados: 0,
    ubicacionesCreadas: 0,
    contactosCreados: 0,
    errores: 0,
    erroresDetalle: [],
  };

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    // Precargar el mismo universo que usó el preview y comparar SIEMPRE en
    // JS con la misma normalizar() (trim + colapsar espacios + minúsculas).
    // Antes esto se hacía con "LOWER(TRIM(nombre)) = ?" en SQL, que NO
    // colapsa espacios internos repetidos: un nombre real con doble
    // espacio interno podía darse por "reutilizado" en el preview y no
    // encontrarse aquí, generando duplicados o filas que el preview
    // prometía limpias y terminaban en error. Los mapas se actualizan en
    // cada iteración tras un INSERT para no duplicar dentro del mismo
    // archivo cuando dos filas comparten cliente/ubicación/contacto nuevo.
    const [clientesRows, ubicacionesRows, contactosRows, rutasExistentesRows] = await Promise.all([
      conn.query<RowDataPacket[]>("SELECT id, nombre FROM tms_clientes WHERE empresa_id = ?", [empresaId]),
      conn.query<RowDataPacket[]>(
        "SELECT id, cliente_id, nombre FROM tms_cliente_ubicaciones WHERE empresa_id = ? AND activo = 1",
        [empresaId],
      ),
      conn.query<RowDataPacket[]>(
        "SELECT id, cliente_id, nombre FROM tms_cliente_contactos WHERE empresa_id = ? AND activo = 1",
        [empresaId],
      ),
      conn.query<RowDataPacket[]>("SELECT id, codigo, cliente_id FROM tms_cliente_rutas WHERE empresa_id = ?", [
        empresaId,
      ]),
    ]);

    // clientesPorEmpresa: única fuente de verdad de "qué cliente pertenece
    // a esta empresa" — un clienteIdElegido que no aparezca aquí (de otra
    // empresa, o inexistente) NUNCA se acepta, sin importar lo que mande
    // el cliente HTTP en `decisiones`.
    const clientesPorEmpresa = new Map<number, string>();
    const clientesPorNombreNorm = new Map<string, number>();
    for (const c of clientesRows[0]) {
      const id = Number(c.id);
      clientesPorEmpresa.set(id, String(c.nombre));
      clientesPorNombreNorm.set(normalizar(String(c.nombre)), id);
    }

    const ubicacionesPorCliente = new Map<number, { id: number; nombreNorm: string }[]>();
    for (const u of ubicacionesRows[0]) {
      const cid = Number(u.cliente_id);
      const list = ubicacionesPorCliente.get(cid) ?? [];
      list.push({ id: Number(u.id), nombreNorm: normalizar(String(u.nombre)) });
      ubicacionesPorCliente.set(cid, list);
    }

    const contactosPorCliente = new Map<number, { id: number; nombreNorm: string }[]>();
    for (const c of contactosRows[0]) {
      const cid = Number(c.cliente_id);
      const list = contactosPorCliente.get(cid) ?? [];
      list.push({ id: Number(c.id), nombreNorm: normalizar(String(c.nombre)) });
      contactosPorCliente.set(cid, list);
    }

    const rutasPorCodigo = new Map<string, { id: number; clienteId: number }>();
    for (const r of rutasExistentesRows[0]) {
      rutasPorCodigo.set(String(r.codigo), { id: Number(r.id), clienteId: Number(r.cliente_id) });
    }

    const codigosVistos = new Set<string>();

    for (const f of filas) {
      const identidad = identidadRutaImport({ codigo: f.codigoExcel, cliente: f.clienteExcel });

      if (!f.codigoExcel || !f.clienteExcel) {
        resultado.errores++;
        resultado.erroresDetalle.push(
          formatoErrorImport({ filaExcel: f.filaExcel, identidad, detalle: "Sin código o sin cliente." }),
        );
        continue;
      }
      if (codigosVistos.has(f.codigoExcel)) {
        resultado.errores++;
        resultado.erroresDetalle.push(
          formatoErrorImport({
            filaExcel: f.filaExcel,
            identidad,
            detalle: "Código repetido dentro del mismo archivo.",
          }),
        );
        continue;
      }
      codigosVistos.add(f.codigoExcel);

      const decision = decisionPorFila.get(f.filaExcel);

      // Resolver cliente_id definitivo. Prioridad: 1) match exacto por
      // nombre normalizado (siempre gana, incluso si el usuario pidió
      // "crear nuevo" -- evita duplicar); 2) decisión explícita de crear
      // nuevo; 3) decisión explícita de un cliente EXISTENTE de ESTA
      // empresa (se verifica contra clientesPorEmpresa -- nunca se confía
      // ciegamente en el id que mande el cliente HTTP).
      let clienteId: number | null = null;
      const normCliente = normalizar(f.clienteExcel);
      const clienteExactoId = clientesPorNombreNorm.get(normCliente) ?? null;
      if (clienteExactoId != null) {
        clienteId = clienteExactoId;
      } else if (decision?.clienteIdElegido === -1) {
        const [rCliente] = await conn.execute<import("mysql2/promise").ResultSetHeader>(
          "INSERT INTO tms_clientes (empresa_id, nombre) VALUES (?, ?)",
          [empresaId, f.clienteExcel],
        );
        clienteId = Number(rCliente.insertId);
        clientesPorEmpresa.set(clienteId, f.clienteExcel);
        clientesPorNombreNorm.set(normCliente, clienteId);
        resultado.clientesCreados++;
      } else if (
        decision?.clienteIdElegido != null &&
        decision.clienteIdElegido > 0 &&
        clientesPorEmpresa.has(decision.clienteIdElegido)
      ) {
        clienteId = decision.clienteIdElegido;
      }

      if (clienteId == null) {
        resultado.errores++;
        resultado.erroresDetalle.push(
          formatoErrorImport({
            filaExcel: f.filaExcel,
            identidad,
            detalle:
              decision?.clienteIdElegido != null && !clientesPorEmpresa.has(decision.clienteIdElegido)
                ? `Cliente elegido inválido (no pertenece a esta empresa) para "${f.clienteExcel}".`
                : `Cliente "${f.clienteExcel}" sin resolver — pendiente de elegir/crear antes de importar.`,
          }),
        );
        continue;
      }

      const rutaExistente = rutasPorCodigo.get(f.codigoExcel) ?? null;
      const rutaExistenteId = rutaExistente?.id ?? null;

      // Protección contra reasignación silenciosa: si el código ya existe
      // y el cliente resuelto difiere del dueño actual de la ruta, exigir
      // confirmación explícita ANTES de tocar cliente_id. Nunca se infiere.
      if (rutaExistenteId && decision?.actualizarExistente && rutaExistente!.clienteId !== clienteId && !decision?.confirmarCambioCliente) {
        resultado.errores++;
        resultado.erroresDetalle.push(
          formatoErrorImport({
            filaExcel: f.filaExcel,
            identidad,
            detalle: `Código ${f.codigoExcel} pertenece a "${clientesPorEmpresa.get(rutaExistente!.clienteId) ?? "otro cliente"}" y el Excel trae "${f.clienteExcel}" — requiere confirmar explícitamente el cambio de cliente. No se modificó.`,
          }),
        );
        continue;
      }

      // Ubicación de carga: reutilizar por cliente + nombre normalizado, o crear.
      let ubicacionCargaId: number | null = null;
      let lugarCargaTexto: string | null = null;
      if (f.lugarCargaExcel) {
        lugarCargaTexto = f.lugarCargaExcel;
        const normLugar = normalizar(f.lugarCargaExcel);
        const match = (ubicacionesPorCliente.get(clienteId) ?? []).find((u) => u.nombreNorm === normLugar);
        if (match) {
          ubicacionCargaId = match.id;
        } else {
          const [rUbic] = await conn.execute<import("mysql2/promise").ResultSetHeader>(
            "INSERT INTO tms_cliente_ubicaciones (empresa_id, cliente_id, nombre, tipo) VALUES (?, ?, ?, 'CARGA')",
            [empresaId, clienteId, f.lugarCargaExcel],
          );
          ubicacionCargaId = Number(rUbic.insertId);
          const list = ubicacionesPorCliente.get(clienteId) ?? [];
          list.push({ id: ubicacionCargaId, nombreNorm: normLugar });
          ubicacionesPorCliente.set(clienteId, list);
          resultado.ubicacionesCreadas++;
        }
      }

      // Contacto: reutilizar por cliente + nombre normalizado, o crear (sin inventar cargo/telefono/email).
      let contactoClienteId: number | null = null;
      if (f.contactoExcel) {
        const normContacto = normalizar(f.contactoExcel);
        const match = (contactosPorCliente.get(clienteId) ?? []).find((c) => c.nombreNorm === normContacto);
        if (match) {
          contactoClienteId = match.id;
        } else {
          const [rCont] = await conn.execute<import("mysql2/promise").ResultSetHeader>(
            "INSERT INTO tms_cliente_contactos (empresa_id, cliente_id, nombre) VALUES (?, ?, ?)",
            [empresaId, clienteId, f.contactoExcel],
          );
          contactoClienteId = Number(rCont.insertId);
          const list = contactosPorCliente.get(clienteId) ?? [];
          list.push({ id: contactoClienteId, nombreNorm: normContacto });
          contactosPorCliente.set(clienteId, list);
          resultado.contactosCreados++;
        }
      }

      const horaHabitual = f.horaExcel;
      // Destino: SIEMPRE el texto exacto del Excel — nunca se parte en paradas.
      const destinoDescripcion = f.destinoExcel || null;

      if (rutaExistenteId) {
        if (!decision?.actualizarExistente) {
          resultado.omitidas++;
          continue; // default: omitir (punto 8)
        }
        await conn.execute(
          `UPDATE tms_cliente_rutas
           SET cliente_id = ?, ubicacion_carga_id = ?, lugar_carga_texto = ?, destino_descripcion = ?,
               hora_habitual = ?, contacto_cliente_id = ?
           WHERE id = ? AND empresa_id = ?`,
          [
            clienteId,
            ubicacionCargaId,
            lugarCargaTexto,
            destinoDescripcion,
            horaHabitual,
            contactoClienteId,
            rutaExistenteId,
            empresaId,
          ],
        );
        resultado.actualizadas++;
      } else {
        const [rRuta] = await conn.execute<import("mysql2/promise").ResultSetHeader>(
          `INSERT INTO tms_cliente_rutas
            (empresa_id, cliente_id, codigo, ubicacion_carga_id, lugar_carga_texto, destino_descripcion, hora_habitual, contacto_cliente_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            empresaId,
            clienteId,
            f.codigoExcel,
            ubicacionCargaId,
            lugarCargaTexto,
            destinoDescripcion,
            horaHabitual,
            contactoClienteId,
          ],
        );
        // evita reprocesar/duplicar el mismo código si se repitiera por error de datos
        rutasPorCodigo.set(f.codigoExcel, { id: Number(rRuta.insertId), clienteId });
        resultado.creadas++;
      }
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "importar_rutas",
    modulo: "tms",
    detalle: `Importación Excel de rutas · ${resultado.creadas} creadas, ${resultado.actualizadas} actualizadas, ${resultado.omitidas} omitidas, ${resultado.errores} con error (${resultado.procesadas} procesadas)`,
  });

  return resultado;
}
