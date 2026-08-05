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
  filtro_servicio_mayor?: string | null;
  filtro_servicio_menor?: string | null;
  rin_llanta?: string | null;
  medida_llanta?: string | null;
  tipo_aceite?: string | null;
  tipo_combustible?: string | null;
};

type Lectura = {
  id: number;
  placa: string;
  km: number;
  fecha_lectura: string;
  nota: string | null;
  conductor?: string | null;
};

type Servicio = {
  id: number;
  placa: string;
  tipo: string;
  km_servicio: number | null;
  fecha_servicio: string;
  costo: number;
  descripcion?: string | null;
  adjuntos?: number;
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
  observaciones?: string | null;
  es_externo?: number;
};

type PermisoExterno = {
  id: number;
  piloto_nombre: string;
  motivo: string;
  estado: string;
  solicitado_por: string;
  aprobado_por?: string | null;
  creado_at: string;
};

type VerifPiloto = {
  encontrado: boolean;
  mensaje: string;
  empleado?: { id: number; codigo: string; nombre: string };
};

type Tab =
  | "dashboard"
  | "vehiculos"
  | "servicios"
  | "lecturas"
  | "reportes"
  | "piloto";

const emptyForm = {
  placa: "",
  marca: "",
  modelo: "",
  descripcion: "",
  kmActual: 0,
  intervalo: 10000,
  filtroMayor: "",
  filtroMenor: "",
  rin: "",
  medidaLlanta: "",
  tipoAceite: "",
  color: "",
  notas: "",
};

export default function FlotaPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-[var(--muted)]">Cargando flota…</p>}
    >
      <FlotaInner />
    </Suspense>
  );
}

