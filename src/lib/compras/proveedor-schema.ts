import { z } from "zod";

const texto = (max: number) => z.string().trim().max(max).transform(v => v || null).nullable();
const correo = texto(200).refine(v => v === null || z.email().safeParse(v).success, "Correo no válido.");
export const proveedorSchema = z.object({
  nombre_comercial: z.string().trim().min(1, "El nombre comercial es obligatorio.").max(200),
  razon_social: texto(250), nit: texto(30), direccion: texto(500),
  telefono: texto(50), correo, contacto_nombre: texto(200),
  contacto_telefono: texto(50), contacto_correo: correo,
  metodo_pago_habitual: texto(80), banco: texto(150), numero_cuenta: texto(100),
  tipo_cuenta: texto(80), titular_cuenta: texto(200),
  dias_credito: z.number().int().min(0).max(2147483647).nullable(),
  observaciones: texto(10000), activo: z.boolean(),
}).strict();
export const crearProveedorSchema = proveedorSchema.partial().required({ nombre_comercial: true });
export const editarProveedorSchema = proveedorSchema.partial().refine(v => Object.keys(v).length > 0, "Indique los campos a editar.");
export type ProveedorDatos = z.infer<typeof proveedorSchema>;
export type Proveedor = ProveedorDatos & { id: number; empresa_id: number };
export const camposProveedor = Object.keys(proveedorSchema.shape) as (keyof ProveedorDatos)[];
