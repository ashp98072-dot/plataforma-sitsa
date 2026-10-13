"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FirmaEntregaCampos, type FirmaEntregaHandle } from "@/components/tms/firma-entrega";
import { crearGuardEnvio, nuevaClaveEnvio } from "@/lib/idempotencia/clave-envio";
import type { EntregaDto, OpcionesRegistro } from "@/lib/entregas/presentacion";
import type { AreaEntrega, ModoEntrega } from "@/lib/entregas/catalogo";

/**
 * CONTROL DE ENTREGA en Solicitudes de fondo (PR 2). Componentes de presentación: TODA regla (permisos por área, custodia,
 * destinos, estados, firma, idempotencia) vive en el servidor / `src/lib/entregas`; aquí solo se consultan los endpoints y se
 * muestran sus resultados. Sin polling: se consulta al abrir y después de cada acción (o con «Actualizar»).
 */

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
const botonPrimario = "rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60";
const botonSecundario = "rounded border border-[var(--border)] px-3 py-1.5 text-sm";

export function fechaHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-GT", { timeZone: "America/Guatemala", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CLASE_ESTADO: Record<EntregaDto["estado"], string> = {
  EMITIDA: "border-amber-500/60 text-amber-300",
  RECIBIDA: "border-emerald-500/60 text-emerald-300",
  RECHAZADA: "border-red-500/60 text-red-300",
  ANULADA: "border-[var(--border)] text-[var(--muted)]",
};

