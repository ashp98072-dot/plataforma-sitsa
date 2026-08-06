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
import { normalizarFotoCamara, normalizarFotosCamara } from "@/lib/flota/camera-file";
import { TomarFotoButton } from "@/components/flota/tomar-foto";
import {
  ahoraLocal,
  formatearFechaVisible,
  formatearTimestampVisible,
  hoyLocal,
} from "@/lib/rrhh/dates";

function normPiloto(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

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
  filtros?: { tipo: string; codigo: string; notas?: string | null }[];
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

type PlanParadaUi = {
  id: number;
  orden: number;
  lugar_nombre: string;
  tipo: string;
  requiere_evidencia: boolean;
  evidencias: number;
};

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
  paradas?: PlanParadaUi[];
};

type Lectura = {
  id: number;
  placa: string;
  km: number;
  fecha_lectura: string;
  nota: string | null;
  conductor?: string | null;
  registrado_por?: string | null;
  viaje_id?: number | null;
  latitud?: number | null;
  longitud?: number | null;
  capturado_en?: string | null;
  evidencias?: number;
  evidencias_propias?: number;
  evidencias_viaje?: number;
  viaje_destino?: string | null;
  viaje_estado?: string | null;
  viaje_hora_salida?: string | null;
  viaje_hora_llegada?: string | null;
  plan_codigo?: string | null;
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
  hora_llegada?: string | null;
  observaciones?: string | null;
  es_externo?: number;
  plan_id?: number | null;
  plan_codigo?: string | null;
  plan_estado?: string | null;
  plan_cliente?: string | null;
  evidencias?: number;
  km_recorridos?: number | null;
  paradas?: PlanParadaUi[];
  paradasPendientes?: number;
};

type EvidenciaViaje = {
  id: number;
  tipo: string;
  nombre: string;
  latitud: number | null;
  longitud: number | null;
  capturadoEn?: string | null;
  url: string;
  origen?: "lectura" | "viaje";
  /** Origen del registro para borrado (solo Admin). */
  fuente?: "flota" | "tms" | "lectura";
  viajeId?: number;
};

function fmtFechaHora(v: string | Date | null | undefined): string {
  return formatearTimestampVisible(v);
}

