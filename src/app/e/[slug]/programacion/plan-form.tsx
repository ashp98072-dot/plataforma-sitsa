"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ClienteSearch } from "@/components/tms/cliente-search";
import { PlacaSelect, type VehiculoOpt } from "@/components/tms/placa-select";
import { PilotoSelect } from "@/components/tms/piloto-select";
import { RutaSelect, type RutaOpt } from "@/components/tms/ruta-select";
import ViaticosPanel from "@/components/tms/viaticos-panel";
import type { Plan } from "./programacion-client";
import NotificarPersonal from "./notificar-personal";

/**
 * Formulario propio de Programación para crear/editar un viaje — reutiliza
 * los MISMOS componentes pequeños (ClienteSearch, PlacaSelect, PilotoSelect,
 * ViaticosPanel) y los MISMOS endpoints (POST/PATCH /tms/planes, GET /tms/
 * catalogos, GET /rrhh/personal-ops, GET /tms/viaticos-config vía
 * ViaticosPanel) que ya usa src/app/e/[slug]/tms/page.tsx — sin tocar ese
 * archivo. No hay modelo, tabla ni endpoint nuevo: es la misma "plomería"
 * de formulario, en una pantalla distinta.
 *
 * Modo creación: sin `plan`. Modo edición: con `plan` (el objeto que ya
 * entrega GET /tms/planes, incluido en el tablero de Programación).
 */

type ParadaForm = {
  lugarNombre: string;
  tipo: "Carga" | "Descarga" | "Entrega";
  requiereEvidencia: boolean;
  /** VIAT-1: ubicación guardada del cliente de la que salió esta parada (si se eligió del catálogo). */
  clienteUbicacionId?: number | null;
};

type TipoUbicacion = "CARGA" | "ENTREGA" | "AMBOS";

type UbicacionCliente = {
  id: number;
  nombre: string;
  direccion: string | null;
  municipio: string | null;
  departamento: string | null;
  referencia: string | null;
  tipo: TipoUbicacion;
};

type EmpOps = {
  id: number;
  codigo: string;
  nombre: string;
  puesto?: string;
  categoriaOps: string;
};

type ClienteCat = {
  id: number;
  nombre: string;
  codigo?: string | null;
  nit?: string | null;
  telefono?: string | null;
  estado?: string | null;
};

// Mismo criterio que planes/route.ts (ESTADOS_SOLO_NOTAS / ESTADOS_BLOQUEADOS)
// — solo para avisar en la UI; el servidor es quien realmente lo hace cumplir.
const ESTADOS_SOLO_NOTAS = new Set(["En ruta"]);
const ESTADOS_BLOQUEADOS = new Set(["Descargado", "Cerrado", "Cancelado"]);

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

function filtrarPersonal(list: EmpOps[], q: string, selectedIds: number[]) {
  const term = q.trim().toLowerCase();
  const selected = list.filter((p) => selectedIds.includes(p.id));
  const rest = term
    ? list.filter(
        (p) => !selectedIds.includes(p.id) && `${p.nombre} ${p.codigo}`.toLowerCase().includes(term),
      )
    : list.filter((p) => !selectedIds.includes(p.id));
  return [...selected, ...rest.slice(0, 80)];
}

