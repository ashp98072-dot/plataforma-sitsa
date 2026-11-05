import { nuevaClaveEnvio } from "@/lib/idempotencia/clave-envio";
import { problemaAmbito, claveBorrador } from "./ambito";
import type { MotivoFallo } from "./almacen";
import { abrirCanalSeguro, obtenerFabricaCanal, type CanalSeguro, type FabricaCanal, type MensajeCanal } from "./canal";
import { registrarControlador, type ControladorCoordinable, type MotivoSuspension } from "./coordinacion";
import { ESTADO_GUARDADO_INICIAL, reducirEstadoGuardado, type EstadoGuardado, type EventoGuardado } from "./estado-guardado";
import type { LecturaBorrador, NucleoBorradores } from "./nucleo";
import { persistenciaActiva, type AlmacenPreferencias } from "./preferencia";
import type { AmbitoBorrador, Borrador, EstadoEnvio, TipoBorrador } from "./tipos";

/**
 * BORR-1c — CONTROLADOR DE AUTOGUARDADO LOCAL de UN borrador (usuario + empresa + tipo). Independiente de React (el hook
 * `useBorradorLocal` es una capa fina). SOLO IndexedDB vía el núcleo de BORR-1a; no envía nada al servidor ni toca formularios.
 *
 * GARANTÍAS
 *  - «Guardado» solo después de que la transacción de IndexedDB se confirmó (`nucleo.guardar` devuelve éxito únicamente así).
 *  - Una única escritura en vuelo; los cambios que llegan durante la escritura se guardan después (siempre la versión más reciente)
 *    encadenando `revisionBase`: una escritura antigua nunca puede sobrescribir una revisión más nueva (CAS atómico del núcleo).
 *  - Sin escrituras innecesarias: el contenido se compara con lo último guardado.
 *  - Nada se restaura solo: un borrador existente exige una decisión (recuperar / descartar con confirmación / decidir después), y
 *    mientras no se decide NO se escribe (no puede sobrescribirse un borrador recuperable).
 *  - Otra pestaña con cambios: aviso por BroadcastChannel (opcional) y, sobre todo, la revisión atómica; ante conflicto se pide una
 *    decisión explícita, nunca se fusiona.
 *  - Con un intento de envío oficial registrado (`estadoEnvio !== "ninguno"`) se bloquea la edición y la recuperación hasta que el
 *    adaptador resuelva el estado: la clave de envío no se renueva sola.
 *  - Limitación real: un debounce no sobrevive a un apagón inmediato; lo no confirmado por IndexedDB NO está a salvo, y el estado
 *    visible lo dice («Cambios pendientes»). Se escribe antes si el usuario deja la pestaña (visibilitychange/pagehide, mejor
 *    esfuerzo) o tras `maxEsperaMs` de escritura continua. No se usa `beforeunload` como garantía.
 */

export type FaseBorrador =
  | "sin_contexto" // sin identidad/ámbito válido: inactivo
  | "desactivado" // «No guardar en este equipo»
  | "consultando" // leyendo el borrador previo
  | "decision_pendiente" // existe un borrador: el usuario debe decidir; no se escribe
  | "en_espera" // el usuario eligió «decidir después»: no se escribe
  | "activo" // autoguardado en marcha
  | "conflicto" // otra pestaña/versión: decisión explícita
  | "bloqueado" // envío oficial en curso/enviado, esquema futuro o datos corruptos
  | "suspendido" // salida de sesión: no se escribe
  | "cerrado";

export type SituacionRecuperacion = "disponible" | "expirado" | "esquema_anterior" | "incompatible" | "corrupto" | "enviado" | "envio_incierto";
export type MotivoConflicto = "revision_obsoleta" | "otra_pestana" | "descartado_en_otra_pestana" | "ya_no_existe";
/**
 * `sesion_anterior`: el usuario eligió eliminar sus borradores al cerrar sesión DESPUÉS de que esta pestaña empezara; sus escrituras
 * se rechazan dentro de la transacción (marca de purga). El contenido sigue en pantalla; hay que recargar para empezar una sesión nueva.
 */
export type MotivoBloqueo = "envio_en_curso" | "enviado" | "incompatible" | "corrupto" | "sesion_anterior";

export type InfoRecuperacion = {
  situacion: SituacionRecuperacion;
  tipo: TipoBorrador;
  borradorId: string | null;
  revision: number | null;
  esquemaVersion: number | null;
  actualizadoEn: number | null;
  expiraEn: number | null;
  estadoEnvio: EstadoEnvio | null;
  puedeRecuperar: boolean;
  puedeDescartar: boolean;
};

export type SnapshotBorrador = {
  fase: FaseBorrador;
  guardado: EstadoGuardado;
  /** Epoch ms del último guardado CONFIRMADO por esta instancia (o del borrador recuperado). */
  guardadoEn: number | null;
  revision: number | null;
  recuperacion: InfoRecuperacion | null;
  conflicto: { motivo: MotivoConflicto; revisionLocal: number | null; revisionRemota: number | null } | null;
  /** Otra pestaña avanzó la revisión: informativo (el conflicto real se detecta al escribir con cambios locales). */
  otraPestana: boolean;
  bloqueo: MotivoBloqueo | null;
  suspension: MotivoSuspension | null;
  /** No se pudo consultar el borrador previo (el almacenamiento falló): se sigue intentando guardar, protegido por la revisión. */
  errorLectura: MotivoFallo | null;
  sinCanal: boolean;
  estadoEnvio: EstadoEnvio;
  claveEnvio: string | null;
};

