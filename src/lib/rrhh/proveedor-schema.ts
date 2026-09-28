import { z } from "zod";

/**
 * RRHH-REQUERIMIENTOS-PROVEEDORES-1 — proveedores propios de RRHH (tabla `rrhh_proveedores`, independiente de
 * `compras_proveedores`). Mismo patrón de schema que src/lib/compras/proveedor-schema.ts, campos mínimos del ticket.
 */
const texto = (max: number) => z.string().trim().max(max).transform(v => v || null).nullable();
const correo = texto(200).refine(v => v === null || z.email().safeParse(v).success, "Correo no válido.");
export const proveedorRrhhSchema = z.object({
  nombre_comercial: z.string().trim().min(1, "El nombre comercial es obligatorio.").max(200),
  razon_social: texto(250),
  nit: texto(30),
  contacto_nombre: texto(200),
  telefono: texto(50),
  email: correo,
  direccion: texto(500),
  metodo_pago_habitual: texto(80),
  banco: texto(150),
  numero_cuenta: texto(100),
  tipo_cuenta: texto(80),
  dias_credito: z.number().int().min(0).max(2147483647).nullable(),
  observaciones: texto(10000),
  activo: z.boolean(),
}).strict();
export const crearProveedorRrhhSchema = proveedorRrhhSchema.partial().required({ nombre_comercial: true });
export const editarProveedorRrhhSchema = proveedorRrhhSchema.partial().refine(v => Object.keys(v).length > 0, "Indique los campos a editar.");
export type ProveedorRrhhDatos = z.infer<typeof proveedorRrhhSchema>;
export type ProveedorRrhh = ProveedorRrhhDatos & { id: number; empresa_id: number };
export const camposProveedorRrhh = Object.keys(proveedorRrhhSchema.shape) as (keyof ProveedorRrhhDatos)[];
