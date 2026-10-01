import { z } from "zod";

export const integranteCuadrillaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("INTERNO"), empleadoId: z.number().int().positive() }).strict(),
  z.object({
    tipo: z.literal("EXTERNO"), nombre: z.string().trim().min(1).max(200),
    identificacion: z.string().trim().max(100).optional(), telefono: z.string().trim().max(50).optional(),
  }).strict(),
]);
// Límite técnico del payload, independiente del límite de auxiliares.
export const cuadrillaSchema = z.array(integranteCuadrillaSchema).max(200).superRefine((filas, ctx) => {
  const ids = new Set<number>();
  filas.forEach((f, i) => {
    if (f.tipo !== "INTERNO") return;
    if (ids.has(f.empleadoId)) ctx.addIssue({ code: "custom", path: [i, "empleadoId"], message: "El empleado está repetido en la cuadrilla." });
    ids.add(f.empleadoId);
  });
});
export type CuadrillaInput = z.infer<typeof integranteCuadrillaSchema>;
export type IntegranteCuadrilla = {
  tipo: "INTERNO" | "EXTERNO"; empleadoId: number | null; nombre: string;
  identificacion: string | null; telefono: string | null;
};
export function cuadrillaPayload(filas: IntegranteCuadrilla[]): CuadrillaInput[] {
  return filas.map((f) => f.tipo === "INTERNO"
    ? { tipo: "INTERNO", empleadoId: f.empleadoId! }
    : { tipo: "EXTERNO", nombre: f.nombre, identificacion: f.identificacion ?? "", telefono: f.telefono ?? "" });
}
export function textoCuadrilla(filas: IntegranteCuadrilla[]): string {
  return filas.map((f) => `${f.nombre} (${f.tipo === "INTERNO" ? "interno" : "externo"})`).join("\n");
}