function FlotaInner() {
  const slug = String(useParams().slug);
  const router = useRouter();
  const search = useSearchParams();
  const tabParam = (search.get("tab") as Tab | null) ?? "dashboard";

  const [permisos, setPermisos] = useState<PermisoModulo[]>([]);
  const [rol, setRol] = useState("");
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [viajes, setViajes] = useState<Viaje[]>([]);
  const [abiertos, setAbiertos] = useState<Viaje[]>([]);
  const [q, setQ] = useState("");
  const [filtroTaller, setFiltroTaller] = useState<"todos" | "taller" | "ruta">(
    "todos",
  );
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [importando, setImportando] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [tallerId, setTallerId] = useState<number | null>(null);
  const [motivoTaller, setMotivoTaller] = useState("");

  const [vehiculoId, setVehiculoId] = useState(0);
  const [kmLectura, setKmLectura] = useState(0);
  const [conductor, setConductor] = useState("");
  const [tipoServicio, setTipoServicio] = useState("mantenimiento");
  const [costo, setCosto] = useState(0);
  const [descServicio, setDescServicio] = useState("");
  const [pilotoNombre, setPilotoNombre] = useState("");
  const [placaSalida, setPlacaSalida] = useState("");
  const [destino, setDestino] = useState("");
  const [obsViaje, setObsViaje] = useState("");
  const [viajeId, setViajeId] = useState(0);
  const [kmLlegada, setKmLlegada] = useState(0);
  const [modoPiloto, setModoPiloto] = useState<"salida" | "llegada">("salida");
  const [esExterno, setEsExterno] = useState(false);
  const [motivoExterno, setMotivoExterno] = useState("");
  const [verifPiloto, setVerifPiloto] = useState<VerifPiloto | null>(null);
  const [permisosExt, setPermisosExt] = useState<PermisoExterno[]>([]);
  const [archivosServicio, setArchivosServicio] = useState<FileList | null>(
    null,
  );
  const [sacarDeServicio, setSacarDeServicio] = useState(true);
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
    setMsg("");
    setErr("");
    router.replace(`/e/${slug}/flota${t === "dashboard" ? "" : `?tab=${t}`}`);
  };

  const matchQ = useCallback(
    (placa: string, extra = "") => {
      const s = q.trim().toLowerCase();
      if (!s) return true;
      return (
        placa.toLowerCase().includes(s) ||
        extra.toLowerCase().includes(s)
      );
    },
    [q],
  );

  const vehiculosFiltrados = useMemo(() => {
    return vehiculos.filter((v) => {
      if (v.activo === 0 && filtroTaller !== "todos") return false;
      if (filtroTaller === "taller" && !v.en_taller) return false;
      if (filtroTaller === "ruta" && v.en_taller) return false;
      return matchQ(
        v.placa,
        `${v.marca ?? ""} ${v.modelo ?? ""} ${v.descripcion ?? ""} ${v.empresa_activo ?? ""}`,
      );
    });
  }, [vehiculos, filtroTaller, matchQ]);

  const activos = useMemo(
    () =>
      vehiculos.filter(
        (v) => v.activo !== 0 && matchQ(v.placa, `${v.marca} ${v.modelo}`),
      ),
    [vehiculos, matchQ],
  );

  const lecturasFiltradas = useMemo(
    () => lecturas.filter((l) => matchQ(l.placa, l.nota ?? "")),
    [lecturas, matchQ],
  );
  const serviciosFiltrados = useMemo(
    () => servicios.filter((s) => matchQ(s.placa, s.tipo)),
    [servicios, matchQ],
  );
  const viajesFiltrados = useMemo(
    () =>
      viajes.filter((v) =>
        matchQ(v.placa, `${v.piloto_nombre} ${v.destino ?? ""}`),
      ),
    [viajes, matchQ],
  );

  const cargar = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    const rolMe = String(me.user?.rol ?? "");
    setRol(rolMe);
    setPermisos(me.permisos ?? []);
    // Cuenta kiosko "piloto": no precargar el nombre genérico
    if (
      me.user?.nombre &&
      rolMe !== "Piloto" &&
      String(me.user.username ?? "").toLowerCase() !== "piloto"
    ) {
      setPilotoNombre(String(me.user.nombre));
    }

    const [res, rep, lec, svc, via, perm] = await Promise.all([
      fetch(`/api/empresas/${slug}/flota/vehiculos`),
      fetch(`/api/empresas/${slug}/flota/reportes`),
      fetch(`/api/empresas/${slug}/flota/lecturas`),
      fetch(`/api/empresas/${slug}/flota/servicios`),
      fetch(`/api/empresas/${slug}/flota/viajes`),
      fetch(`/api/empresas/${slug}/flota/permisos-externos`),
    ]);
    if (res.ok) {
      const data = await res.json();
      const list = (data.vehiculos ?? []) as Vehiculo[];
      setVehiculos(list);
      if (list[0] && !vehiculoId) setVehiculoId(Number(list[0].id));
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
    if (via.ok) {
      const data = await via.json();
      setViajes(data.viajes ?? []);
      setAbiertos(data.abiertos ?? []);
      if (data.abiertos?.[0]) setViajeId(Number(data.abiertos[0].id));
    }
    if (perm.ok) {
      const data = await perm.json();
      setPermisosExt(data.permisos ?? []);
    }
  }, [slug, vehiculoId]);

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  function exportar(tipo: "flota" | "servicios" | "viajes", formato: "xlsx" | "pdf") {
    const params = new URLSearchParams({ tipo, formato });
    if (q.trim()) params.set("q", q.trim());
    window.open(
      `/api/empresas/${slug}/flota/export?${params.toString()}`,
      "_blank",
    );
  }

  async function onImport(file: File) {
    setImportando(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/empresas/${slug}/flota/import`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "Error al importar");
    else setMsg(data.mensaje);
    setImportando(false);
    if (res.ok) await cargar();
  }

  function empezarEdicion(v: Vehiculo) {
    setEditId(v.id);
    setForm({
      placa: v.placa,
      marca: v.marca ?? "",
      modelo: v.modelo ?? "",
      descripcion: v.descripcion ?? "",
      kmActual: Number(v.km_actual ?? 0),
      intervalo: Number(v.km_intervalo_servicio ?? 10000),
      filtroMayor: v.filtro_servicio_mayor ?? "",
      filtroMenor: v.filtro_servicio_menor ?? "",
      rin: v.rin_llanta ?? "",
      medidaLlanta: v.medida_llanta ?? "",
      tipoAceite: v.tipo_aceite ?? "",
      color: v.color ?? "",
      notas: v.notas ?? "",
    });
    setTab("vehiculos");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onSubmitVehiculo(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    const payload = {
      placa: form.placa,
      marca: form.marca,
      modelo: form.modelo,
      descripcion: form.descripcion,
      color: form.color,
      kmActual: form.kmActual,
      kmIntervaloServicio: form.intervalo,
      filtroServicioMayor: form.filtroMayor,
      filtroServicioMenor: form.filtroMenor,
      rinLlanta: form.rin,
      medidaLlanta: form.medidaLlanta,
      tipoAceite: form.tipoAceite,
      notas: form.notas,
    };
    const res = await fetch(`/api/empresas/${slug}/flota/vehiculos`, {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editId ? { id: editId, ...payload } : payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "Error");
      return;
    }
    setMsg(data.mensaje);
    setForm(emptyForm);
    setEditId(null);
    await cargar();
  }

  async function confirmarTaller() {
    if (tallerId == null) return;
    setErr("");
    const res = await fetch(`/api/empresas/${slug}/flota/vehiculos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: tallerId,
        enTaller: true,
        motivoTaller,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "No se pudo enviar a taller");
      return;
    }
    setMsg(data.mensaje);
    setTallerId(null);
    setMotivoTaller("");
    await cargar();
  }

  async function salirTaller(id: number) {
    setErr("");
    const res = await fetch(`/api/empresas/${slug}/flota/vehiculos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enTaller: false }),
    });
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "Error");
    else setMsg(data.mensaje);
    await cargar();
  }

  async function registrarLectura() {
    setErr("");
    const res = await fetch(`/api/empresas/${slug}/flota/lecturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehiculoId,
        km: kmLectura,
        fechaLectura: new Date().toISOString().slice(0, 10),
        nota: conductor || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "Error");
    else {
      setMsg(data.mensaje);
      setKmLectura(0);
      await cargar();
    }
  }

  async function registrarServicio() {
    setErr("");
    const fd = new FormData();
    fd.append("vehiculoId", String(vehiculoId));
    fd.append("tipo", tipoServicio);
    if (kmLectura) fd.append("kmServicio", String(kmLectura));
    fd.append("fechaServicio", new Date().toISOString().slice(0, 10));
    fd.append("costo", String(costo || 0));
    if (descServicio) fd.append("descripcion", descServicio);
    if (sacarDeServicio) fd.append("sacarDeServicio", "1");
    if (archivosServicio) {
      Array.from(archivosServicio).forEach((f, i) =>
        fd.append(`file${i}`, f),
      );
    }
    const res = await fetch(`/api/empresas/${slug}/flota/servicios`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "Error");
    else {
      setMsg(data.mensaje);
      setDescServicio("");
      setCosto(0);
      setArchivosServicio(null);
      await cargar();
    }
  }

  async function verificarPiloto() {
    setErr("");
    setVerifPiloto(null);
    if (pilotoNombre.trim().length < 2) {
      setErr("Escribe el nombre del piloto.");
      return;
    }
    const res = await fetch(
      `/api/empresas/${slug}/flota/verificar-piloto?nombre=${encodeURIComponent(pilotoNombre.trim())}`,
    );
    const data = await res.json();
    setVerifPiloto(data);
    if (data.encontrado) {
      setEsExterno(false);
      setPilotoNombre(data.empleado?.nombre ?? pilotoNombre);
    } else {
      setEsExterno(true);
    }
  }

  async function salidaViaje() {
    setErr("");
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/flota/viajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "salida",
        placa: placaSalida.trim() || undefined,
        vehiculoId: placaSalida.trim() ? undefined : vehiculoId || undefined,
        pilotoNombre,
        kmSalida: kmLectura,
        destino: destino || undefined,
        esExterno: esExterno || undefined,
        motivoExterno: esExterno ? motivoExterno || undefined : undefined,
      }),
    });
    const data = await res.json();
    if (data.code === "NO_EN_RRHH") {
      setEsExterno(true);
      setErr(data.mensaje ?? data.error);
      return;
    }
    if (
      data.code === "SOLICITUD_ENVIADA" ||
      data.code === "PERMISO_PENDIENTE"
    ) {
      setMsg(data.mensaje ?? data.error);
      setEsExterno(true);
      await cargar();
      return;
    }
    if (!res.ok) setErr(data.mensaje ?? data.error ?? "Error");
    else {
      setMsg(data.mensaje);
      setKmLectura(0);
      setDestino("");
      setMotivoExterno("");
      setEsExterno(false);
      setVerifPiloto(null);
      setModoPiloto("llegada");
      await cargar();
    }
  }

  async function resolverPermiso(
    id: number,
    estado: "aprobado" | "rechazado",
  ) {
    setErr("");
    const res = await fetch(`/api/empresas/${slug}/flota/permisos-externos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, estado }),
    });
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "Error");
    else {
      setMsg(data.mensaje);
      await cargar();
    }
  }

  async function verAdjuntos(servicioId: number) {
    const res = await fetch(
      `/api/empresas/${slug}/flota/servicios/${servicioId}/adjuntos`,
    );
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "No se pudieron cargar adjuntos");
      return;
    }
    const list = (data.adjuntos ?? []) as {
      id: number;
      nombre: string;
    }[];
    if (!list.length) {
      setMsg("Sin facturas / archivos en este servicio.");
      return;
    }
    for (const a of list) {
      const dl = await fetch(
        `/api/empresas/${slug}/flota/servicios/${servicioId}/adjuntos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adjuntoId: a.id }),
        },
      );
      if (!dl.ok) continue;
      const blob = await dl.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    }
  }

  async function llegadaViaje() {
    setErr("");
    const res = await fetch(`/api/empresas/${slug}/flota/viajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "llegada",
        viajeId,
        kmLlegada,
        pilotoNombre: pilotoNombre || undefined,
        observaciones: obsViaje || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "Error");
    else {
      setMsg(data.mensaje);
      setKmLlegada(0);
      setObsViaje("");
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

  const SearchBar = (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-[var(--muted)]">
        Buscar por placa / marca
        <input
          className={`${input} mt-1 block min-w-[220px]`}
          placeholder="Ej. C-034BXR"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {tab === "vehiculos" || tab === "dashboard" ? (
        <label className="text-xs text-[var(--muted)]">
          Filtrar
          <select
            className={`${input} mt-1 block`}
            value={filtroTaller}
            onChange={(e) =>
              setFiltroTaller(e.target.value as typeof filtroTaller)
            }
          >
            <option value="todos">Todos</option>
            <option value="ruta">En ruta</option>
            <option value="taller">En taller</option>
          </select>
        </label>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Control de Flota / Predios</h1>
          <p className="text-sm text-[var(--muted)]">
            Búsqueda por placa, taller, edición, filtros/rin y exportación.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("flota_vehiculos", "crear") && rol !== "Piloto" ? (
            <label className="cursor-pointer rounded bg-[#0d9488] px-3 py-2 text-sm text-white">
              {importando ? "Importando…" : "Importar Excel"}
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
          {can("flota_reportes") || can("flota_vehiculos") ? (
            <>
              <button
                type="button"
                className="rounded bg-[#1B5E20] px-3 py-2 text-sm text-white"
                onClick={() => exportar("flota", "xlsx")}
              >
                Excel flota
              </button>
              <button
                type="button"
                className="rounded bg-[#37474F] px-3 py-2 text-sm text-white"
                onClick={() => exportar("flota", "pdf")}
              >
                PDF flota
              </button>
            </>
          ) : null}
        </div>
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

      {err ? <p className="text-sm text-red-300">{err}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {/* Modal taller */}
      {tallerId != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="font-medium">Enviar a taller</h3>
            <p className="text-xs text-[var(--muted)]">
              Placa:{" "}
              {vehiculos.find((v) => v.id === tallerId)?.placa ?? tallerId}
            </p>
            <textarea
              className={`${input} w-full`}
              rows={3}
              placeholder="Motivo (obligatorio)"
              value={motivoTaller}
              onChange={(e) => setMotivoTaller(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded bg-[#334155] px-3 py-1.5 text-sm"
                onClick={() => {
                  setTallerId(null);
                  setMotivoTaller("");
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white"
                onClick={() => void confirmarTaller()}
              >
                Confirmar envío
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "dashboard" ? (
        <div className="space-y-4">
          {SearchBar}
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {vehiculosFiltrados.map((v) => {
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
                  <div className="flex justify-between gap-2 border-b border-[var(--border)] pb-2">
                    <div>
                      <p className="font-mono text-sm font-bold text-sky-400">
                        {v.placa}
                      </p>
                      <p className="text-sm font-semibold">
                        {v.marca} {v.modelo}
                      </p>
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                        enTaller
                          ? "border border-amber-700 bg-amber-900/40 text-amber-200"
                          : alerta.badge
                      }`}
                    >
                      {enTaller ? "En Taller" : alerta.texto}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    Km {Number(v.km_actual ?? 0).toLocaleString("es-GT")} · Rin{" "}
                    {v.rin_llanta || "—"} · Filtro may.{" "}
                    {v.filtro_servicio_mayor || "—"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "vehiculos" && can("flota_vehiculos") ? (
        <div className="space-y-4">
          {SearchBar}
          {(can("flota_vehiculos", "crear") || editId) &&
          (can("flota_vehiculos", "editar") || !editId) ? (
            <form
              onSubmit={onSubmitVehiculo}
              className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium">
                  {editId ? `Editar vehículo` : "Registrar vehículo"}
                </h2>
                {editId ? (
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => {
                      setEditId(null);
                      setForm(emptyForm);
                    }}
                  >
                    Cancelar edición
                  </button>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["placa", "Placa"],
                    ["marca", "Marca"],
                    ["modelo", "Modelo / año"],
                    ["descripcion", "Descripción"],
                    ["color", "Color"],
                    ["filtroMayor", "Filtro servicio mayor"],
                    ["filtroMenor", "Filtro servicio menor"],
                    ["rin", "Rin de llanta"],
                    ["medidaLlanta", "Medida de llanta"],
                    ["tipoAceite", "Tipo de aceite"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="text-xs text-[var(--muted)]">
                    {label}
                    <input
                      className={`${input} mt-1 w-full`}
                      value={form[key]}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [key]: e.target.value }))
                      }
                      required={key === "placa"}
                    />
                  </label>
                ))}
                <label className="text-xs text-[var(--muted)]">
                  Km actual
                  <input
                    type="number"
                    className={`${input} mt-1 w-full`}
                    value={form.kmActual}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        kmActual: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label className="text-xs text-[var(--muted)]">
                  Intervalo servicio (km)
                  <input
                    type="number"
                    className={`${input} mt-1 w-full`}
                    value={form.intervalo}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        intervalo: Number(e.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <label className="block text-xs text-[var(--muted)]">
                Notas
                <textarea
                  className={`${input} mt-1 w-full`}
                  rows={2}
                  value={form.notas}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notas: e.target.value }))
                  }
                />
              </label>
              <button className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white">
                {editId ? "Guardar cambios" : "Registrar vehículo"}
              </button>
            </form>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#0d9488] text-white">
                <tr>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Marca</th>
                  <th className="px-3 py-2">Km</th>
                  <th className="px-3 py-2">Filtros</th>
                  <th className="px-3 py-2">Rin</th>
                  <th className="px-3 py-2">Taller</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {vehiculosFiltrados.map((v) => (
                  <tr key={v.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-mono">{v.placa}</td>
                    <td className="px-3 py-2">{v.descripcion ?? "—"}</td>
                    <td className="px-3 py-2">
                      {v.marca} {v.modelo}
                    </td>
                    <td className="px-3 py-2">
                      {Number(v.km_actual ?? 0).toLocaleString("es-GT")}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      May: {v.filtro_servicio_mayor || "—"}
                      <br />
                      Men: {v.filtro_servicio_menor || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {v.rin_llanta || "—"}
                      {v.medida_llanta ? ` · ${v.medida_llanta}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      {v.en_taller ? (
                        <span className="text-amber-300">
                          Sí
                          {v.motivo_taller ? (
                            <span className="block text-[10px] text-[var(--muted)]">
                              {v.motivo_taller}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        "No"
                      )}
                    </td>
                    <td className="space-x-2 px-3 py-2 text-xs">
                      {can("flota_vehiculos", "editar") ? (
                        <>
                          <button
                            type="button"
                            className="text-sky-300 underline"
                            onClick={() => empezarEdicion(v)}
                          >
                            Editar
                          </button>
                          {v.en_taller ? (
                            <button
                              type="button"
                              className="text-emerald-300 underline"
                              onClick={() => void salirTaller(v.id)}
                            >
                              Salir taller
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-amber-300 underline"
                              onClick={() => {
                                setTallerId(v.id);
                                setMotivoTaller("");
                                setErr("");
                              }}
                            >
                              Enviar taller
                            </button>
                          )}
                        </>
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
          {SearchBar}
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
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#334155] text-white">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Km</th>
                  <th className="px-3 py-2">Nota / conductor</th>
                </tr>
              </thead>
              <tbody>
                {lecturasFiltradas.map((l) => (
                  <tr key={l.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">
                      {String(l.fecha_lectura).slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 font-mono">{l.placa}</td>
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

      {tab === "servicios" && can("flota_servicios") ? (
        <div className="space-y-4">
          {SearchBar}
          {can("flota_servicios", "crear") ? (
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted)]">
                Al sacar la unidad del servicio / taller puedes adjuntar facturas
                (PDF o imagen).
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  className={input}
                  value={vehiculoId}
                  onChange={(e) => setVehiculoId(Number(e.target.value))}
                >
                  {activos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.placa}
                      {v.en_taller ? " · EN TALLER" : ""}
                      {v.filtro_servicio_mayor
                        ? ` · may:${v.filtro_servicio_mayor}`
                        : ""}
                    </option>
                  ))}
                </select>
                <select
                  className={input}
                  value={tipoServicio}
                  onChange={(e) => setTipoServicio(e.target.value)}
                >
                  <option value="mantenimiento">Mantenimiento (mayor)</option>
                  <option value="servicio_menor">Servicio menor</option>
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
                <input
                  className={`${input} min-w-[160px]`}
                  placeholder="Detalle / filtros usados"
                  value={descServicio}
                  onChange={(e) => setDescServicio(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={sacarDeServicio}
                    onChange={(e) => setSacarDeServicio(e.target.checked)}
                  />
                  Sacar de taller / volver a servicio
                </label>
                <label className="text-xs text-[var(--muted)]">
                  Facturas PDF / imágenes
                  <input
                    type="file"
                    accept="image/*,.pdf,application/pdf"
                    multiple
                    className="mt-1 block text-xs"
                    onChange={(e) => setArchivosServicio(e.target.files)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void registrarServicio()}
                  className="rounded bg-[#1F6AA5] px-3 py-1.5 text-sm text-white"
                >
                  Registrar servicio
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-[#1B5E20] px-3 py-1.5 text-xs text-white"
              onClick={() => exportar("servicios", "xlsx")}
            >
              Excel servicios
            </button>
            <button
              type="button"
              className="rounded bg-[#37474F] px-3 py-1.5 text-xs text-white"
              onClick={() => exportar("servicios", "pdf")}
            >
              PDF servicios
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#334155] text-white">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Km</th>
                  <th className="px-3 py-2">Costo</th>
                  <th className="px-3 py-2">Facturas</th>
                </tr>
              </thead>
              <tbody>
                {serviciosFiltrados.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">
                      {String(s.fecha_servicio).slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 font-mono">{s.placa}</td>
                    <td className="px-3 py-2">{s.tipo}</td>
                    <td className="px-3 py-2">
                      {s.km_servicio?.toLocaleString("es-GT") ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      Q{Number(s.costo).toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      {(s.adjuntos ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="text-sky-300 underline"
                          onClick={() => void verAdjuntos(s.id)}
                        >
                          Ver ({s.adjuntos})
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "reportes" && can("flota_reportes") ? (
        <div className="space-y-4">
          {SearchBar}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-[#1B5E20] px-3 py-2 text-sm text-white"
              onClick={() => exportar("flota", "xlsx")}
            >
              Excel inventario
            </button>
            <button
              type="button"
              className="rounded bg-[#37474F] px-3 py-2 text-sm text-white"
              onClick={() => exportar("flota", "pdf")}
            >
              PDF inventario
            </button>
            <button
              type="button"
              className="rounded bg-[#1B5E20] px-3 py-2 text-sm text-white"
              onClick={() => exportar("servicios", "xlsx")}
            >
              Excel servicios
            </button>
            <button
              type="button"
              className="rounded bg-[#37474F] px-3 py-2 text-sm text-white"
              onClick={() => exportar("servicios", "pdf")}
            >
              PDF servicios
            </button>
            <button
              type="button"
              className="rounded bg-[#1B5E20] px-3 py-2 text-sm text-white"
              onClick={() => exportar("viajes", "xlsx")}
            >
              Excel viajes
            </button>
            <button
              type="button"
              className="rounded bg-[#37474F] px-3 py-2 text-sm text-white"
              onClick={() => exportar("viajes", "pdf")}
            >
              PDF viajes
            </button>
          </div>
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
            <h2 className="mb-2 font-medium">Viajes (filtro placa)</h2>
            <ul className="space-y-1 text-[var(--muted)]">
              {viajesFiltrados.slice(0, 20).map((v) => (
                <li key={v.id}>
                  {v.placa} · {v.piloto_nombre} · {v.estado}
                  {v.destino ? ` · ${v.destino}` : ""}
                </li>
              ))}
              {!viajesFiltrados.length ? <li>Sin viajes.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === "piloto" && can("flota_piloto") ? (
        <div className="space-y-4">
          {SearchBar}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-4">
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
              <div className="space-y-3">
                <p className="text-xs text-[var(--muted)]">
                  Cuenta compartida de pilotos: escribe tu nombre completo y la
                  placa. No se permite otro viaje abierto con el mismo nombre ni
                  la misma unidad.
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs text-[var(--muted)] sm:col-span-2">
                    Nombre piloto (como en RRHH)
                    <div className="mt-1 flex gap-2">
                      <input
                        className={`${input} w-full`}
                        value={pilotoNombre}
                        onChange={(e) => {
                          setPilotoNombre(e.target.value);
                          setVerifPiloto(null);
                        }}
                        placeholder="Ej. Walter López"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
                        onClick={() => void verificarPiloto()}
                      >
                        Verificar RRHH
                      </button>
                    </div>
                  </label>
                  <label className="text-xs text-[var(--muted)]">
                    Placa de la unidad
                    <input
                      className={`${input} mt-1 w-full font-mono uppercase`}
                      value={placaSalida}
                      onChange={(e) => setPlacaSalida(e.target.value)}
                      placeholder="Ej. C-015BNG"
                      list="placas-flota"
                    />
                    <datalist id="placas-flota">
                      {activos
                        .filter((v) => !v.en_taller)
                        .map((v) => (
                          <option key={v.id} value={v.placa} />
                        ))}
                    </datalist>
                  </label>
                  <label className="text-xs text-[var(--muted)]">
                    Km salida
                    <input
                      type="number"
                      className={`${input} mt-1 w-full`}
                      value={kmLectura || ""}
                      onChange={(e) => setKmLectura(Number(e.target.value))}
                    />
                  </label>
                  <label className="text-xs text-[var(--muted)] sm:col-span-2">
                    Destino
                    <input
                      className={`${input} mt-1 w-full`}
                      value={destino}
                      onChange={(e) => setDestino(e.target.value)}
                      placeholder="Ej. Predio norte / Cliente X"
                    />
                  </label>
                </div>

                {verifPiloto ? (
                  <p
                    className={`text-xs ${
                      verifPiloto.encontrado
                        ? "text-emerald-400"
                        : "text-amber-300"
                    }`}
                  >
                    {verifPiloto.mensaje}
                  </p>
                ) : null}

                {esExterno || (verifPiloto && !verifPiloto.encontrado) ? (
                  <div className="space-y-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={esExterno}
                        onChange={(e) => setEsExterno(e.target.checked)}
                      />
                      Conductor externo / en prueba (no está en RRHH)
                    </label>
                    {esExterno ? (
                      <>
                        <textarea
                          className={`${input} w-full`}
                          rows={2}
                          placeholder="Motivo para Operaciones: por qué manejará alguien externo…"
                          value={motivoExterno}
                          onChange={(e) => setMotivoExterno(e.target.value)}
                        />
                        <p className="text-[11px] text-[var(--muted)]">
                          Al guardar se envía la solicitud a Operaciones. Solo
                          podrás registrar la salida cuando aprueben.
                        </p>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex items-end">
                  <button
                    type="button"
                    className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white"
                    onClick={() => void salidaViaje()}
                  >
                    Guardar salida
                  </button>
                </div>

                <div>
                  <h3 className="mb-1 text-sm font-medium">Viajes abiertos</h3>
                  <ul className="space-y-1 text-xs text-[var(--muted)]">
                    {abiertos.map((v) => (
                      <li key={v.id}>
                        <span className="font-mono text-sky-300">{v.placa}</span>{" "}
                        · {v.piloto_nombre} · km {v.km_salida}
                        {v.destino ? ` · ${v.destino}` : ""}
                        {v.es_externo ? " · externo" : ""}
                      </li>
                    ))}
                    {!abiertos.length ? <li>Ningún viaje abierto.</li> : null}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs text-[var(--muted)] sm:col-span-2">
                  Viaje abierto
                  <select
                    className={`${input} mt-1 w-full`}
                    value={viajeId}
                    onChange={(e) => setViajeId(Number(e.target.value))}
                  >
                    {abiertos
                      .filter((v) => matchQ(v.placa, v.piloto_nombre))
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.placa} · {v.piloto_nombre} · km {v.km_salida}
                          {v.destino ? ` → ${v.destino}` : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-xs text-[var(--muted)]">
                  Km llegada
                  <input
                    type="number"
                    className={`${input} mt-1 w-full`}
                    value={kmLlegada || ""}
                    onChange={(e) => setKmLlegada(Number(e.target.value))}
                  />
                </label>
                <label className="text-xs text-[var(--muted)] sm:col-span-2">
                  Observaciones
                  <input
                    className={`${input} mt-1 w-full`}
                    value={obsViaje}
                    onChange={(e) => setObsViaje(e.target.value)}
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    className="rounded bg-[#1F6AA5] px-4 py-2 text-sm text-white disabled:opacity-40"
                    disabled={!abiertos.length}
                    onClick={() => void llegadaViaje()}
                  >
                    Guardar llegada
                  </button>
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Viajes recientes</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded bg-[#1B5E20] px-2 py-1 text-xs text-white"
                    onClick={() => exportar("viajes", "xlsx")}
                  >
                    Excel
                  </button>
                  <button
                    type="button"
                    className="rounded bg-[#37474F] px-2 py-1 text-xs text-white"
                    onClick={() => exportar("viajes", "pdf")}
                  >
                    PDF
                  </button>
                </div>
              </div>
              <ul className="space-y-1 text-xs text-[var(--muted)]">
                {viajesFiltrados.slice(0, 12).map((v) => (
                  <li key={v.id}>
                    <span className="font-mono text-sky-300">{v.placa}</span> ·{" "}
                    {v.piloto_nombre} · {v.estado}
                    {v.destino ? ` · ${v.destino}` : ""} · {v.km_salida}
                    {v.km_llegada != null ? `→${v.km_llegada}` : ""}
                  </li>
                ))}
                {!viajesFiltrados.length ? <li>Sin viajes.</li> : null}
              </ul>
            </div>

            {permisosExt.length ? (
              <div className="rounded-lg border border-[var(--border)] p-3">
                <h3 className="mb-2 text-sm font-medium">
                  Permisos conductores externos
                </h3>
                <ul className="space-y-2 text-xs">
                  {permisosExt.slice(0, 15).map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-start justify-between gap-2 border-t border-[var(--border)] pt-2 first:border-0 first:pt-0"
                    >
                      <div>
                        <span className="font-medium">{p.piloto_nombre}</span>{" "}
                        <span
                          className={
                            p.estado === "aprobado"
                              ? "text-emerald-400"
                              : p.estado === "rechazado"
                                ? "text-red-400"
                                : "text-amber-300"
                          }
                        >
                          ({p.estado})
                        </span>
                        <p className="text-[var(--muted)]">{p.motivo}</p>
                        <p className="text-[10px] text-[var(--muted)]">
                          Solicitó: {p.solicitado_por}
                          {p.aprobado_por ? ` · Resolvió: ${p.aprobado_por}` : ""}
                        </p>
                      </div>
                      {p.estado === "pendiente" &&
                      (rol === "Admin" ||
                        rol === "Operaciones" ||
                        rol === "CoordinadorPredios") ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="rounded bg-[#1B5E20] px-2 py-1 text-white"
                            onClick={() => void resolverPermiso(p.id, "aprobado")}
                          >
                            Aprobar
                          </button>
                          <button
                            type="button"
                            className="rounded bg-[#B71C1C] px-2 py-1 text-white"
                            onClick={() =>
                              void resolverPermiso(p.id, "rechazado")
                            }
                          >
                            Rechazar
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
