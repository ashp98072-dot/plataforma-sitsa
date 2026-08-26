"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { DocumentosModal } from "@/components/rrhh/documentos-modal";
import { PortalAccesoModal } from "@/components/rrhh/portal-acceso-modal";
import { BitacoraLegalEmpleado } from "@/components/rrhh/bitacora-legal-empleado";
import { ImportErroresLista } from "@/components/import-errores-lista";
import { formatearFechaVisible, hoyLocal } from "@/lib/rrhh/dates";
import { CATEGORIAS_OPS, PUESTOS_MONACO } from "@/lib/rrhh/categorias-ops";
import { faltantesAlta } from "@/lib/rrhh/empleado-validacion";
import {
  FORMAS_PAGO,
  TIPOS_CONTRATO,
  normalizarFormaPago,
  normalizarTipoContrato,
  type FormaPago,
  type TipoContrato,
} from "@/lib/rrhh/contratos-pago";

type Emp = {
  id: number;
  numeroEmpleado?: string;
  codigo: string;
  nombre: string;
  puesto?: string;
  categoriaOps?: string;
  tipoHorario?: string;
  fechaAlta?: string;
  fechaInicioLaboral?: string | null;
  horaEntradaTeorica?: string;
  horaSalidaTeorica?: string;
  estado?: string;
  docsCount?: number;
  dpi?: string;
  nit?: string;
  igss?: string;
  irtra?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  sexo?: string;
  fechaNacimiento?: string | null;
  tipoContrato?: string;
  formaPago?: string;
  sueldoBase?: number | null;
  bonoIncentivo?: number | null;
  bonoHerramientas?: number | null;
  profesion?: string;
  primerNombre?: string;
  segundoNombre?: string;
  tercerNombre?: string;
  cuartoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  apellidoCasada?: string;
  paisOrigen?: string;
  municipio?: string;
  etnia?: string;
  religion?: string;
  idioma?: string;
  licenciaNumero?: string;
  licenciaTipo?: string;
  licenciaVence?: string | null;
  fechaEgreso?: string | null;
  observaciones?: string;
  cuentaBancaria?: string;
  tipoCuenta?: string;
  banco?: string;
  contactoEmergencia?: string;
  /** Fase H1: elegibilidad individual de horas extra. Solo RRHH/admin la cambia. */
  horasExtraHabilitado?: boolean;
  supervisorId?: number | null;
  supervisorNombre?: string | null;
};

/** Fila de empleado_supervisores (vía GET /empleados/[id]) — múltiples supervisores. */
type SupervisorInfo = {
  id: number;
  nombre: string;
  numeroEmpleado?: string;
  codigo: string;
};

type EmpleadoCambio = {
  id: number;
  campo: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
  registradoPor: string | null;
  creadoAt: string;
};

type LicenciaTipo = "" | "A" | "B" | "C" | "M";

type FormState = {
  codigo: string;
  primerNombre: string;
  segundoNombre: string;
  tercerNombre: string;
  cuartoNombre: string;
  primerApellido: string;
  segundoApellido: string;
  apellidoCasada: string;
  nombre: string;
  nombreManual: boolean;
  dpi: string;
  nit: string;
  igss: string;
  irtra: string;
  sexo: string;
  fechaNacimiento: string;
  puesto: string;
  categoriaOps: string;
  tipoContrato: TipoContrato;
  formaPago: FormaPago;
  profesion: string;
  tipoHorario: "Fijo" | "Variable";
  fechaAlta: string;
  fechaInicioLaboral: string;
  fechaEgreso: string;
  horaEntradaTeorica: string;
  horaSalidaTeorica: string;
  estado: "Activo" | "Baja";
  supervisorIds: number[];
  horasExtraHabilitado: boolean;
  sueldoBase: string;
  bonoIncentivo: string;
  bonoHerramientas: string;
  telefono: string;
  email: string;
  direccion: string;
  licenciaNumero: string;
  licenciaTipo: LicenciaTipo;
  licenciaVence: string;
  paisOrigen: string;
  municipio: string;
  etnia: string;
  religion: string;
  idioma: string;
  cuentaBancaria: string;
  tipoCuenta: string;
  banco: string;
  contactoEmergencia: string;
  observaciones: string;
};

function horaCortaCfg(v: string | undefined, fallback: string): string {
  const s = String(v ?? "").trim();
  if (!s) return fallback;
  return s.slice(0, 5);
}

function componerNombre(f: Pick<
  FormState,
  | "primerNombre"
  | "segundoNombre"
  | "tercerNombre"
  | "cuartoNombre"
  | "primerApellido"
  | "segundoApellido"
  | "apellidoCasada"
  | "nombre"
>): string {
  const nombres = [
    f.primerNombre,
    f.segundoNombre,
    f.tercerNombre,
    f.cuartoNombre,
  ]
    .map((x) => x.trim())
    .filter(Boolean);
  const apellidos = [
    f.primerApellido,
    f.segundoApellido,
    f.apellidoCasada,
  ]
    .map((x) => x.trim())
    .filter(Boolean);
  const full = [...nombres, ...apellidos].join(" ").replace(/\s+/g, " ").trim();
  return full || f.nombre.trim();
}

