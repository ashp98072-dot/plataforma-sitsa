import type { IntegranteCuadrilla } from "./cuadrilla-contrato";

/** Presentación compartida sin cargar los esquemas de validación en el cliente. */
export function textoCuadrilla(filas: IntegranteCuadrilla[]): string {
  return filas.map((f) => `${f.nombre} (${f.tipo === "INTERNO" ? "interno" : "externo"})`).join("\n");
}
