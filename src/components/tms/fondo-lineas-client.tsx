"use client";
import { useEffect, useState } from "react";

export type DetalleLineasFondo = { lineas: { id: number; categoria: string; descripcion: string | null; empleadoNombre: string | null; cargo: string | null; metodoPago: string | null; cuenta: string | null; placa: string | null; clienteNombre: string | null; fechaViaje: string | null; cantidad: number; monto: number }[] };
export function FondoLineasClient({ slug, id, cache }: { slug: string; id: number; cache: Map<string, DetalleLineasFondo> }) {
  const clave = `${slug}/${id}`;
  const [datos, setDatos] = useState<DetalleLineasFondo | null>(() => cache.get(clave) ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (cache.has(clave)) return;
    const controller = new AbortController();
    fetch(`/api/empresas/${slug}/tms/fondos/${id}`, { cache: "no-store", signal: controller.signal }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar las líneas.");
      return data.solicitud as DetalleLineasFondo;
    }).then(solicitud => {
      if (!controller.signal.aborted) { cache.set(clave, solicitud); setDatos(solicitud); }
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudieron cargar las líneas."); });
    return () => controller.abort();
  }, [slug, id, cache, clave]);
  if (error) return <p role="alert" className="text-red-400">{error} Cierre y vuelva a abrir para reintentar.</p>;
  if (!datos) return <p role="status">Cargando líneas…</p>;
  const moneda = (n: number) => `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[1200px] text-left text-xs"><thead className="text-[var(--muted)]"><tr>{["Categoría", "Descripción", "Empleado", "Cargo", "Método de pago", "Cuenta / Número", "Placa", "Cliente", "Fecha viaje", "Cantidad", "Monto", "Total línea"].map(t => <th scope="col" className="px-2 py-1" key={t}>{t}</th>)}</tr></thead><tbody>
    {datos.lineas.map(l => <tr key={l.id} className="border-t border-[var(--border)]">{[l.categoria, l.descripcion, l.empleadoNombre, l.cargo, l.metodoPago, l.cuenta, l.placa, l.clienteNombre, l.fechaViaje, l.cantidad, moneda(l.monto), moneda(l.cantidad * l.monto)].map((v, i) => <td className="px-2 py-2" key={i}>{v ?? "—"}</td>)}</tr>)}
  </tbody></table></div>;
}
