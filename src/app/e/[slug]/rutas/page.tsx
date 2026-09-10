"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ClienteSearch } from "@/components/tms/cliente-search";
import { CatalogoSearchSelect, type CatalogoSearchOption } from "@/components/tms/catalogo-search-select";
import { RutaTarifasPanel } from "@/components/tms/ruta-tarifas-panel";

type ClienteOpt = {
  id: number;
  nombre: string;
  codigo?: string | null;
  nit?: string | null;
  telefono?: string | null;
  estado?: string | null;
};

type UbicacionCliente = {
  id: number;
  nombre: string;
  direccion: string | null;
};

type ContactoCliente = {
  id: number;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
};

type RutaParada = {
  id: number;
  orden: number;
  tipo: string;
  lugarNombre: string;
  clienteUbicacionId: number | null;
};

type EmpleadoOpt = { id: number; codigo: string; nombre: string; categoriaOps: string };
type RutaPersonal = {
  empleadoId: number;
  empleadoNombre: string;
  rol: "Piloto" | "Auxiliar";
  orden: number;
  viaticoMonto: number | null;
};
type RutaPersonalForm = { empleadoId: number; rol: "Piloto" | "Auxiliar"; viaticoMonto: string };

type ClienteRuta = {
  id: number;
  clienteId: number;
  clienteNombre: string;
  codigo: string;
  nombre: string | null;
  ubicacionCargaId: number | null;
  lugarCargaTexto: string | null;
  destinoDescripcion: string | null;
  horaHabitual: string | null;
  tarifaReferencia: number | null;
  tarifaVigenteDesde: string | null;
  tarifaUltimoCambioEn: string | null;
  tarifaModificadoPor: string | null;
  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1
  unidadRecurrenteId: number | null;
  unidadRecurrentePlaca: string | null;
  tarifasActivas?: { id: number; nombre: string; monto: number; moneda: string; predeterminada: boolean }[];
  contactoClienteId: number | null;
  contactoNombre: string | null;
  contactoCargo: string | null;
  contactoTelefono: string | null;
  observaciones: string | null;
  activo: boolean;
  paradas: RutaParada[];
  personalPredeterminado: RutaPersonal[];
};

/** RUTAS-TARIFARIO-HISTORIAL-1 (§1/§4 del ticket) — una fila del historial append-only (tms_cliente_ruta_tarifas), orden descendente (ya lo entrega el endpoint). */
type TarifaHistorialEntry = {
  id: number;
  tarifa: number;
  moneda: string;
  vigenteDesde: string;
  motivo: string | null;
  usuarioNombre: string | null;
  creadoEn: string;
};

type ParadaForm = { tipo: string; lugarNombre: string; clienteUbicacionId: number | null };
type NuevoContactoForm = { nombre: string; cargo: string; telefono: string; email: string; observaciones: string };
const NUEVO_CONTACTO_VACIO: NuevoContactoForm = { nombre: "", cargo: "", telefono: "", email: "", observaciones: "" };
type NuevaUbicacionForm = { nombre: string; direccion: string };
const NUEVA_UBICACION_VACIA: NuevaUbicacionForm = { nombre: "", direccion: "" };

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const FORM_VACIO = {
  codigo: "",
  nombre: "",
  ubicacionCargaId: null as number | null,
  lugarCargaTexto: "",
  destinoDescripcion: "",
  horaHabitual: "",
  tarifaReferencia: "",
  // RUTAS-TARIFARIO-HISTORIAL-1 (§5 del ticket) — metadatos del cambio de
  // tarifa: "vigente desde" default hoy; "motivo" obligatorio SOLO si la
  // ruta ya tenía una tarifa anterior (ver tarifaAnteriorExiste).
  tarifaVigenteDesde: hoyIso(),
  tarifaMotivo: "",
  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§4) — unidad recurrente
  // (flota_vehiculos.id como string; "" = sin unidad recurrente).
  unidadRecurrenteId: "",
  contactoClienteId: null as number | null,
  observaciones: "",
};

/**
 * VIAT-4 (punto 2) — Operaciones > Rutas: catálogo maestro de rutas/
 * servicios preconfigurados por cliente (de la hoja "CODIGOS DATA" del
 * Excel real). Buscar por código, cliente, nombre o descripción de
 * destino; crear/editar/activar-desactivar (nunca hard-delete). Reutiliza
 * ClienteSearch (ya existente), tms_cliente_ubicaciones (VIAT-1) y
 * tms_cliente_contactos (VIAT-4) — no duplica direcciones ni teléfonos.
 *
 * VIAT-4b — código único POR EMPRESA (confirmado contra el Excel real:
 * 147 registros, 147 códigos únicos). `destinoDescripcion` es la
 * descripción operativa completa del destino (texto libre, formato tipo
 * "RUTA-X - punto1-punto2-punto3"), SEPARADA de las paradas estructuradas
 * de abajo — ambas se guardan y se muestran, ninguna reemplaza a la otra.
 */
