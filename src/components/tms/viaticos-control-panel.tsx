"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TEXTO_FIRMA_INTERNA } from "@/lib/firmas/textos";
import type { FirmaCanvasHandle } from "@/components/tms/firma-canvas";
import SelectorFirma from "@/components/tms/selector-firma";
import HistorialFirmasModal from "@/components/tms/historial-firmas-modal";

type ViaticoControlRow = {
  id: number;
  planId: number;
  planCodigo: string;
  fechaPlan: string;
  cliente: string | null;
  personalNombre: string;
  rol: string;
  montoSugerido: number;
  montoAsignado: number;
  estado: string;
  metodoPago: string | null;
  referenciaPago: string | null;
  banco?: string | null;
  tipoCuenta?: string | null;
  cuentaBancaria?: string | null;
};

/** VIATICOS-FIRMA — confirmación mostrada tras firmar (nunca "Firma Electrónica Avanzada"/certificado/PSC/legal). */
type FirmaInfo = {
  firmaId: number;
  codigoFirma: string;
  nombreFirmante: string;
  rolFirmante: string;
  fechaHoraServidor: string;
  /** VIATICOS-FIRMA-VISUAL — si trae imagen manuscrita para mostrar (ver GET .../firmas/[firmaId]/imagen). */
  tieneImagen: boolean;
};

type Resumen = {
  pendientes: number;
  autorizados: number;
  entregados: number;
  liquidados: number;
};

