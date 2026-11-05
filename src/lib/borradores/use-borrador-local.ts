import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useContextoBorradores } from "@/lib/empresa-session";
import { crearAlmacenIndexedDB } from "./almacen-indexeddb";
import type { FabricaCanal } from "./canal";
import { ControladorBorrador, type ValidadorPayload, DEBOUNCE_POR_DEFECTO_MS, MAX_ESPERA_POR_DEFECTO_MS, type FalloAccion, type SnapshotBorrador } from "./controlador";
import { ESTADO_GUARDADO_INICIAL } from "./estado-guardado";
import { crearNucleoBorradores, type NucleoBorradores } from "./nucleo";
import { almacenPreferenciasDelNavegador, crearAlmacenSegunPreferencia, EVENTO_PREFERENCIA, type AlmacenPreferencias, CLAVE_PREFERENCIA_PERSISTENCIA } from "./preferencia";
import type { ContextoBorradores } from "./contexto";
import type { AmbitoBorrador, Borrador, TipoBorrador } from "./tipos";

/**
 * BORR-1c — HOOK `useBorradorLocal`: capa fina de React sobre `ControladorBorrador`. NO conecta ningún formulario oficial (eso es
 * BORR-1d/1e/1f). El contenido del formulario se persiste ÚNICAMENTE en IndexedDB (nunca en localStorage); localStorage solo guarda
 * la preferencia no sensible «No guardar en este equipo».
 *
 * IDENTIDAD: el ámbito sale del contexto autenticado por el servidor (`useContextoBorradores()`), nunca se inventa. Al cambiar de
 * usuario, empresa, tipo o versión de esquema se crea un controlador NUEVO con su propio ámbito inmutable; el anterior se cierra
 * (con un guardado de mejor esfuerzo dirigido a SU propio ámbito, jamás al nuevo) y su estado no se mezcla: el hook solo entrega el
 * snapshot del controlador cuyo ámbito coincide con el actual.
 *
 * CONTRATO CON EL FORMULARIO: pasar un `payload` JSON y ESTABLE (memoizado); la primera lectura tras montar es la línea base y no
 * se guarda por sí sola. El formulario debe tratar el payload como inmutable y, si cambia de ámbito, reiniciarse (p. ej. `key`).
 */
export type OpcionesBorradorLocal<T> = {
  tipo: TipoBorrador;
  /** Versión explícita del esquema del payload (la define el adaptador del formulario). */
  esquemaVersion: number;
  /** Estado actual del formulario, ya reducido a datos JSON permitidos (sin archivos, sin secretos). */
  payload: T;
  /** Por defecto, el contexto autenticado del provider de sesión. `null` = sin identidad: el autoguardado queda inactivo. */
  contexto?: ContextoBorradores | null;
  habilitado?: boolean;
  debounceMs?: number;
  maxEsperaMs?: number;
  migrar?: (payload: unknown, desdeVersion: number) => unknown | null;
  /** Inyección para pruebas e integraciones; por defecto, IndexedDB real obedeciendo la preferencia por equipo. */
  nucleo?: NucleoBorradores;
  prefs?: AlmacenPreferencias | null;
  fabricaCanal?: FabricaCanal | null;
  ahora?: () => number;
};

export type BorradorLocal = {
  snapshot: SnapshotBorrador;
  /** Entrega el payload del borrador pendiente de decisión para que el formulario lo adopte. Nunca se aplica solo. */
  /** `validar` (opcional) se ejecuta ANTES de confirmar: si rechaza, no cambia ningún estado. */
  recuperar: (validar?: ValidadorPayload) => ReturnType<ControladorBorrador["recuperar"]>;
  /** «Decidir después»: no se escribe ni se elimina nada. */
  mantener: () => void;
  /** Elimina el borrador. Exige `{ confirmado: true }` (la confirmación la pide la interfaz). */
  descartar: (o: { confirmado: boolean }) => Promise<{ ok: true } | FalloAccion>;
  flush: () => Promise<void>;
  reintentar: () => Promise<void>;
  releer: () => Promise<{ ok: true; remoto: Borrador | null } | FalloAccion>;
  adoptarRemoto: (validar?: ValidadorPayload) => Promise<{ ok: true; payload: unknown } | FalloAccion>;
  conservarLocal: () => Promise<{ ok: true } | FalloAccion>;
  registrarEnvio: (claveEnvio: string) => Promise<{ ok: true } | FalloAccion>;
  resolverEnvio: (o: { estadoEnvio: "completado" | "ninguno"; claveEnvio?: string | null }) => Promise<{ ok: true } | FalloAccion>;
};