function emptyForm(entrada = "08:00", salida = "17:00"): FormState {
  return {
    codigo: "",
    primerNombre: "",
    segundoNombre: "",
    tercerNombre: "",
    cuartoNombre: "",
    primerApellido: "",
    segundoApellido: "",
    apellidoCasada: "",
    nombre: "",
    nombreManual: false,
    dpi: "",
    nit: "",
    igss: "",
    irtra: "",
    sexo: "",
    fechaNacimiento: "",
    puesto: "",
    categoriaOps: "",
    tipoContrato: "fijo",
    formaPago: "transferencia",
    profesion: "",
    tipoHorario: "Fijo",
    fechaAlta: hoyLocal(),
    fechaInicioLaboral: "",
    fechaEgreso: "",
    horaEntradaTeorica: entrada,
    horaSalidaTeorica: salida,
    estado: "Activo",
    supervisorIds: [],
    horasExtraHabilitado: false,
    sueldoBase: "",
    bonoIncentivo: "",
    bonoHerramientas: "",
    telefono: "",
    email: "",
    direccion: "",
    licenciaNumero: "",
    licenciaTipo: "",
    licenciaVence: "",
    paisOrigen: "",
    municipio: "",
    etnia: "",
    religion: "",
    idioma: "",
    cuentaBancaria: "",
    tipoCuenta: "",
    banco: "",
    contactoEmergencia: "",
    observaciones: "",
  };
}

function empToForm(
  e: Emp,
  horaDef: { entrada: string; salida: string },
  supervisorIds: number[] = [],
): FormState {
  const licencia = e.licenciaTipo ?? "";
  return {
    codigo: e.codigo,
    primerNombre: e.primerNombre ?? "",
    segundoNombre: e.segundoNombre ?? "",
    tercerNombre: e.tercerNombre ?? "",
    cuartoNombre: e.cuartoNombre ?? "",
    primerApellido: e.primerApellido ?? "",
    segundoApellido: e.segundoApellido ?? "",
    apellidoCasada: e.apellidoCasada ?? "",
    nombre: e.nombre,
    nombreManual: true,
    dpi: e.dpi ?? "",
    nit: e.nit ?? "",
    igss: e.igss ?? "",
    irtra: e.irtra ?? "",
    sexo: e.sexo ?? "",
    fechaNacimiento: e.fechaNacimiento ?? "",
    puesto: e.puesto ?? "",
    categoriaOps: e.categoriaOps ?? "",
    tipoContrato: normalizarTipoContrato(e.tipoContrato),
    formaPago: normalizarFormaPago(e.formaPago),
    profesion: e.profesion ?? "",
    tipoHorario: e.tipoHorario === "Variable" ? "Variable" : "Fijo",
    fechaAlta: e.fechaAlta || hoyLocal(),
    fechaInicioLaboral: e.fechaInicioLaboral ?? "",
    fechaEgreso: e.fechaEgreso ?? "",
    horaEntradaTeorica: (e.horaEntradaTeorica || `${horaDef.entrada}:00`).slice(
      0,
      5,
    ),
    horaSalidaTeorica: (e.horaSalidaTeorica || `${horaDef.salida}:00`).slice(
      0,
      5,
    ),
    estado: e.estado === "Baja" ? "Baja" : "Activo",
    supervisorIds,
    horasExtraHabilitado: e.horasExtraHabilitado ?? false,
    sueldoBase: e.sueldoBase != null ? String(e.sueldoBase) : "",
    bonoIncentivo: e.bonoIncentivo != null ? String(e.bonoIncentivo) : "",
    bonoHerramientas:
      e.bonoHerramientas != null ? String(e.bonoHerramientas) : "",
    telefono: e.telefono ?? "",
    email: e.email ?? "",
    direccion: e.direccion ?? "",
    licenciaNumero: e.licenciaNumero ?? "",
    licenciaTipo: (["A", "B", "C", "M"].includes(licencia)
      ? licencia
      : "") as LicenciaTipo,
    licenciaVence: e.licenciaVence ?? "",
    paisOrigen: e.paisOrigen ?? "",
    municipio: e.municipio ?? "",
    etnia: e.etnia ?? "",
    religion: e.religion ?? "",
    idioma: e.idioma ?? "",
    cuentaBancaria: e.cuentaBancaria ?? "",
    tipoCuenta: e.tipoCuenta ?? "",
    banco: e.banco ?? "",
    contactoEmergencia: e.contactoEmergencia ?? "",
    observaciones: e.observaciones ?? "",
  };
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function formToBody(form: FormState) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- campo exclusivo de UI
  const { nombreManual: _nm, ...rest } = form;
  return {
    ...rest,
    nombre: rest.nombre.trim() || componerNombre(rest),
    fechaInicioLaboral: rest.fechaInicioLaboral || null,
    fechaNacimiento: rest.fechaNacimiento || null,
    licenciaVence: rest.licenciaVence || null,
    fechaEgreso: rest.fechaEgreso || null,
    sueldoBase: parseNum(rest.sueldoBase),
    bonoIncentivo: parseNum(rest.bonoIncentivo),
    bonoHerramientas: parseNum(rest.bonoHerramientas),
    licenciaTipo: rest.licenciaTipo || "",
    supervisorIds: rest.supervisorIds,
  };
}

function FieldLabel({
  children,
  required,
  hint,
}: {
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <span className="block">
      <span className="text-sm text-[var(--muted)]">
        {children}
        {required ? (
          <span className="ml-0.5 text-red-500" title="Obligatorio">
            *
          </span>
        ) : (
          <span className="ml-1 text-[10px] opacity-60">(opc.)</span>
        )}
      </span>
      {hint ? (
        <span className="mt-0.5 block text-[10px] opacity-80">{hint}</span>
      ) : null}
    </span>
  );
}

