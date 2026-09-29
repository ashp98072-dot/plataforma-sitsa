"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { UsuarioEntrevistaPicker, type UsuarioEntrevistaOpt } from "@/components/rrhh/usuario-entrevista-picker";
import { EntrevistaDocumentos } from "@/components/rrhh/entrevista-documentos";
import { ExpedienteCandidato } from "@/components/rrhh/expediente-candidato";
import { componerNombreCompleto, tieneIdentidadEstructurada } from "@/lib/rrhh/nombre-completo";
import {
  construirIdentidadPatch,
  debeIncluirIdentidad as calcularDebeIncluirIdentidad,
  calcularPeriodoTrasGuardar,
  resolverEntrevistadorMostrado,
} from "@/lib/rrhh/entrevista-form";

type Entrevista = {
  id: number;
  candidatoNombre: string;
  candidatoPrimerNombre: string | null;
  candidatoSegundoNombre: string | null;
  candidatoTercerNombre: string | null;
  candidatoCuartoNombre: string | null;
  candidatoPrimerApellido: string | null;
  candidatoSegundoApellido: string | null;
  candidatoApellidoCasada: string | null;
  candidatoTelefono: string | null;
  candidatoEmail: string | null;
  puesto: string;
  fechaHora: string;
  entrevistadorEmpleadoId: number | null;
  entrevistadorNombre?: string;
  entrevistadorUsuarioId: number | null;
  entrevistadorUsuarioNombre?: string;
  auxiliarUsuarioId: number | null;
  auxiliarUsuarioNombre?: string;
  modalidad: "Presencial" | "Virtual";
  lugarOEnlace: string | null;
  estado: "Programada" | "Realizada" | "Cancelada" | "No asistió";
  resultado: "Pendiente" | "Aprobado" | "Rechazado";
  notas: string | null;
};

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const OTRO_PUESTO = "__otro__";

const ESTADO_COLOR: Record<Entrevista["estado"], string> = {
  Programada: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  Realizada: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  Cancelada: "bg-red-500/20 text-red-300 border-red-500/40",
  "No asistió": "bg-amber-500/20 text-amber-300 border-amber-500/40",
};

function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}

function vacio() {
  return {
    id: 0,
    primerNombre: "",
    segundoNombre: "",
    tercerNombre: "",
    cuartoNombre: "",
    primerApellido: "",
    segundoApellido: "",
    apellidoCasada: "",
    candidatoNombreHistorico: "", // solo lectura: nombre completo de una entrevista vieja sin estructura, hasta que se edite
    candidatoTelefono: "",
    candidatoEmail: "",
    puesto: "",
    fecha: hoyIso(),
    hora: "09:00",
    // ATRACCION-TALENTO-2 — el entrevistador principal ahora es un usuario (no un empleado). entrevistadorEmpleadoId
    // histórico ya NO se edita desde este formulario: ver entrevistadorHistorico/entrevistadorTocado en el componente.
    entrevistadorUsuarioId: 0,
    auxiliarUsuarioId: 0,
    modalidad: "Presencial" as "Presencial" | "Virtual",
    lugarOEnlace: "",
    estado: "Programada" as Entrevista["estado"],
    resultado: "Pendiente" as Entrevista["resultado"],
    notas: "",
  };
}
type FormState = ReturnType<typeof vacio>;

/**
 * ATRACCION-TALENTO-1 — extraído de src/app/e/[slug]/rrhh/entrevistas/page.tsx
 * (ahora un redirect) para que la ruta nueva
 * src/app/e/[slug]/atraccion-talento/entrevistas/page.tsx lo reutilice sin
 * duplicar lógica. Ningún cambio de comportamiento salvo el botón "Editar"
 * explícito (antes solo la fila completa era clicable) — ver sección 7 del
 * ticket ATRACCION-TALENTO-1.
 */
