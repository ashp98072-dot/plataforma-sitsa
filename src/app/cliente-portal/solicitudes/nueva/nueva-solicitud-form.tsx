"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type UbicacionCliente = {
  id: number;
  nombre: string;
  direccion: string | null;
  referencia: string | null;
};

type ParadaForm = {
  modo: "guardada" | "otro";
  ubicacionId: number | null;
  lugarNombre: string;
  referencia: string;
};

function paradaVacia(): ParadaForm {
  return { modo: "otro", ubicacionId: null, lugarNombre: "", referencia: "" };
}

function paradaValida(p: ParadaForm): boolean {
  return p.lugarNombre.trim().length > 0;
}

function paradaAPayload(p: ParadaForm) {
  return {
    lugarNombre: p.lugarNombre.trim(),
    clienteUbicacionId: p.modo === "guardada" ? p.ubicacionId : null,
    referencia: p.referencia.trim() || null,
  };
}

type Creada = {
  id: number;
  fechaSolicitada: string;
  cantidadEntregas: number;
  estado: string;
};

export function NuevaSolicitudForm() {
  const [ubicaciones, setUbicaciones] = useState<UbicacionCliente[]>([]);
  const [fechaSolicitada, setFechaSolicitada] = useState("");
  const [horaSolicitada, setHoraSolicitada] = useState("");
  const [referenciaCliente, setReferenciaCliente] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [origen, setOrigen] = useState<ParadaForm>(paradaVacia());
  const [entregas, setEntregas] = useState<ParadaForm[]>([paradaVacia()]);
  const [destino, setDestino] = useState<ParadaForm>(paradaVacia());
  const [paso, setPaso] = useState<"form" | "resumen">("form");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [creada, setCreada] = useState<Creada | null>(null);

  useEffect(() => {
    fetch("/api/cliente-portal/ubicaciones")
      .then((r) => r.json())
      .then((data) => setUbicaciones(data.ubicaciones ?? []))
      .catch(() => undefined);
  }, []);

  function onRevisar(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!fechaSolicitada) {
      setError("Indica la fecha solicitada.");
      return;
    }
    if (!paradaValida(origen)) {
      setError("Indica el lugar de carga (origen).");
      return;
    }
    if (!paradaValida(destino)) {
      setError("Indica el lugar de descarga (destino final).");
      return;
    }
    if (!entregas.length || entregas.some((en) => !paradaValida(en))) {
      setError("Completa el lugar de cada entrega.");
      return;
    }
    setPaso("resumen");
  }

  async function onConfirmar() {
    setEnviando(true);
    setError("");
    try {
      const res = await fetch("/api/cliente-portal/solicitudes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fechaSolicitada,
          horaSolicitada: horaSolicitada || null,
          referenciaCliente: referenciaCliente.trim() || null,
          observaciones: observaciones.trim() || null,
          origen: paradaAPayload(origen),
          entregas: entregas.map(paradaAPayload),
          destino: paradaAPayload(destino),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo enviar la solicitud.");
        setPaso("form");
        return;
      }
      setCreada({
        id: data.solicitud.id,
        fechaSolicitada: data.solicitud.fechaSolicitada,
        cantidadEntregas: data.solicitud.cantidadEntregas,
        estado: data.solicitud.estado,
      });
    } finally {
      setEnviando(false);
    }
  }

  function agregarEntrega() {
    setEntregas((prev) => [...prev, paradaVacia()]);
  }

  function eliminarEntrega(index: number) {
    setEntregas((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function actualizarEntrega(index: number, cambio: Partial<ParadaForm>) {
    setEntregas((prev) => prev.map((en, i) => (i === index ? { ...en, ...cambio } : en)));
  }

  if (creada) {
    return (
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-sm">
        <p className="text-base font-medium text-emerald-700 dark:text-emerald-300">
          Solicitud enviada correctamente.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <dt className="text-[var(--muted)]">Número de solicitud</dt>
          <dd className="font-medium">#{creada.id}</dd>
          <dt className="text-[var(--muted)]">Fecha solicitada</dt>
          <dd className="font-medium">{creada.fechaSolicitada}</dd>
          <dt className="text-[var(--muted)]">Cantidad de entregas</dt>
          <dd className="font-medium">{creada.cantidadEntregas}</dd>
          <dt className="text-[var(--muted)]">Estado</dt>
          <dd className="font-medium">{creada.estado}</dd>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/cliente-portal/solicitudes/${creada.id}`}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
          >
            Ver solicitud
          </Link>
          <Link
            href="/cliente-portal"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  if (paso === "resumen") {
    const recorrido = [
      { etiqueta: "Origen", parada: origen },
      ...entregas.map((en, i) => ({ etiqueta: `Entrega ${i + 1}`, parada: en })),
      { etiqueta: "Destino final", parada: destino },
    ];
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium">Confirma tu solicitud</h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-[var(--muted)]">Fecha solicitada</dt>
            <dd>{fechaSolicitada}</dd>
            <dt className="text-[var(--muted)]">Hora solicitada</dt>
            <dd>{horaSolicitada || "—"}</dd>
            <dt className="text-[var(--muted)]">Referencia</dt>
            <dd>{referenciaCliente || "—"}</dd>
          </dl>
          <ol className="mt-4 space-y-2">
            {recorrido.map((r, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                  {r.etiqueta}
                </span>
                <span>
                  {r.parada.lugarNombre}
                  {r.parada.referencia ? (
                    <span className="text-[var(--muted)]"> — {r.parada.referencia}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPaso("form")}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            Editar
          </button>
          <button
            type="button"
            disabled={enviando}
            onClick={onConfirmar}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {enviando ? "Enviando…" : "Confirmar y enviar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onRevisar} className="space-y-5">
      <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="font-medium">Datos del servicio</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Fecha solicitada *
            <input
              type="date"
              required
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              value={fechaSolicitada}
              onChange={(e) => setFechaSolicitada(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Hora solicitada
            <input
              type="time"
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              value={horaSolicitada}
              onChange={(e) => setHoraSolicitada(e.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Referencia del cliente
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              maxLength={120}
              value={referenciaCliente}
              onChange={(e) => setReferenciaCliente(e.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Observaciones
            <textarea
              rows={2}
              maxLength={500}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="font-medium">Origen</h2>
        <CampoParada
          parada={origen}
          ubicaciones={ubicaciones}
          onChange={(cambio) => setOrigen((prev) => ({ ...prev, ...cambio }))}
          placeholderLugar="Lugar de carga *"
        />
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Entregas</h2>
          <p className="text-xs text-[var(--muted)]">Entregas solicitadas: {entregas.length}</p>
        </div>
        {entregas.map((en, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Entrega {i + 1}</p>
              {entregas.length > 1 ? (
                <button
                  type="button"
                  className="text-xs text-red-500 underline"
                  onClick={() => eliminarEntrega(i)}
                >
                  Eliminar
                </button>
              ) : null}
            </div>
            <CampoParada
              parada={en}
              ubicaciones={ubicaciones}
              onChange={(cambio) => actualizarEntrega(i, cambio)}
              placeholderLugar="Lugar de entrega *"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={agregarEntrega}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          + Agregar entrega
        </button>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="font-medium">Destino final</h2>
        <CampoParada
          parada={destino}
          ubicaciones={ubicaciones}
          onChange={(cambio) => setDestino((prev) => ({ ...prev, ...cambio }))}
          placeholderLugar="Lugar de descarga *"
        />
      </section>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <button
        type="submit"
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
      >
        Enviar solicitud
      </button>
    </form>
  );
}

function CampoParada({
  parada,
  ubicaciones,
  onChange,
  placeholderLugar,
}: {
  parada: ParadaForm;
  ubicaciones: UbicacionCliente[];
  onChange: (cambio: Partial<ParadaForm>) => void;
  placeholderLugar: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <select
        className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm sm:col-span-2"
        value={parada.modo === "guardada" ? String(parada.ubicacionId) : "otro"}
        onChange={(e) => {
          if (e.target.value === "otro") {
            onChange({ modo: "otro", ubicacionId: null, lugarNombre: "", referencia: "" });
            return;
          }
          const ubicacion = ubicaciones.find((u) => u.id === Number(e.target.value));
          onChange({
            modo: "guardada",
            ubicacionId: ubicacion?.id ?? null,
            lugarNombre: ubicacion?.nombre ?? "",
            referencia: ubicacion?.direccion ?? ubicacion?.referencia ?? "",
          });
        }}
      >
        <option value="otro">Otro destino (escribir manualmente)</option>
        {ubicaciones.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nombre}
          </option>
        ))}
      </select>
      <input
        className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
        placeholder={placeholderLugar}
        required
        disabled={parada.modo === "guardada"}
        value={parada.lugarNombre}
        onChange={(e) => onChange({ lugarNombre: e.target.value })}
      />
      <input
        className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
        placeholder="Referencia / dirección (opcional)"
        value={parada.referencia}
        onChange={(e) => onChange({ referencia: e.target.value })}
      />
    </div>
  );
}
