import type { KmsClient, KmsConfig, KmsTarget } from './kms-config';

// PRICESMART API-21 — SELECCIÓN del adaptador de proveedor KMS/HSM, con fallo cerrado. La elección del proveedor real es una DECISIÓN PENDIENTE: este repositorio no contiene ningún adaptador de proveedor
// concreto ni credenciales, y no asume ninguno. Lo que sí existe es el MECANISMO por el que, una vez elegido y revisado un proveedor, su adaptador se registra aquí y la composición lo usa: un registro cerrado
// de adaptadores REVISADOS (`REVIEWED_KMS_ADAPTERS`, hoy VACÍO), donde cada entrada declara para qué destinos está aprobada (un adaptador de laboratorio nunca se aprueba para PRODUCTION). Mientras el registro
// esté vacío, cualquier composición que necesite un KMS falla cerrada con `KMS_PROVIDER_NOT_SELECTED`. La identidad de servicio llega como REFERENCIA no secreta; la autenticación real es del adaptador.
// Módulo puro: sin entorno, red ni base de datos; no lo importa la aplicación.
export type KmsAdapterFactory = (input: { config: KmsConfig; serviceIdentityRef: string }) => KmsClient;
export type KmsAdapterRegistration = Readonly<{ targets: readonly KmsTarget[]; create: KmsAdapterFactory }>;
export type KmsAdapterRegistry = Readonly<Record<string, KmsAdapterRegistration>>;
export type KmsSelectionFailure = 'KMS_PROVIDER_NOT_SELECTED' | 'KMS_PROVIDER_UNKNOWN' | 'KMS_PROVIDER_NOT_APPROVED_FOR_TARGET' | 'SERVICE_IDENTITY_MISSING' | 'ADAPTER_FAILED';
export type KmsSelection = { ok: true; client: KmsClient } | { ok: false; reason: KmsSelectionFailure };

/** Adaptadores de proveedor revisados y aprobados. HOY VACÍO: ningún proveedor KMS/HSM ha sido seleccionado (decisión pendiente). */
export const REVIEWED_KMS_ADAPTERS: KmsAdapterRegistry = Object.freeze({});

export function hasReviewedKmsAdapter(registry: KmsAdapterRegistry = REVIEWED_KMS_ADAPTERS): boolean { return Object.keys(registry).length > 0; }

/** Resuelve el cliente KMS de una configuración con un registro dado. Toda ausencia o inconsistencia es un fallo cerrado con un código; nunca se crea un cliente «por omisión». */
export function selectKmsClient(config: KmsConfig, registry: KmsAdapterRegistry): KmsSelection {
  try {
    if (!config || config.providerId === null) return { ok: false, reason: 'KMS_PROVIDER_NOT_SELECTED' };
    if (typeof registry !== 'object' || registry === null || !Object.prototype.hasOwnProperty.call(registry, config.providerId)) return { ok: false, reason: Object.keys(registry ?? {}).length === 0 ? 'KMS_PROVIDER_NOT_SELECTED' : 'KMS_PROVIDER_UNKNOWN' };
    const entry = registry[config.providerId];
    if (!entry || typeof entry.create !== 'function' || !Array.isArray(entry.targets) || !entry.targets.includes(config.target)) return { ok: false, reason: 'KMS_PROVIDER_NOT_APPROVED_FOR_TARGET' };   // p. ej. un adaptador de laboratorio pedido para PRODUCTION
    if (config.serviceIdentityRef === null) return { ok: false, reason: 'SERVICE_IDENTITY_MISSING' };
    const client = entry.create({ config, serviceIdentityRef: config.serviceIdentityRef });
    if (!client || typeof client.encrypt !== 'function' || typeof client.decrypt !== 'function') return { ok: false, reason: 'ADAPTER_FAILED' };
    return { ok: true, client };
  } catch { return { ok: false, reason: 'ADAPTER_FAILED' }; }   // el fallo de un adaptador nunca se propaga con detalles
}
/** Selección con el registro REVISADO del repositorio (hoy vacío ⇒ siempre `KMS_PROVIDER_NOT_SELECTED`). */
export const selectReviewedKmsClient = (config: KmsConfig): KmsSelection => selectKmsClient(config, REVIEWED_KMS_ADAPTERS);
