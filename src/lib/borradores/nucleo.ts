import { CLAVE_ENVIO_REGEX, nuevaClaveEnvio } from "@/lib/idempotencia/clave-envio";
import { claveAmbitoUsuarioEmpresa, claveBorrador, problemaAmbito, problemaAmbitoUsuarioEmpresa } from "./ambito";
import { exito, fallo, type AlmacenBorradores, type Resultado } from "./almacen";
import { validarEstructuraPayload, validarPayload } from "./payload";
import {
  ESTADOS_ENVIO,
  FORMATO_REGISTRO,
  MAX_PAYLOAD_CHARS_POR_DEFECTO,
  RETENCION_MS_POR_DEFECTO,
  type AmbitoBorrador,
  type AmbitoUsuarioEmpresa,
  type Borrador,
  type EstadoEnvio,
  type MetadatosBorrador,
  type RegistroAlmacenado,
  type TipoBorrador,
} from "./tipos";

/**
 * NÚCLEO DE BORRADORES — operaciones sobre un `AlmacenBorradores`, sin React, sin red y sin leer sesión.
 *
 * Garantías:
 *  - UN borrador por (ownerKey, empresaId, tipo). Toda consulta exige el ámbito completo; no existe «listar todo».
 *  - Guardado con control de revisión (compare-and-set DENTRO de la transacción): una revisión antigua nunca pisa a una
 *    más nueva, y un borrador de esquema FUTURO o un registro corrupto nunca se sobrescriben en silencio.
 *  - El éxito se informa solo con la transacción confirmada.
 *  - Nada de lo leído se borra por un error de lectura, de migración o de versión: solo `eliminar`, `purgarUsuario` y
 *    `limpiarExpirados` (que además respeta las versiones soportadas) borran, y siempre por orden explícita.
 *  - Ningún contenido de borrador se escribe en consola ni en mensajes de error.
 */

export type OpcionesNucleo = {
  almacen: AlmacenBorradores;
  /** Build de la aplicación (diagnóstico). Lo provee quien integra el núcleo. */
  appBuild: string;
  retencionMs?: number;
  maxPayloadChars?: number;
  /** Reloj inyectable (epoch ms). */
  ahora?: () => number;
};

export type EntradaGuardado = {
  payload: unknown;
  /** Versión del esquema del payload que se escribe. */
  esquemaVersion: number;
  /** Revisión que el llamador leyó por última vez; `null` solo para crear. */
  revisionBase: number | null;
  /** `undefined` conserva la actual; `null` la borra; una cadena válida la fija. */
  claveEnvio?: string | null;
  /** `undefined` conserva el actual. */
  estadoEnvio?: EstadoEnvio;
};

export type LecturaBorrador =
  | { estado: "vacio" }
  | { estado: "vigente"; borrador: Borrador }
  /** Escrito con un esquema ANTERIOR al solicitado: el adaptador puede migrar y guardar con `revisionBase`. */
  | { estado: "esquema_anterior"; borrador: Borrador }
  /** Escrito con un esquema FUTURO: se conserva intacto y no debe usarse ni sobrescribirse. */
  | { estado: "incompatible"; borrador: Borrador }
  | { estado: "expirado"; borrador: Borrador };

export type ResumenLimpieza = { eliminados: number; omitidos: number };

/**
 * Resultado de una purga por usuario. Todos los contadores son de lo CONFIRMADO por transacciones ya cerradas, salvo
 * `indeterminados`: operaciones que seguían en vuelo cuando se canceló y cuyo resultado real se desconoce.
 *   total = eliminados + fallidos + cambiados + pendientes + indeterminados
 */