export type OpcionesControlador = {
  ambito: AmbitoBorrador;
  esquemaVersion: number;
  nucleo: NucleoBorradores;
  debounceMs?: number;
  /** Tope de espera con escritura continua (limita la ventana de pérdida). */
  maxEsperaMs?: number;
  ahora?: () => number;
  prefs?: AlmacenPreferencias | null;
  /** `undefined` = fábrica global (BroadcastChannel); `null` = sin canal. */
  fabricaCanal?: FabricaCanal | null;
  /** Migra el payload de un esquema ANTERIOR; sin esta función un borrador de esquema anterior no es recuperable. */
  migrar?: (payload: unknown, desdeVersion: number) => unknown | null;
};

export type FalloAccion = { ok: false; motivo: string; mensaje: string };
const fallo = (motivo: string, mensaje: string): FalloAccion => ({ ok: false, motivo, mensaje });

/** Validación NO destructiva del adaptador del formulario: se ejecuta ANTES de cambiar el estado del controlador. */
export type ValidadorPayload = (payload: unknown) => boolean;
function payloadAceptado(validar: ValidadorPayload | undefined, payload: unknown): boolean {
  if (!validar) return true;
  try { return validar(payload) === true; } catch { return false; }
}

export const DEBOUNCE_POR_DEFECTO_MS = 800;
export const MAX_ESPERA_POR_DEFECTO_MS = 5000;

export class ControladorBorrador implements ControladorCoordinable {
  readonly ambito: AmbitoBorrador;
  readonly ownerKey: string;
  private readonly esquemaVersion: number;
  private readonly nucleo: NucleoBorradores;
  private readonly debounceMs: number;
  private readonly maxEsperaMs: number;
  private readonly ahoraFn: () => number;
  private readonly prefs: AlmacenPreferencias | null;
  private readonly fabricaCanal: FabricaCanal | null;
  private readonly migrar?: OpcionesControlador["migrar"];
  private readonly instancia = nuevaClaveEnvio(); // identifica a esta instancia en los avisos entre pestañas (no es un secreto)

  private fase: FaseBorrador;
  private guardado: EstadoGuardado = ESTADO_GUARDADO_INICIAL;
  private guardadoEn: number | null = null;
  private revision: number | null = null;
  private recuperacion: InfoRecuperacion | null = null;
  private conflicto: SnapshotBorrador["conflicto"] = null;
  private otraPestana = false;
  private motivoOtraPestana: "otra_pestana" | "descartado_en_otra_pestana" = "otra_pestana";
  private bloqueo: MotivoBloqueo | null = null;
  private suspension: MotivoSuspension | null = null;
  private errorLectura: MotivoFallo | null = null;
  private estadoEnvio: EstadoEnvio = "ninguno";
  private claveEnvio: string | null = null;
  /**
   * Época de purga del propietario cuando EMPEZÓ esta sesión (la lee `iniciar`). Toda escritura la lleva y se verifica dentro de la
   * transacción: si hubo una purga después, se rechaza. `null` = no se pudo establecer → no se escribe (falla cerrada).
   */
  private epoca: number | null = null;

  private borradorLeido: Borrador | null = null; // borrador previo pendiente de decisión (contiene el payload en memoria)
  private remoto: Borrador | null | undefined; // última lectura al resolver un conflicto (undefined = no leída)
  private faseAntesDeSuspender: FaseBorrador | null = null;

  private payload: unknown = null;
  private jsonActual: string | null = null; // contenido más reciente del formulario
  private jsonBase: string | null = null; // contenido al montar (línea base, no se guarda por sí solo)
  private ultimoJson: string | null = null; // contenido de la última revisión conocida en el almacén
  private baselineListo = false;
  private forzarGuardado = false; // p. ej. tras migrar un esquema anterior: el contenido recuperado debe persistirse migrado

  private timer: ReturnType<typeof setTimeout> | null = null;
  private primerPendiente: number | null = null;
  private enVuelo: Promise<void> | null = null;
  private generacion = 0; // invalida resultados tardíos tras reiniciar/cerrar
  private cerrado = false;
  private iniciado = false;

  private canal: CanalSeguro | null = null;
  private retirarRegistro: (() => void) | null = null;
  private readonly suscriptores = new Set<() => void>();
  private snap: SnapshotBorrador;

  constructor(opciones: OpcionesControlador) {
    this.ambito = Object.freeze({ ...opciones.ambito }); // ámbito INMUTABLE: ni el llamador puede redirigir después una escritura pendiente
    this.ownerKey = opciones.ambito?.ownerKey ?? "";
    this.esquemaVersion = opciones.esquemaVersion;
    this.nucleo = opciones.nucleo;
    this.debounceMs = Math.max(0, opciones.debounceMs ?? DEBOUNCE_POR_DEFECTO_MS);
    this.maxEsperaMs = Math.max(this.debounceMs, opciones.maxEsperaMs ?? MAX_ESPERA_POR_DEFECTO_MS);
    this.ahoraFn = opciones.ahora ?? (() => Date.now());
    this.prefs = opciones.prefs ?? null;
    this.fabricaCanal = opciones.fabricaCanal === undefined ? obtenerFabricaCanal() : opciones.fabricaCanal;
    this.migrar = opciones.migrar;
    const ambitoValido = !problemaAmbito(opciones.ambito) && Number.isSafeInteger(opciones.esquemaVersion) && opciones.esquemaVersion >= 1;
    this.fase = ambitoValido ? "consultando" : "sin_contexto";
    this.snap = this.construirSnapshot();
  }

