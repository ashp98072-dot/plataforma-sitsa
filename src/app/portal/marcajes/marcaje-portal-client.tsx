"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CamaraMarcaje } from "@/app/e/[slug]/rrhh/marcajes/camara-marcaje";

export function MarcajePortalClient() {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [camaraKey, setCamaraKey] = useState(0);
  const ocupado = useRef(false);

  function marcar() {
    if (ocupado.current) return;
    if (!foto) { setError("Toma una fotografía antes de marcar."); return; }
    if (!navigator.geolocation) {
      setError("Este dispositivo o navegador no permite obtener la ubicación GPS.");
      return;
    }
    ocupado.current = true;
    setEnviando(true);
    setMensaje("");
    setError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const form = new FormData();
          form.set("foto", foto, "foto-marcaje.jpg");
          form.set("latitud", String(pos.coords.latitude));
          form.set("longitud", String(pos.coords.longitude));
          const res = await fetch("/api/portal/marcajes", {
            method: "POST",
            body: form,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(data.error ?? "No se pudo registrar el marcaje.");
            return;
          }
          setMensaje(data.mensaje ?? "Marcaje registrado.");
          setFoto(null);
          setCamaraKey((key) => key + 1);
          router.refresh();
        } catch {
          setError("No se pudo conectar con el servidor.");
        } finally {
          ocupado.current = false;
          setEnviando(false);
        }
      },
      (geoError) => {
        ocupado.current = false;
        const detalle =
          geoError.code === geoError.PERMISSION_DENIED
            ? "Debes permitir el acceso a la ubicación para marcar."
            : "No se pudo obtener una ubicación precisa. Activa el GPS e inténtalo nuevamente.";
        setError(detalle);
        setEnviando(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Registrar entrada o salida</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Debes estar dentro del radio de una ubicación activa registrada por RRHH.
        El sistema determinará automáticamente si corresponde entrada o salida.
      </p>
      <CamaraMarcaje key={camaraKey} disabled={enviando} onCapture={setFoto} />
      <button
        type="button"
        disabled={enviando || !foto}
        onClick={marcar}
        className="mt-4 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {enviando ? "Verificando ubicación…" : "Marcar ahora"}
      </button>
      {mensaje ? <p className="mt-3 text-sm text-emerald-400">{mensaje}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
    </section>
  );
}
