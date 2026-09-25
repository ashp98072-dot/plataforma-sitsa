import { tienePermiso, type PermisoModulo } from "@/lib/permisos-shared";

/**
 * RRHH VACACIONES — lógica PURA (sin React) del botón "Eliminar" del historial: permiso, texto de confirmación,
 * envío del DELETE con candado contra doble clic y mensaje de éxito. El backend es la autoridad.
 */
const TIPOS_CON_SALDO = new Set(["Vacaciones", "A cuenta de Vacaciones"]);
const TIPOS_ELIMINABLES = new Set([...TIPOS_CON_SALDO, "Permiso con goce", "Permiso sin goce", "IGSS", "Médico"]);

export type FilaHistorial = { id: number; emp_codigo?: unknown; emp_nombre?: unknown; tipo?: unknown; fecha_inicio?: unknown; fecha_fin?: unknown; dias_habiles?: unknown; evidencias?: unknown };

/** Botón visible solo con vacaciones:eliminar (Admin según el sistema normal de permisos). */
export function puedeEliminarVacaciones(rol: string | null | undefined, permisos: PermisoModulo[]): boolean {
  return rol === "Admin" || tienePermiso(permisos, "vacaciones", "eliminar");
}

export const tipoDescuentaSaldo = (tipo: string) => TIPOS_CON_SALDO.has(tipo);
export const tipoEliminable = (tipo: string) => TIPOS_ELIMINABLES.has(tipo);

const dma = (v: unknown) => {
  const p = String(v ?? "").slice(0, 10).split("-");
  return p.length === 3 && p[0].length === 4 ? `${p[2]}/${p[1]}/${p[0]}` : String(v ?? "—");
};
const dias2 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : String(v ?? "—"));

export type TextoConfirmacion = { titulo: string; empleado: string; periodo: string; dias: string; aviso: string; botonConfirmar: string };

export function textoConfirmacion(f: FilaHistorial): TextoConfirmacion {
  const conSaldo = tipoDescuentaSaldo(String(f.tipo ?? ""));
  return {
    titulo: "Eliminar registro de vacaciones",
    empleado: `${String(f.emp_codigo ?? "").trim()}${f.emp_codigo && f.emp_nombre ? " — " : ""}${String(f.emp_nombre ?? "")}`.trim(),
    periodo: `${dma(f.fecha_inicio)} → ${dma(f.fecha_fin)}`,
    dias: dias2(f.dias_habiles),
    aviso: conSaldo
      ? "Este registro será eliminado y los días consumidos serán devueltos al saldo del colaborador."
      : "Este registro será eliminado.",
    botonConfirmar: conSaldo ? "Eliminar y devolver días" : "Eliminar",
  };
}

export const urlEliminar = (slug: string, id: number) => `/api/empresas/${slug}/rrhh/vacaciones/${id}`;

export const mensajeExito = (diasRestaurados: number, conSaldo = true) =>
  conSaldo ? `Registro eliminado. Se restauraron ${diasRestaurados} día(s) al saldo.` : "Registro eliminado.";

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type RespuestaEliminar =
  | { tipo: "ok"; mensaje: string; diasRestaurados: number; empleadoId: number | null; advertencias: string[] }
  | { tipo: "error"; error: string; status: number };

/** DELETE exacto por id. Un error conserva la fila (la UI no la quita). */
export async function enviarEliminar(fetchFn: FetchFn, slug: string, id: number, conSaldo = true): Promise<RespuestaEliminar> {
  try {
    const res = await fetchFn(urlEliminar(slug, id), { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; diasRestaurados?: number; empleadoId?: number; advertencias?: string[] };
    if (!res.ok || !data.ok) return { tipo: "error", error: data.error ?? "No se pudo eliminar el registro.", status: res.status };
    const dias = Number(data.diasRestaurados ?? 0);
    return { tipo: "ok", mensaje: mensajeExito(dias, conSaldo), diasRestaurados: dias, empleadoId: data.empleadoId ?? null, advertencias: data.advertencias ?? [] };
  } catch {
    return { tipo: "error", error: "Error de conexión al eliminar. No se modificó nada.", status: 0 };
  }
}

/** Candado síncrono contra doble clic: mientras hay un DELETE en curso, otro intento no envía nada (devuelve null). */
export async function eliminarUnaVez(
  candado: { current: boolean },
  fetchFn: FetchFn,
  slug: string,
  id: number,
  conSaldo = true,
): Promise<RespuestaEliminar | null> {
  if (candado.current) return null;
  candado.current = true;
  try {
    return await enviarEliminar(fetchFn, slug, id, conSaldo);
  } finally {
    candado.current = false;
  }
}