function labelTipoEvidencia(tipo: string): string {
  switch (tipo) {
    case "tablero_salida":
      return "Tablero salida";
    case "salida":
      return "Evidencia salida";
    case "tablero_llegada":
      return "Tablero llegada";
    case "llegada":
      return "Evidencia llegada";
    case "tablero":
      return "Tablero km";
    case "evidencia":
      return "Evidencia";
    case "producto":
    case "Producto":
      return "Producto / parada";
    default:
      return tipo;
  }
}

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
  | "compras"
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
  rin: "",
  medidaLlanta: "",
  tipoAceite: "",
  color: "",
  notas: "",
  activo: true,
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
  const [viajesReporte, setViajesReporte] = useState<Viaje[]>([]);
  const [abiertos, setAbiertos] = useState<Viaje[]>([]);
  const [viajeEvidencias, setViajeEvidencias] = useState<
    Record<number, EvidenciaViaje[]>
  >({});
  const [viajeExpandido, setViajeExpandido] = useState<number | null>(null);
  const [fotoVista, setFotoVista] = useState<EvidenciaViaje | null>(null);
  const [fotoTableroLectura, setFotoTableroLectura] = useState<File | null>(
    null,
  );
  const [fotosExtraLectura, setFotosExtraLectura] = useState<File[]>([]);
  const [lecturaExpandida, setLecturaExpandida] = useState<number | null>(null);
  const [lecturaEvidencias, setLecturaEvidencias] = useState<
    Record<number, EvidenciaViaje[]>
  >({});
  const [paradasViaje, setParadasViaje] = useState<PlanParadaUi[]>([]);
  const [planIdViaje, setPlanIdViaje] = useState<number | null>(null);
  /** Cuenta compartida "piloto": quién está operando ahora */
  const [pilotoSesion, setPilotoSesion] = useState("");
  const [pilotoSesionConfirmado, setPilotoSesionConfirmado] = useState(false);
  const [pilotoSesionDraft, setPilotoSesionDraft] = useState("");
  const [q, setQ] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<
    "todos" | "activos" | "inactivos"
  >("todos");
  const [filtroTaller, setFiltroTaller] = useState<"todos" | "taller" | "ruta">(
    "todos",
  );
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [importando, setImportando] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [filtrosForm, setFiltrosForm] = useState<
    { tipo: string; codigo: string }[]
  >([]);
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
  const [fechaSalidaTaller, setFechaSalidaTaller] = useState(() => hoyLocal());
  const [editServicioId, setEditServicioId] = useState<number | null>(null);
  const [compraVehiculoId, setCompraVehiculoId] = useState(0);
  const [compraServicioId, setCompraServicioId] = useState(0);
  const [compraDesc, setCompraDesc] = useState("");
  const [compraCosto, setCompraCosto] = useState(0);
  const [compraFecha, setCompraFecha] = useState(() => hoyLocal());
  const [compraFiles, setCompraFiles] = useState<FileList | null>(null);
  const [filtroHistorialServicios, setFiltroHistorialServicios] = useState<
    "todos" | "en_taller" | "cerrados" | "compras"
  >("todos");
  const [sacarVehiculoId, setSacarVehiculoId] = useState(0);
  const [sacarKm, setSacarKm] = useState(0);
  const [sacarFecha, setSacarFecha] = useState(() => hoyLocal());
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
  const [repHasta, setRepHasta] = useState(() => hoyLocal());

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

  function esVehiculoActivo(v: Vehiculo): boolean {
    return Number(v.activo ?? 1) !== 0;
  }

  const vehiculosFiltrados = useMemo(() => {
    return vehiculos.filter((v) => {
      const activo = esVehiculoActivo(v);
      if (filtroEstado === "activos" && !activo) return false;
      if (filtroEstado === "inactivos" && activo) return false;
      if (filtroTaller === "taller" && !v.en_taller) return false;
      if (filtroTaller === "ruta" && v.en_taller) return false;
      return matchQ(
        v.placa,
        `${v.marca ?? ""} ${v.modelo ?? ""} ${v.descripcion ?? ""} ${v.empresa_activo ?? ""}`,
      );
    });
  }, [vehiculos, filtroEstado, filtroTaller, matchQ]);

  const activos = useMemo(
    () =>
      vehiculos.filter(
        (v) =>
          esVehiculoActivo(v) && matchQ(v.placa, `${v.marca} ${v.modelo}`),
      ),
    [vehiculos, matchQ],
  );

  const lecturasFiltradas = useMemo(
    () => lecturas.filter((l) => matchQ(l.placa, l.nota ?? "")),
    [lecturas, matchQ],
  );
  const serviciosFiltrados = useMemo(() => {
    return servicios.filter((s) => {
      if (!matchQ(s.placa, `${s.tipo} ${s.descripcion ?? ""}`)) return false;
      if (filtroHistorialServicios === "compras") return s.tipo === "compra";
      if (filtroHistorialServicios === "en_taller") {
        return s.tipo !== "compra" && !s.fecha_salida_taller;
      }
      if (filtroHistorialServicios === "cerrados") {
        return Boolean(s.fecha_salida_taller) || s.tipo === "compra";
      }
      return true;
    });
  }, [servicios, matchQ, filtroHistorialServicios]);

  const vehiculosEnTaller = useMemo(
    () =>
      activos.filter(
        (v) => Boolean(v.en_taller) && matchQ(v.placa, `${v.marca} ${v.modelo}`),
      ),
    [activos, matchQ],
  );
  /** Piloto (kiosco): solo ve viajes de su nombre de sesión. */
  const esVistaPilotoRestringida =
    rol === "Piloto" ||
    (pilotoSesionConfirmado && Boolean(pilotoSesion.trim()));

  const abiertosDelPiloto = useMemo(() => {
    // Cuenta Piloto: sin identificar → no mostrar rutas ajenas
    if (rol === "Piloto" && (!pilotoSesionConfirmado || !pilotoSesion.trim())) {
      return [];
    }
    if (!pilotoSesionConfirmado || !pilotoSesion.trim()) return abiertos;
    const n = normPiloto(pilotoSesion);
    return abiertos.filter((v) => normPiloto(v.piloto_nombre) === n);
  }, [abiertos, pilotoSesion, pilotoSesionConfirmado, rol]);

  const viajesFiltrados = useMemo(() => {
    let list = viajes;
    if (rol === "Piloto") {
      if (!pilotoSesionConfirmado || !pilotoSesion.trim()) list = [];
      else {
        const n = normPiloto(pilotoSesion);
        list = viajes.filter((v) => normPiloto(v.piloto_nombre) === n);
      }
    } else if (pilotoSesionConfirmado && pilotoSesion.trim()) {
      const n = normPiloto(pilotoSesion);
      list = viajes.filter((v) => normPiloto(v.piloto_nombre) === n);
    }
    return list.filter((v) =>
      matchQ(v.placa, `${v.piloto_nombre} ${v.destino ?? ""}`),
    );
  }, [
    viajes,
    matchQ,
    rol,
    pilotoSesion,
    pilotoSesionConfirmado,
  ]);

  const viajesReporteFiltrados = useMemo(
    () =>
      viajesReporte.filter((v) =>
        matchQ(
          v.placa,
          `${v.piloto_nombre} ${v.destino ?? ""} ${v.plan_codigo ?? ""}`,
        ),
      ),
    [viajesReporte, matchQ],
  );

  const permisosExtVisibles = useMemo(() => {
    if (rol !== "Piloto") return permisosExt;
    if (!pilotoSesionConfirmado || !pilotoSesion.trim()) return [];
    const n = normPiloto(pilotoSesion);
    return permisosExt.filter((p) => normPiloto(p.piloto_nombre) === n);
  }, [permisosExt, rol, pilotoSesion, pilotoSesionConfirmado]);

  /** Con viaje abierto: no puede registrar otra salida. */
  const pilotoEnViaje =
    pilotoSesionConfirmado && abiertosDelPiloto.length > 0;

  const abiertosFiltrados = useMemo(() => {
    const base =
      rol === "Piloto" || pilotoSesionConfirmado
        ? abiertosDelPiloto
        : abiertos;
    const s = qLlegada.trim().toLowerCase();
    if (!s) return base;
    const filtrados = base.filter((v) => {
      const placa = v.placa.toLowerCase().replace(/[\s-]/g, "");
      const qPlaca = s.replace(/[\s-]/g, "");
      const piloto = v.piloto_nombre.toLowerCase();
      return (
        v.placa.toLowerCase().includes(s) ||
        placa.includes(qPlaca) ||
        piloto.includes(s) ||
        (v.destino ?? "").toLowerCase().includes(s) ||
        (Number(v.es_externo) === 1 && "externo".includes(s))
      );
    });
    // En vista piloto no ampliar a viajes ajenos si el filtro no coincide
    if (rol === "Piloto" || pilotoSesionConfirmado) return filtrados;
    return filtrados.length ? filtrados : base;
  }, [
    abiertos,
    abiertosDelPiloto,
    qLlegada,
    pilotoSesionConfirmado,
    rol,
  ]);

  const cargar = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    const rolMe = String(me.user?.rol ?? "");
    setRol(rolMe);
    setPermisos(me.permisos ?? []);
    // No precargar nombre del admin/usuario: el piloto se escribe a mano
    // (RRHH o externo). Evita filtrar llegadas con "Administrador General".

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
      setViajesReporte((reporte.viajes ?? []) as Viaje[]);
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
      const abs = (data.abiertos ?? []) as Viaje[];
      setAbiertos(abs);
      setViajeId((prev) => {
        if (prev && abs.some((a) => a.id === prev)) return prev;
        return abs[0] ? Number(abs[0].id) : 0;
      });
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

  useEffect(() => {
    try {
      const key = `flota_piloto_sesion_${slug}`;
      const saved = sessionStorage.getItem(key);
      if (saved && saved.trim().length >= 2) {
        setPilotoSesion(saved.trim());
        setPilotoSesionDraft(saved.trim());
        setPilotoSesionConfirmado(true);
        setPilotoNombre(saved.trim());
      }
    } catch {
      /* ok */
    }
  }, [slug]);

  useEffect(() => {
    if (modoPiloto === "llegada" && viajeId) {
      void cargarParadasViaje(viajeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoPiloto, viajeId, slug]);

  useEffect(() => {
    if (!pilotoSesionConfirmado) return;
    if (abiertosDelPiloto.length) {
      setModoPiloto("llegada");
      setViajeId((prev) => {
        if (prev && abiertosDelPiloto.some((a) => a.id === prev)) return prev;
        return Number(abiertosDelPiloto[0].id);
      });
      setQLlegada("");
    } else if (modoPiloto === "llegada") {
      setModoPiloto("salida");
      setViajeId(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilotoSesionConfirmado, abiertosDelPiloto]);

  function confirmarPilotoSesion() {
    const n = pilotoSesionDraft.trim();
    if (n.length < 2) {
      setErr("Escribe tu nombre completo para identificar tu sesión.");
      return;
    }
    setPilotoSesion(n);
    setPilotoNombre(n);
    setPilotoSesionConfirmado(true);
    setErr("");
    try {
      sessionStorage.setItem(`flota_piloto_sesion_${slug}`, n);
    } catch {
      /* ok */
    }
    const mios = abiertos.filter(
      (v) => normPiloto(v.piloto_nombre) === normPiloto(n),
    );
    if (mios[0]) {
      setViajeId(mios[0].id);
      setModoPiloto("llegada");
      setQLlegada("");
      setMsg(
        `${n}: tienes ${mios.length} viaje(s) abierto(s). Solo puedes registrar llegada / cerrar ruta.`,
      );
    } else {
      setViajeId(0);
      setModoPiloto("salida");
      setMsg(`${n}: sin viaje abierto. Puedes registrar una salida.`);
    }
  }

  function cambiarPilotoSesion() {
    setPilotoSesionConfirmado(false);
    setPilotoSesionDraft(pilotoSesion);
    try {
      sessionStorage.removeItem(`flota_piloto_sesion_${slug}`);
    } catch {
      /* ok */
    }
  }

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
      rin: v.rin_llanta ?? "",
      medidaLlanta: v.medida_llanta ?? "",
      tipoAceite: v.tipo_aceite ?? "",
      color: v.color ?? "",
      notas: v.notas ?? "",
      activo: esVehiculoActivo(v),
    });
    setFiltrosForm(
      (v.filtros ?? [])
        .filter((f) => f.tipo && f.codigo)
        .map((f) => ({ tipo: f.tipo, codigo: f.codigo })),
    );
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
      rinLlanta: form.rin,
      medidaLlanta: form.medidaLlanta,
      tipoAceite: form.tipoAceite,
      notas: form.notas,
      activo: form.activo,
      filtros: filtrosForm
        .map((f) => ({
          tipo: f.tipo.trim(),
          codigo: f.codigo.trim(),
        }))
        .filter((f) => f.tipo && f.codigo),
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
    setFiltrosForm([]);
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

  /** Cierra taller y, si hay servicio abierto, lo completa con fecha de salida. */
  async function sacarVehiculoDeServicio() {
    setErr("");
    setMsg("");
    const id = sacarVehiculoId;
    if (!id) {
      setErr("Selecciona el vehículo que sale de servicio / taller.");
      return;
    }
    const abierto = servicios.find(
      (s) =>
        Number(s.vehiculo_id) === id &&
        !s.fecha_salida_taller &&
        s.tipo !== "compra",
    );
    if (
      abierto &&
      (can("flota_servicios", "editar") || can("flota_servicios", "crear"))
    ) {
      const patch = await fetch(`/api/empresas/${slug}/flota/servicios`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: abierto.id,
          vehiculoId: id,
          tipo: abierto.tipo,
          kmServicio:
            sacarKm ||
            abierto.km_servicio ||
            vehiculos.find((v) => v.id === id)?.km_actual ||
            null,
          fechaServicio: sacarFecha || hoyLocal(),
          fechaEntradaTaller: abierto.fecha_entrada_taller
            ? String(abierto.fecha_entrada_taller).slice(0, 10)
            : undefined,
          fechaSalidaTaller: sacarFecha || hoyLocal(),
          sacarDeServicio: true,
          costo: Number(abierto.costo ?? 0),
          descripcion: abierto.descripcion ?? undefined,
          observaciones: abierto.observaciones ?? undefined,
          repuestos: abierto.repuestos ?? [],
        }),
      });
      const pdata = await patch.json();
      if (!patch.ok) {
        await salirTaller(id);
        setMsg(
          `${pdata.error ? pdata.error + " · " : ""}Unidad marcada fuera de taller.`,
        );
        setSacarVehiculoId(0);
        return;
      }
      setMsg(pdata.mensaje ?? "Vehículo sacado de servicio.");
      setSacarVehiculoId(0);
      setSacarKm(0);
      await cargar();
      return;
    }
    await salirTaller(id);
    setSacarVehiculoId(0);
    setSacarKm(0);
  }

  async function cambiarActivoVehiculo(id: number, activo: boolean) {
    setErr("");
    setMsg("");
    if (!activo) {
      const ok = window.confirm(
        "¿Dar de baja este vehículo? Quedará inactivo (no se borra el historial).",
      );
      if (!ok) return;
      const res = await fetch(
        `/api/empresas/${slug}/flota/vehiculos?id=${id}&modo=baja`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) setErr(data.error ?? "No se pudo dar de baja");
      else setMsg(data.mensaje ?? "Vehículo dado de baja.");
      await cargar();
      return;
    }
    const res = await fetch(`/api/empresas/${slug}/flota/vehiculos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, activo: true }),
    });
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "No se pudo activar");
    else setMsg(data.mensaje ?? "Vehículo activado.");
    await cargar();
  }

  async function eliminarVehiculo(v: Vehiculo) {
    if (v.esDueno === false) {
      setErr("Solo la empresa dueña puede eliminar este vehículo.");
      return;
    }
    const ok = window.confirm(
      `¿ELIMINAR definitivamente ${v.placa}?\n\nSe borrarán también sus viajes, lecturas y servicios.\nSi solo quieres sacarlo de uso, cancela y usa «Dar de baja».`,
    );
    if (!ok) return;
    const ok2 = window.confirm(
      `Confirma otra vez: eliminar ${v.placa} de forma permanente.`,
    );
    if (!ok2) return;
    setErr("");
    setMsg("");
    const res = await fetch(
      `/api/empresas/${slug}/flota/vehiculos?id=${v.id}&modo=eliminar`,
      { method: "DELETE" },
    );
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "No se pudo eliminar");
    else {
      setMsg(data.mensaje ?? "Vehículo eliminado.");
      if (editId === v.id) {
        setEditId(null);
        setForm(emptyForm);
        setFiltrosForm([]);
      }
    }
    await cargar();
  }

  async function cargarParadasViaje(viajeIdSel: number) {
    if (!viajeIdSel) {
      setParadasViaje([]);
      setPlanIdViaje(null);
      return;
    }
    const res = await fetch(
      `/api/empresas/${slug}/flota/viajes/${viajeIdSel}/paradas`,
    );
    const data = await res.json();
    if (!res.ok) {
      setParadasViaje([]);
      setPlanIdViaje(null);
      return;
    }
    setPlanIdViaje(data.planId ?? null);
    setParadasViaje((data.paradas ?? []) as PlanParadaUi[]);
  }

  async function subirEvidenciaParada(
    paradaId: number,
    files: FileList | File[] | File | null,
  ) {
    const lista = !files
      ? []
      : files instanceof File
        ? [files]
        : Array.from(files);
    if (!viajeId || !lista.length) {
      setErr("Toma una foto para esta parada.");
      return;
    }
    setErr("");
    setMsg("");
    setSubiendoFotos(true);
    try {
      const geo = await obtenerGps();
      const parada = paradasViaje.find((p) => p.id === paradaId);
      const originales = await normalizarFotosCamara(
        lista,
        `parada_${paradaId}`,
      );
      if (!originales.length) {
        throw new Error("La foto está vacía. Toma otra con la cámara.");
      }
      let marked = await marcarVarias(
        originales,
        `PRODUCTO · ${parada?.orden ?? ""}. ${parada?.lugar_nombre ?? "Parada"}`,
        geo,
      );
      if (!marked.length) marked = originales;

      const form = new FormData();
      form.set("tipo", "producto");
      form.set("paradaId", String(paradaId));
      if (geo) {
        form.set("latitud", String(geo.lat));
        form.set("longitud", String(geo.lng));
      }
      form.set("capturadoEn", ahoraLocal());
      for (const f of marked) {
        form.append("files", f, f.name || `parada_${paradaId}.jpg`);
      }
      const res = await fetch(
        `/api/empresas/${slug}/flota/viajes/${viajeId}/evidencias`,
        { method: "POST", body: form },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Fallback: subir directo al plan TMS
        if (planIdViaje) {
          const form2 = new FormData();
          form2.set("planId", String(planIdViaje));
          form2.set("paradaId", String(paradaId));
          form2.set("tipo", "Producto");
          if (geo) {
            form2.set("latitud", String(geo.lat));
            form2.set("longitud", String(geo.lng));
          }
          for (const f of marked) {
            form2.append("files", f, f.name || `parada_${paradaId}.jpg`);
          }
          const res2 = await fetch(`/api/empresas/${slug}/tms/evidencias`, {
            method: "POST",
            body: form2,
          });
          const data2 = await res2.json().catch(() => ({}));
          if (!res2.ok) {
            throw new Error(
              data.error || data2.error || "No se pudo subir la foto",
            );
          }
          setMsg("Evidencia guardada en el plan.");
        } else {
          throw new Error(data.error ?? "No se pudo subir la foto");
        }
      } else {
        setMsg(data.mensaje ?? "Evidencia de parada guardada.");
      }
      await cargarParadasViaje(viajeId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al subir evidencia");
    } finally {
      setSubiendoFotos(false);
    }
  }

  async function verEvidenciasLectura(lecturaIdSel: number) {
    if (lecturaExpandida === lecturaIdSel) {
      setLecturaExpandida(null);
      return;
    }
    setLecturaExpandida(lecturaIdSel);
    if (lecturaEvidencias[lecturaIdSel]) return;
    setErr("");
    const res = await fetch(
      `/api/empresas/${slug}/flota/lecturas/${lecturaIdSel}/evidencias`,
    );
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "No se pudieron cargar evidencias");
      return;
    }
    setLecturaEvidencias((prev) => ({
      ...prev,
      [lecturaIdSel]: (data.evidencias ?? []) as EvidenciaViaje[],
    }));
  }

  async function registrarLectura() {
    setErr("");
    setMsg("");
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
    const kmActual = Number(veh?.km_actual ?? 0);
    if (kmLectura < kmActual) {
      setErr(
        `Km (${kmLectura.toLocaleString("es-GT")}) no puede ser menor al km actual (${kmActual.toLocaleString("es-GT")}). Debe ser mayor o igual.`,
      );
      return;
    }
    if (!fotoTableroLectura && rol === "Piloto") {
      setErr("Toma o adjunta la foto del tablero (km) para la lectura.");
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

    const geo = await obtenerGps();
    const res = await fetch(`/api/empresas/${slug}/flota/lecturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehiculoId,
        km: kmLectura,
        fechaLectura: hoyLocal(),
        conductor: nombre || undefined,
        nota: nombre || undefined,
        latitud: geo?.lat ?? null,
        longitud: geo?.lng ?? null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "Error");
      return;
    }

    const lecId = Number(data.id);
    if (fotoTableroLectura || fotosExtraLectura.length) {
    setSubiendoFotos(true);
    try {
      if (fotoTableroLectura) {
      const tablero = await marcarVarias(
        [fotoTableroLectura],
        `LECTURA · Tablero km ${kmLectura}${veh ? ` · ${veh.placa}` : ""}`,
        geo,
      );
      const form = new FormData();
      form.set("tipo", "tablero");
      if (geo) {
        form.set("latitud", String(geo.lat));
        form.set("longitud", String(geo.lng));
      }
      form.set("capturadoEn", ahoraLocal());
      for (const f of tablero) form.append("files", f);
      const up = await fetch(
        `/api/empresas/${slug}/flota/lecturas/${lecId}/evidencias`,
        { method: "POST", body: form },
      );
      if (!up.ok) {
        const ud = await up.json();
        throw new Error(ud.error ?? "Error al subir foto del tablero");
      }
      }
      if (fotosExtraLectura.length) {
        const extras = await marcarVarias(
          fotosExtraLectura,
          `LECTURA · Evidencia${veh ? ` · ${veh.placa}` : ""}`,
          geo,
        );
        const form2 = new FormData();
        form2.set("tipo", "evidencia");
        if (geo) {
          form2.set("latitud", String(geo.lat));
          form2.set("longitud", String(geo.lng));
        }
        form2.set("capturadoEn", ahoraLocal());
        for (const f of extras) form2.append("files", f);
        await fetch(
          `/api/empresas/${slug}/flota/lecturas/${lecId}/evidencias`,
          { method: "POST", body: form2 },
        );
      }
      setMsg(
        `${data.mensaje} Fotos guardadas${
          geo ? " con ubicación." : " (sin GPS)."
        }`,
      );
    } catch (e) {
      setErr(
        `Lectura registrada, pero falló subir fotos: ${
          e instanceof Error ? e.message : "error"
        }`,
      );
    } finally {
      setSubiendoFotos(false);
    }
    } else {
      setMsg(data.mensaje);
    }

    setKmLectura(0);
    setFotoTableroLectura(null);
    setFotosExtraLectura([]);
    await cargar();
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
    setFechaSalidaTaller(hoyLocal());
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
      fechaSalidaTaller || hoyLocal(),
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
    form.set("capturadoEn", ahoraLocal());
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
    if (rol === "Piloto" && !pilotoSesionConfirmado) {
      setErr("Primero indica quién está operando (tu nombre).");
      return;
    }
    if (pilotoSesionConfirmado && pilotoSesion.trim()) {
      setPilotoNombre(pilotoSesion.trim());
    }
    const nombreSalida = (
      pilotoSesionConfirmado ? pilotoSesion : pilotoNombre
    ).trim();
    if (nombreSalida.length < 2) {
      setErr("Escribe el nombre del piloto.");
      return;
    }
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
    if (!fotoTableroSalida && rol === "Piloto") {
      setErr("Toma o adjunta la foto del tablero (km) para registrar la salida.");
      return;
    }
    if (!kmLectura && kmLectura !== 0) {
      setErr("Indica el km de salida (debe coincidir con el tablero).");
      return;
    }
    const vehKm = vehiculos.find(
      (v) =>
        v.placa.toUpperCase().replace(/[\s-]/g, "") ===
        placa.replace(/[\s-]/g, ""),
    );
    const kmActual = Number(vehKm?.km_actual ?? 0);
    if (kmLectura < kmActual) {
      setErr(
        `Km de salida (${kmLectura.toLocaleString("es-GT")}) no puede ser menor al km actual de la unidad (${kmActual.toLocaleString("es-GT")}). Debe ser mayor o igual.`,
      );
      return;
    }

    const res = await fetch(`/api/empresas/${slug}/flota/viajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "salida",
        placa: placaSalida.trim() || undefined,
        vehiculoId: placaSalida.trim() ? undefined : vehiculoId || undefined,
        pilotoNombre: nombreSalida,
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
    if (fotoTableroSalida || fotosEvidenciaSalida.length) {
    setSubiendoFotos(true);
    try {
      const geo = await obtenerGps();
      if (fotoTableroSalida) {
      const tablero = await marcarVarias(
        [fotoTableroSalida],
        `SALIDA · Tablero km ${kmLectura}${placa ? ` · ${placa}` : ""}`,
        geo,
      );
      await subirEvidenciasViaje(nuevoId, "tablero_salida", tablero, geo);
      }
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
    } else {
      setMsg(data.mensaje);
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
    setQLlegada("");
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

  async function verEvidenciasViaje(viajeIdSel: number) {
    if (viajeExpandido === viajeIdSel) {
      setViajeExpandido(null);
      return;
    }
    setViajeExpandido(viajeIdSel);
    if (viajeEvidencias[viajeIdSel]) return;
    setErr("");
    const res = await fetch(
      `/api/empresas/${slug}/flota/viajes/${viajeIdSel}/evidencias`,
    );
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "No se pudieron cargar evidencias");
      return;
    }
    const list: EvidenciaViaje[] = (
      (data.evidencias ?? []) as EvidenciaViaje[]
    ).map((e) => ({
      ...e,
      fuente: "flota" as const,
      viajeId: viajeIdSel,
    }));
    const viaje = viajesReporte.find((x) => x.id === viajeIdSel);
    if (viaje?.plan_id) {
      const tmsRes = await fetch(
        `/api/empresas/${slug}/tms/evidencias?planId=${viaje.plan_id}`,
      );
      if (tmsRes.ok) {
        const tms = await tmsRes.json();
        const extras: EvidenciaViaje[] = (
          (tms.evidencias ?? []) as {
            id: number;
            tipo: string;
            nombre: string;
            latitud: number | null;
            longitud: number | null;
            capturadoEn?: string | null;
            url: string;
            parada_nombre?: string | null;
          }[]
        ).map((e) => ({
          id: e.id,
          tipo: e.parada_nombre
            ? `producto · ${e.parada_nombre}`
            : e.tipo,
          nombre: e.nombre,
          latitud: e.latitud,
          longitud: e.longitud,
          capturadoEn: e.capturadoEn,
          url: e.url,
          origen: "viaje",
          fuente: "tms",
          viajeId: viajeIdSel,
        }));
        // Evitar duplicar si ya están en flota (mismas urls relativas difíciles); unir por id+url
        const urls = new Set(list.map((x) => x.url));
        for (const e of extras) {
          if (!urls.has(e.url)) list.push(e);
        }
      }
    }
    setViajeEvidencias((prev) => ({
      ...prev,
      [viajeIdSel]: list,
    }));
  }

  async function eliminarEvidenciaAdmin(
    ev: EvidenciaViaje,
    viajeIdSel?: number,
  ) {
    if (rol !== "Admin") {
      setErr(
        "Solo un administrador puede eliminar evidencias. Solicita el borrado a un Admin.",
      );
      return;
    }
    const ok = window.confirm(
      `¿Eliminar esta evidencia?\n\n${labelTipoEvidencia(ev.tipo)}\n${ev.nombre}\n\nSolo Admin puede hacerlo. Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    setErr("");
    setMsg("");
    const vid = viajeIdSel ?? ev.viajeId;
    const fuente = ev.fuente ?? (ev.url.includes("/tms/") ? "tms" : "flota");
    if (fuente !== "tms" && !vid) {
      setErr("No se pudo determinar el viaje de la evidencia.");
      return;
    }
    const url =
      fuente === "tms"
        ? `/api/empresas/${slug}/tms/evidencias?adjuntoId=${ev.id}`
        : `/api/empresas/${slug}/flota/viajes/${vid}/evidencias?adjuntoId=${ev.id}`;
    const res = await fetch(url, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "No se pudo eliminar la evidencia");
      return;
    }
    setMsg(data.mensaje ?? "Evidencia eliminada.");
    setFotoVista(null);
    if (vid) {
      setViajeEvidencias((prev) => ({
        ...prev,
        [vid]: (prev[vid] ?? []).filter(
          (x) =>
            !(
              x.id === ev.id &&
              (x.fuente ?? "flota") === fuente
            ),
        ),
      }));
    }
    await cargar();
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

  async function guardarCompraFactura() {
    setErr("");
    setMsg("");
    const vid = compraVehiculoId || vehiculoId;
    if (!vid) {
      setErr("Selecciona el vehículo al que corresponde la compra / factura.");
      return;
    }
    if (!compraFiles?.length && !compraServicioId) {
      setErr("Adjunta al menos una factura (PDF o imagen).");
      return;
    }

    // Adjuntar a servicio abierto en taller
    if (compraServicioId) {
      if (!compraFiles?.length) {
        setErr("Selecciona el archivo de la factura.");
        return;
      }
      const fd = new FormData();
      Array.from(compraFiles).forEach((f) => fd.append("files", f));
      const res = await fetch(
        `/api/empresas/${slug}/flota/servicios/${compraServicioId}/adjuntos`,
        { method: "POST", body: fd },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "No se pudo adjuntar la factura");
        return;
      }
      setMsg(data.mensaje);
      setCompraFiles(null);
      setCompraServicioId(0);
      await cargar();
      return;
    }

    // Nueva compra enlazada al vehículo
    const fd = new FormData();
    fd.set("vehiculoId", String(vid));
    fd.set("tipo", "compra");
    fd.set("fechaServicio", compraFecha || hoyLocal());
    fd.set("costo", String(compraCosto || 0));
    fd.set("descripcion", compraDesc.trim() || "Compra / factura");
    fd.set("sacarDeServicio", "1");
    if (compraFiles) {
      Array.from(compraFiles).forEach((f, i) => fd.set(`file${i}`, f));
    }
    const res = await fetch(`/api/empresas/${slug}/flota/servicios`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "No se pudo registrar la compra");
      return;
    }
    setMsg(data.mensaje ?? "Compra / factura registrada y enlazada al vehículo.");
    setCompraDesc("");
    setCompraCosto(0);
    setCompraFiles(null);
    await cargar();
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

    const parRes = await fetch(
      `/api/empresas/${slug}/flota/viajes/${viajeId}/paradas`,
    );
    const parData = await parRes.json();
    const paradasAhora = (parData.paradas ?? []) as PlanParadaUi[];
    setParadasViaje(paradasAhora);
    setPlanIdViaje(parData.planId ?? null);
    const esRutaConParadas = paradasAhora.length > 0;

    const pendientesAhora = paradasAhora.filter(
      (p) => p.requiere_evidencia && p.evidencias < 1,
    );
    if (pendientesAhora.length) {
      setErr(
        `Ruta detectada con ${paradasAhora.length} destino(s). Faltan evidencias en: ${pendientesAhora
          .map((p) => `${p.orden}. ${p.lugar_nombre}`)
          .join("; ")}.`,
      );
      return;
    }

    if (!kmLlegada && kmLlegada !== 0) {
      setErr(
        esRutaConParadas
          ? "Al terminar la ruta indica el km final del odómetro."
          : "Indica el km de llegada.",
      );
      return;
    }
    const viajeSelPre = abiertos.find((v) => v.id === viajeId);
    if (viajeSelPre && kmLlegada < Number(viajeSelPre.km_salida)) {
      setErr(
        `Km final no puede ser menor al km de salida (${Number(viajeSelPre.km_salida).toLocaleString("es-GT")}).`,
      );
      return;
    }
    const vehLleg = viajeSelPre
      ? vehiculos.find((v) => v.id === viajeSelPre.vehiculo_id)
      : null;
    const kmActLleg = Number(
      vehLleg?.km_actual ?? viajeSelPre?.km_salida ?? 0,
    );
    if (kmLlegada < kmActLleg) {
      setErr(
        `Km final (${kmLlegada.toLocaleString("es-GT")}) no puede ser menor al km actual (${kmActLleg.toLocaleString("es-GT")}). Debe ser mayor o igual.`,
      );
      return;
    }
    if (esRutaConParadas) {
      if (!fotoTableroLlegada && rol === "Piloto") {
        setErr(
          "Toma la foto del tablero con el km final para cerrar la ruta.",
        );
        return;
      }
    } else if (!fotosLlegada.length && rol === "Piloto") {
      setErr(
        "Toma al menos una foto de llegada (se marcará fecha, hora y ubicación).",
      );
      return;
    }

    setSubiendoFotos(true);
    try {
      const geo = await obtenerGps();
      const viajeSel = abiertos.find((v) => v.id === viajeId);
      const placa = viajeSel?.placa ?? "";

      if (fotosLlegada.length) {
        const llegadaMarked = await marcarVarias(
          fotosLlegada,
          `LLEGADA${placa ? ` · ${placa}` : ""} · km ${kmLlegada}`,
          geo,
        );
        await subirEvidenciasViaje(viajeId, "llegada", llegadaMarked, geo);
      }
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
      setMsg(data.mensaje);
      setKmLlegada(0);
      setObsViaje("");
      setFotosLlegada([]);
      setFotoTableroLlegada(null);
      setParadasViaje([]);
      setPlanIdViaje(null);
      setViajeId(0);
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar llegada");
    } finally {
      setSubiendoFotos(false);
    }
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

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
        <>
          <label className="text-xs text-[var(--muted)]">
            Estado
            <select
              className={`${input} mt-1 block`}
              value={filtroEstado}
              onChange={(e) =>
                setFiltroEstado(e.target.value as typeof filtroEstado)
              }
            >
              <option value="todos">Todos (activos e inactivos)</option>
              <option value="activos">Solo activos</option>
              <option value="inactivos">Solo inactivos</option>
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Taller
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
        </>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Control de Flota / Predios</h1>
        <p className="text-sm text-[var(--muted)]">
          Búsqueda por placa, taller, edición, filtros/rin y exportación.
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
              const activo = esVehiculoActivo(v);
              return (
                <div
                  key={v.id}
                  className={[
                    "space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3",
                    activo ? "" : "opacity-70",
                  ].join(" ")}
                >
                  <div className="flex justify-between gap-2 border-b border-[var(--border)] pb-2">
                    <div>
                      <p className="font-mono text-sm font-bold text-sky-400">
                        {v.placa}
                      </p>
                      <p className="text-sm font-semibold">
                        {v.marca || "—"}
                        {v.modelo ? (
                          <span className="font-normal text-[var(--muted)]">
                            {" "}
                            · {v.modelo}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                          activo
                            ? "border border-emerald-700 bg-emerald-900/40 text-emerald-200"
                            : "border border-slate-600 bg-slate-800 text-slate-300"
                        }`}
                      >
                        {activo ? "Activo" : "Inactivo"}
                      </span>
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
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    Km {Number(v.km_actual ?? 0).toLocaleString("es-GT")} · Rin{" "}
                    {v.rin_llanta || "—"}
                    {(v.filtros ?? []).length
                      ? ` · ${(v.filtros ?? [])
                          .slice(0, 2)
                          .map((f) => `${f.tipo}:${f.codigo}`)
                          .join(" · ")}`
                      : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "vehiculos" && can("flota_vehiculos") ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--muted)]">
              Inventario de unidades · importar / exportar
            </p>
            <div className="flex flex-wrap gap-2">
              {can("flota_vehiculos", "crear") && rol !== "Piloto" ? (
                <label className="cursor-pointer rounded bg-[var(--accent-2)] px-3 py-2 text-sm text-white">
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
                    className="rounded bg-[var(--panel)] px-3 py-2 text-sm"
                    onClick={() => exportar("flota", "pdf")}
                  >
                    PDF flota
                  </button>
                </>
              ) : null}
            </div>
          </div>
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
                      setFiltrosForm([]);
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
                    ["modelo", "Modelo (año)"],
                    ["descripcion", "Descripción"],
                    ["color", "Color"],
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
                <label className="text-xs text-[var(--muted)]">
                  Estado
                  <select
                    className={`${input} mt-1 w-full`}
                    value={form.activo ? "1" : "0"}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        activo: e.target.value === "1",
                      }))
                    }
                  >
                    <option value="1">Activo</option>
                    <option value="0">Inactivo</option>
                  </select>
                </label>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--input)] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Tipos de filtros</p>
                    <p className="text-[11px] text-[var(--muted)]">
                      Ej. aceite, aire, combustible… y el código de tienda de
                      cada uno.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded bg-[#1e293b] px-2 py-1 text-xs text-sky-200"
                    onClick={() =>
                      setFiltrosForm((prev) => [
                        ...prev,
                        { tipo: "", codigo: "" },
                      ])
                    }
                  >
                    + Agregar filtro
                  </button>
                </div>
                {filtrosForm.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">
                    Sin filtros cargados. Usa «Agregar filtro».
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filtrosForm.map((f, idx) => (
                      <div
                        key={idx}
                        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                      >
                        <label className="text-[11px] text-[var(--muted)]">
                          Tipo
                          <input
                            list="tipos-filtro-flota"
                            className={`${input} mt-1 w-full`}
                            placeholder="Aceite / Aire / Combustible…"
                            value={f.tipo}
                            onChange={(e) =>
                              setFiltrosForm((prev) =>
                                prev.map((x, i) =>
                                  i === idx
                                    ? { ...x, tipo: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="text-[11px] text-[var(--muted)]">
                          Código tienda
                          <input
                            className={`${input} mt-1 w-full`}
                            placeholder="Ej. WIX 51348"
                            value={f.codigo}
                            onChange={(e) =>
                              setFiltrosForm((prev) =>
                                prev.map((x, i) =>
                                  i === idx
                                    ? { ...x, codigo: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="self-end rounded px-2 py-1 text-xs text-rose-300"
                          onClick={() =>
                            setFiltrosForm((prev) =>
                              prev.filter((_, i) => i !== idx),
                            )
                          }
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <datalist id="tipos-filtro-flota">
                  <option value="Aceite" />
                  <option value="Aire" />
                  <option value="Combustible" />
                  <option value="Habitáculo" />
                  <option value="Hidráulico" />
                  <option value="Separador de agua" />
                </datalist>
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
              <div className="flex flex-wrap items-center gap-2">
                <button className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white">
                  {editId ? "Guardar cambios" : "Registrar vehículo"}
                </button>
                {editId ? (
                  <>
                    <button
                      type="button"
                      className="rounded bg-violet-800 px-3 py-2 text-sm text-violet-100"
                      onClick={() => {
                        const v = vehiculos.find((x) => x.id === editId);
                        if (v) {
                          void cambiarActivoVehiculo(
                            v.id,
                            !esVehiculoActivo(v),
                          );
                        }
                      }}
                    >
                      {form.activo ? "Dar de baja" : "Reactivar"}
                    </button>
                    {can("flota_vehiculos", "eliminar") ? (
                      <button
                        type="button"
                        className="rounded bg-rose-800 px-3 py-2 text-sm text-rose-100"
                        onClick={() => {
                          const v = vehiculos.find((x) => x.id === editId);
                          if (v) void eliminarVehiculo(v);
                        }}
                      >
                        Eliminar
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </form>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#0d9488] text-white">
                <tr>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Marca</th>
                  <th className="px-3 py-2">Modelo</th>
                  <th className="px-3 py-2">Km</th>
                  <th className="px-3 py-2">Filtros</th>
                  <th className="px-3 py-2">Rin</th>
                  <th className="px-3 py-2">Taller</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {vehiculosFiltrados.map((v) => (
                  <tr
                    key={v.id}
                    className={[
                      "border-t border-[var(--border)]",
                      esVehiculoActivo(v) ? "" : "opacity-70",
                    ].join(" ")}
                  >
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
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                          esVehiculoActivo(v)
                            ? "bg-emerald-900/50 text-emerald-200"
                            : "bg-slate-700 text-slate-300"
                        }`}
                      >
                        {esVehiculoActivo(v) ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{v.descripcion ?? "—"}</td>
                    <td className="px-3 py-2">{v.marca || "—"}</td>
                    <td className="px-3 py-2">{v.modelo || "—"}</td>
                    <td className="px-3 py-2">
                      {Number(v.km_actual ?? 0).toLocaleString("es-GT")}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {(v.filtros ?? []).length ? (
                        <ul className="space-y-0.5">
                          {(v.filtros ?? []).map((f, i) => (
                            <li key={`${f.tipo}-${f.codigo}-${i}`}>
                              <span className="text-[var(--muted)]">
                                {f.tipo}:
                              </span>{" "}
                              {f.codigo}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "—"
                      )}
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
                          {v.esDueno !== false ? (
                            <>
                              <button
                                type="button"
                                className="text-violet-300 underline"
                                onClick={() =>
                                  void cambiarActivoVehiculo(
                                    v.id,
                                    !esVehiculoActivo(v),
                                  )
                                }
                              >
                                {esVehiculoActivo(v)
                                  ? "Dar de baja"
                                  : "Reactivar"}
                              </button>
                              {can("flota_vehiculos", "eliminar") ? (
                                <button
                                  type="button"
                                  className="text-rose-300 underline"
                                  onClick={() => void eliminarVehiculo(v)}
                                >
                                  Eliminar
                                </button>
                              ) : null}
                            </>
                          ) : null}
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
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted)]">
                No se permite unidad en taller ni el mismo piloto con viaje
                abierto. El km debe ser ≥ al actual.
                {rol === "Piloto"
                  ? " Foto del tablero obligatoria (marca fecha/hora/ubicación)."
                  : " Registro manual: la foto del tablero es opcional (obligatoria solo para piloto)."}
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
                        {v.placa} · km{" "}
                        {Number(v.km_actual ?? 0).toLocaleString("es-GT")}
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
                  min={Number(
                    vehiculos.find((v) => v.id === vehiculoId)?.km_actual ?? 0,
                  )}
                />
                <input
                  className={input}
                  placeholder="Conductor / piloto"
                  value={conductor}
                  onChange={(e) => setConductor(e.target.value)}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="text-xs text-[var(--muted)]">
                  Foto del tablero (km)
                  {rol === "Piloto" ? " *" : " (opc.)"}
                  <div className="mt-1">
                    <TomarFotoButton
                      label="Tomar foto tablero"
                      className={`${input} w-full !py-2 text-sm`}
                      hint={
                        fotoTableroLectura
                          ? `Listo: ${fotoTableroLectura.name}`
                          : rol === "Piloto"
                            ? "Solo cámara."
                            : "Opcional en registro manual."
                      }
                      onCaptured={async (file) => {
                        const n = await normalizarFotoCamara(file, "tablero");
                        setFotoTableroLectura(n);
                      }}
                    />
                  </div>
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Evidencias adicionales (opcional)
                  <div className="mt-1">
                    <TomarFotoButton
                      label="Tomar evidencia"
                      className={`${input} w-full !py-2 text-sm`}
                      hint={
                        fotosExtraLectura.length
                          ? `${fotosExtraLectura.length} foto(s)`
                          : "Solo cámara."
                      }
                      onCaptured={async (file) => {
                        const n = await normalizarFotoCamara(file, "extra");
                        if (n) {
                          setFotosExtraLectura((prev) => [...prev, n]);
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
              <button
                type="button"
                disabled={subiendoFotos}
                onClick={() => void registrarLectura()}
                className="rounded bg-[var(--accent-2)] px-3 py-1.5 text-sm disabled:opacity-40"
              >
                {subiendoFotos ? "Guardando fotos…" : "Guardar lectura"}
              </button>
            </div>
          ) : null}

          <div className="space-y-3">
            {lecturasFiltradas.map((l) => {
              const abierto = lecturaExpandida === l.id;
              const evs = lecturaEvidencias[l.id] ?? [];
              return (
                <div
                  key={l.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-base font-semibold text-sky-300">
                        {l.placa}
                        <span className="ml-2 text-sm font-normal text-[var(--fg)]">
                          {Number(l.km).toLocaleString("es-GT")} km
                        </span>
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {l.conductor || l.nota || "Sin conductor"}
                        {l.registrado_por ? ` · por ${l.registrado_por}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-[var(--muted)]">
                      {String(l.fecha_lectura).slice(0, 10)}
                      {l.capturado_en
                        ? ` · ${fmtFechaHora(String(l.capturado_en))}`
                        : ""}
                    </span>
                  </div>

                  <div className="mt-2 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2 lg:grid-cols-3">
                    {l.nota ? (
                      <p className="sm:col-span-2">
                        Nota:{" "}
                        <span className="text-[var(--fg)]">{l.nota}</span>
                      </p>
                    ) : null}
                    {l.viaje_id ? (
                      <p>
                        Viaje #{l.viaje_id}
                        {l.viaje_estado ? ` · ${l.viaje_estado}` : ""}
                        {l.viaje_destino ? ` · ${l.viaje_destino}` : ""}
                      </p>
                    ) : (
                      <p>Lectura manual (sin viaje)</p>
                    )}
                    {l.plan_codigo ? (
                      <p>
                        Plan TMS:{" "}
                        <span className="text-sky-300">{l.plan_codigo}</span>
                      </p>
                    ) : null}
                    {l.viaje_hora_salida ? (
                      <p>Salida: {fmtFechaHora(l.viaje_hora_salida)}</p>
                    ) : null}
                    {l.viaje_hora_llegada ? (
                      <p>Llegada: {fmtFechaHora(l.viaje_hora_llegada)}</p>
                    ) : null}
                    {l.latitud != null && l.longitud != null ? (
                      <p>
                        GPS: {Number(l.latitud).toFixed(5)},{" "}
                        {Number(l.longitud).toFixed(5)}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-2">
                    <button
                      type="button"
                      className="rounded bg-[#334155] px-2.5 py-1 text-xs text-white"
                      onClick={() => void verEvidenciasLectura(l.id)}
                    >
                      {abierto ? "Ocultar" : "Ver"} evidencias (
                      {l.evidencias ?? 0})
                    </button>
                  </div>

                  {abierto ? (
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                      {!evs.length ? (
                        <p className="text-xs text-[var(--muted)]">
                          {(l.evidencias ?? 0) > 0
                            ? "Cargando evidencias…"
                            : "Sin evidencias fotográficas en esta lectura."}
                        </p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {evs.map((ev) => (
                            <button
                              key={`${ev.origen ?? "lec"}-${ev.id}`}
                              type="button"
                              className="overflow-hidden rounded border border-[var(--border)] text-left hover:border-sky-600"
                              onClick={() => setFotoVista(ev)}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={ev.url}
                                alt={ev.nombre}
                                className="h-28 w-full object-cover bg-[var(--input)]"
                              />
                              <div className="space-y-0.5 p-1.5 text-[10px] text-[var(--muted)]">
                                <p className="font-medium text-sky-300">
                                  {labelTipoEvidencia(ev.tipo)}
                                </p>
                                <p>
                                  {fmtFechaHora(
                                    ev.capturadoEn
                                      ? String(ev.capturadoEn)
                                      : null,
                                  )}
                                </p>
                                {ev.latitud != null && ev.longitud != null ? (
                                  <p>
                                    GPS: {ev.latitud.toFixed(5)},{" "}
                                    {ev.longitud.toFixed(5)}
                                  </p>
                                ) : (
                                  <p>GPS: no disponible</p>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!lecturasFiltradas.length ? (
              <p className="text-sm text-[var(--muted)]">Sin lecturas.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "servicios" && can("flota_servicios") ? (
        <div className="space-y-6">
          {SearchBar}

          <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div>
              <h2 className="text-sm font-semibold">
                1. Vehículos en servicio / taller
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Unidades actualmente en mantenimiento o reparación
                {resumen ? (
                  <>
                    {" "}
                    · En taller: <strong>{resumen.enTaller}</strong>
                  </>
                ) : null}
              </p>
            </div>
            {vehiculosEnTaller.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2">Placa</th>
                      <th className="px-3 py-2">Km</th>
                      <th className="px-3 py-2">Entró</th>
                      <th className="px-3 py-2">Motivo</th>
                      <th className="px-3 py-2">Servicio</th>
                      <th className="px-3 py-2">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehiculosEnTaller.map((v) => {
                      const svc = servicios.find(
                        (s) =>
                          Number(s.vehiculo_id) === v.id &&
                          !s.fecha_salida_taller &&
                          s.tipo !== "compra",
                      );
                      return (
                        <tr
                          key={v.id}
                          className="border-t border-[var(--border)]"
                        >
                          <td className="px-3 py-2 font-mono">{v.placa}</td>
                          <td className="px-3 py-2">
                            {Number(v.km_actual ?? 0).toLocaleString("es-GT")}
                          </td>
                          <td className="px-3 py-2">
                            {v.fecha_entrada_taller
                              ? String(v.fecha_entrada_taller).slice(0, 10)
                              : "—"}
                          </td>
                          <td className="max-w-[10rem] truncate px-3 py-2 text-xs text-[var(--muted)]">
                            {v.motivo_taller || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {svc ? `#${svc.id} · ${svc.tipo}` : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="rounded bg-emerald-700 px-2 py-1 text-xs text-white"
                              onClick={() => {
                                setSacarVehiculoId(v.id);
                                setSacarKm(Number(v.km_actual ?? 0));
                                setSacarFecha(hoyLocal());
                                document
                                  .getElementById("seccion-sacar-servicio")
                                  ?.scrollIntoView({ behavior: "smooth" });
                              }}
                            >
                              Sacar de servicio
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No hay vehículos en taller ahora.
              </p>
            )}
          </section>

          <section
            id="seccion-sacar-servicio"
            className="space-y-3 rounded-xl border border-emerald-800/40 bg-[var(--card)] p-4"
          >
            <div>
              <h2 className="text-sm font-semibold">
                2. Sacar vehículo de servicio
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Vuelve la unidad a disponible y cierra el servicio abierto.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-[var(--muted)]">
                Vehículo en taller
                <select
                  className={`${input} mt-1 block min-w-[12rem]`}
                  value={sacarVehiculoId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setSacarVehiculoId(id);
                    const v = activos.find((x) => x.id === id);
                    if (v) setSacarKm(Number(v.km_actual ?? 0));
                  }}
                >
                  <option value={0}>— Elegir —</option>
                  {vehiculosEnTaller.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.placa}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--muted)]">
                Fecha salida
                <input
                  type="date"
                  className={`${input} mt-1 block`}
                  value={sacarFecha}
                  onChange={(e) => setSacarFecha(e.target.value)}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Km al salir
                <input
                  type="number"
                  className={`${input} mt-1 block w-32`}
                  value={sacarKm || ""}
                  onChange={(e) => setSacarKm(Number(e.target.value))}
                  min={0}
                />
              </label>
              <button
                type="button"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={!sacarVehiculoId}
                onClick={() => void sacarVehiculoDeServicio()}
              >
                Confirmar salida de taller
              </button>
            </div>
          </section>

          {can("flota_servicios", "crear") ? (
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">
                    3. Registrar servicio
                  </h2>
                  <p className="text-xs text-[var(--muted)]">
                  {editServicioId
                    ? `Editando servicio #${editServicioId}. Puedes corregir datos y agregar más facturas.`
                    : "No se puede registrar servicio si la unidad está en ruta. Escribe cada repuesto y pulsa Enter. Adjunta facturas PDF o imagen."}
                  </p>
                </div>
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
                        {(v.filtros ?? []).length
                          ? ` · ${(v.filtros ?? [])
                              .slice(0, 2)
                              .map((f) => f.codigo)
                              .join(",")}`
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
                        className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs"
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
                  Sacar de taller / volver a servicio al guardar
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

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">
                  4. Reportes de servicios
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  Historial y exportación Excel / PDF.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  className={input}
                  value={filtroHistorialServicios}
                  onChange={(e) =>
                    setFiltroHistorialServicios(
                      e.target.value as typeof filtroHistorialServicios,
                    )
                  }
                >
                  <option value="todos">Todos</option>
                  <option value="en_taller">Abiertos / en taller</option>
                  <option value="cerrados">Cerrados</option>
                  <option value="compras">Solo compras</option>
                </select>
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
                {!serviciosFiltrados.length ? (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-3 py-6 text-center text-sm text-[var(--muted)]"
                    >
                      Sin registros con este filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          </section>
        </div>
      ) : null}

      {tab === "compras" &&
      (can("flota_compras") || can("flota_servicios")) ? (
        <div className="space-y-4">
          {SearchBar}
          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-medium">Compras / facturas</p>
            <p className="text-xs text-[var(--muted)]">
              Enlaza la factura al vehículo en taller (servicio abierto) o
              registra una compra nueva para la unidad. PDF o imagen.
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                className={input}
                value={compraVehiculoId || vehiculoId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setCompraVehiculoId(id);
                  setVehiculoId(id);
                  setCompraServicioId(0);
                }}
              >
                <option value={0}>— Vehículo —</option>
                {activos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.placa}
                    {v.en_taller ? " · EN TALLER / SERVICIO" : ""}
                  </option>
                ))}
              </select>
              <select
                className={input}
                value={compraServicioId}
                onChange={(e) => setCompraServicioId(Number(e.target.value))}
              >
                <option value={0}>
                  Nueva compra (o elige servicio abierto)
                </option>
                {servicios
                  .filter(
                    (s) =>
                      Number(s.vehiculo_id) ===
                        (compraVehiculoId || vehiculoId) &&
                      !s.fecha_salida_taller,
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.id} · {s.tipo} ·{" "}
                      {String(s.fecha_servicio).slice(0, 10)} · en servicio
                    </option>
                  ))}
              </select>
            </div>
            {!compraServicioId ? (
              <div className="flex flex-wrap gap-2">
                <input
                  type="date"
                  className={input}
                  value={compraFecha}
                  onChange={(e) => setCompraFecha(e.target.value)}
                />
                <input
                  type="number"
                  className={`${input} w-28`}
                  placeholder="Costo Q"
                  value={compraCosto || ""}
                  onChange={(e) => setCompraCosto(Number(e.target.value))}
                  min={0}
                  step="0.01"
                />
                <input
                  className={`${input} min-w-[14rem] flex-1`}
                  placeholder="Descripción / proveedor / # factura"
                  value={compraDesc}
                  onChange={(e) => setCompraDesc(e.target.value)}
                />
              </div>
            ) : (
              <p className="text-xs text-emerald-600">
                Se adjuntará al servicio #{compraServicioId} del vehículo
                seleccionado (en taller).
              </p>
            )}
            <label className="block text-xs text-[var(--muted)]">
              Factura (PDF / imagen) *
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="mt-1 block w-full text-sm"
                onChange={(e) => setCompraFiles(e.target.files)}
              />
            </label>
            {(can("flota_compras", "crear") ||
              can("flota_servicios", "crear")) && (
              <button
                type="button"
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-medium text-white"
                onClick={() => void guardarCompraFactura()}
              >
                {compraServicioId
                  ? "Adjuntar factura al servicio"
                  : "Registrar compra + factura"}
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Detalle</th>
                  <th className="px-3 py-2">Costo</th>
                  <th className="px-3 py-2">Facturas</th>
                </tr>
              </thead>
              <tbody>
                {servicios
                  .filter(
                    (s) =>
                      s.tipo === "compra" ||
                      (s.adjuntos ?? 0) > 0 ||
                      Boolean(s.fecha_entrada_taller && !s.fecha_salida_taller),
                  )
                  .filter((s) =>
                    matchQ(s.placa, `${s.tipo} ${s.descripcion ?? ""}`),
                  )
                  .slice(0, 80)
                  .map((s) => (
                    <tr
                      key={s.id}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-3 py-2">
                        {String(s.fecha_servicio).slice(0, 10)}
                      </td>
                      <td className="px-3 py-2">
                        {s.placa}
                        {activos.find((v) => v.id === Number(s.vehiculo_id))
                          ?.en_taller
                          ? " · taller"
                          : ""}
                      </td>
                      <td className="px-3 py-2">{s.tipo}</td>
                      <td className="px-3 py-2 max-w-[14rem] truncate">
                        {s.descripcion || "—"}
                      </td>
                      <td className="px-3 py-2">
                        Q {Number(s.costo ?? 0).toLocaleString("es-GT")}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-[var(--accent-2)] underline"
                          onClick={() => void verAdjuntos(s.id, s.placa)}
                        >
                          {(s.adjuntos ?? 0) > 0
                            ? `Ver (${s.adjuntos})`
                            : "Sin factura"}
                        </button>
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
                      <div className="h-3 overflow-hidden rounded bg-[var(--input)]">
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

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-medium">Viajes del período</h2>
                <p className="text-xs text-[var(--muted)]">
                  {formatearFechaVisible(repDesde)} →{" "}
                  {formatearFechaVisible(repHasta)}
                  {q.trim() ? ` · filtro: ${q.trim()}` : ""} ·{" "}
                  {viajesReporteFiltrados.length} viaje(s)
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {viajesReporteFiltrados.slice(0, 50).map((v) => {
                const kmRec =
                  v.km_recorridos != null
                    ? v.km_recorridos
                    : v.km_llegada != null
                      ? v.km_llegada - v.km_salida
                      : null;
                const abierto = viajeExpandido === v.id;
                const evs = viajeEvidencias[v.id] ?? [];
                return (
                  <div
                    key={v.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-base font-semibold text-sky-300">
                          {v.placa}
                          <span className="ml-2 text-sm font-normal text-[var(--fg)]">
                            {v.piloto_nombre}
                          </span>
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {v.destino || "Sin destino"}
                          {v.es_externo ? " · externo" : ""}
                        </p>
                      </div>
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                          v.estado === "abierto"
                            ? "bg-amber-900/50 text-amber-200"
                            : "bg-emerald-900/40 text-emerald-200"
                        }`}
                      >
                        {v.estado}
                      </span>
                    </div>

                    <div className="mt-2 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2 lg:grid-cols-3">
                      <p>
                        Salida:{" "}
                        <span className="text-[var(--fg)]">
                          {fmtFechaHora(v.hora_salida)}
                        </span>
                      </p>
                      <p>
                        Llegada:{" "}
                        <span className="text-[var(--fg)]">
                          {fmtFechaHora(v.hora_llegada)}
                        </span>
                      </p>
                      <p>
                        Km:{" "}
                        <span className="text-[var(--fg)]">
                          {v.km_salida.toLocaleString("es-GT")}
                          {v.km_llegada != null
                            ? ` → ${v.km_llegada.toLocaleString("es-GT")}`
                            : ""}
                          {kmRec != null
                            ? ` (${kmRec.toLocaleString("es-GT")} km)`
                            : ""}
                        </span>
                      </p>
                      {v.plan_codigo ? (
                        <p>
                          Plan TMS:{" "}
                          <span className="text-sky-300">{v.plan_codigo}</span>
                          {v.plan_estado ? ` · ${v.plan_estado}` : ""}
                        </p>
                      ) : (
                        <p>Plan TMS: —</p>
                      )}
                      {v.plan_cliente ? (
                        <p>
                          Cliente plan:{" "}
                          <span className="text-[var(--fg)]">
                            {v.plan_cliente}
                          </span>
                        </p>
                      ) : null}
                      {v.observaciones ? (
                        <p className="sm:col-span-2">
                          Obs:{" "}
                          <span className="text-[var(--fg)]">
                            {v.observaciones}
                          </span>
                        </p>
                      ) : null}
                      {v.paradas?.length ? (
                        <div className="sm:col-span-2 lg:col-span-3">
                          <p className="mb-1 font-medium text-[var(--fg)]">
                            Paradas / evidencias producto
                            {v.paradasPendientes
                              ? ` · ${v.paradasPendientes} pendiente(s)`
                              : " · completas"}
                          </p>
                          <ul className="space-y-0.5">
                            {v.paradas.map((pp) => (
                              <li key={pp.id}>
                                {pp.orden}. {pp.lugar_nombre} ({pp.tipo}) —{" "}
                                {pp.evidencias > 0
                                  ? `${pp.evidencias} foto(s)`
                                  : pp.requiere_evidencia
                                    ? "sin evidencia"
                                    : "no requerida"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded bg-[#334155] px-2.5 py-1 text-xs text-white"
                        onClick={() => void verEvidenciasViaje(v.id)}
                      >
                        {abierto ? "Ocultar" : "Ver"} evidencias (
                        {v.evidencias ?? 0})
                      </button>
                      {rol === "Admin" && abierto ? (
                        <span className="text-[10px] text-rose-300/80">
                          Puedes eliminar evidencias (solo Admin)
                        </span>
                      ) : null}
                    </div>

                    {abierto ? (
                      <div className="mt-3 border-t border-[var(--border)] pt-3">
                        {!evs.length ? (
                          <p className="text-xs text-[var(--muted)]">
                            {(v.evidencias ?? 0) > 0
                              ? "Cargando evidencias…"
                              : "Sin evidencias fotográficas en este viaje."}
                          </p>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {evs.map((ev) => (
                              <div
                                key={`${ev.fuente ?? "flota"}-${ev.id}`}
                                className="overflow-hidden rounded border border-[var(--border)]"
                              >
                                <button
                                  type="button"
                                  className="w-full text-left hover:border-sky-600"
                                  onClick={() => setFotoVista(ev)}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={ev.url}
                                    alt={ev.nombre}
                                    className="h-28 w-full object-cover bg-[var(--input)]"
                                  />
                                  <div className="space-y-0.5 p-1.5 text-[10px] text-[var(--muted)]">
                                    <p className="font-medium text-sky-300">
                                      {labelTipoEvidencia(ev.tipo)}
                                    </p>
                                    <p>
                                      {fmtFechaHora(
                                        ev.capturadoEn
                                          ? String(ev.capturadoEn)
                                          : null,
                                      )}
                                    </p>
                                    {ev.latitud != null &&
                                    ev.longitud != null ? (
                                      <p>
                                        GPS: {ev.latitud.toFixed(5)},{" "}
                                        {ev.longitud.toFixed(5)}
                                      </p>
                                    ) : (
                                      <p>GPS: no disponible</p>
                                    )}
                                  </div>
                                </button>
                                {rol === "Admin" ? (
                                  <div className="border-t border-[var(--border)] p-1.5">
                                    <button
                                      type="button"
                                      className="w-full rounded bg-rose-900/60 px-2 py-1 text-[10px] text-rose-100 hover:bg-rose-800"
                                      onClick={() =>
                                        void eliminarEvidenciaAdmin(ev, v.id)
                                      }
                                    >
                                      Eliminar (Admin)
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!viajesReporteFiltrados.length ? (
                <p className="text-[var(--muted)]">
                  Sin viajes en el rango de fechas
                  {q.trim() ? " / filtro placa" : ""}.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {fotoVista ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setFotoVista(null)}
        >
          <div
            className="max-h-[90vh] max-w-3xl overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="text-xs text-[var(--muted)]">
                <p className="font-medium text-sky-300">
                  {labelTipoEvidencia(fotoVista.tipo)}
                </p>
                <p>{fotoVista.nombre}</p>
                <p>{fmtFechaHora(fotoVista.capturadoEn ? String(fotoVista.capturadoEn) : null)}</p>
                {fotoVista.latitud != null && fotoVista.longitud != null ? (
                  <p>
                    GPS: {fotoVista.latitud.toFixed(5)},{" "}
                    {fotoVista.longitud.toFixed(5)}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rol === "Admin" &&
                (fotoVista.fuente === "flota" ||
                  fotoVista.fuente === "tms" ||
                  fotoVista.url.includes("/flota/viajes/") ||
                  fotoVista.url.includes("/tms/")) ? (
                  <button
                    type="button"
                    className="rounded bg-rose-800 px-2 py-1 text-xs text-white"
                    onClick={() => void eliminarEvidenciaAdmin(fotoVista)}
                  >
                    Eliminar
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded bg-[#334155] px-2 py-1 text-xs text-white"
                  onClick={() => setFotoVista(null)}
                >
                  Cerrar
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fotoVista.url}
              alt={fotoVista.nombre}
              className="max-h-[75vh] w-full object-contain"
            />
          </div>
        </div>
      ) : null}

      {tab === "piloto" && can("flota_piloto") ? (
        <div className="space-y-4">
          {SearchBar}

          {rol === "Piloto" && !pilotoSesionConfirmado ? (
            <div className="space-y-3 rounded-xl border border-sky-700 bg-sky-950/30 p-4">
              <h2 className="font-medium text-sky-100">
                ¿Quién está operando?
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Cuenta compartida de pilotos. Escribe tu nombre (RRHH o
                externo autorizado). Solo verás y cerrarás tus propios viajes.
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${input} min-w-[220px] flex-1`}
                  placeholder="Tu nombre completo"
                  value={pilotoSesionDraft}
                  onChange={(e) => setPilotoSesionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmarPilotoSesion();
                    }
                  }}
                />
                <button
                  type="button"
                  className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white"
                  onClick={() => confirmarPilotoSesion()}
                >
                  Continuar
                </button>
              </div>
            </div>
          ) : null}

          {pilotoSesionConfirmado ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 text-sm">
              <p>
                Operando como:{" "}
                <strong className="text-emerald-200">{pilotoSesion}</strong>
                {abiertosDelPiloto.length
                  ? ` · ${abiertosDelPiloto.length} viaje(s) tuyo(s) abierto(s)`
                  : " · sin viajes abiertos tuyos"}
              </p>
              <button
                type="button"
                className="text-xs text-sky-300 underline"
                onClick={() => cambiarPilotoSesion()}
              >
                Cambiar piloto
              </button>
            </div>
          ) : rol !== "Piloto" ? (
            <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
              <p className="text-xs text-[var(--muted)]">
                Identifica al piloto (recomendado en tablet compartida):
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${input} min-w-[200px] flex-1`}
                  placeholder="Nombre del piloto de este turno"
                  value={pilotoSesionDraft}
                  onChange={(e) => setPilotoSesionDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
                  onClick={() => confirmarPilotoSesion()}
                >
                  Usar este nombre
                </button>
              </div>
            </div>
          ) : null}

          <div
            className={[
              "rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-4",
              rol === "Piloto" && !pilotoSesionConfirmado
                ? "pointer-events-none opacity-40"
                : "",
            ].join(" ")}
          >
            {pilotoEnViaje ? (
              <p className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
                Ya tienes viaje abierto
                {abiertosDelPiloto[0]
                  ? ` (${abiertosDelPiloto[0].placa}${
                      abiertosDelPiloto[0].destino
                        ? ` → ${abiertosDelPiloto[0].destino}`
                        : ""
                    })`
                  : ""}
                . Salida bloqueada: completa evidencias de la ruta, km final y
                foto del tablero para cerrar.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {!pilotoEnViaje ? (
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
              ) : (
                <button
                  type="button"
                  disabled
                  title="Cierra tu viaje actual antes de una nueva salida"
                  className="cursor-not-allowed rounded px-3 py-1.5 text-sm opacity-40 bg-[#334155]"
                >
                  Registrar salida (bloqueada)
                </button>
              )}
              <button
                type="button"
                className={[
                  "rounded px-3 py-1.5 text-sm",
                  modoPiloto === "llegada"
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[#334155]",
                ].join(" ")}
                onClick={() => {
                  setModoPiloto("llegada");
                  setQLlegada("");
                  const lista = pilotoSesionConfirmado
                    ? abiertosDelPiloto
                    : abiertos;
                  if (lista[0] && !viajeId) setViajeId(lista[0].id);
                }}
              >
                Registrar llegada
              </button>
            </div>

            {modoPiloto === "salida" && !pilotoEnViaje ? (
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
                      min={(() => {
                        const p = placaSalida
                          .trim()
                          .toUpperCase()
                          .replace(/[\s-]/g, "");
                        const v = vehiculos.find(
                          (x) =>
                            x.placa.toUpperCase().replace(/[\s-]/g, "") === p,
                        );
                        return Number(v?.km_actual ?? 0);
                      })()}
                    />
                    {(() => {
                      const p = placaSalida
                        .trim()
                        .toUpperCase()
                        .replace(/[\s-]/g, "");
                      const v = vehiculos.find(
                        (x) =>
                          x.placa.toUpperCase().replace(/[\s-]/g, "") === p,
                      );
                      if (!v) return null;
                      return (
                        <span className="mt-0.5 block text-[11px]">
                          Km actual de la unidad:{" "}
                          {Number(v.km_actual ?? 0).toLocaleString("es-GT")}{" "}
                          (debe ser ≥)
                        </span>
                      );
                    })()}
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
                            <div className="rounded border border-sky-900/60 bg-[var(--input)]/60 p-2 text-[11px] text-[var(--muted)] space-y-0.5">
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
                              {p.paradas?.length ? (
                                <div className="mt-1 border-t border-sky-900/50 pt-1">
                                  <p className="font-medium text-amber-200">
                                    Ruta detectada: {p.paradas.length} destino(s)
                                  </p>
                                  <p className="text-[10px] text-[var(--muted)]">
                                    Km solo al salir. En cada destino solo
                                    evidencia de producto (sin kilometraje).
                                  </p>
                                  {p.paradas.map((pp) => (
                                    <p key={pp.id}>
                                      {pp.orden}. {pp.lugar_nombre} ({pp.tipo})
                                      {pp.requiere_evidencia
                                        ? " · evidencia obligatoria"
                                        : ""}
                                    </p>
                                  ))}
                                </div>
                              ) : null}
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
                  <div className="text-xs text-[var(--muted)]">
                    Foto del tablero (km)
                    {rol === "Piloto" ? " *" : " (opc.)"}
                    <div className="mt-1">
                      <TomarFotoButton
                        label="Tomar foto tablero"
                        className={`${input} w-full !py-2 text-sm`}
                        hint={
                          fotoTableroSalida
                            ? `Listo: ${fotoTableroSalida.name}`
                            : rol === "Piloto"
                              ? "Obligatoria. Solo cámara (fecha/hora/GPS)."
                              : "Opcional si registras el viaje de forma manual."
                        }
                        onCaptured={async (file) => {
                          const n = await normalizarFotoCamara(file, "tablero");
                          setFotoTableroSalida(n);
                        }}
                      />
                    </div>
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    Evidencia de salida (opcional)
                    <div className="mt-1">
                      <TomarFotoButton
                        label="Tomar evidencia"
                        className={`${input} w-full !py-2 text-sm`}
                        hint={
                          fotosEvidenciaSalida.length
                            ? `${fotosEvidenciaSalida.length} foto(s) · toca para agregar otra`
                            : "Unidad, carga, etc. Solo cámara."
                        }
                        onCaptured={async (file) => {
                          const n = await normalizarFotoCamara(file, "salida");
                          if (n) {
                            setFotosEvidenciaSalida((prev) => [...prev, n]);
                          }
                        }}
                      />
                    </div>
                  </div>
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
                  <h3 className="mb-1 text-sm font-medium">
                    Viajes abiertos
                    {esVistaPilotoRestringida ? " (tuyos)" : ""}
                  </h3>
                  <ul className="space-y-1 text-xs text-[var(--muted)]">
                    {abiertosDelPiloto.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          className="text-left hover:text-sky-300"
                          onClick={() => {
                            setViajeId(v.id);
                            setModoPiloto("llegada");
                          }}
                        >
                          <span className="font-mono text-sky-300">
                            {v.placa}
                          </span>{" "}
                          · {v.piloto_nombre} · km salida{" "}
                          {Number(v.km_salida).toLocaleString("es-GT")}
                          {v.destino ? ` · ${v.destino}` : ""}
                          {v.plan_id ? " · con ruta/paradas" : ""}
                          {v.es_externo ? " · externo" : ""}
                          <span className="ml-1 text-[10px] text-sky-400">
                            → evidencias / cerrar
                          </span>
                        </button>
                      </li>
                    ))}
                    {!abiertosDelPiloto.length ? (
                      <li>
                        {rol === "Piloto" && !pilotoSesionConfirmado
                          ? "Identifícate arriba para ver solo tus viajes."
                          : "Ningún viaje abierto tuyo."}
                      </li>
                    ) : null}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[var(--muted)]">
                  Elige el viaje abierto por placa o nombre del piloto (incluye
                  externos). Si no ves ninguno, limpia la búsqueda.
                </p>
                <label className="block text-xs text-[var(--muted)]">
                  Buscar viaje por placa o nombre del piloto
                  <div className="mt-1 flex gap-2">
                    <input
                      className={`${input} w-full`}
                      value={qLlegada}
                      autoComplete="off"
                      name="buscar-viaje-llegada"
                      onChange={(e) => {
                        const val = e.target.value;
                        setQLlegada(val);
                        const s = val.trim().toLowerCase();
                        if (!s) {
                          if (abiertos[0]) setViajeId(abiertos[0].id);
                          return;
                        }
                        const hit = abiertos.find((v) => {
                          const placa = v.placa
                            .toLowerCase()
                            .replace(/[\s-]/g, "");
                          const qPlaca = s.replace(/[\s-]/g, "");
                          return (
                            v.placa.toLowerCase().includes(s) ||
                            placa.includes(qPlaca) ||
                            v.piloto_nombre.toLowerCase().includes(s) ||
                            (v.destino ?? "").toLowerCase().includes(s)
                          );
                        });
                        if (hit) setViajeId(hit.id);
                      }}
                      placeholder="Ej. C-015BNG o Walter"
                    />
                    {qLlegada.trim() ? (
                      <button
                        type="button"
                        className="shrink-0 rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
                        onClick={() => {
                          setQLlegada("");
                          if (abiertos[0]) setViajeId(abiertos[0].id);
                        }}
                      >
                        Limpiar
                      </button>
                    ) : null}
                  </div>
                </label>

                {(pilotoSesionConfirmado
                  ? abiertosDelPiloto
                  : abiertos
                ).length ? (
                  <ul className="space-y-1 rounded-lg border border-[var(--border)] p-2 text-xs">
                    {(pilotoSesionConfirmado
                      ? abiertosDelPiloto
                      : abiertos
                    ).map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          className={[
                            "w-full rounded px-2 py-1.5 text-left",
                            viajeId === v.id
                              ? "bg-sky-950/50 text-sky-200"
                              : "hover:bg-white/5 text-[var(--muted)]",
                          ].join(" ")}
                          onClick={() => {
                            setViajeId(v.id);
                            setQLlegada("");
                          }}
                        >
                          <span className="font-mono text-sky-300">
                            {v.placa}
                          </span>{" "}
                          · {v.piloto_nombre}
                          {Number(v.es_externo) ? " · externo" : ""}
                          {" · km "}
                          {Number(v.km_salida).toLocaleString("es-GT")}
                          {v.destino ? ` · ${v.destino}` : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-amber-300">
                    {pilotoSesionConfirmado
                      ? `No hay viajes abiertos de ${pilotoSesion}.`
                      : "No hay viajes abiertos. Registra primero la salida."}
                  </p>
                )}

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs text-[var(--muted)] sm:col-span-2">
                    Viaje abierto
                    <select
                      className={`${input} mt-1 w-full`}
                      value={viajeId || ""}
                      onChange={(e) => setViajeId(Number(e.target.value))}
                    >
                      {!abiertosFiltrados.length ? (
                        <option value="">Sin viajes abiertos</option>
                      ) : null}
                      {abiertosFiltrados.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.placa} · {v.piloto_nombre}
                          {Number(v.es_externo) ? " (externo)" : ""} · km{" "}
                          {v.km_salida}
                          {v.destino ? ` → ${v.destino}` : ""}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">
                      {abiertosFiltrados.length
                        ? `${abiertosFiltrados.length} viaje(s) visible(s)`
                        : "Ningún viaje abierto"}
                      {pilotoSesionConfirmado
                        ? ` de ${pilotoSesion}`
                        : ""}
                    </span>
                  </label>
                  {paradasViaje.length === 0 ? (
                    <label className="text-xs text-[var(--muted)]">
                      Km llegada
                      <input
                        type="number"
                        className={`${input} mt-1 w-full`}
                        value={kmLlegada || ""}
                        onChange={(e) => setKmLlegada(Number(e.target.value))}
                      />
                    </label>
                  ) : (
                    <p className="text-[11px] text-amber-200 sm:col-span-1">
                      Km salida:{" "}
                      {abiertos.find((v) => v.id === viajeId)?.km_salida != null
                        ? Number(
                            abiertos.find((v) => v.id === viajeId)!.km_salida,
                          ).toLocaleString("es-GT")
                        : "—"}
                      . En destinos solo foto de producto; al terminar la ruta
                      pide km final + foto tablero.
                    </p>
                  )}
                  <label className="text-xs text-[var(--muted)] sm:col-span-2">
                    Observaciones
                    <input
                      className={`${input} mt-1 w-full`}
                      value={obsViaje}
                      onChange={(e) => setObsViaje(e.target.value)}
                    />
                  </label>

                  {paradasViaje.length ? (
                    <div className="sm:col-span-2 lg:col-span-3 space-y-2 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
                      <p className="text-xs font-medium text-amber-100">
                        Ruta detectada: {paradasViaje.length} destino(s) —
                        evidencia de producto en cada uno
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        En cada lugar toma la foto del producto con la cámara
                        (fecha/hora/GPS). Sin km en destinos. Al completar todos,
                        ingresa km final y foto del tablero abajo.
                      </p>
                      {paradasViaje.map((pp) => {
                        const ok =
                          !pp.requiere_evidencia || pp.evidencias > 0;
                        return (
                          <div
                            key={pp.id}
                            className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] bg-[var(--input)]/50 p-2"
                          >
                            <div className="min-w-[140px] flex-1 text-xs">
                              <p className="font-medium text-[var(--fg)]">
                                {pp.orden}. {pp.lugar_nombre}
                              </p>
                              <p className="text-[var(--muted)]">
                                {pp.tipo}
                                {ok
                                  ? ` · ${pp.evidencias} evidencia(s)`
                                  : " · pendiente"}
                              </p>
                            </div>
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                                ok
                                  ? "bg-emerald-900/50 text-emerald-200"
                                  : "bg-amber-900/50 text-amber-200"
                              }`}
                            >
                              {ok ? "OK" : "Falta foto"}
                            </span>
                            <TomarFotoButton
                              label={ok ? "Otra foto" : "Tomar foto"}
                              disabled={subiendoFotos}
                              onCaptured={(file) =>
                                subirEvidenciaParada(pp.id, file)
                              }
                            />
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        className="text-[11px] text-sky-300 underline"
                        onClick={() => void cargarParadasViaje(viajeId)}
                      >
                        Actualizar estado de la ruta
                      </button>
                    </div>
                  ) : planIdViaje === null && viajeId ? (
                    <p className="sm:col-span-2 text-[11px] text-[var(--muted)]">
                      Este viaje no tiene plan/ruta con paradas. Se pide km y
                      foto de llegada.
                    </p>
                  ) : null}

                  {paradasViaje.length === 0 ? (
                    <>
                      <div className="text-xs text-[var(--muted)] sm:col-span-2">
                        Foto de llegada * (fecha, hora y ubicación)
                        <div className="mt-1">
                          <TomarFotoButton
                            label="Tomar foto de llegada"
                            className={`${input} w-full !py-2 text-sm`}
                            hint={
                              fotosLlegada.length
                                ? `${fotosLlegada.length} foto(s) · toca para agregar otra`
                                : "Solo cámara en vivo, no galería."
                            }
                            onCaptured={async (file) => {
                              const n = await normalizarFotoCamara(
                                file,
                                "llegada",
                              );
                              if (n) {
                                setFotosLlegada((prev) => [...prev, n]);
                              }
                            }}
                          />
                        </div>
                      </div>
                      <div className="text-xs text-[var(--muted)] sm:col-span-2">
                        Foto tablero km llegada (opcional)
                        <div className="mt-1">
                          <TomarFotoButton
                            label="Tomar foto tablero"
                            className={`${input} w-full !py-2 text-sm`}
                            hint={
                              fotoTableroLlegada
                                ? `Listo: ${fotoTableroLlegada.name}`
                                : "Solo cámara."
                            }
                            onCaptured={async (file) => {
                              const n = await normalizarFotoCamara(
                                file,
                                "tablero_llegada",
                              );
                              setFotoTableroLlegada(n);
                            }}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-2 lg:col-span-3 space-y-3 rounded-lg border border-sky-800/40 bg-sky-950/20 p-3">
                      <p className="text-xs font-medium text-sky-100">
                        Cierre de ruta (después de todas las paradas)
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        Cuando todas las paradas estén en OK, ingresa el km
                        final del odómetro
                        {rol === "Piloto"
                          ? " y toma la foto del tablero."
                          : ". La foto del tablero es opcional en registro manual."}
                      </p>
                      <label className="block text-xs text-[var(--muted)]">
                        Km final *
                        <input
                          type="number"
                          className={`${input} mt-1 w-full max-w-xs`}
                          value={kmLlegada || ""}
                          min={
                            abiertos.find((v) => v.id === viajeId)?.km_salida ??
                            0
                          }
                          onChange={(e) =>
                            setKmLlegada(Number(e.target.value))
                          }
                          placeholder="Odómetro al terminar"
                        />
                      </label>
                      <div className="text-xs text-[var(--muted)]">
                        Foto tablero km final
                        {rol === "Piloto" ? " *" : " (opc.)"}
                        <div className="mt-1 max-w-xs">
                          <TomarFotoButton
                            label="Tomar foto tablero final"
                            className={`${input} w-full !py-2 text-sm`}
                            hint={
                              fotoTableroLlegada
                                ? `Listo: ${fotoTableroLlegada.name}`
                                : "Obligatoria. Solo cámara."
                            }
                            onCaptured={async (file) => {
                              const n = await normalizarFotoCamara(
                                file,
                                "tablero_llegada",
                              );
                              setFotoTableroLlegada(n);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="rounded bg-[#1F6AA5] px-4 py-2 text-sm text-white disabled:opacity-40"
                      disabled={
                        !abiertosFiltrados.length ||
                        !viajeId ||
                        subiendoFotos ||
                        (paradasViaje.length > 0 &&
                          paradasViaje.some(
                            (p) => p.requiere_evidencia && p.evidencias < 1,
                          ))
                      }
                      onClick={() => void llegadaViaje()}
                    >
                      {subiendoFotos
                        ? "Guardando…"
                        : paradasViaje.length
                          ? "Cerrar ruta"
                          : "Guardar llegada"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">
                  Viajes recientes
                  {esVistaPilotoRestringida ? " (tuyos)" : ""}
                </h3>
                {rol !== "Piloto" ? (
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
                ) : null}
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
                {!viajesFiltrados.length ? (
                  <li>
                    {rol === "Piloto" && !pilotoSesionConfirmado
                      ? "Identifícate para ver tu historial."
                      : "Sin viajes tuyos."}
                  </li>
                ) : null}
              </ul>
            </div>

            {permisosExtVisibles.length ? (
              <div className="rounded-lg border border-[var(--border)] p-3">
                <h3 className="mb-2 text-sm font-medium">
                  Permisos conductores externos
                  {rol === "Piloto" ? " (tuyos)" : ""}
                </h3>
                <ul className="space-y-2 text-xs">
                  {permisosExtVisibles.slice(0, 15).map((p) => (
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
