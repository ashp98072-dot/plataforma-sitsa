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

// VIAT-1 — el colaborador solo ve el estado del viático en lenguaje simple,
// nunca quién autorizó/entregó ni referencias de pago.
const ESTADO_VIATICO_LABEL: Record<string, string> = {
  PROGRAMADO: "Pendiente de autorizar",
  AUTORIZADO: "Autorizado",
  ENTREGADO: "Entregado",
  LIQUIDADO: "Liquidado",
};

// PORTAL-HARDENING-2 (Fase C/D): vocabulario simplificado de evidencia —
// mismo mapeo que TIPOS en api/portal/viajes/[id]/evidencias/route.ts.
const TIPOS_EVIDENCIA: { value: "tablero_salida" | "producto" | "tablero_llegada" | "otro"; label: string }[] = [
  { value: "tablero_salida", label: "Salida (tablero/odómetro)" },
  { value: "producto", label: "Parada / dirección" },
  { value: "tablero_llegada", label: "Llegada (tablero/odómetro)" },
  { value: "otro", label: "Otro" },
];

type GpsCoords = { latitud: number; longitud: number };

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
  // PORTAL-HARDENING-2 (Fase G): "Cargado" es un candidato de salida tan
  // válido como "Programado" — antes solo se mostraba "Programado" en el
  // selector y el viaje quedaba atascado si Operaciones ya lo había
  // marcado Cargado a mano.
  const programados = asignaciones.filter((a) => (a.estado === "Programado" || a.estado === "Cargado") && !a.viajeId);
  const viajeDestacadoAsignado = Boolean(
    viajeDestacadoId && asignaciones.some((a) => a.planId === viajeDestacadoId),
  );
  const planInicial = programados.find((a) => a.planId === viajeDestacadoId) ?? programados[0];
  const [planId, setPlanId] = useState(planInicial?.planId ?? 0);
  const planSeleccionado = programados.find((a) => a.planId === planId) ?? null;
  const [placa, setPlaca] = useState(planSeleccionado?.placa ?? "");
  const [kmSalida, setKmSalida] = useState("");
  const [destino, setDestino] = useState(planSeleccionado?.destino ?? "");
  const [kmLlegada, setKmLlegada] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [motivoContratiempo, setMotivoContratiempo] = useState("");
  const [mostrarContratiempo, setMostrarContratiempo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [foto, setFoto] = useState<{ blob: Blob; url: string; etapa: string } | null>(null);
  const odometroFuncional = viajeAbierto?.odometroFuncional ?? planSeleccionado?.odometroFuncional ?? true;

  // PORTAL-HARDENING-2 (Fase C): el piloto elige el tipo de evidencia y,
  // si es de parada, la dirección exacta — ya no se calcula "la
  // siguiente parada" automáticamente ni se exige un orden.
  const paradaPendienteSugerida = paradas.find((p) => p.requiere_evidencia && p.evidencias < 1) ?? paradas[0] ?? null;
  const [tipoEvidencia, setTipoEvidencia] = useState<"tablero_salida" | "producto" | "tablero_llegada" | "otro">(
    paradas.length ? "producto" : "tablero_salida",
  );
  const [paradaSeleccionada, setParadaSeleccionada] = useState<number>(paradaPendienteSugerida?.id ?? 0);
  const paradasSinEvidencia = paradas.filter((p) => p.requiere_evidencia && p.evidencias < 1);

  // PORTAL-HARDENING-2 (Fase D): GPS + hora de servidor cacheados ANTES de
  // disparar la foto, para poder dibujar el sello en el mismo instante de
  // la captura (canvas → overlay → toBlob), sin depender de una segunda
  // red después de tomar la foto.
  const [gps, setGps] = useState<GpsCoords | null>(null);
  const [gpsError, setGpsError] = useState("");
  const offsetServidorRef = useRef<number>(0); // epochMs(servidor) - Date.now(dispositivo)

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

  const etiquetaEvidencia = (t: typeof tipoEvidencia, paradaId: number) => {
    if (t === "tablero_salida") return "SALIDA";
    if (t === "tablero_llegada") return "LLEGADA";
    if (t === "otro") return "OTRO";
    const p = paradas.find((x) => x.id === paradaId);
    return p ? `${p.orden}. ${p.lugar_nombre}` : "PARADA";
  };
  const etapaClave = `${tipoEvidencia}:${tipoEvidencia === "producto" ? paradaSeleccionada : 0}`;
  const fotoActual = foto?.etapa === etapaClave ? foto : null;

  function detenerCamara() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCamaraActiva(false);
  }

  async function obtenerGps(): Promise<GpsCoords | null> {
    if (!("geolocation" in navigator)) return null;
    return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitud: p.coords.latitude, longitud: p.coords.longitude }), () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    ));
  }

  async function sincronizarHoraServidor() {
    try {
      const antes = Date.now();
      const res = await fetch("/api/portal/hora-servidor", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const epochMs = Number(data.epochMs);
      if (!Number.isFinite(epochMs)) return;
      // Corrige aproximadamente la latencia del viaje redondo (mitiga,
      // no elimina, el riesgo de un reloj local desconfigurado — ver nota
      // de riesgo en el reporte de PORTAL-HARDENING-2).
      const latenciaAprox = (Date.now() - antes) / 2;
      offsetServidorRef.current = epochMs + latenciaAprox - Date.now();
    } catch {
      /* si falla, se usa la hora del dispositivo sin corrección */
    }
  }

  async function abrirCamara() {
    setError(""); setGpsError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este dispositivo o navegador no permite abrir la cámara directamente.");
      return;
    }
    const [coords] = await Promise.all([obtenerGps(), sincronizarHoraServidor()]);
    if (!coords) {
      setGpsError("Activa y autoriza la ubicación GPS para poder tomar la evidencia.");
      return;
    }
    setGps(coords);
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
    if (!gps) {
      setError("No se pudo obtener la ubicación GPS. Vuelve a abrir la cámara.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return setError("No se pudo preparar la fotografía.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // PORTAL-HARDENING-2 (Fase D): geoestampado real — fecha/hora/GPS/
    // código de viaje/parada quedan DIBUJADOS en los píxeles de la foto
    // (no solo en metadata), vía canvas antes de subir.
    const ahoraCorregida = new Date(Date.now() + offsetServidorRef.current);
    const fechaTxt = ahoraCorregida.toLocaleDateString("es-GT");
    const horaTxt = ahoraCorregida.toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" });
    const codigoViaje = asignacionEnCurso?.codigo ?? `#${viajeAbierto?.id ?? ""}`;
    const etiqueta = etiquetaEvidencia(tipoEvidencia, paradaSeleccionada);
    const lineas = [
      "SITSA",
      `${fechaTxt} ${horaTxt} · GPS: ${gps.latitud.toFixed(6)}, ${gps.longitud.toFixed(6)}`,
      `${codigoViaje} · ${etiqueta}`,
    ];
    const alturaBarra = Math.max(64, Math.round(canvas.height * 0.12));
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, canvas.height - alturaBarra, canvas.width, alturaBarra);
    const tamanoFuente = Math.max(12, Math.round(canvas.width / 42));
    ctx.font = `${tamanoFuente}px sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    let y = canvas.height - alturaBarra + Math.round(tamanoFuente * 0.4);
    for (const linea of lineas) {
      ctx.fillText(linea, Math.round(canvas.width * 0.02), y, canvas.width * 0.96);
      y += Math.round(tamanoFuente * 1.3);
    }

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
      setKmSalida(""); setKmLlegada(""); setObservaciones(""); setMotivoContratiempo(""); setMostrarContratiempo(false);
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

  async function onLlegada(e: FormEvent) {
    e.preventDefault();
    if (!viajeAbierto) return;
    const km = odometroFuncional ? Number(kmLlegada) : undefined;
    if (odometroFuncional && (!Number.isFinite(km) || viajeAbierto.kmSalida == null || Number(km) < viajeAbierto.kmSalida)) {
      return setError("El kilometraje final no puede ser menor al de salida.");
    }
    const coords = await obtenerGps();
    await enviar({
      accion: "llegada",
      viajeId: viajeAbierto.id,
      kmLlegada: km,
      observaciones: observaciones.trim() || undefined,
      latitud: coords?.latitud,
      longitud: coords?.longitud,
    });
  }

  async function onContratiempo(e: FormEvent) {
    e.preventDefault();
    if (!viajeAbierto) return;
    if (motivoContratiempo.trim().length < 10) return setError("Describe el contratiempo con al menos 10 caracteres.");
    await enviar({ accion: "contratiempo", viajeId: viajeAbierto.id, motivo: motivoContratiempo.trim() });
  }

  async function subirEvidencias(e: FormEvent) {
    e.preventDefault();
    if (!viajeEnCursoId || !fotoActual) return setError("Toma la fotografía desde la cámara antes de continuar.");
    if (tipoEvidencia === "producto" && !paradaSeleccionada) return setError("Selecciona la parada de esta evidencia.");
    if (!gps) return setError("No se pudo obtener la ubicación GPS. Vuelve a abrir la cámara.");
    setError(""); setMensaje(""); setLoading(true);
    try {
      const form = new FormData();
      form.set("tipo", tipoEvidencia);
      if (tipoEvidencia === "producto") form.set("paradaId", String(paradaSeleccionada));
      form.set("latitud", String(gps.latitud));
      form.set("longitud", String(gps.longitud));
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
          {a.viaticoAsignado != null ? <p className="mt-1 text-[var(--muted)]"><span className="text-[var(--foreground)]">Viático asignado:</span> Q{a.viaticoAsignado.toFixed(2)} · <span className="text-[var(--foreground)]">Estado:</span> {ESTADO_VIATICO_LABEL[a.viaticoEstado ?? "PROGRAMADO"] ?? a.viaticoEstado}</p> : null}
        </article>)}
      </div>}
    </section>

    {viajeAbierto ? <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Avance del viaje · {asignacionEnCurso?.codigo ?? `#${viajeAbierto.id}`}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Unidad {viajeAbierto.placa}{odometroFuncional && viajeAbierto.kmSalida != null ? ` · salida ${viajeAbierto.kmSalida.toLocaleString("es-GT")} km` : " · sin odómetro funcional"}</p>
      <ol className="mt-4 space-y-2 text-sm">
        {odometroFuncional ? <li>{viajeAbierto.evidenciaTableroSalida ? "✓" : "○"} Tablero de salida</li> : null}
        {paradas.map((p) => <li key={p.id}>{!p.requiere_evidencia || p.evidencias > 0 ? "✓" : "○"} Parada {p.orden}: {p.lugar_nombre}</li>)}
        {odometroFuncional ? <li>{viajeAbierto.evidenciaTableroLlegada ? "✓" : "○"} Tablero de llegada</li> : null}
      </ol>
      {/* PORTAL-HARDENING-2 (Fase C): informativo, nunca bloquea salida,
          llegada ni cierre. */}
      {paradasSinEvidencia.length ? <p className="mt-3 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-sm text-amber-200">Hay {paradasSinEvidencia.length} parada(s) sin evidencia. Puedes registrar la llegada de todos modos.</p> : null}
    </section> : null}

    {viajeEnCursoId ? <form onSubmit={subirEvidencias} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Adjuntar evidencia</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">La evidencia debe tomarse ahora, con fecha, hora y GPS impresos en la foto. No se permite seleccionar archivos de la galería. Es un respaldo — no bloquea salida, llegada ni cierre.</p>

      <label className="mt-4 block text-sm text-[var(--muted)]">Tipo de evidencia
        <select
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
          value={tipoEvidencia}
          onChange={(e) => { setTipoEvidencia(e.target.value as typeof tipoEvidencia); setFoto(null); }}
        >
          {TIPOS_EVIDENCIA.filter((t) => odometroFuncional || (t.value !== "tablero_salida" && t.value !== "tablero_llegada")).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>

      {tipoEvidencia === "producto" ? (
        paradas.length ? <label className="mt-3 block text-sm text-[var(--muted)]">Selecciona dirección/parada
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={paradaSeleccionada}
            onChange={(e) => { setParadaSeleccionada(Number(e.target.value)); setFoto(null); }}
          >
            <option value={0}>Selecciona…</option>
            {paradas.map((p) => <option key={p.id} value={p.id}>{p.orden}. {p.lugar_nombre}{p.evidencias > 0 ? " ✓" : ""}</option>)}
          </select>
        </label> : <p className="mt-3 text-sm text-amber-300">Este viaje no tiene paradas registradas por Operaciones.</p>
      ) : null}

      {gpsError ? <p className="mt-3 text-sm text-red-300">{gpsError}</p> : null}
      <video ref={videoRef} className={`mt-4 w-full rounded-xl bg-black ${camaraActiva ? "block" : "hidden"}`} playsInline muted />
      {fotoActual ? <Image src={fotoActual.url} alt="Vista previa de la evidencia capturada" width={1280} height={720} unoptimized className="mt-4 h-auto w-full rounded-xl" /> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {!camaraActiva ? <button type="button" className="rounded-lg bg-[#334155] px-4 py-2.5 font-medium text-white" onClick={() => void abrirCamara()}>{fotoActual ? "Tomar otra foto" : "Abrir cámara"}</button> : null}
        {camaraActiva ? <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white" onClick={() => void tomarFoto()}>Tomar foto</button> : null}
        {camaraActiva ? <button type="button" className="rounded-lg border border-[var(--border)] px-4 py-2.5" onClick={detenerCamara}>Cancelar cámara</button> : null}
      </div>
      <button className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={loading || !fotoActual || (tipoEvidencia === "producto" && !paradaSeleccionada)}>Guardar evidencia</button>
    </form> : null}

    {tipo === "Piloto" && viajeAbierto ? <form onSubmit={onLlegada} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      {/* OPS-1 (corregido) + PORTAL-HARDENING-2 (Fase F): el piloto NUNCA
          finaliza, cierra ni cancela la operación — esta acción es solo
          registro de llegada física (respaldo operativo). El cierre
          administrativo lo hace exclusivamente Jefe/Gerente de
          Operaciones desde TMS/Programación (ver
          src/lib/tms/cierre-viaje.ts). Registrar la llegada aquí ya NO
          cambia el estado del plan TMS, y ya NO exige completar
          evidencias primero. */}
      <h2 className="font-semibold">Registrar llegada</h2>
      {odometroFuncional ? <label className="mt-3 block text-sm text-[var(--muted)]">Kilometraje de llegada<input type="number" min={viajeAbierto.kmSalida ?? 0} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={kmLlegada} onChange={(e) => setKmLlegada(e.target.value)} required /></label> : null}
      <label className="mt-3 block text-sm text-[var(--muted)]">Observaciones<textarea className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" rows={2} maxLength={500} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></label>
      <button className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={loading}>Registrar llegada</button>
    </form> : null}

    {tipo === "Piloto" && viajeAbierto ? <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      {/* PORTAL-HARDENING-2 (Fase F): reemplaza al antiguo "cierre
          excepcional por contratiempo mayor", que cerraba/cancelaba el
          plan desde el Portal. Reportar un contratiempo ya NO cambia
          ningún estado administrativo — solo queda registrado en la
          bitácora/auditoría para que Operaciones lo revise. */}
      <h2 className="font-semibold">Reportar contratiempo</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Para averías u otros imprevistos. Esto NO cierra ni cancela el viaje — solo avisa a Operaciones.</p>
      {mostrarContratiempo ? <form onSubmit={onContratiempo}>
        <label className="mt-3 block text-sm text-[var(--muted)]">Describe el contratiempo<textarea className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" rows={3} minLength={10} maxLength={500} value={motivoContratiempo} onChange={(e) => setMotivoContratiempo(e.target.value)} required /></label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="rounded-lg bg-amber-700 px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={loading}>Enviar reporte</button>
          <button type="button" className="rounded-lg border border-[var(--border)] px-4 py-2.5" onClick={() => setMostrarContratiempo(false)}>Cancelar</button>
        </div>
      </form> : <button type="button" className="mt-3 rounded-lg border border-amber-700 px-4 py-2.5 font-medium text-amber-300" onClick={() => setMostrarContratiempo(true)}>Reportar contratiempo</button>}
    </section> : null}

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
