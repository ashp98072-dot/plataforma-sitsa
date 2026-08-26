"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ClienteSearch } from "@/components/tms/cliente-search";
import { PlacaSelect, type VehiculoOpt } from "@/components/tms/placa-select";
import { PilotoSelect } from "@/components/tms/piloto-select";
import { RutaSelect, type RutaOpt } from "@/components/tms/ruta-select";
import { AuxiliaresSelect } from "@/components/tms/auxiliares-select";
import ViaticosPanel from "@/components/tms/viaticos-panel";
import type { Plan } from "./programacion-client";
import NotificarPersonal from "./notificar-personal";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";

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

/** Mejora Programación (contacto) — mismo shape que devuelve GET /tms/clientes/[clienteId]/contactos. */
type ContactoCliente = {
  id: number;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
};

/** Mejora Programación (Opción A) — mismo shape que devuelve GET /tms/viaticos-config. */
type ViaticoConfigOpt = {
  puesto: string;
  montoDefecto: number;
};

/** Una fila de la sección "Viáticos del viaje" en modo creación (derivada de piloto/auxiliares — nunca un estado aparte que se pueda desincronizar). */
type FilaViaticoCreacion = {
  key: string;
  nombre: string;
  rol: "Piloto" | "Auxiliar";
  /** empleadoId (RRHH) — null si es un nombre libre (sin vínculo RRHH, no se puede enviar override todavía). */
  empleadoId: number | null;
  sugerido: number;
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
// OPS-1: "Descargado" (operación finalizada, pendiente de cierre) ya NO
// bloquea edición — Operaciones debe poder corregir antes de cerrar.
const ESTADOS_SOLO_NOTAS = new Set(["En ruta"]);
const ESTADOS_BLOQUEADOS = new Set(["Cerrado", "Cancelado"]);

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

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
  // Mejora Programación (Opción A) — configuración de montos sugeridos
  // (tms_viaticos_config, misma que ya usa ViaticosConfigPanel en TMS) y
  // los montos que el usuario ajusta ANTES del primer guardado, keyed por
  // FilaViaticoCreacion.key. Solo aplica en modo creación — en edición
  // sigue mandando ViaticosPanel (ya existente).
  const [viaticosConfig, setViaticosConfig] = useState<ViaticoConfigOpt[]>([]);
  const [viaticosMontos, setViaticosMontos] = useState<Record<string, string>>({});
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
    // VIAT-4/VIAT-4b: fotografía histórica de qué ruta maestra se usó —
    // se recalcula al elegir otra ruta; no bloquea guardar el viaje sin
    // ruta (código/ruta sigue siendo opcional). lugarDescargaHistorico y
    // contacto*Historico son la COPIA congelada en este momento — si la
    // ruta o el contacto del cliente cambian después, este viaje ya
    // guardado no se ve afectado (corrección VIAT-4b: antes el contacto
    // se mostraba "en vivo" sin copiarse; ahora sí se copia).
    rutaId: plan?.ruta_id ?? 0,
    rutaCodigo: plan?.ruta_codigo_historico ?? "",
    lugarDescargaHistorico: plan?.lugar_descarga_historico ?? "",
    contactoNombreHistorico: plan?.contacto_nombre_historico ?? "",
    contactoCargoHistorico: plan?.contacto_cargo_historico ?? "",
    contactoTelefonoHistorico: plan?.contacto_telefono_historico ?? "",
    notas: plan?.notas ?? "",
    estado: plan?.estado ?? "Programado",
  });
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
  const [saving, setSaving] = useState(false);
  // Mejora Programación (punto 20) — ViaticosPanel solo refetch en su
  // propio mount ([slug, planId]); como este formulario NO se desmonta
  // entre guardados del mismo plan (mismo id), un cambio de piloto/
  // auxiliares no se reflejaba visualmente hasta recargar la página.
  // Forzamos un remount limpio del panel tras cada guardado exitoso vía
  // `key` — así siempre refleja lo que sincronizarViaticosPlan acaba de
  // dejar en BD, sin tocar ViaticosPanel.
  const [viaticosVersion, setViaticosVersion] = useState(0);
  // OPS-1 — cierre administrativo (Descargado -> Cerrado). Solo botón +
  // confirmación explícita; la autoridad real es el permiso
  // `viajes_cerrar:editar` que valida el endpoint (esto es únicamente UX,
  // igual que puedeAutorizar en el panel de viáticos — nunca seguridad).
  const { permisos } = useEmpresaSession();
  const puedeCerrarViaje = tienePermiso(permisos, "viajes_cerrar", "editar");
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [errorCierre, setErrorCierre] = useState("");

  // VIAT-1: ubicaciones guardadas del cliente seleccionado, para armar
  // paradas rápido en vez de escribir la dirección cada vez.
  const [ubicacionesCliente, setUbicacionesCliente] = useState<UbicacionCliente[]>([]);
  // Mejora Programación — contactos activos del cliente seleccionado
  // (tms_cliente_contactos vía GET /tms/clientes/[clienteId]/contactos).
  // El teléfono SIEMPRE sale de aquí (o del contacto de la ruta elegida) —
  // Programación nunca guarda un teléfono "maestro" propio.
  const [contactosCliente, setContactosCliente] = useState<ContactoCliente[]>([]);
  const [contactoClienteIdSeleccionado, setContactoClienteIdSeleccionado] = useState<number | null>(null);
  const [nuevaUbicacion, setNuevaUbicacion] = useState({ nombre: "", direccion: "" });
  const [mostrarNuevaUbicacion, setMostrarNuevaUbicacion] = useState(false);
  const [guardandoUbicacion, setGuardandoUbicacion] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const cargarCatalogos = useCallback(async () => {
    const [resPlanes, cat, ops, viaticosCfg] = await Promise.all([
      fetch(`/api/empresas/${slug}/tms/planes`),
      fetch(`/api/empresas/${slug}/tms/catalogos`),
      fetch(`/api/empresas/${slug}/rrhh/personal-ops?tipo=all`),
      fetch(`/api/empresas/${slug}/tms/viaticos-config`),
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
    if (viaticosCfg.ok) {
      const vc = await viaticosCfg.json();
      setViaticosConfig((vc.config ?? []) as ViaticoConfigOpt[]);
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

  // Mejora Programación (punto 2) — contactos activos del cliente elegido.
  // Mismo patrón IIFE que ubicacionesCliente arriba.
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!form.clienteId) {
        setContactosCliente([]);
        return;
      }
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/clientes/${form.clienteId}/contactos`);
        const data = await res.json();
        if (ignore) return;
        setContactosCliente(res.ok ? ((data.contactos ?? []) as ContactoCliente[]) : []);
      } catch {
        if (!ignore) setContactosCliente([]);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug, form.clienteId]);

  /** Aplica un contacto del cliente (elegido a mano o auto-seleccionado) a la fotografía histórica del formulario. */
  function aplicarContactoCliente(id: number) {
    if (!id) {
      setContactoClienteIdSeleccionado(null);
      setForm((f) => ({ ...f, contactoNombreHistorico: "", contactoCargoHistorico: "", contactoTelefonoHistorico: "" }));
      return;
    }
    const c = contactosCliente.find((x) => x.id === id);
    if (!c) return;
    setContactoClienteIdSeleccionado(id);
    setForm((f) => ({
      ...f,
      contactoNombreHistorico: c.nombre,
      contactoCargoHistorico: c.cargo ?? "",
      contactoTelefonoHistorico: c.telefono ?? "",
    }));
  }

  // Mejora Programación (punto 2B) — si el cliente tiene EXACTAMENTE un
  // contacto activo, se autoselecciona; con varios, el usuario elige en el
  // selector compacto de abajo (nunca se adivina). Guard clave: solo actúa
  // mientras no haya YA un contacto resuelto (por ruta, por elección manual,
  // o porque es un viaje en edición que ya tenía su fotografía histórica
  // guardada) — nunca pisa un contacto ya asignado.
  useEffect(() => {
    if (form.contactoNombreHistorico.trim()) return;
    if (contactosCliente.length !== 1) return;
    const unico = contactosCliente[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContactoClienteIdSeleccionado(unico.id);
    setForm((f) => ({
      ...f,
      contactoNombreHistorico: unico.nombre,
      contactoCargoHistorico: unico.cargo ?? "",
      contactoTelefonoHistorico: unico.telefono ?? "",
    }));
    // Solo debe re-evaluarse cuando cambia la lista de contactos disponibles
    // (p. ej. al cambiar de cliente) — no en cada tecleo de otros campos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactosCliente]);

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

  /**
   * VIAT-4/VIAT-4b — al elegir una ruta del catálogo (Código/Ruta), COPIA
   * sus datos al formulario (fotografía histórica): cliente (modo A:
   * buscar por código sin cliente elegido — el código es único por
   * empresa), hora habitual, ruta_id/código, la descripción de destino
   * (lugar_descarga_historico — NO se deriva de paradas) y el contacto
   * (nombre/cargo/teléfono, copiados AHORA — corrección VIAT-4b: antes se
   * mostraban "en vivo" sin copiarse; si el contacto del cliente cambia
   * después, este viaje ya guardado no debe reflejarlo). El programador
   * puede seguir editando cualquiera de estos campos después para ESTE
   * viaje sin modificar la ruta maestra — es una copia, no una
   * referencia en vivo.
   *
   * Paradas estructuradas: se copian tal cual si la ruta las tiene (no se
   * pierden ni se reordenan). Si la ruta NO tiene paradas estructuradas
   * pero sí descripción de destino, se agrega una parada de respaldo con
   * esa descripción — solo para que el tablero de Programación
   * (origen/destino por parada) y el seguimiento operativo sigan
   * funcionando; el REPORTE tradicional nunca lee esta parada de
   * respaldo, siempre lee lugar_descarga_historico directamente.
   */
  function aplicarRuta(ruta: RutaOpt) {
    setForm((f) => ({
      ...f,
      clienteId: ruta.clienteId,
      clienteNombre: ruta.clienteNombre,
      horaCarga: ruta.horaHabitual || f.horaCarga,
      rutaId: ruta.id,
      rutaCodigo: ruta.codigo,
      lugarDescargaHistorico: ruta.destinoDescripcion ?? f.lugarDescargaHistorico,
      contactoNombreHistorico: ruta.contactoNombre ?? "",
      contactoCargoHistorico: ruta.contactoCargo ?? "",
      contactoTelefonoHistorico: ruta.contactoTelefono ?? "",
    }));
    setContactoClienteIdSeleccionado(ruta.contactoClienteId ?? null);
    const nuevasParadas: ParadaForm[] = [];
    if (ruta.lugarCargaTexto) {
      nuevasParadas.push({ lugarNombre: ruta.lugarCargaTexto, tipo: "Carga", requiereEvidencia: true, clienteUbicacionId: ruta.ubicacionCargaId });
    }
    if (ruta.paradas.length) {
      for (const p of ruta.paradas) {
        nuevasParadas.push({
          lugarNombre: p.lugarNombre,
          tipo: (["Carga", "Descarga", "Entrega"].includes(p.tipo) ? p.tipo : "Entrega") as ParadaForm["tipo"],
          requiereEvidencia: true,
          clienteUbicacionId: p.clienteUbicacionId,
        });
      }
    } else if (ruta.destinoDescripcion) {
      // Respaldo solo para el tablero/seguimiento — el reporte no depende de esto.
      nuevasParadas.push({ lugarNombre: ruta.destinoDescripcion, tipo: "Entrega", requiereEvidencia: true, clienteUbicacionId: null });
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
  // OPS-1 (corregido): "pendiente de cierre" ya NO es estado === "Descargado"
  // — viene calculado por el backend (GET /tms/planes) en
  // plan.pendiente_cierre: el plan no está Cerrado/Cancelado Y ya existe
  // un registro real de llegada en flota_viajes. El viaje sigue editable
  // (bloqueado = false); además se ofrece la acción de cierre si el
  // usuario tiene el permiso.
  const pendienteCierre = esEdicion && Boolean(plan!.pendiente_cierre);
  const yaCerrado = esEdicion && plan!.estado === "Cerrado";
  // OPS-3.2b — reconciliación administrativa pre-cierre: mientras el
  // plan está "En ruta" sin llegada registrada, sigue tan bloqueado como
  // antes (`soloNotas` a secas); con llegada registrada (pendienteCierre)
  // se habilitan tarifa/referencia/regreso/ruta/lugar de descarga/
  // contacto — piloto/unidad/auxiliares/fecha/hora/paradas siguen
  // bloqueados en ambos casos (quedan para una fase posterior, ver
  // src/app/api/empresas/[slug]/tms/planes/route.ts). Usa el mismo
  // `plan.pendiente_cierre` que ya devuelve GET — no infiere llegada por
  // evidencias ni hace una llamada adicional a Flota.
  const bloqueadoParaPreCierre = soloNotas && !pendienteCierre;

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

  // Mejora Programación (Opción A, punto 1/7) — filas de la sección
  // "Viáticos del viaje" en modo creación, SIEMPRE derivadas de
  // piloto/auxiliares actuales (nunca un estado aparte): cambiar de
  // piloto o quitar un auxiliar hace que su fila desaparezca de
  // inmediato, sin ningún efecto/sincronización manual. Personal sin
  // vínculo RRHH (nombre libre) se muestra con el sugerido pero sin
  // override editable -- el backend no tiene forma de identificarlo antes
  // de crearse.
  const sugeridoPorRol = (rol: "Piloto" | "Auxiliar") =>
    viaticosConfig.find((c) => c.puesto === rol)?.montoDefecto ?? 0;
  const filasViaticos: FilaViaticoCreacion[] = [];
  if (form.pilotoEmpleadoId) {
    filasViaticos.push({
      key: "piloto",
      nombre: form.pilotoNombre || `Empleado #${form.pilotoEmpleadoId}`,
      rol: "Piloto",
      empleadoId: form.pilotoEmpleadoId,
      sugerido: sugeridoPorRol("Piloto"),
    });
  } else if (form.pilotoNombre.trim()) {
    filasViaticos.push({
      key: "piloto-libre",
      nombre: form.pilotoNombre.trim(),
      rol: "Piloto",
      empleadoId: null,
      sugerido: sugeridoPorRol("Piloto"),
    });
  }
  for (const id of form.auxiliarEmpleadoIds) {
    filasViaticos.push({
      key: `aux-emp-${id}`,
      nombre: auxiliares.find((a) => a.id === id)?.nombre ?? `Empleado #${id}`,
      rol: "Auxiliar",
      empleadoId: id,
      sugerido: sugeridoPorRol("Auxiliar"),
    });
  }
  for (const nombreLibre of form.auxiliarNombres) {
    filasViaticos.push({
      key: `aux-nombre-${nombreLibre}`,
      nombre: nombreLibre,
      rol: "Auxiliar",
      empleadoId: null,
      sugerido: sugeridoPorRol("Auxiliar"),
    });
  }

  /** POST viaticosAsignados — solo filas con vínculo RRHH (empleadoId conocido, el único id que este formulario tiene antes de guardar); el backend valida pertenencia y traduce a tms_personal.id internamente. */
  function construirViaticosAsignados(): { empleadoId: number; montoAsignado: number }[] {
    return filasViaticos
      .filter((f) => f.empleadoId != null)
      .map((f) => {
        const txt = viaticosMontos[f.key];
        const monto = txt != null && txt.trim() !== "" ? Number(txt) : f.sugerido;
        return { empleadoId: f.empleadoId as number, montoAsignado: Number.isFinite(monto) && monto >= 0 ? monto : f.sugerido };
      });
  }

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
            lugarDescargaHistorico: form.lugarDescargaHistorico.trim() || undefined,
            contactoNombreHistorico: form.contactoNombreHistorico.trim() || undefined,
            contactoCargoHistorico: form.contactoCargoHistorico.trim() || undefined,
            contactoTelefonoHistorico: form.contactoTelefonoHistorico.trim() || undefined,
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
            viaticosAsignados: construirViaticosAsignados(),
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
          // OPS-3.2b: estos seis ya no dependen de `soloNotas` a secas —
          // `bloqueadoParaPreCierre` los libera cuando el plan está
          // pendiente de cierre (llegada ya registrada), aunque siga
          // "En ruta". piloto/unidad/auxiliares/fecha/hora/paradas (arriba)
          // siguen atados a `soloNotas` sin cambios.
          regresoEstimado: bloqueadoParaPreCierre ? undefined : form.regresoEstimado || null,
          tarifaComercial: bloqueadoParaPreCierre
            ? undefined
            : form.tarifaComercial === ""
              ? null
              : Number(form.tarifaComercial),
          referenciaCliente: bloqueadoParaPreCierre ? undefined : form.referenciaCliente.trim() || null,
          rutaId: bloqueadoParaPreCierre ? undefined : form.rutaId || undefined,
          rutaCodigo: bloqueadoParaPreCierre ? undefined : form.rutaCodigo.trim() || undefined,
          lugarDescargaHistorico: bloqueadoParaPreCierre ? undefined : form.lugarDescargaHistorico.trim() || undefined,
          contactoNombreHistorico: bloqueadoParaPreCierre ? undefined : form.contactoNombreHistorico.trim() || undefined,
          contactoCargoHistorico: bloqueadoParaPreCierre ? undefined : form.contactoCargoHistorico.trim() || undefined,
          contactoTelefonoHistorico: bloqueadoParaPreCierre ? undefined : form.contactoTelefonoHistorico.trim() || undefined,
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
      // El servidor ya sincronizó tms_viaticos con el piloto/auxiliares
      // recién guardados (sincronizarViaticosPlan) — forzar un remount
      // limpio de ViaticosPanel para que lo refleje de inmediato.
      setViaticosVersion((v) => v + 1);
      onSaved({ id: plan!.id, fechaPlan: form.fechaPlan });
    } catch {
      setError("Error de conexión.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * OPS-1 — cierre administrativo. Confirmación explícita en dos pasos
   * (botón "Cerrar viaje" -> revela el resumen + botón "Confirmar cierre")
   * en vez de un `confirm()` nativo, consistente con el resto de la UI.
   * El backend es la autoridad real (permiso + UPDATE condicional por
   * estado) — este botón solo deja de mostrarse si el usuario no tiene
   * `viajes_cerrar:editar`, nunca es la única protección.
   */
  async function confirmarCierre() {
    if (!esEdicion || cerrando) return;
    setCerrando(true);
    setErrorCierre("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/${plan!.id}/cerrar`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorCierre(data.error ?? "No se pudo cerrar el viaje.");
        return;
      }
      setMsg(data.mensaje ?? "Viaje cerrado.");
      setConfirmandoCierre(false);
      onSaved({ id: plan!.id, fechaPlan: form.fechaPlan });
    } catch {
      setErrorCierre("Error de conexión.");
    } finally {
      setCerrando(false);
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
      {yaCerrado ? (
        <p className="md:col-span-3 rounded bg-slate-800/60 px-3 py-2 text-xs text-[var(--muted)]">
          Viaje cerrado{plan!.cerrado_por ? ` por ${plan!.cerrado_por}` : ""}
          {plan!.cerrado_en ? ` · ${plan!.cerrado_en.replace("T", " ")}` : ""}.
        </p>
      ) : null}

      {pendienteCierre ? (
        <div className="md:col-span-3 space-y-2 rounded-lg border border-amber-700/60 bg-amber-950/20 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-amber-200">
              El piloto ya registró la llegada — pendiente de cierre por Operaciones.
              Puedes corregir tarifa, referencia, regreso estimado y los datos de ruta/contacto
              antes de cerrar.
            </p>
            {puedeCerrarViaje && !confirmandoCierre ? (
              <button
                type="button"
                className="rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white"
                onClick={() => setConfirmandoCierre(true)}
              >
                Cerrar viaje
              </button>
            ) : null}
          </div>
          {!puedeCerrarViaje ? (
            <p className="text-[11px] text-[var(--muted)]">
              El cierre administrativo lo realiza Operaciones (Jefe/Gerente) — no tienes el permiso
              &quot;Viajes: cerrar administrativamente&quot;.
            </p>
          ) : null}
          {confirmandoCierre ? (
            <div className="space-y-2 rounded border border-amber-700/60 bg-black/20 p-2 text-xs">
              <p className="font-medium">Revisa antes de cerrar — ya no podrá editarse después:</p>
              <ul className="grid gap-x-4 gap-y-0.5 text-[11px] text-[var(--muted)] sm:grid-cols-2">
                <li>Código: {plan!.codigo}</li>
                <li>Cliente: {form.clienteNombre || "—"}</li>
                <li>Ruta: {form.rutaCodigo || "—"}</li>
                <li>Destino: {form.lugarDescargaHistorico || "—"}</li>
                <li>Unidad: {form.placa || "—"}</li>
                <li>Piloto: {form.pilotoNombre || "—"}</li>
                <li>Auxiliares: {[...form.auxiliarNombres, ...form.auxiliarEmpleadoIds.map((id) => auxiliares.find((a) => a.id === id)?.nombre ?? `#${id}`)].join(", ") || "—"}</li>
                <li>Tarifa comercial: {form.tarifaComercial ? `Q${form.tarifaComercial}` : "—"}</li>
                <li>Referencia cliente: {form.referenciaCliente || "—"}</li>
              </ul>
              {errorCierre ? <p className="text-red-300">{errorCierre}</p> : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={cerrando}
                  onClick={() => void confirmarCierre()}
                  className="rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {cerrando ? "Cerrando…" : "Confirmar cierre"}
                </button>
                <button
                  type="button"
                  className="rounded border border-[var(--border)] px-3 py-1.5 text-xs"
                  onClick={() => {
                    setConfirmandoCierre(false);
                    setErrorCierre("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}
        </div>
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
      <div className={bloqueadoParaPreCierre || bloqueado ? "pointer-events-none opacity-50" : ""}>
        <RutaSelect
          slug={slug}
          clienteId={form.clienteId}
          value={form.rutaCodigo}
          inputClassName={inputCls}
          onSeleccionar={aplicarRuta}
        />
      </div>
      <label className={`text-xs text-[var(--muted)] md:col-span-2 ${bloqueadoParaPreCierre || bloqueado ? "pointer-events-none opacity-50" : ""}`}>
        Lugar de descarga (descripción operativa — como la usa Operaciones)
        <input
          className={`${inputCls} mt-1 w-full`}
          placeholder="Ej. RUTA-A - punto1-punto2-punto3"
          value={form.lugarDescargaHistorico}
          onChange={(e) => setForm((f) => ({ ...f, lugarDescargaHistorico: e.target.value }))}
        />
        <span className="mt-0.5 block text-[10px]">
          Se copió de la ruta elegida arriba (si aplica) — puedes ajustarla solo para este viaje.
          Es lo que sale en el reporte tradicional (columna &quot;Lugar de Descarga&quot;).
        </span>
      </label>
      <div className={`md:col-span-3 space-y-2 rounded border border-[var(--border)] p-2 ${bloqueadoParaPreCierre || bloqueado ? "pointer-events-none opacity-50" : ""}`}>
        <p className="text-[11px] font-medium text-[var(--muted)]">
          Contacto operativo — viene del cliente (o de la ruta elegida). El teléfono no se edita
          aquí; se copia tal cual quedará guardado en este viaje.
        </p>

        {contactosCliente.length ? (
          <label className="block text-[11px] text-[var(--muted)]">
            Contacto
            <select
              className={`${inputCls} mt-0.5 block w-full max-w-xs`}
              value={contactoClienteIdSeleccionado ?? ""}
              onChange={(e) => aplicarContactoCliente(Number(e.target.value))}
            >
              <option value="">— Sin contacto —</option>
              {contactosCliente.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.cargo ? ` (${c.cargo})` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {form.contactoNombreHistorico ? (
          <div className="rounded bg-black/10 p-2 text-xs">
            <p>Nombre: {form.contactoNombreHistorico}</p>
            <p>Cargo: {form.contactoCargoHistorico || "—"}</p>
            <p>Teléfono: {form.contactoTelefonoHistorico || "Sin teléfono registrado"}</p>
          </div>
        ) : (
          <p className="text-xs text-amber-300">
            {form.clienteId ? "Sin contacto registrado para este cliente." : "Selecciona un cliente o una ruta para ver su contacto."}
          </p>
        )}

        {form.clienteId && (!form.contactoNombreHistorico || !form.contactoTelefonoHistorico) ? (
          <Link
            href={`/e/${slug}/tms#cliente-contactos`}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[11px] text-sky-300 underline"
          >
            Editar contacto del cliente →
          </Link>
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
        className={`md:col-span-3 rounded border border-[var(--border)] p-3 ${
          soloNotas || bloqueado ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <AuxiliaresSelect
          auxiliares={auxiliares}
          empleadoIds={form.auxiliarEmpleadoIds}
          nombresLibres={form.auxiliarNombres}
          max={8}
          inputClassName={inputCls}
          onChange={({ empleadoIds, nombresLibres }) =>
            setForm((f) => ({ ...f, auxiliarEmpleadoIds: empleadoIds, auxiliarNombres: nombresLibres }))
          }
        />
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
      <label className={`text-xs text-[var(--muted)] ${bloqueadoParaPreCierre || bloqueado ? "pointer-events-none opacity-50" : ""}`}>
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
      <label className={`text-xs text-[var(--muted)] ${bloqueadoParaPreCierre || bloqueado ? "pointer-events-none opacity-50" : ""}`}>
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

      <label className={`md:col-span-2 text-xs text-[var(--muted)] ${bloqueadoParaPreCierre || bloqueado ? "pointer-events-none opacity-50" : ""}`}>
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
            {/* OPS-1 (corregido): "Cerrado" y "Descargado" ya NO son
                seleccionables aquí — el backend los rechaza (ver
                patchSchema en planes/route.ts). El cierre real es la
                acción dedicada "Cerrar viaje" más abajo. */}
            {["Programado", "En ruta", "Cargado", "Cancelado"].map((s) => (
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
          <ViaticosPanel key={viaticosVersion} slug={slug} planId={plan!.id} />
        </div>
      ) : (
        <div className="md:col-span-3 space-y-2 rounded border border-[var(--border)] p-3">
          <p className="text-xs font-medium">Viáticos del viaje</p>
          {filasViaticos.length ? (
            <div className="space-y-2">
              {filasViaticos.map((f) => (
                <div key={f.key} className="flex flex-wrap items-center gap-3 rounded border border-[var(--border)] p-2 text-xs">
                  <div className="min-w-[140px] flex-1">
                    <p className="text-sm">{f.nombre}</p>
                    <p className="text-[10px] text-[var(--muted)]">{f.rol}</p>
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    Sugerido
                    <br />
                    Q{f.sugerido.toFixed(2)}
                  </div>
                  {f.empleadoId != null ? (
                    <label className="text-[11px] text-[var(--muted)]">
                      Asignado
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={`${inputCls} mt-0.5 block w-24`}
                        value={viaticosMontos[f.key] ?? String(f.sugerido)}
                        onChange={(e) => setViaticosMontos((m) => ({ ...m, [f.key]: e.target.value }))}
                      />
                    </label>
                  ) : (
                    <p className="text-[11px] text-[var(--muted)]">
                      Usará el sugerido (Q{f.sugerido.toFixed(2)}) — el ajuste inicial solo aplica a personal de RRHH.
                    </p>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-[var(--muted)]">
                Se guarda junto con el viaje. Mientras el viático esté PROGRAMADO puede seguir ajustándose desde aquí; una vez AUTORIZADO queda bloqueado.
              </p>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)]">Selecciona piloto y/o auxiliares para definir sus viáticos.</p>
          )}
        </div>
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