export type ResumenPurga = {
  /** Borradores del usuario que eran objetivo al iniciar. */
  total: number;
  /** Eliminados con la transacción confirmada, o confirmados como ya ausentes. */
  eliminados: number;
  /** La operación falló (error de almacenamiento): el registro sigue ahí. */
  fallidos: number;
  /** Cambiaron (otra versión, otra identidad) desde el listado: NO se eliminan. */
  cambiados: number;
  /** No se llegaron a iniciar porque la purga se canceló. */
  pendientes: number;
  /** Operación en vuelo al cancelar: pudo (o no) confirmarse; resultado incierto. */
  indeterminados: number;
  /** La purga se detuvo por cancelación antes de terminar. */
  cancelado: boolean;
};

export type OpcionesPurga = {
  /** Cancelación COOPERATIVA: impide iniciar nuevas eliminaciones; no revierte una transacción ya confirmada. */
  signal?: AbortSignal;
  /** Solo se eliminan borradores guardados hasta este instante (epoch ms): los creados/modificados después se conservan. */
  consentidoEn?: number;
  /** Observador del avance (para informar un estado real aunque la purga no llegue a terminar). */
  alProgresar?: (resumen: Readonly<ResumenPurga>) => void;
};

const ABORTADO: unique symbol = Symbol("abortado");

/** Resuelve con `ABORTADO` en cuanto se cancela, sin esperar a `promesa` (que sigue su curso y no se cancela). */
function frenarSiSeCancela<T>(signal: AbortSignal | undefined, promesa: Promise<T>): Promise<T | typeof ABORTADO> {
  if (!signal) return promesa;
  if (signal.aborted) { promesa.catch(() => undefined); return Promise.resolve(ABORTADO); }
  return new Promise((resolve, reject) => {
    const alAbortar = () => resolve(ABORTADO);
    signal.addEventListener("abort", alAbortar, { once: true });
    promesa.then(
      (v) => { signal.removeEventListener("abort", alAbortar); resolve(v); },
      (e) => { signal.removeEventListener("abort", alAbortar); reject(e); },
    );
  });
}

/** Identifica la VERSIÓN exacta de un registro crudo (para no borrar una versión distinta de la listada). */
function huellaRegistro(crudo: unknown): string {
  if (esObjeto(crudo) && typeof crudo.borradorId === "string" && typeof crudo.revision === "number") {
    return `${crudo.borradorId}|${crudo.revision}|${String(crudo.actualizadoEn)}`;
  }
  try { return `x:${JSON.stringify(crudo)}`; } catch { return "x:?"; }
}

/**
 * `ok`: la envoltura (metadatos, identidad y claves) es coherente. La ESTRUCTURA DEL PAYLOAD se comprueba aparte y solo
 * cuando hace falta (`payloadValido`): un borrador de esquema FUTURO puede tener un payload que esta versión no sabe juzgar y
 * debe conservarse intacto como «incompatible», no declararse corrupto.
 */
type Parseo = { tipo: "ok"; borrador: Borrador; payloadValido: () => boolean } | { tipo: "corrupto" } | { tipo: "formato_futuro" };

