"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type TipoBitacoraLegal =
  | "Amonestacion"
  | "Suspension"
  | "Despido"
  | "GestionGeneral"
  | "Otro";

type Entrada = {
  id: number;
  tipo: TipoBitacoraLegal;
  fecha: string;
  descripcion: string;
};

const TIPO_LABEL: Record<TipoBitacoraLegal, string> = {
  Amonestacion: "Amonestación",
  Suspension: "Suspensión",
  Despido: "Despido",
  GestionGeneral: "Gestión general",
  Otro: "Otro",
};

const TIPO_COLOR: Record<TipoBitacoraLegal, string> = {
  Amonestacion: "border-amber-500/40 text-amber-300",
  Suspension: "border-orange-500/40 text-orange-300",
  Despido: "border-red-500/40 text-red-300",
  GestionGeneral: "border-blue-500/40 text-blue-300",
  Otro: "border-[var(--border)]",
};

export function BitacoraLegalEmpleado({
  slug,
  empleadoId,
}: {
  slug: string;
  empleadoId: number;
}) {
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    fetch(`/api/empresas/${slug}/rrhh/bitacora-legal?empleadoId=${empleadoId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelado) setEntradas((data.entradas ?? []).slice(0, 5));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [slug, empleadoId]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Historial legal</p>
        <Link
          href={`/e/${slug}/rrhh/bitacora-legal`}
          className="text-xs text-[var(--accent)] underline"
        >
          Ver todo / agregar registro
        </Link>
      </div>

      {loading ? (
        <p className="mt-2 text-xs text-[var(--muted)]">Cargando…</p>
      ) : entradas.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Sin registros en la bitácora legal.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-xs">
          {entradas.map((e) => (
            <li
              key={e.id}
              className={`rounded border px-2 py-1 ${TIPO_COLOR[e.tipo]}`}
            >
              <span className="font-medium">{TIPO_LABEL[e.tipo]}</span>{" "}
              <span className="text-[var(--muted)]">{e.fecha}</span>
              <p className="mt-0.5 text-[var(--foreground)]">{e.descripcion}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
