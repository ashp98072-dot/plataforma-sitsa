export type FilaCB2 = {
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
export function gruposOrigen(rows: Registro[]): FilaCB2[] {
    const ultimos = new Map<number, Registro>();
    const originales = rows.filter(r => r.tipo === "ORIGEN");
    for (const r of [...rows].sort((a, b) => Number(a.revision) - Number(b.revision) || a.id - b.id))
        if (r.tipo !== "ASOCIACION_FACTURA")
            ultimos.set(Number(r.origen_fila_id ?? r.id), r);
    return originales.map(o => { const f = leerObjeto(o.datos_origen), d = leerObjeto(o.decision), actual = ultimos.get(o.id); return { hoja: String(o.hoja_nombre), fila: Number(o.fila_excel), candidato: typeof d.candidato === "string" ? d.candidato : null, bloqueada: actual?.consumo_id != null, documento: null, errores: [], estado: actual?.consumo_id != null ? "RESUELTA" : String(actual?.resultado ?? o.resultado), motivos: [String(actual?.motivo ?? o.motivo)], vale: String(f.vale ?? ""), placa: String(f.placaOriginal ?? ""), placaNormalizada: String(f.placaNormalizada ?? ""), fecha: typeof f.fechaConsumo === "string" ? f.fechaConsumo : null, galones: typeof f.galones === "string" ? f.galones : null, precio: typeof f.precio === "string" ? f.precio : null, monto: typeof f.monto === "string" ? f.monto : null, moneda: String(d.moneda ?? "") }; });
}
export function resultadoCB2(value: unknown) {
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
                const r = resultadoCB2(await ejecutar(pendiente.key));
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
            const r = resultadoCB2(await p.ejecutar!(p.key));
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
