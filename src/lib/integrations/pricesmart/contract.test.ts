import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { orderSchema, cancellationSchema, parseBody } from './contracts';

const spec = JSON.parse(readFileSync('docs/integraciones/pricesmart/api01/openapi.draft.json', 'utf8'));
describe('API-01 static contract and exposure audit (not HTTP acceptance)', () => {
  it('matches OpenAPI DTO schemas against the installed Zod generator', () => {
    for (const [name, schema] of [['OrderInput',orderSchema],['CancellationInput',cancellationSchema]] as const) {
      const generated = z.toJSONSchema(schema); delete generated.$schema;
      expect(spec.components.schemas[name]).toEqual(generated);
    }
  });
  it('resolves every local schema reference and keeps auth and cancellation unratified', () => {
    function walk(value: unknown) {
      if (!value || typeof value !== 'object') return;
      for (const [key,child] of Object.entries(value)) {
        if (key === '$ref') { expect(typeof child).toBe('string'); expect(String(child).startsWith('#/components/schemas/')).toBe(true); expect(spec.components.schemas[String(child).split('/').at(-1)!]).toBeTruthy(); }
        else walk(child);
      }
    }
    walk(spec); expect(spec['x-executable']).toBe(false); expect(spec['x-default-enabled']).toBe(false); expect(spec['x-m2m-required']).toBe(true);
    expect(spec['x-proposed-cancellation'].method).toBeNull(); expect(spec.components.securitySchemes).toBeUndefined();
    expect(Object.values(spec.paths).flatMap(value => Object.keys(value as object)).sort()).toEqual(['get','post']);
  });
  it('has no executable route or application import outside this isolated module', () => {
    function inspect(dir: string) {
      for (const item of readdirSync(dir, { withFileTypes:true })) {
        const path=join(dir,item.name); if(item.isDirectory()) { if(path.replaceAll('\\','/').endsWith('/lib/integrations/pricesmart')) continue; inspect(path); }
        else if(/\.[cm]?[jt]sx?$/.test(item.name)) expect(readFileSync(path,'utf8')).not.toMatch(/integrations\/pricesmart|PRICESMART_ENABLED|OrderApplication/);
      }
    }
    inspect('src');
  });
  it('production modules contain no DB/TMS/network imports, console output or env activation', () => {
    for (const file of ['contracts.ts','ports.ts','service.ts','transport.ts']) {
      const source=readFileSync(join('src/lib/integrations/pricesmart',file),'utf8');
      expect(source).not.toMatch(/from\s+["'](?:mysql2|@\/lib\/(?:db|tms)|node:(?:net|tls|http|https|fs|child_process))/);
      expect(source).not.toMatch(/console\.|process\.env|\bfetch\s*\(/);
    }
  });
  it('rejects BOM and preserves the bounded flat JSON profile', () => {
    expect(()=>parseBody(new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode('{}')]),orderSchema)).toThrow('INVALID_INPUT');
  });
  it('keeps staging DDL guarded and outside production migration paths', () => {
    const ddl=readFileSync('docs/integraciones/pricesmart/api01/staging.sql.in','utf8');
    const stripped=ddl.replace(/^--.*$/gm,'').trimStart(); expect(stripped.startsWith("SIGNAL SQLSTATE '45000'")).toBe(true);
    expect(ddl).toContain('UNIQUE KEY uq_ps_api01_identity (environment, tenant_id, client_id, integration_id, external_order_id)');
    expect(ddl).not.toMatch(/^\s*(?:USE|GRANT|DROP|ALTER USER|CREATE USER)\b/m);
  });
});