export default function PlanForm({
  slug,
  hoy,
  fechaSugerida,
  plan,
  onSaved,
  onCancel,
}: {
  slug: string;
  /**
   * Fecha "hoy" en America/Guatemala (hoyLocal(), calculada server-side en
   * page.tsx y bajada por props hasta aquí) — NUNCA new Date().toISOString(),
   * que es UTC y en horas de la tarde/noche en Guatemala ya cae en el día
   * siguiente. Bug corregido: un viaje creado sin tocar la fecha quedaba con
   * fecha_plan = mañana (UTC) mientras el tablero, filtrado por "Hoy",
   * mostraba el día real en Guatemala — el viaje existía pero nunca
   * aparecía bajo ese filtro.
   */
  hoy: string;
  /**
   * VIAT-4 (punto 5) — fecha por defecto al CREAR un viaje nuevo, coherente
   * con la vista actual (Hoy/Mañana/Semana) de Programación en vez de
   * siempre "hoy". Si no se pasa, cae a `hoy` (mismo comportamiento previo).
   */
  fechaSugerida?: string;
  plan?: Plan | null;
  onSaved: (info: { id: number; fechaPlan: string }) => void;
  onCancel?: () => void;
}) {
  const esEdicion = plan != null;

  const [clientesCat, setClientesCat] = useState<ClienteCat[]>([]);
  const [pilotos, setPilotos] = useState<EmpOps[]>([]);
  const [auxiliares, setAuxiliares] = useState<EmpOps[]>([]);
  const [vehiculosDisponibles, setVehiculosDisponibles] = useState<VehiculoOpt[]>([]);
  const [resumenFlota, setResumenFlota] = useState({ disponibles: 0, enTaller: 0, enRuta: 0 });

  // Precarga de piloto/auxiliares del plan (edición): se resuelve por
  // NOMBRE contra el roster de RRHH ya cargado — mismo criterio ya
  // usado en tms/page.tsx (seleccionarPlan()), no se inventa un cruce nuevo.
  const [form, setForm] = useState({
    codigo: plan?.codigo ?? "",
    fechaPlan: plan?.fecha_plan ?? fechaSugerida ?? hoy,
    horaCarga: plan?.hora_carga?.slice(0, 5) ?? "08:00",
    clienteId: 0,
    clienteNombre: plan?.cliente ?? "",
    placa: plan?.placa ?? "",
    pilotoEmpleadoId: 0,
    pilotoNombre: plan?.piloto ?? "",
    auxiliarEmpleadoIds: [] as number[],
    auxiliarNombres: [] as string[],
    tipoTraslado: plan?.tipo_traslado ?? "",
    regresoEstimado: plan?.regreso_estimado?.slice(0, 16) ?? "",
    tarifaComercial: plan?.tarifa_comercial != null ? String(plan.tarifa_comercial) : "",
    referenciaCliente: plan?.referencia_cliente ?? "",
    // VIAT-4: fotografía histórica de qué ruta maestra se usó — solo
    // informativo, se recalcula al elegir otra ruta; no bloquea guardar
    // el viaje sin ruta (código/ruta sigue siendo opcional).
    rutaId: plan?.ruta_id ?? 0,
    rutaCodigo: plan?.ruta_codigo_historico ?? "",
    notas: plan?.notas ?? "",
    estado: plan?.estado ?? "Programado",
  });
  // VIAT-4: contacto de la ruta elegida — solo para mostrarlo en pantalla
  // (comunicación operativa), NO se copia al viaje (ver nota de diseño en
  // sql/migrate-2026-08-viat-4-contactos-rutas.sql: el contacto se
  // consulta en vivo, no es parte de la fotografía histórica).
  const [contactoRuta, setContactoRuta] = useState<{ nombre: string; cargo: string | null; telefono: string | null } | null>(null);
  const [paradasForm, setParadasForm] = useState<ParadaForm[]>(
    plan?.paradas?.length
      ? plan.paradas.map((p) => ({
          lugarNombre: p.lugar_nombre,
          tipo: (["Carga", "Descarga", "Entrega"].includes(p.tipo) ? p.tipo : "Entrega") as ParadaForm["tipo"],
          requiereEvidencia: p.requiere_evidencia,
        }))
      : [
          { lugarNombre: "", tipo: "Carga", requiereEvidencia: true },
          { lugarNombre: "", tipo: "Entrega", requiereEvidencia: true },
        ],
  );
  const [auxInput, setAuxInput] = useState("");
  const [saving, setSaving] = useState(false);

  // VIAT-1: ubicaciones guardadas del cliente seleccionado, para armar
  // paradas rápido en vez de escribir la dirección cada vez.
  const [ubicacionesCliente, setUbicacionesCliente] = useState<UbicacionCliente[]>([]);
  const [nuevaUbicacion, setNuevaUbicacion] = useState({ nombre: "", direccion: "" });
  const [mostrarNuevaUbicacion, setMostrarNuevaUbicacion] = useState(false);
  const [guardandoUbicacion, setGuardandoUbicacion] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const cargarCatalogos = useCallback(async () => {
    const [resPlanes, cat, ops] = await Promise.all([
      fetch(`/api/empresas/${slug}/tms/planes`),
      fetch(`/api/empresas/${slug}/tms/catalogos`),
      fetch(`/api/empresas/${slug}/rrhh/personal-ops?tipo=all`),
    ]);
    if (resPlanes.ok) {
      const data = await resPlanes.json();
      const vd =
        (data.vehiculosDisponibles as VehiculoOpt[] | undefined) ??
        ((data.placasFlota as string[] | undefined) ?? []).map((p) => ({ placa: p }));
      setVehiculosDisponibles(vd);
      const rf = data.resumenFlota ?? {};
      setResumenFlota({
        disponibles: Number(rf.disponibles ?? vd.length),
        enTaller: Number(rf.enTaller ?? 0),
        enRuta: Number(rf.enRuta ?? 0),
      });
    }
    if (cat.ok) {
      const c = await cat.json();
      setClientesCat((c.clientes ?? []) as ClienteCat[]);
    }
    if (ops.ok) {
      const o = await ops.json();
      const list = (o.personal ?? []) as EmpOps[];
      const match = (p: EmpOps, kind: "piloto" | "auxiliar") => {
        const catOps = (p.categoriaOps || "").toLowerCase();
        const puesto = (p.puesto || "").toLowerCase();
        return kind === "piloto"
          ? p.categoriaOps === "Piloto" || catOps.includes("piloto") || puesto.includes("piloto")
          : p.categoriaOps === "Auxiliar" || catOps.includes("auxiliar") || puesto.includes("auxiliar");
      };
      const pilotosFil = list.filter((p) => match(p, "piloto"));
      const auxFil = list.filter((p) => match(p, "auxiliar"));
      setPilotos(pilotosFil.length ? pilotosFil : list);
      setAuxiliares(auxFil.length ? auxFil : list);
    }
  }, [slug]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      await cargarCatalogos();
      if (ignore) return;
    })();
    return () => {
      ignore = true;
    };
  }, [cargarCatalogos]);

  // Cuando el roster de auxiliares ya cargó, precarga los auxiliares
  // actuales del plan (edición) por nombre — una sola vez por plan.
  useEffect(() => {
    if (!plan || !auxiliares.length) return;
    const nombres = plan.auxiliares?.length
      ? plan.auxiliares
      : plan.auxiliar
        ? plan.auxiliar.split(",").map((x) => x.trim()).filter(Boolean)
        : [];
    if (!nombres.length) return;
    const ids: number[] = [];
    const libres: string[] = [];
    for (const n of nombres) {
      const m = auxiliares.find((a) => a.nombre.toLowerCase() === n.toLowerCase());
      if (m) ids.push(m.id);
      else libres.push(n);
    }
    // Precarga best-effort, una sola vez por plan al cargar el roster — no
    // es un fetch async por lo que no aplica el patrón IIFE; mismo criterio
    // ya usado en tms/page.tsx (ver su useEffect de cargar()).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((f) => ({
      ...f,
      auxiliarEmpleadoIds: ids.slice(0, 8),
      auxiliarNombres: libres.slice(0, 8 - ids.length),
    }));
    // Solo al cargar auxiliares por primera vez para este plan — no se quiere
    // repisar una edición del usuario en cada recarga de catálogos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id, auxiliares.length]);

  // Precarga best-effort del id del piloto ya asignado (edición), igual
  // que con auxiliares — solo una vez por plan.
  useEffect(() => {
    if (!plan || !pilotos.length || form.pilotoEmpleadoId) return;
    const m = pilotos.find((p) => p.nombre.toLowerCase() === (plan.piloto ?? "").toLowerCase());
    if (m) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm((f) => ({ ...f, pilotoEmpleadoId: m.id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id, pilotos.length]);

  useEffect(() => {
    if (!plan?.cliente || !clientesCat.length || form.clienteId) return;
    const m = clientesCat.find((c) => c.nombre === plan.cliente);
    if (m) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm((f) => ({ ...f, clienteId: m.id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientesCat.length, plan?.cliente]);

  // VIAT-1: recarga las ubicaciones guardadas cada vez que cambia el
  // cliente elegido — IIFE inline con bandera `ignore` (mismo patrón que
  // ViaticosPanel), no un setState síncrono directo en el efecto.
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!form.clienteId) {
        setUbicacionesCliente([]);
        return;
      }
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/clientes/${form.clienteId}/ubicaciones`);
        const data = await res.json();
        if (ignore) return;
        setUbicacionesCliente(res.ok ? ((data.ubicaciones ?? []) as UbicacionCliente[]) : []);
      } catch {
        if (!ignore) setUbicacionesCliente([]);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug, form.clienteId]);

  /**
   * Rellena la fila de parada EXISTENTE `idx` con la ubicación guardada
   * elegida — nunca crea una fila nueva ni toca el tipo (Carga/Entrega) que
   * esa fila ya tenía: el tipo de la ubicación (CARGA/ENTREGA/AMBOS) es solo
   * una sugerencia para ORDENAR las opciones del selector, no algo que
   * sobrescriba silenciosamente la fila. Para agregar una parada nueva se
   * usa el botón "+ Agregar parada" de siempre y luego se elige la
   * ubicación en esa fila.
   */
  function seleccionarUbicacionParaFila(idx: number, ubicacionId: number) {
    const u = ubicacionesCliente.find((x) => x.id === ubicacionId);
    if (!u) return;
    setParadasForm((list) =>
      list.map((row, i) =>
        i === idx
          ? { ...row, lugarNombre: u.direccion?.trim() || u.nombre, clienteUbicacionId: u.id }
          : row,
      ),
    );
  }

  /** Ubicaciones de este cliente ordenadas: primero las que coinciden con el tipo de la fila (o AMBOS), luego el resto. */
  function ubicacionesParaFila(tipoFila: ParadaForm["tipo"]): UbicacionCliente[] {
    const tipoUbic: TipoUbicacion = tipoFila === "Carga" ? "CARGA" : "ENTREGA";
    return [...ubicacionesCliente].sort((a, b) => {
      const aMatch = a.tipo === tipoUbic || a.tipo === "AMBOS" ? 0 : 1;
      const bMatch = b.tipo === tipoUbic || b.tipo === "AMBOS" ? 0 : 1;
      return aMatch - bMatch || a.nombre.localeCompare(b.nombre);
    });
  }

  async function guardarNuevaUbicacion() {
    if (!form.clienteId) {
      setError("Selecciona primero un cliente para guardarle una ubicación.");
      return;
    }
    const nombre = nuevaUbicacion.nombre.trim();
    if (!nombre) {
      setError("Indica un nombre/alias para la ubicación (ej. Bodega Central).");
      return;
    }
    setGuardandoUbicacion(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/clientes/${form.clienteId}/ubicaciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, direccion: nuevaUbicacion.direccion.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar la ubicación.");
        return;
      }
      const nueva = data.ubicacion as UbicacionCliente;
      // Solo queda disponible para elegir en el selector de cada fila — no
      // crea ninguna parada por su cuenta (punto 1: nunca una fila
      // inesperada).
      setUbicacionesCliente((list) => [...list, nueva].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNuevaUbicacion({ nombre: "", direccion: "" });
      setMostrarNuevaUbicacion(false);
      setMsg(`Ubicación "${nueva.nombre}" guardada — ya puedes elegirla en cualquier fila de parada.`);
    } catch {
      setError("Error de conexión.");
    } finally {
      setGuardandoUbicacion(false);
    }
  }

  const auxiliaresFiltrados = useMemo(
    () => filtrarPersonal(auxiliares, auxInput, form.auxiliarEmpleadoIds),
    [auxiliares, auxInput, form.auxiliarEmpleadoIds],
  );

  function totalAux() {
    return form.auxiliarEmpleadoIds.length + form.auxiliarNombres.length;
  }

  function toggleAux(id: number) {
    setForm((f) => {
      const has = f.auxiliarEmpleadoIds.includes(id);
      if (has) return { ...f, auxiliarEmpleadoIds: f.auxiliarEmpleadoIds.filter((x) => x !== id) };
      if (f.auxiliarEmpleadoIds.length + f.auxiliarNombres.length >= 8) return f;
      return { ...f, auxiliarEmpleadoIds: [...f.auxiliarEmpleadoIds, id] };
    });
  }

  function agregarAuxNombre() {
    const t = auxInput.trim();
    if (t.length < 2) return;
    const matchExact = auxiliares.find((p) => p.nombre.toLowerCase() === t.toLowerCase());
    const soloUno =
      !matchExact &&
      auxiliaresFiltrados.filter((p) => !form.auxiliarEmpleadoIds.includes(p.id)).length === 1
        ? auxiliaresFiltrados.find((p) => !form.auxiliarEmpleadoIds.includes(p.id))
        : null;
    const pick = matchExact ?? soloUno ?? null;
    if (pick) {
      setForm((f) => {
        if (f.auxiliarEmpleadoIds.includes(pick.id)) return f;
        if (f.auxiliarEmpleadoIds.length + f.auxiliarNombres.length >= 8) return f;
        return { ...f, auxiliarEmpleadoIds: [...f.auxiliarEmpleadoIds, pick.id] };
      });
      setAuxInput("");
      return;
    }
    setForm((f) => {
      if (f.auxiliarEmpleadoIds.length + f.auxiliarNombres.length >= 8) return f;
      if (f.auxiliarNombres.some((n) => n.toLowerCase() === t.toLowerCase())) return f;
      return { ...f, auxiliarNombres: [...f.auxiliarNombres, t] };
    });
    setAuxInput("");
  }

  /**
   * VIAT-4 — al elegir una ruta del catálogo (Código/Ruta), COPIA sus
   * datos al formulario (fotografía histórica): cliente (modo A: buscar
   * por código sin cliente elegido), hora habitual, ruta_id/código, y las
   * paradas (carga + destinos, en orden). El programador puede seguir
   * editando cualquiera de estos campos después para ESTE viaje sin
   * modificar la ruta maestra — es una copia, no una referencia en vivo.
   * El contacto NO se copia (se muestra en vivo, ver contactoRuta).
   */
  function aplicarRuta(ruta: RutaOpt) {
    setForm((f) => ({
      ...f,
      clienteId: ruta.clienteId,
      clienteNombre: ruta.clienteNombre,
      horaCarga: ruta.horaHabitual || f.horaCarga,
      rutaId: ruta.id,
      rutaCodigo: ruta.codigo,
    }));
    setContactoRuta(
      ruta.contactoNombre
        ? { nombre: ruta.contactoNombre, cargo: ruta.contactoCargo, telefono: ruta.contactoTelefono }
        : null,
    );
    const nuevasParadas: ParadaForm[] = [];
    if (ruta.lugarCargaTexto) {
      nuevasParadas.push({ lugarNombre: ruta.lugarCargaTexto, tipo: "Carga", requiereEvidencia: true, clienteUbicacionId: ruta.ubicacionCargaId });
    }
    for (const p of ruta.paradas) {
      nuevasParadas.push({
        lugarNombre: p.lugarNombre,
        tipo: (["Carga", "Descarga", "Entrega"].includes(p.tipo) ? p.tipo : "Entrega") as ParadaForm["tipo"],
        requiereEvidencia: true,
        clienteUbicacionId: p.clienteUbicacionId,
      });
    }
    if (nuevasParadas.length) setParadasForm(nuevasParadas);
  }

  // Se evalúa contra el estado ORIGINAL del plan (antes de este guardado),
  // igual que el servidor (ver ESTADOS_SOLO_NOTAS en planes/route.ts) — la
  // transición de estado en sí siempre está permitida; lo que se restringe
  // son los DEMÁS campos mientras el viaje ya está en ruta. Si se usara
  // form.estado (el valor pendiente en el <select>), cambiar el estado como
  // parte de este mismo guardado bloquearía por error los demás campos.
  const soloNotas = esEdicion && ESTADOS_SOLO_NOTAS.has(plan!.estado);
  const bloqueado = esEdicion && ESTADOS_BLOQUEADOS.has(plan!.estado);

  // VIAT-2: el servidor exige regreso_estimado cuando el plan queda con
  // piloto, auxiliares o unidad asignados (lo necesita para poder validar
  // traslapes) — esto es solo ayuda de UI, la regla real la aplica
  // planes/route.ts.
  const requiereRegreso = Boolean(
    form.pilotoEmpleadoId ||
      form.pilotoNombre.trim() ||
      form.auxiliarEmpleadoIds.length ||
      form.auxiliarNombres.length ||
      form.placa.trim(),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || bloqueado) return;
    setError("");
    setMsg("");
    const paradas = paradasForm
      .filter((p) => p.lugarNombre.trim())
      .map((p) => ({
        lugarNombre: p.lugarNombre.trim(),
        tipo: p.tipo,
        requiereEvidencia: p.requiereEvidencia,
        clienteUbicacionId: p.clienteUbicacionId ?? undefined,
      }));

    if (!esEdicion) {
      if (!form.clienteId && !form.clienteNombre.trim()) {
        setError("Busca y selecciona un cliente (o escribe el nombre).");
        return;
      }
      if (!form.pilotoEmpleadoId && !form.pilotoNombre.trim()) {
        setError("Indica el piloto (elige de RRHH o escríbelo).");
        return;
      }
      if (!paradas.length) {
        setError("Agrega al menos una parada (lugar) con evidencia de producto.");
        return;
      }
    }
    const salidaProgramada = `${form.fechaPlan}T${form.horaCarga || "00:00"}`;
    if (form.regresoEstimado && form.regresoEstimado <= salidaProgramada) {
      setError("El regreso estimado debe ser posterior a la salida programada.");
      return;
    }
    if (requiereRegreso && !form.regresoEstimado) {
      setError(
        "Indica el regreso estimado: es obligatorio para poder validar disponibilidad cuando hay piloto, auxiliares o unidad asignados.",
      );
      return;
    }

    setSaving(true);
    try {
      if (!esEdicion) {
        const res = await fetch(`/api/empresas/${slug}/tms/planes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            codigo: form.codigo || undefined,
            fechaPlan: form.fechaPlan,
            horaCarga: form.horaCarga,
            tipoTraslado: form.tipoTraslado || undefined,
            regresoEstimado: form.regresoEstimado || undefined,
            tarifaComercial: form.tarifaComercial === "" ? undefined : Number(form.tarifaComercial),
            referenciaCliente: form.referenciaCliente.trim() || undefined,
            rutaId: form.rutaId || undefined,
            rutaCodigo: form.rutaCodigo.trim() || undefined,
            notas: form.notas.trim() || undefined,
            clienteId: form.clienteId || undefined,
            clienteNombre: form.clienteNombre.trim() || undefined,
            placa: form.placa || undefined,
            pilotoEmpleadoId: form.pilotoEmpleadoId || undefined,
            pilotoNombre: form.pilotoNombre.trim() || undefined,
            auxiliarEmpleadoIds: form.auxiliarEmpleadoIds.length ? form.auxiliarEmpleadoIds : undefined,
            auxiliarNombres: form.auxiliarNombres.length ? form.auxiliarNombres : undefined,
            paradas,
            lugarCarga: paradas.find((p) => p.tipo === "Carga")?.lugarNombre,
            lugarDescarga: paradas.find((p) => p.tipo === "Descarga" || p.tipo === "Entrega")?.lugarNombre,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "No se pudo crear el viaje.");
          return;
        }
        setMsg(data.mensaje ?? "Viaje creado.");
        onSaved({ id: Number(data.id), fechaPlan: form.fechaPlan });
        return;
      }

      const res = await fetch(`/api/empresas/${slug}/tms/planes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plan!.id,
          fechaPlan: soloNotas ? undefined : form.fechaPlan || undefined,
          horaCarga: soloNotas ? undefined : form.horaCarga || undefined,
          pilotoNombre: soloNotas ? undefined : form.pilotoNombre.trim() || undefined,
          placa: soloNotas ? undefined : form.placa.trim() || undefined,
          estado: form.estado !== plan!.estado ? form.estado : undefined,
          auxiliarEmpleadoIds: soloNotas ? undefined : form.auxiliarEmpleadoIds,
          auxiliarNombres: soloNotas ? undefined : form.auxiliarNombres,
          tipoTraslado: undefined,
          regresoEstimado: soloNotas ? undefined : form.regresoEstimado || null,
          tarifaComercial: soloNotas
            ? undefined
            : form.tarifaComercial === ""
              ? null
              : Number(form.tarifaComercial),
          referenciaCliente: soloNotas ? undefined : form.referenciaCliente.trim() || null,
          rutaId: soloNotas ? undefined : form.rutaId || undefined,
          rutaCodigo: soloNotas ? undefined : form.rutaCodigo.trim() || undefined,
          notas: form.notas.trim() || undefined,
          paradas: soloNotas || !paradas.length ? undefined : paradas,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo actualizar el viaje.");
        return;
      }
      setMsg(data.mensaje ?? "Viaje actualizado.");
      if (Array.isArray(data.advertencias) && data.advertencias.length) {
        setMsg(
          `${data.mensaje ?? "Viaje actualizado."} — ${data.advertencias.map((a: { mensaje: string }) => a.mensaje).join(" · ")}`,
        );
      }
      onSaved({ id: plan!.id, fechaPlan: form.fechaPlan });
    } catch {
      setError("Error de conexión.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 md:grid-cols-3"
    >
      <div className="md:col-span-3 flex items-center justify-between">
        <p className="text-sm font-medium">
          {esEdicion ? `Editar viaje ${plan!.codigo}` : "Nuevo viaje"}
        </p>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="text-xs text-[var(--muted)] hover:underline">
            Cerrar
          </button>
        ) : null}
      </div>

      {bloqueado ? (
        <p className="md:col-span-3 rounded bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
          Este viaje está &quot;{plan!.estado}&quot; y ya no admite modificaciones desde Programación.
        </p>
      ) : null}
      {soloNotas ? (
        <p className="md:col-span-3 rounded bg-sky-900/30 px-3 py-2 text-xs text-sky-200">
          El viaje está &quot;En ruta&quot;: solo se pueden editar notas mientras dura el viaje.
        </p>
      ) : null}

      {!esEdicion ? (
        <label className="text-xs text-[var(--muted)]">
          Código plan (automático)
          <input className={`${inputCls} mt-1 w-full font-mono`} value={form.codigo} readOnly placeholder="Se genera al guardar…" />
        </label>
      ) : null}
      <label className="text-xs text-[var(--muted)]">
        Fecha
        <input
          type="date"
          className={`${inputCls} mt-1 w-full`}
          value={form.fechaPlan}
          disabled={soloNotas || bloqueado}
          onChange={(e) => setForm((f) => ({ ...f, fechaPlan: e.target.value }))}
        />
      </label>
      <label className="text-xs text-[var(--muted)]">
        Hora programada de salida/carga
        <input
          type="time"
          className={`${inputCls} mt-1 w-full`}
          value={form.horaCarga}
          disabled={soloNotas || bloqueado}
          onChange={(e) => setForm((f) => ({ ...f, horaCarga: e.target.value }))}
        />
      </label>

      <div className={soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""}>
        <ClienteSearch
          clientes={clientesCat}
          valueNombre={form.clienteNombre}
          valueId={form.clienteId}
          inputClassName={inputCls}
          onChange={({ clienteId, clienteNombre }) => setForm((f) => ({ ...f, clienteId, clienteNombre }))}
        />
      </div>
      <div className={soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""}>
        <RutaSelect
          slug={slug}
          clienteId={form.clienteId}
          value={form.rutaCodigo}
          inputClassName={inputCls}
          onSeleccionar={aplicarRuta}
        />
        {contactoRuta ? (
          <p className="mt-1 rounded border border-[var(--border)] bg-black/10 px-2 py-1 text-[11px] text-[var(--muted)]">
            Contacto: <span className="text-[var(--foreground)]">{contactoRuta.nombre}</span>
            {contactoRuta.cargo ? ` · ${contactoRuta.cargo}` : ""}
            {contactoRuta.telefono ? ` · ${contactoRuta.telefono}` : ""}
          </p>
        ) : null}
      </div>
      <div className={soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""}>
        <PlacaSelect
          value={form.placa}
          options={vehiculosDisponibles}
          resumen={resumenFlota}
          inputClassName={inputCls}
          onChange={(placa) => setForm((f) => ({ ...f, placa }))}
        />
      </div>
      <div className={soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""}>
        <PilotoSelect
          pilotos={pilotos}
          empleadoId={form.pilotoEmpleadoId}
          nombre={form.pilotoNombre}
          inputClassName={inputCls}
          onChange={({ empleadoId, nombre }) => setForm((f) => ({ ...f, pilotoEmpleadoId: empleadoId, pilotoNombre: nombre }))}
        />
      </div>

      <div
        className={`md:col-span-3 space-y-2 rounded border border-[var(--border)] p-3 ${
          soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <p className="text-xs text-[var(--muted)]">
          Auxiliares (máx. 8) — {totalAux()}/8. Filtra por nombre, marca de RRHH o Enter para agregar.
        </p>
        <div className="flex gap-2">
          <input
            className={`${inputCls} flex-1`}
            placeholder="Filtrar / escribir auxiliar y Enter"
            value={auxInput}
            onChange={(e) => setAuxInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregarAuxNombre();
              }
            }}
          />
          <button type="button" className="rounded bg-[#334155] px-3 py-1 text-xs text-white" onClick={agregarAuxNombre}>
            Agregar
          </button>
        </div>
        {form.auxiliarNombres.length ? (
          <ul className="flex flex-wrap gap-2">
            {form.auxiliarNombres.map((n) => (
              <li key={n} className="flex items-center gap-1 rounded border border-sky-700 bg-sky-950/30 px-2 py-1 text-xs">
                {n}
                <button
                  type="button"
                  className="text-red-300"
                  onClick={() => setForm((f) => ({ ...f, auxiliarNombres: f.auxiliarNombres.filter((x) => x !== n) }))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto overscroll-contain">
          {auxiliaresFiltrados.map((p) => {
            const on = form.auxiliarEmpleadoIds.includes(p.id);
            return (
              <label
                key={p.id}
                className={[
                  "flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs",
                  on ? "border-sky-500 bg-sky-950/40" : "border-[var(--border)]",
                ].join(" ")}
              >
                <input type="checkbox" checked={on} disabled={!on && totalAux() >= 8} onChange={() => toggleAux(p.id)} />
                {p.nombre}
              </label>
            );
          })}
          {!auxiliaresFiltrados.length ? <p className="text-xs text-[var(--muted)]">Sin coincidencias.</p> : null}
        </div>
      </div>

      <label className={`text-xs text-[var(--muted)] ${soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""}`}>
        Tipo de traslado
        <input
          className={`${inputCls} mt-1 w-full`}
          value={form.tipoTraslado}
          placeholder="Ej. Carga completa, paquetería…"
          onChange={(e) => setForm((f) => ({ ...f, tipoTraslado: e.target.value }))}
        />
      </label>
      <label className={`text-xs text-[var(--muted)] ${soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""}`}>
        Regreso estimado{requiereRegreso ? " (obligatorio)" : ""}
        <input
          type="datetime-local"
          required={requiereRegreso}
          className={`${inputCls} mt-1 w-full`}
          value={form.regresoEstimado}
          onChange={(e) => setForm((f) => ({ ...f, regresoEstimado: e.target.value }))}
        />
        {requiereRegreso ? (
          <span className="mt-0.5 block text-[10px] text-amber-300/90">
            Necesario para validar que piloto/auxiliares/unidad no queden asignados a dos viajes a la vez.
          </span>
        ) : null}
      </label>
      <label className={`text-xs text-[var(--muted)] ${soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""}`}>
        Tarifa comercial (GTQ)
        <input
          type="number"
          min="0"
          step="0.01"
          className={`${inputCls} mt-1 w-full`}
          value={form.tarifaComercial}
          onChange={(e) => setForm((f) => ({ ...f, tarifaComercial: e.target.value }))}
        />
      </label>

      <label className={`md:col-span-2 text-xs text-[var(--muted)] ${soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""}`}>
        Referencia del cliente
        <input
          className={`${inputCls} mt-1 w-full`}
          placeholder="OC, pedido o referencia"
          value={form.referenciaCliente}
          onChange={(e) => setForm((f) => ({ ...f, referenciaCliente: e.target.value }))}
        />
      </label>
      {esEdicion ? (
        <label className="text-xs text-[var(--muted)]">
          Estado
          <select
            className={`${inputCls} mt-1 w-full`}
            value={form.estado}
            disabled={bloqueado}
            onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value }))}
          >
            {["Programado", "En ruta", "Cargado", "Descargado", "Cerrado", "Cancelado"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="md:col-span-3 text-xs text-[var(--muted)]">
        Observaciones
        <textarea
          className={`${inputCls} mt-1 w-full`}
          rows={2}
          value={form.notas}
          onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
        />
      </label>

      <div
        className={`md:col-span-3 space-y-2 rounded border border-[var(--border)] p-3 ${
          soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <p className="text-xs font-medium">Paradas del viaje</p>

        {form.clienteId ? (
          <div className="rounded border border-[var(--border)] bg-black/10 p-2">
            <p className="text-[11px] text-[var(--muted)]">
              {ubicacionesCliente.length
                ? `${ubicacionesCliente.length} ubicación(es) guardada(s) de ${form.clienteNombre || "este cliente"} — elígelas en el selector de cada fila.`
                : `Sin ubicaciones guardadas de ${form.clienteNombre || "este cliente"} todavía.`}
            </p>
            <div className="mt-1">
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:border-[var(--accent)]/60"
                onClick={() => setMostrarNuevaUbicacion((v) => !v)}
              >
                {mostrarNuevaUbicacion ? "Cancelar" : "+ Guardar nueva ubicación"}
              </button>
            </div>
            {mostrarNuevaUbicacion ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-[11px] text-[var(--muted)]">
                  Nombre/alias
                  <input
                    className={`${inputCls} mt-0.5 block w-40`}
                    placeholder="Ej. Bodega Central"
                    value={nuevaUbicacion.nombre}
                    onChange={(e) => setNuevaUbicacion((n) => ({ ...n, nombre: e.target.value }))}
                  />
                </label>
                <label className="text-[11px] text-[var(--muted)]">
                  Dirección
                  <input
                    className={`${inputCls} mt-0.5 block w-56`}
                    value={nuevaUbicacion.direccion}
                    onChange={(e) => setNuevaUbicacion((n) => ({ ...n, direccion: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  disabled={guardandoUbicacion}
                  onClick={() => void guardarNuevaUbicacion()}
                  className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  {guardandoUbicacion ? "Guardando…" : "Guardar ubicación"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {paradasForm.map((p, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-2">
            <span className="w-6 text-xs text-[var(--muted)]">{idx + 1}.</span>
            <input
              className={`${inputCls} min-w-[160px] flex-1`}
              value={p.lugarNombre}
              onChange={(e) =>
                setParadasForm((list) =>
                  list.map((x, i) =>
                    // Escribir a mano desvincula la fila de la ubicación guardada
                    // que tuviera antes — lugarNombre vuelve a ser texto libre.
                    i === idx ? { ...x, lugarNombre: e.target.value, clienteUbicacionId: null } : x,
                  ),
                )
              }
            />
            <select
              className={inputCls}
              value={p.tipo}
              onChange={(e) =>
                setParadasForm((list) => list.map((x, i) => (i === idx ? { ...x, tipo: e.target.value as ParadaForm["tipo"] } : x)))
              }
            >
              <option value="Carga">Carga</option>
              <option value="Entrega">Entrega</option>
              <option value="Descarga">Descarga</option>
            </select>
            {form.clienteId ? (
              <select
                className={`${inputCls} max-w-[200px]`}
                value={p.clienteUbicacionId ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) seleccionarUbicacionParaFila(idx, id);
                }}
                title="Rellena esta fila con una ubicación guardada del cliente — no cambia el tipo Carga/Entrega."
              >
                <option value="">— Ubicación guardada —</option>
                {ubicacionesParaFila(p.tipo).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} ({u.tipo === "AMBOS" ? "Carga/Entrega" : u.tipo === "CARGA" ? "Carga" : "Entrega"})
                  </option>
                ))}
              </select>
            ) : null}
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={p.requiereEvidencia}
                onChange={(e) =>
                  setParadasForm((list) => list.map((x, i) => (i === idx ? { ...x, requiereEvidencia: e.target.checked } : x)))
                }
              />
              Evidencia
            </label>
            <button type="button" className="text-xs text-red-300" onClick={() => setParadasForm((list) => list.filter((_, i) => i !== idx))}>
              Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          className="rounded bg-[#334155] px-2 py-1 text-xs text-white"
          onClick={() => setParadasForm((list) => [...list, { lugarNombre: "", tipo: "Entrega", requiereEvidencia: true }])}
        >
          + Agregar parada
        </button>
      </div>

      {esEdicion ? <NotificarPersonal plan={plan!} /> : null}

      {esEdicion ? (
        <div className="md:col-span-3">
          <ViaticosPanel slug={slug} planId={plan!.id} />
        </div>
      ) : (
        <p className="md:col-span-3 text-xs text-[var(--muted)]">
          El viático sugerido de piloto/auxiliares aparece al guardar el viaje (edítalo desde aquí después de crearlo).
        </p>
      )}

      {error ? <p className="md:col-span-3 text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="md:col-span-3 text-sm text-emerald-300">{msg}</p> : null}

      <button
        type="submit"
        disabled={saving || bloqueado}
        className="md:col-span-3 rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {saving ? "Guardando…" : esEdicion ? "Guardar cambios" : "Crear viaje"}
      </button>
    </form>
  );
}
