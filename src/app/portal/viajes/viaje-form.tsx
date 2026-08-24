"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { AsignacionOperativaPortal, ViajeAbiertoPiloto } from "@/lib/flota/viajes-piloto";
import type { PlanParada } from "@/lib/tms/paradas";

function fechaEnEspanol(fecha: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha || "Fecha pendiente";
  const [a, m, d] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("es-GT", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(a, m - 1, d));
}

function regresoEnEspanol(valor: string | null) {
  if (!valor) return "Pendiente";
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? valor : new Intl.DateTimeFormat("es-GT", { dateStyle: "long", timeStyle: "short" }).format(fecha);
}

export default function ViajeForm({ tipo, viajeAbierto, asignaciones, asignacionEnCurso, viajeEnCursoId, paradas, viajeDestacadoId }: {
  tipo: "Piloto" | "Auxiliar";
  viajeAbierto: ViajeAbiertoPiloto | null;
  asignaciones: AsignacionOperativaPortal[];
  asignacionEnCurso: AsignacionOperativaPortal | null;
  viajeEnCursoId: number | null;
  paradas: PlanParada[];
  viajeDestacadoId: number | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(false);
  const programados = asignaciones.filter((a) => a.estado === "Programado" && !a.viajeId);
  const viajeDestacadoAsignado = Boolean(
    viajeDestacadoId && asignaciones.some((a) => a.planId === viajeDestacadoId),
  );
  const planInicial = programados.find((a) => a.planId === viajeDestacadoId) ?? programados[0];
  const [planId, setPlanId] = useState(planInicial?.planId ?? 0);
  const planSeleccionado = programados.find((a) => a.planId === planId) ?? null;
  const [placa, setPlaca] = useState(planSeleccionado?.placa ?? "");
  const [kmSalida, setKmSalida] = useState("");
  const [kmCarga, setKmCarga] = useState("");
  const [destino, setDestino] = useState(planSeleccionado?.destino ?? "");
  const [kmLlegada, setKmLlegada] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [foto, setFoto] = useState<{ blob: Blob; url: string; etapa: string } | null>(null);
  const [cierreExcepcional, setCierreExcepcional] = useState(false);
  const [motivoExcepcional, setMotivoExcepcional] = useState("");
  const odometroFuncional = viajeAbierto?.odometroFuncional ?? planSeleccionado?.odometroFuncional ?? true;

  const siguienteParada = paradas.find((p) => p.requiere_evidencia && p.evidencias < 1) ?? null;
  const etapa = viajeAbierto
    ? odometroFuncional && !viajeAbierto.evidenciaTableroSalida
      ? { tipo: "tablero_salida", titulo: "Evidencia de salida", detalle: "Fotografía del tablero al salir del predio.", paradaId: 0 }
      : odometroFuncional && viajeAbierto.kmCarga == null ? null
        : !viajeAbierto.evidenciaCarga
          ? { tipo: "salida", titulo: "Evidencia de carga", detalle: "Adjunta la evidencia al completar la carga.", paradaId: 0 }
          : siguienteParada
            ? { tipo: "producto", titulo: `Siguiente parada: ${siguienteParada.orden}. ${siguienteParada.lugar_nombre}`, detalle: "Al llegar, adjunta la evidencia para habilitar la siguiente parada.", paradaId: siguienteParada.id }
            : odometroFuncional && !viajeAbierto.evidenciaTableroLlegada
              ? { tipo: "tablero_llegada", titulo: "Regreso al predio", detalle: "Ya en el predio, adjunta el tablero de llegada.", paradaId: 0 }
              : null
    : null;
  const rutaCompleta = Boolean(viajeAbierto?.evidenciaCarga && !siguienteParada && (!odometroFuncional || (viajeAbierto.evidenciaTableroSalida && viajeAbierto.kmCarga != null && viajeAbierto.evidenciaTableroLlegada)));

  useEffect(() => {
    if (!viajeDestacadoId || !viajeDestacadoAsignado) return;
    document.getElementById(`viaje-${viajeDestacadoId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [viajeDestacadoAsignado, viajeDestacadoId]);

  useEffect(() => {
    const intervalo = window.setInterval(() => router.refresh(), 5000);
    return () => {
      window.clearInterval(intervalo);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [router]);

  const etapaClave = etapa ? `${etapa.tipo}:${etapa.paradaId}` : "";
  const fotoActual = foto?.etapa === etapaClave ? foto : null;

  function detenerCamara() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCamaraActiva(false);
  }

  async function abrirCamara() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este dispositivo o navegador no permite abrir la cámara directamente.");
      return;
    }
    try {
      detenerCamara();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCamaraActiva(true);
    } catch {
      setError("No se pudo abrir la cámara. Autoriza el permiso de cámara e inténtalo nuevamente.");
    }
  }

  async function tomarFoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1) {
      setError("La cámara todavía no está lista.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return setError("No se pudo capturar la fotografía.");
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    setFoto({ blob, url, etapa: etapaClave });
    detenerCamara();
  }

  function elegirPlan(id: number) {
    setPlanId(id);
    const plan = programados.find((a) => a.planId === id);
    setPlaca(plan?.placa ?? ""); setDestino(plan?.destino ?? "");
  }

  async function enviar(payload: Record<string, unknown>) {
    setError(""); setMensaje(""); setLoading(true);
    try {
      const res = await fetch("/api/portal/viajes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo completar la acción.");
      setMensaje(data.mensaje ?? "Listo.");
      setKmSalida(""); setKmCarga(""); setKmLlegada(""); setObservaciones(""); setMotivoExcepcional(""); setCierreExcepcional(false);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo completar la acción."); }
    finally { setLoading(false); }
  }

  async function onSalida(e: FormEvent) {
    e.preventDefault();
    const km = odometroFuncional ? Number(kmSalida) : undefined;
    if (!placa.trim() || (odometroFuncional && (!Number.isFinite(km) || Number(km) < 0))) return setError("Indica la unidad y un kilometraje de salida válido.");
    await enviar({ accion: "salida", placa: placa.trim(), kmSalida: km, destino: destino.trim() || undefined, planId: planId || undefined });
  }

  async function onCarga(e: FormEvent) {
    e.preventDefault();
    if (!viajeAbierto) return;
    const km = Number(kmCarga);
    if (!Number.isFinite(km) || viajeAbierto.kmSalida == null || km < viajeAbierto.kmSalida) return setError("El kilometraje de carga no puede ser menor al de salida.");
    await enviar({ accion: "carga", viajeId: viajeAbierto.id, kmCarga: km });
  }

  async function obtenerGps(): Promise<{ latitud?: number; longitud?: number }> {
    if (!("geolocation" in navigator)) return {};
    return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitud: p.coords.latitude, longitud: p.coords.longitude }), () => resolve({}),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    ));
  }

  async function onLlegada(e: FormEvent) {
    e.preventDefault();
    if (!viajeAbierto) return;
    const km = odometroFuncional ? Number(kmLlegada) : undefined;
    const kmMinimo = viajeAbierto.kmCarga ?? viajeAbierto.kmSalida;
    if (odometroFuncional && (!Number.isFinite(km) || kmMinimo == null || Number(km) < kmMinimo)) return setError("El kilometraje final no puede ser menor al último registrado.");
    if (cierreExcepcional && motivoExcepcional.trim().length < 10) return setError("Describe el contratiempo mayor con al menos 10 caracteres.");
    if (!cierreExcepcional && !rutaCompleta) return setError("Completa toda la ruta y regresa al predio antes de cerrar.");
    const gps = cierreExcepcional ? {} : await obtenerGps();
    await enviar({ accion: "llegada", viajeId: viajeAbierto.id, kmLlegada: km, observaciones: observaciones.trim() || undefined, cierreExcepcional, motivoExcepcional: cierreExcepcional ? motivoExcepcional.trim() : undefined, ...gps });
  }

  async function subirEvidencias(e: FormEvent) {
    e.preventDefault();
    if (!viajeEnCursoId || !etapa || !fotoActual) return setError("Toma la fotografía desde la cámara antes de continuar.");
    setError(""); setMensaje(""); setLoading(true);
    try {
      const gps = await obtenerGps();
      if (gps.latitud == null || gps.longitud == null) {
        throw new Error("Activa y autoriza la ubicación GPS para guardar la evidencia.");
      }
      const form = new FormData();
      form.set("tipo", etapa.tipo);
      if (etapa.paradaId) form.set("paradaId", String(etapa.paradaId));
      if (gps.latitud != null) form.set("latitud", String(gps.latitud));
      if (gps.longitud != null) form.set("longitud", String(gps.longitud));
      form.append("files", fotoActual.blob, `evidencia_${Date.now()}.jpg`);
      const res = await fetch(`/api/portal/viajes/${viajeEnCursoId}/evidencias`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudieron guardar las evidencias.");
      setMensaje(data.mensaje);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setFoto(null);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudieron guardar las evidencias."); }
    finally { setLoading(false); }
  }

  return <div className="mt-6 space-y-5">
    {error ? <p className="rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300" role="alert">{error}</p> : null}
    {mensaje ? <p className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3 text-sm text-[#8fd4a0]" role="status">{mensaje}</p> : null}

    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Asignaciones</h2>
      {!asignaciones.length ? <p className="mt-2 text-sm text-[var(--muted)]">No tienes viajes recientes o próximos asignados.</p> : <div className="mt-3 space-y-3">
        {asignaciones.map((a) => <article id={`viaje-${a.planId}`} key={a.planId} className={`rounded-xl border p-4 text-sm ${a.planId === viajeDestacadoId ? "border-sky-400 bg-sky-950/20 ring-1 ring-sky-500/40" : "border-[var(--border)]"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{a.codigo}</strong><span className="rounded-full bg-[var(--input)] px-2 py-1 text-xs">{a.viajeEstado === "abierto" ? "EN VIAJE" : a.estado}</span></div>
          <p className="mt-2 text-[var(--muted)]"><span className="text-[var(--foreground)]">Fecha de salida:</span> {fechaEnEspanol(a.fecha)}{a.horaSalida ? ` a las ${a.horaSalida.slice(0, 5)}` : ""}</p>
          <p className="mt-1 text-[var(--muted)]"><span className="text-[var(--foreground)]">Cliente:</span> {a.cliente ?? "Sin cliente"}</p>
          <p className="mt-1 text-[var(--muted)]"><span className="text-[var(--foreground)]">Ruta:</span> {a.origen ?? "Origen pendiente"} → {a.destino ?? "Destino pendiente"}</p>
          <p className="mt-1 text-[var(--muted)]"><span className="text-[var(--foreground)]">Regreso estimado:</span> {regresoEnEspanol(a.regresoEstimado)}</p>
          <p className="mt-1 text-[var(--muted)]"><span className="text-[var(--foreground)]">Unidad:</span> {a.placa ?? "Pendiente"} · <span className="text-[var(--foreground)]">Piloto:</span> {a.piloto ?? "Pendiente"}</p>
          {a.auxiliares.length ? <p className="mt-1 text-[var(--muted)]">Auxiliares: {a.auxiliares.join(", ")}</p> : null}
        </article>)}
      </div>}
    </section>

    {viajeAbierto ? <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Avance del viaje · {asignacionEnCurso?.codigo ?? `#${viajeAbierto.id}`}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Unidad {viajeAbierto.placa}{odometroFuncional && viajeAbierto.kmSalida != null ? ` · salida ${viajeAbierto.kmSalida.toLocaleString("es-GT")} km` : " · sin odómetro funcional"}</p>
      <ol className="mt-4 space-y-2 text-sm">
        {odometroFuncional ? <><li>{viajeAbierto.evidenciaTableroSalida ? "✓" : "○"} Tablero de salida</li><li>{viajeAbierto.kmCarga != null ? "✓" : "○"} Kilometraje en carga{viajeAbierto.kmCarga != null ? `: ${viajeAbierto.kmCarga.toLocaleString("es-GT")} km` : ""}</li></> : null}
        <li>{viajeAbierto.evidenciaCarga ? "✓" : "○"} Evidencia de carga</li>
        {paradas.map((p) => <li key={p.id}>{!p.requiere_evidencia || p.evidencias > 0 ? "✓" : "○"} Parada {p.orden}: {p.lugar_nombre}</li>)}
        <li>{odometroFuncional ? (viajeAbierto.evidenciaTableroLlegada ? "✓" : "○") : "○"} Regreso al predio{odometroFuncional ? " y tablero de llegada" : " (sin kilometraje)"}</li>
      </ol>
    </section> : null}

    {odometroFuncional && viajeAbierto?.evidenciaTableroSalida && viajeAbierto.kmCarga == null ? <form onSubmit={onCarga} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Registrar llegada al punto de carga</h2>
      <label className="mt-4 block text-sm text-[var(--muted)]">Kilometraje en carga<input type="number" min={viajeAbierto.kmSalida ?? 0} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={kmCarga} onChange={(e) => setKmCarga(e.target.value)} required /></label>
      <button className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={loading}>Registrar kilometraje de carga</button>
    </form> : null}

    {viajeEnCursoId && etapa ? <form onSubmit={subirEvidencias} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">{etapa.titulo}</h2><p className="mt-1 text-sm text-[var(--muted)]">{etapa.detalle}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">La evidencia debe tomarse ahora. Se guardarán fecha, hora y ubicación GPS; no se permite seleccionar archivos de la galería.</p>
      <video ref={videoRef} className={`mt-4 w-full rounded-xl bg-black ${camaraActiva ? "block" : "hidden"}`} playsInline muted />
      {fotoActual ? <Image src={fotoActual.url} alt="Vista previa de la evidencia capturada" width={1280} height={720} unoptimized className="mt-4 h-auto w-full rounded-xl" /> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {!camaraActiva ? <button type="button" className="rounded-lg bg-[#334155] px-4 py-2.5 font-medium text-white" onClick={() => void abrirCamara()}>{fotoActual ? "Tomar otra foto" : "Abrir cámara"}</button> : null}
        {camaraActiva ? <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white" onClick={() => void tomarFoto()}>Tomar foto</button> : null}
        {camaraActiva ? <button type="button" className="rounded-lg border border-[var(--border)] px-4 py-2.5" onClick={detenerCamara}>Cancelar cámara</button> : null}
      </div>
      <button className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={loading || !fotoActual}>Guardar evidencia y continuar</button>
    </form> : null}

    {tipo === "Piloto" && viajeAbierto ? <form onSubmit={onLlegada} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Cerrar viaje</h2>
      {!rutaCompleta && !cierreExcepcional ? <p className="mt-2 text-sm text-amber-300">El cierre normal se habilitará cuando completes la carga, todas las paradas y regreses al predio.</p> : null}
      <label className="mt-4 flex items-start gap-2 text-sm text-[var(--muted)]"><input type="checkbox" className="mt-1" checked={cierreExcepcional} onChange={(e) => setCierreExcepcional(e.target.checked)} /> Cierre excepcional por contratiempo mayor (por ejemplo, avería de la unidad)</label>
      {cierreExcepcional ? <label className="mt-3 block text-sm text-[var(--muted)]">Motivo obligatorio<textarea className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" rows={3} minLength={10} maxLength={500} value={motivoExcepcional} onChange={(e) => setMotivoExcepcional(e.target.value)} required /></label> : null}
      {rutaCompleta || cierreExcepcional ? <>
        {odometroFuncional ? <label className="mt-3 block text-sm text-[var(--muted)]">Kilometraje al cerrar<input type="number" min={viajeAbierto.kmCarga ?? viajeAbierto.kmSalida ?? 0} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={kmLlegada} onChange={(e) => setKmLlegada(e.target.value)} required /></label> : null}
        {!cierreExcepcional ? <label className="mt-3 block text-sm text-[var(--muted)]">Observaciones<textarea className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" rows={2} maxLength={500} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></label> : null}
        <button className={`mt-4 rounded-lg px-4 py-2.5 font-medium text-white disabled:opacity-50 ${cierreExcepcional ? "bg-red-700" : "bg-[var(--accent)]"}`} disabled={loading}>{cierreExcepcional ? "Cerrar por contratiempo mayor" : "Registrar llegada y cerrar viaje"}</button>
      </> : null}
    </form> : null}

    {!viajeAbierto && tipo === "Piloto" ? <form onSubmit={onSalida} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Iniciar viaje</h2>
      {programados.length ? <label className="mt-4 block text-sm text-[var(--muted)]">Viaje asignado<select className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={planId} onChange={(e) => elegirPlan(Number(e.target.value))}>{programados.map((a) => <option key={a.planId} value={a.planId}>{a.codigo} · {a.cliente ?? "Sin cliente"} · {a.placa ?? "Sin unidad"}</option>)}</select></label> : <p className="mt-2 text-sm text-amber-300">No hay programación pendiente; registra una salida manual solo si Operaciones lo indicó.</p>}
      <label className="mt-3 block text-sm text-[var(--muted)]">Placa<input className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 uppercase" value={placa} onChange={(e) => setPlaca(e.target.value)} required readOnly={Boolean(planSeleccionado?.placa)} /></label>
      {odometroFuncional ? <label className="mt-3 block text-sm text-[var(--muted)]">Km de salida<input type="number" min={0} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={kmSalida} onChange={(e) => setKmSalida(e.target.value)} required /></label> : <p className="mt-3 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-sm text-amber-200">Unidad sin odómetro funcional: no se solicitará kilometraje ni fotografía del tablero.</p>}
      <label className="mt-3 block text-sm text-[var(--muted)]">Destino<input className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={destino} onChange={(e) => setDestino(e.target.value)} maxLength={200} /></label>
      <button className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={loading}>Iniciar viaje</button>
    </form> : null}
  </div>;
}