  // ───────────────────────────── observación ─────────────────────────────
  subscribe = (f: () => void): (() => void) => {
    this.suscriptores.add(f);
    return () => { this.suscriptores.delete(f); };
  };
  getSnapshot = (): SnapshotBorrador => this.snap;

  private construirSnapshot(): SnapshotBorrador {
    return {
      fase: this.fase, guardado: this.guardado, guardadoEn: this.guardadoEn, revision: this.revision, recuperacion: this.recuperacion,
      conflicto: this.conflicto, otraPestana: this.otraPestana, bloqueo: this.bloqueo, suspension: this.suspension, errorLectura: this.errorLectura,
      sinCanal: this.canal === null, estadoEnvio: this.estadoEnvio, claveEnvio: this.claveEnvio,
    };
  }

  private notificar() {
    if (this.cerrado) return;
    this.snap = this.construirSnapshot();
    for (const f of [...this.suscriptores]) { try { f(); } catch { /* un suscriptor defectuoso no afecta al controlador */ } }
  }

  private despachar(e: EventoGuardado) {
    this.guardado = reducirEstadoGuardado(this.guardado, e);
  }

  /** Estado visible «Error al guardar», con la causa, sin depender de que hubiera una escritura en vuelo. */
  private marcarError(motivo: MotivoFallo) {
    this.guardado = { estado: "error_almacenamiento", cambiosPosteriores: false, revision: this.revision, motivoError: motivo };
  }

  private cambiarFase(f: FaseBorrador) {
    this.fase = f;
  }

  // ───────────────────────────── ciclo de vida ─────────────────────────────
  /** Abre el canal, se registra para la coordinación de salida y consulta el borrador previo. Idempotente. */
  async iniciar(): Promise<void> {
    if (this.iniciado || this.cerrado) return;
    this.iniciado = true;
    if (this.fase === "sin_contexto") { this.notificar(); return; }
    this.retirarRegistro = registrarControlador(this);
    this.canal = abrirCanalSeguro(`novalvion-borrador:${claveBorrador(this.ambito)}`, this.instancia, (m) => this.alMensaje(m), this.fabricaCanal);
    await this.consultar(true);
  }

  /**
   * Consulta época y borrador previo. `adoptarEpoca`: solo al empezar la sesión (o al reanudar tras cancelar la salida); en otras
   * consultas (p. ej. al reactivar la persistencia) una época MAYOR que la de la sesión significa que hubo una purga: se bloquea.
   */
  private async consultar(adoptarEpoca: boolean): Promise<void> {
    const gen = ++this.generacion;
    this.cambiarFase("consultando");
    this.notificar();
    if (!persistenciaActiva(this.prefs)) { this.cambiarFase("desactivado"); this.notificar(); return; }
    const e = await this.nucleo.leerEpocaPurga(this.ownerKey);
    if (this.cerrado || gen !== this.generacion || this.fase !== "consultando") return;
    if (!e.ok) {
      this.errorLectura = e.motivo;
      this.marcarError(e.motivo);
      if (e.motivo === "datos_corruptos") { this.bloqueo = "corrupto"; this.cambiarFase("bloqueado"); this.notificar(); return; } // falla cerrada hasta la próxima purga
      this.activar(); // activo pero SIN época: no se escribe (ver puedeEscribir) hasta poder establecerla
      return;
    }
    if (adoptarEpoca || this.epoca === null) this.epoca = e.valor;
    else if (e.valor > this.epoca) { this.bloquearSesionAnterior(); return; }
    const r = await this.nucleo.leer(this.ambito, { esquemaVersion: this.esquemaVersion });
    if (this.cerrado || gen !== this.generacion || this.fase !== "consultando") return; // p. ej. se suspendió mientras se leía
    if (!r.ok) {
      if (r.motivo === "persistencia_desactivada") this.cambiarFase("desactivado");
      else if (r.motivo === "version_incompatible") this.pedirDecision({ situacion: "incompatible", borrador: null });
      else if (r.motivo === "datos_corruptos") this.pedirDecision({ situacion: "corrupto", borrador: null });
      else { this.errorLectura = r.motivo; this.marcarError(r.motivo); this.activar(); return; }
      this.notificar();
      return;
    }
    this.errorLectura = null;
    this.evaluarLectura(r.valor);
  }

  private evaluarLectura(l: LecturaBorrador) {
    if (l.estado === "vacio") { this.revision = null; this.activar(); return; }
    const b = l.borrador;
    if (b.estadoEnvio === "completado") return this.pedirDecision({ situacion: "enviado", borrador: b });
    if (b.estadoEnvio === "enviando") return this.pedirDecision({ situacion: "envio_incierto", borrador: b });
    if (l.estado === "incompatible") return this.pedirDecision({ situacion: "incompatible", borrador: b });
    if (l.estado === "expirado") return this.pedirDecision({ situacion: "expirado", borrador: b });
    if (l.estado === "esquema_anterior") return this.pedirDecision({ situacion: "esquema_anterior", borrador: b });
    return this.pedirDecision({ situacion: "disponible", borrador: b });
  }

