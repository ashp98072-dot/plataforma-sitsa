"use client";
import { useCallback, useEffect, useState } from "react";
import { jsonCB2 } from "./client";
import { button } from "./controles";

type Item = { proveedor_id: number; proveedor: string; placa_hash: string; placa_original: string; vehiculo_id: number; placa: string; motivo: string; creado_por: number; creado_en: string; revocado_por: number | null; revocado_en: string | null };
export function PlacasEquivalenciasCB2({ api, admin }: { api: string; admin: boolean }) {
  const [datos, setDatos] = useState<{ instalado: boolean; items: Item[] }>(), [mensaje, setMensaje] = useState("");
  const cargar = useCallback(async () => { try { setDatos(await jsonCB2(`${api}/placas-equivalencias`)); } catch (e) { setMensaje(e instanceof Error ? e.message : "No se pudo consultar."); } }, [api]);
  useEffect(() => { const timer = setTimeout(() => void cargar(), 0); return () => clearTimeout(timer); }, [cargar]);
  async function revocar(item: Item) {
    if (!window.confirm(`¿Revocar la equivalencia ${item.placa_original} → ${item.placa} para ${item.proveedor}? Los consumos anteriores no cambian.`)) return;
    try { await jsonCB2(`${api}/placas-equivalencias`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proveedorId: item.proveedor_id, placaHash: item.placa_hash }) }); setMensaje("Equivalencia revocada."); await cargar(); }
    catch (e) { setMensaje(e instanceof Error ? e.message : "No se pudo revocar."); }
  }
  return <section aria-label="Equivalencias de placas" className="space-y-2"><h3>Equivalencias de placas por proveedor</h3>{mensaje && <p role="status">{mensaje}</p>}{datos && !datos.instalado && <p>Registro no instalado.</p>}<ul>{datos?.items.map(e => <li key={`${e.proveedor_id}:${e.placa_hash}`}><strong>{e.proveedor}</strong>: {e.placa_original} → {e.placa} (#{e.vehiculo_id}) · {e.motivo} · Usuario #{e.creado_por}, {String(e.creado_en)} · {e.revocado_en ? `Revocada por #${e.revocado_por}, ${String(e.revocado_en)}` : "Vigente"} {admin && !e.revocado_en && <button className={button} type="button" onClick={() => void revocar(e)}>Revocar</button>}</li>)}</ul><p>Se muestran las 1000 más recientes. Revocar no modifica consumos históricos.</p></section>;
}
