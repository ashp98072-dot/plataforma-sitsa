import { z } from "zod";

// Contratos de laboratorio. D1–D5 no están aprobadas para operación.
const id = z.number().int().positive();
const texto = z.string().trim().min(1).max(160).refine(v => !/[\u0000-\u001f\u007f]/.test(v), "Texto con caracteres de control");
export const conductorSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("EMPLEADO"), empleadoId: id, metodo: z.literal("MANUAL"), motivo: texto }).strict(),
  z.object({ tipo: z.literal("EXTERNO"), externoId: id }).strict(),
  z.object({ tipo: z.literal("NO_IDENTIFICADO"), motivo: z.enum(["SIN_DATO", "AMBIGUO", "PENDIENTE_EVIDENCIA"]), observacion: texto, responsable: texto }).strict(),
]);
export const vehiculoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("CATALOGO"), vehiculoId: id }).strict(),
  z.object({ tipo: z.literal("EXTERNO"), externoId: id }).strict(),
]);
export type Conductor = z.infer<typeof conductorSchema>;
export type Vehiculo = z.infer<typeof vehiculoSchema>;
export type Estado = "PENDIENTE" | "VERIFICADO" | "INACTIVO";
export type Externo = {
  id: number; empresa: string; nombre: string; estado: Estado;
  evidencia: string; capturadoPor: string; verificadoPor: string;
};
export type Catalogo = {
  empleados: { id: number; empresa: string; nombre: string; activo: boolean }[];
  conductores: (Externo & { relacion: "CONTRATISTA" | "INDEPENDIENTE" | "OTRO_ACREDITADO"; referenciaRelacion: string })[];
  unidades: { id: number; empresa: string; placa: string; activo: boolean; compartidoCon: string[] }[];
  vehiculos: (Externo & { jurisdiccion: string; tenedor: string })[];
};
export type Codigo = "CAMPOS_INVALIDOS" | "EMPLEADO_NO_DISPONIBLE" | "VEHICULO_NO_DISPONIBLE" | "CONDUCTOR_AMBIGUO" | "PLACA_AMBIGUA" | "EXTERNO_NO_VALIDADO" | "CONDUCTOR_NO_IDENTIFICADO";
export type Diagnostico = { codigo: Codigo; campo: "conductor" | "vehiculo"; severidad: "BLOQUEO" | "REVISION"; mensaje: string };
export type Revision = { estado: "BLOQUEADO" | "SIMULACION_VALIDA"; diagnosticos: Diagnostico[]; confirmacionHabilitada: false };
export const normalizar = (v: string) => v.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase();
const placa = (v: string) => normalizar(v).replace(/[\s‐‑–—-]/g, "");
export function disponibles(cat: Catalogo, empresa: string): Catalogo {
  return { empleados: cat.empleados.filter(e => e.empresa === empresa), conductores: cat.conductores.filter(e => e.empresa === empresa),
    unidades: cat.unidades.filter(v => v.empresa === empresa || v.compartidoCon.includes(empresa)), vehiculos: cat.vehiculos.filter(v => v.empresa === empresa) };
}
export function diagnosticarBusqueda(cat: Catalogo, empresa: string, campo: "conductor" | "vehiculo", consulta: string): Diagnostico[] {
  const c = disponibles(cat, empresa);
  const encontrados = campo === "conductor" ? c.empleados.filter(e => e.activo && normalizar(e.nombre) === normalizar(consulta)) : c.unidades.filter(v => v.activo && placa(v.placa) === placa(consulta));
  if (encontrados.length === 1) return [];
  const ambiguo = encontrados.length > 1;
  return [{ campo, codigo: campo === "conductor" ? (ambiguo ? "CONDUCTOR_AMBIGUO" : "EMPLEADO_NO_DISPONIBLE") : (ambiguo ? "PLACA_AMBIGUA" : "VEHICULO_NO_DISPONIBLE"), severidad: ambiguo ? "REVISION" : "BLOQUEO",
    mensaje: campo === "conductor" ? (ambiguo ? "Hay varias personas candidatas. Revise su identidad." : "No se encontró un empleado activo autorizado. Revise el nombre o seleccione un externo validado.") : (ambiguo ? "La placa tiene varios candidatos autorizados. Revise la unidad." : "No se encontró una unidad activa autorizada. Revise la placa o seleccione un externo validado.") }];
}
function externoValido(e: Externo | undefined) {
  return !!e && e.estado === "VERIFICADO" && [e.nombre, e.evidencia, e.capturadoPor, e.verificadoPor].every(v => texto.safeParse(v).success) && e.capturadoPor.trim() !== e.verificadoPor.trim();
}
export function revisar(empresa: string, conductor: unknown, vehiculo: unknown, catalogo: Catalogo): Revision {
  const c = conductorSchema.safeParse(conductor), v = vehiculoSchema.safeParse(vehiculo), cat = disponibles(catalogo, empresa);
  const diagnosticos: Diagnostico[] = [];
  const agregar = (campo: Diagnostico["campo"], codigo: Codigo, mensaje: string) => diagnosticos.push({ campo, codigo, severidad: "BLOQUEO", mensaje });
  if (!empresa.trim()) agregar("conductor", "CAMPOS_INVALIDOS", "Seleccione una empresa sintética.");
  if (!c.success) agregar("conductor", "CAMPOS_INVALIDOS", "Complete los campos de una sola variante de conductor.");
  else if (c.data.tipo === "NO_IDENTIFICADO") agregar("conductor", "CONDUCTOR_NO_IDENTIFICADO", "Identidad pendiente. D1 propone conservar evidencia sin crear consumo.");
  else if (c.data.tipo === "EMPLEADO") { const selected = c.data.empleadoId; if (!cat.empleados.some(e => e.id === selected && e.activo)) agregar("conductor", "EMPLEADO_NO_DISPONIBLE", "Empleado no disponible en esta empresa."); }
  else { const selected = c.data.externoId, e = cat.conductores.find(e => e.id === selected); if (!externoValido(e) || !z.enum(["CONTRATISTA", "INDEPENDIENTE", "OTRO_ACREDITADO"]).safeParse(e?.relacion).success || !texto.safeParse(e?.referenciaRelacion).success) agregar("conductor", "EXTERNO_NO_VALIDADO", "El conductor externo requiere relación acreditada y validación independiente vigente."); }
  if (!v.success) agregar("vehiculo", "CAMPOS_INVALIDOS", "Complete los campos de una sola variante de vehículo.");
  else if (v.data.tipo === "CATALOGO") { const selected = v.data.vehiculoId; if (!cat.unidades.some(e => e.id === selected && e.activo)) agregar("vehiculo", "VEHICULO_NO_DISPONIBLE", "Unidad no disponible en esta empresa."); }
  else { const selected = v.data.externoId, e = cat.vehiculos.find(e => e.id === selected); if (!externoValido(e) || !texto.safeParse(e?.jurisdiccion).success || !texto.safeParse(e?.tenedor).success) agregar("vehiculo", "EXTERNO_NO_VALIDADO", "El vehículo externo requiere evidencia, jurisdicción, tenedor y revisión independiente."); }
  return { estado: diagnosticos.length ? "BLOQUEADO" : "SIMULACION_VALIDA", diagnosticos, confirmacionHabilitada: false };
}