function q(n: number): string {
  return `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

const ESTADO_BADGE_CLS: Record<string, string> = {
  PROGRAMADO: "bg-[var(--input)] text-[var(--muted)]",
  AUTORIZADO: "bg-sky-950/40 text-sky-300",
  ENTREGADO: "bg-amber-950/40 text-amber-300",
  LIQUIDADO: "bg-emerald-950/40 text-emerald-300",
};

/**
 * Interpretación UI de los 4 estados REALES (no se inventan estados
 * nuevos — ver src/lib/tms/viaticos.ts, EstadoViatico): PROGRAMADO =
 * pendiente de autorización, AUTORIZADO = pendiente de pago, ENTREGADO =
 * pendiente de liquidación, LIQUIDADO = liquidado.
 */
const ESTADO_LABEL_UI: Record<string, string> = {
  PROGRAMADO: "Pendiente de autorización",
  AUTORIZADO: "Pendiente de pago",
  ENTREGADO: "Pendiente de liquidación",
  LIQUIDADO: "Liquidado",
};

/**
 * VIATICOS-BANDEJAS-1 — pestañas visibles (antes dropdown "Estado"),
 * mismos 4 estados reales, SIN "Rechazados" (no existe ese estado — ver
 * ticket VIATICOS-BANDEJAS-1). El valor es exactamente EstadoViatico
 * (viaticos.ts) — la pestaña solo cambia `fEstado`, el filtrado real
 * sigue ocurriendo en el servidor (listarViaticosControl), sin backend
 * nuevo.
 */
const PESTANAS_ESTADO: { estado: string; etiqueta: string }[] = [
  { estado: "PROGRAMADO", etiqueta: "Por autorizar" },
  { estado: "AUTORIZADO", etiqueta: "Autorizados" },
  { estado: "ENTREGADO", etiqueta: "Entregados" },
  { estado: "LIQUIDADO", etiqueta: "Liquidados" },
];

const METODO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
};

/**
 * VIAT-3 — listado global de "Operaciones > Viáticos" (reemplaza el antiguo
 * "Control de Viáticos" de TMS, que era de solo lectura — VIAT-1 punto 7).
 * Reutiliza EXACTAMENTE el mismo endpoint (`/tms/viaticos/control`) y las
 * mismas transiciones de VIAT-1/VIAT-2 (autorizarViatico/liquidarViatico) —
 * no se crea ningún motor nuevo, solo se agregan selección + botones que
 * llaman los endpoints atómicos ya existentes uno por uno.
 *
 * Autorizar (individual y masivo, con firma) requiere
 * `viaticos_autorizar:editar`. Liquidar (con firma) requiere
 * `viaticos_liquidar:editar` — VIATICOS-FIRMA: YA NO el genérico
 * `viaticos:editar`. Pagar/entregar vive en su propio panel separado
 * (ViaticosPorPagarPanel) — este NO lo duplica. Banco/cuenta solo se
 * muestran si el backend los incluyó en la respuesta (`puedeVerBancario`)
 * — nunca se piden ni se muestran por el cliente.
 */
export default function ViaticosControlPanel({ slug }: { slug: string }) {
  const [items, setItems] = useState<ViaticoControlRow[]>([]);
  const [resumen, setResumen] = useState<Resumen>({
    pendientes: 0,
    autorizados: 0,
    entregados: 0,
    liquidados: 0,
  });
  const [puedeAutorizar, setPuedeAutorizar] = useState(false);
  const [puedeLiquidar, setPuedeLiquidar] = useState(false);
  const [puedeVerBancario, setPuedeVerBancario] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const [fBusqueda, setFBusqueda] = useState("");
  const [fEmpleado, setFEmpleado] = useState("");
  const [fRol, setFRol] = useState("");
  const [fMetodo, setFMetodo] = useState("");
  const [fFechaDesde, setFFechaDesde] = useState("");
  const [fFechaHasta, setFFechaHasta] = useState("");
  const [fEstado, setFEstado] = useState("");

  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [autorizandoMasivo, setAutorizandoMasivo] = useState(false);

  // VIATICOS-FIRMA-VISUAL — modal "Autorizar seleccionados" (antes
  // window.prompt): la bandeja masiva firma con la MISMA imagen dibujada
  // una vez para todo el lote (cada autorización individual igual guarda
  // su propio archivo/fila de firma — ver guardarImagenFirma en
  // src/lib/tms/viaticos.ts — pero comparten el trazo de este único
  // gesto). Hotfix PR #124: el texto del modal deja esto explícito
  // ("Esta firma se aplicará a los N viáticos...") y cada POST envía
  // firmaLote=true, que autorizarViatico agrega como `firmaLote: true`
  // dentro del payload firmado de CADA autorización del lote — nunca se
  // pretende una firma distinta por viático. Se dejó fuera loteFirmaId
  // (identificador de lote) por alcance: ver reporte de entrega.
  // CORRECCIÓN URGENTE — autorizar (individual y masivo) YA NO pide
  // contraseña: sesión autenticada + permiso + firma manuscrita bastan
  // (ver JSDoc de autorizarViatico en src/lib/tms/viaticos.ts). Liquidar
  // SIGUE exigiéndola sin cambios (pwdLiquidar más abajo, intacto).
  //
  // CORRECCIÓN URGENTE (2ª vuelta) — "la firma desaparece al soltar el
  // mouse": el canvas ya NO empuja el File al padre en cada trazo (eso
  // causaba un re-render del padre en medio del dibujo). Ahora solo
  // notifica un booleano (tieneTrazo*) para habilitar el botón, y el
  // padre obtiene el PNG real llamando canvas*Ref.current.obtenerImagen()
  // UNA sola vez, al confirmar — ver src/components/tms/firma-canvas.tsx.
  //
  // CORRECCIÓN URGENTE (4ª vuelta) — `firmaSesion` es un contador que se
  // incrementa cada vez que se abre CUALQUIER modal de firma; su valor se
  // pasa como `sesionId` a FirmaCanvas para que, si el componente llegara
  // a desmontarse/remontarse mientras el usuario dibuja, pueda recuperar
  // el trazo desde el respaldo en memoria de firma-canvas.tsx — y para
  // que ese respaldo NUNCA se reutilice entre una autorización y otra
  // (cada apertura de modal obtiene un sesionId nuevo).
  const [firmaSesion, setFirmaSesion] = useState(0);

  // MI-FIRMA-1 — "¿tiene el usuario una firma guardada?" se consulta al
  // abrir CADA modal (nunca se asume vigente entre aperturas — pudo
  // cambiar/eliminarla desde "Mi firma"). `null` = cargando. Si tiene
  // una, el radio arranca en "Usar mi firma guardada" (default pedido en
  // el ticket); si no, se muestra directamente el canvas.
  const [masivoAbierto, setMasivoAbierto] = useState(false);
  const canvasMasivoRef = useRef<FirmaCanvasHandle | null>(null);
  const [tieneTrazoMasivo, setTieneTrazoMasivo] = useState(false);
  const [tieneFirmaGuardadaMasivo, setTieneFirmaGuardadaMasivo] = useState<boolean | null>(null);
  const [usarGuardadaMasivo, setUsarGuardadaMasivo] = useState(false);
  const [errorMasivo, setErrorMasivo] = useState("");

  // VIATICOS-FIRMA — modal "Firmar y autorizar".
  const [autorizando, setAutorizando] = useState<ViaticoControlRow | null>(null);
  const canvasAutorizarRef = useRef<FirmaCanvasHandle | null>(null);
  const [tieneTrazoAutorizar, setTieneTrazoAutorizar] = useState(false);
  const [tieneFirmaGuardadaAutorizar, setTieneFirmaGuardadaAutorizar] = useState<boolean | null>(null);
  const [usarGuardadaAutorizar, setUsarGuardadaAutorizar] = useState(false);
  const [errorAutorizar, setErrorAutorizar] = useState("");
  const [firmandoAutorizar, setFirmandoAutorizar] = useState(false);
  const [firmaAutorizarOk, setFirmaAutorizarOk] = useState<FirmaInfo | null>(null);

  // VIATICOS-FIRMA — modal "Firmar liquidación".
  const [liquidando, setLiquidando] = useState<ViaticoControlRow | null>(null);
  const [gastosComprobados, setGastosComprobados] = useState("");
  const [reintegro, setReintegro] = useState("");
  const [obsLiquidacion, setObsLiquidacion] = useState("");
  const [pwdLiquidar, setPwdLiquidar] = useState("");
  const canvasLiquidarRef = useRef<FirmaCanvasHandle | null>(null);
  const [tieneTrazoLiquidar, setTieneTrazoLiquidar] = useState(false);
  const [tieneFirmaGuardadaLiquidar, setTieneFirmaGuardadaLiquidar] = useState<boolean | null>(null);
  const [usarGuardadaLiquidar, setUsarGuardadaLiquidar] = useState(false);
  const [errorLiquidar, setErrorLiquidar] = useState("");
  const [firmandoLiquidar, setFirmandoLiquidar] = useState(false);
  const [firmaLiquidarOk, setFirmaLiquidarOk] = useState<FirmaInfo | null>(null);

  // VIATICOS-HISTORIAL-FIRMA-1 — "Ver firmas": modal de solo lectura,
  // reutilizado por cualquier fila que ya tenga al menos una firma
  // (AUTORIZADO/ENTREGADO/LIQUIDADO). El componente hace su propio fetch.
  const [verFirmasDe, setVerFirmasDe] = useState<ViaticoControlRow | null>(null);

  /** MI-FIRMA-1 — consulta si el usuario actual tiene una firma guardada. */
  const consultarFirmaGuardada = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/empresas/${slug}/mi-firma`);
      const data = await res.json().catch(() => ({}));
      return res.ok ? Boolean(data.tieneFirma) : false;
    } catch {
      return false;
    }
  }, [slug]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (fFechaDesde) params.set("fechaDesde", fFechaDesde);
      if (fFechaHasta) params.set("fechaHasta", fFechaHasta);
      if (fEmpleado.trim()) params.set("empleado", fEmpleado.trim());
      if (fEstado) params.set("estado", fEstado);
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/control?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar el listado de viáticos.");
        return;
      }
      setItems((data.items ?? []) as ViaticoControlRow[]);
      setResumen((data.resumen ?? resumen) as Resumen);
      setPuedeAutorizar(Boolean(data.puedeAutorizar));
      setPuedeLiquidar(Boolean(data.puedeLiquidar));
      setPuedeVerBancario(Boolean(data.puedeVerBancario));
      setSeleccionados(new Set());
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, fFechaDesde, fFechaHasta, fEmpleado, fEstado]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  // VIATICOS-BANDEJAS-1 — fBusqueda/fRol/fMetodo son filtros SOLO
  // client-side (no viajan al servidor, no disparan cargar()): a
  // diferencia de fEstado/fFechaDesde/fFechaHasta/fEmpleado (que sí
  // recargan y ya limpian la selección dentro de cargar()), cambiar
  // estos podía dejar seleccionados ids que quedan fuera de `filtrados`
  // — y autorizarSeleccionados() actúa sobre `seleccionados` en crudo,
  // no sobre la intersección con lo visible. Se limpia la selección
  // completa al cambiar cualquiera de estos filtros (preferencia del
  // ticket: "limpiar selección al cambiar filtros operativos para
  // evitar acciones accidentales") — nunca se autoriza silenciosamente
  // algo que dejó de estar a la vista.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeleccionados(new Set());
  }, [fBusqueda, fRol, fMetodo]);

  const filtrados = items.filter((r) => {
    if (fBusqueda.trim()) {
      const t = fBusqueda.trim().toLowerCase();
      const coincide =
        r.planCodigo.toLowerCase().includes(t) ||
        (r.cliente ?? "").toLowerCase().includes(t) ||
        r.personalNombre.toLowerCase().includes(t);
      if (!coincide) return false;
    }
    if (fRol && r.rol !== fRol) return false;
    if (fMetodo && r.metodoPago !== fMetodo) return false;
    return true;
  });

  function toggleSeleccion(id: number) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSeleccionTodos() {
    setSeleccionados((prev) =>
      prev.size === filtrados.length ? new Set() : new Set(filtrados.map((r) => r.id)),
    );
  }

  // VIATICOS-FIRMA — "Firmar y autorizar": abre el modal (Viaje/
  // Beneficiario/Monto), el POST solo ocurre al confirmar dentro del
  // modal, nunca al primer clic. CORRECCIÓN URGENTE: ya no pide
  // contraseña — solo exige un trazo dibujado (ver confirmarAutorizar).
  async function abrirAutorizar(row: ViaticoControlRow) {
    setAutorizando(row);
    setFirmaSesion((n) => n + 1);
    setTieneTrazoAutorizar(false);
    setErrorAutorizar("");
    setFirmaAutorizarOk(null);
    setTieneFirmaGuardadaAutorizar(null);
    const tiene = await consultarFirmaGuardada();
    setTieneFirmaGuardadaAutorizar(tiene);
    setUsarGuardadaAutorizar(tiene);
  }

  async function confirmarAutorizar() {
    if (!autorizando) return;
    const fd = new FormData();
    if (usarGuardadaAutorizar) {
      fd.set("usarFirmaGuardada", "true");
    } else {
      const firmaImagen = await canvasAutorizarRef.current?.obtenerImagen();
      if (!firmaImagen) {
        setErrorAutorizar("Dibuja tu firma antes de continuar.");
        return;
      }
      fd.set("firmaImagen", firmaImagen, "firma.png");
    }
    setFirmandoAutorizar(true);
    setErrorAutorizar("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${autorizando.id}/autorizar`, {
        method: "POST",
        body: fd,
      });
      // CORRECCIÓN URGENTE — un 500 sin cuerpo JSON (p. ej. página de error
      // de Hostinger) ya no se confunde con "Error de conexión.": se
      // intenta parsear y, si falla, se cae a un mensaje con el status real.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorAutorizar(data.error ?? `No se pudo autorizar el viático (${res.status}).`);
        return;
      }
      setFirmaAutorizarOk(data.firma as FirmaInfo);
      await cargar();
    } catch {
      setErrorAutorizar("Error de conexión.");
    } finally {
      setFirmandoAutorizar(false);
    }
  }

  // VIATICOS-FIRMA — "Firmar liquidación": monto entregado read-only,
  // gastos/reintegro editables, diferencia calculada en el propio JSX
  // (solo para habilitar/deshabilitar el botón — el backend sigue siendo
  // la autoridad real de la comparación exacta).
  async function abrirLiquidar(row: ViaticoControlRow) {
    setLiquidando(row);
    setFirmaSesion((n) => n + 1);
    setGastosComprobados("");
    setReintegro("");
    setObsLiquidacion("");
    setPwdLiquidar("");
    setTieneTrazoLiquidar(false);
    setErrorLiquidar("");
    setFirmaLiquidarOk(null);
    setTieneFirmaGuardadaLiquidar(null);
    const tiene = await consultarFirmaGuardada();
    setTieneFirmaGuardadaLiquidar(tiene);
    setUsarGuardadaLiquidar(tiene);
  }

  async function confirmarLiquidar() {
    if (!liquidando) return;
    const fd = new FormData();
    if (usarGuardadaLiquidar) {
      fd.set("usarFirmaGuardada", "true");
    } else {
      const firmaImagen = await canvasLiquidarRef.current?.obtenerImagen();
      if (!firmaImagen) {
        setErrorLiquidar("Dibuja tu firma antes de continuar.");
        return;
      }
      fd.set("firmaImagen", firmaImagen, "firma.png");
    }
    if (!pwdLiquidar) {
      setErrorLiquidar("Ingresa tu contraseña actual.");
      return;
    }
    setFirmandoLiquidar(true);
    setErrorLiquidar("");
    try {
      fd.set("gastosComprobados", gastosComprobados || "0");
      fd.set("reintegro", reintegro || "0");
      if (obsLiquidacion.trim()) fd.set("observaciones", obsLiquidacion.trim());
      fd.set("password", pwdLiquidar);
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${liquidando.id}/liquidar`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorLiquidar(data.error ?? `No se pudo liquidar el viático (${res.status}).`);
        return;
      }
      setFirmaLiquidarOk(data.firma as FirmaInfo);
      setPwdLiquidar("");
      await cargar();
    } catch {
      setErrorLiquidar("Error de conexión.");
    } finally {
      setFirmandoLiquidar(false);
    }
  }

  /** VIATICOS-FIRMA-VISUAL — abre el modal de firma masiva (antes window.prompt). */
  async function abrirMasivo() {
    if (!seleccionados.size) {
      setError("Selecciona al menos un viático PROGRAMADO para autorizar.");
      return;
    }
    setFirmaSesion((n) => n + 1);
    setTieneTrazoMasivo(false);
    setErrorMasivo("");
    setMasivoAbierto(true);
    setTieneFirmaGuardadaMasivo(null);
    const tiene = await consultarFirmaGuardada();
    setTieneFirmaGuardadaMasivo(tiene);
    setUsarGuardadaMasivo(tiene);
  }

  /**
   * "AUTORIZAR SELECCIONADOS" — llama el mismo endpoint atómico de a uno
   * por seleccionado (sin nuevo endpoint masivo en backend). Si alguno
   * falla (p. ej. ya no está PROGRAMADO), se reporta con nombre/motivo —
   * nunca se oculta un fallo parcial. CORRECCIÓN URGENTE: ya no pide
   * contraseña (autorizar no la exige) — solo el trazo dibujado UNA vez
   * para todo el lote. VIATICOS-FIRMA-VISUAL: la misma imagen (obtenida
   * UNA vez de canvasMasivoRef.obtenerImagen() antes del bucle) se
   * adjunta a cada llamada individual — cada una sigue generando su
   * PROPIO archivo/fila de firma en el servidor (guardarUpload se
   * ejecuta por cada POST), nunca se reutiliza una fila de
   * firmas_electronicas ya creada.
   */
  async function autorizarSeleccionados() {
    let firmaImagen: File | null = null;
    if (!usarGuardadaMasivo) {
      firmaImagen = (await canvasMasivoRef.current?.obtenerImagen()) ?? null;
      if (!firmaImagen) {
        setErrorMasivo("Dibuja tu firma antes de continuar.");
        return;
      }
    }
    setAutorizandoMasivo(true);
    setErrorMasivo("");
    setError("");
    setMensaje("");
    const ids = [...seleccionados];
    const porId = new Map(items.map((r) => [r.id, r]));
    const fallos: string[] = [];
    let exitos = 0;
    for (const id of ids) {
      try {
        const fd = new FormData();
        if (usarGuardadaMasivo) {
          fd.set("usarFirmaGuardada", "true");
        } else {
          fd.set("firmaImagen", firmaImagen!, "firma.png");
        }
        // VIATICOS-FIRMA-VISUAL (hotfix PR #124) — deja explícito en el
        // payload firmado de CADA autorización que este trazo se reutilizó
        // para todo el lote (nunca se pretende una firma distinta por viático).
        fd.set("firmaLote", "true");
        const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${id}/autorizar`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const nombre = porId.get(id)?.personalNombre ?? `#${id}`;
          fallos.push(`${nombre}: ${data.error ?? `error ${res.status}`}`);
        } else {
          exitos++;
        }
      } catch {
        const nombre = porId.get(id)?.personalNombre ?? `#${id}`;
        fallos.push(`${nombre}: error de conexión.`);
      }
    }
    if (exitos) setMensaje(`${exitos} viático(s) autorizado(s) y firmado(s).`);
    if (fallos.length) {
      setError(`No se pudieron autorizar ${fallos.length}: ${fallos.join(" · ")}`);
    }
    setAutorizandoMasivo(false);
    setMasivoAbierto(false);
    await cargar();
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs text-[var(--muted)]">
        Listado global de viáticos (información interna). Autorizar requiere permiso de
        autorización; liquidar requiere el permiso general. El pago/entrega se hace desde la
        sección &quot;Viáticos por pagar&quot; más abajo.
      </p>

      {/* VIATICOS-BANDEJAS-1 — pestañas por estado (reemplazan el dropdown
          "Estado" que existía más abajo). Mismo mecanismo de siempre:
          click alterna fEstado ("" = Todos, click de nuevo lo apaga) —
          eso ya dispara cargar() (fEstado es dependencia de cargar) y el
          propio cargar() limpia la selección al recargar. Sin
          "Rechazados": ese estado no existe (ver ticket). */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Filtrar por estado">
        {PESTANAS_ESTADO.map(({ estado, etiqueta }) => {
          const activa = fEstado === estado;
          const contador =
            estado === "PROGRAMADO"
              ? resumen.pendientes
              : estado === "AUTORIZADO"
                ? resumen.autorizados
                : estado === "ENTREGADO"
                  ? resumen.entregados
                  : resumen.liquidados;
          return (
            <button
              key={estado}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setFEstado(activa ? "" : estado)}
              className={`rounded border p-2 text-center text-sm font-medium transition ${activa ? "border-sky-500 bg-sky-950/20 text-sky-200" : "border-[var(--border)] hover:bg-[var(--input)]"}`}
            >
              {etiqueta} ({contador})
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Viaje / cliente / empleado
          <input className={`${inputCls} mt-0.5 block w-48`} value={fBusqueda} onChange={(e) => setFBusqueda(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Empleado (servidor)
          <input className={`${inputCls} mt-0.5 block w-40`} value={fEmpleado} onChange={(e) => setFEmpleado(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Rol
          <select className={`${inputCls} mt-0.5 block`} value={fRol} onChange={(e) => setFRol(e.target.value)}>
            <option value="">Todos</option>
            <option value="Piloto">Piloto</option>
            <option value="Auxiliar">Auxiliar</option>
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Método de pago
          <select className={`${inputCls} mt-0.5 block`} value={fMetodo} onChange={(e) => setFMetodo(e.target.value)}>
            <option value="">Todos</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="CHEQUE">Cheque</option>
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Desde
          <input type="date" className={`${inputCls} mt-0.5 block`} value={fFechaDesde} onChange={(e) => setFFechaDesde(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Hasta
          <input type="date" className={`${inputCls} mt-0.5 block`} value={fFechaHasta} onChange={(e) => setFFechaHasta(e.target.value)} />
        </label>
        <button
          type="button"
          className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
          disabled={loading}
          onClick={() => void cargar()}
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
        {puedeAutorizar ? (
          <button
            type="button"
            className="rounded bg-sky-700 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            disabled={autorizandoMasivo || !seleccionados.size}
            onClick={() => void abrirMasivo()}
          >
            {autorizandoMasivo ? "Autorizando…" : `Autorizar seleccionados${seleccionados.size ? ` (${seleccionados.size})` : ""}`}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {mensaje ? <p className="text-xs text-emerald-300">{mensaje}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1F6AA5] text-white">
            <tr>
              {puedeAutorizar ? (
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={filtrados.length > 0 && seleccionados.size === filtrados.length}
                    onChange={toggleSeleccionTodos}
                  />
                </th>
              ) : null}
              <th className="px-3 py-2">Viaje</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Empleado</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Sugerido</th>
              <th className="px-3 py-2">Asignado</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Método</th>
              {puedeVerBancario ? (
                <>
                  <th className="px-3 py-2">Banco</th>
                  <th className="px-3 py-2">Cuenta</th>
                </>
              ) : null}
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                {puedeAutorizar ? (
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={seleccionados.has(r.id)} onChange={() => toggleSeleccion(r.id)} />
                  </td>
                ) : null}
                <td className="px-3 py-2">{r.planCodigo}</td>
                <td className="px-3 py-2">{r.fechaPlan}</td>
                <td className="px-3 py-2">{r.cliente ?? "—"}</td>
                <td className="px-3 py-2">{r.personalNombre}</td>
                <td className="px-3 py-2">{r.rol}</td>
                <td className="px-3 py-2">{q(r.montoSugerido)}</td>
                <td className="px-3 py-2">{q(r.montoAsignado)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ESTADO_BADGE_CLS[r.estado] ?? ""}`}>
                    {ESTADO_LABEL_UI[r.estado] ?? r.estado}
                  </span>
                </td>
                <td className="px-3 py-2">{r.metodoPago ? METODO_PAGO_LABEL[r.metodoPago] ?? r.metodoPago : "—"}</td>
                {puedeVerBancario ? (
                  <>
                    <td className="px-3 py-2 text-[11px]">{r.banco || "—"}</td>
                    <td className="px-3 py-2 text-[11px]">
                      {r.cuentaBancaria ? `${r.cuentaBancaria}${r.tipoCuenta ? ` (${r.tipoCuenta})` : ""}` : "—"}
                    </td>
                  </>
                ) : null}
                <td className="px-3 py-2">
                  {puedeAutorizar && r.estado === "PROGRAMADO" ? (
                    <button
                      type="button"
                      onClick={() => void abrirAutorizar(r)}
                      className="rounded bg-sky-700 px-2 py-1 text-xs text-white"
                    >
                      Firmar y autorizar
                    </button>
                  ) : null}
                  {puedeLiquidar && r.estado === "ENTREGADO" ? (
                    <button
                      type="button"
                      onClick={() => void abrirLiquidar(r)}
                      className="rounded bg-emerald-700 px-2 py-1 text-xs text-white"
                    >
                      Firmar liquidación
                    </button>
                  ) : null}
                  {/* VIATICOS-HISTORIAL-FIRMA-1 — visible en cuanto exista al
                      menos una firma (AUTORIZADO/ENTREGADO/LIQUIDADO); un
                      LIQUIDADO puede tener autorización + liquidación, de ahí
                      "Ver firmas" en plural (sección 6 del ticket). */}
                  {r.estado !== "PROGRAMADO" ? (
                    <button
                      type="button"
                      onClick={() => setVerFirmasDe(r)}
                      className="ml-1 rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--input)]"
                    >
                      Ver firmas
                    </button>
                  ) : null}
                  {/* Único caso sin ningún botón: PROGRAMADO y sin permiso
                      de autorizar — "Ver firmas" ya cubre todo lo demás
                      (ENTREGADO/LIQUIDADO siempre tienen al menos una firma). */}
                  {r.estado === "PROGRAMADO" && !puedeAutorizar ? (
                    <span className="text-[11px] text-[var(--muted)]">—</span>
                  ) : null}
                </td>
              </tr>
            ))}
            {!filtrados.length && !loading ? (
              <tr>
                <td colSpan={puedeAutorizar ? (puedeVerBancario ? 13 : 11) : puedeVerBancario ? 12 : 10} className="px-3 py-4 text-[var(--muted)]">
                  Sin viáticos con este filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* VIATICOS-FIRMA — modal "Firma de autorización". Firma electrónica
          INTERNA y SIMBÓLICA: nunca "Firma Electrónica Avanzada"/
          certificado/PSC/legal. */}
      {autorizando ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            {firmaAutorizarOk ? (
              <>
                <h3 className="text-sm font-semibold">Viático autorizado</h3>
                <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-3 text-xs">
                  {firmaAutorizarOk.tieneImagen ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagen servida por endpoint autenticado propio, no un asset estático de Next.
                    <img
                      src={`/api/empresas/${slug}/tms/viaticos/firmas/${firmaAutorizarOk.firmaId}/imagen`}
                      alt="Firma manuscrita"
                      className="mb-2 h-20 w-full rounded border border-[var(--border)] bg-white object-contain"
                    />
                  ) : null}
                  <p className="font-medium">Firmado electrónicamente por:</p>
                  <p className="mt-1 text-sm font-semibold">{firmaAutorizarOk.nombreFirmante}</p>
                  <p className="mt-1"><span className="text-[var(--muted)]">Rol:</span> {firmaAutorizarOk.rolFirmante}</p>
                  <p><span className="text-[var(--muted)]">Fecha:</span> {new Date(firmaAutorizarOk.fechaHoraServidor).toLocaleString("es-GT")}</p>
                  <p><span className="text-[var(--muted)]">Código de firma:</span> {firmaAutorizarOk.codigoFirma}</p>
                </div>
                <button
                  type="button"
                  className="w-full rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                  onClick={() => setAutorizando(null)}
                >
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold">Firma de autorización</h3>
                <div className="space-y-1 text-xs">
                  <p><span className="text-[var(--muted)]">Viaje:</span> {autorizando.planCodigo}{autorizando.cliente ? ` · ${autorizando.cliente}` : ""}</p>
                  <p><span className="text-[var(--muted)]">Beneficiario:</span> {autorizando.personalNombre} ({autorizando.rol})</p>
                  <p><span className="text-[var(--muted)]">Monto:</span> {q(autorizando.montoAsignado)}</p>
                </div>
                <p className="text-xs text-[var(--muted)]">Al firmar confirmas que autorizas este viático.</p>
                <SelectorFirma
                  slug={slug}
                  tieneFirmaGuardada={tieneFirmaGuardadaAutorizar}
                  usarGuardada={usarGuardadaAutorizar}
                  onCambiaUsarGuardada={setUsarGuardadaAutorizar}
                  canvasRef={canvasAutorizarRef}
                  sesionId={`autorizar-${autorizando.id}-${firmaSesion}`}
                  onCambiaTrazo={setTieneTrazoAutorizar}
                  disabled={firmandoAutorizar}
                />
                <p className="text-[10px] text-[var(--muted)]">{TEXTO_FIRMA_INTERNA} — no es una firma legal certificada.</p>
                {errorAutorizar ? <p className="text-xs text-red-300">{errorAutorizar}</p> : null}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={firmandoAutorizar || (!usarGuardadaAutorizar && !tieneTrazoAutorizar)}
                    className="flex-1 rounded bg-sky-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    onClick={() => void confirmarAutorizar()}
                  >
                    {firmandoAutorizar ? "Firmando…" : "Firmar y autorizar"}
                  </button>
                  <button
                    type="button"
                    disabled={firmandoAutorizar}
                    className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
                    onClick={() => setAutorizando(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* VIATICOS-FIRMA — modal "Firma de liquidación". Diferencia calculada
          en vivo SOLO para habilitar/deshabilitar el botón — el backend
          sigue siendo la autoridad real de la comparación exacta (centavos,
          nunca float). */}
      {liquidando ? (
        (() => {
          const centavosUi = (v: string) => {
            const n = Number(v || "0");
            return Number.isFinite(n) ? Math.round(n * 100) : NaN;
          };
          const montoCent = Math.round(liquidando.montoAsignado * 100);
          const gastosCent = centavosUi(gastosComprobados);
          const reintegroCent = centavosUi(reintegro);
          const valoresValidos = Number.isFinite(gastosCent) && Number.isFinite(reintegroCent) && gastosCent >= 0 && reintegroCent >= 0;
          const diferenciaCent = valoresValidos ? montoCent - gastosCent - reintegroCent : NaN;
          const puedeFirmar = valoresValidos && diferenciaCent === 0;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
                {firmaLiquidarOk ? (
                  <>
                    <h3 className="text-sm font-semibold">Viático liquidado</h3>
                    <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-3 text-xs">
                      {firmaLiquidarOk.tieneImagen ? (
                        // eslint-disable-next-line @next/next/no-img-element -- imagen servida por endpoint autenticado propio, no un asset estático de Next.
                        <img
                          src={`/api/empresas/${slug}/tms/viaticos/firmas/${firmaLiquidarOk.firmaId}/imagen`}
                          alt="Firma manuscrita"
                          className="mb-2 h-20 w-full rounded border border-[var(--border)] bg-white object-contain"
                        />
                      ) : null}
                      <p className="font-medium">Firmado electrónicamente por:</p>
                      <p className="mt-1 text-sm font-semibold">{firmaLiquidarOk.nombreFirmante}</p>
                      <p className="mt-1"><span className="text-[var(--muted)]">Rol:</span> {firmaLiquidarOk.rolFirmante}</p>
                      <p><span className="text-[var(--muted)]">Fecha:</span> {new Date(firmaLiquidarOk.fechaHoraServidor).toLocaleString("es-GT")}</p>
                      <p><span className="text-[var(--muted)]">Código de firma:</span> {firmaLiquidarOk.codigoFirma}</p>
                    </div>
                    <button
                      type="button"
                      className="w-full rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                      onClick={() => setLiquidando(null)}
                    >
                      Cerrar
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold">Firma de liquidación</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="text-[var(--muted)]">
                        Monto entregado
                        <input className={`${inputCls} mt-0.5 block w-full bg-[var(--panel)]`} value={q(liquidando.montoAsignado)} disabled readOnly />
                      </label>
                      <label className="text-[var(--muted)]">
                        Gastos comprobados
                        <input inputMode="decimal" className={`${inputCls} mt-0.5 block w-full`} value={gastosComprobados} onChange={(e) => setGastosComprobados(e.target.value)} placeholder="0.00" />
                      </label>
                      <label className="text-[var(--muted)]">
                        Reintegro
                        <input inputMode="decimal" className={`${inputCls} mt-0.5 block w-full`} value={reintegro} onChange={(e) => setReintegro(e.target.value)} placeholder="0.00" />
                      </label>
                      <label className="text-[var(--muted)]">
                        Diferencia
                        <input className={`${inputCls} mt-0.5 block w-full bg-[var(--panel)]`} value={valoresValidos ? q(diferenciaCent / 100) : "—"} disabled readOnly />
                      </label>
                    </div>
                    {valoresValidos && diferenciaCent > 0 ? (
                      <p className="text-xs text-amber-300">Pendiente por comprobar o reintegrar: {q(diferenciaCent / 100)}</p>
                    ) : null}
                    {valoresValidos && diferenciaCent < 0 ? (
                      <p className="text-xs text-red-300">Los gastos y reintegros superan el monto entregado. Revisa la liquidación.</p>
                    ) : null}
                    <label className="block text-xs text-[var(--muted)]">
                      Observaciones (opcional)
                      <input className={`${inputCls} mt-0.5 block w-full`} value={obsLiquidacion} onChange={(e) => setObsLiquidacion(e.target.value)} maxLength={300} />
                    </label>
                    <p className="text-xs text-[var(--muted)]">Al firmar confirmas que revisaste esta liquidación.</p>
                    <SelectorFirma
                      slug={slug}
                      tieneFirmaGuardada={tieneFirmaGuardadaLiquidar}
                      usarGuardada={usarGuardadaLiquidar}
                      onCambiaUsarGuardada={setUsarGuardadaLiquidar}
                      canvasRef={canvasLiquidarRef}
                      sesionId={`liquidar-${liquidando.id}-${firmaSesion}`}
                      onCambiaTrazo={setTieneTrazoLiquidar}
                      disabled={firmandoLiquidar}
                    />
                    <p className="text-[10px] text-[var(--muted)]">{TEXTO_FIRMA_INTERNA} — no es una firma legal certificada.</p>
                    <label className="block text-xs text-[var(--muted)]">
                      Contraseña
                      <input
                        type="password"
                        className={`${inputCls} mt-0.5 block w-full`}
                        value={pwdLiquidar}
                        onChange={(e) => setPwdLiquidar(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && puedeFirmar && (usarGuardadaLiquidar || tieneTrazoLiquidar)) void confirmarLiquidar(); }}
                      />
                    </label>
                    {errorLiquidar ? <p className="text-xs text-red-300">{errorLiquidar}</p> : null}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        disabled={firmandoLiquidar || !puedeFirmar || (!usarGuardadaLiquidar && !tieneTrazoLiquidar)}
                        title={!puedeFirmar ? "La diferencia debe ser exactamente Q0.00 para poder firmar la liquidación." : undefined}
                        className="flex-1 rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                        onClick={() => void confirmarLiquidar()}
                      >
                        {firmandoLiquidar ? "Firmando…" : "Firmar liquidación"}
                      </button>
                      <button
                        type="button"
                        disabled={firmandoLiquidar}
                        className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
                        onClick={() => setLiquidando(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()
      ) : null}

      {/* VIATICOS-FIRMA-VISUAL — modal "Autorizar seleccionados" (antes
          window.prompt sin canvas). Una sola firma dibujada para todo el
          lote — ver decisión documentada en autorizarSeleccionados(). */}
      {masivoAbierto ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <h3 className="text-sm font-semibold">Firmar y autorizar seleccionados ({seleccionados.size})</h3>
            <p className="text-xs text-[var(--muted)]">
              Esta firma se aplicará a los {seleccionados.size} viáticos seleccionados: se usará la misma para
              autorizar cada uno de ellos.
            </p>
            <SelectorFirma
              slug={slug}
              tieneFirmaGuardada={tieneFirmaGuardadaMasivo}
              usarGuardada={usarGuardadaMasivo}
              onCambiaUsarGuardada={setUsarGuardadaMasivo}
              canvasRef={canvasMasivoRef}
              sesionId={`masivo-${firmaSesion}`}
              onCambiaTrazo={setTieneTrazoMasivo}
              disabled={autorizandoMasivo}
            />
            <p className="text-[10px] text-[var(--muted)]">{TEXTO_FIRMA_INTERNA} — no es una firma legal certificada.</p>
            {errorMasivo ? <p className="text-xs text-red-300">{errorMasivo}</p> : null}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={autorizandoMasivo || (!usarGuardadaMasivo && !tieneTrazoMasivo)}
                className="flex-1 rounded bg-sky-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                onClick={() => void autorizarSeleccionados()}
              >
                {autorizandoMasivo ? "Firmando…" : `Firmar y autorizar (${seleccionados.size})`}
              </button>
              <button
                type="button"
                disabled={autorizandoMasivo}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
                onClick={() => setMasivoAbierto(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {verFirmasDe ? (
        <HistorialFirmasModal
          slug={slug}
          viatico={{ id: verFirmasDe.id, planCodigo: verFirmasDe.planCodigo, personalNombre: verFirmasDe.personalNombre }}
          onClose={() => setVerFirmasDe(null)}
        />
      ) : null}
    </div>
  );
}
