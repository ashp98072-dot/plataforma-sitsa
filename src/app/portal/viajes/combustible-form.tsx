"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { normalizarFotoCamara } from "@/lib/flota/camera-file";
import { calcularDiferenciaMonto, calcularTotalEstimado, excedeTolerancia } from "@/lib/flota/combustible-form-ui";

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 1: captura del piloto) — registrar la carga
 * de combustible del viaje en curso y ver el estado de lo ya registrado
 * (Pendiente hasta que Operaciones lo revise). Componente propio (no se
 * agrega dentro de viaje-form.tsx, que ya es grande) para mantener el
 * cambio chico y reversible.
 *
 * La foto del vale se toma con cámara en vivo (getUserMedia + canvas),
 * igual que "Adjuntar evidencia" — nunca se permite elegir un archivo de
 * la galería/documentos.
 *
 * FLOTA-COMBUSTIBLE-2 — alinea la captura con el reporte real que envía
 * la gasolinera (VALE No./FECHA DE CONSUMO/PRECIO): se agregan número de
 * vale, fecha de consumo y precio por galón (los 3 obligatorios); placa
 * y piloto NUNCA se piden aquí, siguen saliendo automáticos del viaje/
 * sesión en el servidor (route.ts). El total (galones × precio) se
 * calcula y se muestra, pero NUNCA reemplaza el monto que el piloto
 * ingresa del vale — si difieren más de la tolerancia visual, se avisa
 * sin bloquear el envío (ver combustible-form-ui.ts).
 *
 * Diseño: el bloque completo vive detrás de un panel/acordeón cerrado
 * por defecto (`modo`), para no ocupar tanto espacio en la pantalla del
 * viaje — el piloto nunca sale de esa pantalla para usarlo.
 */

type EstadoCarga = "PENDIENTE" | "APROBADO" | "RECHAZADO";

