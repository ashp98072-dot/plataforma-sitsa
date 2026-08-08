"use client";

import type {
  PreguntaFacturacion,
  RespuestasFacturacion,
  SeccionFacturacion,
} from "@/lib/facturacion/cuestionario";

type Props = {
  secciones: SeccionFacturacion[];
  respuestas: RespuestasFacturacion;
  onChange: (id: string, value: RespuestasFacturacion[string]) => void;
  readOnly?: boolean;
};

function Campo({
  p,
  value,
  onChange,
  readOnly,
}: {
  p: PreguntaFacturacion;
  value: RespuestasFacturacion[string];
  onChange: (v: RespuestasFacturacion[string]) => void;
  readOnly?: boolean;
}) {
  const inputClass =
    "w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

  if (p.tipo === "si_no") {
    const v = value === true ? "si" : value === false ? "no" : "";
    return (
      <select
        className={inputClass}
        disabled={readOnly}
        value={v}
        onChange={(e) => {
          if (e.target.value === "") onChange(null);
          else onChange(e.target.value === "si");
        }}
      >
        <option value="">—</option>
        <option value="si">Sí</option>
        <option value="no">No</option>
      </select>
    );
  }

  if (p.tipo === "opcion") {
    return (
      <select
        className={inputClass}
        disabled={readOnly}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">—</option>
        {(p.opciones ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (p.tipo === "multi") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-2">
        {(p.opciones ?? []).map((o) => {
          const on = selected.includes(o.value);
          return (
            <label
              key={o.value}
              className={[
                "cursor-pointer rounded-md border px-2 py-1 text-xs",
                on
                  ? "border-[var(--accent)] bg-[var(--nav-active)]"
                  : "border-[var(--border)] text-[var(--muted)]",
                readOnly ? "pointer-events-none opacity-70" : "",
              ].join(" ")}
            >
              <input
                type="checkbox"
                className="sr-only"
                disabled={readOnly}
                checked={on}
                onChange={() => {
                  if (on) onChange(selected.filter((x) => x !== o.value));
                  else onChange([...selected, o.value]);
                }}
              />
              {o.label}
            </label>
          );
        })}
      </div>
    );
  }

  if (p.tipo === "numero") {
    return (
      <input
        type="number"
        className={inputClass}
        disabled={readOnly}
        value={typeof value === "number" ? value : value === null || value === undefined ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    );
  }

  if (p.tipo === "textarea") {
    return (
      <textarea
        className={inputClass}
        rows={3}
        disabled={readOnly}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <input
      type="text"
      className={inputClass}
      disabled={readOnly}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function CuestionarioFields({
  secciones,
  respuestas,
  onChange,
  readOnly,
}: Props) {
  return (
    <div className="space-y-6">
      {secciones.map((sec) => (
        <section
          key={sec.id}
          className="space-y-3 border-b border-[var(--border)] pb-5 last:border-b-0"
        >
          <div>
            <h3 className="text-base font-semibold">{sec.titulo}</h3>
            {sec.descripcion ? (
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {sec.descripcion}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {sec.preguntas.map((p) => (
              <label
                key={p.id}
                className={[
                  "block space-y-1 text-sm",
                  p.tipo === "textarea" || p.tipo === "multi"
                    ? "md:col-span-2"
                    : "",
                ].join(" ")}
              >
                <span className="font-medium">
                  {p.etiqueta}
                  {p.requerido ? (
                    <span className="text-[var(--danger)]"> *</span>
                  ) : null}
                </span>
                {p.ayuda ? (
                  <span className="block text-xs text-[var(--muted)]">
                    {p.ayuda}
                  </span>
                ) : null}
                <Campo
                  p={p}
                  value={respuestas[p.id]}
                  onChange={(v) => onChange(p.id, v)}
                  readOnly={readOnly}
                />
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
