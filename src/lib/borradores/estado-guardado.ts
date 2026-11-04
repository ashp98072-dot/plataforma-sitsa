import type { MotivoFallo } from "./almacen";

/**
 * Máquina de estados de guardado LOCAL, independiente del formulario y de React (reductor puro). Todavía no hay estados de
 * sincronización con servidor (otra fase). El hook `useBorrador` (BORR-1c) la consumirá.
 *
 *   inicial ──cambio──▶ pendiente ──inicio──▶ guardando ──ok──▶ guardado
 *                           ▲                    │ │                │
 *                           └──── cambio ◀───────┘ └─fallo─▶ error_almacenamiento
 *   (un cambio DURANTE «guardando» no se pierde: al confirmarse el guardado se vuelve a «pendiente»)
 *   incompatible: terminal hasta `descartar`; ningún cambio vuelve a escribir sobre un borrador de versión futura.
 */
export type NombreEstadoGuardado = "inicial" | "pendiente" | "guardando" | "guardado" | "error_almacenamiento" | "incompatible";

export type EstadoGuardado = {
  estado: NombreEstadoGuardado;
  /** Solo en «guardando»: hubo cambios mientras se escribía. */
  cambiosPosteriores: boolean;
  /** Revisión confirmada en el almacén (en «guardado», y conservada mientras haya cambios nuevos). */
  revision: number | null;
  /** Solo en «error_almacenamiento»: causa del último fallo. */
  motivoError: MotivoFallo | null;
};

export type EventoGuardado =
  | { tipo: "cambio" }
  | { tipo: "inicio_guardado" }
  | { tipo: "guardado_ok"; revision: number }
  | { tipo: "guardado_fallo"; motivo: MotivoFallo }
  | { tipo: "borrador_incompatible" }
  /** Borrador recuperado y vigente, o descarte explícito del anterior: vuelve al estado limpio. */
  | { tipo: "reiniciar"; revision?: number | null };

export const ESTADO_GUARDADO_INICIAL: EstadoGuardado = { estado: "inicial", cambiosPosteriores: false, revision: null, motivoError: null };

export function reducirEstadoGuardado(s: EstadoGuardado, e: EventoGuardado): EstadoGuardado {
  if (e.tipo === "reiniciar") return { ...ESTADO_GUARDADO_INICIAL, revision: e.revision ?? null, estado: e.revision != null ? "guardado" : "inicial" };
  if (e.tipo === "borrador_incompatible") return { ...s, estado: "incompatible", cambiosPosteriores: false, motivoError: "version_incompatible" };
  // Incompatible es terminal: nada reabre la escritura salvo `reiniciar` (descartar/recuperar de nuevo).
  if (s.estado === "incompatible") return s;
  switch (e.tipo) {
    case "cambio":
      if (s.estado === "guardando") return { ...s, cambiosPosteriores: true };
      return { ...s, estado: "pendiente", motivoError: null };
    case "inicio_guardado":
      // Solo se puede empezar a guardar desde «pendiente» o tras un error (reintento).
      return s.estado === "pendiente" || s.estado === "error_almacenamiento" ? { ...s, estado: "guardando", cambiosPosteriores: false, motivoError: null } : s;
    case "guardado_ok":
      if (s.estado !== "guardando") return s;
      return { estado: s.cambiosPosteriores ? "pendiente" : "guardado", cambiosPosteriores: false, revision: e.revision, motivoError: null };
    case "guardado_fallo":
      if (s.estado !== "guardando") return s;
      if (e.motivo === "version_incompatible") return { ...s, estado: "incompatible", cambiosPosteriores: false, motivoError: e.motivo };
      return { ...s, estado: "error_almacenamiento", cambiosPosteriores: false, motivoError: e.motivo };
  }
}
