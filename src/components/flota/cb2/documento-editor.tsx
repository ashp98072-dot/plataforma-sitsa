"use client";
import { useEffect, useRef, useState } from "react";
import type { ResultadoDocumento } from "@/lib/flota/cb2/documentos-model";
import { DecimalDocumental } from "@/lib/flota/cb2/conciliacion-documental-model";
import { jsonCB2 } from "./client";
import { input, button } from "./controles";
type Lectura = { habilitado: boolean; actorId: number; documento: Omit<ResultadoDocumento, "tipo">; permisos: { completar: boolean; corregir: boolean } };
type Pendiente = { clave: string; proveedorId: number; revision: number; fecha?: string; total?: string; motivo: string };
export function DocumentoEditorCB2({ api, proveedorId, onGuardado }: { api: string; proveedorId: number; onGuardado: () => void }) {
    const [lectura, setLectura] = useState<Lectura | null>(null), [fecha, setFecha] = useState(""), [total, setTotal] = useState(""), [motivo, setMotivo] = useState("");
    const [confirmacion, setConfirmacion] = useState(false), [pendiente, setPendiente] = useState<Pendiente | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [mensaje, setMensaje] = useState(""), [refresh, setRefresh] = useState(0);
    const enCurso = useRef(false);
    const scope = lectura?.actorId ? `cb2:documento:${lectura.actorId}:${api}:${proveedorId}` : null;
    useEffect(() => {
        const ac = new AbortController();
        jsonCB2<Lectura>(`${api}?proveedorId=${proveedorId}`, { signal: ac.signal }).then(d => {
            if (ac.signal.aborted) return;
            setLectura(d);
            if (d.habilitado) {
                setFecha(d.documento.valores.fecha ?? ""); setTotal(d.documento.valores.total ?? "");
                try { const p = sessionStorage.getItem(`cb2:documento:${d.actorId}:${api}:${proveedorId}`); if (p) setPendiente(JSON.parse(p)); } catch { /* almacenamiento privado no disponible */ }
            }
        }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
        return () => ac.abort();
    }, [api, proveedorId, refresh]);
    function conservar(p: Pendiente | null) {
        setPendiente(p);
        try { if (scope) { if (p) sessionStorage.setItem(scope, JSON.stringify(p)); else sessionStorage.removeItem(scope); } } catch { /* el reintento sigue disponible en memoria */ }
    }
    async function guardar() {
        if (!lectura?.habilitado || enCurso.current || (!pendiente && !confirmacion)) return;
        enCurso.current = true; setBusy(true); setError(""); setMensaje("");
        try {
            const p = pendiente ?? { proveedorId, revision: lectura.documento.revision, clave: crypto.randomUUID().replaceAll("-", ""), motivo: motivo.trim(),
                ...(fecha && fecha !== lectura.documento.valores.fecha ? { fecha } : {}),
                ...(total && (lectura.documento.valores.total === null || !new DecimalDocumental(total).eq(lectura.documento.valores.total)) ? { total } : {}) };
            conservar(p);
            const res = await fetch(api, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
            let d: (ResultadoDocumento & { error?: string; incierto?: boolean });
            try { d = await res.json(); } catch { throw new Error("Respuesta incierta. Reintenta exactamente la solicitud conservada."); }
            if (!res.ok) {
                // Solo errores definitivos de validación/autorización/conflicto permiten editar.
                if ([400, 401, 403, 404, 409].includes(res.status) && !d.incierto) conservar(null);
                throw new Error(d.error ?? "No se pudo certificar el resultado documental.");
            }
            if (!Number.isInteger(d.revision) || d.facturaId !== lectura.documento.facturaId || !d.valores || d.moneda !== lectura.documento.moneda
                || !["COMPLETAR", "CORREGIR", "SIN_CAMBIO"].includes(d.tipo)
                || d.revision !== p.revision + (d.tipo === "SIN_CAMBIO" ? 0 : 1)
                || (p.fecha !== undefined && d.valores.fecha !== p.fecha)
                || (p.total !== undefined && (typeof d.valores.total !== "string" || !new DecimalDocumental(d.valores.total).eq(p.total))))
                throw new Error("Respuesta incierta; conserva la solicitud para reintentar.");
            conservar(null); setConfirmacion(false); setMotivo(""); setMensaje(`Documento guardado. Revisión ${d.revision}.`); setRefresh(n => n + 1); onGuardado();
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
        finally { enCurso.current = false; setBusy(false); }
    }
    if (lectura && !lectura.habilitado) return null;
    if (!lectura) return <div>{error ? <p role="alert">{error}</p> : <p role="status">Consultando documento…</p>}</div>;
    if (!lectura.permisos.completar) return <p>Documento de solo lectura. No tienes permiso de edición documental.</p>;
    const anterior = lectura.documento.valores;
    const cambiaFecha = !!fecha && fecha !== anterior.fecha;
    let cambiaTotal = false;
    try { cambiaTotal = !!total && (anterior.total === null || !new DecimalDocumental(total).eq(anterior.total)); } catch { /* validación del formulario */ }
    const correccion = (cambiaFecha && anterior.fecha !== null) || (cambiaTotal && anterior.total !== null);
    return <section className="space-y-3 rounded-xl border border-[var(--border)] p-4" aria-label="Editar documento de factura">
        <h3>Fecha y total documental · {lectura.documento.moneda}</h3>
        <p>Revisión {lectura.documento.revision}. Fecha anterior: {anterior.fecha ?? "Sin declarar"}. Total anterior: {anterior.total ?? "Sin declarar"}. La moneda y los consumos asociados se conservan.</p>
        <p>{correccion ? "Corrección de valores declarados: exige permiso adicional." : "Completar campos sin declarar."} El servidor verifica esta clasificación al guardar.</p>
        <fieldset disabled={busy || pendiente !== null} className="grid gap-3 md:grid-cols-2">
            <label>Fecha documental<input className={input} type="date" value={fecha} disabled={anterior.fecha !== null && !lectura.permisos.corregir} onChange={e => { setFecha(e.target.value); setConfirmacion(false); }}/></label>
            <label>Total documental<input className={input} inputMode="decimal" maxLength={19} value={total} disabled={anterior.total !== null && !lectura.permisos.corregir} onChange={e => { setTotal(e.target.value); setConfirmacion(false); }}/></label>
            <label>Motivo obligatorio<textarea className={input} minLength={10} maxLength={1000} value={motivo} onChange={e => { setMotivo(e.target.value); setConfirmacion(false); }}/></label>
            <label><input type="checkbox" checked={confirmacion} onChange={e => setConfirmacion(e.target.checked)}/>Confirmo fecha {fecha || anterior.fecha || "sin declarar"} y total {total || anterior.total || "sin declarar"} {lectura.documento.moneda}, con el motivo indicado.</label>
        </fieldset>
        {pendiente ? <p>Solicitud pendiente conservada. Usa «Reintentar misma solicitud» para recuperar el resultado sin duplicar el cambio. Los datos permanecerán bloqueados hasta confirmar la respuesta.</p> : <p>Dejar un campo vacío conserva su valor; esta fase no permite borrar datos declarados.</p>}
        <button className={button} disabled={busy || (!pendiente && (!confirmacion || motivo.trim().length < 10 || (!cambiaFecha && !cambiaTotal) || (correccion && !lectura.permisos.corregir)))} onClick={() => void guardar()}>{busy ? "Guardando…" : pendiente ? "Reintentar misma solicitud" : "Guardar documento confirmado"}</button>
        <button className={button} disabled={busy || !!pendiente} onClick={() => { setError(""); setConfirmacion(false); setRefresh(n => n + 1); }}>Actualizar revisión</button>
        {error && <p role="alert">{error}</p>}{mensaje && <p role="status">{mensaje}</p>}
    </section>;
}