export default function RutasPage() {
  const slug = String(useParams().slug);

  const [clientes, setClientes] = useState<ClienteOpt[]>([]);
  const [personal, setPersonal] = useState<EmpleadoOpt[]>([]);
  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§4) — flota de esta
  // empresa para el selector de "unidad recurrente" de la ruta.
  const [flotaVehiculos, setFlotaVehiculos] = useState<{ id: number; placa: string; marca: string | null; modelo: string | null }[]>([]);
  const [rutas, setRutas] = useState<ClienteRuta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [fCodigo, setFCodigo] = useState("");
  const [fClienteId, setFClienteId] = useState(0);
  const [fClienteNombre, setFClienteNombre] = useState("");
  const [fTexto, setFTexto] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [formClienteId, setFormClienteId] = useState(0);
  const [formClienteNombre, setFormClienteNombre] = useState("");
  const [paradasForm, setParadasForm] = useState<ParadaForm[]>([]);
  const [personalForm, setPersonalForm] = useState<RutaPersonalForm[]>([]);
  const [ubicacionesForm, setUbicacionesForm] = useState<UbicacionCliente[]>([]);
  const [contactosForm, setContactosForm] = useState<ContactoCliente[]>([]);
  const [guardando, setGuardando] = useState(false);
  // RUTAS-TARIFARIO-HISTORIAL-1 (§5 del ticket) — true cuando la ruta que
  // se está editando YA tenía una tarifa (r.tarifaReferencia != null):
  // el motivo del cambio pasa a ser obligatorio en el formulario y el
  // servidor lo vuelve a exigir de todas formas (nunca se confía solo en
  // esta bandera de UI).
  const [tarifaAnteriorExiste, setTarifaAnteriorExiste] = useState(false);
  // §4 — "Historial de tarifas": id de la ruta cuyo historial está
  // abierto (null = cerrado) + los datos ya cargados.
  const [historialRutaId, setHistorialRutaId] = useState<number | null>(null);
  const [historial, setHistorial] = useState<TarifaHistorialEntry[]>([]);
  const [historialCargando, setHistorialCargando] = useState(false);
  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§1) — id de la ruta con
  // el panel "Tarifas de la ruta" abierto (null = cerrado).
  const [tarifasRutaId, setTarifasRutaId] = useState<number | null>(null);
  // §7/§8 — "+ Agregar contacto" inline, con confirmación de posible duplicado.
  const [mostrarNuevoContacto, setMostrarNuevoContacto] = useState(false);
  const [nuevoContacto, setNuevoContacto] = useState<NuevoContactoForm>({ ...NUEVO_CONTACTO_VACIO });
  // Seguimiento a feedback del usuario — "+ Agregar lugar de carga" desde
  // la misma captura de Ruta, mismo espíritu que "+ Agregar contacto" y
  // que guardarNuevaUbicacion() en programacion/plan-form.tsx (sin aviso
  // de duplicado: ese formulario tampoco lo tiene, se mantiene el mismo
  // criterio ya establecido para alta rápida de ubicaciones).
  const [mostrarNuevaUbicacion, setMostrarNuevaUbicacion] = useState(false);
  const [nuevaUbicacion, setNuevaUbicacion] = useState<NuevaUbicacionForm>({ ...NUEVA_UBICACION_VACIA });
  const [guardandoUbicacion, setGuardandoUbicacion] = useState(false);
  const [guardandoContacto, setGuardandoContacto] = useState(false);
  const [avisoDuplicadoContacto, setAvisoDuplicadoContacto] = useState<string | null>(null);
  // §10/§11 — errores de validación POR CAMPO (path -> mensaje) devueltos
  // por respuestaErrorValidacion (@/lib/validacion-http); usados para
  // resaltar el input exacto, además del resumen en `error`.
  const [camposError, setCamposError] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLDivElement | null>(null);

  /**
   * §11 del ticket — "marcar el campo problemático" + "mensaje debajo
   * del campo cuando sea posible": borde rojo si `camposError[campo]`
   * existe. Cada input/select relevante lleva `data-campo` (ver
   * campoAttrs) para que el efecto de abajo pueda encontrar y enfocar el
   * PRIMER campo inválido en orden real del DOM tras un error del
   * servidor — nunca durante el render (refs/foco son un efecto, no
   * parte del render en sí).
   */
  function campoCls(campo: string): string {
    return camposError[campo] ? `${inputCls} border-red-500` : inputCls;
  }
  function mensajeCampo(campo: string) {
    return camposError[campo] ? <span className="mt-0.5 block text-[10px] text-red-300">{camposError[campo]}</span> : null;
  }

  // §11 del ticket — "hacer scroll/focus al primer campo inválido":
  // efecto (no render) que corre cuando cambian los errores por campo,
  // busca en orden del DOM el primer [data-campo] presente en
  // `camposError` y le hace scroll + foco.
  useEffect(() => {
    const claves = Object.keys(camposError);
    if (!claves.length) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const elementos = formRef.current?.querySelectorAll<HTMLElement>("[data-campo]");
    if (!elementos) return;
    for (const el of Array.from(elementos)) {
      const campo = el.getAttribute("data-campo");
      if (campo && camposError[campo]) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus?.();
        break;
      }
    }
  }, [camposError]);

  /** §9 del ticket — opciones de búsqueda para piloto/auxiliar habitual (buscar por nombre; código como detalle opcional). */
  const opcionesPersonal: CatalogoSearchOption[] = personal.map((p) => ({ value: String(p.id), label: p.nombre, detail: p.codigo }));

  const cargarClientes = useCallback(async () => {
    const [resClientes, resPersonal] = await Promise.all([
      fetch(`/api/empresas/${slug}/tms/catalogos`),
      fetch(`/api/empresas/${slug}/rrhh/personal-ops?tipo=all`),
    ]);
    const [dataClientes, dataPersonal] = await Promise.all([
      resClientes.json().catch(() => ({})),
      resPersonal.json().catch(() => ({})),
    ]);
    if (resClientes.ok) {
      setClientes((dataClientes.clientes ?? []) as ClienteOpt[]);
      setFlotaVehiculos((dataClientes.flotaVehiculos ?? []) as typeof flotaVehiculos);
    }
    if (resPersonal.ok) setPersonal((dataPersonal.personal ?? []) as EmpleadoOpt[]);
  }, [slug]);

  const cargarRutas = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ todas: "1" });
      if (fCodigo.trim()) params.set("q", fCodigo.trim());
      else if (fTexto.trim()) params.set("q", fTexto.trim());
      if (fClienteId) params.set("clienteId", String(fClienteId));
      const res = await fetch(`/api/empresas/${slug}/tms/rutas?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron cargar las rutas.");
        return;
      }
      setRutas((data.rutas ?? []) as ClienteRuta[]);
      if (data.aviso) setError(data.aviso);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [slug, fCodigo, fTexto, fClienteId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarClientes();
  }, [cargarClientes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarRutas();
  }, [cargarRutas]);

  // Ubicaciones/contactos del cliente elegido EN EL FORMULARIO (para armar carga/paradas/contacto).
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!formClienteId) {
        setUbicacionesForm([]);
        setContactosForm([]);
        return;
      }
      const [ru, rc] = await Promise.all([
        fetch(`/api/empresas/${slug}/tms/clientes/${formClienteId}/ubicaciones`),
        fetch(`/api/empresas/${slug}/tms/clientes/${formClienteId}/contactos`),
      ]);
      const [du, dc] = await Promise.all([ru.json().catch(() => ({})), rc.json().catch(() => ({}))]);
      if (ignore) return;
      setUbicacionesForm((du.ubicaciones ?? []) as UbicacionCliente[]);
      setContactosForm((dc.contactos ?? []) as ContactoCliente[]);
    })();
    return () => {
      ignore = true;
    };
  }, [slug, formClienteId]);

  function abrirNueva() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setFormClienteId(fClienteId || 0);
    setFormClienteNombre(fClienteNombre || "");
    setParadasForm([{ tipo: "Entrega", lugarNombre: "", clienteUbicacionId: null }]);
    setPersonalForm([]);
    setTarifaAnteriorExiste(false);
    setCamposError({});
    setMostrarNuevoContacto(false);
    setAvisoDuplicadoContacto(null);
    setMostrarNuevaUbicacion(false);
    setNuevaUbicacion({ ...NUEVA_UBICACION_VACIA });
    setMostrarForm(true);
  }

  function abrirEditar(r: ClienteRuta) {
    setEditandoId(r.id);
    setForm({
      codigo: r.codigo,
      nombre: r.nombre ?? "",
      ubicacionCargaId: r.ubicacionCargaId,
      lugarCargaTexto: r.lugarCargaTexto ?? "",
      destinoDescripcion: r.destinoDescripcion ?? "",
      horaHabitual: r.horaHabitual ?? "",
      tarifaReferencia: r.tarifaReferencia != null ? String(r.tarifaReferencia) : "",
      tarifaVigenteDesde: hoyIso(),
      tarifaMotivo: "",
      unidadRecurrenteId: r.unidadRecurrenteId != null ? String(r.unidadRecurrenteId) : "",
      contactoClienteId: r.contactoClienteId,
      observaciones: r.observaciones ?? "",
    });
    setFormClienteId(r.clienteId);
    setFormClienteNombre(r.clienteNombre);
    setParadasForm(
      r.paradas.length
        ? r.paradas.map((p) => ({ tipo: p.tipo, lugarNombre: p.lugarNombre, clienteUbicacionId: p.clienteUbicacionId }))
        : [{ tipo: "Entrega", lugarNombre: "", clienteUbicacionId: null }],
    );
    setPersonalForm(r.personalPredeterminado.map((p) => ({
      empleadoId: p.empleadoId,
      rol: p.rol,
      viaticoMonto: p.viaticoMonto != null ? String(p.viaticoMonto) : "",
    })));
    // RUTAS-TARIFARIO-HISTORIAL-1 (§5) — el motivo pasa a ser obligatorio
    // en la UI únicamente si esta ruta YA tenía tarifa.
    setTarifaAnteriorExiste(r.tarifaReferencia != null);
    setCamposError({});
    setMostrarNuevoContacto(false);
    setAvisoDuplicadoContacto(null);
    setMostrarNuevaUbicacion(false);
    setNuevaUbicacion({ ...NUEVA_UBICACION_VACIA });
    setMostrarForm(true);
  }

  /**
   * RUTAS-TARIFARIO-HISTORIAL-1 (§10/§11 del ticket) — antes: cualquier
   * error de validación (Zod o de negocio) mostraba solo el texto de
   * `error`. Ahora, cuando el servidor manda `campos` (mapa path->mensaje,
   * ver respuestaErrorValidacion), se resaltan los inputs exactos además
   * del resumen — y se hace scroll/foco al primer campo con problema.
   */
  function aplicarErrorServidor(data: { error?: string; campos?: Record<string, string> }, fallback: string) {
    setError(data.error ?? fallback);
    setCamposError(data.campos ?? {}); // dispara el efecto de scroll/foco de arriba
  }

  async function guardar() {
    if (!formClienteId) {
      setError("Selecciona el cliente de la ruta.");
      return;
    }
    const codigo = form.codigo.trim();
    if (!codigo) {
      setError("Indica el código de la ruta.");
      return;
    }
    setGuardando(true);
    setError("");
    setMsg("");
    setCamposError({});
    const paradas = paradasForm.filter((p) => p.lugarNombre.trim());
    try {
      const body: Record<string, unknown> = {
        codigo,
        nombre: form.nombre.trim() || undefined,
        ubicacionCargaId: form.ubicacionCargaId ?? undefined,
        lugarCargaTexto: form.lugarCargaTexto.trim() || undefined,
        destinoDescripcion: form.destinoDescripcion.trim() || undefined,
        horaHabitual: form.horaHabitual.trim() || undefined,
        tarifaReferencia: form.tarifaReferencia.trim() === "" ? null : Number(form.tarifaReferencia),
        // RUTAS-TARIFARIO-HISTORIAL-1 (§5) — solo tienen efecto si la
        // tarifa realmente viene/cambió (ver actualizarRuta/crearRuta).
        tarifaVigenteDesde: form.tarifaVigenteDesde || undefined,
        tarifaMotivo: form.tarifaMotivo.trim() || undefined,
        // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§4) — "" limpia la
        // unidad recurrente (null); un id la fija (validado por empresa en
        // el backend).
        unidadRecurrenteId: form.unidadRecurrenteId === "" ? null : Number(form.unidadRecurrenteId),
        contactoClienteId: form.contactoClienteId ?? undefined,
        observaciones: form.observaciones.trim() || undefined,
        paradas,
        personalPredeterminado: personalForm.map((p) => ({
          empleadoId: p.empleadoId,
          rol: p.rol,
          viaticoMonto: p.viaticoMonto.trim() === "" ? null : Number(p.viaticoMonto),
        })),
      };
      if (!editandoId) body.clienteId = formClienteId;
      const res = editandoId
        ? await fetch(`/api/empresas/${slug}/tms/rutas/${editandoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/empresas/${slug}/tms/rutas`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const data = await res.json();
      if (!res.ok) {
        aplicarErrorServidor(data, "No se pudo guardar.");
        return;
      }
      const guardada = data.ruta as ClienteRuta;
      setRutas((list) => {
        const existe = list.some((r) => r.id === guardada.id);
        const next = existe ? list.map((r) => (r.id === guardada.id ? guardada : r)) : [guardada, ...list];
        return next;
      });
      setMsg(data.mensaje ?? "Guardado.");
      setMostrarForm(false);
    } catch {
      setError("Error de conexión.");
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo(r: ClienteRuta) {
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/rutas/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !r.activo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo actualizar.");
        return;
      }
      const actualizada = data.ruta as ClienteRuta;
      setRutas((list) => list.map((x) => (x.id === actualizada.id ? actualizada : x)));
    } catch {
      setError("Error de conexión.");
    }
  }

  /** RUTAS-TARIFARIO-HISTORIAL-1 (§4 del ticket) — "Historial de tarifas": fecha, tarifa, vigente desde, motivo, modificado por, orden descendente (ya lo entrega el endpoint). Alterna abrir/cerrar si se pulsa la misma ruta. */
  async function abrirHistorial(rutaId: number) {
    if (historialRutaId === rutaId) {
      setHistorialRutaId(null);
      return;
    }
    setHistorialRutaId(rutaId);
    setHistorialCargando(true);
    setHistorial([]);
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/rutas/${rutaId}/tarifas`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setHistorial((data.historial ?? []) as TarifaHistorialEntry[]);
      else setError(data.error ?? "No se pudo cargar el historial de tarifas.");
    } catch {
      setError("Error de conexión.");
    } finally {
      setHistorialCargando(false);
    }
  }

  /**
   * RUTAS-TARIFARIO-HISTORIAL-1 (§7/§8 del ticket) — "+ Agregar
   * contacto" desde la misma captura de Ruta: guarda en la base REAL del
   * cliente (tms_cliente_contactos, vía el endpoint ya existente —
   * nunca solo dentro de la ruta), refresca el listado de contactos del
   * formulario y selecciona el nuevo automáticamente. Si el servidor
   * advierte posible duplicado (409), pide confirmación antes de forzar.
   */
  async function guardarNuevoContacto(forzar = false) {
    if (!formClienteId) return;
    if (!nuevoContacto.nombre.trim()) {
      setError("Indica el nombre del contacto.");
      return;
    }
    setGuardandoContacto(true);
    setError("");
    setAvisoDuplicadoContacto(null);
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/clientes/${formClienteId}/contactos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nuevoContacto.nombre.trim(),
          cargo: nuevoContacto.cargo.trim() || undefined,
          telefono: nuevoContacto.telefono.trim() || undefined,
          email: nuevoContacto.email.trim() || undefined,
          observaciones: nuevoContacto.observaciones.trim() || undefined,
          forzar,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.posibleDuplicado) {
        setAvisoDuplicadoContacto(data.error ?? "Ya existe un contacto parecido.");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar el contacto.");
        return;
      }
      const contacto = data.contacto as ContactoCliente;
      // Refrescar listado + seleccionar automáticamente (§7 del ticket).
      setContactosForm((list) => [...list, contacto].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
      setForm((f) => ({ ...f, contactoClienteId: contacto.id }));
      setMostrarNuevoContacto(false);
      setNuevoContacto({ ...NUEVO_CONTACTO_VACIO });
      setMsg("Contacto guardado.");
    } catch {
      setError("Error de conexión.");
    } finally {
      setGuardandoContacto(false);
    }
  }

  /**
   * Seguimiento a feedback del usuario — "+ Agregar lugar de carga":
   * antes, un lugar nuevo solo se podía escribir como texto libre de
   * ESA ruta (campo aparte), sin quedar disponible para futuras rutas
   * del mismo cliente. Ahora crea la ubicación real en el catálogo del
   * cliente (mismo endpoint que ya usa "+ Agregar ubicación" en
   * Programación, tms_cliente_ubicaciones) y la deja seleccionada.
   */
  async function guardarNuevaUbicacion() {
    if (!formClienteId) return;
    const nombre = nuevaUbicacion.nombre.trim();
    if (!nombre) {
      setError("Indica un nombre/alias para el lugar de carga (ej. Bodega Central).");
      return;
    }
    setGuardandoUbicacion(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/clientes/${formClienteId}/ubicaciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, direccion: nuevaUbicacion.direccion.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar el lugar de carga.");
        return;
      }
      const nueva = data.ubicacion as UbicacionCliente;
      setUbicacionesForm((list) => [...list, nueva].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
      setForm((f) => ({ ...f, ubicacionCargaId: nueva.id }));
      setMostrarNuevaUbicacion(false);
      setNuevaUbicacion({ ...NUEVA_UBICACION_VACIA });
      setMsg(`Lugar de carga "${nueva.nombre}" guardado — ya puedes elegirlo en cualquier ruta de este cliente.`);
    } catch {
      setError("Error de conexión.");
    } finally {
      setGuardandoUbicacion(false);
    }
  }

  const rutasFiltradas = rutas;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Rutas</h1>
          <p className="text-sm text-[var(--muted)]">
            Catálogo maestro de rutas/servicios preconfigurados por cliente (código, lugar de carga
            habitual, hora habitual, contacto y destinos). Programación copia estos datos al crear un
            viaje — cambiar una ruta aquí nunca altera viajes ya creados.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/empresas/${slug}/tms/rutas/importar`} className="rounded border border-[var(--border)] px-3 py-2 text-xs">
            Descargar formato Excel
          </a>
          <a href={`/api/empresas/${slug}/tms/rutas/exportar`} className="rounded border border-[var(--border)] px-3 py-2 text-xs">
            Exportar rutas a Excel
          </a>
          <Link href={`/e/${slug}/rutas/importar`} className="rounded bg-[#37474F] px-3 py-2 text-xs text-white">
            Importar rutas masivamente
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <label className="text-xs text-[var(--muted)]">
          Código
          <input className={`${inputCls} mt-0.5 block w-28`} value={fCodigo} onChange={(e) => setFCodigo(e.target.value)} />
        </label>
        <div className="w-56">
          <ClienteSearch
            clientes={clientes}
            valueNombre={fClienteNombre}
            valueId={fClienteId}
            inputClassName={inputCls}
            onChange={({ clienteId, clienteNombre }) => {
              setFClienteId(clienteId);
              setFClienteNombre(clienteNombre);
            }}
          />
        </div>
        <label className="text-xs text-[var(--muted)]">
          Nombre/descripción
          <input className={`${inputCls} mt-0.5 block w-48`} value={fTexto} onChange={(e) => setFTexto(e.target.value)} />
        </label>
        <button type="button" className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" disabled={loading} onClick={() => void cargarRutas()}>
          {loading ? "Buscando…" : "Buscar"}
        </button>
        <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-white" onClick={abrirNueva}>
          + Nueva ruta
        </button>
      </div>

      {/*
        RUTAS-TARIFARIO-HISTORIAL-1 (§10/§11 del ticket) — resumen de
        errores arriba del formulario. `error` puede traer varias líneas
        ("Título:\n• Campo: motivo.\n..." — respuestaErrorValidacion,
        @/lib/validacion-http) — whitespace-pre-line las respeta.
      */}
      {error ? <p className="whitespace-pre-line text-xs text-red-300">{error}</p> : null}
      {msg ? <p className="text-xs text-emerald-400">{msg}</p> : null}

      {mostrarForm ? (
        <div ref={formRef} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-sm font-medium">{editandoId ? "Editar ruta" : "Nueva ruta"}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <ClienteSearch
                clientes={clientes}
                valueNombre={formClienteNombre}
                valueId={formClienteId}
                inputClassName={inputCls}
                onChange={({ clienteId, clienteNombre }) => {
                  setFormClienteId(clienteId);
                  setFormClienteNombre(clienteNombre);
                  setForm((f) => ({ ...f, ubicacionCargaId: null, contactoClienteId: null }));
                }}
              />
            </div>
            <label className="text-xs text-[var(--muted)]">
              Código
              <input data-campo="codigo" className={`${campoCls("codigo")} mt-0.5 w-full`} value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} />
              {mensajeCampo("codigo")}
            </label>
            <label className="text-xs text-[var(--muted)]">
              Nombre/descripción
              <input data-campo="nombre" className={`${campoCls("nombre")} mt-0.5 w-full`} value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
              {mensajeCampo("nombre")}
            </label>

            <div className="text-xs text-[var(--muted)]">
              {/*
                Seguimiento a feedback del usuario — antes era un <select>
                plano (no dejaba escribir/filtrar) y no existía forma de
                dar de alta un lugar de carga nuevo desde Rutas: quedaba
                como texto suelto de esa ruta (campo de abajo), sin quedar
                disponible para futuras rutas del mismo cliente. Mismo
                buscador ya usado para piloto/auxiliar/contacto.
              */}
              <CatalogoSearchSelect
                label="lugar de carga guardado"
                placeholder="Buscar por nombre…"
                value={form.ubicacionCargaId != null ? String(form.ubicacionCargaId) : ""}
                options={ubicacionesForm.map((u) => ({ value: String(u.id), label: u.nombre, detail: u.direccion ?? undefined }))}
                inputClassName={campoCls("ubicacionCargaId")}
                onChange={(v) => setForm((f) => ({ ...f, ubicacionCargaId: v ? Number(v) : null }))}
              />
              {mensajeCampo("ubicacionCargaId")}
              {formClienteId ? (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-[var(--accent)] hover:underline"
                  onClick={() => setMostrarNuevaUbicacion((v) => !v)}
                >
                  {mostrarNuevaUbicacion ? "Cancelar lugar nuevo" : "+ Agregar lugar de carga"}
                </button>
              ) : null}
              {mostrarNuevaUbicacion ? (
                <div className="mt-2 space-y-1.5 rounded border border-[var(--border)]/60 p-2">
                  <input className={`${inputCls} w-full`} placeholder="Nombre / alias (ej. Bodega Central)" value={nuevaUbicacion.nombre} onChange={(e) => setNuevaUbicacion((u) => ({ ...u, nombre: e.target.value }))} />
                  <input className={`${inputCls} w-full`} placeholder="Dirección (opcional)" value={nuevaUbicacion.direccion} onChange={(e) => setNuevaUbicacion((u) => ({ ...u, direccion: e.target.value }))} />
                  <button type="button" disabled={guardandoUbicacion} className="rounded bg-[#334155] px-2 py-1 text-xs text-white disabled:opacity-50" onClick={() => void guardarNuevaUbicacion()}>
                    {guardandoUbicacion ? "Guardando…" : "Guardar lugar de carga"}
                  </button>
                </div>
              ) : null}
            </div>
            <label className="text-xs text-[var(--muted)]">
              Lugar de carga (texto libre, si no está en el catálogo)
              <input
                data-campo="lugarCargaTexto"
                className={`${campoCls("lugarCargaTexto")} mt-0.5 w-full`}
                value={form.lugarCargaTexto}
                onChange={(e) => setForm((f) => ({ ...f, lugarCargaTexto: e.target.value }))}
              />
              {mensajeCampo("lugarCargaTexto")}
            </label>
            <label className="text-xs text-[var(--muted)]">
              Hora habitual
              <input
                data-campo="horaHabitual"
                type="time"
                className={`${campoCls("horaHabitual")} mt-0.5 w-full`}
                value={form.horaHabitual}
                onChange={(e) => setForm((f) => ({ ...f, horaHabitual: e.target.value }))}
              />
              {mensajeCampo("horaHabitual")}
            </label>
            <label className="text-xs text-[var(--muted)]">
              Tarifa de referencia (GTQ)
              <input
                data-campo="tarifaReferencia"
                type="number"
                min="0"
                step="0.01"
                className={`${campoCls("tarifaReferencia")} mt-0.5 w-full`}
                value={form.tarifaReferencia}
                onChange={(e) => setForm((f) => ({ ...f, tarifaReferencia: e.target.value }))}
              />
              <span className="mt-0.5 block text-[10px]">
                Valor rápido de compatibilidad. Cuando la ruta tiene varias tarifas, se sincroniza con la <strong>tarifa predeterminada</strong> (ver &quot;Tarifas de la ruta&quot; en cada fila del listado).
              </span>
              {mensajeCampo("tarifaReferencia")}
            </label>
            {/* RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§4) — unidad
                habitual de la ruta (flota de esta empresa). Opcional.
                Programación la precarga; el usuario puede cambiarla por
                viaje sin tocar esta configuración. */}
            <div className="text-xs text-[var(--muted)]">
              <CatalogoSearchSelect
                label="Unidad recurrente"
                placeholder="Buscar unidad recurrente"
                value={form.unidadRecurrenteId}
                options={flotaVehiculos.map((v) => ({
                  value: String(v.id),
                  label: v.placa,
                  detail: [v.marca, v.modelo].filter(Boolean).join(" ") || undefined,
                }))}
                inputClassName={campoCls("unidadRecurrenteId")}
                emptyLabel="— Sin unidad recurrente —"
                selectDataCampo="unidadRecurrenteId"
                onChange={(value) => setForm((f) => ({ ...f, unidadRecurrenteId: value }))}
              />
              <span className="mt-0.5 block text-[10px]">Se precarga al elegir esta ruta en Programación.</span>
              {mensajeCampo("unidadRecurrenteId")}
            </div>
            {/*
              RUTAS-TARIFARIO-HISTORIAL-1 (§1/§2/§5 del ticket) — cada
              cambio de tarifa queda en el historial (nunca sobrescribe
              silenciosamente el único valor). El motivo es obligatorio
              cuando la ruta YA tenía una tarifa (tarifaAnteriorExiste,
              fijado en abrirEditar) — el servidor lo vuelve a exigir de
              todas formas.
            */}
            <label className="text-xs text-[var(--muted)]">
              Vigente desde
              <input
                data-campo="tarifaVigenteDesde"
                type="date"
                className={`${campoCls("tarifaVigenteDesde")} mt-0.5 w-full`}
                value={form.tarifaVigenteDesde}
                onChange={(e) => setForm((f) => ({ ...f, tarifaVigenteDesde: e.target.value }))}
              />
              {mensajeCampo("tarifaVigenteDesde")}
            </label>
            <label className="text-xs text-[var(--muted)] sm:col-span-2">
              Motivo del cambio de tarifa{tarifaAnteriorExiste ? " (obligatorio)" : " (opcional en la primera tarifa)"}
              <input
                data-campo="tarifaMotivo"
                className={`${campoCls("tarifaMotivo")} mt-0.5 w-full`}
                placeholder='Ej. "Ajuste de tarifa solicitado por Gerencia"'
                value={form.tarifaMotivo}
                onChange={(e) => setForm((f) => ({ ...f, tarifaMotivo: e.target.value }))}
              />
              {mensajeCampo("tarifaMotivo")}
            </label>
            <label className="text-xs text-[var(--muted)] sm:col-span-3">
              Destino (descripción operativa completa — como la usa Operaciones, ej. &quot;RUTA-A -
              punto1-punto2-punto3&quot;)
              <input
                data-campo="destinoDescripcion"
                className={`${campoCls("destinoDescripcion")} mt-0.5 w-full`}
                value={form.destinoDescripcion}
                onChange={(e) => setForm((f) => ({ ...f, destinoDescripcion: e.target.value }))}
              />
              <span className="mt-0.5 block text-[10px]">
                Esta descripción es lo que sale en el reporte tradicional (columna &quot;Lugar de
                Descarga&quot;). Las paradas estructuradas de abajo son un dato aparte, para
                seguimiento operativo — no la reemplazan.
              </span>
              {mensajeCampo("destinoDescripcion")}
            </label>

            <div className="text-xs text-[var(--muted)] sm:col-span-2">
              <label>
                Contacto del cliente
                <select
                  data-campo="contactoClienteId"
                  className={`${campoCls("contactoClienteId")} mt-0.5 w-full`}
                  value={form.contactoClienteId ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, contactoClienteId: Number(e.target.value) || null }))}
                >
                  <option value="">— Ninguno —</option>
                  {contactosForm.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}{c.cargo ? ` (${c.cargo})` : ""}{c.telefono ? ` · ${c.telefono}` : ""}
                    </option>
                  ))}
                </select>
                {mensajeCampo("contactoClienteId")}
              </label>
              {formClienteId && !contactosForm.length ? (
                <span className="mt-0.5 block text-[10px] text-amber-300/90">Este cliente no tiene contactos guardados todavía.</span>
              ) : null}
              {/* RUTAS-TARIFARIO-HISTORIAL-1 (§7/§8 del ticket) — "+ Agregar contacto" desde la misma captura de Ruta. */}
              {formClienteId ? (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-[var(--accent)] hover:underline"
                  onClick={() => { setMostrarNuevoContacto((v) => !v); setAvisoDuplicadoContacto(null); }}
                >
                  {mostrarNuevoContacto ? "Cancelar nuevo contacto" : "+ Agregar contacto"}
                </button>
              ) : null}
              {mostrarNuevoContacto ? (
                <div className="mt-2 space-y-1.5 rounded border border-[var(--border)]/60 p-2">
                  <input className={`${inputCls} w-full`} placeholder="Nombre" value={nuevoContacto.nombre} onChange={(e) => setNuevoContacto((c) => ({ ...c, nombre: e.target.value }))} />
                  <input className={`${inputCls} w-full`} placeholder="Cargo / área" value={nuevoContacto.cargo} onChange={(e) => setNuevoContacto((c) => ({ ...c, cargo: e.target.value }))} />
                  <input className={`${inputCls} w-full`} placeholder="Teléfono" value={nuevoContacto.telefono} onChange={(e) => setNuevoContacto((c) => ({ ...c, telefono: e.target.value }))} />
                  <input className={`${inputCls} w-full`} placeholder="Email" value={nuevoContacto.email} onChange={(e) => setNuevoContacto((c) => ({ ...c, email: e.target.value }))} />
                  <input className={`${inputCls} w-full`} placeholder="Observaciones" value={nuevoContacto.observaciones} onChange={(e) => setNuevoContacto((c) => ({ ...c, observaciones: e.target.value }))} />
                  {avisoDuplicadoContacto ? (
                    <div className="rounded border border-amber-500/50 bg-amber-950/30 p-2 text-[11px] text-amber-200">
                      <p>{avisoDuplicadoContacto}</p>
                      <div className="mt-1 flex gap-2">
                        <button type="button" disabled={guardandoContacto} className="rounded bg-amber-600 px-2 py-1 text-white" onClick={() => void guardarNuevoContacto(true)}>
                          Guardar de todas formas
                        </button>
                        <button type="button" className="rounded border border-[var(--border)] px-2 py-1" onClick={() => setAvisoDuplicadoContacto(null)}>
                          Revisar datos
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" disabled={guardandoContacto} className="rounded bg-[#334155] px-2 py-1 text-xs text-white disabled:opacity-50" onClick={() => void guardarNuevoContacto(false)}>
                      {guardandoContacto ? "Guardando…" : "Guardar contacto"}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            <label className="text-xs text-[var(--muted)]">
              Observaciones
              <input data-campo="observaciones" className={`${campoCls("observaciones")} mt-0.5 w-full`} value={form.observaciones} onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))} />
              {mensajeCampo("observaciones")}
            </label>
          </div>

          <div className="space-y-2 rounded border border-[var(--border)] p-3">
            <div>
              <p className="text-xs font-medium">Personal y viáticos habituales (opcional)</p>
              <p className="text-[10px] text-[var(--muted)]">Son sugerencias para Programación. Se permite un piloto y hasta ocho auxiliares; cada viaje puede ajustarse.</p>
            </div>
            {personalForm.map((fila, idx) => (
              <div key={`${fila.empleadoId}-${idx}`} className="grid gap-2 sm:grid-cols-[120px_1fr_160px_auto]">
                <select
                  className={inputCls}
                  value={fila.rol}
                  onChange={(e) => setPersonalForm((list) => list.map((p, i) => i === idx ? { ...p, rol: e.target.value as RutaPersonalForm["rol"] } : p))}
                >
                  <option value="Piloto">Piloto</option>
                  <option value="Auxiliar">Auxiliar</option>
                </select>
                {/*
                  RUTAS-TARIFARIO-HISTORIAL-1 (§9 del ticket) — buscador +
                  select visible, mismo patrón que Solicitudes de Fondo
                  (CatalogoSearchSelect): se busca principalmente por
                  nombre; el código queda como detalle opcional, nunca
                  obligatorio para encontrar al empleado.
                */}
                <CatalogoSearchSelect
                  label={fila.rol === "Piloto" ? "piloto" : "auxiliar"}
                  placeholder="Buscar por nombre…"
                  value={String(fila.empleadoId)}
                  options={opcionesPersonal}
                  inputClassName={inputCls}
                  onChange={(v) => setPersonalForm((list) => list.map((p, i) => i === idx ? { ...p, empleadoId: Number(v) } : p))}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Viático (GTQ)"
                  className={inputCls}
                  value={fila.viaticoMonto}
                  onChange={(e) => setPersonalForm((list) => list.map((p, i) => i === idx ? { ...p, viaticoMonto: e.target.value } : p))}
                />
                <button type="button" className="text-xs text-red-300" onClick={() => setPersonalForm((list) => list.filter((_, i) => i !== idx))}>Quitar</button>
              </div>
            ))}
            <button
              type="button"
              className="rounded bg-[#334155] px-2 py-1 text-xs text-white disabled:opacity-50"
              disabled={!personal.length || personalForm.length >= 9}
              onClick={() => {
                const disponible = personal.find((p) => !personalForm.some((actual) => actual.empleadoId === p.id));
                if (disponible) setPersonalForm((list) => [...list, { empleadoId: disponible.id, rol: list.some((p) => p.rol === "Piloto") ? "Auxiliar" : "Piloto", viaticoMonto: "" }]);
              }}
            >
              + Agregar personal habitual
            </button>
          </div>

          <div className="space-y-2 rounded border border-[var(--border)] p-3">
            <p className="text-xs font-medium">Paradas estructuradas (opcional, uno o varios puntos con orden — para seguimiento operativo, aparte de la descripción de destino)</p>
            {paradasForm.map((p, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-xs text-[var(--muted)]">{idx + 1}.</span>
                <input
                  className={`${inputCls} min-w-[160px] flex-1`}
                  placeholder="Lugar / destino"
                  value={p.lugarNombre}
                  onChange={(e) =>
                    setParadasForm((list) => list.map((x, i) => (i === idx ? { ...x, lugarNombre: e.target.value, clienteUbicacionId: null } : x)))
                  }
                />
                <select
                  className={inputCls}
                  value={p.tipo}
                  onChange={(e) => setParadasForm((list) => list.map((x, i) => (i === idx ? { ...x, tipo: e.target.value } : x)))}
                >
                  <option value="Entrega">Entrega</option>
                  <option value="Descarga">Descarga</option>
                  <option value="Carga">Carga</option>
                </select>
                {ubicacionesForm.length ? (
                  <select
                    className={`${inputCls} max-w-[180px]`}
                    value={p.clienteUbicacionId ?? ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const u = ubicacionesForm.find((x) => x.id === id);
                      setParadasForm((list) =>
                        list.map((x, i) => (i === idx ? { ...x, clienteUbicacionId: id || null, lugarNombre: u ? u.nombre : x.lugarNombre } : x)),
                      );
                    }}
                  >
                    <option value="">— Ubicación guardada —</option>
                    {ubicacionesForm.map((u) => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                ) : null}
                <button type="button" className="text-xs text-red-300" onClick={() => setParadasForm((list) => list.filter((_, i) => i !== idx))}>
                  Quitar
                </button>
              </div>
            ))}
            <button
              type="button"
              className="rounded bg-[#334155] px-2 py-1 text-xs text-white"
              onClick={() => setParadasForm((list) => [...list, { tipo: "Entrega", lugarNombre: "", clienteUbicacionId: null }])}
            >
              + Agregar destino
            </button>
          </div>

          <div className="flex gap-2">
            <button type="button" disabled={guardando} onClick={() => void guardar()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50">
              {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear ruta"}
            </button>
            <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs" onClick={() => setMostrarForm(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1F6AA5] text-white">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Carga</th>
              <th className="px-3 py-2">Hora</th>
              <th className="px-3 py-2">Tarifario</th>
              <th className="px-3 py-2">Personal habitual</th>
              <th className="px-3 py-2">Contacto</th>
              <th className="px-3 py-2">Destino (descripción)</th>
              <th className="px-3 py-2">Paradas estructuradas</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rutasFiltradas.map((r) => (
              <Fragment key={r.id}>
                <tr className={`border-t border-[var(--border)] ${r.activo ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2 font-mono">{r.codigo}</td>
                  <td className="px-3 py-2">{r.clienteNombre}</td>
                  <td className="px-3 py-2">{r.nombre || "—"}</td>
                  <td className="px-3 py-2 text-[11px]">{r.lugarCargaTexto || "—"}</td>
                  <td className="px-3 py-2">{r.horaHabitual || "—"}</td>
                  <td className="px-3 py-2">{r.tarifaReferencia != null ? `Q${r.tarifaReferencia.toLocaleString("es-GT", { minimumFractionDigits: 2 })}` : "—"}</td>
                  <td className="px-3 py-2 text-[11px]">
                    {r.personalPredeterminado.length
                      ? r.personalPredeterminado.map((p) => `${p.rol}: ${p.empleadoNombre}${p.viaticoMonto != null ? ` (Q${p.viaticoMonto.toFixed(2)})` : ""}`).join(" · ")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    {r.contactoNombre ? `${r.contactoNombre}${r.contactoTelefono ? ` · ${r.contactoTelefono}` : ""}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px]">{r.destinoDescripcion || "—"}</td>
                  <td className="px-3 py-2 text-[11px]">
                    {r.paradas.length ? r.paradas.map((p) => p.lugarNombre).join(" → ") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${r.activo ? "bg-emerald-900/50 text-emerald-200" : "bg-[var(--input)] text-[var(--muted)]"}`}>
                      {r.activo ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button type="button" className="text-sky-300 hover:underline" onClick={() => abrirEditar(r)}>Editar</button>
                      <button
                        type="button"
                        className={r.activo ? "text-amber-300 hover:underline" : "text-emerald-300 hover:underline"}
                        onClick={() => void toggleActivo(r)}
                      >
                        {r.activo ? "Desactivar" : "Activar"}
                      </button>
                      {/* RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§1) — opciones de tarifa (varias activas a la vez). */}
                      <button
                        type="button"
                        className="text-slate-100 hover:underline"
                        onClick={() => setTarifasRutaId((id) => (id === r.id ? null : r.id))}
                      >
                        {tarifasRutaId === r.id ? "Ocultar tarifas" : "Tarifas de la ruta"}
                      </button>
                      {/* RUTAS-TARIFARIO-HISTORIAL-1 (§4 del ticket) — "Historial de tarifas" por ruta. */}
                      <button type="button" className="text-slate-300 hover:underline" onClick={() => void abrirHistorial(r.id)}>
                        {historialRutaId === r.id ? "Ocultar historial" : "Historial de tarifas"}
                      </button>
                    </div>
                  </td>
                </tr>
                {tarifasRutaId === r.id ? (
                  <tr key={`${r.id}-tarifas`} className="border-t border-[var(--border)] bg-[var(--input)]/40">
                    <td colSpan={13} className="px-3 py-3">
                      <RutaTarifasPanel
                        slug={slug}
                        rutaId={r.id}
                        rutaCodigo={r.codigo}
                        onCambio={() => void cargarRutas()}
                      />
                    </td>
                  </tr>
                ) : null}
                {historialRutaId === r.id ? (
                  <tr key={`${r.id}-historial`} className="border-t border-[var(--border)] bg-[var(--input)]/40">
                    <td colSpan={12} className="px-3 py-3">
                      <p className="mb-1 text-xs font-medium">Historial de tarifas — {r.codigo}</p>
                      {historialCargando ? (
                        <p className="text-xs text-[var(--muted)]">Cargando…</p>
                      ) : historial.length ? (
                        <table className="w-full text-left text-xs">
                          <thead className="text-[var(--muted)]">
                            <tr>
                              <th className="pr-3">Fecha</th>
                              <th className="pr-3">Tarifa</th>
                              <th className="pr-3">Vigente desde</th>
                              <th className="pr-3">Motivo</th>
                              <th className="pr-3">Modificado por</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* §4 del ticket: orden descendente — ya lo entrega el endpoint (listarHistorialTarifas). Solo lectura: sin editar/borrar desde aquí. */}
                            {historial.map((h) => (
                              <tr key={h.id} className="border-t border-[var(--border)]/40">
                                <td className="py-1 pr-3">{h.creadoEn ? h.creadoEn.slice(0, 10).split("-").reverse().join("/") : "—"}</td>
                                <td className="py-1 pr-3">Q{h.tarifa.toLocaleString("es-GT", { minimumFractionDigits: 2 })}</td>
                                <td className="py-1 pr-3">{h.vigenteDesde.split("-").reverse().join("/")}</td>
                                <td className="py-1 pr-3">{h.motivo || "—"}</td>
                                <td className="py-1 pr-3">{h.usuarioNombre || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-xs text-[var(--muted)]">Sin cambios de tarifa registrados todavía.</p>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {!rutasFiltradas.length && !loading ? (
              <tr>
                <td colSpan={13} className="px-3 py-4 text-[var(--muted)]">Sin rutas con este filtro.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
