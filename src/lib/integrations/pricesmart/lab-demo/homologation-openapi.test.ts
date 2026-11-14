import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labOrderSchema } from './contract';
import { assessCancellation, EXTERNAL_STATUSES, PLAN_STATES, SOLICITUD_STATES } from '../tms-contract-proposal';

// PRICESMART API-24 — la OpenAPI de HOMOLOGACIÓN debe describir lo REALMENTE implementado y etiquetar qué es provisional y qué está pendiente. Estas pruebas la atan al código: si el código cambia y el documento no, fallan.
const spec = JSON.parse(readFileSync('docs/integraciones/pricesmart/api24/openapi.homologation.json', 'utf8'));
const draft = JSON.parse(readFileSync('docs/integraciones/pricesmart/api04/openapi.draft.json', 'utf8'));
const STATUSES = ['PROVISIONAL_LAB', 'PROPOSED_D08', 'PROPOSED_D09', 'PENDING_PRICESMART'];

describe('API-24 OpenAPI de homologación ↔ código', () => {
  it('no es ejecutable, no ofrece acceso anónimo y declara qué está pendiente de ratificar (D01–D12)', () => {
    expect(spec['x-executable']).toBe(false); expect(spec['x-m2m-required']).toBe(true);
    expect(spec.components.securitySchemes).toBeUndefined(); expect(spec.security).toBeUndefined();
    expect(Object.keys(spec['x-pending-ratification'])).toEqual(expect.arrayContaining(['D01', 'D02', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12']));
    expect(spec.info.title).toMatch(/PROVISIONAL/); expect(spec.info.description).toMatch(/NADA de este documento es un acuerdo con PriceSmart/);
  });
  it('mismas rutas y métodos que el transporte implementado (api04); todo elemento lleva `x-contract-status` válido y la cancelación queda PENDIENTE de PriceSmart', () => {
    const shape = (s: { paths: Record<string, Record<string, unknown>> }) => Object.entries(s.paths).map(([p, m]) => `${p} ${Object.keys(m).sort().join(',')}`).sort();
    expect(shape(spec)).toEqual(shape(draft));
    for (const [p, item] of Object.entries<Record<string, { 'x-contract-status'?: string }>>(spec.paths)) for (const [m, op] of Object.entries(item)) expect(STATUSES, `${m} ${p}`).toContain(op['x-contract-status']);
    expect(spec.paths['/api/integrations/pricesmart/v1/orders/{externalOrderId}/cancellation-requests'].post['x-contract-status']).toBe('PENDING_PRICESMART');
    for (const [name, schema] of Object.entries<{ 'x-contract-status'?: string }>(spec.components.schemas)) expect(STATUSES, name).toContain(schema['x-contract-status']);
  });
  it('OrderInput describe EXACTAMENTE el contrato lab-demo-1 (mismos campos, mismos obligatorios, sin campos extra)', () => {
    const input = spec.components.schemas.OrderInput; const shape = labOrderSchema.shape;
    expect(Object.keys(input.properties).sort()).toEqual(Object.keys(shape).sort());
    const optional = Object.entries(shape).filter(([, v]) => v.safeParse(undefined).success).map(([k]) => k);
    expect([...input.required].sort()).toEqual(Object.keys(shape).filter((k) => !optional.includes(k)).sort());
    expect(input.additionalProperties).toBe(false); expect(input.properties.schemaVersion.const).toBe('lab-demo-1');
    expect(input['x-contract-status']).toBe('PROVISIONAL_LAB'); expect(input['x-pending']).toEqual(expect.arrayContaining(['D05', 'D06', 'D07']));
  });
  it('los estados externos, estados de solicitud y veredictos de cancelación del documento son los del código; ninguno afirma entrega', () => {
    const view = spec.components.schemas.LabOrderStatusView;
    expect(view.properties.proposedStatus.enum).toEqual([...EXTERNAL_STATUSES]);
    expect(view.properties.tms.properties.requestState.enum.filter((s: unknown) => s !== null)).toEqual([...SOLICITUD_STATES]);
    const verdicts = new Set<string>(['REQUESTED_NOT_LINKED']);
    for (const s of [...SOLICITUD_STATES, 'DESCONOCIDO']) for (const p of [null, ...PLAN_STATES, 'DESCONOCIDO']) verdicts.add(assessCancellation(s, p).verdict);
    expect(new Set(view.properties.cancellation.properties.assessment.enum)).toEqual(verdicts);
    expect(view.properties.confirmsDelivery.const).toBe(false); expect(view.properties.cancellation.properties.automatic.const).toBe(false);
    expect(JSON.stringify(spec.components.schemas)).not.toMatch(/DELIVERED|ENTREGAD/);
    expect(spec.paths['/api/integrations/pricesmart/v1/orders/{externalOrderId}'].get.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/LabOrderStatusView');
  });
});
