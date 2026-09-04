"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { normalizarFotoCamara } from "@/lib/flota/camera-file";

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 1: captura del piloto) — registrar la carga
 * de combustible del viaje en curso (galones, monto, km, gasolinera y
 * foto del vale) y ver el estado de lo ya registrado (Pendiente hasta
 * que Operaciones lo revise). Componente propio (no se agrega dentro de
 * viaje-form.tsx, que ya es grande) para mantener el cambio chico y
 * reversible.
 *
 * CORRECCIÓN (pedido del usuario): la foto del vale debe abrirse igual
 * que "Adjuntar evidencia" — cámara en vivo, sin permitir elegir un
 * archivo de la galería/documentos. Se quitó el <input type="file"
 * capture="environment"> original (ese `capture` es solo una sugerencia:
 * varios navegadores/SO igual muestran la galería como opción) y se
 * reemplazó por el mismo flujo getUserMedia + <video> + canvas que ya
 * usa viaje-form.tsx para las evidencias — sin el geoestampado GPS de
 * esas fotos (el vale no necesita probar ubicación, solo ser legible).
 */

type EstadoCarga = "PENDIENTE" | "APROBADO" | "RECHAZADO";

type CargaCombustible = {
  id: number;
  tipoCombustible: "diesel" | "gasolina";
  galones: number;
  monto: number;
  km: number | null;
  gasolinera: string | null;
  nombreArchivo: string;
  estado: EstadoCarga;
  motivoRechazo: string | null;
  creadoEn: string;
  url: string;
};

const ESTADO_LABEL: Record<EstadoCarga, string> = {
  PENDIENTE: "Pendiente de revisión",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
};

const ESTADO_CLASE: Record<EstadoCarga, string> = {
  PENDIENTE: "bg-amber-950/30 text-amber-300",
  APROBADO: "bg-emerald-950/30 text-[#8fd4a0]",
  RECHAZADO: "bg-red-950/30 text-red-300",
};

