// PRICESMART API-12/15 — condiciones del laboratorio, en un módulo PURO (sin base de datos, TMS ni red). Única implementación: la composición ejecutable y el diagnóstico administrativo la reutilizan.
export const LAB_DEMO_FLAG = 'SINTETICO-LOCAL-SIN-PRODUCCION';

export function labDemoGate(env: Record<string, string | undefined>): { ok: true } | { ok: false; reason: string } {
  if (env.NODE_ENV === 'production') return { ok: false, reason: 'NODE_ENV=production' };
  if (env.NOVALVION_ENV !== 'sandbox') return { ok: false, reason: 'no es sandbox' };
  if (env.PRICESMART_LAB_DEMO !== LAB_DEMO_FLAG) return { ok: false, reason: 'bandera de laboratorio ausente' };
  if (env.DB_HOST !== '127.0.0.1') return { ok: false, reason: 'la base no es loopback' };
  if (!/^sandbox_api02_[a-z0-9_]+$/.test(env.DB_NAME ?? '') || !/^sandbox_api02_[a-z0-9_]+$/.test(env.DB_USER ?? '')) return { ok: false, reason: 'base/cuenta sin el patrón del laboratorio' };
  if ((env.PRICESMART_LAB_KEY ?? '').length < 32) return { ok: false, reason: 'clave de laboratorio ausente o corta' };
  return { ok: true };
}
