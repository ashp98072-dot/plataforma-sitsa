"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "YYYY-MM-DD HH:mm:ss" -> "DD/MM/YYYY HH:mm:ss". Formateador propio y
 * mínimo (Compras no importa de src/lib/rrhh a propósito, ver el ticket
 * "NO tocar RRHH") — no es un cálculo de zona horaria, solo reordena un
 * string que el backend ya arma con DATE_FORMAT en MySQL/MariaDB
 * (columnasCabecera de requerimientos.ts), sin instanciar ningún Date.
 */
export function formatearTimestampCompra(valor: string | null | undefined): string {
  if (!valor) return "—";
  const [fecha, hora] = String(valor).split(" ");
  const [anio, mes, dia] = (fecha ?? "").split("-");
  if (!anio || !mes || !dia) return String(valor);
  return hora ? `${dia}/${mes}/${anio} ${hora}` : `${dia}/${mes}/${anio}`;
}

type Props = {
  slug: string;
  requerimientoId: number;
  version: number;
};

/**
 * COMPRAS-FASE-4-AUTORIZACION — botones Autorizar/Rechazar. Se monta SOLO
 * cuando el caller (requerimiento-form-client.tsx) ya confirmó
 * `estado === "Pendiente" && puedeAutorizar` — este componente no repite
 * esa condición, así el permiso de autorizar queda completamente
 * independiente de editable/puedeEliminar/puedeSubirDocumentos.
 *
 * Autorizar: confirmación simple (la firma y la identidad las resuelve el
 * servidor — este componente nunca las envía). Rechazar: formulario
 * inline con motivo obligatorio (máx. 1000). Al completar cualquiera de
 * las dos, router.refresh() para reflejar el nuevo estado/snapshot —
 * nunca optimistic update.
 */
export function RequerimientoDecisionClient({ slug, requerimientoId, version }: Props) {
  const router = useRouter();
  const [mostrarRechazo, setMostrarRechazo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");

  const boton = "rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

  async function enviar(body: { accion: "autorizar"; version: number } | { accion: "rechazar"; version: number; motivo: string }) {
    setProcesando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/compras/requerimientos/${requerimientoId}/estado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo completar la decisión.");
      setMostrarRechazo(false);
      setMotivo("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setProcesando(false);
    }
  }

  async function autorizar() {
    if (!confirm("¿Autorizar este requerimiento de compra? Se usará tu firma registrada en \"Mi firma\".")) return;
    await enviar({ accion: "autorizar", version });
  }

  function rechazarMotivo(e: React.FormEvent) {
    e.preventDefault();
    const limpio = motivo.trim();
    if (!limpio) {
      setError("El rechazo requiere un motivo.");
      return;
    }
    void enviar({ accion: "rechazar", version, motivo: limpio });
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-sm font-medium">Decisión sobre este requerimiento</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${boton} bg-emerald-600`} disabled={procesando} onClick={() => void autorizar()}>
          {procesando ? "Procesando…" : "Autorizar"}
        </button>
        <button
          type="button"
          className={`${boton} bg-red-700`}
          disabled={procesando}
          onClick={() => setMostrarRechazo((v) => !v)}
        >
          Rechazar
        </button>
      </div>
      {mostrarRechazo ? (
        <form onSubmit={rechazarMotivo} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
          <label className="block text-sm">
            Motivo del rechazo
            <textarea
              className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--input)] p-2 text-sm"
              value={motivo}
              maxLength={1000}
              required
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={`${boton} bg-red-700`} disabled={procesando || !motivo.trim()}>
              {procesando ? "Procesando…" : "Confirmar rechazo"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
              disabled={procesando}
              onClick={() => {
                setMostrarRechazo(false);
                setMotivo("");
                setError("");
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-[#f0a0a0]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