export default function CombustibleForm({ viajeId }: { viajeId: number | null }) {
  const [cargas, setCargas] = useState<CargaCombustible[]>([]);
  const [tipoCombustible, setTipoCombustible] = useState<"diesel" | "gasolina">("diesel");
  const [galones, setGalones] = useState("");
  const [monto, setMonto] = useState("");
  const [km, setKm] = useState("");
  const [gasolinera, setGasolinera] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [foto, setFoto] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    if (!viajeId) return;
    let cancelado = false;
    fetch(`/api/portal/viajes/${viajeId}/combustible`)
      .then((res) => (res.ok ? res.json() : { cargas: [] }))
      .then((data) => { if (!cancelado) setCargas(data.cargas ?? []); })
      .catch(() => undefined);
    return () => { cancelado = true; };
  }, [viajeId, mensaje]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

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
    const ctx = canvas.getContext("2d");
    if (!ctx) return setError("No se pudo preparar la fotografía.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return setError("No se pudo capturar la fotografía.");
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    setFoto({ blob, url });
    detenerCamara();
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!viajeId) return;
    const g = Number(galones);
    const m = Number(monto);
    if (!Number.isFinite(g) || g <= 0) return setError("Indica los galones cargados.");
    if (!Number.isFinite(m) || m <= 0) return setError("Indica el valor pagado.");
    if (!foto) return setError("Toma la fotografía del vale antes de continuar.");
    const archivo = await normalizarFotoCamara(foto.blob, "vale");
    if (!archivo) return setError("No se pudo procesar la fotografía. Vuelve a tomarla.");
    setError(""); setMensaje(""); setLoading(true);
    try {
      const form = new FormData();
      form.set("tipoCombustible", tipoCombustible);
      form.set("galones", String(g));
      form.set("monto", String(m));
      if (km.trim()) form.set("km", km.trim());
      if (gasolinera.trim()) form.set("gasolinera", gasolinera.trim());
      form.set("file", archivo, archivo.name);
      const res = await fetch(`/api/portal/viajes/${viajeId}/combustible`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo registrar la carga de combustible.");
      setMensaje(data.mensaje ?? "Registrado.");
      setGalones(""); setMonto(""); setKm(""); setGasolinera("");
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setFoto(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la carga de combustible.");
    } finally {
      setLoading(false);
    }
  }

  if (!viajeId) return null;

  return (
    <form onSubmit={enviar} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Registrar carga de combustible</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Registra cada vez que cargues diesel o gasolina en este viaje. Operaciones revisará el vale.
      </p>

      {error ? <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300" role="alert">{error}</p> : null}
      {mensaje ? <p className="mt-3 rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3 text-sm text-[#8fd4a0]" role="status">{mensaje}</p> : null}

      <label className="mt-4 block text-sm text-[var(--muted)]">Tipo de combustible
        <select
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
          value={tipoCombustible}
          onChange={(e) => setTipoCombustible(e.target.value as "diesel" | "gasolina")}
        >
          <option value="diesel">Diesel</option>
          <option value="gasolina">Gasolina</option>
        </select>
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">Galones cargados
        <input type="number" min={0.01} step={0.01} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={galones} onChange={(e) => setGalones(e.target.value)} required />
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">Valor pagado (Q)
        <input type="number" min={0.01} step={0.01} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={monto} onChange={(e) => setMonto(e.target.value)} required />
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">Kilometraje al momento de cargar
        <input type="number" min={0} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={km} onChange={(e) => setKm(e.target.value)} />
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">Gasolinera / sucursal
        <input className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={gasolinera} onChange={(e) => setGasolinera(e.target.value)} maxLength={150} placeholder="Ej. Shell Zona 10" />
      </label>

      <div className="mt-3">
        <p className="text-sm text-[var(--muted)]">Foto del vale</p>
        <p className="text-xs text-[var(--muted)]">Debe tomarse ahora con la cámara. No se permite seleccionar archivos de la galería.</p>
        <video ref={videoRef} className={`mt-2 w-full rounded-xl bg-black ${camaraActiva ? "block" : "hidden"}`} playsInline muted />
        {foto ? (
          <Image src={foto.url} alt="Vista previa del vale" width={1280} height={720} unoptimized className="mt-2 h-auto w-full rounded-xl" />
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {!camaraActiva ? (
            <button type="button" className="rounded-lg bg-[#334155] px-4 py-2.5 font-medium text-white" onClick={() => void abrirCamara()}>
              {foto ? "Tomar otra foto" : "Abrir cámara"}
            </button>
          ) : null}
          {camaraActiva ? (
            <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white" onClick={() => void tomarFoto()}>
              Tomar foto
            </button>
          ) : null}
          {camaraActiva ? (
            <button type="button" className="rounded-lg border border-[var(--border)] px-4 py-2.5" onClick={detenerCamara}>
              Cancelar cámara
            </button>
          ) : null}
        </div>
      </div>

      <button className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={loading || !foto}>
        Guardar carga de combustible
      </button>

      {cargas.length ? (
        <div className="mt-5 space-y-2 border-t border-[var(--border)] pt-4">
          <p className="text-sm font-medium">Cargas registradas en este viaje</p>
          {cargas.map((c) => (
            <div key={c.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{c.tipoCombustible === "diesel" ? "Diesel" : "Gasolina"} · {c.galones} gal · Q{c.monto.toFixed(2)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${ESTADO_CLASE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span>
              </div>
              {c.gasolinera ? <p className="mt-1 text-[var(--muted)]">{c.gasolinera}</p> : null}
              {c.motivoRechazo ? <p className="mt-1 text-red-300">Motivo: {c.motivoRechazo}</p> : null}
              <a href={c.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-400 hover:underline">Ver vale</a>
            </div>
          ))}
        </div>
      ) : null}
    </form>
  );
}
