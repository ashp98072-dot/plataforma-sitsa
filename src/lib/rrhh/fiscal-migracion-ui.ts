import { tienePermiso, type PermisoModulo } from "@/lib/permisos-shared";

/**
 * RRHH — Ficha del empleado, sección "7. Fiscal / ISR": lógica PURA (sin React) del acumulado fiscal inicial de migración.
 * Reutiliza el contrato existente de antecedentes fiscales (POST captura, PATCH confirma); el servidor es la autoridad.
 *
 * PERMISOS (sin permiso nuevo): se reutiliza el submódulo RRHH "configuracion", el mismo que ya exigen los endpoints fiscales
 * existentes — ver = leer, crear = guardar borrador, editar = confirmar. Quien solo ve empleados NO captura acumulados.
 */
export type PermisosFiscal = { puedeVer: boolean; puedeCapturar: boolean; puedeConfirmar: boolean };
export function permisosFiscal(rol: string | null | undefined, permisos: PermisoModulo[]): PermisosFiscal {
  if (rol === "Admin") return { puedeVer: true, puedeCapturar: true, puedeConfirmar: true };
  return {
    puedeVer: tienePermiso(permisos, "configuracion", "ver"),
    puedeCapturar: tienePermiso(permisos, "configuracion", "crear"),
    puedeConfirmar: tienePermiso(permisos, "configuracion", "editar"),
  };
}

export type RevisionFiscalUi = {
  revision: number;
  corteAntecedentes: string | null;
  ingresosGravadosPrevios: string | null;
  ingresosExentosPrevios: string | null;
  igssLaboralPrevio: string | null;
  isrRetenidoPrevio: string | null;
  datos: { declaracionAntecedentes: string; migracion?: { referenciaOrigen: string; observacion: string | null; documentoId: number | null } };
  creadoPor?: string;
  confirmadoPor: string | null;
  confirmadoEn: string | null;
};
export type LecturaFiscalUi = { ultima: RevisionFiscalUi | null; confirmada: RevisionFiscalUi | null; revisiones?: RevisionFiscalUi[] };

const MIGRACION = "ACUMULADO_INICIAL_MIGRACION";
export const esMigracionUi = (r: RevisionFiscalUi | null | undefined) => r?.datos.declaracionAntecedentes === MIGRACION;

export type EstadoFiscalUi = { clave: "SIN_CONFIGURAR" | "BORRADOR" | "SIN_ANTECEDENTES" | "OTRO_PATRONO" | "MIGRACION" | "CONFIRMADO"; etiqueta: string };
/** Estado fiscal a mostrar (la última CONFIRMADA es la que usa el motor; un borrador posterior no la reemplaza hasta confirmarse). */
export function estadoFiscalUi(l: LecturaFiscalUi | null | undefined): EstadoFiscalUi {
  const c = l?.confirmada;
  if (c) {
    if (esMigracionUi(c)) return { clave: "MIGRACION", etiqueta: "Acumulado inicial de migración · Confirmado" };
    if (c.datos.declaracionAntecedentes === "SIN_ANTECEDENTES") return { clave: "SIN_ANTECEDENTES", etiqueta: "Sin antecedentes · Confirmado" };
    if (c.datos.declaracionAntecedentes === "CON_ANTECEDENTES") return { clave: "OTRO_PATRONO", etiqueta: "Con antecedentes de otro patrono · Confirmado" };
    return { clave: "CONFIRMADO", etiqueta: "Confirmado" };
  }
  if (l?.ultima) return { clave: "BORRADOR", etiqueta: "Borrador sin confirmar" };
  return { clave: "SIN_CONFIGURAR", etiqueta: "Sin configurar" };
}

/** Borrador pendiente de confirmar (última revisión aún sin confirmar): es lo que confirma el botón "Confirmar acumulado". */
export function borradorPendiente(l: LecturaFiscalUi | null | undefined): RevisionFiscalUi | null {
  return l?.ultima && l.ultima.confirmadoEn == null && esMigracionUi(l.ultima) ? l.ultima : null;
}

export type FormularioMigracion = {
  fechaCorte: string;
  gravado: string;
  exento: string;
  igss: string;
  isr: string;
  referencia: string;
  observaciones: string;
};
export const AYUDA_FECHA_CORTE =
  "Indica el último día incluido en los acumulados del sistema anterior. La primera planilla del sistema nuevo debe comenzar después de esta fecha.";