const SIN_CONTROLADOR: FalloAccion = { ok: false, motivo: "sin_controlador", mensaje: "El autoguardado no está activo." };

function snapshotInicial(fase: SnapshotBorrador["fase"]): SnapshotBorrador {
  return {
    fase, guardado: ESTADO_GUARDADO_INICIAL, guardadoEn: null, revision: null, recuperacion: null, conflicto: null, otraPestana: false,
    bloqueo: null, suspension: null, errorLectura: null, sinCanal: true, estadoEnvio: "ninguno", claveEnvio: null,
  };
}
const SNAP_SIN_CONTEXTO = snapshotInicial("sin_contexto");
const SNAP_CONSULTANDO = snapshotInicial("consultando");

let nucleoPorDefecto: NucleoBorradores | null = null;
/** Núcleo compartido por la página: IndexedDB real, obedeciendo en CADA operación la preferencia por equipo. */
export function obtenerNucleoAutoguardado(): NucleoBorradores {
  nucleoPorDefecto ??= crearNucleoBorradores({
    almacen: crearAlmacenSegunPreferencia(crearAlmacenIndexedDB(), almacenPreferenciasDelNavegador()),
    appBuild: "autoguardado-local",
  });
  return nucleoPorDefecto;
}

/** Tienda externa mínima: separa «qué controlador hay» de React y permite cambiarlo desde un efecto sin `setState`. */
function crearTienda() {
  let actual: ControladorBorrador | null = null;
  let clave: string | null = null;
  let snap: SnapshotBorrador | null = null;
  let quitar: () => void = () => undefined;
  const subs = new Set<() => void>();
  const emitir = () => { for (const f of [...subs]) f(); };
  return {
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    getSnapshot: () => snap,
    getClave: () => clave,
    get actual() { return actual; },
    poner(c: ControladorBorrador | null, nuevaClave: string | null) {
      quitar();
      actual = c; clave = nuevaClave; snap = c ? c.getSnapshot() : null;
      quitar = c ? c.subscribe(() => { snap = c.getSnapshot(); emitir(); }) : () => undefined;
      emitir();
    },
  };
}

