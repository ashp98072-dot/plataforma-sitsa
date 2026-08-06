"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { DocumentosModal } from "@/components/rrhh/documentos-modal";
import { formatearFechaVisible, hoyLocal } from "@/lib/rrhh/dates";
import { CATEGORIAS_OPS } from "@/lib/rrhh/categorias-ops";

type Emp = {
  id: number;
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
  tipoContrato: "prueba" | "fijo";
  formaPago: "cheque" | "transferencia";
  profesion: string;
  tipoHorario: "Fijo" | "Variable";
  fechaAlta: string;
  fechaInicioLaboral: string;
  fechaEgreso: string;
  horaEntradaTeorica: string;
  horaSalidaTeorica: string;
  estado: "Activo" | "Baja";
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
    tipoContrato: e.tipoContrato === "prueba" ? "prueba" : "fijo",
    formaPago: e.formaPago === "cheque" ? "cheque" : "transferencia",
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
  };
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
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [horaDef, setHoraDef] = useState({ entrada: "07:00", salida: "16:00" });
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [editId, setEditId] = useState<number | null>(null);
  const [historial, setHistorial] = useState<EmpleadoCambio[]>([]);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [importando, setImportando] = useState(false);
  const [docsEmp, setDocsEmp] = useState<Emp | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [secciones, setSecciones] = useState<Record<SeccionFicha, boolean>>({
    identidad: true,
    laboral: true,
    salarios: false,
    contacto: false,
    licencia: false,
    otros: false,
  });

  function toggleSeccion(id: SeccionFicha) {
    setSecciones((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const mostrarDpi = empleados.some((e) => e.dpi);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const cargar = useCallback(async () => {
    const res = await fetch(
      `/api/empresas/${slug}/empleados?q=${encodeURIComponent(qDebounced)}`,
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
  }, [slug, qDebounced]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function patchForm(patch: Partial<FormState>) {
    setForm((f) => {
      const next = { ...f, ...patch };
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
        setForm(empToForm(data.empleado, horaDef));
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
    const url = editId
      ? `/api/empresas/${slug}/empleados/${editId}`
      : `/api/empresas/${slug}/empleados`;
    const res = await fetch(url, {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formToBody(form)),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMensaje(data.mensaje);
    setForm(emptyForm(horaDef.entrada, horaDef.salida));
    setEditId(null);
    setHistorial([]);
    await cargar();
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
    setEditId(null);
    setHistorial([]);
    setForm(emptyForm(horaDef.entrada, horaDef.salida));
  }

  const input =
    "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Personal / Empleados</h1>
        <p className="text-sm text-[var(--muted)]">
          Alta, edición y baja. Las vacaciones se calculan con la{" "}
          <strong className="font-medium text-[var(--text)]">fecha de contratación</strong>
          , no con la de entrada laboral.{" "}
          <Link
            href={`/e/${slug}/dashboard-rrhh`}
            className="text-[var(--accent)] underline"
          >
            Dashboard RRHH
          </Link>
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {editId ? `Editando #${editId}` : "Nuevo empleado"}
          </p>
          <p className="text-[11px] text-[var(--muted)]">
            Abre solo las secciones que necesites
          </p>
        </div>

        <FormSection
          title="1. Identidad"
          hint="Nombres, DPI, NIT, IGSS…"
          open={secciones.identidad}
          onToggle={() => toggleSeccion("identidad")}
        >
        <label className="text-sm text-[var(--muted)]">
          Primer nombre
          <input
            className={input}
            value={form.primerNombre}
            onChange={(e) => patchForm({ primerNombre: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Segundo nombre
          <input
            className={input}
            value={form.segundoNombre}
            onChange={(e) => patchForm({ segundoNombre: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Tercer nombre
          <input
            className={input}
            value={form.tercerNombre}
            onChange={(e) => patchForm({ tercerNombre: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Cuarto nombre
          <input
            className={input}
            value={form.cuartoNombre}
            onChange={(e) => patchForm({ cuartoNombre: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Primer apellido
          <input
            className={input}
            value={form.primerApellido}
            onChange={(e) => patchForm({ primerApellido: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Segundo apellido
          <input
            className={input}
            value={form.segundoApellido}
            onChange={(e) => patchForm({ segundoApellido: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Apellido casada
          <input
            className={input}
            value={form.apellidoCasada}
            onChange={(e) => patchForm({ apellidoCasada: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)] sm:col-span-2">
          Nombre completo
          <span className="mt-0.5 block text-[10px] opacity-80">
            {form.nombreManual
              ? "Editado manualmente"
              : "Se genera automáticamente desde los campos de identidad"}
          </span>
          <input
            className={input}
            value={form.nombre}
            onChange={(e) =>
              setForm({ ...form, nombre: e.target.value, nombreManual: true })
            }
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          DPI
          <input
            className={input}
            value={form.dpi}
            onChange={(e) => patchForm({ dpi: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          NIT
          <input
            className={input}
            value={form.nit}
            onChange={(e) => patchForm({ nit: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          IGSS
          <input
            className={input}
            value={form.igss}
            onChange={(e) => patchForm({ igss: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          IRTRA
          <input
            className={input}
            value={form.irtra}
            onChange={(e) => patchForm({ irtra: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Sexo
          <select
            className={input}
            value={form.sexo}
            onChange={(e) => patchForm({ sexo: e.target.value })}
          >
            <option value="">—</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Fecha nacimiento
          <input
            type="date"
            className={input}
            value={form.fechaNacimiento}
            onChange={(e) => patchForm({ fechaNacimiento: e.target.value })}
          />
        </label>

        </FormSection>

        <FormSection
          title="2. Laboral"
          hint="Código, puesto, contrato, horarios"
          open={secciones.laboral}
          onToggle={() => toggleSeccion("laboral")}
        >
        <label className="text-sm text-[var(--muted)]">
          Código
          <input
            className={input}
            value={form.codigo}
            onChange={(e) => patchForm({ codigo: e.target.value })}
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Puesto
          <input
            className={input}
            value={form.puesto}
            onChange={(e) => patchForm({ puesto: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Categoría ops
          <select
            className={input}
            value={form.categoriaOps}
            onChange={(e) => patchForm({ categoriaOps: e.target.value })}
          >
            <option value="">—</option>
            {CATEGORIAS_OPS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Tipo contrato
          <select
            className={input}
            value={form.tipoContrato}
            onChange={(e) =>
              patchForm({
                tipoContrato: e.target.value as "prueba" | "fijo",
              })
            }
          >
            <option value="fijo">Fijo</option>
            <option value="prueba">Prueba</option>
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Forma pago
          <select
            className={input}
            value={form.formaPago}
            onChange={(e) =>
              patchForm({
                formaPago: e.target.value as "cheque" | "transferencia",
              })
            }
          >
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Profesión
          <input
            className={input}
            value={form.profesion}
            onChange={(e) => patchForm({ profesion: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Fecha entrada laboral
          <span className="mt-0.5 block text-[10px] opacity-80">
            Cuando empieza a trabajar (opcional)
          </span>
          <input
            type="date"
            className={input}
            value={form.fechaInicioLaboral}
            onChange={(e) =>
              patchForm({ fechaInicioLaboral: e.target.value })
            }
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Fecha contratación / alta
          <span className="mt-0.5 block text-[10px] text-emerald-400/80">
            Contrato — base para vacaciones
          </span>
          <input
            type="date"
            className={input}
            value={form.fechaAlta}
            onChange={(e) => patchForm({ fechaAlta: e.target.value })}
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Fecha egreso
          <input
            type="date"
            className={input}
            value={form.fechaEgreso}
            onChange={(e) => patchForm({ fechaEgreso: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Horario
          <select
            className={input}
            value={form.tipoHorario}
            onChange={(e) =>
              patchForm({
                tipoHorario: e.target.value as "Fijo" | "Variable",
              })
            }
          >
            <option value="Fijo">Fijo</option>
            <option value="Variable">Variable</option>
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Entrada teórica
          <input
            type="time"
            className={input}
            value={form.horaEntradaTeorica}
            onChange={(e) =>
              patchForm({ horaEntradaTeorica: e.target.value })
            }
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Salida teórica
          <input
            type="time"
            className={input}
            value={form.horaSalidaTeorica}
            onChange={(e) =>
              patchForm({ horaSalidaTeorica: e.target.value })
            }
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Estado
          <select
            className={input}
            value={form.estado}
            onChange={(e) =>
              patchForm({
                estado: e.target.value as "Activo" | "Baja",
              })
            }
          >
            <option value="Activo">Activo</option>
            <option value="Baja">Baja</option>
          </select>
        </label>

        </FormSection>

        <FormSection
          title="3. Salarios"
          hint="Sueldo base y bonos"
          open={secciones.salarios}
          onToggle={() => toggleSeccion("salarios")}
        >
        <label className="text-sm text-[var(--muted)]">
          Sueldo base
          <input
            type="number"
            step="0.01"
            min="0"
            className={input}
            value={form.sueldoBase}
            onChange={(e) => patchForm({ sueldoBase: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Bono incentivo
          <input
            type="number"
            step="0.01"
            min="0"
            className={input}
            value={form.bonoIncentivo}
            onChange={(e) => patchForm({ bonoIncentivo: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Bono herramientas
          <input
            type="number"
            step="0.01"
            min="0"
            className={input}
            value={form.bonoHerramientas}
            onChange={(e) => patchForm({ bonoHerramientas: e.target.value })}
          />
        </label>

        </FormSection>

        <FormSection
          title="4. Contacto"
          hint="Teléfono, email, dirección"
          open={secciones.contacto}
          onToggle={() => toggleSeccion("contacto")}
        >
        <label className="text-sm text-[var(--muted)]">
          Teléfono
          <input
            className={input}
            value={form.telefono}
            onChange={(e) => patchForm({ telefono: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Email
          <input
            type="email"
            className={input}
            value={form.email}
            onChange={(e) => patchForm({ email: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)] sm:col-span-2 lg:col-span-3">
          Dirección
          <input
            className={input}
            value={form.direccion}
            onChange={(e) => patchForm({ direccion: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Contacto emergencia
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
          hint="Número, tipo y vencimiento"
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
          hint="Demografía, banco y observaciones"
          open={secciones.otros}
          onToggle={() => toggleSeccion("otros")}
        >
        <label className="text-sm text-[var(--muted)]">
          País origen
          <input
            className={input}
            value={form.paisOrigen}
            onChange={(e) => patchForm({ paisOrigen: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Municipio
          <input
            className={input}
            value={form.municipio}
            onChange={(e) => patchForm({ municipio: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Etnia
          <input
            className={input}
            value={form.etnia}
            onChange={(e) => patchForm({ etnia: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Religión
          <input
            className={input}
            value={form.religion}
            onChange={(e) => patchForm({ religion: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Idioma
          <input
            className={input}
            value={form.idioma}
            onChange={(e) => patchForm({ idioma: e.target.value })}
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
          ) : null}
        </div>
      </form>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {mensaje ? <p className="text-sm text-emerald-300">{mensaje}</p> : null}

      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[12rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm"
          placeholder="Buscar por nombre o código…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <a
          href={`/api/empresas/${slug}/empleados/export?format=plantilla`}
          className="rounded-lg bg-[#334155] px-3 py-2 text-sm"
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
              setMensaje(
                data.mensaje +
                  (data.errores?.length
                    ? ` · ${data.errores.length} fila(s) con error`
                    : ""),
              );
              if (data.errores?.length) {
                console.warn("Errores import:", data.errores);
              }
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
          className="rounded-lg bg-[#1e293b] px-3 py-2 text-sm"
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
              <th className="px-3 py-2">Cat.</th>
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

      {docsEmp ? (
        <DocumentosModal
          slug={slug}
          empleadoId={docsEmp.id}
          empleadoNombre={`${docsEmp.codigo} — ${docsEmp.nombre}`}
          onClose={() => setDocsEmp(null)}
          onChanged={() => void cargar()}
        />
      ) : null}
    </div>
  );
}
