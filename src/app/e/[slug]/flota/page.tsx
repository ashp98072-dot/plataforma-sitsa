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
import {
  marcarVarias,
  obtenerGps,
  type GeoCoords,
} from "@/lib/flota/photo-meta";

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
  compartido?: boolean;
  esDueno?: boolean;
  accesoEmpresaIds?: number[];
  empresa_duena_codigo?: string | null;
};

type EmpresaOpt = { id: number; codigo: string; nombre: string; slug: string };

type PlanSalida = {
  id: number;
  codigo: string;
  fecha_plan?: string;
  hora_carga?: string | null;
  tipo_traslado?: string | null;
  notas?: string | null;
  placa: string | null;
  piloto: string | null;
  cliente: string | null;
  lugar_carga?: string | null;
  lugar_descarga?: string | null;
  estado?: string;
  auxiliares: string[];
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
  vehiculo_id?: number;
  placa: string;
  tipo: string;
  km_servicio: number | null;
  fecha_servicio: string;
  costo: number;
  descripcion?: string | null;
  observaciones?: string | null;
  fecha_entrada_taller?: string | null;
  fecha_salida_taller?: string | null;
  dias_en_taller?: number | null;
  repuestos?: string[];
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
  plan_id?: number | null;
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
  const [tipoServicio, setTipoServicio] = useState("servicio_mayor");
  const [costo, setCosto] = useState(0);
  const [repuestos, setRepuestos] = useState<string[]>([]);
  const [repuestoInput, setRepuestoInput] = useState("");
  const [obsServicio, setObsServicio] = useState("");
  const [fechaEntradaTaller, setFechaEntradaTaller] = useState("");
  const [fechaSalidaTaller, setFechaSalidaTaller] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [editServicioId, setEditServicioId] = useState<number | null>(null);
  const [accesoEmpresaIds, setAccesoEmpresaIds] = useState<number[]>([]);
  const [empresasFlota, setEmpresasFlota] = useState<EmpresaOpt[]>([]);
  const [empresaActualId, setEmpresaActualId] = useState(0);
  const [planesSalida, setPlanesSalida] = useState<PlanSalida[]>([]);
  const [planIdSalida, setPlanIdSalida] = useState(0);
  const [pilotoNombre, setPilotoNombre] = useState("");
  const [placaSalida, setPlacaSalida] = useState("");
  const [destino, setDestino] = useState("");
  const [obsViaje, setObsViaje] = useState("");
  const [viajeId, setViajeId] = useState(0);
  const [kmLlegada, setKmLlegada] = useState(0);
  const [modoPiloto, setModoPiloto] = useState<"salida" | "llegada">("salida");
  const [qLlegada, setQLlegada] = useState("");
  const [esExterno, setEsExterno] = useState(false);
  const [motivoExterno, setMotivoExterno] = useState("");
  const [verifPiloto, setVerifPiloto] = useState<VerifPiloto | null>(null);
  const [fotoTableroSalida, setFotoTableroSalida] = useState<File | null>(null);
  const [fotosEvidenciaSalida, setFotosEvidenciaSalida] = useState<File[]>([]);
  const [fotoTableroLlegada, setFotoTableroLlegada] = useState<File | null>(
    null,
  );
  const [fotosLlegada, setFotosLlegada] = useState<File[]>([]);
  const [subiendoFotos, setSubiendoFotos] = useState(false);
  const [permisosExt, setPermisosExt] = useState<PermisoExterno[]>([]);
  const [archivosServicio, setArchivosServicio] = useState<FileList | null>(
    null,
  );
  const [sacarDeServicio, setSacarDeServicio] = useState(true);
  const [panelAdjuntos, setPanelAdjuntos] = useState<{
    servicioId: number;
    placa?: string;
    items: { id: number; nombre: string; url: string; tamano: number }[];
  } | null>(null);
  const [resumen, setResumen] = useState<{
    totalVehiculos: number;
    enTaller: number;
    alertasServicio: number;
  } | null>(null);
  const [costos, setCostos] = useState<
    { mes: string; total: number; n: number }[]
  >([]);
  const [costosUnidad, setCostosUnidad] = useState<
    { placa: string; total: number; n: number }[]
  >([]);
  const [totalPeriodo, setTotalPeriodo] = useState({ total: 0, n: 0 });
  const [repDesde, setRepDesde] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [repHasta, setRepHasta] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

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

  const abiertosFiltrados = useMemo(() => {
    const s = qLlegada.trim().toLowerCase();
    if (!s) return abiertos;
    return abiertos.filter((v) => {
      const placa = v.placa.toLowerCase().replace(/[\s-]/g, "");
      const qPlaca = s.replace(/[\s-]/g, "");
      return (
        v.placa.toLowerCase().includes(s) ||
        placa.includes(qPlaca) ||
        v.piloto_nombre.toLowerCase().includes(s) ||
        (v.destino ?? "").toLowerCase().includes(s)
      );
    });
  }, [abiertos, qLlegada]);

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

    const paramsRep = new URLSearchParams({
      desde: repDesde,
      hasta: repHasta,
    });
    const [res, rep, lec, svc, via, perm] = await Promise.all([
      fetch(`/api/empresas/${slug}/flota/vehiculos`),
      fetch(`/api/empresas/${slug}/flota/reportes?${paramsRep}`),
      fetch(`/api/empresas/${slug}/flota/lecturas`),
      fetch(`/api/empresas/${slug}/flota/servicios`),
      fetch(`/api/empresas/${slug}/flota/viajes`),
      fetch(`/api/empresas/${slug}/flota/permisos-externos`),
    ]);
    if (res.ok) {
      const data = await res.json();
      const list = (data.vehiculos ?? []) as Vehiculo[];
      setVehiculos(list);
      setEmpresasFlota(data.empresas ?? []);
      setEmpresaActualId(Number(data.empresaActualId ?? 0));
      if (list[0] && !vehiculoId) setVehiculoId(Number(list[0].id));
    }
    if (rep.ok) {
      const reporte = await rep.json();
      setResumen(reporte.resumen ?? null);
      setCostos(reporte.costosPorMes ?? []);
      setCostosUnidad(reporte.costosPorUnidad ?? []);
      setTotalPeriodo(
        reporte.totalPeriodo ?? { total: 0, n: 0 },
      );
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
  }, [slug, vehiculoId, repDesde, repHasta]);

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
    if (v.esDueno === false) {
      setErr("Este vehículo es compartido; solo la empresa dueña puede editarlo.");
      return;
    }
    setEditId(v.id);
    setAccesoEmpresaIds(v.accesoEmpresaIds ?? []);
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
      accesoEmpresaIds: editId ? accesoEmpresaIds : undefined,
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
    setAccesoEmpresaIds([]);
    await cargar();
  }

  async function buscarPlanesSalida() {
    if (!pilotoNombre.trim() && !placaSalida.trim()) {
      setPlanesSalida([]);
      setPlanIdSalida(0);
      return;
    }
    const params = new URLSearchParams();
    if (pilotoNombre.trim()) params.set("piloto", pilotoNombre.trim());
    if (placaSalida.trim()) params.set("placa", placaSalida.trim());
    const res = await fetch(
      `/api/empresas/${slug}/flota/planes-salida?${params}`,
    );
    const data = await res.json();
    if (!res.ok) return;
    const list = (data.planes ?? []) as PlanSalida[];
    setPlanesSalida(list);
    const sug =
      (data.sugerido as PlanSalida | null) ??
      (list.length === 1 ? list[0] : null);
    if (sug?.id) {
      setPlanIdSalida(Number(sug.id));
      if (sug.cliente) setDestino(sug.cliente);
      if (sug.placa && !placaSalida.trim()) setPlacaSalida(sug.placa);
      if (sug.piloto && !pilotoNombre.trim()) setPilotoNombre(sug.piloto);
    } else if (!list.length) {
      setPlanIdSalida(0);
    }
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
    const veh = vehiculos.find((v) => v.id === vehiculoId);
    if (veh?.en_taller) {
      setErr(
        `${veh.placa} está en taller. No se puede registrar lectura ni enviarlo a ruta.`,
      );
      return;
    }
    if (abiertos.some((a) => a.vehiculo_id === vehiculoId)) {
      setErr("Esa unidad ya tiene un viaje abierto. Cierra la llegada primero.");
      return;
    }
    const nombre = conductor.trim();
    if (nombre.length >= 2) {
      const norm = nombre
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .toLowerCase();
      const mismo = abiertos.find(
        (a) =>
          a.piloto_nombre
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .toLowerCase() === norm,
      );
      if (mismo) {
        setErr(
          `El piloto "${nombre}" ya tiene viaje abierto en ${mismo.placa}.`,
        );
        return;
      }
    }
    const res = await fetch(`/api/empresas/${slug}/flota/lecturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehiculoId,
        km: kmLectura,
        fechaLectura: new Date().toISOString().slice(0, 10),
        conductor: nombre || undefined,
        nota: nombre || undefined,
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

  function agregarRepuesto() {
    const t = repuestoInput.trim();
    if (!t) return;
    if (repuestos.some((r) => r.toLowerCase() === t.toLowerCase())) {
      setRepuestoInput("");
      return;
    }
    setRepuestos((prev) => [...prev, t]);
    setRepuestoInput("");
  }

  function limpiarFormServicio() {
    setEditServicioId(null);
    setRepuestos([]);
    setRepuestoInput("");
    setObsServicio("");
    setCosto(0);
    setKmLectura(0);
    setFechaEntradaTaller("");
    setFechaSalidaTaller(new Date().toISOString().slice(0, 10));
    setArchivosServicio(null);
    setTipoServicio("servicio_mayor");
    setSacarDeServicio(true);
  }

  function editarServicio(s: Servicio) {
    setErr("");
    setMsg("");
    setEditServicioId(s.id);
    const vehId =
      s.vehiculo_id ||
      vehiculos.find((v) => v.placa === s.placa)?.id ||
      vehiculoId;
    setVehiculoId(Number(vehId));
    setTipoServicio(
      s.tipo === "reparacion" ? "reparacion" : "servicio_mayor",
    );
    setKmLectura(Number(s.km_servicio ?? 0));
    setCosto(Number(s.costo ?? 0));
    setRepuestos(
      s.repuestos?.length
        ? [...s.repuestos]
        : s.descripcion
          ? s.descripcion.split("|").map((x) => x.trim()).filter(Boolean)
          : [],
    );
    setRepuestoInput("");
    setObsServicio(s.observaciones ?? "");
    setFechaEntradaTaller(
      s.fecha_entrada_taller
        ? String(s.fecha_entrada_taller).slice(0, 10)
        : "",
    );
    setFechaSalidaTaller(
      s.fecha_salida_taller
        ? String(s.fecha_salida_taller).slice(0, 10)
        : String(s.fecha_servicio).slice(0, 10),
    );
    setSacarDeServicio(Boolean(s.fecha_salida_taller || s.fecha_servicio));
    setArchivosServicio(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function registrarServicio() {
    setErr("");
    const enRuta =
      !editServicioId &&
      abiertos.some((v) => v.vehiculo_id === vehiculoId);
    if (enRuta) {
      setErr(
        "Esa unidad está en ruta. Cierra la llegada antes de registrar servicio.",
      );
      return;
    }
    if (
      (tipoServicio === "servicio_mayor" || tipoServicio === "mantenimiento") &&
      !(kmLectura > 0)
    ) {
      setErr(
        "Servicio mayor: indica el km actual. Reinicia el contador del servicio.",
      );
      return;
    }
    const lista = [...repuestos];
    if (repuestoInput.trim()) lista.push(repuestoInput.trim());
    const fd = new FormData();
    if (editServicioId) fd.append("id", String(editServicioId));
    fd.append("vehiculoId", String(vehiculoId));
    fd.append("tipo", tipoServicio);
    if (kmLectura) fd.append("kmServicio", String(kmLectura));
    fd.append(
      "fechaServicio",
      fechaSalidaTaller || new Date().toISOString().slice(0, 10),
    );
    fd.append("costo", String(costo || 0));
    fd.append("repuestos", JSON.stringify(lista));
    if (obsServicio.trim()) fd.append("observaciones", obsServicio.trim());
    if (fechaEntradaTaller) fd.append("fechaEntradaTaller", fechaEntradaTaller);
    if (fechaSalidaTaller) fd.append("fechaSalidaTaller", fechaSalidaTaller);
    if (sacarDeServicio) fd.append("sacarDeServicio", "1");
    if (archivosServicio) {
      Array.from(archivosServicio).forEach((f, i) =>
        fd.append(`file${i}`, f),
      );
    }
    const res = await fetch(`/api/empresas/${slug}/flota/servicios`, {
      method: editServicioId ? "PATCH" : "POST",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "Error");
    else {
      setMsg(data.mensaje);
      limpiarFormServicio();
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

  async function subirEvidenciasViaje(
    viajeCreadoId: number,
    tipo: "tablero_salida" | "salida" | "tablero_llegada" | "llegada",
    files: File[],
    geo: GeoCoords,
  ) {
    if (!files.length) return;
    const form = new FormData();
    form.set("tipo", tipo);
    if (geo) {
      form.set("latitud", String(geo.lat));
      form.set("longitud", String(geo.lng));
    }
    form.set("capturadoEn", new Date().toISOString().slice(0, 19).replace("T", " "));
    for (const f of files) form.append("files", f);
    const res = await fetch(
      `/api/empresas/${slug}/flota/viajes/${viajeCreadoId}/evidencias`,
      { method: "POST", body: form },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Error al subir fotos");
  }

  async function salidaViaje() {
    setErr("");
    setMsg("");
    const placa = placaSalida.trim().toUpperCase();
    if (placa) {
      const veh = vehiculos.find(
        (v) =>
          v.placa.toUpperCase().replace(/[\s-]/g, "") ===
          placa.replace(/[\s-]/g, ""),
      );
      if (veh?.en_taller) {
        setErr(
          `${veh.placa} está en taller. No se puede enviar a ruta hasta que salga de servicio.`,
        );
        return;
      }
    }
    if (planesSalida.length > 1 && !planIdSalida) {
      setErr("Hay varios planes TMS. Selecciona el plan correcto.");
      return;
    }
    if (!fotoTableroSalida) {
      setErr("Toma o adjunta la foto del tablero (km) para registrar la salida.");
      return;
    }
    if (!kmLectura) {
      setErr("Indica el km de salida (debe coincidir con el tablero).");
      return;
    }

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
        planId: planIdSalida || undefined,
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
    if (!res.ok) {
      setErr(data.mensaje ?? data.error ?? "Error");
      return;
    }

    const nuevoId = Number(data.id);
    setSubiendoFotos(true);
    try {
      const geo = await obtenerGps();
      const tablero = await marcarVarias(
        [fotoTableroSalida],
        `SALIDA · Tablero km ${kmLectura}${placa ? ` · ${placa}` : ""}`,
        geo,
      );
      await subirEvidenciasViaje(nuevoId, "tablero_salida", tablero, geo);
      if (fotosEvidenciaSalida.length) {
        const ev = await marcarVarias(
          fotosEvidenciaSalida,
          `SALIDA · Evidencia${placa ? ` · ${placa}` : ""}`,
          geo,
        );
        await subirEvidenciasViaje(nuevoId, "salida", ev, geo);
      }
      setMsg(
        `${data.mensaje} Fotos de salida guardadas${
          geo ? " con ubicación." : " (sin GPS)."
        }`,
      );
    } catch (e) {
      setErr(
        `Salida registrada, pero falló subir fotos: ${
          e instanceof Error ? e.message : "error"
        }`,
      );
    } finally {
      setSubiendoFotos(false);
    }

    setKmLectura(0);
    setDestino("");
    setMotivoExterno("");
    setEsExterno(false);
    setVerifPiloto(null);
    setPlanesSalida([]);
    setPlanIdSalida(0);
    setFotoTableroSalida(null);
    setFotosEvidenciaSalida([]);
    setViajeId(nuevoId);
    setModoPiloto("llegada");
    await cargar();
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

  async function verAdjuntos(servicioId: number, placa?: string) {
    setErr("");
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
      url: string;
      tamano: number;
    }[];
    if (!list.length) {
      setMsg("Sin facturas / archivos en este servicio.");
      return;
    }
    setPanelAdjuntos({ servicioId, placa, items: list });
  }

  async function abrirAdjunto(url: string, nombre: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        setErr(`No se pudo abrir ${nombre}`);
        return;
      }
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const w = window.open(obj, "_blank");
      if (!w) {
        // Si el popup está bloqueado, forzar descarga/navegación
        const a = document.createElement("a");
        a.href = obj;
        a.target = "_blank";
        a.rel = "noopener";
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(obj), 60_000);
    } catch {
      setErr(`Error al abrir ${nombre}`);
    }
  }

  async function llegadaViaje() {
    setErr("");
    setMsg("");
    if (!viajeId) {
      setErr("Selecciona el viaje abierto.");
      return;
    }
    if (!kmLlegada) {
      setErr("Indica el km de llegada.");
      return;
    }
    if (!fotosLlegada.length) {
      setErr(
        "Adjunta al menos una foto de llegada (se marcará fecha, hora y ubicación).",
      );
      return;
    }

    setSubiendoFotos(true);
    try {
      const geo = await obtenerGps();
      const viajeSel = abiertos.find((v) => v.id === viajeId);
      const placa = viajeSel?.placa ?? "";
      const llegadaMarked = await marcarVarias(
        fotosLlegada,
        `LLEGADA${placa ? ` · ${placa}` : ""} · km ${kmLlegada}`,
        geo,
      );
      await subirEvidenciasViaje(viajeId, "llegada", llegadaMarked, geo);
      if (fotoTableroLlegada) {
        const tablero = await marcarVarias(
          [fotoTableroLlegada],
          `LLEGADA · Tablero km ${kmLlegada}${placa ? ` · ${placa}` : ""}`,
          geo,
        );
        await subirEvidenciasViaje(viajeId, "tablero_llegada", tablero, geo);
      }

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
      if (!res.ok) {
        setErr(data.error ?? "Error al cerrar llegada");
        return;
      }
      setMsg(
        `${data.mensaje} Fotos de llegada guardadas${
          geo ? " con ubicación." : " (sin GPS — activa ubicación del celular)."
        }`,
      );
      setKmLlegada(0);
      setObsViaje("");
      setFotosLlegada([]);
      setFotoTableroLlegada(null);
      setViajeId(0);
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar llegada");
    } finally {
      setSubiendoFotos(false);
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

      {panelAdjuntos ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPanelAdjuntos(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">
                  Facturas / archivos
                  {panelAdjuntos.placa ? ` · ${panelAdjuntos.placa}` : ""}
                </h3>
                <p className="text-xs text-[var(--muted)]">
                  {panelAdjuntos.items.length} archivo(s). Ábrelos uno por uno.
                </p>
              </div>
              <button
                type="button"
                className="rounded bg-[#334155] px-2 py-1 text-xs text-white"
                onClick={() => setPanelAdjuntos(null)}
              >
                Cerrar
              </button>
            </div>
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {panelAdjuntos.items.map((a, i) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-[var(--muted)]">{i + 1}. </span>
                    {a.nombre}
                    {a.tamano ? (
                      <span className="ml-1 text-[11px] text-[var(--muted)]">
                        ({Math.round(a.tamano / 1024)} KB)
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded bg-[#1F6AA5] px-2 py-1 text-xs text-white"
                    onClick={() => void abrirAdjunto(a.url, a.nombre)}
                  >
                    Abrir
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

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
              {editId ? (
                <div className="rounded border border-[var(--border)] p-3">
                  <p className="mb-2 text-xs text-[var(--muted)]">
                    Empresas que pueden usar esta unidad (además de la dueña)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {empresasFlota
                      .filter((e) => e.id !== empresaActualId)
                      .map((e) => (
                        <label
                          key={e.id}
                          className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={accesoEmpresaIds.includes(e.id)}
                            onChange={() =>
                              setAccesoEmpresaIds((prev) =>
                                prev.includes(e.id)
                                  ? prev.filter((x) => x !== e.id)
                                  : [...prev, e.id],
                              )
                            }
                          />
                          {e.codigo}
                        </label>
                      ))}
                  </div>
                </div>
              ) : null}
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
                    <td className="px-3 py-2 font-mono">
                      {v.placa}
                      {v.compartido ? (
                        <span className="ml-1 text-[10px] text-amber-300">
                          compartida
                          {v.empresa_duena_codigo
                            ? ` (${v.empresa_duena_codigo})`
                            : ""}
                        </span>
                      ) : null}
                    </td>
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
            <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted)]">
                No se permite unidad en taller ni el mismo piloto con viaje
                abierto (Walter = walter).
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  className={input}
                  value={vehiculoId}
                  onChange={(e) => setVehiculoId(Number(e.target.value))}
                >
                  {activos.map((v) => {
                    const ruta = abiertos.some((a) => a.vehiculo_id === v.id);
                    return (
                      <option
                        key={v.id}
                        value={v.id}
                        disabled={Boolean(v.en_taller) || ruta}
                      >
                        {v.placa}
                        {v.en_taller ? " · EN TALLER" : ""}
                        {ruta ? " · EN RUTA" : ""}
                      </option>
                    );
                  })}
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
                  placeholder="Conductor / piloto"
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
                    <td className="px-3 py-2">
                      {l.conductor || l.nota || "—"}
                    </td>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[var(--muted)]">
                  {editServicioId
                    ? `Editando servicio #${editServicioId}. Puedes corregir datos y agregar más facturas.`
                    : "No se puede registrar servicio si la unidad está en ruta. Escribe cada repuesto y pulsa Enter. Adjunta facturas PDF o imagen."}
                </p>
                {editServicioId ? (
                  <button
                    type="button"
                    className="rounded bg-[#334155] px-2 py-1 text-xs text-white"
                    onClick={() => limpiarFormServicio()}
                  >
                    Cancelar edición
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  className={input}
                  value={vehiculoId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setVehiculoId(id);
                    const v = activos.find((x) => x.id === id);
                    if (v?.fecha_entrada_taller) {
                      setFechaEntradaTaller(
                        String(v.fecha_entrada_taller).slice(0, 10),
                      );
                    }
                  }}
                >
                  {activos.map((v) => {
                    const ruta = abiertos.some((a) => a.vehiculo_id === v.id);
                    return (
                      <option key={v.id} value={v.id} disabled={ruta}>
                        {v.placa}
                        {ruta ? " · EN RUTA" : ""}
                        {v.en_taller ? " · EN TALLER" : ""}
                        {v.filtro_servicio_mayor
                          ? ` · may:${v.filtro_servicio_mayor}`
                          : ""}
                      </option>
                    );
                  })}
                </select>
                <select
                  className={input}
                  value={tipoServicio}
                  onChange={(e) => setTipoServicio(e.target.value)}
                >
                  <option value="servicio_mayor">
                    Servicio mayor (reinicia el contador del servicio)
                  </option>
                  <option value="reparacion">
                    Reparación (mantiene el kilometraje)
                  </option>
                </select>
                <input
                  type="number"
                  className={`${input} w-28`}
                  placeholder={
                    tipoServicio === "servicio_mayor"
                      ? "Km (obligatorio)"
                      : "Km"
                  }
                  value={kmLectura || ""}
                  onChange={(e) => setKmLectura(Number(e.target.value))}
                  required={tipoServicio === "servicio_mayor"}
                />
                <input
                  type="number"
                  className={`${input} w-28`}
                  placeholder="Costo"
                  value={costo || ""}
                  onChange={(e) => setCosto(Number(e.target.value))}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <label className="text-xs text-[var(--muted)]">
                  Fecha entra al taller
                  <input
                    type="date"
                    className={`${input} mt-1 block`}
                    value={fechaEntradaTaller}
                    onChange={(e) => setFechaEntradaTaller(e.target.value)}
                  />
                </label>
                <label className="text-xs text-[var(--muted)]">
                  Fecha sale del taller
                  <input
                    type="date"
                    className={`${input} mt-1 block`}
                    value={fechaSalidaTaller}
                    onChange={(e) => setFechaSalidaTaller(e.target.value)}
                    disabled={!sacarDeServicio}
                  />
                </label>
                {fechaEntradaTaller && fechaSalidaTaller && sacarDeServicio ? (
                  <p className="self-end pb-1 text-xs text-[var(--muted)]">
                    Días en taller:{" "}
                    <strong className="text-[var(--fg)]">
                      {Math.max(
                        0,
                        Math.round(
                          (new Date(
                            fechaSalidaTaller + "T12:00:00",
                          ).getTime() -
                            new Date(
                              fechaEntradaTaller + "T12:00:00",
                            ).getTime()) /
                            86400000,
                        ),
                      )}
                    </strong>
                  </p>
                ) : null}
              </div>

              <div>
                <label className="text-xs text-[var(--muted)]">
                  Repuestos utilizados (Enter para agregar)
                  <div className="mt-1 flex gap-2">
                    <input
                      className={`${input} min-w-[220px] flex-1`}
                      placeholder="Ej. Filtro de aceite"
                      value={repuestoInput}
                      onChange={(e) => setRepuestoInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          agregarRepuesto();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
                      onClick={() => agregarRepuesto()}
                    >
                      Agregar
                    </button>
                  </div>
                </label>
                {repuestos.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {repuestos.map((r) => (
                      <li
                        key={r}
                        className="flex items-center gap-1 rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-xs"
                      >
                        {r}
                        <button
                          type="button"
                          className="text-red-300"
                          aria-label={`Quitar ${r}`}
                          onClick={() =>
                            setRepuestos((prev) => prev.filter((x) => x !== r))
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    Sin repuestos aún.
                  </p>
                )}
              </div>

              <label className="block text-xs text-[var(--muted)]">
                Observaciones
                <textarea
                  className={`${input} mt-1 w-full`}
                  rows={2}
                  placeholder="Notas del servicio, hallazgos, recomendaciones…"
                  value={obsServicio}
                  onChange={(e) => setObsServicio(e.target.value)}
                />
              </label>

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
                  {editServicioId ? "Guardar cambios" : "Registrar servicio"}
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
                  <th className="px-3 py-2">Entra taller</th>
                  <th className="px-3 py-2">Sale taller</th>
                  <th className="px-3 py-2">Días</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Km</th>
                  <th className="px-3 py-2">Costo</th>
                  <th className="px-3 py-2">Repuestos</th>
                  <th className="px-3 py-2">Obs.</th>
                  <th className="px-3 py-2">Facturas</th>
                  <th className="px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {serviciosFiltrados.map((s) => (
                  <tr
                    key={s.id}
                    className={[
                      "border-t border-[var(--border)]",
                      editServicioId === s.id ? "bg-sky-950/40" : "",
                    ].join(" ")}
                  >
                    <td className="px-3 py-2">
                      {s.fecha_entrada_taller
                        ? String(s.fecha_entrada_taller).slice(0, 10)
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {s.fecha_salida_taller
                        ? String(s.fecha_salida_taller).slice(0, 10)
                        : String(s.fecha_servicio).slice(0, 10)}
                    </td>
                    <td className="px-3 py-2">
                      {s.dias_en_taller != null ? s.dias_en_taller : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">{s.placa}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.tipo === "servicio_mayor" || s.tipo === "mantenimiento"
                        ? "Servicio mayor"
                        : s.tipo === "reparacion"
                          ? "Reparación"
                          : s.tipo}
                    </td>
                    <td className="px-3 py-2">
                      {s.km_servicio?.toLocaleString("es-GT") ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      Q{Number(s.costo).toFixed(2)}
                    </td>
                    <td className="max-w-[180px] px-3 py-2 text-xs text-[var(--muted)]">
                      {(s.repuestos ?? []).length
                        ? s.repuestos!.join(", ")
                        : (s.descripcion ?? "—")}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-xs text-[var(--muted)]">
                      {s.observaciones ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {(s.adjuntos ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="text-sky-300 underline"
                          onClick={() => void verAdjuntos(s.id, s.placa)}
                        >
                          Ver ({s.adjuntos})
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {can("flota_servicios", "editar") ||
                      can("flota_servicios", "crear") ? (
                        <button
                          type="button"
                          className="rounded bg-[#37474F] px-2 py-1 text-xs text-white"
                          onClick={() => editarServicio(s)}
                        >
                          Editar
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
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <label className="text-xs text-[var(--muted)]">
              Desde
              <input
                type="date"
                className={`${input} mt-1 block`}
                value={repDesde}
                onChange={(e) => setRepDesde(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Hasta
              <input
                type="date"
                className={`${input} mt-1 block`}
                value={repHasta}
                onChange={(e) => setRepHasta(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white"
              onClick={() => void cargar()}
            >
              Actualizar gráficas
            </button>
            <p className="text-sm text-[var(--muted)]">
              Total período:{" "}
              <strong className="text-[var(--fg)]">
                Q{totalPeriodo.total.toLocaleString("es-GT", {
                  minimumFractionDigits: 2,
                })}
              </strong>{" "}
              ({totalPeriodo.n} servicios)
            </p>
          </div>

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

          {/* Gráfica costos totales por mes */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="font-medium">
              Costos totales por mes (todas las unidades)
            </h2>
            <p className="text-xs text-[var(--muted)]">
              {repDesde} → {repHasta}
            </p>
            {costos.length ? (
              <div className="mt-4 flex h-52 items-end gap-2 overflow-x-auto pb-6">
                {(() => {
                  const max = Math.max(...costos.map((c) => c.total), 1);
                  return costos.map((c) => (
                    <div
                      key={c.mes}
                      className="flex min-w-[52px] flex-1 flex-col items-center justify-end"
                      title={`Q${c.total.toFixed(2)} · ${c.n} svc`}
                    >
                      <span className="mb-1 text-[10px] text-sky-300">
                        Q{c.total >= 1000
                          ? `${(c.total / 1000).toFixed(1)}k`
                          : c.total.toFixed(0)}
                      </span>
                      <div
                        className="w-full max-w-[48px] rounded-t bg-[#1F6AA5]"
                        style={{
                          height: `${Math.max(8, (c.total / max) * 160)}px`,
                        }}
                      />
                      <span className="mt-1 text-[10px] text-[var(--muted)]">
                        {c.mes.slice(2)}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Sin costos en el rango de fechas.
              </p>
            )}
          </div>

          {/* Gráfica costos por unidad */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="font-medium">Costos por unidad</h2>
            <p className="text-xs text-[var(--muted)]">
              Top unidades con servicio en el período
              {q.trim() ? ` · filtro placa: ${q.trim()}` : ""}
            </p>
            {(() => {
              const lista = costosUnidad.filter((c) =>
                matchQ(c.placa),
              );
              if (!lista.length) {
                return (
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    Sin costos por unidad en el rango.
                  </p>
                );
              }
              const max = Math.max(...lista.map((c) => c.total), 1);
              return (
                <ul className="mt-4 space-y-2">
                  {lista.slice(0, 20).map((c) => (
                    <li key={c.placa} className="text-sm">
                      <div className="mb-0.5 flex justify-between gap-2 text-xs">
                        <span className="font-mono text-sky-300">{c.placa}</span>
                        <span className="text-[var(--muted)]">
                          Q{c.total.toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}{" "}
                          · {c.n} svc
                        </span>
                      </div>
                      <div className="h-3 overflow-hidden rounded bg-[#0b1217]">
                        <div
                          className="h-full rounded bg-emerald-600"
                          style={{
                            width: `${Math.max(4, (c.total / max) * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              );
            })()}
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
                        onBlur={() => void buscarPlanesSalida()}
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
                      onBlur={() => void buscarPlanesSalida()}
                      placeholder="Ej. C-015BNG"
                      list="placas-flota"
                    />
                    <datalist id="placas-flota">
                      {activos
                        .filter((v) => !v.en_taller)
                        .map((v) => (
                          <option key={v.id} value={v.placa}>
                            {v.compartido
                              ? `${v.placa} (compartida ${v.empresa_duena_codigo ?? ""})`
                              : v.placa}
                          </option>
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

                {planesSalida.length ? (
                  <div className="rounded-lg border border-sky-800/50 bg-sky-950/30 p-3 space-y-2">
                    <label className="block text-xs text-sky-200">
                      Plan TMS detectado (Operaciones)
                      <select
                        className={`${input} mt-1 w-full`}
                        value={planIdSalida}
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          setPlanIdSalida(id);
                          const p = planesSalida.find((x) => x.id === id);
                          if (p?.cliente) setDestino(p.cliente);
                          if (p?.placa) setPlacaSalida(p.placa);
                          if (p?.piloto && !pilotoNombre.trim()) {
                            setPilotoNombre(p.piloto);
                          }
                        }}
                      >
                        {planesSalida.length > 1 ? (
                          <option value={0}>Selecciona plan…</option>
                        ) : null}
                        {planesSalida.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.codigo}
                            {p.cliente ? ` · ${p.cliente}` : ""}
                            {p.placa ? ` · ${p.placa}` : ""}
                            {p.auxiliares?.length
                              ? ` · aux: ${p.auxiliares.length}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {planIdSalida
                      ? (() => {
                          const p = planesSalida.find(
                            (x) => x.id === planIdSalida,
                          );
                          if (!p) return null;
                          return (
                            <div className="rounded border border-sky-900/60 bg-[#0b1217]/60 p-2 text-[11px] text-[var(--muted)] space-y-0.5">
                              <p className="font-medium text-sky-200">
                                Detalle de ruta · {p.codigo}
                                {p.estado ? ` (${p.estado})` : ""}
                              </p>
                              {p.cliente ? <p>Cliente: {p.cliente}</p> : null}
                              {p.piloto ? <p>Piloto: {p.piloto}</p> : null}
                              {p.placa ? <p>Unidad: {p.placa}</p> : null}
                              {p.hora_carga ? (
                                <p>Hora carga: {p.hora_carga}</p>
                              ) : null}
                              {p.lugar_carga ? (
                                <p>Lugar carga: {p.lugar_carga}</p>
                              ) : null}
                              {p.lugar_descarga ? (
                                <p>Lugar descarga: {p.lugar_descarga}</p>
                              ) : null}
                              {p.tipo_traslado ? (
                                <p>Tipo: {p.tipo_traslado}</p>
                              ) : null}
                              {p.auxiliares?.length ? (
                                <p>Auxiliares: {p.auxiliares.join(", ")}</p>
                              ) : null}
                              {p.notas ? <p>Notas: {p.notas}</p> : null}
                            </div>
                          );
                        })()
                      : null}
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--muted)]">
                    Si Operaciones tiene un plan hoy con este piloto/placa, se
                    detectará al salir del campo (ej. Walter + C-087BTR).
                  </p>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--muted)]">
                    Foto del tablero (km) *
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className={`${input} mt-1 w-full`}
                      onChange={(e) =>
                        setFotoTableroSalida(e.target.files?.[0] ?? null)
                      }
                    />
                    <span className="mt-0.5 block text-[11px]">
                      Obligatoria. Se marca fecha/hora/ubicación en la foto.
                      {fotoTableroSalida
                        ? ` · ${fotoTableroSalida.name}`
                        : ""}
                    </span>
                  </label>
                  <label className="text-xs text-[var(--muted)]">
                    Evidencias de salida (opcional)
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className={`${input} mt-1 w-full`}
                      onChange={(e) =>
                        setFotosEvidenciaSalida(
                          e.target.files ? Array.from(e.target.files) : [],
                        )
                      }
                    />
                    <span className="mt-0.5 block text-[11px]">
                      Unidad, carga, documentos, etc.
                      {fotosEvidenciaSalida.length
                        ? ` · ${fotosEvidenciaSalida.length} archivo(s)`
                        : ""}
                    </span>
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
                    className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-40"
                    disabled={subiendoFotos}
                    onClick={() => void salidaViaje()}
                  >
                    {subiendoFotos ? "Guardando fotos…" : "Guardar salida"}
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
              <div className="space-y-3">
                <label className="block text-xs text-[var(--muted)]">
                  Buscar viaje por placa o nombre del piloto
                  <input
                    className={`${input} mt-1 w-full`}
                    value={qLlegada}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQLlegada(val);
                      const s = val.trim().toLowerCase();
                      if (!s) return;
                      const hit = abiertos.find((v) => {
                        const placa = v.placa
                          .toLowerCase()
                          .replace(/[\s-]/g, "");
                        const qPlaca = s.replace(/[\s-]/g, "");
                        return (
                          v.placa.toLowerCase().includes(s) ||
                          placa.includes(qPlaca) ||
                          v.piloto_nombre.toLowerCase().includes(s)
                        );
                      });
                      if (hit) setViajeId(hit.id);
                    }}
                    placeholder="Ej. C-015BNG o Walter"
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs text-[var(--muted)] sm:col-span-2">
                    Viaje abierto
                    <select
                      className={`${input} mt-1 w-full`}
                      value={viajeId}
                      onChange={(e) => setViajeId(Number(e.target.value))}
                    >
                      {abiertosFiltrados.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.placa} · {v.piloto_nombre} · km {v.km_salida}
                          {v.destino ? ` → ${v.destino}` : ""}
                        </option>
                      ))}
                    </select>
                    {!abiertosFiltrados.length ? (
                      <span className="mt-1 block text-[11px] text-amber-300">
                        Ningún viaje abierto coincide con la búsqueda.
                      </span>
                    ) : (
                      <span className="mt-1 block text-[11px] text-[var(--muted)]">
                        {abiertosFiltrados.length} de {abiertos.length} abiertos
                      </span>
                    )}
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
                  <label className="text-xs text-[var(--muted)] sm:col-span-2">
                    Fotos de llegada * (fecha, hora y ubicación en la imagen)
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className={`${input} mt-1 w-full`}
                      onChange={(e) =>
                        setFotosLlegada(
                          e.target.files ? Array.from(e.target.files) : [],
                        )
                      }
                    />
                    <span className="mt-0.5 block text-[11px]">
                      Activa la ubicación del celular para marcar GPS.
                      {fotosLlegada.length
                        ? ` · ${fotosLlegada.length} foto(s)`
                        : ""}
                    </span>
                  </label>
                  <label className="text-xs text-[var(--muted)] sm:col-span-2">
                    Foto tablero km llegada (opcional)
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className={`${input} mt-1 w-full`}
                      onChange={(e) =>
                        setFotoTableroLlegada(e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="rounded bg-[#1F6AA5] px-4 py-2 text-sm text-white disabled:opacity-40"
                      disabled={
                        !abiertosFiltrados.length ||
                        !viajeId ||
                        subiendoFotos
                      }
                      onClick={() => void llegadaViaje()}
                    >
                      {subiendoFotos
                        ? "Guardando fotos…"
                        : "Guardar llegada"}
                    </button>
                  </div>
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