const esEntero = (v: unknown, min: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Valida la FORMA de un registro leído del almacén. Datos de otra versión del contenedor o dañados no se «arreglan» ni se
 * entregan como vigentes: identidad (ownerKey/empresa/slug/tipo con las mismas reglas que un ámbito), coherencia con la clave
 * primaria y la clave de índice, numéricos enteros, fechas finitas con `expiraEn >= actualizadoEn`, clave de envío con su
 * formato y estado conocido.
 */
function parsear(crudo: unknown): Parseo {
  if (!esObjeto(crudo)) return { tipo: "corrupto" };
  if (!esEntero(crudo.formato, 1)) return { tipo: "corrupto" };
  if (crudo.formato > FORMATO_REGISTRO) return { tipo: "formato_futuro" };
  const r = crudo;
  if (problemaAmbito({ ownerKey: r.ownerKey, empresaId: r.empresaId, empresaSlug: r.empresaSlug, tipo: r.tipo })) return { tipo: "corrupto" };
  const ownerKey = r.ownerKey as string;
  const empresaId = r.empresaId as number;
  const tipo = r.tipo as TipoBorrador;
  if (
    typeof r.borradorId !== "string" || r.borradorId.length === 0 || typeof r.appBuild !== "string" ||
    !esEntero(r.esquemaVersion, 1) || !esEntero(r.revision, 1) ||
    typeof r.actualizadoEn !== "number" || !Number.isFinite(r.actualizadoEn) ||
    typeof r.expiraEn !== "number" || !Number.isFinite(r.expiraEn) || r.expiraEn < r.actualizadoEn ||
    !(r.claveEnvio === null || (typeof r.claveEnvio === "string" && CLAVE_ENVIO_REGEX.test(r.claveEnvio))) ||
    !(ESTADOS_ENVIO as readonly unknown[]).includes(r.estadoEnvio) || !("payload" in r) ||
    r.clave !== claveBorrador({ ownerKey, empresaId, tipo }) || r.ambitoClave !== claveAmbitoUsuarioEmpresa({ ownerKey, empresaId })
  ) return { tipo: "corrupto" };
  return {
    tipo: "ok",
    payloadValido: () => validarEstructuraPayload(r.payload) === null,
    borrador: {
      borradorId: r.borradorId, tipo, ownerKey, empresaId, empresaSlug: r.empresaSlug as string,
      esquemaVersion: r.esquemaVersion, appBuild: r.appBuild, revision: r.revision, payload: r.payload,
      actualizadoEn: r.actualizadoEn, expiraEn: r.expiraEn, claveEnvio: r.claveEnvio as string | null, estadoEnvio: r.estadoEnvio as EstadoEnvio,
    },
  };
}

const metadatosDe = (b: Borrador): MetadatosBorrador => {
  const { payload: _payload, claveEnvio, ...resto } = b;
  void _payload;
  return { ...resto, tieneClaveEnvio: claveEnvio !== null };
};

/** El registro debe pertenecer exactamente al ámbito consultado: si la clave y el contenido no coinciden, está dañado. */
const perteneceA = (b: Borrador, a: Pick<AmbitoBorrador, "ownerKey" | "empresaId" | "tipo">) =>
  b.ownerKey === a.ownerKey && b.empresaId === a.empresaId && b.tipo === a.tipo;

export function crearNucleoBorradores(opciones: OpcionesNucleo) {
  const { almacen, appBuild } = opciones;
  const retencionMs = opciones.retencionMs ?? RETENCION_MS_POR_DEFECTO;
  const maxPayloadChars = opciones.maxPayloadChars ?? MAX_PAYLOAD_CHARS_POR_DEFECTO;
  const ahora = opciones.ahora ?? (() => Date.now());

  function ambitoInvalido(a: unknown) {
    const p = problemaAmbito(a);
    return p ? fallo("ambito_invalido", p) : null;
  }

  return {
    /** Lee el borrador del ámbito. No borra nada, ni siquiera los expirados o incompatibles. */
    async leer(ambito: AmbitoBorrador, { esquemaVersion }: { esquemaVersion: number }): Promise<Resultado<LecturaBorrador>> {
      const inv = ambitoInvalido(ambito);
      if (inv) return inv;
      if (!esEntero(esquemaVersion, 1)) return fallo("argumento_invalido", "La versión de esquema no es válida.");
      const r = await almacen.obtener(claveBorrador(ambito));
      if (!r.ok) return r;
      if (r.valor === undefined) return exito({ estado: "vacio" });
      const p = parsear(r.valor);
      if (p.tipo === "formato_futuro") return fallo("version_incompatible", "El borrador fue creado por una versión más nueva de la aplicación.");
      if (p.tipo === "corrupto" || !perteneceA(p.borrador, ambito)) return fallo("datos_corruptos", "El borrador guardado en este equipo está dañado.");
      const b = p.borrador;
      if (b.esquemaVersion > esquemaVersion) return exito({ estado: "incompatible", borrador: b });
      // Esquema soportado: el payload debe ser estructuralmente válido para entregarse (ni vigente, ni expirado, ni a migrar).
      if (!p.payloadValido()) return fallo("datos_corruptos", "El borrador guardado en este equipo está dañado.");
      if (b.expiraEn <= ahora()) return exito({ estado: "expirado", borrador: b });
      if (b.esquemaVersion < esquemaVersion) return exito({ estado: "esquema_anterior", borrador: b });
      return exito({ estado: "vigente", borrador: b });
    },

    /**
     * Crea (`revisionBase: null`) o actualiza el borrador. Devuelve el borrador SOLO si la transacción se confirmó.
     * `revision_obsoleta` indica `revisionActual`: el llamador debe releer y decidir; el núcleo no fusiona ni pisa.
     */
    async guardar(ambito: AmbitoBorrador, entrada: EntradaGuardado): Promise<Resultado<Borrador>> {
      const inv = ambitoInvalido(ambito);
      if (inv) return inv;
      if (!esEntero(entrada.esquemaVersion, 1)) return fallo("argumento_invalido", "La versión de esquema no es válida.");
      if (!(entrada.revisionBase === null || esEntero(entrada.revisionBase, 1))) return fallo("argumento_invalido", "La revisión base no es válida.");
      if (entrada.estadoEnvio !== undefined && !(ESTADOS_ENVIO as readonly unknown[]).includes(entrada.estadoEnvio)) return fallo("argumento_invalido", "El estado de envío no es válido.");
      if (typeof entrada.claveEnvio === "string" && !CLAVE_ENVIO_REGEX.test(entrada.claveEnvio)) return fallo("argumento_invalido", "La clave de envío no es válida.");
      const pp = validarPayload(entrada.payload, maxPayloadChars);
      if (pp) return fallo(pp.motivo, pp.mensaje);

      const clave = claveBorrador(ambito);
      const marca = ahora();
      const r = await almacen.modificar<Resultado<Borrador>>(clave, (actual) => {
        let previo: Borrador | null = null;
        if (actual !== undefined) {
          const p = parsear(actual);
          if (p.tipo === "formato_futuro") return { accion: "ninguna", resultado: fallo("version_incompatible", "El borrador fue creado por una versión más nueva de la aplicación.") };
          if (p.tipo === "corrupto" || !perteneceA(p.borrador, ambito)) return { accion: "ninguna", resultado: fallo("datos_corruptos", "El borrador guardado en este equipo está dañado.") };
          previo = p.borrador;
          if (previo.esquemaVersion > entrada.esquemaVersion) return { accion: "ninguna", resultado: fallo("version_incompatible", "El borrador pertenece a una versión más nueva del formulario.", { revisionActual: previo.revision }) };
          if (!p.payloadValido()) return { accion: "ninguna", resultado: fallo("datos_corruptos", "El borrador guardado en este equipo está dañado.") };
          if (entrada.revisionBase !== previo.revision) return { accion: "ninguna", resultado: fallo("revision_obsoleta", "El borrador cambió desde la última lectura.", { revisionActual: previo.revision }) };
        } else if (entrada.revisionBase !== null) {
          return { accion: "ninguna", resultado: fallo("revision_obsoleta", "El borrador ya no existe en este equipo.") };
        }
        const borrador: Borrador = {
          borradorId: previo?.borradorId ?? nuevaClaveEnvio(),
          tipo: ambito.tipo, ownerKey: ambito.ownerKey, empresaId: ambito.empresaId, empresaSlug: ambito.empresaSlug,
          esquemaVersion: entrada.esquemaVersion, appBuild, revision: (previo?.revision ?? 0) + 1,
          payload: entrada.payload, actualizadoEn: marca, expiraEn: marca + retencionMs,
          claveEnvio: entrada.claveEnvio === undefined ? (previo?.claveEnvio ?? null) : entrada.claveEnvio,
          estadoEnvio: entrada.estadoEnvio ?? previo?.estadoEnvio ?? "ninguno",
        };
        const registro: RegistroAlmacenado = { ...borrador, clave, ambitoClave: claveAmbitoUsuarioEmpresa(ambito), formato: FORMATO_REGISTRO };
        return { accion: "escribir", registro, resultado: exito(borrador) };
      });
      return r.ok ? r.valor : r;
    },

    async existe(ambito: AmbitoBorrador): Promise<Resultado<boolean>> {
      const inv = ambitoInvalido(ambito);
      if (inv) return inv;
      const r = await almacen.obtener(claveBorrador(ambito));
      return r.ok ? exito(r.valor !== undefined) : r;
    },

    /** Elimina el borrador del ámbito (descarte explícito). Idempotente: borrar algo inexistente no es un error. */
    async eliminar(ambito: AmbitoBorrador): Promise<Resultado<{ existia: boolean }>> {
      const inv = ambitoInvalido(ambito);
      if (inv) return inv;
      return almacen.modificar(claveBorrador(ambito), (actual) => ({ accion: "eliminar", resultado: { existia: actual !== undefined } }));
    },

    /** Metadatos (sin payload ni clave de envío) de UN borrador. */
    async metadatos(ambito: AmbitoBorrador): Promise<Resultado<MetadatosBorrador | undefined>> {
      const inv = ambitoInvalido(ambito);
      if (inv) return inv;
      const r = await almacen.obtener(claveBorrador(ambito));
      if (!r.ok) return r;
      if (r.valor === undefined) return exito(undefined);
      const p = parsear(r.valor);
      if (p.tipo === "formato_futuro") return fallo("version_incompatible", "El borrador fue creado por una versión más nueva de la aplicación.");
      if (p.tipo === "corrupto" || !perteneceA(p.borrador, ambito)) return fallo("datos_corruptos", "El borrador guardado en este equipo está dañado.");
      return exito(metadatosDe(p.borrador));
    },

    /** Metadatos de todos los tipos de UN usuario en UNA empresa. Los registros ilegibles se cuentan, no se ocultan en silencio. */
    async listarMetadatos(ambito: AmbitoUsuarioEmpresa): Promise<Resultado<{ borradores: MetadatosBorrador[]; ilegibles: number }>> {
      const p0 = problemaAmbitoUsuarioEmpresa(ambito);
      if (p0) return fallo("ambito_invalido", p0);
      const r = await almacen.listar("ambito", claveAmbitoUsuarioEmpresa(ambito));
      if (!r.ok) return r;
      const borradores: MetadatosBorrador[] = [];
      let ilegibles = 0;
      for (const crudo of r.valor) {
        const p = parsear(crudo);
        if (p.tipo === "ok" && p.borrador.ownerKey === ambito.ownerKey && p.borrador.empresaId === ambito.empresaId) borradores.push(metadatosDe(p.borrador));
        else ilegibles++;
      }
      return exito({ borradores, ilegibles });
    },

    /**
     * Metadatos de TODOS los borradores de UN usuario (todas sus empresas y tipos). Para decidir qué ofrecer al cerrar sesión
     * o al desactivar la persistencia; no entrega payloads. Los registros ilegibles se cuentan aparte.
     */
    async listarMetadatosUsuario(ownerKey: string): Promise<Resultado<{ borradores: MetadatosBorrador[]; ilegibles: number }>> {
      const p0 = problemaAmbitoUsuarioEmpresa({ ownerKey, empresaId: 1 });
      if (p0) return fallo("ambito_invalido", p0);
      const r = await almacen.listar("ownerKey", ownerKey);
      if (!r.ok) return r;
      const borradores: MetadatosBorrador[] = [];
      let ilegibles = 0;
      for (const crudo of r.valor) {
        const p = parsear(crudo);
        if (p.tipo === "ok" && p.borrador.ownerKey === ownerKey) borradores.push(metadatosDe(p.borrador));
        else ilegibles++;
      }
      return exito({ borradores, ilegibles });
    },

    /**
     * Retención: elimina SOLO los borradores expirados del usuario+empresa indicados. `versionesSoportadas` indica, por tipo,
     * la versión de esquema que la aplicación entiende: los de esquema futuro y los tipos sin versión declarada se OMITEN
     * (no se borran datos que esta versión no sabe interpretar), y los ilegibles/corruptos (incluido un payload dañado)
     * también. Cada borrado revalida DENTRO de su transacción identidad (ownerKey, empresa, tipo, clave primaria,
     * borradorId), revisión, expiración y versión soportada: un registro que cambió desde el listado no se elimina.
     */
    async limpiarExpirados(ambito: AmbitoUsuarioEmpresa, versionesSoportadas: Partial<Record<TipoBorrador, number>>): Promise<Resultado<ResumenLimpieza>> {
      const p0 = problemaAmbitoUsuarioEmpresa(ambito);
      if (p0) return fallo("ambito_invalido", p0);
      const lista = await almacen.listar("ambito", claveAmbitoUsuarioEmpresa(ambito));
      if (!lista.ok) return lista;
      const corte = ahora();
      let eliminados = 0;
      let omitidos = 0;
      for (const crudo of lista.valor) {
        const p = parsear(crudo);
        const claveListada = esObjeto(crudo) && typeof crudo.clave === "string" ? crudo.clave : null;
        // Lo listado debe pertenecer al ámbito pedido y su clave primaria debe corresponder a su contenido.
        if (p.tipo !== "ok" || p.borrador.ownerKey !== ambito.ownerKey || p.borrador.empresaId !== ambito.empresaId || claveListada === null || claveListada !== claveBorrador(p.borrador)) { omitidos++; continue; }
        const b = p.borrador;
        if (b.expiraEn > corte) continue; // vigente: no es candidato
        const soportada = versionesSoportadas[b.tipo];
        if (soportada === undefined || b.esquemaVersion > soportada || !p.payloadValido()) { omitidos++; continue; }
        // Se revalida TODO dentro de la transacción: si desde el listado el registro cambió de identidad, de revisión
        // (cualquier guardado la incrementa), de versión o de estado, o ya no corresponde a su clave, NO se elimina.
        const r = await almacen.modificar<boolean>(claveListada, (actual) => {
          const q = parsear(actual);
          const sigueIgual = q.tipo === "ok" &&
            q.borrador.ownerKey === ambito.ownerKey && q.borrador.empresaId === ambito.empresaId && q.borrador.tipo === b.tipo &&
            claveBorrador(q.borrador) === claveListada && // `parsear` ya exige clave primaria coherente con el contenido
            q.borrador.borradorId === b.borradorId && q.borrador.revision === b.revision &&
            q.borrador.expiraEn <= corte && q.borrador.esquemaVersion <= soportada && q.payloadValido();
          return sigueIgual ? { accion: "eliminar", resultado: true } : { accion: "ninguna", resultado: false };
        });
        // Un fallo puntual no aborta la limpieza ni borra nada: el registro queda para la próxima.
        if (r.ok && r.valor) eliminados++;
        else omitidos++;
      }
      return exito({ eliminados, omitidos });
    },

    /**
     * Borra los borradores de un usuario (todas sus empresas y tipos), incluidos los incompatibles o dañados que
     * `limpiarExpirados` omite. Pensado para cierre de sesión y «no guardar en este equipo»: es una orden explícita.
     *
     * CANCELACIÓN COOPERATIVA (`signal`): antes de CADA eliminación y DENTRO de su transacción se comprueba la cancelación;
     * una vez cancelada no se inicia ninguna eliminación nueva (una operación en espera cuya decisión aún no corrió ya no
     * borra). Una transacción que YA emitió su borrado se confirmará aunque se cancele: eso no es reversible y se informa como
     * `indeterminados`. Cada borrado solo procede si el registro sigue siendo la MISMA versión que se listó (mismo borradorId y
     * revisión): una versión nueva creada después se conserva y se cuenta en `cambiados`. `consentidoEn` excluye además lo
     * guardado después del consentimiento (útil en reintentos). Limitación: un registro sin el campo `ownerKey` (dañado de
     * forma que el índice no lo ve) no puede localizarse por usuario.
     */
    async purgarUsuario(ownerKey: string, opciones: OpcionesPurga = {}): Promise<Resultado<ResumenPurga>> {
      const { signal, consentidoEn, alProgresar } = opciones;
      const p0 = problemaAmbitoUsuarioEmpresa({ ownerKey, empresaId: 1 });
      if (p0) return fallo("ambito_invalido", p0);
      const resumen: ResumenPurga = { total: 0, eliminados: 0, fallidos: 0, cambiados: 0, pendientes: 0, indeterminados: 0, cancelado: false };
      const avisar = () => { try { alProgresar?.({ ...resumen }); } catch { /* un observador defectuoso no debe afectar la purga */ } };
      if (signal?.aborted) { resumen.cancelado = true; avisar(); return exito({ ...resumen }); }

      const listado = await frenarSiSeCancela(signal, almacen.listar("ownerKey", ownerKey));
      if (listado === ABORTADO) { resumen.cancelado = true; avisar(); return exito({ ...resumen }); } // listar solo lee: nada que deshacer
      if (!listado.ok) return listado;

      const objetivos = listado.valor.filter((crudo) =>
        !(consentidoEn !== undefined && esObjeto(crudo) && typeof crudo.actualizadoEn === "number" && crudo.actualizadoEn > consentidoEn));
      resumen.total = objetivos.length;
      resumen.pendientes = objetivos.length;
      avisar();

      for (const crudo of objetivos) {
        if (signal?.aborted) { resumen.cancelado = true; break; }
        const clave = esObjeto(crudo) && typeof crudo.clave === "string" ? crudo.clave : null;
        if (clave === null) { resumen.fallidos++; resumen.pendientes--; avisar(); continue; }
        const huellaListada = huellaRegistro(crudo);
        const operacion = almacen.modificar<"eliminado" | "ausente" | "cambiado" | "cancelado">(clave, (actual) => {
          if (signal?.aborted) return { accion: "ninguna", resultado: "cancelado" }; // comprobación DENTRO de la transacción
          if (actual === undefined) return { accion: "ninguna", resultado: "ausente" };
          if (!esObjeto(actual) || actual.ownerKey !== ownerKey || actual.clave !== clave || huellaRegistro(actual) !== huellaListada) {
            return { accion: "ninguna", resultado: "cambiado" };
          }
          return { accion: "eliminar", resultado: "eliminado" };
        });
        const r = await frenarSiSeCancela(signal, operacion);
        if (r === ABORTADO) { // operación en vuelo: puede confirmarse después; su resultado real se desconoce
          resumen.cancelado = true; resumen.indeterminados++; resumen.pendientes--; avisar(); break;
        }
        if (!r.ok) resumen.fallidos++;
        else if (r.valor === "cancelado") { resumen.cancelado = true; avisar(); break; }
        else if (r.valor === "cambiado") resumen.cambiados++;
        else if (r.valor === "eliminado" || r.valor === "ausente") resumen.eliminados++; // transacción confirmada / confirmado ausente
        else resumen.fallidos++; // cualquier otra cosa NO se da por eliminada
        resumen.pendientes--;
        avisar();
      }
      return exito({ ...resumen });
    },
  };
}

export type NucleoBorradores = ReturnType<typeof crearNucleoBorradores>;