  private pedirDecision(d: { situacion: SituacionRecuperacion; borrador: Borrador | null }) {
    const b = d.borrador;
    const puedeRecuperar = b !== null && (d.situacion === "disponible" || d.situacion === "expirado" || (d.situacion === "esquema_anterior" && !!this.migrar));
    this.borradorLeido = b;
    this.recuperacion = {
      situacion: d.situacion, tipo: this.ambito.tipo, borradorId: b?.borradorId ?? null, revision: b?.revision ?? null,
      esquemaVersion: b?.esquemaVersion ?? null, actualizadoEn: b?.actualizadoEn ?? null, expiraEn: b?.expiraEn ?? null,
      estadoEnvio: b?.estadoEnvio ?? null, puedeRecuperar,
      // Con un envío en curso sin resolver, descartar perdería la clave de idempotencia y permitiría duplicar el documento.
      puedeDescartar: d.situacion !== "envio_incierto",
    };
    if (b) { this.estadoEnvio = b.estadoEnvio; this.claveEnvio = b.claveEnvio; }
    this.cambiarFase("decision_pendiente");
    this.notificar();
  }

  private bloquearSesionAnterior() {
    this.limpiarTimer();
    this.primerPendiente = null;
    this.bloqueo = "sesion_anterior";
    this.guardado = { ...ESTADO_GUARDADO_INICIAL, estado: "pendiente", revision: this.revision };
    this.cambiarFase("bloqueado");
    this.notificar();
  }

  /** Pasa a escribir. Si el formulario ya cambió respecto de la referencia, programa el guardado. */
  private activar() {
    this.cambiarFase("activo");
    this.conflicto = null;
    this.recuperacion = null;
    this.borradorLeido = null;
    const referencia = this.ultimoJson ?? this.jsonBase;
    if (this.jsonActual !== null && this.jsonActual !== referencia) { this.despachar({ tipo: "cambio" }); this.programar(); }
    this.notificar();
  }

  /** Libera temporizadores, canal y registro. Hace un guardado de mejor esfuerzo (no garantizado) si había cambios confirmables. */
  dispose(): void {
    if (this.cerrado) return;
    const hayCambios = this.fase === "activo" && this.jsonActual !== null && this.jsonActual !== (this.ultimoJson ?? this.jsonBase);
    this.limpiarTimer();
    if (hayCambios && this.puedeEscribir() && !this.enVuelo) void this.ciclo(); // la escritura queda ligada a ESTE ámbito inmutable
    this.cerrado = true;
    this.generacion++;
    this.canal?.cerrar();
    this.canal = null;
    this.retirarRegistro?.();
    this.retirarRegistro = null;
    this.suscriptores.clear();
  }

  // ───────────────────────────── autoguardado ─────────────────────────────
  private puedeEscribir(): boolean {
    return !this.cerrado && this.fase === "activo" && this.epoca !== null && persistenciaActiva(this.prefs);
  }

  private limpiarTimer() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  private programar() {
    if (!this.puedeEscribir()) return;
    const t = this.ahoraFn();
    if (this.primerPendiente === null) this.primerPendiente = t;
    const restante = Math.max(0, this.maxEsperaMs - (t - this.primerPendiente));
    this.limpiarTimer();
    this.timer = setTimeout(() => { this.timer = null; void this.ciclo(); }, Math.min(this.debounceMs, restante));
  }

  /** Recibe el contenido actual del formulario (JSON permitido). La primera llamada fija la línea base y no se guarda por sí sola. */
  actualizarPayload(p: unknown): void {
    if (this.cerrado) return;
    let json: string | undefined;
    try { json = JSON.stringify(p); } catch { json = undefined; }
    if (typeof json !== "string") { // no serializable: no se guarda; se informa como error de guardado
      if (this.fase === "activo") { this.marcarError("payload_invalido"); this.notificar(); }
      return;
    }
    if (!this.baselineListo) {
      this.baselineListo = true;
      this.jsonBase = json; this.jsonActual = json; this.payload = p;
      if (!this.forzarGuardado) return;
    } else if (json === this.jsonActual) {
      return;
    }
    this.jsonActual = json;
    this.payload = p;
    if (this.fase !== "activo") return; // en cualquier otra fase el contenido se recuerda pero NO se escribe
    if (this.epoca === null) { this.marcarError(this.errorLectura ?? "lectura_fallida"); this.notificar(); return; } // sin época no se escribe
    if (this.otraPestana) { this.entrarConflicto(this.motivoOtraPestana); return; }
    if (json === this.ultimoJson && !this.forzarGuardado) { // volvió a lo ya guardado: no hay nada que escribir
      this.limpiarTimer(); this.primerPendiente = null;
      if (!this.enVuelo && this.guardado.estado !== "guardado") this.guardado = { ...ESTADO_GUARDADO_INICIAL, estado: "guardado", revision: this.revision };
      this.notificar();
      return;
    }
    this.despachar({ tipo: "cambio" });
    this.programar();
    this.notificar();
  }

