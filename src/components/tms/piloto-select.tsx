"use client";

export type PilotoOpt = {
  id: number;
  codigo: string;
  nombre: string;
};

type Props = {
  pilotos: PilotoOpt[];
  empleadoId: number;
  nombre: string;
  inputClassName: string;
  onChange: (next: { empleadoId: number; nombre: string }) => void;
};

/** Elige piloto de planilla RRHH o escribe nombre libre. */
export function PilotoSelect({
  pilotos,
  empleadoId,
  nombre,
  inputClassName,
  onChange,
}: Props) {
  const display =
    empleadoId > 0
      ? (pilotos.find((p) => p.id === empleadoId)?.nombre ?? nombre)
      : nombre;

  return (
    <label className="block text-xs text-[var(--muted)]">
      Piloto (planilla RRHH o escribir)
      <select
        className={`${inputClassName} mt-1 w-full`}
        value={empleadoId > 0 ? String(empleadoId) : ""}
        onChange={(e) => {
          const id = Number(e.target.value) || 0;
          if (!id) {
            onChange({ empleadoId: 0, nombre: "" });
            return;
          }
          const p = pilotos.find((x) => x.id === id);
          onChange({
            empleadoId: id,
            nombre: p?.nombre ?? "",
          });
        }}
      >
        <option value="">— Elegir de RRHH —</option>
        {pilotos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
            {p.codigo ? ` (${p.codigo})` : ""}
          </option>
        ))}
      </select>
      <input
        className={`${inputClassName} mt-1 w-full`}
        placeholder="O escribe el nombre del piloto…"
        value={display}
        list="pilotos-rrhh-tms"
        onChange={(e) => {
          const val = e.target.value;
          const match = pilotos.find(
            (p) => p.nombre.toLowerCase() === val.trim().toLowerCase(),
          );
          onChange({
            empleadoId: match ? match.id : 0,
            nombre: val,
          });
        }}
      />
      <datalist id="pilotos-rrhh-tms">
        {pilotos.map((p) => (
          <option key={p.id} value={p.nombre}>
            {p.codigo}
          </option>
        ))}
      </datalist>
      <span className="mt-0.5 block text-[10px]">
        {empleadoId
          ? `Enlazado a RRHH #${empleadoId}`
          : pilotos.length
            ? `${pilotos.length} pilotos en planilla`
            : "Sin pilotos en RRHH — puedes escribir el nombre"}
      </span>
    </label>
  );
}
