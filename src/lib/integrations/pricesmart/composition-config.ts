import { SECRETISH_NAME, parseKmsConfig, type KmsConfig } from './kms-config';
import { validateLabIdentity, validateProductionIdentity, type DbIdentity } from './database-identity';

// PRICESMART API-21 — CONFIGURACIÓN de la composición, estrictamente separada por destino (LAB / PRODUCTION). Función PURA: recibe un objeto de entorno, no lee `process.env`, no abre conexiones y NO acepta
// credenciales (ni contraseñas de base de datos, ni claves, ni tokens: cualquier variable con aspecto de secreto invalida la configuración; las credenciales las resuelve la composición administrativa por su
// propio canal). Una configuración describe UN solo destino y es incompatible con restos del otro: en PRODUCCIÓN no puede haber variables de laboratorio ni entorno sandbox, y en LABORATORIO no puede haber
// `NODE_ENV=production`; la identidad de base de datos y los alias KMS deben corresponder al destino. Los mensajes citan nombres de variables, nunca valores.
export type CompositionTarget = 'LAB' | 'PRODUCTION';
export type CompositionConfig = Readonly<{ target: CompositionTarget; kms: KmsConfig; database: DbIdentity }>;
export type CompositionConfigResult = { ok: true; config: CompositionConfig } | { ok: false; issues: string[] };

export const COMPOSITION_ENV_VARIABLES = ['PRICESMART_COMPOSITION_TARGET', 'PRICESMART_DB_HOST', 'PRICESMART_DB_PORT', 'PRICESMART_DB_SCHEMA', 'PRICESMART_DB_RUNTIME_USER', 'PRICESMART_DB_RUNTIME_HOST',
  'PRICESMART_DB_REGISTRY_WRITER_USER', 'PRICESMART_DB_REGISTRY_WRITER_HOST', 'PRICESMART_DB_MIGRATION_USER', 'PRICESMART_DB_MIGRATION_HOST'] as const;
const LAB_ONLY = /^PRICESMART_LAB_/;

export function parseCompositionConfig(env: Record<string, string | undefined>): CompositionConfigResult {
  const issues: string[] = []; const e = env ?? {};
  const set = (name: string) => e[name] !== undefined && e[name] !== '';
  for (const name of Object.keys(e)) {
    if (!set(name)) continue;
    if ((name.startsWith('PRICESMART_DB_') || name.startsWith('PRICESMART_COMPOSITION_')) ) {
      if (SECRETISH_NAME.test(name)) issues.push(`${name}: variable con aspecto de credencial NO permitida (las credenciales no forman parte de la configuración)`);
      else if (!(COMPOSITION_ENV_VARIABLES as readonly string[]).includes(name)) issues.push(`${name}: variable desconocida`);
    }
  }
  const target = e.PRICESMART_COMPOSITION_TARGET;
  if (target !== 'LAB' && target !== 'PRODUCTION') issues.push('PRICESMART_COMPOSITION_TARGET: debe ser LAB o PRODUCTION');
  // separación de destinos: nada del otro destino puede estar presente
  if (target === 'PRODUCTION') {
    for (const name of Object.keys(e)) if (set(name) && LAB_ONLY.test(name)) issues.push(`${name}: variable de laboratorio presente en una configuración de PRODUCCIÓN`);
    if (e.NOVALVION_ENV === 'sandbox') issues.push('NOVALVION_ENV: entorno sandbox incompatible con PRODUCCIÓN');
  }
  if (target === 'LAB' && e.NODE_ENV === 'production') issues.push('NODE_ENV: production incompatible con LABORATORIO');
  const kms = parseKmsConfig(e);
  if (!kms.ok) issues.push(...kms.issues); else if ((target === 'LAB' || target === 'PRODUCTION') && kms.config.target !== target) issues.push('PRICESMART_KMS_TARGET: no coincide con PRICESMART_COMPOSITION_TARGET');
  const port = e.PRICESMART_DB_PORT === undefined ? NaN : /^\d{1,5}$/.test(e.PRICESMART_DB_PORT) ? Number(e.PRICESMART_DB_PORT) : NaN;
  const database: DbIdentity = {
    host: e.PRICESMART_DB_HOST ?? '', port, schema: e.PRICESMART_DB_SCHEMA ?? '',
    runtimeUser: e.PRICESMART_DB_RUNTIME_USER ?? '', runtimeHost: e.PRICESMART_DB_RUNTIME_HOST ?? '',
    registryWriterUser: e.PRICESMART_DB_REGISTRY_WRITER_USER ?? '', registryWriterHost: e.PRICESMART_DB_REGISTRY_WRITER_HOST ?? '',
    migrationUser: e.PRICESMART_DB_MIGRATION_USER ?? '', migrationHost: e.PRICESMART_DB_MIGRATION_HOST ?? '',
  };
  if (target === 'LAB' || target === 'PRODUCTION') {
    const found = target === 'LAB' ? validateLabIdentity(database) : validateProductionIdentity(database);
    for (const i of found) issues.push(`PRICESMART_DB_*: ${i.code}${i.field ? ` (${i.field.replace(/^(lab|production)\./, '')})` : ''}`);
  }
  if (issues.length || !kms.ok || (target !== 'LAB' && target !== 'PRODUCTION')) return { ok: false, issues: [...new Set(issues)] };
  return { ok: true, config: Object.freeze({ target, kms: kms.config, database: Object.freeze(database) }) };
}