  /** Escribe ya (visibilitychange/pagehide, navegación interna, botón). No promete nada si el navegador se cierra antes de confirmar. */
  async flush(): Promise<void> {
    this.limpiarTimer();
    if (this.enVuelo) { await this.enVuelo; if (this.puedeEscribir() && this.hayCambios()) await this.ciclo(); return; }
    if (this.puedeEscribir() && this.hayCambios()) await this.ciclo();
  }

  private hayCambios(): boolean {
    return this.jsonActual !== null && this.jsonActual !== this.ultimoJson && (this.ultimoJson !== null || this.jsonActual !== this.jsonBase || this.forzarGuardado);
  }

  private ciclo(): Promise<void> {
    if (this.enVuelo) return this.enVuelo;
    const p = this.cicloInterno().finally(() => { if (this.enVuelo === p) this.enVuelo = null; });
    this.enVuelo = p;
    return p;
  }

  private async cicloInterno(): Promise<void> {
    for (;;) {
      if (!this.puedeEscribir() || !this.hayCambios()) return;
      const jsonEnvio = this.jsonActual as string;
      const payloadEnvio = this.payload;
      const gen = this.generacion;
      this.primerPendiente = null;
      this.forzarGuardado = false;
      this.despachar({ tipo: "inicio_guardado" });
      this.notificar();
      const r = await this.nucleo.guardar(this.ambito, { payload: payloadEnvio, esquemaVersion: this.esquemaVersion, revisionBase: this.revision, epocaPurga: this.epoca as number });
      if (this.cerrado || gen !== this.generacion) return; // resultado tardío de una instancia reiniciada o cerrada: se ignora
      if (r.ok) {
        this.revision = r.valor.revision;
        this.ultimoJson = jsonEnvio;
        this.guardadoEn = r.valor.actualizadoEn;
        this.estadoEnvio = r.valor.estadoEnvio;
        this.claveEnvio = r.valor.claveEnvio;
        this.despachar({ tipo: "guardado_ok", revision: r.valor.revision });
        this.canal?.publicar({ t: "escrito", revision: r.valor.revision });
        if (this.hayCambios() && this.puedeEscribir()) { // cambió durante la escritura: se guarda la versión más reciente
          if (this.guardado.estado !== "pendiente") this.despachar({ tipo: "cambio" });
          this.notificar();
          continue;
        }
        if (this.guardado.estado === "pendiente") this.guardado = { ...ESTADO_GUARDADO_INICIAL, estado: "guardado", revision: this.revision }; // cambió y volvió a lo guardado
        this.notificar();
        return;
      }
      this.manejarFallo(r.motivo, r.revisionActual);
      return;
    }
  }

  private manejarFallo(motivo: MotivoFallo, revisionActual: number | undefined) {
    switch (motivo) {
      case "revision_obsoleta":
        this.guardado = { ...ESTADO_GUARDADO_INICIAL, estado: "pendiente", revision: this.revision };
        this.entrarConflicto(revisionActual === undefined ? "ya_no_existe" : "revision_obsoleta", revisionActual ?? null);
        return;
      case "purga_posterior":
        this.bloquearSesionAnterior(); return;
      case "persistencia_desactivada":
        this.cambiarFase("desactivado"); this.limpiarTimer(); this.notificar(); return;
      case "version_incompatible":
        this.bloqueo = "incompatible"; this.cambiarFase("bloqueado"); this.despachar({ tipo: "borrador_incompatible" }); this.notificar(); return;
      case "datos_corruptos":
        this.bloqueo = "corrupto"; this.cambiarFase("bloqueado"); this.notificar(); return;
      default:
        this.marcarError(motivo); // cuota, escritura, apertura, payload inválido… se reintenta con el siguiente cambio o con reintentar()
        this.notificar();
    }
  }

  /** Reintenta tras un error de almacenamiento. */
  async reintentar(): Promise<void> {
    if (this.guardado.estado !== "error_almacenamiento") return;
    if (this.epoca === null && this.fase === "activo") { await this.consultar(true); return; } // aún no se pudo establecer la época: se vuelve a consultar
    await this.flush();
  }

