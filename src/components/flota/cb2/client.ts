import { productos } from "@/lib/flota/cb2/clasificacion";
export type FilaCB2 = {
    lote?: string | null;
    kilometraje?: string | null;
    origen?: { producto: string; km: string; galones: string; precio: string; monto: string; fecha?: string; vale?: string; placa?: string; serie?: string; factura?: string; piloto?: string; lote?: string; auxiliar?: string };
    hoja: string;
    fila: number;
    candidato: string | null;
    bloqueada: boolean;
    documento: {
        serie: string;
        numero: string;
        moneda: string;
    } | null;
    errores: string[];
    estado: string;
    motivos: string[];
    vale: string;
    placa: string;
    placaNormalizada: string;
    fecha: string | null;
    galones: string | null;
    precio: string | null;
    monto: string | null;
    moneda: string;
};
export type PreviewCB2 = {
    sha256: string;
    token: string;
    filas: FilaCB2[];
    nota: string;
};
export type Registro = {
    id: number;
    proveedor_id: number;
    [key: string]: unknown;
};
export type CatalogosCB2 = {
    empleados?: { id: number; nombre: string }[];
    pilotos?: { id: number; nombre: string }[];
    limitacionPilotos?: string;
    proveedores: {
        id: number;
        nombre: string;
    }[];
    vehiculos: {
        id: number;
        placa: string;
        descripcion?: string;
    }[];
};
export type SeleccionCB2 = {
    candidato: string;
    vehiculoId: number;
    empleadoId?: number | null;
    productoClasificado?: import("@/lib/flota/cb2/clasificacion").Producto;
    motivoUnidad?: string;
}[];
export class FalloCB2 extends Error {
    constructor(message: string, public definitivo = false) { super(message); }
}
export async function jsonCB2<T>(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
    let r: Response;
    try {
        r = await fetcher(url, { ...init, cache: "no-store", credentials: "same-origin" });
    }
    catch {
        throw new FalloCB2("Conexión interrumpida. No se conoce el resultado; reintenta la misma solicitud.");
    }
    let data: unknown;
    try {
        data = await r.json();
    }
    catch {
        throw new FalloCB2("Respuesta incompleta o sesión vencida. Conserva esta solicitud y vuelve a autenticarte antes de reintentar.");
    }
    if (!r.ok) {
        const message = data && typeof data === "object" && "error" in data ? String(data.error) : "No se pudo completar la solicitud.";
        throw new FalloCB2(message, [400, 401, 403, 404, 409, 413].includes(r.status));
    }
    return data as T;
}
export async function excelPrivadoCB2(url: string, fetcher: typeof fetch = fetch) {
    const r = await fetcher(url, { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) {
        let mensaje = "No se pudo descargar el Excel privado.";
        try {
            mensaje = (await r.json()).error ?? mensaje;
        }
        catch { }
        throw new Error(mensaje);
    }
    if (!r.headers.get("content-type")?.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        throw new Error("Respuesta de descarga inválida; comprueba tu sesión.");
    return r.blob();
}
export function apiCB2(slug: string) { return `/api/empresas/${encodeURIComponent(slug)}/flota/combustible/cb2`; }
export async function todasCB2(base: string, query = "", signal?: AbortSignal): Promise<Registro[]> {
    const result: Registro[] = [];
    let after = 0;
    for (;;) {
        const rows = await jsonCB2<Registro[]>(`${base}?${query}&limite=500&despues=${after}`, { signal });
        if (!Array.isArray(rows))
            throw new FalloCB2("Listado inválido.", true);
        result.push(...rows);
        if (rows.length < 500)
            return result;
        const next = Number(rows.at(-1)?.id);
        if (next <= after)
            throw new FalloCB2("El historial no avanzó; no se puede certificar su integridad.", true);
        after = next;
    }
}
export function elecciones(value: Record<string, string>): SeleccionCB2 { return Object.entries(value).filter(([, v]) => v).map(([candidato, v]) => ({ candidato, vehiculoId: Number(v) })).sort((a, b) => a.candidato.localeCompare(b.candidato)); }
export function formCB2(file: File, perfil: string, proveedor: string, moneda: string, seleccion: SeleccionCB2) { const f = new FormData(); f.set("file", file); f.set("perfil", perfil); f.set("proveedorId", proveedor); f.set("moneda", moneda); f.set("seleccion", JSON.stringify(seleccion)); return f; }
export function leerObjeto(value: unknown): Record<string, unknown> {
    try {
        const o = typeof value === "string" ? JSON.parse(value) : value;
        return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    }
    catch {
        return {};
    }
}
export type EstadoOrigenCB2 = "PENDIENTE" | "RESUELTA" | "BLOQUEADA" | "IGNORADA";
export type FilaOrigenCB2 = FilaCB2 & {
    estadoAparicion: EstadoOrigenCB2;
    estadoCandidato: EstadoOrigenCB2;
    consumoId: number | null;
};
export function gruposOrigen(rows: Registro[]): FilaOrigenCB2[] {
    const originales = rows.filter(r => r.tipo === "ORIGEN");
    const eventos = new Map<number, Registro[]>();
    // ASOCIACION_FACTURA no modifica la resolucion operativa de una aparicion.
    for (const r of [...rows].sort((a, b) => Number(a.revision) - Number(b.revision) || a.id - b.id)) {
        if (r.tipo !== "ORIGEN" && r.tipo !== "RESOLUCION")
            continue;
        const id = Number(r.tipo === "ORIGEN" ? r.id : r.origen_fila_id);
        eventos.set(id, [...(eventos.get(id) ?? []), r]);
    }
    const filas = originales.map(o => {
        const f = leerObjeto(o.datos_origen), d = leerObjeto(o.decision), historia = eventos.get(o.id) ?? [o], actual = historia[historia.length - 1];
        const creadas = historia.filter(e => ["CREADA", "REUTILIZADA"].includes(String(e.resultado)) && Number.isInteger(e.consumo_id) && Number(e.consumo_id) > 0);
        const consumos = new Set(creadas.map(e => Number(e.consumo_id)));
        // Una resolucion posterior sin consumo no deshace una creacion/reutilizacion.
        const consumoId = consumos.size === 1 ? [...consumos][0] : null;
        const candidato = typeof d.candidato === "string" ? d.candidato : null;
        const estado: EstadoOrigenCB2 = consumos.size > 1 ? "BLOQUEADA" : consumoId !== null ? "RESUELTA" : !candidato && actual.resultado === "IGNORADA" ? "IGNORADA" : candidato && actual.resultado === "OMITIDA" ? "PENDIENTE" : "BLOQUEADA";
        return { origen: f.textos as FilaCB2["origen"], lote: f.lote == null ? null : String(f.lote), hoja: String(o.hoja_nombre), fila: Number(o.fila_excel), candidato, bloqueada: estado !== "PENDIENTE", documento: null, errores: [], estado, estadoAparicion: estado, estadoCandidato: estado, consumoId, motivos: [String(actual.motivo ?? o.motivo ?? "")], vale: String(f.vale ?? ""), placa: String(f.placaOriginal ?? ""), placaNormalizada: String(f.placaNormalizada ?? ""), fecha: typeof f.fechaConsumo === "string" ? f.fechaConsumo : null, galones: typeof f.galones === "string" ? f.galones : null, precio: typeof f.precio === "string" ? f.precio : null, monto: typeof f.monto === "string" ? f.monto : null, moneda: String(d.moneda ?? "") } satisfies FilaOrigenCB2;
    });
    const grupos = new Map<string, FilaOrigenCB2[]>();
    for (const f of filas)
        if (f.candidato)
            grupos.set(f.candidato, [...(grupos.get(f.candidato) ?? []), f]);
    for (const grupo of grupos.values()) {
        const estado: EstadoOrigenCB2 = grupo.every(f => f.estadoAparicion === "RESUELTA") ? "RESUELTA" : grupo.some(f => f.estadoAparicion === "BLOQUEADA") ? "BLOQUEADA" : "PENDIENTE";
        for (const f of grupo) {
            f.estadoCandidato = estado;
            f.bloqueada = estado !== "PENDIENTE" || f.estadoAparicion !== "PENDIENTE";
            f.motivos.push(`Candidato: ${estado}`);
        }
    }
    return filas; // Nunca eliminar apariciones ya resueltas del historial.
}
export function seleccionPendienteCB2(filas: FilaOrigenCB2[], seleccion: Record<string, string>): SeleccionCB2 {
    const pendientes = new Set(filas.filter(f => f.estadoCandidato === "PENDIENTE" && f.estadoAparicion === "PENDIENTE" && f.candidato).map(f => f.candidato!));
    return elecciones(seleccion).filter(s => pendientes.has(s.candidato));
}
export function resultadoCB2(value: unknown, accion?: string, identidad?: unknown) {
    if (accion === "corregir") {
        const r = leerObjeto(value), a = leerObjeto(r.asignacion), esperada = leerObjeto(identidad);
        if (Number.isInteger(r.consumoId) && Number(r.consumoId)>0 && Number.isInteger(a.vehiculoId) && Number(a.vehiculoId)>0 && (a.empleadoId === null || (Number.isInteger(a.empleadoId) && Number(a.empleadoId)>0)) && r.consumoId === esperada.consumoId && a.vehiculoId === esperada.vehiculoId && a.empleadoId === esperada.empleadoId && a.productoClasificado === esperada.productoClasificado && productos.some(p => p === a.productoClasificado) && Number.isInteger(a.revision) && a.revision === Number(esperada.revision) + 1) return value;
        throw new FalloCB2("Respuesta sin certificacion de la correccion. Conserva y reintenta la misma solicitud.");
    }
    const r = value as {
        existente?: boolean;
        importacionId?: number;
        eventos?: {
            id: number;
            importacionId: number;
            revision: number;
            resultado: string;
            consumoId: number | null;
        }[];
    } | null;
    if (r?.existente === true && Number.isInteger(r.importacionId) && Number(r.importacionId) > 0)
        return value;
    if (r && Array.isArray(r.eventos) && r.eventos.length > 0 && r.eventos.every(e => Number.isInteger(e.id) && e.id > 0 && Number.isInteger(e.importacionId) && e.importacionId > 0 && Number.isInteger(e.revision) && e.revision > 0 && typeof e.resultado === "string" && (e.consumoId === null || Number.isInteger(e.consumoId))))
        return value;
    throw new FalloCB2("Respuesta sin certificación de la operación. Conserva y reintenta exactamente la misma solicitud.");
}
/** Una operación congelada por error incierto. No guarda archivos ni tokens en storage. */
export class OperacionCB2 {
    busy = false;
    pending: {
        action: string;
        fingerprint: string;
        key: string;
        ejecutar?: (key: string) => Promise<unknown>;
        identidad?: unknown;
        definitivo: boolean;
    } | null = null;
    constructor(private scope: string, private storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
        try {
            const v = storage?.getItem(scope);
            if (v) {
                const p = JSON.parse(v);
                if (typeof p.action === "string" && typeof p.fingerprint === "string" && typeof p.key === "string")
                    this.pending = { ...p, definitivo: false };
            }
        }
        catch { /* almacenamiento privado no disponible */ }
    }
    private guardar() {
        try {
            if (this.pending)
                this.storage?.setItem(this.scope, JSON.stringify({ action: this.pending.action, fingerprint: this.pending.fingerprint, key: this.pending.key, identidad: this.pending.identidad }));
            else
                this.storage?.removeItem(this.scope);
        }
        catch { /* conserva la operación en memoria */ }
    }
    async enviar(action: string, identidad: unknown, ejecutar: (key: string) => Promise<unknown>) {
        if (this.busy)
            throw new FalloCB2("Ya hay una operación en curso.", true);
        this.busy = true;
        try {
            const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(identidad)));
            const fingerprint = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
            if (this.pending && (this.pending.action !== action || this.pending.fingerprint !== fingerprint))
                throw new FalloCB2("Hay un intento pendiente. Reproduce exactamente esa solicitud; no cambies sus decisiones.");
            this.pending ??= { action, fingerprint, key: crypto.randomUUID().replaceAll("-", ""), identidad: JSON.parse(JSON.stringify(identidad)), definitivo: false };
            this.pending.ejecutar = ejecutar;
            this.guardar();
            const pendiente = this.pending;
            try {
                const r = resultadoCB2(await ejecutar(pendiente.key), action, identidad);
                this.pending = null;
                this.guardar();
                return r;
            }
            catch (e) {
                pendiente.definitivo = e instanceof FalloCB2 && e.definitivo;
                throw e;
            }
        }
        finally {
            this.busy = false;
        }
    }
    async reintentar() {
        if (!this.pending?.ejecutar)
            throw new FalloCB2("Reconstruye la solicitud pendiente con el mismo archivo y decisiones.");
        const p = this.pending;
        if (this.busy)
            throw new FalloCB2("Ya hay una operación en curso.");
        this.busy = true;
        try {
            const r = resultadoCB2(await p.ejecutar!(p.key), p.action, p.identidad);
            this.pending = null;
            this.guardar();
            return r;
        }
        catch (e) {
            p.definitivo = e instanceof FalloCB2 && e.definitivo;
            throw e;
        }
        finally {
            this.busy = false;
        }
    }
    editar() {
        if (this.pending && !this.pending.definitivo)
            throw new FalloCB2("El resultado es incierto; solo se permite reintentar la misma solicitud.");
        this.pending = null;
        this.guardar();
    }
}
