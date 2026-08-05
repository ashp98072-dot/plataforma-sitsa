"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  FLOTA_NAV,
  tienePermiso,
  type PermisoModulo,
} from "@/lib/permisos-shared";

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

type Lectura = {
  id: number;
  placa: string;
  km: number;
  fecha_lectura: string;
  nota: string | null;
};

type Servicio = {
  id: number;
  placa: string;
  tipo: string;
  km_servicio: number | null;
  fecha_servicio: string;
  costo: number;
};

type Tab = "dashboard" | "vehiculos" | "servicios" | "lecturas" | "reportes" | "piloto";

const TAB_SUB: Record<Exclude<Tab, "dashboard">, string> = {
  vehiculos: "flota_vehiculos",
  servicios: "flota_servicios",
  lecturas: "flota_lecturas",
  reportes: "flota_reportes",
  piloto: "flota_piloto",
};

export default function FlotaPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-[var(--muted)]">Cargando flota…</p>}
    >
      <FlotaPageInner />
    </Suspense>
  );
}

function FlotaPageInner() {
  const slug = String(useParams().slug);
  const router = useRouter();
  const search = useSearchParams();
  const tabParam = (search.get("tab") as Tab | null) ?? "dashboard";

  const [permisos, setPermisos] = useState<PermisoModulo[]>([]);
  const [rol, setRol] = useState("");
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [placa, setPlaca] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [kmActual, setKmActual] = useState(0);
  const [vehiculoId, setVehiculoId] = useState(0);
  const [kmLectura, setKmLectura] = useState(0);
  const [tipoServicio, setTipoServicio] = useState("mantenimiento");
  const [costo, setCosto] = useState(0);
  const [destino, setDestino] = useState("");
  const [msg, setMsg] = useState("");
  const [resumen, setResumen] = useState<{
    totalVehiculos: number;
    enTaller: number;
    alertasServicio: number;
  } | null>(null);
  const [costos, setCostos] = useState<Record<string, unknown>[]>([]);

  const isAdmin = rol === "Admin";
  const can = useCallback(
    (sub: string, accion: "ver" | "crear" | "editar" = "ver") =>
      isAdmin ||
      permisos.length === 0 ||
      tienePermiso(permisos, sub, accion),
    [isAdmin, permisos],
  );

  const tab: Tab = useMemo(() => {
    const allowed: Tab[] = ["dashboard"];
    for (const item of FLOTA_NAV) {
      if (can(item.sub, "ver")) {
        allowed.push(item.path as Tab);
      }
    }
    if (allowed.includes(tabParam)) return tabParam;
    return allowed[0] ?? "dashboard";
  }, [tabParam, can]);

  const setTab = (t: Tab) => {
    const q = t === "dashboard" ? "" : `?tab=${t}`;
    router.replace(`/e/${slug}/flota${q}`);
  };

  const cargar = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    setRol(me.user?.rol ?? "");
    setPermisos(me.permisos ?? []);

    const [res, rep, lec, svc] = await Promise.all([
      fetch(`/api/empresas/${slug}/flota/vehiculos`),
      fetch(`/api/empresas/${slug}/flota/reportes`),
      fetch(`/api/empresas/${slug}/flota/lecturas`),
      fetch(`/api/empresas/${slug}/flota/servicios`),
    ]);
    if (res.ok) {
      const data = await res.json();
      setVehiculos(data.vehiculos ?? []);
      if (data.vehiculos?.[0]) setVehiculoId(Number(data.vehiculos[0].id));
    }
    if (rep.ok) {
      const reporte = await rep.json();
      setResumen(reporte.resumen ?? null);
      setCostos(reporte.costosPorMes ?? []);
    }
    if (lec.ok) {
      const data = await lec.json();
      setLecturas(data.lecturas ?? []);
    }
    if (svc.ok) {
      const data = await svc.json();
      setServicios(data.servicios ?? []);
    }
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmitVehiculo(e: FormEvent) {
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

  async function registrarLectura(nota?: string) {
    const res = await fetch(`/api/empresas/${slug}/flota/lecturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehiculoId,
        km: kmLectura,
        fechaLectura: new Date().toISOString().slice(0, 10),
        nota: nota || undefined,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setKmLectura(0);
      setDestino("");
      await cargar();
    }
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
        costo,
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

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "dashboard", label: "Dashboard", show: true },
    ...FLOTA_NAV.map((item) => ({
      id: item.path as Tab,
      label: item.label,
      show: can(item.sub, "ver"),
    })),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Control de Flota / Predios</h1>
        <p className="text-sm text-[var(--muted)]">
          Vehículos, lecturas, servicios y reportes (base control-flota).
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                "rounded-lg px-3 py-1.5 text-sm",
                tab === t.id
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:bg-white/5",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
      </nav>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {tab === "dashboard" ? (
        <div className="space-y-4">
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
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Sin datos de resumen (¿permiso de reportes?).
            </p>
          )}
          <p className="text-sm text-[var(--muted)]">
            Usa las pestañas o el menú lateral para Vehículos, Lecturas,
            Servicios, Reportes o Registrar viaje.
          </p>
        </div>
      ) : null}

      {tab === "vehiculos" && can(TAB_SUB.vehiculos) ? (
        <div className="space-y-4">
          {can(TAB_SUB.vehiculos, "crear") ? (
            <form
              onSubmit={onSubmitVehiculo}
              className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <input
                className={input}
                placeholder="Placa"
                value={placa}
                onChange={(e) => setPlaca(e.target.value)}
                required
              />
              <input
                className={input}
                placeholder="Marca"
                value={marca}
                onChange={(e) => setMarca(e.target.value)}
              />
              <input
                className={input}
                placeholder="Modelo"
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
              />
              <input
                type="number"
                className={`${input} w-28`}
                value={kmActual}
                onChange={(e) => setKmActual(Number(e.target.value))}
              />
              <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
                Registrar vehículo
              </button>
            </form>
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
                          (
                          {pendiente <= 500
                            ? "servicio pronto"
                            : `faltan ${pendiente} km`}
                          )
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {v.en_taller ? "Sí" : "No"}
                      </td>
                      <td className="px-3 py-2">{v.estado}</td>
                      <td className="px-3 py-2">
                        {can(TAB_SUB.vehiculos, "editar") ? (
                          <button
                            type="button"
                            className="text-xs text-[var(--accent-2)] underline"
                            onClick={() =>
                              void toggleTaller(v.id, Boolean(v.en_taller))
                            }
                          >
                            {v.en_taller ? "Salir taller" : "Entrar taller"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "lecturas" && can(TAB_SUB.lecturas) ? (
        <div className="space-y-4">
          {can(TAB_SUB.lecturas, "crear") ? (
            <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <select
                className={input}
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
                className={`${input} w-32`}
                placeholder="Km"
                value={kmLectura || ""}
                onChange={(e) => setKmLectura(Number(e.target.value))}
              />
              <button
                type="button"
                onClick={() => void registrarLectura()}
                className="rounded bg-[var(--accent-2)] px-3 py-1 text-sm"
              >
                Guardar lectura
              </button>
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#334155] text-white">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Km</th>
                  <th className="px-3 py-2">Nota</th>
                </tr>
              </thead>
              <tbody>
                {lecturas.map((l) => (
                  <tr key={l.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">
                      {String(l.fecha_lectura).slice(0, 10)}
                    </td>
                    <td className="px-3 py-2">{l.placa}</td>
                    <td className="px-3 py-2">
                      {Number(l.km).toLocaleString("es-GT")}
                    </td>
                    <td className="px-3 py-2">{l.nota ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "servicios" && can(TAB_SUB.servicios) ? (
        <div className="space-y-4">
          {can(TAB_SUB.servicios, "crear") ? (
            <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <select
                className={input}
                value={vehiculoId}
                onChange={(e) => setVehiculoId(Number(e.target.value))}
              >
                {vehiculos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.placa}
                  </option>
                ))}
              </select>
              <select
                className={input}
                value={tipoServicio}
                onChange={(e) => setTipoServicio(e.target.value)}
              >
                <option value="mantenimiento">Mantenimiento</option>
                <option value="reparacion">Reparación</option>
              </select>
              <input
                type="number"
                className={`${input} w-28`}
                placeholder="Km"
                value={kmLectura || ""}
                onChange={(e) => setKmLectura(Number(e.target.value))}
              />
              <input
                type="number"
                className={`${input} w-28`}
                placeholder="Costo"
                value={costo || ""}
                onChange={(e) => setCosto(Number(e.target.value))}
              />
              <button
                type="button"
                onClick={() => void registrarServicio()}
                className="rounded bg-[#1F6AA5] px-3 py-1 text-sm text-white"
              >
                Registrar servicio
              </button>
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#334155] text-white">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Km</th>
                  <th className="px-3 py-2">Costo</th>
                </tr>
              </thead>
              <tbody>
                {servicios.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">
                      {String(s.fecha_servicio).slice(0, 10)}
                    </td>
                    <td className="px-3 py-2">{s.placa}</td>
                    <td className="px-3 py-2">{s.tipo}</td>
                    <td className="px-3 py-2">
                      {s.km_servicio?.toLocaleString("es-GT") ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      Q{Number(s.costo).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "reportes" && can(TAB_SUB.reportes) ? (
        <div className="space-y-4">
          {resumen ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
                Vehículos: <strong>{resumen.totalVehiculos}</strong>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
                En taller: <strong>{resumen.enTaller}</strong>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
                Alertas: <strong>{resumen.alertasServicio}</strong>
              </div>
            </div>
          ) : null}
          {costos.length ? (
            <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
              <h2 className="font-medium">Costos de servicio por mes</h2>
              <ul className="mt-2 space-y-1 text-[var(--muted)]">
                {costos.map((c) => (
                  <li key={String(c.mes)}>
                    {String(c.mes)} · Q{Number(c.total).toFixed(2)} (
                    {String(c.n)} svc)
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Sin costos registrados.</p>
          )}
        </div>
      ) : null}

      {tab === "piloto" && can(TAB_SUB.piloto) ? (
        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium">Registrar viaje (piloto)</h2>
          <p className="text-xs text-[var(--muted)]">
            Registra km de salida/llegada del viaje como lectura con destino.
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              className={input}
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
              className={`${input} w-32`}
              placeholder="Km"
              value={kmLectura || ""}
              onChange={(e) => setKmLectura(Number(e.target.value))}
            />
            <input
              className={input}
              placeholder="Destino"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
            />
            {can(TAB_SUB.piloto, "crear") || can(TAB_SUB.lecturas, "crear") ? (
              <button
                type="button"
                className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white"
                onClick={() =>
                  void registrarLectura(
                    destino ? `Viaje → ${destino}` : "Viaje piloto",
                  )
                }
              >
                Registrar km de viaje
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
