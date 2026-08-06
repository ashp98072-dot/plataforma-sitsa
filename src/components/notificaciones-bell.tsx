"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Notif = {
  id: string;
  tipo: "aprobacion" | "alerta" | "mensaje";
  titulo: string;
  detalle: string;
  enlace: string;
  creadoAt: string | null;
  refTipo?: string;
  refId?: number;
  acciones?: ("aprobar" | "rechazar")[];
};

type Props = {
  slug: string;
  rol: string;
};

export function NotificacionesBell({ slug, rol }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const puedeVer =
    rol === "Admin" ||
    rol === "Operaciones" ||
    rol === "CoordinadorPredios";

  const cargar = useCallback(async (silencioso = false) => {
    if (!puedeVer) return;
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch(`/api/empresas/${slug}/notificaciones`);
      const data = await res.json();
      if (res.ok) {
        setItems(data.notificaciones ?? []);
        setPendientes(Number(data.pendientes ?? 0));
      }
    } finally {
      if (!silencioso) setLoading(false);
    }
  }, [slug, puedeVer]);

  useEffect(() => {
    // Diferir primera carga para no competir con la página actual
    let cancelled = false;
    const run = () => {
      if (!cancelled) void cargar(true);
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestIdleCallback !== "undefined") {
      idleId = requestIdleCallback(run, { timeout: 2500 });
    } else {
      timeoutId = setTimeout(run, 800);
    }
    const t = setInterval(() => void cargar(true), 120_000);
    return () => {
      cancelled = true;
      if (idleId != null && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleId);
      }
      if (timeoutId != null) clearTimeout(timeoutId);
      clearInterval(t);
    };
  }, [cargar]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function resolver(refId: number, estado: "aprobado" | "rechazado") {
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/flota/permisos-externos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: refId, estado }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? "No se pudo resolver");
      return;
    }
    setMsg(data.mensaje ?? (estado === "aprobado" ? "Aprobado" : "Rechazado"));
    await cargar();
  }

  if (!puedeVer) return null;

  const badge = pendientes > 0 ? pendientes : items.length > 0 ? items.length : 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void cargar();
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] shadow-sm hover:text-[var(--text)]"
        title="Notificaciones"
        aria-label="Notificaciones"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {badge > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white ring-2 ring-[var(--sidebar)]">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(100vw-2rem,22rem)] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <p className="text-sm font-medium">Notificaciones</p>
            <button
              type="button"
              className="text-[11px] text-[var(--muted)] underline"
              onClick={() => void cargar()}
            >
              {loading ? "…" : "Actualizar"}
            </button>
          </div>
          {msg ? (
            <p className="border-b border-[var(--border)] px-3 py-1.5 text-xs text-emerald-400">
              {msg}
            </p>
          ) : null}
          <ul className="max-h-80 overflow-y-auto">
            {!items.length ? (
              <li className="px-3 py-6 text-center text-xs text-[var(--muted)]">
                Sin alertas ni solicitudes pendientes.
              </li>
            ) : (
              items.map((n) => (
                <li
                  key={n.id}
                  className="border-b border-[var(--border)] px-3 py-2 last:border-0"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={[
                        "mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                        n.tipo === "aprobacion"
                          ? "bg-amber-900/40 text-amber-200"
                          : n.tipo === "alerta"
                            ? "bg-rose-900/40 text-rose-200"
                            : "bg-sky-900/40 text-sky-200",
                      ].join(" ")}
                    >
                      {n.tipo === "aprobacion"
                        ? "Aprobar"
                        : n.tipo === "alerta"
                          ? "Alerta"
                          : "Msg"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">
                        {n.titulo}
                      </p>
                      {n.detalle ? (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {n.detalle}
                        </p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {n.acciones?.includes("aprobar") && n.refId ? (
                          <button
                            type="button"
                            className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] text-white"
                            onClick={() =>
                              void resolver(n.refId!, "aprobado")
                            }
                          >
                            Aceptar
                          </button>
                        ) : null}
                        {n.acciones?.includes("rechazar") && n.refId ? (
                          <button
                            type="button"
                            className="rounded bg-rose-800 px-2 py-0.5 text-[11px] text-white"
                            onClick={() =>
                              void resolver(n.refId!, "rechazado")
                            }
                          >
                            Rechazar
                          </button>
                        ) : null}
                        <Link
                          href={n.enlace}
                          className="text-[11px] text-sky-400 underline"
                          onClick={() => setOpen(false)}
                        >
                          Ver
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
