"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { mensajeFacturaExistente, MSG_FACTURA_DUPLICADA_INTERNA } from "@/lib/compras/factura-compra";
import {
  claveConsultaFactura, consultarFactura, DEBOUNCE_FACTURA_MS, debeConsultarFactura, estadoDeConsulta, urlVerRequerimiento,
  type LineaFacturaForm, type VerificacionFactura,
} from "@/lib/compras/factura-duplicada-ui";

/**
 * Estado de la factura de UNA línea del formulario de requerimiento: duplicado interno (marcado por el formulario) y verificación
 * contra la BD con debounce (~400 ms; solo con proveedor y número). Solo UX: el servidor revalida al guardar. Componente propio
 * para no alterar los hooks del formulario principal. Avisa al formulario si la factura ya existe (para deshabilitar Guardar).
 */
export function FacturaEstadoLinea({ slug, linea, claveLinea, interna, onDuplicada }: {
  slug: string; linea: LineaFacturaForm; claveLinea: string; interna: boolean; onDuplicada: (claveLinea: string, duplicada: boolean) => void;
}) {
  const [verificacion, setVerificacion] = useState<VerificacionFactura | null>(null);
  const vigente = useRef("");
  // el callback cambia de identidad en cada render del formulario: se guarda en una ref para no re-disparar la consulta
  const avisar = useRef(onDuplicada);
  useEffect(() => { avisar.current = onDuplicada; }); // se actualiza tras cada render, antes de los demás efectos
  const clave = debeConsultarFactura(linea) ? claveConsultaFactura(linea) : "";
  const proveedorId = linea.proveedor_id;
  const serie = linea.serie_factura;
  const numero = linea.numero_factura;
  const lineaId = linea.id;

  useEffect(() => {
    vigente.current = clave;
    if (!clave) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVerificacion(null); avisar.current(claveLinea, false);
      return;
    }
    setVerificacion({ clave, estado: "validando" });
    const timer = window.setTimeout(async () => {
      const r = await consultarFactura((u, i) => fetch(u, i), slug, { id: lineaId, proveedor_id: proveedorId, serie_factura: serie, numero_factura: numero });
      if (vigente.current !== clave) return; // resultado viejo: la línea cambió mientras tanto
      const estado = estadoDeConsulta(r);
      setVerificacion({ clave, estado, factura: r.tipo === "ok" ? r.factura : undefined });
      avisar.current(claveLinea, estado === "duplicada");
    }, DEBOUNCE_FACTURA_MS);
    return () => window.clearTimeout(timer);
  }, [clave, slug, proveedorId, serie, numero, lineaId, claveLinea]);
  useEffect(() => () => avisar.current(claveLinea, false), [claveLinea]);

  const v = verificacion;
  if (!interna && !v) return null;
  return (
    <div className="text-sm md:col-span-2 xl:col-span-3" data-factura-estado={interna ? "duplicada_interna" : v?.estado}>
      {interna ? <p role="alert" className="text-red-300">{MSG_FACTURA_DUPLICADA_INTERNA}</p> : null}
      {v?.estado === "validando" ? <p className="text-[var(--muted)]">Validando factura…</p> : null}
      {v?.estado === "disponible" && !interna ? <p className="text-emerald-300">✓ Factura disponible</p> : null}
      {v?.estado === "duplicada" && v.factura ? (
        <p role="alert" className="text-amber-300">⚠ {mensajeFacturaExistente(v.factura)}{" "}
          <Link className="underline" href={urlVerRequerimiento(slug, v.factura.requerimientoId)}>Ver requerimiento</Link></p>
      ) : null}
      {v?.estado === "error" ? <p className="text-[var(--muted)]">No se pudo validar la factura ahora; se revisará al guardar.</p> : null}
    </div>
  );
}