type CargaCombustible = {
  id: number;
  tipoCombustible: "diesel" | "gasolina";
  /** `null` en cargas registradas antes de FLOTA-COMBUSTIBLE-2. */
  numeroVale: string | null;
  /** `null` en cargas registradas antes de FLOTA-COMBUSTIBLE-2. */
  fechaConsumo: string | null;
  galones: number;
  monto: number;
  /** `null` en cargas registradas antes de FLOTA-COMBUSTIBLE-2. */
  precioGalon: number | null;
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

const inputCls = "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2";

function hoyLocalNavegador(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function CombustibleForm({ viajeId }: { viajeId: number | null }) {
  const [modo, setModo] = useState<"cerrado" | "form" | "lista">("cerrado");
  const [cargas, setCargas] = useState<CargaCombustible[]>([]);
  const [tipoCombustible, setTipoCombustible] = useState<"diesel" | "gasolina">("diesel");
  const [numeroVale, setNumeroVale] = useState("");
  const [fechaConsumo, setFechaConsumo] = useState(hoyLocalNavegador);
  const [galones, setGalones] = useState("");
  const [monto, setMonto] = useState("");
  const [precioGalon, setPrecioGalon] = useState("");
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

  // FLOTA-COMBUSTIBLE-2 (sección 4) — total estimado (galones × precio)
  // y su diferencia contra el monto ingresado, recalculados en cada
  // cambio. Nunca se usa para sobreescribir `monto` — solo se muestra.
  const totalEstimado = useMemo(
    () => calcularTotalEstimado(Number(galones), Number(precioGalon)),
    [galones, precioGalon],
  );
  const diferenciaMonto = useMemo(
    () => calcularDiferenciaMonto(Number(monto), totalEstimado),
    [monto, totalEstimado],
  );
  const mostrarAdvertenciaMonto = monto.trim() !== "" && excedeTolerancia(diferenciaMonto);

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

  function limpiarFormulario() {
    setNumeroVale(""); setFechaConsumo(hoyLocalNavegador());
    setGalones(""); setMonto(""); setPrecioGalon(""); setKm(""); setGasolinera("");
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setFoto(null);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!viajeId) return;
    const g = Number(galones);
    const m = Number(monto);
    const p = Number(precioGalon);
    if (!numeroVale.trim()) return setError("Indica el número de vale.");
    if (!fechaConsumo) return setError("Indica la fecha en que se cargó el combustible.");
    if (!Number.isFinite(g) || g <= 0) return setError("Indica los galones cargados.");
    if (!Number.isFinite(m) || m <= 0) return setError("Indica el valor pagado.");
    if (!Number.isFinite(p) || p <= 0) return setError("Indica el precio por galón.");
    if (!foto) return setError("Toma la fotografía del vale antes de continuar.");
    const archivo = await normalizarFotoCamara(foto.blob, "vale");
    if (!archivo) return setError("No se pudo procesar la fotografía. Vuelve a tomarla.");
    setError(""); setMensaje(""); setLoading(true);
    try {
      const form = new FormData();
      form.set("tipoCombustible", tipoCombustible);
      form.set("numeroVale", numeroVale.trim());
      form.set("fechaConsumo", fechaConsumo);
      form.set("galones", String(g));
      form.set("monto", String(m));
      form.set("precioGalon", String(p));
      if (km.trim()) form.set("km", km.trim());
      if (gasolinera.trim()) form.set("gasolinera", gasolinera.trim());
      form.set("file", archivo, archivo.name);
      const res = await fetch(`/api/portal/viajes/${viajeId}/combustible`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo registrar la carga de combustible.");
      setMensaje(data.mensaje ?? "Registrado.");
      limpiarFormulario();
      setModo("cerrado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la carga de combustible.");
    } finally {
      setLoading(false);
    }
  }

  if (!viajeId) return null;

  const listaCargas = (
    <div className="space-y-2">
      {cargas.map((c) => (
        <div key={c.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{c.tipoCombustible === "diesel" ? "Diesel" : "Gasolina"} · {c.galones} gal · Q{c.monto.toFixed(2)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${ESTADO_CLASE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span>
          </div>
          <p className="mt-1 text-[var(--muted)]">
            Vale {c.numeroVale ?? "No disponible"} · Consumo {c.fechaConsumo ?? "No disponible"}
            {c.precioGalon != null ? ` · Q${c.precioGalon.toFixed(2)}/gal` : ""}
          </p>
          {c.gasolinera ? <p className="mt-1 text-[var(--muted)]">{c.gasolinera}</p> : null}
          {c.motivoRechazo ? <p className="mt-1 text-red-300">Motivo: {c.motivoRechazo}</p> : null}
          <a href={c.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-400 hover:underline">Ver vale</a>
        </div>
      ))}
    </div>
  );

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Combustible</h2>

      {error ? <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300" role="alert">{error}</p> : null}
      {mensaje ? <p className="mt-3 rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3 text-sm text-[#8fd4a0]" role="status">{mensaje}</p> : null}

      {modo === "cerrado" ? (
        cargas.length ? (
          <div className="mt-3">
            <p className="text-sm text-[var(--muted)]">{cargas.length} carga{cargas.length === 1 ? "" : "s"} registrada{cargas.length === 1 ? "" : "s"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="rounded-lg border border-[var(--border)] px-4 py-2.5 font-medium" onClick={() => setModo("lista")}>
                Ver cargas
              </button>
              <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white" onClick={() => setModo("form")}>
                + Nueva carga
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white" onClick={() => setModo("form")}>
            Registrar combustible
          </button>
        )
      ) : null}

      {modo === "lista" ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border border-[var(--border)] px-4 py-2.5" onClick={() => setModo("cerrado")}>
              Cerrar
            </button>
            <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white" onClick={() => setModo("form")}>
              + Nueva carga
            </button>
          </div>
          {listaCargas}
        </div>
      ) : null}

      {modo === "form" ? (
        <form onSubmit={enviar} className="mt-3 space-y-0">
          <p className="text-xs text-[var(--muted)]">
            Registra cada vez que cargues diesel o gasolina en este viaje. Operaciones revisará el vale.
          </p>

          <label className="mt-4 block text-sm text-[var(--muted)]">Tipo de combustible
            <select className={inputCls} value={tipoCombustible} onChange={(e) => setTipoCombustible(e.target.value as "diesel" | "gasolina")}>
              <option value="diesel">Diesel</option>
              <option value="gasolina">Gasolina</option>
            </select>
          </label>

          <label className="mt-3 block text-sm text-[var(--muted)]">Número de vale
            <input className={inputCls} value={numeroVale} onChange={(e) => setNumeroVale(e.target.value)} maxLength={40} placeholder="Ej. A-12345" required />
          </label>

          <label className="mt-3 block text-sm text-[var(--muted)]">Fecha de consumo
            <input type="date" className={inputCls} value={fechaConsumo} onChange={(e) => setFechaConsumo(e.target.value)} required />
          </label>

          <label className="mt-3 block text-sm text-[var(--muted)]">Galones cargados
            <input type="number" min={0.01} step={0.01} className={inputCls} value={galones} onChange={(e) => setGalones(e.target.value)} required />
          </label>

          <label className="mt-3 block text-sm text-[var(--muted)]">Precio por galón (Q)
            <input type="number" min={0.01} step={0.01} className={inputCls} value={precioGalon} onChange={(e) => setPrecioGalon(e.target.value)} required />
          </label>

          <label className="mt-3 block text-sm text-[var(--muted)]">Valor pagado (Q)
            <input type="number" min={0.01} step={0.01} className={inputCls} value={monto} onChange={(e) => setMonto(e.target.value)} required />
          </label>

          {totalEstimado != null ? (
            <p className="mt-2 text-xs text-[var(--muted)]">Total calculado (galones × precio): <span className="font-medium text-[var(--foreground)]">Q{totalEstimado.toFixed(2)}</span></p>
          ) : null}
          {mostrarAdvertenciaMonto && diferenciaMonto != null ? (
            <p className="mt-1 rounded-lg border border-amber-800/40 bg-amber-950/20 p-2 text-xs text-amber-200">
              El monto ingresado difiere del total calculado por Q{Math.abs(diferenciaMonto).toFixed(2)}. Revisa el vale antes de guardar (esto no bloquea el registro).
            </p>
          ) : null}

          <label className="mt-3 block text-sm text-[var(--muted)]">Kilometraje al momento de cargar
            <input type="number" min={0} className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} />
          </label>

          <label className="mt-3 block text-sm text-[var(--muted)]">Gasolinera / sucursal
            <input className={inputCls} value={gasolinera} onChange={(e) => setGasolinera(e.target.value)} maxLength={150} placeholder="Ej. Shell Zona 10" />
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

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={loading || !foto}>
              Guardar carga de combustible
            </button>
            <button type="button" className="rounded-lg border border-[var(--border)] px-4 py-2.5" onClick={() => setModo(cargas.length ? "lista" : "cerrado")}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