export const EJEMPLO_FECHA_CORTE = "Ejemplo: si el sistema anterior cubre hasta el 15/09/2026, la fecha de corte es 15/09/2026 y la primera planilla nueva puede iniciar el 16/09/2026.";

export const formularioVacio = (): FormularioMigracion => ({
  // Sin fecha por defecto: RRHH debe indicar explícitamente el último día cubierto por el sistema anterior (no se asume ninguna).
  fechaCorte: "", gravado: "", exento: "", igss: "", isr: "", referencia: "Sistema anterior de planillas", observaciones: "",
});
const quitar = (v: string | null) => (v == null ? "" : v);
export function formularioDesdeRevision(r: RevisionFiscalUi): FormularioMigracion {
  return {
    fechaCorte: quitar(r.corteAntecedentes), gravado: quitar(r.ingresosGravadosPrevios), exento: quitar(r.ingresosExentosPrevios),
    igss: quitar(r.igssLaboralPrevio), isr: quitar(r.isrRetenidoPrevio),
    referencia: r.datos.migracion?.referenciaOrigen ?? "", observaciones: r.datos.migracion?.observacion ?? "",
  };
}

/** "45000.5" → "45000.50"; vacío, negativo, con más de 2 decimales, NaN o notación científica → null. Acepta 0. */
export function montoATexto(valor: string): string | null {
  const v = valor.trim().replace(/^Q/i, "").trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(v)) return null;
  const [ent, dec = ""] = v.split(".");
  const e = ent.replace(/^0+(?=\d)/, "");
  return `${e}.${dec.padEnd(2, "0")}`;
}

export type CuerpoCaptura = {
  expectedRevision: number;
  antecedente: {
    inicioFiscal: string; corteAntecedentes: string;
    ingresosGravadosPrevios: string; ingresosExentosPrevios: string; igssLaboralPrevio: string; isrRetenidoPrevio: string;
    datos: {
      version: 1; declaracionAntecedentes: typeof MIGRACION; constancias: never[]; ingresosPreviosPorConcepto: never[]; ajustesPrevios: never[];
      deducciones: never[]; otrosPatronos: { declaracion: "NO"; agenteRetenedor: "ESTA_EMPRESA"; remuneraciones: never[] };
      migracion: { referenciaOrigen: string; observacion: string | null; documentoId: null };
    };
  };
};

/** Cuerpo del POST de captura (borrador). Validación de UX previa; el servidor vuelve a validar todo. */
export function construirCuerpoMigracion(f: FormularioMigracion, ejercicio: number, expectedRevision: number, hoy: string): { cuerpo: CuerpoCaptura } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fechaCorte)) return { error: "Indica la fecha de corte." };
  if (Number(f.fechaCorte.slice(0, 4)) !== ejercicio) return { error: `La fecha de corte debe estar dentro del ejercicio ${ejercicio}.` };
  if (f.fechaCorte > hoy) return { error: "La fecha de corte no puede ser posterior a hoy." };
  const campos: [string, string][] = [["Ingresos gravados acumulados", f.gravado], ["Ingresos exentos acumulados", f.exento], ["IGSS laboral acumulado", f.igss], ["ISR retenido acumulado", f.isr]];
  const montos: string[] = [];
  for (const [nombre, valor] of campos) {
    const m = montoATexto(valor);
    if (m == null) return { error: `${nombre}: indica un monto ≥ 0 con máximo 2 decimales (usa 0 si no hubo).` };
    montos.push(m);
  }
  if (!f.referencia.trim()) return { error: "Indica el origen / referencia (por ejemplo, el reporte del sistema anterior)." };
  return {
    cuerpo: {
      expectedRevision,
      antecedente: {
        inicioFiscal: `${ejercicio}-01-01`, corteAntecedentes: f.fechaCorte,
        ingresosGravadosPrevios: montos[0], ingresosExentosPrevios: montos[1], igssLaboralPrevio: montos[2], isrRetenidoPrevio: montos[3],
        datos: {
          version: 1, declaracionAntecedentes: MIGRACION, constancias: [], ingresosPreviosPorConcepto: [], ajustesPrevios: [], deducciones: [],
          otrosPatronos: { declaracion: "NO", agenteRetenedor: "ESTA_EMPRESA", remuneraciones: [] },
          migracion: { referenciaOrigen: f.referencia.trim(), observacion: f.observaciones.trim() || null, documentoId: null },
        },
      },
    },
  };
}

