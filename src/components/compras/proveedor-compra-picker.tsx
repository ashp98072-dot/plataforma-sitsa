"use client";
import { useState } from "react";
import { CatalogoSearchSelect, opcionesConHistorico, type CatalogoSearchOption } from "@/components/tms/catalogo-search-select";
import { normalizarNombreProveedor } from "@/lib/compras/proveedor-identidad";
import { ProveedorInlineModal } from "./proveedor-inline-modal";

export type ProveedorPickerOpt = { id: number; nombre_comercial: string; nit: string | null; contacto_nombre: string | null; contacto_telefono: string | null; telefono: string | null; metodo_pago_habitual: string | null; banco: string | null; numero_cuenta: string | null; dias_credito: number | null };

export function opcionesProveedoresCompra(proveedores: ProveedorPickerOpt[], id: number, nombre?: string): CatalogoSearchOption[] {
  return opcionesConHistorico(proveedores.map(p => ({
    value: String(p.id), label: p.nombre_comercial,
    searchText: [p.nombre_comercial, p.nit, p.contacto_nombre, p.contacto_telefono, p.telefono].filter(Boolean).join(" "),
  })), String(id || ""), nombre || "Proveedor histórico");
}

/**
 * COMPRAS-PROVEEDOR-INLINE (sección 2) — lógica PURA de si ya hay coincidencia exacta normalizada en el catálogo
 * (ya filtrado a activos): sin texto de búsqueda se considera "hay coincidencia" (no se ofrece crear todavía).
 * Extraída para poder probarla sin renderizar/simular tecleo (este repo no tiene jsdom/Testing Library).
 */
export function hayCoincidenciaExactaProveedor(proveedores: ProveedorPickerOpt[], texto: string): boolean {
  const t = texto.trim();
  if (!t) return true;
  const normalizado = normalizarNombreProveedor(t);
  return proveedores.some(p => normalizarNombreProveedor(p.nombre_comercial) === normalizado);
}

/**
 * COMPRAS-PROVEEDOR-INLINE (sección 4) — agrega el proveedor recién creado/reactivado al catálogo local, o lo
 * reemplaza si ya estaba (mismo id) — nunca duplica una entrada. Pura, para probarla sin useState.
 */
export function fusionarProveedorEnCatalogo(proveedores: ProveedorPickerOpt[], nuevo: ProveedorPickerOpt): ProveedorPickerOpt[] {
  return proveedores.some(v => v.id === nuevo.id) ? proveedores.map(v => v.id === nuevo.id ? nuevo : v) : [...proveedores, nuevo];
}

type Props = {
  slug: string;
  proveedores: ProveedorPickerOpt[];
  value: number;
  nombreHistorico?: string;
  inputClassName: string;
  onChange: (value: string) => void;
  onProveedorCreado: (p: ProveedorPickerOpt) => void;
  puedeCrear?: boolean;
  puedeEditar?: boolean;
};

/**
 * COMPRAS-PROVEEDOR-INLINE (secciones 2-3, 18-19) — envuelve CatalogoSearchSelect (sin tocarlo de forma invasiva:
 * solo usa el prop opt-in onSearchChange) y agrega la acción "+ Crear proveedor "<texto>"" cuando, al escribir en
 * "Buscar proveedor", no hay coincidencia exacta normalizada en el catálogo (ya filtrado a activos por
 * catalogosCompra) y el usuario tiene compras_proveedores:crear. Wrapper específico de Compras — no un componente
 * compartido — para no arriesgar regresiones en los otros 8 consumidores de CatalogoSearchSelect.
 */
export function ProveedorCompraPicker({ slug, proveedores, value, nombreHistorico, inputClassName, onChange, onProveedorCreado, puedeCrear = false, puedeEditar = false }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [modalAbierto, setModalAbierto] = useState(false);
  const opciones = opcionesProveedoresCompra(proveedores, value, nombreHistorico);
  const texto = busqueda.trim();
  const mostrarAccionCrear = puedeCrear && texto.length > 0 && !hayCoincidenciaExactaProveedor(proveedores, texto);

  return (
    <div className="space-y-1">
      <CatalogoSearchSelect
        label="Proveedor"
        placeholder="Buscar proveedor..."
        value={String(value || "")}
        options={opciones}
        inputClassName={inputClassName}
        emptyLabel="Seleccionar"
        onChange={onChange}
        onSearchChange={setBusqueda}
      />
      {mostrarAccionCrear ? (
        <button type="button" className="text-xs text-[var(--accent)] underline" onClick={() => setModalAbierto(true)}>
          + Crear proveedor &quot;{texto}&quot;
        </button>
      ) : null}
      {modalAbierto ? (
        <ProveedorInlineModal
          slug={slug}
          nombreInicial={texto}
          proveedores={proveedores}
          puedeEditar={puedeEditar}
          onClose={() => setModalAbierto(false)}
          onCreado={(p) => { onProveedorCreado(p); onChange(String(p.id)); setBusqueda(""); setModalAbierto(false); }}
        />
      ) : null}
    </div>
  );
}
