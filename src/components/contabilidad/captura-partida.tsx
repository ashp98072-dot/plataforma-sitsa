"use client";

import { useRef, useState, type FormEvent } from "react";
import { mostrarCentavos, prepararCaptura, resumirCaptura, type LineaCaptura } from "@/lib/contabilidad/captura";

type Cuenta = { id: number; codigo: string; nombre: string };
const nuevaLinea = (): LineaCaptura => ({ cuentaId: "", debe: "", haber: "" });
const input = "rounded border border-[var(--border)] bg-[var(--input)] p-2 w-full";

export function CapturaPartida({ cuentas, ocupado, guardar }: {
  cuentas: Cuenta[]; ocupado: boolean;
  guardar: (body: ReturnType<typeof prepararCaptura>) => Promise<boolean>;
}) {
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState("");
  const [glosa, setGlosa] = useState("");
  const [lineas, setLineas] = useState([nuevaLinea(), nuevaLinea()]);
  const [error, setError] = useState("");
  const [registrada, setRegistrada] = useState(false);
  const enviando = useRef(false);
  const resumen = resumirCaptura(lineas);
  function cambiar(index: number, campo: keyof LineaCaptura, valor: string) {
    setLineas((actuales) => actuales.map((l, i) => i === index ? { ...l, [campo]: valor } : l));
  }
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (ocupado || enviando.current || registrada) return;
    setError("");
    let datos: ReturnType<typeof prepararCaptura>;
    try { datos = prepararCaptura(numero, fecha, glosa, lineas, cuentas.map((c) => c.id)); }
    catch (e) { setError(e instanceof Error ? e.message : "Revisa la partida."); return; }
    if (!confirm(`Registrar partida ${datos.numero} por Q${mostrarCentavos(resumen.debe)} en la entidad seleccionada. No es un borrador. ¿Continuar?`)) return;
    enviando.current = true;
    try { if (await guardar(datos)) setRegistrada(true); }
    finally { enviando.current = false; }
  }
  return <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
    <h2 className="text-lg font-semibold">Registrar partida contable</h2>
    <p className="text-sm text-[var(--muted)]">Numeración manual y única dentro de la entidad seleccionada. Se registra directamente; los cierres y reversos corresponden a la siguiente fase.</p>
    {!cuentas.length && <p role="status">Crea una cuenta activa en esta entidad antes de registrar partidas.</p>}
    <form onSubmit={enviar} className="space-y-3">
      <fieldset disabled={ocupado || registrada} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label>Número de partida<input className={input} value={numero} maxLength={40} required onChange={(e) => setNumero(e.target.value)} /></label>
          <label>Fecha contable<input className={input} type="date" value={fecha} required onChange={(e) => setFecha(e.target.value)} /></label>
        </div>
        <label className="block">Descripción / glosa<textarea className={input} value={glosa} maxLength={500} required onChange={(e) => setGlosa(e.target.value)} /></label>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr><th className="text-left">Cuenta activa</th><th>Debe (Q)</th><th>Haber (Q)</th><th>Acción</th></tr></thead>
          <tbody>{lineas.map((l, i) => <tr key={i}>
            <td className="min-w-56 p-1"><select className={input} aria-label={`Cuenta línea ${i + 1}`} value={l.cuentaId} required onChange={(e) => cambiar(i, "cuentaId", e.target.value)}>
              <option value="">Seleccionar cuenta</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>)}
            </select></td>
            {(["debe", "haber"] as const).map((campo) => <td key={campo} className="min-w-32 p-1"><input className={input} aria-label={`${campo === "debe" ? "Debe" : "Haber"} línea ${i + 1}`} inputMode="decimal" placeholder="0.00" value={l[campo]} onChange={(e) => cambiar(i, campo, e.target.value)} /></td>)}
            <td className="p-1"><button type="button" aria-label={`Quitar línea ${i + 1}`} disabled={lineas.length <= 2} onClick={() => setLineas((actuales) => actuales.filter((_, n) => n !== i))}>Quitar</button></td>
          </tr>)}</tbody>
        </table></div>
        <button type="button" disabled={lineas.length >= 500} className="rounded border px-3 py-2" onClick={() => setLineas((actuales) => [...actuales, nuevaLinea()])}>+ Agregar línea</button>
        <div aria-live="polite" className="flex flex-wrap gap-4">
          <span>Total Debe: Q{mostrarCentavos(resumen.debe)}</span><span>Total Haber: Q{mostrarCentavos(resumen.haber)}</span>
          <span>Diferencia: Q{mostrarCentavos(resumen.diferencia)}</span>
        </div>
        {resumen.errores.length > 0 && <p className="text-sm">Totales provisionales: completa las líneas con importes válidos.</p>}
        {error && <p role="alert" className="text-red-500">{error}</p>}
        <button className="rounded bg-[var(--accent)] px-4 py-2" disabled={!cuentas.length}>Registrar partida</button>
      </fieldset>
    </form>
    {registrada && <div role="status"><p>Partida registrada. Conservamos los datos a la vista para que puedas revisarlos.</p>
      <button type="button" className="mt-2 rounded border px-3 py-2" onClick={() => { setRegistrada(false); setNumero(""); setGlosa(""); setLineas([nuevaLinea(), nuevaLinea()]); setError(""); }}>Nueva partida</button>
    </div>}
    <p className="text-sm text-[var(--muted)]">Si se pierde la conexión, consulta los asientos antes de reintentar y conserva el mismo número para evitar duplicados.</p>
  </section>;
}
