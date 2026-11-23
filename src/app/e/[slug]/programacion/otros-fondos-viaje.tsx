"use client";

import { useCallback } from "react";

/**
 * FONDOS DIARIOS (Fase 3) — sección «Otros fondos del viaje» de Programación (debajo de «Viáticos del viaje»). Componente controlado: la lista vive en el formulario del viaje y viaja
 * con el MISMO guardado (POST/PATCH /tms/planes → `otrosFondos`); el servidor la consolida con los viáticos en la solicitud diaria de la empresa requirente. Unidad, cliente, fecha,
 * viaje y empresa requirente se HEREDAN del viaje (no se capturan). La cuenta o teléfono se sugiere desde RRHH (GET …/otros-fondos/destino) y se puede corregir.
 */

export type OtroFondoForm = {
  /** Identificador del otro fondo ya guardado (se conserva); ausente en los nuevos. */
  id?: number;
  categoria: string;
  monto: string;
  descripcion: string;
  empleadoId: string;
  metodoPago: string;
  cuenta: string;
  /** Ya está en una solicitud autorizada: solo lectura. */
  bloqueado?: boolean;
};

export type CatalogoOtrosFondos = { categorias: string[]; metodosPago: string[]; empleados: { id: number; nombre: string; puesto: string | null }[] };

export const OTRO_FONDO_VACIO: OtroFondoForm = { categoria: "", monto: "", descripcion: "", empleadoId: "", metodoPago: "", cuenta: "" };

/** Payload del servidor (otrosFondosSchema) a partir del formulario. El servidor vuelve a validar todo. */
export function otrosFondosParaEnviar(items: OtroFondoForm[]) {
  return items.map((o) => ({
    ...(o.id != null ? { id: o.id } : {}),
    categoria: o.categoria,
    monto: Number(o.monto),
    descripcion: o.descripcion.trim() || null,
    empleadoId: Number(o.empleadoId),
    metodoPago: o.metodoPago || null,
    cuenta: o.cuenta.trim() || null,
  }));
}

/** Primer problema visible antes de enviar (el servidor es la validación real). */
export function errorOtrosFondos(items: OtroFondoForm[]): string | null {
  for (const [i, o] of items.entries()) {
    const n = i + 1;
    if (!o.categoria) return `Otro fondo ${n}: elige la categoría.`;
    const monto = Number(o.monto);
    if (!o.monto || !Number.isFinite(monto) || monto <= 0) return `Otro fondo ${n}: el monto debe ser mayor que cero.`;
    if (!o.empleadoId) return `Otro fondo ${n}: elige el beneficiario.`;
    if (o.metodoPago === "Transferencia móvil" && !o.cuenta.trim()) return `Otro fondo ${n}: ingresa el número de teléfono para la transferencia móvil.`;
  }
  return null;
}

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