export function EstadoEntregaBadge({ estado, etiqueta }: { estado: EntregaDto["estado"]; etiqueta: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] ${CLASE_ESTADO[estado]}`}>{etiqueta}</span>;
}

function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold">{titulo}</h3>
          <button type="button" onClick={onCerrar} className="text-xs text-[var(--muted)]" aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

type RespuestaJson = { error?: string; mensaje?: string };
async function leerJson(res: Response): Promise<RespuestaJson> {
  return (await res.json().catch(() => ({}))) as RespuestaJson;
}

/* ------------------------------------------------------------------ registrar entrega */

export function RegistrarEntregaModal({
  slug, solicitud, opciones, onCerrar, onHecho,
}: {
  slug: string;
  solicitud: { id: number; codigo: string };
  opciones: OpcionesRegistro;
  onCerrar: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const [destino, setDestino] = useState<AreaEntrega>(opciones.destinos[0]?.destino ?? "TESORERIA");
  const [modo, setModo] = useState<ModoEntrega>("SISTEMA");
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Doble clic: el guard es síncrono; la clave identifica ESTE intento y se reutiliza en cada reintento hasta que se confirme.
  const [guard] = useState(() => crearGuardEnvio());
  const claveRef = useRef<string | null>(null);
  const firmaRef = useRef<FirmaEntregaHandle>(null);
  const [firmaLista, setFirmaLista] = useState(false);

  async function emitir() {
    await guard.ejecutar(async () => {
      setEnviando(true); setError("");
      try {
        const fd = new FormData();
        fd.set("destino", destino);
        fd.set("modo", modo);
        fd.set("observaciones", observaciones.trim());
        fd.set("claveIdempotencia", (claveRef.current ??= nuevaClaveEnvio()));
        const errFirma = await firmaRef.current?.agregarA(fd);
        if (errFirma) { setError(errFirma); return; }
        const res = await fetch(`/api/empresas/${slug}/tms/fondos/${solicitud.id}/entregas`, { method: "POST", body: fd });
        const data = await leerJson(res);
        if (!res.ok) { setError(data.error ?? "No se pudo registrar la entrega."); return; }
        claveRef.current = null;
        onHecho(data.mensaje ?? "Entrega registrada.");
      } catch {
        setError("No se pudo contactar al servidor. Revisa tu conexión y vuelve a intentar.");
      } finally {
        setEnviando(false);
      }
    });
  }

  return (
    <Modal titulo={`Registrar entrega · ${solicitud.codigo}`} onCerrar={enviando ? () => undefined : onCerrar}>
      <p className="text-xs text-[var(--muted)]">
        Registrar una entrega deja constancia de quién entrega el expediente y a qué área. No autoriza ni liquida la solicitud.
      </p>
      <label className="block text-xs text-[var(--muted)]">Destino
        <select className={`${inputCls} mt-0.5 w-full`} value={destino} onChange={(e) => setDestino(e.target.value as AreaEntrega)} disabled={enviando}>
          {opciones.destinos.map((d) => <option key={d.destino} value={d.destino}>{d.etiquetaArea} — {d.etiqueta}</option>)}
        </select>
      </label>
      <label className="block text-xs text-[var(--muted)]">Modo
        <select className={`${inputCls} mt-0.5 w-full`} value={modo} onChange={(e) => setModo(e.target.value as ModoEntrega)} disabled={enviando || opciones.modos.length < 2}>
          <option value="SISTEMA">En el sistema (el receptor confirma con su usuario)</option>
          {opciones.modos.includes("PRESENCIAL") ? <option value="PRESENCIAL">Presencial (recibe una persona sin usuario)</option> : null}
        </select>
      </label>
      {modo === "PRESENCIAL" ? (
        <p className="text-[11px] text-amber-300">La recepción se registrará después, desde el historial, con el nombre y la firma dibujada de quien recibe.</p>
      ) : null}
      <label className="block text-xs text-[var(--muted)]">Observaciones (opcional)
        <textarea className={`${inputCls} mt-0.5 w-full`} rows={2} maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} disabled={enviando} />
      </label>
      <FirmaEntregaCampos slug={slug} sesionId={`entrega-${solicitud.id}`} handleRef={firmaRef} onListaCambia={setFirmaLista} disabled={enviando} />
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => void emitir()} disabled={enviando || !firmaLista} aria-busy={enviando} className={botonPrimario}>
          {enviando ? "Emitiendo…" : "Emitir entrega"}
        </button>
        <button type="button" onClick={onCerrar} disabled={enviando} className={botonSecundario}>Cancelar</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ acciones sobre una entrega */

/** Modal de motivo obligatorio (rechazar / anular). */
function MotivoModal({
  titulo, descripcion, etiquetaBoton, url, onCerrar, onHecho,
}: {
  titulo: string; descripcion: string; etiquetaBoton: string; url: string;
  onCerrar: () => void; onHecho: (mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [guard] = useState(() => crearGuardEnvio());

  async function enviar() {
    if (!motivo.trim()) { setError("Indica el motivo."); return; }
    await guard.ejecutar(async () => {
      setEnviando(true); setError("");
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo: motivo.trim() }) });
        const data = await leerJson(res);
        if (!res.ok) { setError(data.error ?? "No se pudo completar la acción."); return; }
        onHecho(data.mensaje ?? "Listo.");
      } catch {
        setError("No se pudo contactar al servidor. Revisa tu conexión y vuelve a intentar.");
      } finally {
        setEnviando(false);
      }
    });
  }

  return (
    <Modal titulo={titulo} onCerrar={enviando ? () => undefined : onCerrar}>
      <p className="text-xs text-[var(--muted)]">{descripcion}</p>
      <label className="block text-xs text-[var(--muted)]">Motivo *
        <textarea className={`${inputCls} mt-0.5 w-full`} rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={enviando} />
      </label>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => void enviar()} disabled={enviando} aria-busy={enviando} className={botonPrimario}>{enviando ? "Enviando…" : etiquetaBoton}</button>
        <button type="button" onClick={onCerrar} disabled={enviando} className={botonSecundario}>Cancelar</button>
      </div>
    </Modal>
  );
}

/** Confirmar recepción en el sistema: firma obligatoria + observaciones opcionales. */
function RecibirModal({ slug, entrega, onCerrar, onHecho }: { slug: string; entrega: EntregaDto; onCerrar: () => void; onHecho: (m: string) => void }) {
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [guard] = useState(() => crearGuardEnvio());
  const firmaRef = useRef<FirmaEntregaHandle>(null);
  const [firmaLista, setFirmaLista] = useState(false);

  async function recibir() {
    await guard.ejecutar(async () => {
      setEnviando(true); setError("");
      try {
        const fd = new FormData();
        fd.set("observaciones", observaciones.trim());
        const errFirma = await firmaRef.current?.agregarA(fd);
        if (errFirma) { setError(errFirma); return; }
        const res = await fetch(`/api/empresas/${slug}/tms/fondos/entregas/${entrega.id}/recibir`, { method: "POST", body: fd });
        const data = await leerJson(res);
        if (!res.ok) { setError(data.error ?? "No se pudo registrar la recepción."); return; }
        onHecho(data.mensaje ?? "Recepción registrada.");
      } catch {
        setError("No se pudo contactar al servidor. Revisa tu conexión y vuelve a intentar.");
      } finally {
        setEnviando(false);
      }
    });
  }

  return (
    <Modal titulo={`Recibir entrega · ${entrega.documentoCodigo ?? "Solicitud"}`} onCerrar={enviando ? () => undefined : onCerrar}>
      <p className="text-xs text-[var(--muted)]">
        {entrega.origenEtiqueta} → {entrega.destinoEtiqueta}, emitida por {entrega.emitidoPor}. Al firmar confirmas que recibiste el expediente.
      </p>
      <label className="block text-xs text-[var(--muted)]">Observaciones (opcional)
        <textarea className={`${inputCls} mt-0.5 w-full`} rows={2} maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} disabled={enviando} />
      </label>
      <FirmaEntregaCampos slug={slug} sesionId={`recibir-${entrega.id}`} handleRef={firmaRef} onListaCambia={setFirmaLista} disabled={enviando} />
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => void recibir()} disabled={enviando || !firmaLista} aria-busy={enviando} className={botonPrimario}>{enviando ? "Registrando…" : "Confirmar recepción"}</button>
        <button type="button" onClick={onCerrar} disabled={enviando} className={botonSecundario}>Cancelar</button>
      </div>
    </Modal>
  );
}

/** Recepción presencial: nombre de quien recibe + firma DIBUJADA obligatoria (sin documento de identidad). */
function PresencialModal({ slug, entrega, onCerrar, onHecho }: { slug: string; entrega: EntregaDto; onCerrar: () => void; onHecho: (m: string) => void }) {
  const [nombre, setNombre] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [guard] = useState(() => crearGuardEnvio());
  const firmaRef = useRef<FirmaEntregaHandle>(null);
  const [firmaLista, setFirmaLista] = useState(false);

  async function registrar() {
    if (!nombre.trim()) { setError("Indica el nombre de quien recibe."); return; }
    await guard.ejecutar(async () => {
      setEnviando(true); setError("");
      try {
        const fd = new FormData();
        fd.set("nombreReceptor", nombre.trim());
        fd.set("observaciones", observaciones.trim());
        const errFirma = await firmaRef.current?.agregarA(fd);
        if (errFirma) { setError(errFirma); return; }
        const res = await fetch(`/api/empresas/${slug}/tms/fondos/entregas/${entrega.id}/presencial`, { method: "POST", body: fd });
        const data = await leerJson(res);
        if (!res.ok) { setError(data.error ?? "No se pudo registrar la recepción."); return; }
        onHecho(data.mensaje ?? "Recepción presencial registrada.");
      } catch {
        setError("No se pudo contactar al servidor. Revisa tu conexión y vuelve a intentar.");
      } finally {
        setEnviando(false);
      }
    });
  }

  return (
    <Modal titulo="Registrar recepción presencial" onCerrar={enviando ? () => undefined : onCerrar}>
      <p className="text-xs text-[var(--muted)]">
        {entrega.origenEtiqueta} → {entrega.destinoEtiqueta}. Quien recibe firma en este dispositivo; quedará registrado que tú lo operaste.
      </p>
      <label className="block text-xs text-[var(--muted)]">Nombre de quien recibe *
        <input className={`${inputCls} mt-0.5 w-full`} maxLength={200} value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={enviando} />
      </label>
      <label className="block text-xs text-[var(--muted)]">Observaciones (opcional)
        <textarea className={`${inputCls} mt-0.5 w-full`} rows={2} maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} disabled={enviando} />
      </label>
      <FirmaEntregaCampos slug={slug} sesionId={`presencial-${entrega.id}`} handleRef={firmaRef} onListaCambia={setFirmaLista} soloDibujada disabled={enviando} />
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => void registrar()} disabled={enviando || !firmaLista} aria-busy={enviando} className={botonPrimario}>{enviando ? "Registrando…" : "Registrar recepción"}</button>
        <button type="button" onClick={onCerrar} disabled={enviando} className={botonSecundario}>Cancelar</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ historial de un documento */

type Historial = { entregas: EntregaDto[]; custodia: { area: AreaEntrega; etiqueta: string } };
type AccionAbierta = { tipo: "anular" | "presencial"; entrega: EntregaDto } | null;

export function HistorialEntregas({
  slug, solicitudId, version, onCambio,
}: {
  slug: string; solicitudId: number; version: number; onCambio: (mensaje: string) => void;
}) {
  const [datos, setDatos] = useState<Historial | null>(null);
  const [error, setError] = useState("");
  const [accion, setAccion] = useState<AccionAbierta>(null);

  useEffect(() => {
    let vigente = true;
    fetch(`/api/empresas/${slug}/tms/fondos/${solicitudId}/entregas`)
      .then(async (res) => ({ ok: res.ok, data: (await res.json().catch(() => ({}))) as Historial & RespuestaJson }))
      .then(({ ok, data }) => {
        if (!vigente) return;
        if (!ok) { setError(data.error ?? "No se pudo cargar el historial de entregas."); return; }
        setError(""); setDatos(data);
      })
      .catch(() => { if (vigente) setError("No se pudo cargar el historial de entregas."); });
    return () => { vigente = false; };
  }, [slug, solicitudId, version]);

  if (error) return <p className="mt-2 text-xs text-red-300">{error}</p>;
  if (!datos) return <p className="mt-2 text-xs text-[var(--muted)]">Cargando entregas…</p>;

  return (
    <div className="mt-2 space-y-2 rounded border border-[var(--border)]/60 p-2 text-xs">
      <p className="text-[var(--muted)]">Custodia actual: <span className="text-[var(--foreground)]">{datos.custodia.etiqueta}</span></p>
      {datos.entregas.length === 0 ? <p className="text-[var(--muted)]">Sin entregas registradas.</p> : null}
      {[...datos.entregas].reverse().map((e) => (
        <div key={e.id} className="space-y-0.5 rounded border border-[var(--border)]/50 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{e.origenEtiqueta} → {e.destinoEtiqueta}</span>
            <EstadoEntregaBadge estado={e.estado} etiqueta={e.estadoEtiqueta} />
            <span className="text-[var(--muted)]">{e.modoEtiqueta}</span>
          </div>
          <p>Emitida por {e.emitidoPor} · {fechaHora(e.emitidoEn)}</p>
          {e.observacionesEmision ? <p className="text-[var(--muted)]">Observaciones: {e.observacionesEmision}</p> : null}
          {e.estado === "RECIBIDA" ? (
            <p>
              Recibida por {e.recibidoPor ?? "—"} · {fechaHora(e.recibidoEn)}
              {e.recepcionOperadaPor ? ` (registrada por ${e.recepcionOperadaPor})` : ""}
            </p>
          ) : null}
          {e.estado === "RECIBIDA" && e.observacionesRecepcion ? <p className="text-[var(--muted)]">Observaciones de recepción: {e.observacionesRecepcion}</p> : null}
          {e.estado === "RECHAZADA" || e.estado === "ANULADA" ? (
            <p className="text-red-300">
              {e.estado === "RECHAZADA" ? "Rechazada" : "Anulada"} por {e.cerradoPor ?? "—"} · {fechaHora(e.cerradoEn)}. Motivo: {e.motivoCierre ?? "—"}
            </p>
          ) : null}
          {e.acciones.presencial || e.acciones.anular ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {e.acciones.presencial ? <button type="button" onClick={() => setAccion({ tipo: "presencial", entrega: e })} className="rounded border border-[var(--border)] px-2 py-1">Registrar recepción presencial</button> : null}
              {e.acciones.anular ? <button type="button" onClick={() => setAccion({ tipo: "anular", entrega: e })} className="rounded border border-red-500/50 px-2 py-1 text-red-300">Anular entrega</button> : null}
            </div>
          ) : null}
        </div>
      ))}
      {accion?.tipo === "anular" ? (
        <MotivoModal
          titulo="Anular entrega"
          descripcion="Solo se puede anular una entrega que aún no ha sido recibida. Una entrega recibida se corrige con una devolución."
          etiquetaBoton="Anular entrega"
          url={`/api/empresas/${slug}/tms/fondos/entregas/${accion.entrega.id}/anular`}
          onCerrar={() => setAccion(null)}
          onHecho={(m) => { setAccion(null); onCambio(m); }}
        />
      ) : null}
      {accion?.tipo === "presencial" ? (
        <PresencialModal slug={slug} entrega={accion.entrega} onCerrar={() => setAccion(null)} onHecho={(m) => { setAccion(null); onCambio(m); }} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ bandeja «Entregas por recibir» */

type AccionBandeja = { tipo: "recibir" | "rechazar"; entrega: EntregaDto } | null;

export function EntregasPorRecibir({ slug, version, onCambio }: { slug: string; version: number; onCambio: (mensaje: string) => void }) {
  const [entregas, setEntregas] = useState<EntregaDto[] | null>(null);
  const [error, setError] = useState("");
  const [accion, setAccion] = useState<AccionBandeja>(null);
  const [recarga, setRecarga] = useState(0);

  const cargar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let vigente = true;
    fetch(`/api/empresas/${slug}/tms/fondos/entregas/por-recibir`)
      .then(async (res) => ({ ok: res.ok, data: (await res.json().catch(() => ({}))) as { entregas?: EntregaDto[] } & RespuestaJson }))
      .then(({ ok, data }) => {
        if (!vigente) return;
        if (!ok) { setError(data.error ?? "No se pudieron cargar las entregas por recibir."); return; }
        setError(""); setEntregas(data.entregas ?? []);
      })
      .catch(() => { if (vigente) setError("No se pudieron cargar las entregas por recibir."); });
    return () => { vigente = false; };
  }, [slug, version, recarga]);

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Entregas por recibir{entregas ? ` (${entregas.length})` : ""}</p>
        <button type="button" onClick={cargar} className="rounded border border-[var(--border)] px-2 py-1 text-xs">Actualizar</button>
      </div>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {entregas && entregas.length === 0 && !error ? <p className="text-xs text-[var(--muted)]">No tienes entregas pendientes de recibir.</p> : null}
      {(entregas ?? []).map((e) => (
        <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 rounded border border-[var(--border)]/60 p-2 text-xs">
          <div className="space-y-0.5">
            <p><span className="font-medium">{e.documentoCodigo ?? "Solicitud"}</span> · {e.origenEtiqueta} → {e.destinoEtiqueta}</p>
            <p className="text-[var(--muted)]">Emitida por {e.emitidoPor} · {fechaHora(e.emitidoEn)}</p>
            {e.observacionesEmision ? <p className="text-[var(--muted)]">Observaciones: {e.observacionesEmision}</p> : null}
          </div>
          <div className="flex gap-2">
            {e.acciones.recibir ? <button type="button" onClick={() => setAccion({ tipo: "recibir", entrega: e })} className="rounded bg-emerald-600 px-2 py-1 text-white">Recibir</button> : null}
            {e.acciones.rechazar ? <button type="button" onClick={() => setAccion({ tipo: "rechazar", entrega: e })} className="rounded bg-red-600 px-2 py-1 text-white">Rechazar</button> : null}
          </div>
        </div>
      ))}
      {accion?.tipo === "recibir" ? (
        <RecibirModal slug={slug} entrega={accion.entrega} onCerrar={() => setAccion(null)} onHecho={(m) => { setAccion(null); cargar(); onCambio(m); }} />
      ) : null}
      {accion?.tipo === "rechazar" ? (
        <MotivoModal
          titulo="Rechazar entrega"
          descripcion="El documento seguirá en custodia de quien lo entregó. Indica por qué rechazas la recepción."
          etiquetaBoton="Rechazar entrega"
          url={`/api/empresas/${slug}/tms/fondos/entregas/${accion.entrega.id}/rechazar`}
          onCerrar={() => setAccion(null)}
          onHecho={(m) => { setAccion(null); cargar(); onCambio(m); }}
        />
      ) : null}
    </div>
  );
}