const dma = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
export const formatoQ = (v: string | null) => (v == null ? "—" : `Q${Number(v).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Resumen que se muestra ANTES de confirmar. */
export function resumenAcumulado(r: RevisionFiscalUi, ejercicio: number) {
  return {
    titulo: `ACUMULADO FISCAL INICIAL ${ejercicio}`,
    corte: `Corte: ${dma(r.corteAntecedentes)}`,
    lineas: [
      `Ingresos gravados: ${formatoQ(r.ingresosGravadosPrevios)}`,
      `Ingresos exentos: ${formatoQ(r.ingresosExentosPrevios)}`,
      `IGSS laboral: ${formatoQ(r.igssLaboralPrevio)}`,
      `ISR retenido: ${formatoQ(r.isrRetenidoPrevio)}`,
    ],
    aviso:
      "Estos valores representan lo acumulado en el sistema anterior hasta la fecha de corte. Después de confirmar serán utilizados para proyectar el ISR de las planillas posteriores.",
  };
}

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export const urlFiscal = (slug: string, empleadoId: number, ejercicio: number) => `/api/empresas/${slug}/rrhh/fiscal/empleados/${empleadoId}/${ejercicio}`;
export type RespuestaFiscal = { tipo: "ok"; revision: number } | { tipo: "error"; error: string; status: number };

async function enviar(fetchFn: FetchFn, url: string, method: "POST" | "PATCH", body: unknown): Promise<RespuestaFiscal> {
  try {
    const res = await fetchFn(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { revision?: number; error?: string };
    if (!res.ok) return { tipo: "error", error: data.error ?? "No se pudo completar la operación.", status: res.status };
    return { tipo: "ok", revision: Number(data.revision ?? 0) };
  } catch {
    return { tipo: "error", error: "Error de conexión. No se guardó nada.", status: 0 };
  }
}
export const guardarBorrador = (f: FetchFn, slug: string, empleadoId: number, ejercicio: number, cuerpo: CuerpoCaptura) => enviar(f, urlFiscal(slug, empleadoId, ejercicio), "POST", cuerpo);
export const confirmarRevision = (f: FetchFn, slug: string, empleadoId: number, ejercicio: number, revision: number) =>
  enviar(f, urlFiscal(slug, empleadoId, ejercicio), "PATCH", { accion: "confirmar", revision });

/** Candado síncrono contra doble submit: mientras hay una operación en curso, otro intento no envía nada (null). */
export async function unaSolaVez<T>(candado: { current: boolean }, trabajo: () => Promise<T>): Promise<T | null> {
  if (candado.current) return null;
  candado.current = true;
  try { return await trabajo(); } finally { candado.current = false; }
}

/** Texto de la planilla: "Fiscal 2026: Migración inicial confirmada · Corte dd/mm/aaaa" + acumulados usados (tooltip). */
export function resumenFiscalLinea(snapshot: unknown): { texto: string; detalle: string } | null {
  const f = (snapshot as { fiscal?: { ejercicio?: number; origenFiscal?: { tipo: string; fechaCorte: string | null; revision: number }; inputUsado?: { antecedentes?: { ingresosGravadosQ: string; ingresosExentosQ: string; igssLaboralQ: string; isrRetenidoQ: string } | null } } } | null | undefined)?.fiscal;
  if (!f?.origenFiscal) return null;
  const o = f.origenFiscal;
  const a = f.inputUsado?.antecedentes;
  const detalle = a
    ? `Gravado acumulado: ${formatoQ(a.ingresosGravadosQ)} · Exento: ${formatoQ(a.ingresosExentosQ)} · IGSS acumulado: ${formatoQ(a.igssLaboralQ)} · ISR retenido: ${formatoQ(a.isrRetenidoQ)} · revisión ${o.revision}`
    : `Revisión fiscal ${o.revision}`;
  const nombre = o.tipo === MIGRACION ? "Migración inicial confirmada" : o.tipo === "ANTECEDENTES_OTRO_PATRONO" ? "Antecedentes de otro patrono" : "Sin antecedentes";
  return { texto: `Fiscal ${f.ejercicio ?? ""}: ${nombre}${o.tipo === MIGRACION ? ` · Corte: ${dma(o.fechaCorte)}` : ""}`.replace("  ", " "), detalle };
}
