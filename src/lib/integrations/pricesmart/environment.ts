import { z } from 'zod';

// PRICESMART API-22 — el ENTORNO es un valor de primer orden de los contratos de seguridad: `sandbox` o `production`, nada más. Módulo PURO y sin dependencias.
// Reglas (todas fallan CERRADAS): el entorno forma parte de la identidad (namespace), de las autorizaciones y de las comprobaciones de confianza; su AUSENCIA, un valor desconocido (`staging`, `Sandbox`, vacío,
// número…) o cualquier discrepancia entre el entorno del despliegue, de la aserción verificada, del registro administrativo y del recurso pedido se rechaza. Modelar `production` en el contrato NO
// autoriza nada: los puertos de persistencia y de laboratorio siguen exigiendo `sandbox` (guardas `sandbox_api02_*`), no existe verificador criptográfico ni proveedor KMS aprobado, y los endpoints siguen 503 DISABLED.
export const ENVIRONMENTS = ['sandbox', 'production'] as const;
export const environmentSchema = z.enum(ENVIRONMENTS);
export type Environment = z.infer<typeof environmentSchema>;
/** Entorno por omisión de los contratos heredados de laboratorio (compatibilidad): nunca `production`. */
export const DEFAULT_ENVIRONMENT: Environment = 'sandbox';
export const isEnvironment = (value: unknown): value is Environment => environmentSchema.safeParse(value).success;
/** Todos los entornos presentados deben ser válidos Y exactamente iguales; con cero o con algún valor ausente/inválido, es falso. */
export function sameEnvironment(...values: unknown[]): boolean {
  return values.length > 0 && values.every(isEnvironment) && values.every(v => v === values[0]);
}
