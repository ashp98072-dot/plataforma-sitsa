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
import {
  estiloAlertaKm,
  kmPendienteServicio,
} from "@/lib/flota/import-excel";

type Vehiculo = {
  id: number;
  placa: string;
  marca: string | null;
  modelo: string | null;
  descripcion?: string | null;
  color?: string | null;
  km_actual: number | null;
  km_intervalo_servicio: number;
  km_ultimo_servicio: number | null;
  fecha_ultimo_servicio?: string | null;
  en_taller: number;
  fecha_entrada_taller?: string | null;
  motivo_taller?: string | null;
  estado: string;
  activo?: number;
  empresa_activo?: string | null;
  notas?: string | null;
};

type Viaje = {
  id: number;
  vehiculo_id: number;
  placa: string;
  piloto_nombre: string;
  km_salida: number;
  km_llegada: number | null;
  destino: string | null;
  estado: string;
  hora_salida: string;
};

type Tab =
  | "dashboard"
  | "vehiculos"
  | "servicios"
  | "lecturas"
  | "reportes"
  | "piloto";

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
  const [viajes, setViajes] = useState<Viaje[]>([]);
  const [abiertos, setAbiertos] = useState<Viaje[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [msg, setMsg] = useState("");
  const [importando, setImportando] = useState(false);

  // forms
  const [placa, setPlaca] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [kmActual, setKmActual] = useState(0);
  const [intervalo, setIntervalo] = useState(10000);
  const [vehiculoId, setVehiculoId] = useState(0);
  const [kmLectura, setKmLectura] = useState(0);
  const [conductor, setConductor] = useState("");
  const [tipoServicio, setTipoServicio] = useState("mantenimiento");
  const [costo, setCosto] = useState(0);
  const [motivoTaller, setMotivoTaller] = useState("");
  const [pilotoNombre, setPilotoNombre] = useState("");
  const [destino, setDestino] = useState("");
  const [viajeId, setViajeId] = useState(0);
  const [kmLlegada, setKmLlegada] = useState(0);
  const [modoPiloto, setModoPiloto] = useState<"salida" | "llegada">("salida");
  const [resumen, setResumen] = useState<{
    totalVehiculos: number;
    enTaller: number;
    alertasServicio: number;
  } | null>(null);
  const [costos, setCostos] = useState<Record<string, unknown>[]>([]);

  const isAdmin = rol === "Admin";
  const can = useCallback(
    (sub: string, accion: "ver" | "crear" | "editar" | "eliminar" = "ver") =>
      isAdmin ||
      permisos.length === 0 ||
      tienePermiso(permisos, sub, accion),
    [isAdmin, permisos],
  );

  const tab: Tab = useMemo(() => {
    if (rol === "Piloto") return "piloto";
    const allowed: Tab[] = ["dashboard"];
    for (const item of FLOTA_NAV) {
      if (can(item.sub, "ver")) allowed.push(item.path as Tab);
    }
    if (allowed.includes(tabParam)) return tabParam;
    return allowed[0] ?? "dashboard";
  }, [tabParam, can, rol]);

  const setTab = (t: Tab) => {
    router.replace(`/e/${slug}/flota${t === "dashboard" ? "" : `?tab=${t}`}`);
  };

  const cargar = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    setRol(me.user?.rol ?? "");
    setPermisos(me.permisos ?? []);
    if (me.user?.nombre) setPilotoNombre(String(me.user.nombre));

    const [res, rep, via] = await Promise.all([
      fetch(`/api/empresas/${slug}/flota/vehiculos`),
      fetch(`/api/empresas/${slug}/flota/reportes`),
      fetch(`/api/empresas/${slug}/flota/viajes`),
    ]);
    if (res.ok) {
      const data = await res.json();
      const list = (data.vehiculos ?? []) as Vehiculo[];
      setVehiculos(list);
      if (list[0]) setVehiculoId(Number(list[0].id));
    }
    if (rep.ok) {
      const reporte = await rep.json();
      setResumen(reporte.resumen ?? null);
      setCostos(reporte.costosPorMes ?? []);
    }
    if (via.ok) {
      const data = await via.json();
      setViajes(data.viajes ?? []);
      setAbiertos(data.abiertos ?? []);
      if (data.abiertos?.[0]) setViajeId(Number(data.abiertos[0].id));
    }
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const activos = useMemo(
    () => vehiculos.filter((v) => v.activo !== 0),
    [vehiculos],
  );

  const filtradosDash = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return activos;
    return activos.filter(
      (v) =>
        v.placa.toLowerCase().includes(q) ||
        (v.marca ?? "").toLowerCase().includes(q) ||
        (v.modelo ?? "").toLowerCase().includes(q) ||
        (v.descripcion ?? "").toLowerCase().includes(q),
    );
  }, [activos, busqueda]);

  async function onImport(file: File) {
    setImportando(true);
    setMsg("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/empresas/${slug}/flota/import`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (data.errores?.length) {
      setMsg((m) => `${m} · ${data.errores.length} errores`);
    }
    setImportando(false);
    if (res.ok) await cargar();
  }

  async function onSubmitVehiculo(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/flota/vehiculos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placa,
        marca,
        modelo,
        descripcion,
        kmActual,
        kmIntervaloServicio: intervalo,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setPlaca("");
      setDescripcion("");
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
        nota: conductor ? `Conductor: ${conductor}` : undefined,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setKmLectura(0);
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

  async function toggleTaller(v: Vehiculo) {
    const enTaller = Boolean(v.en_taller);
    if (!enTaller && !motivoTaller.trim()) {
      setMsg("Indica el motivo para enviar a taller.");
      return;
    }
    const res = await fetch(`/api/empresas/${slug}/flota/vehiculos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: v.id,
        enTaller: !enTaller,
        motivoTaller: enTaller ? undefined : motivoTaller,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setMotivoTaller("");
      await cargar();
    }
  }

  async function salidaViaje() {
    const res = await fetch(`/api/empresas/${slug}/flota/viajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "salida",
        vehiculoId,
        pilotoNombre,
        kmSalida: kmLectura,
        destino: destino || undefined,
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

  async function llegadaViaje() {
    const res = await fetch(`/api/empresas/${slug}/flota/viajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "llegada",
        viajeId,
        kmLlegada,
        pilotoNombre: pilotoNombre || undefined,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setKmLlegada(0);
      await cargar();
    }
  }

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1.5 text-sm";

  const tabs: { id: Tab; label: string; show: boolean }[] =
    rol === "Piloto"
      ? [{ id: "piloto", label: "Registrar viaje", show: true }]
      : [
          { id: "dashboard", label: "Dashboard", show: true },
          ...FLOTA_NAV.map((item) => ({
            id: item.path as Tab,
            label: item.label,
            show: can(item.sub, "ver"),
          })),
        ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Control de Flota / Predios</h1>
          <p className="text-sm text-[var(--muted)]">
            Dashboard, vehículos, servicios, lecturas y viajes de piloto.
          </p>
        </div>
        {can("flota_vehiculos", "crear") && rol !== "Piloto" ? (
          <label className="cursor-pointer rounded bg-[#0d9488] px-3 py-2 text-sm text-white">
            {importando ? "Importando…" : "Importar Excel flota"}
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              disabled={importando}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              className={`${input} max-w-xs w-full`}
              placeholder="Buscar por placa, marca o modelo…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            {can("flota_lecturas", "crear") ? (
              <button
                type="button"
                className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white"
                onClick={() => setTab("lecturas")}
              >
                + Registrar lectura
              </button>
            ) : null}
          </div>

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

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtradosDash.map((v) => {
              const pendiente = kmPendienteServicio(
                v.km_actual,
                v.km_ultimo_servicio,
                Number(v.km_intervalo_servicio || 10000),
              );
              const alerta = estiloAlertaKm(pendiente);
              const enTaller = Boolean(v.en_taller);
              return (
                <div
                  key={v.id}
                  className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] pb-2">
                    <div>
                      <p className="font-mono text-sm font-bold text-sky-400">
                        {v.placa}
                      </p>
                      <p className="text-sm font-semibold">
                        {v.marca} {v.modelo}
                      </p>
                      {v.descripcion ? (
                        <p className="text-xs text-[var(--muted)]">
                          {v.descripcion}
                        </p>
                      ) : null}
                    </div>
                    {enTaller ? (
                      <span className="rounded border border-amber-700 bg-amber-900/40 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                        En Taller
                      </span>
                    ) : (
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${alerta.badge}`}
                      >
                        {alerta.texto}
                      </span>
                    )}
                  </div>
                  <dl className="grid grid-cols-1 gap-1 text-xs text-[var(--muted)]">
                    <div>
                      Kilometraje actual:{" "}
                      <strong className="text-white">
                        {Number(v.km_actual ?? 0).toLocaleString("es-GT")}
                      </strong>
                    </div>
                    <div>
                      Frecuencia servicio:{" "}
                      <strong className="text-white">
                        {Number(v.km_intervalo_servicio).toLocaleString("es-GT")}{" "}
                        km
                      </strong>
                    </div>
                    <div>
                      Último servicio:{" "}
                      <strong className="text-white">
                        {v.fecha_ultimo_servicio
                          ? String(v.fecha_ultimo_servicio).slice(0, 10)
                          : "—"}{" "}
                        ·{" "}
                        {Number(v.km_ultimo_servicio ?? 0).toLocaleString(
                          "es-GT",
                        )}{" "}
                        km
                      </strong>
                    </div>
                  </dl>
                  <div
                    className={[
                      "rounded px-2 py-1 text-center text-xs font-semibold",
                      enTaller
                        ? "bg-amber-900/40 text-amber-200"
                        : "bg-sky-950 text-sky-200",
                    ].join(" ")}
                  >
                    {enTaller
                      ? `Taller activo · Ingresó ${String(v.fecha_entrada_taller ?? "—").slice(0, 10)}`
                      : alerta.footer}
                  </div>
                </div>
              );
            })}
          </div>
          {!filtradosDash.length ? (
            <p className="text-sm text-[var(--muted)]">
              Sin vehículos. Usa <strong>Importar Excel flota</strong> con el
              archivo de José Gómez / SITSA.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "vehiculos" && can("flota_vehiculos") ? (
        <div className="space-y-4">
          {can("flota_vehiculos", "crear") ? (
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
                placeholder="Modelo / año"
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
              />
              <input
                className={`${input} min-w-[180px]`}
                placeholder="Descripción"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />
              <input
                type="number"
                className={`${input} w-28`}
                placeholder="Km"
                value={kmActual}
                onChange={(e) => setKmActual(Number(e.target.value))}
              />
              <input
                type="number"
                className={`${input} w-32`}
                placeholder="Intervalo svc"
                value={intervalo}
                onChange={(e) => setIntervalo(Number(e.target.value))}
              />
              <button className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
                Registrar vehículo
              </button>
            </form>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <input
              className={`${input} min-w-[220px]`}
              placeholder="Motivo taller (al enviar)"
              value={motivoTaller}
              onChange={(e) => setMotivoTaller(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#0d9488] text-white">
                <tr>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Marca</th>
                  <th className="px-3 py-2">Km</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Taller</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {vehiculos.map((v) => (
                  <tr key={v.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-mono">{v.placa}</td>
                    <td className="px-3 py-2">
                      {v.descripcion ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {v.marca} {v.modelo}
                    </td>
                    <td className="px-3 py-2">
                      {Number(v.km_actual ?? 0).toLocaleString("es-GT")}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {v.empresa_activo ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {v.en_taller ? "Sí" : "No"}
                    </td>
                    <td className="px-3 py-2">
                      {can("flota_vehiculos", "editar") ? (
                        <button
                          type="button"
                          className="text-xs text-[var(--accent-2)] underline"
                          onClick={() => void toggleTaller(v)}
                        >
                          {v.en_taller ? "Salir taller" : "Entrar taller"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "lecturas" && can("flota_lecturas") ? (
        <div className="space-y-4">
          {can("flota_lecturas", "crear") ? (
            <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <select
                className={input}
                value={vehiculoId}
                onChange={(e) => setVehiculoId(Number(e.target.value))}
              >
                {activos.map((v) => (
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
                placeholder="Conductor"
                value={conductor}
                onChange={(e) => setConductor(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void registrarLectura()}
                className="rounded bg-[var(--accent-2)] px-3 py-1.5 text-sm"
              >
                Guardar lectura
              </button>
            </div>
          ) : null}
          <p className="text-xs text-[var(--muted)]">
            Historial completo se carga al registrar; usa Reportes / Dashboard
            para estado.
          </p>
        </div>
      ) : null}

      {tab === "servicios" && can("flota_servicios") ? (
        <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <select
            className={input}
            value={vehiculoId}
            onChange={(e) => setVehiculoId(Number(e.target.value))}
          >
            {activos.map((v) => (
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
          {can("flota_servicios", "crear") ? (
            <button
              type="button"
              onClick={() => void registrarServicio()}
              className="rounded bg-[#1F6AA5] px-3 py-1.5 text-sm text-white"
            >
              Registrar servicio
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === "reportes" && can("flota_reportes") ? (
        <div className="space-y-4">
          {resumen ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
                Vehículos: <strong>{resumen.totalVehiculos}</strong>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
                En taller: <strong>{resumen.enTaller}</strong>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
                Alertas: <strong>{resumen.alertasServicio}</strong>
              </div>
            </div>
          ) : null}
          <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
            <h2 className="font-medium">Costos por mes</h2>
            <ul className="mt-2 space-y-1 text-[var(--muted)]">
              {costos.length ? (
                costos.map((c) => (
                  <li key={String(c.mes)}>
                    {String(c.mes)} · Q{Number(c.total).toFixed(2)} (
                    {String(c.n)} svc)
                  </li>
                ))
              ) : (
                <li>Sin costos.</li>
              )}
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
            <h2 className="mb-2 font-medium">Últimos viajes</h2>
            <ul className="space-y-1 text-[var(--muted)]">
              {viajes.slice(0, 15).map((v) => (
                <li key={v.id}>
                  {v.placa} · {v.piloto_nombre} · {v.estado}
                  {v.destino ? ` · ${v.destino}` : ""} · km {v.km_salida}
                  {v.km_llegada != null ? `→${v.km_llegada}` : ""}
                </li>
              ))}
              {!viajes.length ? <li>Sin viajes.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === "piloto" && can("flota_piloto") ? (
        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex gap-2">
            <button
              type="button"
              className={[
                "rounded px-3 py-1.5 text-sm",
                modoPiloto === "salida"
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[#334155]",
              ].join(" ")}
              onClick={() => setModoPiloto("salida")}
            >
              Registrar salida
            </button>
            <button
              type="button"
              className={[
                "rounded px-3 py-1.5 text-sm",
                modoPiloto === "llegada"
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[#334155]",
              ].join(" ")}
              onClick={() => setModoPiloto("llegada")}
            >
              Registrar llegada
            </button>
          </div>

          {modoPiloto === "salida" ? (
            <div className="flex flex-wrap gap-2">
              <input
                className={input}
                placeholder="Nombre piloto"
                value={pilotoNombre}
                onChange={(e) => setPilotoNombre(e.target.value)}
                required
              />
              <select
                className={input}
                value={vehiculoId}
                onChange={(e) => setVehiculoId(Number(e.target.value))}
              >
                {activos
                  .filter((v) => !v.en_taller)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.placa} · {Number(v.km_actual ?? 0).toLocaleString("es-GT")} km
                    </option>
                  ))}
              </select>
              <input
                type="number"
                className={`${input} w-32`}
                placeholder="Km salida"
                value={kmLectura || ""}
                onChange={(e) => setKmLectura(Number(e.target.value))}
              />
              <input
                className={input}
                placeholder="Destino"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
              />
              <button
                type="button"
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                onClick={() => void salidaViaje()}
              >
                Guardar salida
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select
                className={input}
                value={viajeId}
                onChange={(e) => setViajeId(Number(e.target.value))}
              >
                {abiertos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.placa} · {v.piloto_nombre} · salida {v.km_salida}
                    {v.destino ? ` → ${v.destino}` : ""}
                  </option>
                ))}
              </select>
              <input
                type="number"
                className={`${input} w-32`}
                placeholder="Km llegada"
                value={kmLlegada || ""}
                onChange={(e) => setKmLlegada(Number(e.target.value))}
              />
              <button
                type="button"
                className="rounded bg-[#1F6AA5] px-3 py-1.5 text-sm text-white"
                onClick={() => void llegadaViaje()}
                disabled={!abiertos.length}
              >
                Guardar llegada
              </button>
            </div>
          )}

          <div>
            <h3 className="mb-1 text-sm font-medium">Viajes abiertos</h3>
            <ul className="space-y-1 text-xs text-[var(--muted)]">
              {abiertos.length ? (
                abiertos.map((v) => (
                  <li key={v.id}>
                    {v.placa} · {v.piloto_nombre} · km {v.km_salida}
                    {v.destino ? ` · ${v.destino}` : ""}
                  </li>
                ))
              ) : (
                <li>Ninguno abierto.</li>
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