export default function EntrevistasPageClient() {
  const slug = String(useParams().slug);
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1); // 1-12
  const [entrevistas, setEntrevistas] = useState<Entrevista[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioEntrevistaOpt[]>([]);
  const [puestos, setPuestos] = useState<string[]>([]);
  const [diaSel, setDiaSel] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(vacio());
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [expedienteId, setExpedienteId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // AJUSTE PR #375 — fijado al ABRIR la entrevista (no recalculado en cada tecla): distingue una entrevista histórica
  // SIN estructura (candidato_primer_nombre etc. NULL en la BD) de una ya estructurada. Se usa para decidir si la
  // identidad es obligatoria/se envía en el PATCH — independiente de que el usuario, mientras edita, empiece a
  // escribir en esos campos (eso lo cubre `tieneAlgunaParteIdentidad`, calculado en vivo más abajo).
  const [entrevistaCargadaSinEstructura, setEntrevistaCargadaSinEstructura] = useState(false);
  // ATRACCION-TALENTO-2 (sección 3) — nombre del empleado histórico cuando la entrevista NO tiene entrevistador_usuario_id
  // asignado todavía; null si no aplica. entrevistadorTocado se fija en true SOLO si el usuario cambia el selector —
  // así el PATCH nunca manda entrevistadorUsuarioId (y por lo tanto nunca limpia el histórico) al editar otro campo.
  const [entrevistadorHistorico, setEntrevistadorHistorico] = useState<string | null>(null);
  const [entrevistadorTocado, setEntrevistadorTocado] = useState(false);
  // ATRACCION-TALENTO-2 (sección 13) — true cuando el puesto se escribe libre ("Otro puesto…" o uno ya guardado que
  // no está en el catálogo actual: nunca se borra el valor existente).
  const [puestoOtro, setPuestoOtro] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/entrevistas?anio=${anio}&mes=${mes}`,
    );
    const data = await res.json();
    setEntrevistas(data.entrevistas ?? []);
    setCargando(false);
  }, [slug, anio, mes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga remota al cambiar el mes
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void (async () => {
      // ATRACCION-TALENTO-2 — el entrevistador principal/auxiliar ahora son
      // usuarios del sistema (catálogo propio: activos, con acceso a esta
      // empresa y permiso efectivo entrevistas:ver, o Admin). Reemplaza al
      // catálogo de empleados usado antes de este ticket.
      const res = await fetch(`/api/empresas/${slug}/rrhh/entrevistas/usuarios`);
      const data = await res.json();
      setUsuarios(data.usuarios ?? []);
    })();
    void (async () => {
      // ATRACCION-TALENTO-2 (sección 12) — catálogo real de puestos de esta empresa.
      const res = await fetch(`/api/empresas/${slug}/rrhh/entrevistas/puestos`);
      const data = await res.json();
      setPuestos(data.puestos ?? []);
    })();
  }, [slug]);

  // Agrupa entrevistas por día (YYYY-MM-DD) para pintar el calendario.
  const porDia = useMemo(() => {
    const map = new Map<string, Entrevista[]>();
    for (const ent of entrevistas) {
      const dia = ent.fechaHora.slice(0, 10);
      const lista = map.get(dia) ?? [];
      lista.push(ent);
      map.set(dia, lista);
    }
    return map;
  }, [entrevistas]);

  const diasDelMes = useMemo(() => {
    const total = new Date(anio, mes, 0).getDate();
    const primerDiaSemana = new Date(anio, mes - 1, 1).getDay(); // 0=Dom
    const celdas: (string | null)[] = Array(primerDiaSemana).fill(null);
    for (let d = 1; d <= total; d++) {
      celdas.push(`${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return celdas;
  }, [anio, mes]);

  function cambiarMes(delta: number) {
    let m = mes + delta;
    let a = anio;
    if (m < 1) { m = 12; a -= 1; }
    if (m > 12) { m = 1; a += 1; }
    setMes(m);
    setAnio(a);
  }

  function irAHoy() {
    setMes(hoy.getMonth() + 1);
    setAnio(hoy.getFullYear());
    seleccionarDia(hoyIso());
  }

  function abrirNueva(diaIso?: string) {
    setEditandoId(null);
    setError("");
    setMsg("");
    setEntrevistaCargadaSinEstructura(false);
    setEntrevistadorHistorico(null);
    setEntrevistadorTocado(false);
    setPuestoOtro(false);
    setForm({ ...vacio(), fecha: diaIso ?? vacio().fecha });
  }

  function seleccionarDia(diaIso: string) {
    setDiaSel(diaIso);
    setEditandoId(null);
    setError("");
    setEntrevistaCargadaSinEstructura(false);
    setEntrevistadorHistorico(null);
    setEntrevistadorTocado(false);
    setPuestoOtro(false);
    setForm((actual) => ({ ...actual, id: 0, fecha: diaIso }));
  }

  function abrirEditar(ent: Entrevista) {
    setEditandoId(ent.id);
    setError("");
    setMsg("");
    setEntrevistaCargadaSinEstructura(!tieneIdentidadEstructurada({
      primerNombre: ent.candidatoPrimerNombre ?? "", segundoNombre: ent.candidatoSegundoNombre ?? "",
      tercerNombre: ent.candidatoTercerNombre ?? "", cuartoNombre: ent.candidatoCuartoNombre ?? "",
      primerApellido: ent.candidatoPrimerApellido ?? "", segundoApellido: ent.candidatoSegundoApellido ?? "",
      apellidoCasada: ent.candidatoApellidoCasada ?? "",
    }));
    // ATRACCION-TALENTO-2 (sección 3) — si esta entrevista todavía no tiene entrevistador_usuario_id (histórica
    // con solo entrevistador_empleado_id), guardamos el nombre del empleado para mostrarlo de forma discreta; el
    // selector arranca vacío y entrevistadorTocado en false: si RRHH no lo toca, el PATCH no manda entrevistadorUsuarioId
    // y el histórico queda intacto.
    setEntrevistadorHistorico(
      ent.entrevistadorUsuarioId == null && ent.entrevistadorEmpleadoId != null
        ? (ent.entrevistadorNombre ?? "Empleado")
        : null,
    );
    setEntrevistadorTocado(false);
    setPuestoOtro(!puestos.includes(ent.puesto));
    setForm({
      id: ent.id,
      primerNombre: ent.candidatoPrimerNombre ?? "",
      segundoNombre: ent.candidatoSegundoNombre ?? "",
      tercerNombre: ent.candidatoTercerNombre ?? "",
      cuartoNombre: ent.candidatoCuartoNombre ?? "",
      primerApellido: ent.candidatoPrimerApellido ?? "",
      segundoApellido: ent.candidatoSegundoApellido ?? "",
      apellidoCasada: ent.candidatoApellidoCasada ?? "",
      candidatoNombreHistorico: ent.candidatoNombre,
      candidatoTelefono: ent.candidatoTelefono ?? "",
      candidatoEmail: ent.candidatoEmail ?? "",
      puesto: ent.puesto,
      fecha: ent.fechaHora.slice(0, 10),
      hora: ent.fechaHora.slice(11, 16),
      entrevistadorUsuarioId: ent.entrevistadorUsuarioId ?? 0,
      auxiliarUsuarioId: ent.auxiliarUsuarioId ?? 0,
      modalidad: ent.modalidad,
      lugarOEnlace: ent.lugarOEnlace ?? "",
      estado: ent.estado,
      resultado: ent.resultado,
      notas: ent.notas ?? "",
    });
  }

  // Lógica pura extraída a @/lib/rrhh/entrevista-form.ts (probada ahí con sus 12 casos: nueva/estructurada/histórica,
  // histórica que empieza a completarse, etc.) — aquí solo se usa.
  const debeIncluirIdentidad = calcularDebeIncluirIdentidad({ editando: editandoId != null, entrevistaCargadaSinEstructura, form });
  const nombreCompletoDerivado = componerNombreCompleto(form) || (entrevistaCargadaSinEstructura ? form.candidatoNombreHistorico : "");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    setError("");
    const resultadoIdentidad = construirIdentidadPatch({ editando: editandoId != null, entrevistaCargadaSinEstructura, form });
    if (!resultadoIdentidad.ok) {
      setError(resultadoIdentidad.mensaje);
      return;
    }
    setGuardando(true);
    try {
      const identidad = resultadoIdentidad.identidad; // {} en histórica intacta: candidato_nombre y las 7 columnas quedan como estaban.
      const resto = {
        candidatoTelefono: form.candidatoTelefono || null, candidatoEmail: form.candidatoEmail || null,
        puesto: form.puesto, fechaHora: `${form.fecha}T${form.hora}`,
        auxiliarUsuarioId: form.auxiliarUsuarioId || null,
        // ATRACCION-TALENTO-2 (sección 3) — al crear siempre se manda (puede ser null = sin entrevistador). Al editar
        // solo se manda si RRHH tocó el selector explícitamente: así una entrevista histórica que solo cambia de
        // fecha/notas/resultado nunca pierde su entrevistador_empleado_id (el backend limpia el histórico SOLO
        // cuando recibe esta clave — ver actualizarEntrevista en entrevistas.ts).
        ...((!editandoId || entrevistadorTocado) ? { entrevistadorUsuarioId: form.entrevistadorUsuarioId || null } : {}),
        modalidad: form.modalidad, lugarOEnlace: form.lugarOEnlace || null, notas: form.notas || null,
      };
      const body = editandoId ? { ...identidad, ...resto, estado: form.estado, resultado: form.resultado } : { ...identidad, ...resto };

      const res = editandoId
        ? await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${editandoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/empresas/${slug}/rrhh/entrevistas`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      let data: { mensaje?: string; error?: string } = {};
      try { data = await res.json(); } catch { /* respuesta sin cuerpo/no JSON */ }
      if (!res.ok) { setError(data.error || "No se pudo guardar."); return; }
      setMsg(data.mensaje || "Guardado.");
      // ATRACCION-TALENTO-1 (corrección post-revisión) — al reprogramar (o crear)
      // en otro día/mes, el panel y el calendario deben moverse solos a la
      // nueva fecha, sin F5. `form.fecha` es la fecha recién guardada.
      const nuevoDiaSel = form.fecha;
      const periodo = calcularPeriodoTrasGuardar(nuevoDiaSel, anio, mes);
      setDiaSel(nuevoDiaSel);
      setForm({ ...vacio(), fecha: nuevoDiaSel });
      setEditandoId(null);
      setEntrevistaCargadaSinEstructura(false);
      setEntrevistadorHistorico(null);
      setEntrevistadorTocado(false);
      setPuestoOtro(false);
      if (periodo.cambioPeriodo) {
        // Cambiar anio/mes cambia la identidad de `cargar` (useCallback con esas
        // deps) y dispara el useEffect que lo llama: esa única recarga ya trae
        // las entrevistas del nuevo mes. Llamar cargar() aquí duplicaría el
        // fetch con los valores de anio/mes viejos (closure de este render).
        setAnio(periodo.anio);
        setMes(periodo.mes);
      } else {
        await cargar();
      }
    } catch {
      setError("No se pudo guardar. Revisa tu conexión e intenta nuevamente.");
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstadoRapido(id: number, estado: Entrevista["estado"]) {
    await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    if (editandoId === id) setForm((f) => ({ ...f, estado }));
    await cargar();
  }

  async function cambiarResultadoRapido(id: number, resultado: Entrevista["resultado"]) {
    await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultado }),
    });
    if (editandoId === id) setForm((f) => ({ ...f, resultado }));
    await cargar();
  }

  async function eliminar(id: number) {
    await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${id}`, {
      method: "DELETE",
    });
    if (editandoId === id) {
      setForm(vacio());
      setEditandoId(null);
    }
    await cargar();
  }

  function cancelarEdicion() {
    setForm({ ...vacio(), fecha: diaSel ?? vacio().fecha });
    setEditandoId(null);
    setEntrevistaCargadaSinEstructura(false);
    setEntrevistadorHistorico(null);
    setEntrevistadorTocado(false);
    setPuestoOtro(false);
    setError("");
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";
  const entrevistasDelDia = diaSel ? porDia.get(diaSel) ?? [] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Entrevistas</h1>
          <p className="text-sm text-[var(--muted)]">
            Calendario de entrevistas de candidatos. Clic en un día para ver o programar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-sm" onClick={irAHoy}>
            Hoy
          </button>
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-2 py-1.5">
            <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-sm" onClick={() => cambiarMes(-1)}>
              ←
            </button>
            <span className="min-w-[9rem] text-center text-sm font-medium">{MESES[mes - 1]} {anio}</span>
            <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-sm" onClick={() => cambiarMes(1)}>
              →
            </button>
          </div>
        </div>
      </div>

      {/* CALENDARIO (2/3) + ENTREVISTAS DEL DÍA (1/3) en desktop; apilado en móvil/tablet. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 lg:col-span-2">
          {cargando ? <p className="mb-2 text-xs text-[var(--muted)]">Cargando…</p> : null}
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-[var(--muted)]">
            {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d) => (
              <div key={d} className="py-1">{d}</div>
            ))}
            {diasDelMes.map((diaIso, i) => {
              if (!diaIso) return <div key={`vacio-${i}`} />;
              const lista = porDia.get(diaIso) ?? [];
              const esHoy = diaIso === hoy.toISOString().slice(0, 10);
              return (
                <button
                  key={diaIso}
                  type="button"
                  onClick={() => seleccionarDia(diaIso)}
                  aria-pressed={diaSel === diaIso}
                  className={`min-h-[4.5rem] rounded border p-1 text-left text-xs transition ${
                    diaSel === diaIso
                      ? "border-[var(--accent)] bg-[var(--accent)]/10"
                      : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/50"
                  }`}
                >
                  <span className={esHoy ? "font-bold text-[var(--accent)]" : ""}>
                    {Number(diaIso.slice(8, 10))}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {lista.slice(0, 2).map((ent) => (
                      <div key={ent.id} className={`truncate rounded border px-1 ${ESTADO_COLOR[ent.estado]}`}>
                        {ent.fechaHora.slice(11, 16)} {ent.candidatoNombre}
                      </div>
                    ))}
                    {lista.length > 2 ? (
                      <div className="text-[10px] opacity-70">+{lista.length - 2} más</div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--muted)]">DÍA SELECCIONADO</h2>
          </div>
          {diaSel ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-lg font-medium">{diaSel}</p>
                <button type="button" className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white" onClick={() => abrirNueva(diaSel)}>
                  + Nueva entrevista
                </button>
              </div>
              <ul className="space-y-2">
                {entrevistasDelDia.map((ent) => (
                  <li
                    key={ent.id}
                    className={`space-y-1 rounded border px-2 py-2 text-sm ${editandoId === ent.id ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
                  >
                    <button type="button" className="block w-full text-left" onClick={() => abrirEditar(ent)}>
                      <span className="font-medium">{ent.fechaHora.slice(11, 16)}</span>{" · "}
                      {ent.candidatoNombre}
                      <span className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] ${ESTADO_COLOR[ent.estado]}`}>{ent.estado}</span>
                      <p className="text-xs text-[var(--muted)]">{ent.puesto}</p>
                      {/* ATRACCION-TALENTO-2 (sección 9) — precedencia usuario > empleado histórico; sin línea vacía
                          cuando no hay entrevistador/auxiliar. */}
                      {(() => {
                        const mostrado = resolverEntrevistadorMostrado(ent);
                        if (mostrado.tipo === "ninguno") return null;
                        return (
                          <p className="text-xs text-[var(--muted)]">
                            Entrevistador: {mostrado.nombre}
                            {mostrado.tipo === "empleado_historico" ? (
                              <span className="ml-1 rounded border border-[var(--border)] px-1 py-0.5 text-[10px]">Histórico · empleado</span>
                            ) : null}
                          </p>
                        );
                      })()}
                      {ent.auxiliarUsuarioNombre ? (
                        <p className="text-xs text-[var(--muted)]">Auxiliar: {ent.auxiliarUsuarioNombre}</p>
                      ) : null}
                    </button>
                    <div className="flex flex-wrap gap-1">
                      <select className={input} value={ent.estado} aria-label={`Estado de ${ent.candidatoNombre}`}
                        onChange={(e) => cambiarEstadoRapido(ent.id, e.target.value as Entrevista["estado"])}>
                        <option value="Programada">Programada</option>
                        <option value="Realizada">Realizada</option>
                        <option value="Cancelada">Cancelada</option>
                        <option value="No asistió">No asistió</option>
                      </select>
                      <select className={input} value={ent.resultado} aria-label={`Resultado de ${ent.candidatoNombre}`}
                        onChange={(e) => cambiarResultadoRapido(ent.id, e.target.value as Entrevista["resultado"])}>
                        <option value="Pendiente">Resultado pendiente</option>
                        <option value="Aprobado">Aprobado</option>
                        <option value="Rechazado">Rechazado</option>
                      </select>
                      {ent.resultado === "Aprobado" ? (
                        <Link href={`/e/${slug}/rrhh/empleados?entrevista=${ent.id}`} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white">
                          Crear empleado
                        </Link>
                      ) : null}
                      {/* ATRACCION-TALENTO-1 (sección 7) — botón EXPLÍCITO: antes solo la
                          tarjeta completa era clicable para editar (abrirEditar en el <button>
                          de arriba), sin ninguna etiqueta visible que lo indicara. */}
                      <button type="button" className="rounded border border-[var(--accent)] px-2 py-1 text-xs text-[var(--accent)]" onClick={() => abrirEditar(ent)}>
                        Editar
                      </button>
                      <button type="button" className="rounded bg-[#1F6AA5] px-2 py-1 text-xs text-white" onClick={() => setExpedienteId(ent.id)}>
                        Expediente
                      </button>
                      <button type="button" className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300" onClick={() => eliminar(ent.id)}>
                        Eliminar
                      </button>
                    </div>
                  </li>
                ))}
                {entrevistasDelDia.length === 0 ? (
                  <li className="text-sm text-[var(--muted)]">Sin entrevistas este día.</li>
                ) : null}
              </ul>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">Seleccioná un día del calendario para ver o programar entrevistas.</p>
          )}
        </div>
      </div>

      {/* PROGRAMAR / EDITAR ENTREVISTA — único formulario para crear y editar. */}
      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">
            {editandoId ? `Editar entrevista #${editandoId}` : "Programar entrevista"}
          </h2>
          {editandoId && form.resultado === "Aprobado" ? (
            <Link href={`/e/${slug}/rrhh/empleados?entrevista=${editandoId}`} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white">
              Crear empleado
            </Link>
          ) : null}
        </div>

        {entrevistaCargadaSinEstructura ? (
          <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Este registro fue creado con nombre completo. Puede completar los campos separados para mejorar el expediente del candidato.
          </p>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-[var(--muted)]">IDENTIDAD DEL CANDIDATO</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input className={input} placeholder="Primer nombre *" value={form.primerNombre} required={debeIncluirIdentidad}
              onChange={(e) => setForm({ ...form, primerNombre: e.target.value })} />
            <input className={input} placeholder="Segundo nombre" value={form.segundoNombre}
              onChange={(e) => setForm({ ...form, segundoNombre: e.target.value })} />
            <input className={input} placeholder="Tercer nombre" value={form.tercerNombre}
              onChange={(e) => setForm({ ...form, tercerNombre: e.target.value })} />
            <input className={input} placeholder="Cuarto nombre" value={form.cuartoNombre}
              onChange={(e) => setForm({ ...form, cuartoNombre: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input className={input} placeholder="Primer apellido *" value={form.primerApellido} required={debeIncluirIdentidad}
              onChange={(e) => setForm({ ...form, primerApellido: e.target.value })} />
            <input className={input} placeholder="Segundo apellido" value={form.segundoApellido}
              onChange={(e) => setForm({ ...form, segundoApellido: e.target.value })} />
            <input className={input} placeholder="Apellido de casada" value={form.apellidoCasada}
              onChange={(e) => setForm({ ...form, apellidoCasada: e.target.value })} />
          </div>
          <p className="text-sm">
            <span className="text-[var(--muted)]">Nombre completo: </span>
            <span className="font-medium">{nombreCompletoDerivado || "—"}</span>
          </p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-[var(--muted)]">CONTACTO</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input className={input} placeholder="Teléfono (opcional)" value={form.candidatoTelefono}
              onChange={(e) => setForm({ ...form, candidatoTelefono: e.target.value })} />
            <input className={input} type="email" placeholder="Email (opcional)" value={form.candidatoEmail}
              onChange={(e) => setForm({ ...form, candidatoEmail: e.target.value })} />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-[var(--muted)]">DATOS DE ENTREVISTA</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {/* ATRACCION-TALENTO-2 (secciones 12-13) — catálogo real de puestos de la empresa + "Otro puesto…" para
                no bloquear plazas nuevas. Un puesto ya guardado que ya no está en el catálogo sigue editable como
                texto libre (nunca se borra). */}
            {puestoOtro ? (
              <input className={input} placeholder="Escribir puesto" value={form.puesto} required
                onChange={(e) => setForm({ ...form, puesto: e.target.value })} />
            ) : (
              <select className={input} value={form.puesto} required
                onChange={(e) => {
                  if (e.target.value === OTRO_PUESTO) { setPuestoOtro(true); setForm({ ...form, puesto: "" }); return; }
                  setForm({ ...form, puesto: e.target.value });
                }}>
                <option value="">Puesto al que aplica…</option>
                {puestos.map((p) => <option key={p} value={p}>{p}</option>)}
                <option value={OTRO_PUESTO}>Otro puesto…</option>
              </select>
            )}
            <input className={input} type="date" value={form.fecha} required
              onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            <input className={input} type="time" value={form.hora} required
              onChange={(e) => setForm({ ...form, hora: e.target.value })} />
            <select className={input} value={form.modalidad}
              onChange={(e) => setForm({ ...form, modalidad: e.target.value as "Presencial" | "Virtual" })}>
              <option value="Presencial">Presencial</option>
              <option value="Virtual">Virtual</option>
            </select>
            <input className={input} placeholder={form.modalidad === "Virtual" ? "Enlace de la videollamada" : "Lugar"} value={form.lugarOEnlace}
              onChange={(e) => setForm({ ...form, lugarOEnlace: e.target.value })} />
          </div>
          {puestoOtro ? (
            <button type="button" className="text-xs text-[var(--accent)] underline" onClick={() => { setPuestoOtro(false); setForm({ ...form, puesto: "" }); }}>
              Volver al catálogo de puestos
            </button>
          ) : null}
          {/* ATRACCION-TALENTO-2 (secciones 4-8) — entrevistador principal y auxiliar ahora son usuarios del
              sistema; ambos opcionales, y el auxiliar nunca puede coincidir con el entrevistador principal
              (el backend lo valida siempre, ver actualizarEntrevista/crearEntrevista en entrevistas.ts). */}
          {entrevistadorHistorico ? (
            <p className="rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs text-[var(--muted)]">
              Entrevistador histórico (empleado): <span className="font-medium">{entrevistadorHistorico}</span>.
              Elegir un usuario abajo lo reemplaza; dejarlo vacío conserva el histórico.
            </p>
          ) : null}
          <UsuarioEntrevistaPicker
            usuarios={usuarios}
            value={form.entrevistadorUsuarioId}
            onChange={(id) => { setForm({ ...form, entrevistadorUsuarioId: id }); setEntrevistadorTocado(true); }}
            label="Entrevistador principal"
            allowEmptySelection
            emptyLabel="— Sin entrevistador —"
          />
          <UsuarioEntrevistaPicker
            usuarios={usuarios}
            value={form.auxiliarUsuarioId}
            onChange={(id) => setForm({ ...form, auxiliarUsuarioId: id })}
            label="Auxiliar de entrevista (opcional)"
            allowEmptySelection
            emptyLabel="— Sin auxiliar —"
          />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-[var(--muted)]">EVALUACIÓN</legend>
          {editandoId ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-sm text-[var(--muted)]">Estado
                <select className={`${input} mt-1 w-full`} value={form.estado}
                  onChange={(e) => setForm({ ...form, estado: e.target.value as Entrevista["estado"] })}>
                  <option value="Programada">Programada</option>
                  <option value="Realizada">Realizada</option>
                  <option value="Cancelada">Cancelada</option>
                  <option value="No asistió">No asistió</option>
                </select>
              </label>
              <label className="text-sm text-[var(--muted)]">Resultado
                <select className={`${input} mt-1 w-full`} value={form.resultado}
                  onChange={(e) => setForm({ ...form, resultado: e.target.value as Entrevista["resultado"] })}>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Aprobado">Aprobado</option>
                  <option value="Rechazado">Rechazado</option>
                </select>
              </label>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)]">Estado y resultado quedan disponibles después de guardar (también editables desde la lista del día).</p>
          )}
          <textarea
            className={`${input} w-full`}
            placeholder="Comentarios y evaluación: experiencia, fortalezas, disponibilidad, observaciones y motivo del resultado (opcional)"
            aria-label="Comentarios y evaluación de la entrevista"
            rows={4}
            value={form.notas}
            onChange={(e) => setForm({ ...form, notas: e.target.value })}
          />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-[var(--muted)]">DOCUMENTOS</legend>
          {editandoId ? (
            <EntrevistaDocumentos slug={slug} entrevistaId={editandoId} />
          ) : (
            <p className="text-xs text-[var(--muted)]">Guarde primero la entrevista para habilitar la papelería del candidato.</p>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={guardando}>
            {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Programar entrevista"}
          </button>
          {editandoId ? (
            <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-sm" onClick={cancelarEdicion}>
              Cancelar edición
            </button>
          ) : null}
          {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
          {msg ? <p role="status" className="text-sm text-emerald-300">{msg}</p> : null}
        </div>
      </form>

      {expedienteId ? (
        <ExpedienteCandidato slug={slug} entrevistaId={expedienteId} onClose={() => setExpedienteId(null)} />
      ) : null}
    </div>
  );
}
