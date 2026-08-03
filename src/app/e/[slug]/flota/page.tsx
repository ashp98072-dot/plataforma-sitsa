"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

type Vehiculo = {
  id: number;
  placa: string;
  marca: string | null;
  modelo: string | null;
  km_actual: number | null;
  km_intervalo_servicio: number;
  km_ultimo_servicio: number | null;
  en_taller: number;
  estado: string;
};

export default function FlotaPage() {
  const slug = String(useParams().slug);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [placa, setPlaca] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [kmActual, setKmActual] = useState(0);
  const [vehiculoId, setVehiculoId] = useState(0);
  const [kmLectura, setKmLectura] = useState(0);
  const [tipoServicio, setTipoServicio] = useState("Mantenimiento");
  const [msg, setMsg] = useState("");
  const [resumen, setResumen] = useState<{
    totalVehiculos: number;
    enTaller: number;
    alertasServicio: number;
  } | null>(null);
  const [costos, setCostos] = useState<Record<string, unknown>[]>([]);

  const cargar = useCallback(async () => {
    const [res, rep] = await Promise.all([
      fetch(`/api/empresas/${slug}/flota/vehiculos`),
      fetch(`/api/empresas/${slug}/flota/reportes`),
    ]);
    const data = await res.json();
    const reporte = await rep.json();
    if (res.ok) {
      setVehiculos(data.vehiculos ?? []);
      if (!vehiculoId && data.vehiculos?.[0]) {
        setVehiculoId(Number(data.vehiculos[0].id));
      }
    }
    if (rep.ok) {
      setResumen(reporte.resumen ?? null);
      setCostos(reporte.costosPorMes ?? []);
    }
  }, [slug, vehiculoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/flota/vehiculos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placa, marca, modelo, kmActual }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setPlaca("");
      await cargar();
    }
  }

  async function registrarLectura() {
    const res = await fetch(`/api/empresas/${slug}/flota/lecturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehiculoId,
        km: kmLectura,
        fechaLectura: new Date().toISOString().slice(0, 10),
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  async function registrarServicio() {
    const res = await fetch(`/api/empresas/${slug}/flota/servicios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehiculoId,
        tipo: tipoServicio,
        kmServicio: kmLectura || undefined,
        fechaServicio: new Date().toISOString().slice(0, 10),
        costo: 0,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  async function toggleTaller(id: number, enTaller: boolean) {
    const res = await fetch(`/api/empresas/${slug}/flota/vehiculos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enTaller: !enTaller }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Flota / Coordinador de predios</h1>
        <p className="text-sm text-[var(--muted)]">
          Vehículos, lecturas de km, servicios y taller (base control_flota).
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <input className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Placa" value={placa} onChange={(e) => setPlaca(e.target.value)} required />
        <input className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
        <input className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} />
        <input type="number" className="w-28 rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={kmActual} onChange={(e) => setKmActual(Number(e.target.value))} />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">Registrar</button>
      </form>

      <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <select
          className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1"
          value={vehiculoId}
          onChange={(e) => setVehiculoId(Number(e.target.value))}
        >
          {vehiculos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.placa}
            </option>
          ))}
        </select>
        <input
          type="number"
          className="w-32 rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1"
          placeholder="Km"
          value={kmLectura}
          onChange={(e) => setKmLectura(Number(e.target.value))}
        />
        <button type="button" onClick={() => void registrarLectura()} className="rounded bg-[var(--accent-2)] px-3 py-1 text-sm">
          Lectura km
        </button>
        <input
          className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1"
          value={tipoServicio}
          onChange={(e) => setTipoServicio(e.target.value)}
        />
        <button type="button" onClick={() => void registrarServicio()} className="rounded bg-[#1F6AA5] px-3 py-1 text-sm">
          Registrar servicio
        </button>
      </div>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {resumen ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
            Vehículos: <strong>{resumen.totalVehiculos}</strong>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
            En taller: <strong>{resumen.enTaller}</strong>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
            Alertas servicio: <strong>{resumen.alertasServicio}</strong>
          </div>
        </div>
      ) : null}

      {costos.length ? (
        <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
          <h2 className="font-medium">Costos de servicio por mes</h2>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            {costos.map((c) => (
              <li key={String(c.mes)}>
                {String(c.mes)} · Q{Number(c.total).toFixed(2)} ({String(c.n)} svc)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#0d9488] text-white">
            <tr>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Marca</th>
              <th className="px-3 py-2">Modelo</th>
              <th className="px-3 py-2">Km</th>
              <th className="px-3 py-2">Taller</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {vehiculos.map((v) => {
              const km = Number(v.km_actual ?? 0);
              const intervalo = Number(v.km_intervalo_servicio ?? 10000);
              const ultimo = Number(v.km_ultimo_servicio ?? 0);
              const pendiente = intervalo - (km - ultimo);
              return (
                <tr key={v.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2">{v.placa}</td>
                  <td className="px-3 py-2">{v.marca ?? "—"}</td>
                  <td className="px-3 py-2">{v.modelo ?? "—"}</td>
                  <td className="px-3 py-2">
                    {km.toLocaleString("es-GT")}
                    <span className="ml-2 text-xs text-[var(--muted)]">
                      ({pendiente <= 500 ? "servicio pronto" : `faltan ${pendiente} km`})
                    </span>
                  </td>
                  <td className="px-3 py-2">{v.en_taller ? "Sí" : "No"}</td>
                  <td className="px-3 py-2">{v.estado}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-xs text-[var(--accent-2)] underline"
                      onClick={() => void toggleTaller(v.id, Boolean(v.en_taller))}
                    >
                      {v.en_taller ? "Salir taller" : "Entrar taller"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}