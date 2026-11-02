import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { z } from 'zod';
import { orderSchema,cancellationSchema } from './contracts';
import { PROVISIONAL_ORDERS_PATH as path } from './http-transport';
const spec=JSON.parse(readFileSync('docs/integraciones/pricesmart/api04/openapi.draft.json','utf8'));
describe('API-04 provisional document/transport contract; static checks, not OpenAPI certification',()=>{
  it('preserves disabled exposure and unratified authentication/cancellation',()=>{
    expect(spec.servers).toEqual([]);expect(spec['x-executable']).toBe(false);expect(spec['x-default-enabled']).toBe(false);expect(spec['x-next-routes-installed']).toBe(false);
    expect(spec['x-m2m-required']).toBe(true);expect(spec['x-m2m-profile']).toBe('UNRESOLVED_D02');expect(spec.components.securitySchemes).toBeUndefined();expect(spec['x-proposed-cancellation'].ratifiedMethod).toBeNull();
  });
  it('describes only the three isolated candidate operations',()=>{
    expect(Object.keys(spec.paths)).toEqual([path,path+'/{externalOrderId}',path+'/{externalOrderId}/cancellation-requests']);
    expect(Object.keys(spec.paths[path])).toEqual(['post']);expect(Object.keys(spec.paths[path+'/{externalOrderId}'])).toEqual(['get']);expect(Object.keys(spec.paths[path+'/{externalOrderId}/cancellation-requests'])).toEqual(['post']);
  });
  it('keeps API-01 DTO schemas without inventing commercial fields',()=>{
    for(const [name,schema]of [['OrderInput',orderSchema],['CancellationInput',cancellationSchema]] as const){const generated=z.toJSONSchema(schema);delete generated.$schema;expect(spec.components.schemas[name]).toEqual(generated);}
  });
  it('resolves every local component reference including reusable headers/responses',()=>{
    const walk=(value:unknown)=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(key==='$ref'){expect(typeof child).toBe('string');expect(String(child).startsWith('#/components/')).toBe(true);let target:unknown=spec;for(const part of String(child).slice(2).split('/'))target=(target as Record<string,unknown>)[part];expect(target).toBeTruthy();}else walk(child);}};walk(spec);
  });
  it('documents sanitized errors, no cache and the provisional rejection matrix',()=>{
    expect(spec.components.schemas.Error.required).toEqual(['code','correlationId']);expect(spec.components.schemas.Error.additionalProperties).toBe(false);expect(spec.components.headers['Cache-Control'].schema.const).toBe('no-store, private');
    for(const item of Object.values(spec.paths))for(const operation of Object.values(item as Record<string,{responses:Record<string,unknown>}>))expect(Object.keys(operation.responses).filter(code=>Number(code)>=400)).toEqual(['400','401','403','404','405','406','408','409','413','414','415','429','431','503']);
    expect(spec.components.schemas.CancellationReceipt.properties.version.minimum).toBe(2);expect(spec.components.schemas.Receipt.properties.version.const).toBe(1);
  });
});
