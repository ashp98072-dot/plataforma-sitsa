import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allQuestions, DECISIONS, decisionById, openDecisions, renderQuestionPackage } from './decision-registry';
import { DECISION_STATUS, EXTERNAL_STATUSES } from './tms-contract-proposal';
import { REVIEWED_KMS_ADAPTERS } from './kms-provider-selection';
import { parseRuntimeConfig, REQUIRED_DECISIONS } from './runtime-config';
import { deliveryEvidenceUnavailable } from './delivery-evidence';

const repo = path.resolve(__dirname, '../../../..');

describe('API-27 registro de decisiones externas y paquete de preguntas', () => {
  it('cada decisión tiene preguntas con identificador único, bloqueos declarados y puntos de enchufe que EXISTEN en el repositorio', () => {
    const ids = allQuestions().map((q) => q.id); expect(new Set(ids).size).toBe(ids.length);
    for (const d of DECISIONS) {
      expect(d.questions.length, d.id).toBeGreaterThan(0); expect(d.blocks.length, d.id).toBeGreaterThan(0); expect(d.builtWithoutAnswer.length, d.id).toBeGreaterThan(0);
      for (const q of d.questions) { expect(q.id.startsWith(`${d.id}-`), q.id).toBe(true); expect(q.text.length, q.id).toBeGreaterThan(30); expect(q.why.length, q.id).toBeGreaterThan(15); expect(q.text, q.id).toMatch(/[¿?]|Confirmar|Entregar/); }
      for (const seam of d.seams) expect(existsSync(path.join(repo, seam)), seam).toBe(true);
    }
  });
  it('el registro coincide con el código: estados de D05/D06/D08/D09, KMS sin adaptador revisado y D13 sin estado «entregada»', () => {
    for (const id of ['D05', 'D06', 'D08', 'D09'] as const) expect(decisionById(id).status, id).toBe(DECISION_STATUS[id]);
    expect(decisionById('KMS').status).toBe('PENDING_EXTERNAL'); expect(Object.keys(REVIEWED_KMS_ADAPTERS)).toEqual([]);
    expect(decisionById('D13').status).toBe('PENDING_EXTERNAL'); expect(deliveryEvidenceUnavailable()).toMatchObject({ confirmsDelivery: false, publishable: false, blockedBy: ['D13_PENDING'] });
    expect(EXTERNAL_STATUSES.some((s) => /DELIVERED|ENTREGAD/i.test(s) && !/UNCONFIRMED/.test(s))).toBe(false);
    expect(decisionById('D02').status).toBe('PENDING_EXTERNAL');
  });
  it('las decisiones abiertas son exactamente las que bloquean la activación: D02, D06, D08, D09, D12, D13 y KMS (D05 está aprobada)', () => {
    expect(openDecisions().map((d) => d.id)).toEqual(['D02', 'D06', 'D08', 'D09', 'D12', 'D13', 'KMS']); expect(openDecisions().every((d) => d.status !== 'APPROVED')).toBe(true);
  });
  it('el predeterminado es APAGADO y la ratificación solo admite códigos Dnn (KMS NO se ratifica por variable: exige un adaptador revisado)', () => {
    expect(parseRuntimeConfig({} as never)).toEqual({ ok: false, mode: 'DISABLED', issues: [] }); expect(parseRuntimeConfig({ PRICESMART_RUNTIME_MODE: 'DISABLED', PRICESMART_RATIFIED_DECISIONS: 'D02' } as never)).toMatchObject({ ok: false, mode: 'DISABLED' });
    const source = readFileSync(path.join(repo, 'src/lib/integrations/pricesmart/runtime-config.ts'), 'utf8'); expect(source).toContain('PRICESMART_RATIFIED_DECISIONS: z.string().regex('); expect(source).toContain(String.raw`(D\d{2})(,D\d{2})*`); expect(source).not.toContain('KMS|');
  });
  it('el paquete de preguntas del repositorio es EXACTAMENTE el generado desde el registro (no se edita a mano) y no contiene secretos, direcciones ni nombres de personas', () => {
    const file = path.join(repo, 'docs/integraciones/pricesmart/api27/PAQUETE-PREGUNTAS-PRICESMART.md');
    expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toBe(renderQuestionPackage());
    const text = renderQuestionPackage(); expect(text).not.toMatch(/https?:\/\/|@[a-z0-9-]+\.[a-z]|password|secret(?!o)|Bearer |BEGIN [A-Z ]*KEY|\b\d{1,3}(\.\d{1,3}){3}\b/i);
    for (const d of DECISIONS) expect(text).toContain(`## ${d.id} — ${d.title}`);
    for (const q of allQuestions()) expect(text).toContain(`${q.id}. ${q.text}`);
  });
  it('toda decisión que el runtime exige para READ_ONLY o ENABLED está en el registro y abierta (el paquete de preguntas no puede omitir ninguna)', () => {
    const exigidas = [...new Set(Object.values(REQUIRED_DECISIONS).flat())];
    expect(exigidas).toEqual(expect.arrayContaining(['D02', 'D06', 'D08', 'D09', 'D12']));
    for (const id of exigidas) { const d = DECISIONS.find((x) => x.id === id); expect(d, `${id} exigida por REQUIRED_DECISIONS y ausente del registro`).toBeDefined(); expect(d!.status, id).not.toBe('APPROVED'); }
    expect(decisionById('D12')).toMatchObject({ status: 'PENDING_EXTERNAL', owner: 'PRICESMART' });
  });
  it('el registro es de solo lectura y autocontenido (sin importaciones, sin acceso a entorno, red ni base de datos)', () => {
    const text = readFileSync(path.join(repo, 'src/lib/integrations/pricesmart/decision-registry.ts'), 'utf8'); expect(text).not.toMatch(/^import |process\.env|fetch\(|mysql/m);
    expect(Object.isFrozen(DECISIONS)).toBe(true);
  });
});
