"use client";

export type PropiedadForm = { tipoPropiedad: "EMPRESA" | "EXTERNO"; empresaPropietariaId: number | null; propietarioExterno: string; tipoVehiculo: string };
export function cambiarTipoPropiedad(value: PropiedadForm, tipo: PropiedadForm["tipoPropiedad"], empresaAdministradoraId: number): PropiedadForm {
  return { ...value, tipoPropiedad: tipo, empresaPropietariaId: tipo === "EXTERNO" ? null : value.empresaPropietariaId ?? (empresaAdministradoraId || null) };
}
export function PropiedadFields({ value, onChange, empresas, disabled, input, empresaAdministradoraId }: {
  value: PropiedadForm; onChange: (v: PropiedadForm) => void;
  empresas: { id: number; nombre: string }[]; disabled?: boolean; input: string; empresaAdministradoraId?: number;
}) {
  return <fieldset disabled={disabled} className="grid gap-3 rounded-lg border border-[var(--border)] p-3 sm:col-span-2 sm:grid-cols-2">
    <legend className="px-1 text-sm font-medium">Propiedad de la unidad</legend>
    <label className="text-xs">Tipo de propiedad<select className={`${input} mt-1 w-full`} value={value.tipoPropiedad}
      onChange={e => onChange(cambiarTipoPropiedad(value, e.target.value as PropiedadForm["tipoPropiedad"], empresaAdministradoraId ?? 0))}>
      <option value="EMPRESA">Vehículo propio / de empresa</option><option value="EXTERNO">Vehículo externo</option>
    </select></label>
    {value.tipoPropiedad === "EMPRESA" ? <label className="text-xs">Empresa propietaria<select className={`${input} mt-1 w-full`}
      value={value.empresaPropietariaId ?? ""} onChange={e => onChange({ ...value, empresaPropietariaId: Number(e.target.value) || null })}>
      <option value="">Selecciona una empresa</option>
      {value.empresaPropietariaId && !empresas.some(e => e.id === value.empresaPropietariaId) && <option value={value.empresaPropietariaId}>Empresa actual #{value.empresaPropietariaId} (inactiva)</option>}
      {empresas.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
    </select></label> : <label className="text-xs">Nombre del propietario externo<input className={`${input} mt-1 w-full`} maxLength={120}
      value={value.propietarioExterno} onChange={e => onChange({ ...value, propietarioExterno: e.target.value })} placeholder="Persona o empresa" /></label>}
    <label className="text-xs">Tipo de vehículo {value.tipoPropiedad === "EXTERNO" ? "(obligatorio)" : "(opcional)"}<input className={`${input} mt-1 w-full`} maxLength={80}
      value={value.tipoVehiculo} onChange={e => onChange({ ...value, tipoVehiculo: e.target.value })} placeholder="Motocicleta, automóvil, camión…" /></label>
    <p className="text-xs text-[var(--muted)]">El propietario no recibe acceso al sistema. El cambio conserva servicios, historial y empresa responsable de los abastecimientos.</p>
  </fieldset>;
}