  // ───────────────────────────── recuperación ─────────────────────────────
  /** Entrega el payload del borrador pendiente de decisión (no lo aplica: lo hace el formulario). Empieza a autoguardar sobre su revisión. */
  recuperar(validar?: ValidadorPayload): { ok: true; payload: unknown; revision: number } | FalloAccion {
    if ((this.fase !== "decision_pendiente" && this.fase !== "en_espera") || !this.recuperacion || !this.borradorLeido) return fallo("sin_decision_pendiente", "No hay un borrador pendiente de decisión.");
    if (!this.recuperacion.puedeRecuperar) return fallo("no_recuperable", "Este borrador no se puede recuperar.");
    const b = this.borradorLeido;
    let payload = b.payload;
    let migrado = false;
    if (b.esquemaVersion < this.esquemaVersion) {
      try { const m = this.migrar ? this.migrar(b.payload, b.esquemaVersion) : null; if (m === null || m === undefined) return fallo("migracion_fallida", "No se pudo adaptar el borrador a la versión actual."); payload = m; migrado = true; }
      catch { return fallo("migracion_fallida", "No se pudo adaptar el borrador a la versión actual."); }
    }
    let json: string | undefined;
    try { json = JSON.stringify(payload); } catch { json = undefined; }
    if (typeof json !== "string") return fallo("no_recuperable", "El contenido del borrador no es válido.");
    // Sin cambiar NADA (fase, revisión, diálogo): si el adaptador no lo acepta, el borrador sigue pendiente de decisión y descartable.
    if (!payloadAceptado(validar, payload)) return fallo("payload_invalido", "El borrador guardado no tiene un formato válido y no se aplicó. Puedes descartarlo.");
    this.revision = b.revision;
    this.estadoEnvio = b.estadoEnvio; this.claveEnvio = b.claveEnvio;
    this.guardadoEn = b.actualizadoEn;
    this.payload = payload;
    // Se asume que el formulario adoptará el contenido recuperado: NO se programa un guardado del contenido anterior del formulario.
    this.jsonActual = json;
    this.ultimoJson = migrado ? null : json;
    this.forzarGuardado = migrado; // un esquema migrado se persiste con la versión actual en el siguiente ciclo
    this.baselineListo = true;
    this.guardado = { ...ESTADO_GUARDADO_INICIAL, estado: "guardado", revision: b.revision };
    this.activar();
    if (migrado) { this.despachar({ tipo: "cambio" }); this.programar(); this.notificar(); }
    return { ok: true, payload, revision: b.revision };
  }

  /** «Decidir después»: el borrador se conserva intacto y el autoguardado de esta sesión queda en pausa (no se sobrescribe). */
  mantener(): void {
    if (this.fase !== "decision_pendiente") return;
    this.cambiarFase("en_espera");
    this.notificar();
  }

  /** Elimina el borrador almacenado. Exige `confirmado: true` (la confirmación la pide la interfaz). No disponible con un envío sin resolver. */
  async descartar(opciones: { confirmado: boolean }): Promise<{ ok: true } | FalloAccion> {
    if (opciones?.confirmado !== true) return fallo("confirmacion_requerida", "Descartar un borrador requiere confirmación.");
    if (this.cerrado) return fallo("cerrado", "El formulario ya no está activo.");
    if (this.estadoEnvio === "enviando" || this.recuperacion?.situacion === "envio_incierto") return fallo("envio_pendiente", "Hay un envío oficial sin resolver; descartar permitiría duplicar el documento.");
    if (this.fase === "sin_contexto" || this.fase === "desactivado") return fallo("sin_almacenamiento", "El autoguardado no está activo.");
    if (this.fase === "bloqueado" && this.bloqueo === "sesion_anterior") return fallo("sesion_anterior", "La sesión anterior terminó; recarga la página para continuar.");
    this.limpiarTimer();
    if (this.enVuelo) await this.enVuelo.catch(() => undefined);
    const gen = ++this.generacion;
    const r = await this.nucleo.eliminar(this.ambito, this.epoca === null ? undefined : { epocaPurga: this.epoca });
    if (this.cerrado || gen !== this.generacion) return fallo("cerrado", "El formulario ya no está activo.");
    if (!r.ok) {
      if (r.motivo === "purga_posterior") { this.bloquearSesionAnterior(); return fallo(r.motivo, r.mensaje); } // una sesión anterior no descarta lo de la nueva
      this.marcarError(r.motivo); this.notificar(); return fallo(r.motivo, r.mensaje);
    }
    this.canal?.publicar({ t: "descartado" });
    // Descartado desde el estado activo, el contenido que el formulario ya muestra pasa a ser la nueva línea base (no se vuelve a guardar solo).
    if (this.fase !== "decision_pendiente" && this.fase !== "en_espera") this.jsonBase = this.jsonActual;
    this.revision = null; this.ultimoJson = null; this.guardadoEn = null; this.forzarGuardado = false;
    this.estadoEnvio = "ninguno"; this.claveEnvio = null; this.bloqueo = null; this.otraPestana = false;
    this.guardado = ESTADO_GUARDADO_INICIAL;
    this.activar();
    return { ok: true };
  }

  // ───────────────────────────── conflicto entre pestañas ─────────────────────────────
  private entrarConflicto(motivo: MotivoConflicto, revisionRemota: number | null = null) {
    this.limpiarTimer();
    this.primerPendiente = null;
    this.conflicto = { motivo, revisionLocal: this.revision, revisionRemota };
    this.remoto = undefined;
    this.cambiarFase("conflicto");
    this.notificar();
  }

  /** Relee el almacén para mostrar la versión de la otra pestaña ANTES de decidir. No modifica nada. */
  async releer(): Promise<{ ok: true; remoto: Borrador | null } | FalloAccion> {
    if (this.fase !== "conflicto") return fallo("sin_conflicto", "No hay un conflicto pendiente.");
    const r = await this.nucleo.leer(this.ambito, { esquemaVersion: this.esquemaVersion });
    if (this.cerrado) return fallo("cerrado", "El formulario ya no está activo.");
    if (!r.ok) return fallo(r.motivo, r.mensaje);
    const l = r.valor;
    this.remoto = l.estado === "vacio" ? null : l.borrador;
    if (this.conflicto) {
      this.conflicto = { ...this.conflicto, revisionRemota: this.remoto?.revision ?? null };
      this.notificar();
    }
    return { ok: true, remoto: this.remoto };
  }

