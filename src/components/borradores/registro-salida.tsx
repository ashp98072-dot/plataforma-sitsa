"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { textoAdvertenciaLimpieza, type DecisionTrasFallo, type InformeLimpieza } from "@/lib/borradores/cierre-sesion";
import { prepararSalidaDelNavegador } from "@/lib/borradores/salida-navegador";
import { registrarAntesDeSalidaExplicita } from "@/lib/session-navigation";

/**
 * BORR-1b — registra, mientras está montado, la política de limpieza local para la salida EXPLÍCITA (menú de cuenta / selector
 * de empresa) y muestra la ADVERTENCIA cuando el usuario pidió borrar y la eliminación no se confirmó por completo: reintentar,
 * salir sin confirmar/conservando lo que pueda quedar, o cancelar la salida. `ownerKey` llega del servidor (layout / página);
 * `null` = borradores no disponibles → no registra nada. La expiración de sesión y los 401 no pasan por este gancho.
 */
type Aviso = { informe: InformeLimpieza; ocupado: boolean };

export function RegistroSalidaBorradores({ ownerKey }: { ownerKey: string | null }) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const pendiente = useRef<((d: DecisionTrasFallo) => void) | null>(null);

  useEffect(() => {
    if (ownerKey === null) return;
    const retirar = registrarAntesDeSalidaExplicita(async () => {
      try {
        const r = await prepararSalidaDelNavegador(ownerKey, {
          decidirTrasFallo: (informe) => new Promise<DecisionTrasFallo>((resolver) => {
            pendiente.current = resolver;
            setAviso({ informe, ocupado: false });
          }),
        });
        return r.continuar;
      } finally {
        pendiente.current = null;
        setAviso(null);
      }
    });
    return () => {
      retirar();
      const resolver = pendiente.current; // si se desmonta con la advertencia abierta, la salida se cancela
      pendiente.current = null;
      resolver?.("cancelar");
    };
  }, [ownerKey]);

  function elegir(decision: DecisionTrasFallo) {
    const resolver = pendiente.current;
    if (!resolver) return;
    pendiente.current = null;
    // «Reintentar» mantiene el diálogo visible (ocupado) hasta el siguiente resultado; las demás decisiones lo cierran.
    setAviso((a) => (decision === "reintentar" && a ? { ...a, ocupado: true } : null));
    resolver(decision);
  }

  return aviso ? <DialogoAdvertenciaLimpieza aviso={aviso} onElegir={elegir} /> : null;
}

function DialogoAdvertenciaLimpieza({ aviso, onElegir }: { aviso: Aviso; onElegir: (d: DecisionTrasFallo) => void }) {
  const texto = textoAdvertenciaLimpieza(aviso.informe);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!aviso.ocupado) cancelarRef.current?.focus(); }, [aviso]);

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    if (aviso.ocupado) return;
    if (e.key === "Escape") { e.preventDefault(); onElegir("cancelar"); return; }
    if (e.key !== "Tab") return;
    const botones = [...(contenedorRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
    if (!botones.length) return;
    const i = botones.indexOf(document.activeElement as HTMLButtonElement);
    const siguiente = e.shiftKey ? (i <= 0 ? botones.length - 1 : i - 1) : (i === botones.length - 1 ? 0 : i + 1);
    e.preventDefault();
    botones[siguiente]!.focus();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="presentation">
      <div
        ref={contenedorRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="advertencia-limpieza-titulo"
        aria-describedby="advertencia-limpieza-detalle"
        onKeyDown={alTeclear}
        className="w-full max-w-md space-y-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 shadow-xl"
      >
        <h2 id="advertencia-limpieza-titulo" className="text-base font-semibold">{texto.titulo}</h2>
        <p id="advertencia-limpieza-detalle" className="text-sm">{texto.detalle}</p>
        {aviso.ocupado ? <p role="status" className="text-sm text-[var(--muted)]">Reintentando la eliminación…</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={aviso.ocupado} onClick={() => onElegir("reintentar")} className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
            Reintentar eliminación
          </button>
          <button type="button" disabled={aviso.ocupado} onClick={() => onElegir("salir")} className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
            {texto.salir}
          </button>
          <button ref={cancelarRef} type="button" disabled={aviso.ocupado} onClick={() => onElegir("cancelar")} className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50">
            Cancelar salida
          </button>
        </div>
      </div>
    </div>
  );
}
