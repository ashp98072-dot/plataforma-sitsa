"use client";

import { useState } from "react";
import type { Plan } from "./programacion-client";

type Destinatario = {
  clave: string;
  rol: "Piloto" | "Auxiliar";
  nombre: string;
  telefono: string | null;
};

export function normalizarTelefonoGuatemala(telefono: string | null): string | null {
  if (!telefono?.trim()) return null;
  let digitos = telefono.replace(/\D/g, "");
  if (digitos.startsWith("00")) digitos = digitos.slice(2);
  if (digitos.length === 8) return `502${digitos}`;
  if (digitos.length === 11 && digitos.startsWith("502")) return digitos;
  return null;
}

function fechaGt(fecha: string): string {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-");
  return dia && mes && anio ? `${dia}/${mes}/${anio}` : fecha;
}

function regresoGt(regreso: string | null): string {
  if (!regreso) return "Pendiente";
  const [fecha, hora] = regreso.split("T");
  return `${fechaGt(fecha)}${hora ? ` ${hora.slice(0, 5)}` : ""}`;
}

function destinoDelPlan(plan: Plan): string {
  const paradas = [...(plan.paradas ?? [])].reverse();
  return paradas.find((p) => ["entrega", "descarga"].includes(p.tipo.toLowerCase()))?.lugar_nombre
    ?? paradas[0]?.lugar_nombre
    ?? "Pendiente";
}

function mensajeAsignacion(plan: Plan, nombre: string, urlPortal: string): string {
  const carga = plan.paradas?.find((p) => p.tipo.toLowerCase() === "carga")?.lugar_nombre
    ?? plan.paradas?.[0]?.lugar_nombre
    ?? "Pendiente";
  return [
    "GRUPO SITSA - ASIGNACIÓN DE VIAJE",
    "",
    `Hola, ${nombre}.`,
    "",
    "Se le ha asignado el siguiente viaje:",
    "",
    `Viaje: ${plan.codigo}`,
    `Fecha: ${fechaGt(plan.fecha_plan)}`,
    `Hora de carga: ${plan.hora_carga?.slice(0, 5) || "Pendiente"}`,
    `Cliente: ${plan.cliente || "Pendiente"}`,
    `Lugar de carga: ${carga}`,
    `Destino: ${destinoDelPlan(plan)}`,
    `Unidad: ${plan.placa || "Pendiente"}`,
    `Piloto: ${plan.piloto || "Pendiente"}`,
    `Auxiliares: ${plan.auxiliares.length ? plan.auxiliares.join(", ") : "Ninguno"}`,
    `Regreso estimado: ${regresoGt(plan.regreso_estimado)}`,
    "",
    "Consulte el viaje y registre las evidencias correspondientes desde su portal:",
    "",
    urlPortal,
    "",
    "Gracias.",
  ].join("\n");
}

export default function NotificarPersonal({ plan }: { plan: Plan }) {
  const [copiado, setCopiado] = useState("");
  const destinatarios: Destinatario[] = [
    ...(plan.piloto
      ? [{
          clave: `piloto-${plan.pilotoId ?? plan.piloto}`,
          rol: "Piloto" as const,
          nombre: plan.piloto,
          telefono: plan.pilotoTelefono,
        }]
      : []),
    ...plan.auxiliaresDetalle.map((aux) => ({
      clave: `auxiliar-${aux.personalId}`,
      rol: "Auxiliar" as const,
      nombre: aux.nombre,
      telefono: aux.telefono,
    })),
  ];

  function preparar(destinatario: Destinatario) {
    const urlPortal = `${window.location.origin}/portal/viajes?viaje=${plan.id}`;
    return mensajeAsignacion(plan, destinatario.nombre, urlPortal);
  }

  function abrirWhatsApp(destinatario: Destinatario) {
    const numero = normalizarTelefonoGuatemala(destinatario.telefono);
    if (!numero) return;
    const url = `https://wa.me/${numero}?text=${encodeURIComponent(preparar(destinatario))}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function copiarMensaje(destinatario: Destinatario) {
    await navigator.clipboard.writeText(preparar(destinatario));
    setCopiado(destinatario.clave);
    window.setTimeout(() => setCopiado((actual) => actual === destinatario.clave ? "" : actual), 2000);
  }

  return (
    <section className="md:col-span-3 rounded border border-[var(--border)] bg-black/10 p-3">
      <h3 className="text-sm font-semibold">Notificar personal</h3>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        WhatsApp abrirá con el mensaje preparado. El envío siempre lo confirma el usuario.
      </p>
      {!destinatarios.length ? (
        <p className="mt-3 text-xs text-amber-300">Este viaje todavía no tiene personal asignado.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {destinatarios.map((destinatario) => {
            const numero = normalizarTelefonoGuatemala(destinatario.telefono);
            return (
              <div key={destinatario.clave} className="rounded border border-[var(--border)] p-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{destinatario.rol}</p>
                <p className="text-sm font-medium">{destinatario.nombre}</p>
                {!destinatario.telefono ? (
                  <p className="mt-1 text-xs text-amber-300">Sin teléfono registrado.</p>
                ) : !numero ? (
                  <p className="mt-1 text-xs text-amber-300">El teléfono registrado no tiene un formato compatible.</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!numero}
                    onClick={() => abrirWhatsApp(destinatario)}
                    className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Enviar por WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => void copiarMensaje(destinatario)}
                    className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
                  >
                    {copiado === destinatario.clave ? "Mensaje copiado" : "Copiar mensaje"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
