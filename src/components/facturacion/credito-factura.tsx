'use client';
import { useEffect, useRef, useState } from 'react';

type Props = { slug: string; factura: number; cliente: number; entidad: number | null; fecha: string; borrador: boolean; onToken: (t: string | undefined) => void };
export function CreditoFactura({ slug, factura, cliente, entidad, fecha, borrador, onToken }: Props) {
  const [mensaje, setMensaje] = useState(''), [error, setError] = useState('');
  const [perfil, setPerfil] = useState<{ dias: number; aprobada: number; revision: number } | null>(null);
  const [administrar, setAdministrar] = useState<string | null>(null), [dias, setDias] = useState('30'), [motivo, setMotivo] = useState('');
  const solicitud = useRef(0);
  const [aprobada, setAprobada] = useState(false), [ocupado, setOcupado] = useState(false);
  const base = `/api/empresas/${slug}/facturacion`;
  const urlPerfil = `${base}/clientes/${cliente}/credito?entidad=${entidad}`;
  useEffect(() => {
    let vigente = true;
    const invalidar = () => { solicitud.current++; };
    invalidar();
    onToken(undefined);
    void fetch(`${base}/facturas/${factura}/vencimiento`, { cache: 'no-store' }).then(async r => {
      const b = await r.json(); if (!vigente) return;
      setMensaje(r.ok ? b.vencimiento ? `Vence ${b.vencimiento.vencimiento} · ${b.vencimiento.dias} días calendario · ${b.vencimiento.fuente} revisión ${b.vencimiento.revision}` : 'Sin vencimiento congelado determinado.' : b.error);
    }).catch(() => { if (vigente) setError('No se pudo consultar el vencimiento.'); });
    return () => { vigente = false; invalidar(); };
  }, [base, factura, cliente, entidad, fecha, borrador, onToken]);
  useEffect(() => {
    let vigente = true;
    if (entidad !== null) void fetch(urlPerfil, { cache: 'no-store' }).then(async r => {
      const b = await r.json(); if (!vigente) return;
      setAdministrar(r.ok ? urlPerfil : null); setPerfil(b.perfil ?? null);
      if (!r.ok && r.status !== 403) setError(b.error ?? 'No se pudo consultar el perfil.');
      if (b.perfil) { setDias(String(b.perfil.dias)); setAprobada(Number(b.perfil.aprobada) === 1); }
    }).catch(() => { if (vigente) setAdministrar(null); });
    return () => { vigente = false; };
  }, [urlPerfil, entidad]);
  async function preview() {
    const actual = ++solicitud.current;
    setOcupado(true); setError(''); onToken(undefined);
    try {
      const r = await fetch(`${base}/facturas/${factura}/vencimiento`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fechaEmision: fecha }) });
      const b = await r.json(); if (actual !== solicitud.current) return; if (!r.ok) throw Error(b.error);
      setMensaje(b.certificado ? `Confirma: vence ${b.snapshot.vencimiento}; ${b.snapshot.dias} días calendario desde ${b.snapshot.fechaBase}.` : b.motivo);
      onToken(b.token);
    } catch (e) { if (actual === solicitud.current) setError(e instanceof Error ? e.message : 'No se pudo previsualizar.'); }
    finally { setOcupado(false); }
  }
  async function guardar() {
    const actual = ++solicitud.current;
    setOcupado(true); setError(''); onToken(undefined);
    try {
      const r = await fetch(urlPerfil, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dias: Number(dias), aprobada, revision: perfil?.revision ?? 0, motivo }) });
      const b = await r.json(); if (actual !== solicitud.current) return; if (!r.ok) throw Error(b.error);
      setPerfil({ dias: Number(dias), aprobada: aprobada ? 1 : 0, revision: b.perfil.revision });
      setMensaje('Perfil guardado. Revisa y confirma el vencimiento antes de emitir.'); setMotivo('');
    } catch (e) { if (actual === solicitud.current) setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { setOcupado(false); }
  }
  return <section aria-label="Crédito y vencimiento" className="space-y-2 rounded border p-3">
    <h4>Crédito y vencimiento</h4><p>{mensaje}</p>
    {borrador && <button type="button" disabled={ocupado || !fecha} onClick={() => void preview()}>Revisar vencimiento para emisión</button>}
    {administrar === urlPerfil && entidad !== null && <details><summary>Administrar crédito de este cliente y libro</summary>
      <label>Días calendario (0–365)<input type="number" min="0" max="365" value={dias} onChange={e => setDias(e.target.value)} /></label>
      <label><input type="checkbox" checked={aprobada} onChange={e => setAprobada(e.target.checked)} />Plazo aprobado</label>
      <label>Motivo de configuración<input value={motivo} maxLength={500} onChange={e => setMotivo(e.target.value)} /></label>
      <button type="button" disabled={ocupado || dias === '' || motivo.trim().length < 10} onClick={() => void guardar()}>Guardar perfil</button>
      <p>Solo afecta futuras emisiones. No interpreta la condición histórica ni cambia facturas emitidas.</p>
    </details>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
