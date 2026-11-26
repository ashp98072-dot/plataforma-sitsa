import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labOrderSchema } from './contract';

// PRICESMART API-25 — la colección Postman de homologación debe ser importable, consistente con la OpenAPI y NO contener URLs reales, credenciales ni un mecanismo de autenticación supuesto.
const col = JSON.parse(readFileSync('docs/integraciones/pricesmart/api25/postman_collection.homologation.json', 'utf8'));
const spec = JSON.parse(readFileSync('docs/integraciones/pricesmart/api25/openapi.homologation.json', 'utf8'));
type Item = { name: string; item?: Item[]; request?: { method: string; url: { raw: string }; header: { key: string; value: string }[]; body?: { raw: string }; description: string } };
const requests = (items: Item[]): Item[] => items.flatMap((i) => (i.item ? requests(i.item) : [i]));
const all = requests(col.item);

describe('API-25 colección Postman de homologación', () => {
  it('es Postman v2.1 importable, con variables-marcador y SIN URL real ni credenciales', () => {
    expect(col.info.schema).toBe('https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
    const vars = Object.fromEntries(col.variable.map((v: { key: string; value: string }) => [v.key, v.value]));
    expect(vars.baseUrl).toMatch(/^https:\/\/[A-Z0-9-]+\.invalid$/); expect(vars.authHeaderName).toBe('PENDIENTE-D02'); expect(vars.authHeaderValue).toBe('');
    const text = JSON.stringify(col);
    expect(text).not.toMatch(/Bearer |Basic [A-Za-z0-9+/=]{8,}|client_secret|password|api[_-]?key|x-lab-evidence|PRICESMART_LAB|sandbox_api02_|localhost|127\.0\.0\.1|https?:\/\/(?![A-Z0-9-]+\.invalid|schema\.getpostman\.com)/i);
    expect(col.info.description).toMatch(/NO EJECUTABLE HOY/); expect(col.info.description).toMatch(/503 DISABLED/);
  });
  it('cada petición existe en la OpenAPI (misma ruta y método), declara su estado y los cuerpos de orden cumplen el contrato lab-demo-1', () => {
    const pathOf = (raw: string) => raw.replace('{{baseUrl}}', '').replace(/\/orders\/\{\{(?:externalOrderId|unknownOrderId)\}\}/, '/orders/{externalOrderId}');
    expect(all.length).toBeGreaterThanOrEqual(11);
    for (const item of all) {
      const r = item.request!; const op = spec.paths[pathOf(r.url.raw)]?.[r.method.toLowerCase()]; expect(op, `${r.method} ${r.url.raw}`).toBeDefined();
      expect(r.description, item.name).toMatch(/^\[(PROVISIONAL_LAB|PENDING_PRICESMART)\]/);
      if (r.description.startsWith('[PROVISIONAL_LAB]') && r.url.raw.endsWith('/cancellation-requests')) throw new Error('la cancelación no puede presentarse como provisional-lab: su método está pendiente');
      if (r.url.raw.endsWith('/orders') && r.method === 'POST' && !/campoNoDefinido/.test(r.body!.raw)) {
        const body = JSON.parse(r.body!.raw.replaceAll('{{externalOrderId}}', 'SANDBOX-ORDEN-0001').replaceAll('{{originClub}}', 'CLUB-SINTETICO').replaceAll('{{deliveryDate}}', '2026-12-15'));
        expect(labOrderSchema.safeParse(body).success, item.name).toBe(true);
      }
    }
    expect(all.filter((i) => i.request!.url.raw.endsWith('/cancellation-requests')).every((i) => i.request!.description.startsWith('[PENDING_PRICESMART]'))).toBe(true);
  });
  it('la autenticación solo usa los marcadores D02 y las peticiones sin autenticación (401) no los envían', () => {
    for (const item of all) {
      const auth = item.request!.header.filter((h) => !['Accept', 'Content-Type'].includes(h.key));
      if (item.name.startsWith('3.1')) expect(auth).toEqual([]);
      else expect(auth).toEqual([expect.objectContaining({ key: '{{authHeaderName}}', value: '{{authHeaderValue}}' })]);
    }
  });
});
