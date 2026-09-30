"use client";
import { useState, type FormEvent } from "react";
import type { ProveedorPickerOpt } from "./proveedor-compra-picker";

type DuplicadoCodigo = "PROVEEDOR_DUPLICADO" | "PROVEEDOR_DUPLICADO_INACTIVO";
type DuplicadoInfo = { id: number; nombre_comercial: string; nit: string | null; activo: boolean };

// Alta rápida (sección 3): subconjunto compacto de camposFormulario (proveedores-comerciales-client.tsx). Banco,
// cuenta, tipo/titular de cuenta, dirección y observaciones se completan después en Proveedores comerciales.
const CAMPOS_MODAL = [
  ["nombre_comercial", "Nombre comercial", 200, true],
  ["razon_social", "Razón social", 250, false],
  ["nit", "NIT", 30, false],
  ["telefono", "Teléfono", 50, false],
  ["correo", "Correo", 200, false],
  ["contacto_nombre", "Nombre de contacto", 200, false],
  ["contacto_telefono", "Teléfono de contacto", 50, false],
  ["contacto_correo", "Correo de contacto", 200, false],
  ["metodo_pago_habitual", "Método de pago habitual", 80, false],
  ["dias_credito", "Días de crédito", 10, false],
] as const;

const proveedorMinimoDesdeExistente = (e: DuplicadoInfo): ProveedorPickerOpt =>
  ({ id: e.id, nombre_comercial: e.nombre_comercial, nit: e.nit, contacto_nombre: null, contacto_telefono: null, telefono: null, metodo_pago_habitual: null, banco: null, numero_cuenta: null, dias_credito: null });

/**
 * COMPRAS-PROVEEDOR-INLINE (corrección pre-SQL, sección 3) — "Usar proveedor existente" (409 duplicado ACTIVO) NUNCA
 * debe degradar un registro ya conocido: el 409 solo trae un `proveedorExistente` MÍNIMO (id/nombre/nit/activo,
 * sin exponer más datos de los necesarios), pero si ese proveedor YA está en el catálogo local (activo, por eso
 * llegó a colisionar), preferimos ese objeto COMPLETO — método de pago habitual, NIT, contacto, teléfono, banco,
 * cuenta, días de crédito — en vez del mínimo. El mínimo queda solo como respaldo si por algún motivo no estuviera
 * ya cargado. Pura, para probarla sin useState/fetch.
 */
export function resolverProveedorExistente(proveedores: ProveedorPickerOpt[], existente: DuplicadoInfo): ProveedorPickerOpt {
  return proveedores.find(p => p.id === existente.id) ?? proveedorMinimoDesdeExistente(existente);
}

/**
 * COMPRAS-PROVEEDOR-INLINE (sección 3, 10-11) — modal compacto de alta rápida, dentro del requerimiento. Maneja los
 * dos casos de 409 estructurado (PROVEEDOR_DUPLICADO / PROVEEDOR_DUPLICADO_INACTIVO) sin dejar crear una copia.
 */
export function ProveedorInlineModal({ slug, nombreInicial, proveedores, puedeEditar, onClose, onCreado }: {
  slug: string; nombreInicial: string; proveedores: ProveedorPickerOpt[]; puedeEditar: boolean;
  onClose: () => void; onCreado: (p: ProveedorPickerOpt) => void;
}) {
  const api = `/api/empresas/${encodeURIComponent(slug)}/compras/proveedores`;
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(CAMPOS_MODAL.map(([campo]) => [campo, campo === "nombre_comercial" ? nombreInicial : ""])));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [duplicado, setDuplicado] = useState<{ codigo: DuplicadoCodigo; existente: DuplicadoInfo } | null>(null);
  const input = "w-full rounded border border-[var(--border)] bg-[var(--input)] p-2";

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(""); setDuplicado(null);
    try {
      const payload: Record<string, unknown> = { ...form, activo: true };
      payload.dias_credito = form.dias_credito.trim() === "" ? null : Number(form.dias_credito);
      const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.codigo && data.proveedorExistente) { setDuplicado({ codigo: data.codigo, existente: data.proveedorExistente }); return; }
        throw new Error(data.error || "No se pudo crear el proveedor.");
      }
      onCreado(data.proveedor);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo crear el proveedor."); }
    finally { setGuardando(false); }
  }

  async function reactivarYUsar() {
    if (!duplicado) return;
    setGuardando(true); setError("");
    try {
      // PATCH existente (nunca SQL directo desde el cliente) — mismo endpoint/guard que "Reactivar" en Proveedores comerciales.
      const res = await fetch(`${api}/${duplicado.existente.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo reactivar el proveedor.");
      onCreado(data.proveedor ?? proveedorMinimoDesdeExistente(duplicado.existente));
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo reactivar el proveedor."); }
    finally { setGuardando(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Nuevo proveedor" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Nuevo proveedor</h2>
          <button type="button" onClick={onClose}>Cerrar</button>
        </div>

        {duplicado ? (
          <div className="space-y-3 text-sm">
            {duplicado.codigo === "PROVEEDOR_DUPLICADO" ? (
              <>
                <p role="alert">Ya existe el proveedor &quot;{duplicado.existente.nombre_comercial}&quot;.</p>
                <button type="button" className="rounded bg-[var(--accent)] px-4 py-2 text-white" onClick={() => onCreado(resolverProveedorExistente(proveedores, duplicado.existente))}>
                  Usar proveedor existente
                </button>
              </>
            ) : (
              <>
                <p role="alert">Este proveedor ya existe pero está inactivo: &quot;{duplicado.existente.nombre_comercial}&quot;.</p>
                {puedeEditar ? (
                  <button type="button" disabled={guardando} className="rounded bg-[var(--accent)] px-4 py-2 text-white" onClick={reactivarYUsar}>
                    {guardando ? "Reactivando…" : "Reactivar y usar"}
                  </button>
                ) : (
                  <p>Solicitá a un usuario con permiso de edición que reactive el proveedor.</p>
                )}
              </>
            )}
            {error ? <p role="alert" className="text-red-400">{error}</p> : null}
            <button type="button" className="underline" onClick={() => setDuplicado(null)}>Volver a intentar con otros datos</button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={guardar}>
            <fieldset disabled={guardando} className="grid gap-3 sm:grid-cols-2">
              {CAMPOS_MODAL.map(([campo, etiqueta, max, requerido]) => (
                <label key={campo} className={campo === "nombre_comercial" ? "sm:col-span-2" : ""}>{etiqueta}
                  <input
                    className={input}
                    required={requerido}
                    maxLength={max}
                    type={campo === "dias_credito" ? "number" : campo.includes("correo") ? "email" : "text"}
                    min={campo === "dias_credito" ? 0 : undefined}
                    step={campo === "dias_credito" ? 1 : undefined}
                    value={form[campo]}
                    onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
                  />
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-[var(--muted)]">Podés completar los demás datos después en Proveedores comerciales.</p>
            {error ? <p role="alert" className="text-red-400">{error}</p> : null}
            <div className="flex gap-3">
              <button className="rounded bg-[var(--accent)] px-4 py-2 text-white" disabled={guardando} type="submit">{guardando ? "Creando…" : "Crear proveedor"}</button>
              <button type="button" disabled={guardando} onClick={onClose}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
