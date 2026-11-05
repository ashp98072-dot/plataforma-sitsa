"use client";

import { useMemo, useState } from "react";
import type { FabricaCanal } from "@/lib/borradores/canal";
import type { ContextoBorradores } from "@/lib/borradores/contexto";
import type { NucleoBorradores } from "@/lib/borradores/nucleo";
import type { AlmacenPreferencias } from "@/lib/borradores/preferencia";
import { useBorradorLocal } from "@/lib/borradores/use-borrador-local";
import { AdvertenciaConflicto } from "./advertencia-conflicto";
import { ControlPersistenciaLocal } from "./control-persistencia-local";
import { DialogoRecuperacion } from "./dialogo-recuperacion";
import { IndicadorAutoguardado } from "./indicador-autoguardado";

/**
 * ⚠ SOLO PRUEBAS Y DEMOSTRACIÓN LOCAL (BORR-1c). Formulario ficticio que reúne el hook y los componentes de borradores para
 * comprobar: escribir → autoguardado → recargar (remontar) → recuperar → descartar → conflicto entre pestañas.
 * NO está montado en ninguna ruta ni en los formularios oficiales (una prueba lo verifica); no importa ni llama a ninguna API de
 * Fondos, Gastos o Compras. La integración real con cada formulario es de BORR-1d/1e/1f.
 */
type Linea = { monto: string; nota: string };
export type PayloadDemo = { descripcion: string; lineas: Linea[] };

export function DemoAutoguardado({ contexto, nucleo, prefs, fabricaCanal, debounceMs = 30, maxEsperaMs = 200, etiqueta = "Formulario de demostración" }: {
  contexto: ContextoBorradores | null;
  nucleo?: NucleoBorradores;
  prefs?: AlmacenPreferencias | null;
  fabricaCanal?: FabricaCanal | null;
  debounceMs?: number;
  maxEsperaMs?: number;
  etiqueta?: string;
}) {
  const [descripcion, setDescripcion] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const payload = useMemo<PayloadDemo>(() => ({ descripcion, lineas }), [descripcion, lineas]);
  const borrador = useBorradorLocal<PayloadDemo>({ tipo: "solicitud_fondo", esquemaVersion: 1, payload, contexto, nucleo, prefs, fabricaCanal, debounceMs, maxEsperaMs });
  const { snapshot } = borrador;
  const hayContenido = descripcion !== "" || lineas.length > 0;

  function aplicar(p: unknown) {
    const v = p as Partial<PayloadDemo> | null;
    setDescripcion(typeof v?.descripcion === "string" ? v.descripcion : "");
    setLineas(Array.isArray(v?.lineas) ? (v.lineas as Linea[]) : []);
  }
  const editable = snapshot.fase !== "bloqueado";

  return (
    <section aria-label={etiqueta} className="space-y-3 p-3">
      <h2 className="text-base font-semibold">{etiqueta}</h2>
      <IndicadorAutoguardado snapshot={snapshot} />
      <label className="block text-sm">Descripción
        <textarea className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--input)] p-2" value={descripcion} disabled={!editable} onChange={(e) => setDescripcion(e.target.value)} />
      </label>
      <ul className="space-y-2">
        {lineas.map((l, i) => (
          <li key={i} className="flex gap-2">
            <input aria-label={`Monto de la línea ${i + 1}`} className="w-28 rounded border border-[var(--border)] bg-[var(--input)] p-1" value={l.monto} disabled={!editable}
              onChange={(e) => setLineas((a) => a.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))} />
            <input aria-label={`Nota de la línea ${i + 1}`} className="flex-1 rounded border border-[var(--border)] bg-[var(--input)] p-1" value={l.nota} disabled={!editable}
              onChange={(e) => setLineas((a) => a.map((x, j) => (j === i ? { ...x, nota: e.target.value } : x)))} />
            <button type="button" className="rounded border border-[var(--border)] px-2" disabled={!editable} onClick={() => setLineas((a) => a.filter((_, j) => j !== i))}>Quitar línea {i + 1}</button>
          </li>
        ))}
      </ul>
      <button type="button" className="rounded border border-[var(--border)] px-3 py-1 text-sm" disabled={!editable} onClick={() => setLineas((a) => [...a, { monto: "", nota: "" }])}>Agregar línea</button>
      <ControlPersistenciaLocal ownerKey={contexto?.ownerKey ?? null} prefs={prefs} />

      {snapshot.fase === "decision_pendiente" && snapshot.recuperacion ? (
        <DialogoRecuperacion
          recuperacion={snapshot.recuperacion}
          hayContenidoActual={hayContenido}
          onRecuperar={() => { const r = borrador.recuperar(); if (r.ok) aplicar(r.payload); }}
          onDescartar={async () => { await borrador.descartar({ confirmado: true }); }}
          onDecidirDespues={() => borrador.mantener()}
        />
      ) : null}
      {snapshot.fase === "en_espera" && snapshot.recuperacion ? (
        <button type="button" className="rounded border border-[var(--border)] px-3 py-1 text-sm" onClick={() => { const r = borrador.recuperar(); if (r.ok) aplicar(r.payload); }}>Recuperar el borrador guardado</button>
      ) : null}
      {snapshot.fase === "conflicto" && snapshot.conflicto ? (
        <AdvertenciaConflicto
          motivo={snapshot.conflicto.motivo}
          onReleer={async () => { const r = await borrador.releer(); return r.ok ? r : { ok: false, mensaje: r.mensaje }; }}
          onAdoptarRemoto={async () => { const r = await borrador.adoptarRemoto(); if (r.ok) aplicar(r.payload); return r.ok ? { ok: true } : { ok: false, mensaje: r.mensaje }; }}
          onConservarLocal={async () => { const r = await borrador.conservarLocal(); return r.ok ? { ok: true } : { ok: false, mensaje: r.mensaje }; }}
        />
      ) : null}
    </section>
  );
}