  /** Decisión explícita: quedarse con la versión de la otra pestaña (el formulario debe adoptar el payload devuelto). */
  async adoptarRemoto(validar?: ValidadorPayload): Promise<{ ok: true; payload: unknown } | FalloAccion> {
    const l = await this.releer();
    if (!l.ok) return l;
    if (!l.remoto) return fallo("ya_no_existe", "El borrador ya no existe en este equipo.");
    let json: string | undefined;
    try { json = JSON.stringify(l.remoto.payload); } catch { json = undefined; }
    if (typeof json !== "string" || l.remoto.esquemaVersion > this.esquemaVersion) return fallo("no_recuperable", "La versión de la otra pestaña no se puede usar aquí.");
    if (!payloadAceptado(validar, l.remoto.payload)) return fallo("payload_invalido", "La versión de la otra pestaña no tiene un formato válido y no se aplicó.");
    this.revision = l.remoto.revision; this.estadoEnvio = l.remoto.estadoEnvio; this.claveEnvio = l.remoto.claveEnvio;
    this.payload = l.remoto.payload; this.jsonActual = json; this.ultimoJson = json; this.guardadoEn = l.remoto.actualizadoEn;
    this.otraPestana = false;
    this.guardado = { ...ESTADO_GUARDADO_INICIAL, estado: "guardado", revision: this.revision };
    this.activar();
    return { ok: true, payload: l.remoto.payload };
  }

  /** Decisión explícita: conservar los cambios de ESTA pestaña, sobrescribiendo la revisión vigente (que se vuelve a leer: sigue protegida por CAS). */
  async conservarLocal(): Promise<{ ok: true } | FalloAccion> {
    const l = await this.releer();
    if (!l.ok) return l;
    if (l.remoto && (l.remoto.estadoEnvio !== "ninguno" || l.remoto.esquemaVersion > this.esquemaVersion)) return fallo("no_recuperable", "La versión almacenada no se puede sobrescribir.");
    this.revision = l.remoto?.revision ?? null;
    this.ultimoJson = l.remoto ? safeJson(l.remoto.payload) : null;
    this.otraPestana = false;
    this.forzarGuardado = true;
    this.guardado = { ...ESTADO_GUARDADO_INICIAL, estado: "pendiente", revision: this.revision };
    this.activar();
    await this.flush();
    return { ok: true };
  }

  private alMensaje(m: MensajeCanal) {
    if (this.cerrado) return;
    if (m.t === "escrito" || m.t === "descartado") {
      const rev = typeof m.revision === "number" ? m.revision : null;
      if (m.t === "escrito" && rev !== null && this.revision !== null && rev <= this.revision && !this.enVuelo) return;
      const motivo = m.t === "descartado" ? "descartado_en_otra_pestana" : "otra_pestana";
      if (this.fase !== "activo") { if (this.fase === "decision_pendiente" || this.fase === "en_espera") { this.otraPestana = true; this.motivoOtraPestana = motivo; } this.notificar(); return; }
      const cambiosLocales = this.hayCambios() || this.enVuelo !== null;
      if (cambiosLocales) this.entrarConflicto(motivo, rev);
      else { this.otraPestana = true; this.motivoOtraPestana = motivo; this.notificar(); }
    }
  }

  /** Al volver a primer plano: comprueba la revisión almacenada (cubre la ausencia de BroadcastChannel). */
  async verificarRemoto(): Promise<void> {
    if (this.fase !== "activo" || this.cerrado) return;
    const gen = this.generacion;
    const r = await this.nucleo.metadatos(this.ambito);
    if (this.cerrado || gen !== this.generacion || this.fase !== "activo" || !r.ok) return;
    const revRemota = r.valor?.revision ?? null;
    if (revRemota === this.revision) return;
    const motivo = revRemota === null ? "descartado_en_otra_pestana" : "otra_pestana";
    if (this.hayCambios() || this.enVuelo) this.entrarConflicto(motivo, revRemota);
    else { this.otraPestana = true; this.motivoOtraPestana = motivo; this.notificar(); }
  }

  // ───────────────────────────── sesión, preferencia y visibilidad ─────────────────────────────
  /** Salida de sesión (ver coordinacion.ts): cancela lo pendiente y espera a la escritura en vuelo. */
  async suspender(motivo: MotivoSuspension): Promise<void> {
    if (this.cerrado) return;
    if (this.fase !== "suspendido") this.faseAntesDeSuspender = this.fase;
    this.limpiarTimer();
    this.suspension = motivo;
    this.cambiarFase("suspendido");
    this.notificar();
    if (this.enVuelo) await this.enVuelo.catch(() => undefined);
  }

  async esperarEscritura(): Promise<void> {
    if (this.enVuelo) await this.enVuelo.catch(() => undefined);
  }

  /** La salida no ocurrió: se vuelve a sincronizar con el almacén (sin recrear nada que haya desaparecido). */
  reanudar(): void {
    if (this.cerrado || this.fase !== "suspendido") return;
    this.suspension = null;
    void this.resincronizar();
  }

