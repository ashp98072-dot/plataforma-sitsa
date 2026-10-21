"use client";

import { useEffect, useState } from "react";
import type { LineaBorrador } from "@/components/facturacion/factura-borrador-form";
import {
  FacturaLineasForm,
  type ContextoFacturaApi,
  type EdicionFact4,
} from "@/components/facturacion/factura-lineas-form";

/**
 * FACT-4 — punto de entrada ÚNICO del formulario de Borrador. Consulta el contexto (entidades, bancos, retención del
 * cliente) y muestra «Preparar líneas de factura».
 *
 * SIN FALLBACK SILENCIOSO: si la migración FACT-4 no está aplicada (`fact4Disponible: false`) o el contexto no se pudo leer,
 * NO se ofrece ningún formulario para crear/editar: se explica el bloqueo. El formulario anterior (un viaje = una línea)
 * perdería líneas agrupadas, condición de pago, entidad, banco, clasificación y retención, y el servidor tampoco lo acepta
 * (503). Las pantallas de LECTURA (listado y detalle) sí siguen funcionando sin la migración.
 */

export type DetalleParaEditar = {
  viajes: { planId: number; codigo: string; fechaPlan: string; montoAsignado: number; precioIncluyeIva: boolean | null; origen: string | null; destino: string | null }[];
  lineas: {
    cantidad: number;
    descripcion: string;
    precioUnitario: number;
    clasificacion: "SERVICIO" | "BIEN" | null;
    precioIncluyeIva: boolean | null;
    viajes: { planId: number | null; codigo: string }[];
  }[];
  contabilidad: {
    modeloLineas: boolean;
    entidadId: number | null;
    condicionPago: "CREDITO" | "CONTADO" | null;
    cuentaBancaria: { cuentaBancariaId: number } | null;
    retencionIva: { aplicadaPct: number };
  };
  moneda: string;
};

type Props = {
  slug: string;
  clienteId: number;
  clienteNombre: string;
  facturaId?: number;
  /** Crear: viajes seleccionados. Editar: se ignora a favor de `detalle`. */
  lineasIniciales: LineaBorrador[];
  /** Editar: detalle actual del borrador. */
  detalle?: DetalleParaEditar;
  numeroFacturaInicial?: string | null;
  fechaEmisionInicial?: string | null;
  observacionesInicial?: string | null;
  onGuardado: (facturaId: number) => void;
  onCancelar: () => void;
};

/** Bloqueo explícito (sin formulario): falta la migración FACT-4 o no se pudo leer el contexto. No hay nada que guardar. */
export function BloqueoFact4({ errorContexto, onReintentar, onCancelar }: { errorContexto: boolean; onReintentar: () => void; onCancelar: () => void }) {
  return (
    <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm" role="alert">
      <p className="text-rose-500">
        {errorContexto
          ? "No se pudo cargar la información necesaria para preparar la factura. No se guardó nada."
          : "No se puede crear ni editar facturas todavía: falta aplicar la migración FACT-4 (líneas, condición de pago y retención) en la base de datos. No se guardó nada."}
      </p>
      <div className="flex gap-2">
        {errorContexto ? (
          <button type="button" className="rounded-lg border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)]" onClick={onReintentar}>
            Reintentar
          </button>
        ) : null}
        <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)]" onClick={onCancelar}>
          Volver
        </button>
      </div>
    </div>
  );
}

export function FacturaFormulario(props: Props) {
  const { slug, clienteId, detalle } = props;
  const [contexto, setContexto] = useState<ContextoFacturaApi | null>(null);
  const [errorContexto, setErrorContexto] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/facturacion/facturas/contexto?clienteId=${clienteId}`);
        const data = await res.json().catch(() => null);
        if (!vigente) return;
        if (res.ok && data) setContexto(data as ContextoFacturaApi);
        else setErrorContexto(true);
      } catch {
        if (vigente) setErrorContexto(true);
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => { vigente = false; };
  }, [slug, clienteId, intento]);

  if (cargando) {
    return <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-xs text-[var(--muted)]">Cargando…</p>;
  }

  if (contexto?.fact4Disponible !== true) {
    return (
      <BloqueoFact4
        errorContexto={errorContexto}
        onReintentar={() => { setErrorContexto(false); setCargando(true); setIntento((n) => n + 1); }}
        onCancelar={props.onCancelar}
      />
    );
  }

  let viajes = props.lineasIniciales;
  let edicion: EdicionFact4 | undefined;
  if (detalle) {
    viajes = detalle.viajes.map((v): LineaBorrador => ({
      planId: v.planId, codigo: v.codigo, fechaPlan: v.fechaPlan, placa: null, tarifaComercial: null,
      montoAsignado: v.montoAsignado, precioIncluyeIva: v.precioIncluyeIva ?? true, moneda: detalle.moneda,
      origen: v.origen, destino: v.destino,
    }));
    edicion = {
      lineas: detalle.lineas.map((l) => ({
        planIds: l.viajes.map((v) => v.planId).filter((id): id is number => id != null),
        cantidad: l.cantidad,
        descripcion: l.descripcion,
        precioUnitario: l.precioUnitario,
        clasificacion: l.clasificacion ?? "SERVICIO",
        precioIncluyeIva: l.precioIncluyeIva ?? true,
      })),
      entidadId: detalle.contabilidad.entidadId,
      condicionPago: detalle.contabilidad.condicionPago ?? "CREDITO",
      cuentaBancariaId: detalle.contabilidad.cuentaBancaria?.cuentaBancariaId ?? null,
      retencionIvaPct: detalle.contabilidad.retencionIva.aplicadaPct,
    };
  }

  return (
    <FacturaLineasForm
      slug={slug}
      clienteId={clienteId}
      clienteNombre={props.clienteNombre}
      facturaId={props.facturaId}
      viajesIniciales={viajes}
      contexto={contexto as ContextoFacturaApi}
      edicion={edicion}
      numeroFacturaInicial={props.numeroFacturaInicial}
      fechaEmisionInicial={props.fechaEmisionInicial}
      observacionesInicial={props.observacionesInicial}
      onGuardado={props.onGuardado}
      onCancelar={props.onCancelar}
    />
  );
}