export default function OtrosFondosViaje({ slug, items, onChange, catalogo, empleadosDelViaje, habilitado, deshabilitado }: {
  slug: string;
  items: OtroFondoForm[];
  onChange: (items: OtroFondoForm[]) => void;
  catalogo: CatalogoOtrosFondos;
  /** Empleados (RRHH) ya asignados al viaje: piloto, piloto extra y auxiliares; se ofrecen primero. */
  empleadosDelViaje: number[];
  /** Hay empresa requirente elegida (sin ella no hay solicitud diaria a la que consolidar). */
  habilitado: boolean;
  deshabilitado: boolean;
}) {
  const del = new Set(empleadosDelViaje);
  const delViaje = catalogo.empleados.filter((e) => del.has(e.id));
  const otros = catalogo.empleados.filter((e) => !del.has(e.id));

  const sugerir = useCallback(async (indice: number, empleadoId: string, metodo: string) => {
    if (!empleadoId || (metodo !== "Transferencia" && metodo !== "Transferencia móvil")) return "";
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/otros-fondos/destino?empleadoId=${encodeURIComponent(empleadoId)}&metodo=${encodeURIComponent(metodo)}`);
      if (!res.ok) return "";
      const data = await res.json();
      return typeof data.destino === "string" ? data.destino : "";
    } catch {
      return "";
    } finally {
      void indice;
    }
  }, [slug]);

  function cambiar(i: number, parche: Partial<OtroFondoForm>) {
    onChange(items.map((x, j) => (j === i ? { ...x, ...parche } : x)));
  }
  async function cambiarBeneficiarioOMetodo(i: number, empleadoId: string, metodo: string) {
    cambiar(i, { empleadoId, metodoPago: metodo });
    const destino = await sugerir(i, empleadoId, metodo);   // sugerencia desde RRHH; el usuario puede corregirla después
    cambiar(i, { empleadoId, metodoPago: metodo, cuenta: destino });
  }

  const total = items.reduce((s, o) => s + (Number(o.monto) || 0), 0);

  return (
    <div className="md:col-span-3 space-y-2 rounded border border-[var(--border)] p-3" data-otros-fondos>
      <p className="text-xs font-medium">Otros fondos del viaje</p>
      {!habilitado ? <p className="text-xs text-[var(--muted)]">Elige la <strong>empresa requirente</strong> del viaje para registrar otros fondos (hospedaje, combustible, peajes, etc.).</p> : null}
      {habilitado ? (
        <>
          {items.map((o, i) => {
            const bloq = Boolean(o.bloqueado) || deshabilitado;
            return (
              <div key={o.id ?? `nuevo-${i}`} className="space-y-2 rounded border border-[var(--border)]/60 p-2" data-otro-fondo>
                {o.bloqueado ? <p className="text-[11px] text-amber-300">Ya está en una solicitud autorizada: no se puede modificar ni retirar desde aquí. Para un gasto adicional agrega uno nuevo (irá en una solicitud complementaria).</p> : null}
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label className="text-xs text-[var(--muted)]">Categoría *
                    <select className={`${inputCls} mt-0.5 w-full`} value={o.categoria} disabled={bloq} onChange={(e) => cambiar(i, { categoria: e.target.value })}>
                      <option value="">Seleccionar…</option>
                      {catalogo.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-[var(--muted)]">Monto solicitado (Q) *
                    <input type="number" min="0.01" step="0.01" className={`${inputCls} mt-0.5 w-full`} value={o.monto} disabled={bloq} onChange={(e) => cambiar(i, { monto: e.target.value })} />
                  </label>
                  <label className="text-xs text-[var(--muted)] md:col-span-2">Descripción / observaciones
                    <input className={`${inputCls} mt-0.5 w-full`} value={o.descripcion} maxLength={300} disabled={bloq} onChange={(e) => cambiar(i, { descripcion: e.target.value })} />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <label className="text-xs text-[var(--muted)]">Beneficiario *
                    <select className={`${inputCls} mt-0.5 w-full`} value={o.empleadoId} disabled={bloq} onChange={(e) => void cambiarBeneficiarioOMetodo(i, e.target.value, o.metodoPago)}>
                      <option value="">Seleccionar empleado…</option>
                      {delViaje.length ? <optgroup label="Del viaje">{delViaje.map((e) => <option key={e.id} value={e.id}>{e.nombre}{e.puesto ? ` · ${e.puesto}` : ""}</option>)}</optgroup> : null}
                      <optgroup label="Otros empleados">{otros.map((e) => <option key={e.id} value={e.id}>{e.nombre}{e.puesto ? ` · ${e.puesto}` : ""}</option>)}</optgroup>
                    </select>
                  </label>
                  <label className="text-xs text-[var(--muted)]">Método de pago
                    <select className={`${inputCls} mt-0.5 w-full`} value={o.metodoPago} disabled={bloq} onChange={(e) => void cambiarBeneficiarioOMetodo(i, o.empleadoId, e.target.value)}>
                      <option value="">—</option>
                      {catalogo.metodosPago.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-[var(--muted)] md:col-span-2">{o.metodoPago === "Transferencia móvil" ? "Número de teléfono" : "Cuenta bancaria"}
                    <input className={`${inputCls} mt-0.5 w-full`} value={o.cuenta} maxLength={100} disabled={bloq} placeholder="Se sugiere desde RRHH; puedes corregirla"
                      onChange={(e) => cambiar(i, { cuenta: e.target.value })} />
                  </label>
                </div>
                {!bloq ? <button type="button" className="text-xs text-red-400" onClick={() => onChange(items.filter((_, j) => j !== i))}>Quitar</button> : null}
              </div>
            );
          })}
          {!deshabilitado ? (
            <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-xs" onClick={() => onChange([...items, { ...OTRO_FONDO_VACIO }])}>+ Agregar otro fondo</button>
          ) : null}
          {items.length ? <p className="text-xs text-[var(--muted)]">Total de otros fondos: Q{total.toLocaleString("es-GT", { minimumFractionDigits: 2 })}</p> : null}
          <p className="text-[10px] text-[var(--muted)]">
            Se guardan con el viaje y se consolidan, junto con los viáticos, en la solicitud de fondos del día de su empresa requirente. Unidad, cliente y fecha se toman del viaje. Si la solicitud ya fue autorizada, los nuevos van en una solicitud complementaria.
          </p>
        </>
      ) : null}
    </div>
  );
}