  private async resincronizar(): Promise<void> {
    const gen = ++this.generacion;
    if (!persistenciaActiva(this.prefs)) { this.cambiarFase("desactivado"); this.notificar(); return; }
    // La salida NO ocurrió (se canceló): la marca de purga que pudo dejar esa tentativa no invalida a esta sesión, que sigue vigente.
    const e = await this.nucleo.leerEpocaPurga(this.ownerKey);
    if (e.ok && this.epoca !== null) this.epoca = e.valor;
    const r = await this.nucleo.leer(this.ambito, { esquemaVersion: this.esquemaVersion });
    if (this.cerrado || gen !== this.generacion) return;
    const previa = this.faseAntesDeSuspender;
    this.faseAntesDeSuspender = null;
    if (previa === "decision_pendiente" || previa === "en_espera" || previa === "consultando" || previa === "sin_contexto") { await this.consultar(false); return; }
    if (previa === "bloqueado" || previa === "conflicto" || previa === "desactivado") { this.cambiarFase(previa); this.notificar(); return; } // no se desbloquea nada que ya estuviera bloqueado
    if (!r.ok) { this.cambiarFase("activo"); this.errorLectura = r.motivo; this.notificar(); return; }
    const l = r.valor;
    const revRemota = l.estado === "vacio" ? null : l.borrador.revision;
    if (revRemota === this.revision) { this.activar(); return; }
    this.cambiarFase("activo");
    this.entrarConflicto(revRemota === null ? "ya_no_existe" : "otra_pestana", revRemota);
  }

  /**
   * Cambió la preferencia «No guardar en este equipo». `desdeEstaPagina`: el usuario la reactivó AQUÍ (evento propio): la sesión de esta
   * página sigue vigente y adopta la época actual aunque su propia purga la haya subido. Desde otra pestaña (`storage`) no se adopta:
   * si hubo una purga posterior, esta sesión queda bloqueada.
   */
  alCambiarPreferencia(desdeEstaPagina = false): void {
    if (this.cerrado) return;
    if (!persistenciaActiva(this.prefs)) {
      if (this.fase === "desactivado") return;
      this.limpiarTimer(); this.primerPendiente = null;
      this.cambiarFase("desactivado");
      this.notificar();
    } else if (this.fase === "desactivado") {
      void this.consultar(desdeEstaPagina); // desde otra pestaña: una época mayor que la de esta sesión (hubo purga) la bloquea
    }
  }

  alOcultarse(): void { void this.flush(); }
  alVolverAPrimerPlano(): void { void this.verificarRemoto(); }

  // ───────────────────────────── envío oficial (contrato; la reconciliación es de BORR-1d/1e/1f) ─────────────────────────────
  /**
   * Registra, ANTES de llamar a la API oficial, que habrá un intento de envío con esa clave. Bloquea la edición y la recuperación
   * hasta que el adaptador llame a `resolverEnvio`. No renueva la clave por sí mismo.
   */
  async registrarEnvio(claveEnvio: string): Promise<{ ok: true } | FalloAccion> {
    if (this.fase !== "activo") return fallo("no_activo", "El borrador no está activo.");
    await this.flush();
    if (this.fase !== "activo") return fallo("no_activo", "El borrador no está activo.");
    const r = await this.nucleo.guardar(this.ambito, { payload: this.payload, esquemaVersion: this.esquemaVersion, revisionBase: this.revision, claveEnvio, estadoEnvio: "enviando", epocaPurga: this.epoca ?? 0 });
    if (this.cerrado) return fallo("cerrado", "El formulario ya no está activo.");
    if (!r.ok) { this.manejarFallo(r.motivo, r.revisionActual); return fallo(r.motivo, r.mensaje); }
    this.revision = r.valor.revision; this.ultimoJson = this.jsonActual; this.estadoEnvio = "enviando"; this.claveEnvio = claveEnvio;
    this.bloqueo = "envio_en_curso"; this.limpiarTimer(); this.cambiarFase("bloqueado");
    this.despachar({ tipo: "guardado_ok", revision: r.valor.revision });
    this.notificar();
    return { ok: true };
  }

  /** El adaptador resuelve explícitamente el intento: `completado` (el backend confirmó) o `ninguno` (no se envió; `claveEnvio` undefined la conserva). */
  async resolverEnvio(opciones: { estadoEnvio: "completado" | "ninguno"; claveEnvio?: string | null }): Promise<{ ok: true } | FalloAccion> {
    if (this.estadoEnvio !== "enviando" && this.fase !== "bloqueado") return fallo("sin_envio", "No hay un envío pendiente de resolver.");
    const r = await this.nucleo.guardar(this.ambito, { payload: this.payload, esquemaVersion: this.esquemaVersion, revisionBase: this.revision, estadoEnvio: opciones.estadoEnvio, claveEnvio: opciones.claveEnvio, epocaPurga: this.epoca ?? 0 });
    if (this.cerrado) return fallo("cerrado", "El formulario ya no está activo.");
    if (!r.ok) return fallo(r.motivo, r.mensaje);
    this.revision = r.valor.revision; this.estadoEnvio = r.valor.estadoEnvio; this.claveEnvio = r.valor.claveEnvio;
    if (opciones.estadoEnvio === "completado") { this.bloqueo = "enviado"; this.cambiarFase("bloqueado"); }
    else { this.bloqueo = null; this.cambiarFase("activo"); }
    this.notificar();
    return { ok: true };
  }
}

function safeJson(v: unknown): string | null {
  try { const j = JSON.stringify(v); return typeof j === "string" ? j : null; } catch { return null; }
}