function FormSection({
  title,
  open,
  onToggle,
  children,
  hint,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--nav-hover)]"
      >
        <span
          className={[
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-xs text-[var(--muted)]",
            open ? "bg-[var(--accent)] text-white border-transparent" : "",
          ].join(" ")}
          aria-hidden
        >
          {open ? "−" : "+"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--text)]">
            {title}
          </span>
          {hint ? (
            <span className="block text-[11px] text-[var(--muted)]">{hint}</span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border)] px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {children}
          </div>
        </div>
      ) : null}
    </section>
  );
}

type SeccionFicha =
  | "identidad"
  | "laboral"
  | "salarios"
  | "contacto"
  | "licencia"
  | "otros";

export default function EmpleadosPage() {
  const slug = String(useParams().slug);
  const searchParams = useSearchParams();
  const entrevistaId = searchParams.get("entrevista");
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  // Activos de la empresa para buscar/agregar Supervisor(es) — independiente
  // de los filtros de búsqueda/estado de la tabla (esos sí acotan `empleados`).
  const [supervisoresDisponibles, setSupervisoresDisponibles] = useState<Emp[]>([]);
  // Texto de búsqueda por nombre/código para el selector múltiple de supervisor.
  const [supervisorBusqueda, setSupervisorBusqueda] = useState("");
  // id -> "numeroEmpleado — nombre" para mostrar los chips seleccionados,
  // incluyendo supervisores ya asignados que ya no estén Activos (no
  // aparecerían en supervisoresDisponibles, que solo trae Activos).
  const [supervisorLabels, setSupervisorLabels] = useState<Record<number, string>>({});
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroPago, setFiltroPago] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [horaDef, setHoraDef] = useState({ entrada: "07:00", salida: "16:00" });
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [editId, setEditId] = useState<number | null>(null);
  const [historial, setHistorial] = useState<EmpleadoCambio[]>([]);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [erroresImport, setErroresImport] = useState<string[]>([]);
  const [importando, setImportando] = useState(false);
  const [docsEmp, setDocsEmp] = useState<Emp | null>(null);
  const [portalEmp, setPortalEmp] = useState<Emp | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [secciones, setSecciones] = useState<Record<SeccionFicha, boolean>>({
    identidad: true,
    laboral: true,
    salarios: false,
    contacto: false,
    licencia: false,
    otros: false,
  });
  const [vista, setVista] = useState<"lista" | "ficha">("lista");
  const entrevistaCargada = useRef<string | null>(null);

  function toggleSeccion(id: SeccionFicha) {
    setSecciones((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function irALista() {
    setVista("lista");
    setEditId(null);
    setHistorial([]);
    setSupervisorBusqueda("");
    setForm(emptyForm(horaDef.entrada, horaDef.salida));
  }

  function irANuevo() {
    setEditId(null);
    setHistorial([]);
    setSupervisorBusqueda("");
    setForm(emptyForm(horaDef.entrada, horaDef.salida));
    setSecciones({
      identidad: true,
      laboral: true,
      salarios: true,
      contacto: true,
      licencia: false,
      otros: true,
    });
    setVista("ficha");
  }

  const mostrarDpi = true;

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const cargar = useCallback(async () => {
    const params = new URLSearchParams();
    if (qDebounced.trim()) params.set("q", qDebounced.trim());
    if (filtroTipo) params.set("tipoContrato", filtroTipo);
    if (filtroPago) params.set("formaPago", filtroPago);
    if (filtroEstado) params.set("estado", filtroEstado);
    const res = await fetch(
      `/api/empresas/${slug}/empleados?${params.toString()}`,
    );
    const data = await res.json();
    if (!res.ok) return;
    setEmpleados(data.empleados ?? []);
    const entrada = horaCortaCfg(data.horarioDefault?.entrada, "08:00");
    const salida = horaCortaCfg(data.horarioDefault?.salida, "17:00");
    setHoraDef({ entrada, salida });
    setEditId((id) => {
      if (id == null) {
        setForm((f) =>
          f.codigo || f.nombre
            ? f
            : { ...f, horaEntradaTeorica: entrada, horaSalidaTeorica: salida },
        );
      }
      return id;
    });
  }, [slug, qDebounced, filtroTipo, filtroPago, filtroEstado]);

  // Acumula id -> etiqueta para los chips, sin perder las de supervisores ya
  // asignados que dejaron de estar Activos (esos no vuelven a llegar por
  // supervisoresDisponibles, que solo trae Activos).
  function mergeSupervisorLabels(
    lista: { id: number; nombre: string; numeroEmpleado?: string; codigo: string }[],
  ) {
    setSupervisorLabels((prev) => {
      const next = { ...prev };
      for (const s of lista) {
        next[s.id] = `${s.numeroEmpleado || s.codigo} — ${s.nombre}`;
      }
      return next;
    });
  }

  // Reutiliza el mismo GET /empleados, con estado=Activo, para poblar el
  // buscador de Supervisor(es) — no crea una ruta nueva. Se llama desde
  // dentro de `cargar()` (mismo efecto ya existente abajo) en vez de un
  // efecto aparte, para no depender de los filtros/búsqueda que el usuario
  // haya aplicado a la tabla y para no agregar un segundo useEffect con
  // setState.
  const cargarSupervisores = useCallback(async () => {
    const res = await fetch(
      `/api/empresas/${slug}/empleados?estado=Activo`,
    );
    const data = await res.json();
    if (!res.ok) return;
    const activos: Emp[] = data.empleados ?? [];
    setSupervisoresDisponibles(activos);
    mergeSupervisorLabels(activos);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial remota existente
    void cargar();
    void cargarSupervisores();
  }, [cargar, cargarSupervisores]);

  useEffect(() => {
    if (!entrevistaId || entrevistaCargada.current === entrevistaId) return;
    entrevistaCargada.current = entrevistaId;
    void (async () => {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/entrevistas/${encodeURIComponent(entrevistaId)}`,
      );
      const data = await res.json();
      if (!res.ok || data.entrevista?.resultado !== "Aprobado") {
        setError(
          data.error || "La entrevista debe estar aprobada antes de crear al empleado.",
        );
        return;
      }
      const candidato = data.entrevista as {
        candidatoNombre: string;
        candidatoTelefono: string | null;
        candidatoEmail: string | null;
        puesto: string;
      };
      setEditId(null);
      setHistorial([]);
      setForm({
        ...emptyForm(horaDef.entrada, horaDef.salida),
        nombre: candidato.candidatoNombre,
        nombreManual: true,
        puesto: candidato.puesto,
        telefono: candidato.candidatoTelefono ?? "",
        email: candidato.candidatoEmail ?? "",
      });
      setSecciones({
        identidad: true,
        laboral: true,
        salarios: true,
        contacto: true,
        licencia: false,
        otros: true,
      });
      setMensaje("Datos del candidato aprobados cargados. Complete la ficha laboral.");
      setVista("ficha");
    })();
  }, [entrevistaId, horaDef.entrada, horaDef.salida, slug]);

  function patchForm(patch: Partial<FormState>) {
    setForm((f) => {
      const next = { ...f, ...patch };
      if ("dpi" in patch) {
        const dpi = (patch.dpi ?? "").trim();
        if (dpi && (!f.codigo.trim() || f.codigo.trim() === f.dpi.trim())) {
          next.codigo = dpi;
        }
      }
      const identityKeys: (keyof FormState)[] = [
        "primerNombre",
        "segundoNombre",
        "tercerNombre",
        "cuartoNombre",
        "primerApellido",
        "segundoApellido",
        "apellidoCasada",
      ];
      const touchesIdentity = identityKeys.some((k) => k in patch);
      if (touchesIdentity && !next.nombreManual) {
        next.nombre = componerNombre(next);
      }
      return next;
    });
  }

  async function empezarEdicion(e: Emp) {
    setEditId(e.id);
    setHistorial([]);
    setSupervisorBusqueda("");
    setVista("ficha");
    setSecciones({
      identidad: true,
      laboral: true,
      salarios: true,
      contacto: true,
      licencia: true,
      otros: true,
    });
    try {
      const res = await fetch(
        `/api/empresas/${slug}/empleados/${e.id}?historial=1`,
      );
      const data = await res.json();
      if (res.ok && data.empleado) {
        const supervisores: SupervisorInfo[] = data.supervisores ?? [];
        mergeSupervisorLabels(supervisores);
        setForm(
          empToForm(
            data.empleado,
            horaDef,
            supervisores.map((s) => s.id),
          ),
        );
        setHistorial(data.historial ?? []);
        return;
      }
    } catch {
      /* fallback to list row */
    }
    setForm(empToForm(e, horaDef));
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    setMensaje("");
    const { labels, secciones: secs } = faltantesAlta(
      form as unknown as Record<string, unknown>,
    );
    if (labels.length) {
      setSecciones((prev) => ({
        ...prev,
        identidad: prev.identidad || secs.has("identidad"),
        laboral: prev.laboral || secs.has("laboral"),
        salarios: prev.salarios || secs.has("salarios"),
        contacto: prev.contacto || secs.has("contacto"),
        otros: prev.otros || secs.has("otros"),
      }));
      setError(
        `Faltan campos obligatorios (*): ${labels.slice(0, 8).join(", ")}${
          labels.length > 8 ? ` (+${labels.length - 8} más)` : ""
        }.`,
      );
      return;
    }
    const url = editId
      ? `/api/empresas/${slug}/empleados/${editId}`
      : `/api/empresas/${slug}/empleados`;
    const res = await fetch(url, {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formToBody(form)),
    });
    // El backend siempre responde JSON, pero un 500 inesperado (proxy,
    // timeout, etc.) puede llegar con body vacío o no-JSON: sin este
    // try/catch, res.json() lanzaba y el usuario solo veía un 400/500 en
    // consola, sin mensaje en pantalla.
    let data: { error?: string; mensaje?: string } = {};
    try {
      data = await res.json();
    } catch {
      /* respuesta sin JSON válido */
    }
    if (!res.ok) {
      setError(data.error || `No se pudo guardar (código ${res.status}).`);
      return;
    }
    setMensaje(data.mensaje ?? "Empleado guardado.");
    setForm(emptyForm(horaDef.entrada, horaDef.salida));
    setEditId(null);
    setHistorial([]);
    setSupervisorBusqueda("");
    setVista("lista");
    await cargar();
    await cargarSupervisores();
  }

  async function borrar(id: number) {
    if (!confirm("¿Eliminar empleado y su historial?")) return;
    const res = await fetch(`/api/empresas/${slug}/empleados/${id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    setMensaje(data.mensaje || data.error);
    await cargar();
  }

  function cancelarEdicion() {
    irALista();
  }

  const input =
    "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Personal / Empleados</h1>
          <p className="text-sm text-[var(--muted)]">
            Alta, edición y baja. Las vacaciones se calculan con la{" "}
            <strong className="font-medium text-[var(--text)]">
              fecha de contratación
            </strong>
            , no con la de entrada laboral.{" "}
            <Link
              href={`/e/${slug}/dashboard-rrhh`}
              className="text-[var(--accent)] underline"
            >
              Dashboard RRHH
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={irALista}
            className={[
              "rounded-lg px-3 py-2 text-sm font-medium",
              vista === "lista"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] bg-[var(--card)] text-[var(--muted)]",
            ].join(" ")}
          >
            Lista de empleados
          </button>
          <button
            type="button"
            onClick={irANuevo}
            className={[
              "rounded-lg px-3 py-2 text-sm font-medium",
              vista === "ficha" && !editId
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] bg-[var(--card)] text-[var(--muted)]",
            ].join(" ")}
          >
            Registrar nuevo
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {mensaje ? <p className="text-sm text-emerald-600">{mensaje}</p> : null}
      <ImportErroresLista errores={erroresImport} />

      {vista === "ficha" ? (
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {editId ? `Editando #${editId}` : "Nuevo empleado"}
          </p>
          <button
            type="button"
            onClick={irALista}
            className="text-xs text-[var(--accent)] underline"
          >
            ← Volver a la lista
          </button>
        </div>

        <FormSection
          title="1. Identidad"
          hint="* obligatorio según ficha Monaco · Foto en expediente"
          open={secciones.identidad}
          onToggle={() => toggleSeccion("identidad")}
        >
        <label>
          <FieldLabel required>Primer nombre</FieldLabel>
          <input
            className={input}
            value={form.primerNombre}
            onChange={(e) => patchForm({ primerNombre: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel>Segundo nombre</FieldLabel>
          <input
            className={input}
            value={form.segundoNombre}
            onChange={(e) => patchForm({ segundoNombre: e.target.value })}
          />
        </label>
        <label>
          <FieldLabel>Tercer nombre</FieldLabel>
          <input
            className={input}
            value={form.tercerNombre}
            onChange={(e) => patchForm({ tercerNombre: e.target.value })}
          />
        </label>
        <label>
          <FieldLabel>Cuarto nombre</FieldLabel>
          <input
            className={input}
            value={form.cuartoNombre}
            onChange={(e) => patchForm({ cuartoNombre: e.target.value })}
          />
        </label>
        <label>
          <FieldLabel required>Primer apellido</FieldLabel>
          <input
            className={input}
            value={form.primerApellido}
            onChange={(e) => patchForm({ primerApellido: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel>Segundo apellido</FieldLabel>
          <input
            className={input}
            value={form.segundoApellido}
            onChange={(e) => patchForm({ segundoApellido: e.target.value })}
          />
        </label>
        <label>
          <FieldLabel>Apellido casada</FieldLabel>
          <input
            className={input}
            value={form.apellidoCasada}
            onChange={(e) => patchForm({ apellidoCasada: e.target.value })}
          />
        </label>
        <label className="sm:col-span-2">
          <FieldLabel
            required
            hint={
              form.nombreManual
                ? "Editado manualmente"
                : "Se genera desde nombres y apellidos"
            }
          >
            Nombre completo
          </FieldLabel>
          <input
            className={input}
            value={form.nombre}
            onChange={(e) =>
              setForm({ ...form, nombre: e.target.value, nombreManual: true })
            }
            required
          />
        </label>
        <label>
          <FieldLabel required hint="También se usa como código si no hay otro">
            DPI
          </FieldLabel>
          <input
            className={input}
            value={form.dpi}
            onChange={(e) => patchForm({ dpi: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>NIT</FieldLabel>
          <input
            className={input}
            value={form.nit}
            onChange={(e) => patchForm({ nit: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>IGSS</FieldLabel>
          <input
            className={input}
            value={form.igss}
            onChange={(e) => patchForm({ igss: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>IRTRA</FieldLabel>
          <input
            className={input}
            value={form.irtra}
            onChange={(e) => patchForm({ irtra: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>Sexo</FieldLabel>
          <select
            className={input}
            value={form.sexo}
            onChange={(e) => patchForm({ sexo: e.target.value })}
            required
          >
            <option value="">—</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
          </select>
        </label>
        <label>
          <FieldLabel required>Fecha nacimiento</FieldLabel>
          <input
            type="date"
            className={input}
            value={form.fechaNacimiento}
            onChange={(e) => patchForm({ fechaNacimiento: e.target.value })}
            required
          />
        </label>

        </FormSection>

        <FormSection
          title="2. Laboral"
          hint="Área = organigrama · Puesto = cargo (Piloto, Auxiliar…)"
          open={secciones.laboral}
          onToggle={() => toggleSeccion("laboral")}
        >
        <label>
          <FieldLabel required hint="Monaco no usa código propio: usar DPI">
            Código
          </FieldLabel>
          <input
            className={input}
            value={form.codigo}
            onChange={(e) => patchForm({ codigo: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required hint="Piloto / Auxiliar aquí (para TMS)">
            Puesto
          </FieldLabel>
          <input
            className={input}
            list="puestos-monaco"
            value={form.puesto}
            onChange={(e) => patchForm({ puesto: e.target.value })}
            required
          />
          <datalist id="puestos-monaco">
            {PUESTOS_MONACO.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label>
          <FieldLabel required>Área</FieldLabel>
          <select
            className={input}
            value={form.categoriaOps}
            onChange={(e) => patchForm({ categoriaOps: e.target.value })}
            required
          >
            <option value="">—</option>
            {CATEGORIAS_OPS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {form.categoriaOps &&
            !(CATEGORIAS_OPS as readonly string[]).includes(
              form.categoriaOps,
            ) ? (
              <option value={form.categoriaOps}>
                {form.categoriaOps} (anterior)
              </option>
            ) : null}
          </select>
        </label>
        <label>
          <FieldLabel required>Tipo contrato</FieldLabel>
          <select
            className={input}
            value={form.tipoContrato}
            onChange={(e) =>
              patchForm({
                tipoContrato: normalizarTipoContrato(e.target.value),
              })
            }
            required
          >
            {TIPOS_CONTRATO.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {form.tipoContrato === "outsourcing" ? (
            <p className="mt-1 text-xs text-amber-300">
              Outsourcing: no requiere IGSS/IRTRA; se paga por efectivo/cheque/
              transferencia y se controla en Planillas.
            </p>
          ) : null}
        </label>
        <label>
          <FieldLabel required>Forma pago</FieldLabel>
          <select
            className={input}
            value={form.formaPago}
            onChange={(e) =>
              patchForm({
                formaPago: normalizarFormaPago(e.target.value),
              })
            }
            required
          >
            {FORMAS_PAGO.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <FieldLabel required>Profesión</FieldLabel>
          <input
            className={input}
            value={form.profesion}
            onChange={(e) => patchForm({ profesion: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel hint="Cuando empieza a trabajar">
            Fecha entrada laboral
          </FieldLabel>
          <input
            type="date"
            className={input}
            value={form.fechaInicioLaboral}
            onChange={(e) =>
              patchForm({ fechaInicioLaboral: e.target.value })
            }
          />
        </label>
        <label>
          <FieldLabel required hint="Base para vacaciones">
            Fecha ingreso / contratación
          </FieldLabel>
          <input
            type="date"
            className={input}
            value={form.fechaAlta}
            onChange={(e) => patchForm({ fechaAlta: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel>Fecha egreso</FieldLabel>
          <input
            type="date"
            className={input}
            value={form.fechaEgreso}
            onChange={(e) => patchForm({ fechaEgreso: e.target.value })}
          />
        </label>
        <label>
          <FieldLabel required>Jornada / horario</FieldLabel>
          <select
            className={input}
            value={form.tipoHorario}
            onChange={(e) =>
              patchForm({
                tipoHorario: e.target.value as "Fijo" | "Variable",
              })
            }
            required
          >
            <option value="Fijo">Fijo (diurna)</option>
            <option value="Variable">Variable</option>
          </select>
        </label>
        <label>
          <FieldLabel required>Entrada teórica</FieldLabel>
          <input
            type="time"
            className={input}
            value={form.horaEntradaTeorica}
            onChange={(e) =>
              patchForm({ horaEntradaTeorica: e.target.value })
            }
            required
          />
        </label>
        <label>
          <FieldLabel required>Salida teórica</FieldLabel>
          <input
            type="time"
            className={input}
            value={form.horaSalidaTeorica}
            onChange={(e) =>
              patchForm({ horaSalidaTeorica: e.target.value })
            }
            required
          />
        </label>
        <label>
          <FieldLabel required>Estado</FieldLabel>
          <select
            className={input}
            value={form.estado}
            onChange={(e) =>
              patchForm({
                estado: e.target.value as "Activo" | "Baja",
              })
            }
            required
          >
            <option value="Activo">Activo</option>
            <option value="Baja">Baja / Inactivo</option>
          </select>
        </label>
        <div className="sm:col-span-2 lg:col-span-3">
          <FieldLabel hint="Para horas extra y jerarquía del equipo — puede tener uno, varios o ninguno">
            Supervisor(es)
          </FieldLabel>
          <input
            type="text"
            className={input}
            placeholder="Buscar supervisor por nombre"
            value={supervisorBusqueda}
            onChange={(e) => setSupervisorBusqueda(e.target.value)}
          />
          {supervisorBusqueda.trim() ? (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)]">
              {(() => {
                const q = supervisorBusqueda.trim().toLowerCase();
                const candidatos = supervisoresDisponibles.filter((s) => {
                  if (s.id === editId) return false;
                  if (form.supervisorIds.includes(s.id)) return false;
                  const haystack =
                    `${s.nombre} ${s.numeroEmpleado ?? ""} ${s.codigo}`.toLowerCase();
                  return haystack.includes(q);
                });
                if (candidatos.length === 0) {
                  return (
                    <p className="px-3 py-2 text-xs text-[var(--muted)]">
                      Sin resultados.
                    </p>
                  );
                }
                return candidatos.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--nav-hover)]"
                    onClick={() => {
                      mergeSupervisorLabels([s]);
                      patchForm({
                        supervisorIds: [...form.supervisorIds, s.id],
                      });
                      setSupervisorBusqueda("");
                    }}
                  >
                    {s.numeroEmpleado || s.codigo} — {s.nombre}
                  </button>
                ));
              })()}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {form.supervisorIds.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">
                Sin supervisores asignados
              </p>
            ) : (
              form.supervisorIds.map((sid) => {
                const label = supervisorLabels[sid] ?? `#${sid}`;
                return (
                  <span
                    key={sid}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--input)] px-3 py-1 text-xs"
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() =>
                        patchForm({
                          supervisorIds: form.supervisorIds.filter(
                            (id) => id !== sid,
                          ),
                        })
                      }
                      className="ml-1 text-[var(--muted)] hover:text-red-400"
                      aria-label={`Quitar ${label}`}
                    >
                      ×
                    </button>
                  </span>
                );
              })
            )}
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.horasExtraHabilitado}
            onChange={(e) =>
              patchForm({ horasExtraHabilitado: e.target.checked })
            }
          />
          <span className="text-sm">
            Horas extra: habilitado para pago de horas extra
          </span>
        </label>

        </FormSection>

        <FormSection
          title="3. Salarios"
          hint="Obligatorios en alta Monaco"
          open={secciones.salarios}
          onToggle={() => toggleSeccion("salarios")}
        >
        <label>
          <FieldLabel required>Sueldo base</FieldLabel>
          <input
            type="number"
            step="0.01"
            min="0"
            className={input}
            value={form.sueldoBase}
            onChange={(e) => patchForm({ sueldoBase: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>Bonificación incentivo</FieldLabel>
          <input
            type="number"
            step="0.01"
            min="0"
            className={input}
            value={form.bonoIncentivo}
            onChange={(e) => patchForm({ bonoIncentivo: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>Bono de herramientas</FieldLabel>
          <input
            type="number"
            step="0.01"
            min="0"
            className={input}
            value={form.bonoHerramientas}
            onChange={(e) => patchForm({ bonoHerramientas: e.target.value })}
            required
          />
        </label>

        </FormSection>

        <FormSection
          title="4. Contacto"
          hint="Teléfono y dirección obligatorios · email opcional"
          open={secciones.contacto}
          onToggle={() => toggleSeccion("contacto")}
        >
        <label>
          <FieldLabel required>Teléfono</FieldLabel>
          <input
            className={input}
            value={form.telefono}
            onChange={(e) => patchForm({ telefono: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel>Email</FieldLabel>
          <input
            type="email"
            className={input}
            value={form.email}
            onChange={(e) => patchForm({ email: e.target.value })}
          />
        </label>
        <label className="sm:col-span-2 lg:col-span-3">
          <FieldLabel required>Dirección actual</FieldLabel>
          <input
            className={input}
            value={form.direccion}
            onChange={(e) => patchForm({ direccion: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel>Contacto emergencia</FieldLabel>
          <input
            className={input}
            value={form.contactoEmergencia}
            onChange={(e) =>
              patchForm({ contactoEmergencia: e.target.value })
            }
          />
        </label>

        </FormSection>

        <FormSection
          title="5. Licencia"
          hint="Opcional · recomendado para pilotos"
          open={secciones.licencia}
          onToggle={() => toggleSeccion("licencia")}
        >
        <label className="text-sm text-[var(--muted)]">
          Número licencia
          <input
            className={input}
            value={form.licenciaNumero}
            onChange={(e) => patchForm({ licenciaNumero: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Tipo licencia
          <select
            className={input}
            value={form.licenciaTipo}
            onChange={(e) =>
              patchForm({ licenciaTipo: e.target.value as LicenciaTipo })
            }
          >
            <option value="">—</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="M">M</option>
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Licencia vence
          <input
            type="date"
            className={input}
            value={form.licenciaVence}
            onChange={(e) => patchForm({ licenciaVence: e.target.value })}
          />
        </label>

        </FormSection>

        <FormSection
          title="6. Otros"
          hint="Demografía obligatoria · banco y observaciones opcionales"
          open={secciones.otros}
          onToggle={() => toggleSeccion("otros")}
        >
        <label>
          <FieldLabel required>País origen</FieldLabel>
          <input
            className={input}
            value={form.paisOrigen}
            onChange={(e) => patchForm({ paisOrigen: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>Municipio</FieldLabel>
          <input
            className={input}
            value={form.municipio}
            onChange={(e) => patchForm({ municipio: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>Etnia</FieldLabel>
          <input
            className={input}
            value={form.etnia}
            onChange={(e) => patchForm({ etnia: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>Religión</FieldLabel>
          <input
            className={input}
            value={form.religion}
            onChange={(e) => patchForm({ religion: e.target.value })}
            required
          />
        </label>
        <label>
          <FieldLabel required>Idioma</FieldLabel>
          <input
            className={input}
            value={form.idioma}
            onChange={(e) => patchForm({ idioma: e.target.value })}
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Cuenta bancaria
          <input
            className={input}
            value={form.cuentaBancaria}
            onChange={(e) => patchForm({ cuentaBancaria: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Tipo cuenta
          <input
            className={input}
            value={form.tipoCuenta}
            onChange={(e) => patchForm({ tipoCuenta: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Banco
          <input
            className={input}
            value={form.banco}
            onChange={(e) => patchForm({ banco: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)] sm:col-span-2 lg:col-span-3">
          Observaciones
          <textarea
            className={`${input} min-h-[4rem] resize-y`}
            value={form.observaciones}
            onChange={(e) => patchForm({ observaciones: e.target.value })}
            rows={2}
          />
        </label>

        </FormSection>

        {editId && historial.length > 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-medium">Historial de cambios</p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-[var(--muted)]">
              {historial.map((h) => (
                <li key={h.id}>
                  <span className="font-medium text-[var(--text)]">
                    {h.campo}
                  </span>
                  : {h.valorAnterior ?? "—"} → {h.valorNuevo ?? "—"} ·{" "}
                  {h.registradoPor ?? "?"} · {h.creadoAt}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {editId ? (
          <BitacoraLegalEmpleado slug={slug} empleadoId={editId} />
        ) : null}

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"
          >
            {editId ? "Guardar cambios" : "Crear"}
          </button>
          {editId ? (
            <>
              <button
                type="button"
                className="rounded-lg bg-[#1F6AA5] px-4 py-2 text-sm text-white"
                onClick={() => {
                  const emp = empleados.find((x) => x.id === editId);
                  if (emp) setDocsEmp(emp);
                }}
              >
                Ver expediente
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#334155] px-4 py-2 text-sm text-white"
                onClick={cancelarEdicion}
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-[#334155] px-4 py-2 text-sm text-white"
              onClick={irALista}
            >
              Cancelar
            </button>
          )}
        </div>
      </form>
      ) : null}

      {vista === "lista" ? (
      <>
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[14rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm"
          placeholder="Buscar por nombre, código o DPI…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-2 text-sm"
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
        >
          <option value="">Todos los contratos</option>
          {TIPOS_CONTRATO.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-2 text-sm"
          value={filtroPago}
          onChange={(e) => setFiltroPago(e.target.value)}
        >
          <option value="">Todas las formas de pago</option>
          {FORMAS_PAGO.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-2 text-sm"
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
        >
          <option value="">Activos y bajas</option>
          <option value="Activo">Activo</option>
          <option value="Baja">Baja</option>
        </select>
        <button
          type="button"
          onClick={irANuevo}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
        >
          + Nuevo empleado
        </button>
        <a
          href={`/api/empresas/${slug}/empleados/export?format=plantilla`}
          className="rounded-lg bg-[#334155] px-3 py-2 text-sm text-white"
        >
          Plantilla Excel
        </a>
        <button
          type="button"
          className="rounded-lg bg-[#0d9488] px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={importando}
          onClick={() => fileRef.current?.click()}
        >
          {importando ? "Importando…" : "Importar Excel"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setImportando(true);
            setError("");
            setMensaje("");
            setErroresImport([]);
            try {
              const fd = new FormData();
              fd.set("file", file);
              const res = await fetch(
                `/api/empresas/${slug}/empleados/import`,
                { method: "POST", body: fd },
              );
              const data = await res.json();
              if (!res.ok) {
                setError(data.error ?? "Error al importar");
                return;
              }
              setMensaje(data.mensaje ?? "Importación completada.");
              setErroresImport(
                Array.isArray(data.errores)
                  ? data.errores.map(String)
                  : [],
              );
              await cargar();
            } finally {
              setImportando(false);
            }
          }}
        />
        <a
          href={`/api/empresas/${slug}/empleados/export?format=xlsx`}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white"
        >
          Excel
        </a>
        <a
          href={`/api/empresas/${slug}/empleados/export?format=pdf`}
          className="rounded-lg bg-[#1e293b] px-3 py-2 text-sm text-white"
        >
          PDF
        </a>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--thead)] text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nombre</th>
              {mostrarDpi ? <th className="px-3 py-2">DPI</th> : null}
              <th className="px-3 py-2">Puesto</th>
              <th className="px-3 py-2">Contrato</th>
              <th className="px-3 py-2">Pago</th>
              <th className="px-3 py-2">Área</th>
              <th className="px-3 py-2">Entrada lab.</th>
              <th className="px-3 py-2">Contratación</th>
              <th className="px-3 py-2">Horario</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Docs</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {empleados.map((e) => (
              <tr
                key={e.id}
                className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--nav-hover)]"
                title="Doble clic: expediente (PDF/fotos)"
                onDoubleClick={() => setDocsEmp(e)}
              >
                <td className="px-3 py-2">{e.codigo}</td>
                <td className="px-3 py-2">{e.nombre}</td>
                {mostrarDpi ? (
                  <td className="px-3 py-2">{e.dpi || "—"}</td>
                ) : null}
                <td className="px-3 py-2">{e.puesto || "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {e.tipoContrato === "outsourcing"
                    ? "Outsourcing"
                    : e.tipoContrato === "prueba"
                      ? "Prueba"
                      : e.tipoContrato === "temporal"
                        ? "Temporal"
                        : "Fijo"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {e.formaPago === "cheque"
                    ? "Cheque"
                    : e.formaPago === "efectivo"
                      ? "Efectivo"
                      : "Transferencia"}
                </td>
                <td className="px-3 py-2">{e.categoriaOps || "—"}</td>
                <td className="px-3 py-2">
                  {formatearFechaVisible(e.fechaInicioLaboral) || "—"}
                </td>
                <td className="px-3 py-2">
                  {formatearFechaVisible(e.fechaAlta) || "—"}
                </td>
                <td className="px-3 py-2">
                  {e.tipoHorario} {e.horaEntradaTeorica?.slice(0, 5)}
                </td>
                <td className="px-3 py-2">{e.estado}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-[var(--accent-2)] underline"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setDocsEmp(e);
                    }}
                  >
                    📁 {e.docsCount ?? 0}
                  </button>
                </td>
                <td className="px-3 py-2 space-x-2 whitespace-nowrap">
                  <button
                    type="button"
                    className="text-[var(--accent-2)] underline"
                    onClick={() => void empezarEdicion(e)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="text-[var(--accent-2)] underline"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setPortalEmp(e);
                    }}
                  >
                    Portal
                  </button>
                  <button
                    type="button"
                    className="text-red-300 underline"
                    onClick={() => void borrar(e.id)}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      ) : null}

      {docsEmp ? (
        <DocumentosModal
          slug={slug}
          empleadoId={docsEmp.id}
          empleadoNombre={`${docsEmp.codigo} — ${docsEmp.nombre}`}
          onClose={() => setDocsEmp(null)}
          onChanged={() => void cargar()}
        />
      ) : null}

      {portalEmp ? (
        <PortalAccesoModal
          slug={slug}
          empleadoId={portalEmp.id}
          empleadoNombre={`${portalEmp.codigo} — ${portalEmp.nombre}`}
          onClose={() => setPortalEmp(null)}
          onChanged={() => void cargar()}
        />
      ) : null}
    </div>
  );
}
