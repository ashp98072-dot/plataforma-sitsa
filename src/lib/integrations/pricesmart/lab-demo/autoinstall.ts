import { installPriceSmartHandler } from '../runtime';

// PRICESMART API-12 — instalación perezosa de la composición de LABORATORIO. Solo se intenta si el entorno declara explícitamente la bandera de laboratorio y no es producción;
// la composición vuelve a validar TODAS las condiciones y, si alguna falla, no instala nada (las rutas siguen en 503 DISABLED).
export async function autoInstallLabDemo(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (env.PRICESMART_LAB_DEMO !== 'SINTETICO-LOCAL-SIN-PRODUCCION' || env.NODE_ENV === 'production') return false;
  const { createLabDemoHandler } = await import('./composition');
  const handler = await createLabDemoHandler(env);
  if (!handler) return false;
  installPriceSmartHandler(handler);
  return true;
}