export function useBorradorLocal<T>(opciones: OpcionesBorradorLocal<T>): BorradorLocal {
  const { tipo, esquemaVersion, payload, habilitado = true } = opciones;
  const delProvider = useContextoBorradores();
  const contexto = opciones.contexto !== undefined ? opciones.contexto : delProvider;
  const ownerKey = contexto?.ownerKey ?? null;
  const empresaId = contexto?.empresaId ?? null;
  const empresaSlug = contexto?.empresaSlug ?? null;
  const claveAmbito = ownerKey !== null && empresaId !== null && empresaSlug !== null && habilitado ? JSON.stringify([ownerKey, empresaId, empresaSlug, tipo, esquemaVersion]) : null;

  const tienda = useMemo(() => crearTienda(), []);
  const ultimo = useRef(opciones);
  const payloadRef = useRef<unknown>(payload);
  useEffect(() => { ultimo.current = opciones; payloadRef.current = payload; });

  const bruto = useSyncExternalStore(tienda.subscribe, tienda.getSnapshot, () => null);
  const claveTienda = useSyncExternalStore(tienda.subscribe, tienda.getClave, () => null);
  // Solo se entrega el estado del controlador cuyo ámbito es el ACTUAL: así no se mezclan estados al cambiar usuario/empresa/formulario.
  const snapshot = claveAmbito === null ? SNAP_SIN_CONTEXTO : bruto !== null && claveTienda === claveAmbito ? bruto : SNAP_CONSULTANDO;

  const debounceMs = opciones.debounceMs ?? DEBOUNCE_POR_DEFECTO_MS;
  const maxEsperaMs = opciones.maxEsperaMs ?? MAX_ESPERA_POR_DEFECTO_MS;
  const nucleoInyectado = opciones.nucleo;
  const prefsInyectadas = opciones.prefs;

  useEffect(() => {
    if (claveAmbito === null || ownerKey === null || empresaId === null || empresaSlug === null) { tienda.poner(null, null); return; }
    const o = ultimo.current;
    const ambito: AmbitoBorrador = { ownerKey, empresaId, empresaSlug, tipo };
    const prefs = prefsInyectadas !== undefined ? prefsInyectadas : almacenPreferenciasDelNavegador();
    const c = new ControladorBorrador({
      ambito, esquemaVersion, nucleo: nucleoInyectado ?? obtenerNucleoAutoguardado(), debounceMs, maxEsperaMs, ahora: o.ahora, prefs,
      fabricaCanal: o.fabricaCanal, migrar: (p, v) => ultimo.current.migrar?.(p, v) ?? null,
    });
    tienda.poner(c, claveAmbito);
    c.actualizarPayload(payloadRef.current); // línea base: el contenido inicial no se guarda por sí solo
    void c.iniciar();

    const alVisibilidad = () => { if (document.visibilityState === "hidden") c.alOcultarse(); else c.alVolverAPrimerPlano(); };
    const alOcultar = () => c.alOcultarse(); // mejor esfuerzo: no hay garantía de que el navegador complete la escritura
    const alAlmacenamiento = (e: StorageEvent) => { if (e.key === null || e.key === CLAVE_PREFERENCIA_PERSISTENCIA) c.alCambiarPreferencia(); };
    const alPreferenciaLocal = () => c.alCambiarPreferencia(true); // el usuario lo cambió en ESTA página
    document.addEventListener("visibilitychange", alVisibilidad);
    window.addEventListener("pagehide", alOcultar);
    window.addEventListener("storage", alAlmacenamiento);
    window.addEventListener(EVENTO_PREFERENCIA, alPreferenciaLocal);
    return () => {
      document.removeEventListener("visibilitychange", alVisibilidad);
      window.removeEventListener("pagehide", alOcultar);
      window.removeEventListener("storage", alAlmacenamiento);
      window.removeEventListener(EVENTO_PREFERENCIA, alPreferenciaLocal);
      c.dispose();
    };
    // `payload`, `migrar` y la fábrica de canal se leen por ref: cambiarlos NO reinicia el controlador.
  }, [claveAmbito, ownerKey, empresaId, empresaSlug, tipo, esquemaVersion, debounceMs, maxEsperaMs, tienda, nucleoInyectado, prefsInyectadas]);

  useEffect(() => {
    if (claveAmbito !== null && tienda.getClave() === claveAmbito) tienda.actual?.actualizarPayload(payload);
  }, [payload, claveAmbito, tienda]);

  const usar = useCallback(<R,>(f: (c: ControladorBorrador) => R, vacio: R): R => {
    const c = tienda.actual;
    return c && tienda.getClave() === claveAmbito ? f(c) : vacio;
  }, [tienda, claveAmbito]);

  return useMemo<BorradorLocal>(() => ({
    snapshot,
    recuperar: (v) => usar((c) => c.recuperar(v), SIN_CONTROLADOR),
    mantener: () => usar((c) => c.mantener(), undefined),
    descartar: (o) => usar((c) => c.descartar(o), Promise.resolve(SIN_CONTROLADOR)),
    flush: () => usar((c) => c.flush(), Promise.resolve()),
    reintentar: () => usar((c) => c.reintentar(), Promise.resolve()),
    releer: () => usar((c) => c.releer(), Promise.resolve(SIN_CONTROLADOR)),
    adoptarRemoto: (v) => usar((c) => c.adoptarRemoto(v), Promise.resolve(SIN_CONTROLADOR)),
    conservarLocal: () => usar((c) => c.conservarLocal(), Promise.resolve(SIN_CONTROLADOR)),
    registrarEnvio: (k) => usar((c) => c.registrarEnvio(k), Promise.resolve(SIN_CONTROLADOR)),
    resolverEnvio: (o) => usar((c) => c.resolverEnvio(o), Promise.resolve(SIN_CONTROLADOR)),
  }), [snapshot, usar]);
}
