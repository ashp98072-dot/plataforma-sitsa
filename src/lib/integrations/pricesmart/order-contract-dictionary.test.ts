import { describe, expect, it } from 'vitest';
import { compileContractDictionary, DICTIONARY_LIMITS, DictionaryError, dictionaryHash, LAB_DEMO_DICTIONARY, validateDictionary, type ContractDictionary, type FieldDef } from './order-contract-dictionary';
import { hasDuplicateKeys, parseBody, OrderError } from './contracts';
import { labObservations, labOrderSchema } from './lab-demo/contract';
import { TMS_LIMITS } from './tms-contract-proposal';

const enc = (v: unknown) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
const base = { schemaVersion: 'lab-demo-1', externalOrderId: 'ORD-1', originClubReference: 'CLUB-1', recipient: { name: 'Ana Pérez' }, address: 'Zona 1, 5a calle', deliveryDate: '2026-12-01' };
const PLACEHOLDER = `[PS:${'0'.repeat(32)}]`;
const lab = compileContractDictionary(LAB_DEMO_DICTIONARY, { ratifiedDecisions: [], refinements: [{ message: 'no caben en las observaciones', test: (o) => labObservations(PLACEHOLDER, o as never).length <= TMS_LIMITS.notesMax }] });
const accepts = (c: { contract: { orderSchema: { safeParse: (x: unknown) => { success: boolean } } } }, v: unknown) => c.contract.orderSchema.safeParse(v).success;
const dict = (fields: Record<string, FieldDef>, status: 'PROPOSED' | 'RATIFIED' = 'PROPOSED'): ContractDictionary => ({ schemaVersion: 'v-prueba', status, fields });

describe('API-27 diccionario del contrato de la orden (D06): mecanismo, NO contrato definitivo', () => {
  it('EQUIVALENCIA: `lab-demo-1` compilado desde datos acepta y rechaza lo mismo que el esquema de laboratorio sobre un corpus de bordes (ASCII)', () => {
    const o = (patch: Record<string, unknown>) => ({ ...base, ...patch });
    const long = (n: number) => 'a'.repeat(n);
    const corpus: unknown[] = [base, o({ notes: 'ok' }), o({ notes: long(200) }), o({ notes: long(201) }), o({ recipient: { name: long(200) } }), o({ recipient: { name: long(201) } }), o({ recipient: { name: '   ' } }), o({ recipient: {} }), o({ recipient: { name: 'x', extra: 1 } }),
      o({ address: long(300) }), o({ address: long(301) }), o({ address: '' }), o({ deliveryDate: '2028-02-29' }), o({ deliveryDate: '2027-02-29' }), o({ deliveryDate: '2026-13-01' }), o({ deliveryDate: '2026-1-1' }), o({ deliveryDate: 20261201 }),
      o({ externalOrderId: 'a'.repeat(120) }), o({ externalOrderId: 'a'.repeat(121) }), o({ externalOrderId: '-x' }), o({ externalOrderId: 'a b' }), o({ originClubReference: 'c'.repeat(64) }), o({ originClubReference: 'c'.repeat(65) }),
      o({ schemaVersion: 'otra' }), o({ extra: 1 }), { ...base, deliveryDate: undefined }, o({ notes: 5 }), o({ notes: null }), null, [], 'texto', 7,
      o({ recipient: { name: long(200) }, address: long(300), notes: long(200) }), o({ recipient: { name: long(120) }, address: long(40), notes: long(40) })];
    corpus.forEach((v, i) => expect(accepts(lab, v), `caso ${i}: ${JSON.stringify(v)?.slice(0, 60)}`).toBe(labOrderSchema.safeParse(v).success));
  });
  it('identidad de contenido: orden estable de campos, todos los campos cuentan, opcional ausente = null y el valor NFC/recortado es el que se compara', () => {
    const c = lab.contract; const parse = (v: unknown) => c.orderSchema.parse(v);
    const a = c.canonicalInput(parse(base)); const b = c.canonicalInput(parse({ deliveryDate: '2026-12-01', address: 'Zona 1, 5a calle', recipient: { name: 'Ana Pérez' }, originClubReference: 'CLUB-1', externalOrderId: 'ORD-1', schemaVersion: 'lab-demo-1' }));
    expect(a).toEqual(b); expect(a).toEqual(['lab-demo-1', 'ORD-1', 'CLUB-1', 'Zona 1, 5a calle', '2026-12-01', null, ['Ana Pérez']]);
    for (const patch of [{ address: 'Otra' }, { deliveryDate: '2026-12-02' }, { notes: 'x' }, { recipient: { name: 'Otra' } }, { originClubReference: 'CLUB-2' }]) expect(c.canonicalInput(parse({ ...base, ...patch }))).not.toEqual(a);
    expect(c.canonicalInput(parse({ ...base, recipient: { name: '  Ana Pe\u0301rez  ' } }))).toEqual((a as unknown[]).map((x, i) => (i === 6 ? ['Ana Pérez'] : x)));   // «e» + acento combinante = «é» (NFC) y recortado
  });
  it('LÍMITES en puntos de código (como VARCHAR utf8mb4): 200 emojis caben, 201 no; los sustitutos sueltos, controles y caracteres de suplantación se rechazan', () => {
    const name = (s: string) => ({ ...base, recipient: { name: s } });
    expect(accepts(lab, name('😀'.repeat(200)))).toBe(true); expect(accepts(lab, name('😀'.repeat(201)))).toBe(false);
    for (const bad of ['a\u0000b', 'a\nb', 'a\tb', 'a\u202Eb', 'a\u200Bb', 'a\uFEFFb', 'a\u00ADb', '\uD800', 'a\uDC00b', 'a\u0085b']) expect(accepts(lab, name(bad)), JSON.stringify(bad)).toBe(false);
    expect(accepts(lab, name('Ñandú — Ünïcödé 日本語 العربية'))).toBe(true);
  });
  it('la refinación de observaciones del TMS rechaza lo que no cabe (sin truncar): club de 64 + destinatario de 200 + notas de 200 no caben en 500', () => {
    expect(accepts(lab, { ...base, originClubReference: 'C'.repeat(64), recipient: { name: 'a'.repeat(200) }, notes: 'c'.repeat(200) })).toBe(false); expect(labOrderSchema.safeParse({ ...base, originClubReference: 'C'.repeat(64), recipient: { name: 'a'.repeat(200) }, notes: 'c'.repeat(200) }).success).toBe(false);
    expect(accepts(lab, { ...base, recipient: { name: 'a'.repeat(120) }, notes: 'c'.repeat(100) })).toBe(true);
  });
  it('campos de arreglo (varias entregas, máx. 18 por D05): límites, repetidos por campo único y claves repetidas en elementos distintos SÍ se aceptan (`parseBody` ya no confunde ámbitos)', () => {
    const d = dict({ deliveries: { type: 'array', required: true, min: 1, max: TMS_LIMITS.deliveriesMax, uniqueBy: 'place', items: { type: 'object', required: true, fields: { place: { type: 'string', required: true, max: 60 }, reference: { type: 'string', required: false, max: 80 } } } } });
    const c = compileContractDictionary(d, { ratifiedDecisions: [] }); const order = (deliveries: unknown) => ({ schemaVersion: 'v-prueba', externalOrderId: 'O1', originClubReference: 'C1', deliveries });
    const n = (k: number) => Array.from({ length: k }, (_, i) => ({ place: `P${i}`, reference: 'ref' }));
    expect(accepts(c, order(n(1)))).toBe(true); expect(accepts(c, order(n(18)))).toBe(true); expect(accepts(c, order(n(19)))).toBe(false); expect(accepts(c, order([]))).toBe(false);
    expect(accepts(c, order([{ place: 'A' }, { place: 'A' }]))).toBe(false); expect(accepts(c, order([{ place: 'A', x: 1 }]))).toBe(false);
    const wire = enc(`{"schemaVersion":"v-prueba","externalOrderId":"O1","originClubReference":"C1","deliveries":[{"place":"A","reference":"r"},{"place":"B","reference":"r"}]}`);
    expect(parseBody(wire, c.contract.orderSchema)).toMatchObject({ deliveries: [{ place: 'A' }, { place: 'B' }] });
    expect(c.contract.canonicalInput(parseBody(wire, c.contract.orderSchema) as never)).toEqual(['v-prueba', 'O1', 'C1', [['A', 'r'], ['B', 'r']]]);
  });
  it('`parseBody` sigue rechazando claves duplicadas DENTRO de un mismo objeto (incluidas las escritas con escapes y en cualquier nivel) y acepta repetidas en objetos distintos', () => {
    for (const dup of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}', '[{"a":1,"a":2}]', '{"a":1, "b":{"c":1}, "a":3}']) expect(hasDuplicateKeys(dup), dup).toBe(true);
    for (const ok of ['{"a":1,"b":{"a":2}}', '[{"a":1},{"a":2}]', '{"x":[{"a":1},{"a":1}],"a":0}', '{"a":"a:b","b":":"}', '{"a":[1,2,{"a":3}]}']) expect(hasDuplicateKeys(ok), ok).toBe(false);
    const wire = (s: string) => enc(s); const schema = lab.contract.orderSchema;
    expect(() => parseBody(wire(`{"schemaVersion":"lab-demo-1","schemaVersion":"lab-demo-1","externalOrderId":"O","originClubReference":"C","recipient":{"name":"A"},"address":"x","deliveryDate":"2026-12-01"}`), schema)).toThrow(OrderError);
    expect(() => parseBody(wire(`{"schemaVersion":"lab-demo-1","externalOrderId":"O","originClubReference":"C","recipient":{"name":"A","name":"B"},"address":"x","deliveryDate":"2026-12-01"}`), schema)).toThrow(OrderError);
  });
  it('seguridad del propio diccionario: nombres, reservados, límites, patrones peligrosos, tipos y arreglos mal formados se rechazan con la ruta del campo (nunca valores)', () => {
    const bad: Array<[string, ContractDictionary]> = [
      ['nombre inválido', dict({ 'Mal-Nombre': { type: 'date', required: true } })], ['reservado', dict({ externalOrderId: { type: 'date', required: true } })], ['required implícito', dict({ a: { type: 'date' } as never })],
      ['string max 0', dict({ a: { type: 'string', required: true, max: 0 } })], ['string max enorme', dict({ a: { type: 'string', required: true, max: DICTIONARY_LIMITS.maxString + 1 } })], ['min>max', dict({ a: { type: 'string', required: true, max: 5, min: 6 } })],
      ['patrón sin ancla', dict({ a: { type: 'string', required: true, max: 5, pattern: '[a-z]+' } })], ['patrón catastrófico', dict({ a: { type: 'string', required: true, max: 5, pattern: '^(a+)+$' } })], ['patrón referencia', dict({ a: { type: 'string', required: true, max: 5, pattern: '^(a)\\1$' } })], ['patrón no compila', dict({ a: { type: 'string', required: true, max: 5, pattern: '^(a$' } })],
      ['enum vacío', dict({ a: { type: 'enum', required: true, values: [] } })], ['enum repetido', dict({ a: { type: 'enum', required: true, values: ['A', 'A'] } })], ['enum con espacios', dict({ a: { type: 'enum', required: true, values: ['a b'] } })],
      ['arreglo anidado', dict({ a: { type: 'array', required: true, max: 2, items: { type: 'array', required: true, max: 2, items: { type: 'date', required: true } } } })], ['arreglo > 50', dict({ a: { type: 'array', required: true, max: 51, items: { type: 'date', required: true } } })],
      ['uniqueBy inexistente', dict({ a: { type: 'array', required: true, max: 2, uniqueBy: 'zz', items: { type: 'object', required: true, fields: { p: { type: 'string', required: true, max: 5 } } } } })],
      ['tipo desconocido', dict({ a: { type: 'bigint', required: true } as never })], ['profundidad', dict({ a: { type: 'object', required: true, fields: { b: { type: 'object', required: true, fields: { c: { type: 'object', required: true, fields: { d: { type: 'date', required: true } } } } } } } })],
      ['demasiados campos', dict(Object.fromEntries(Array.from({ length: DICTIONARY_LIMITS.maxFields + 1 }, (_, i) => [`f${i}`, { type: 'date', required: true }])))],
      ['versión reservada', { schemaVersion: 'api01-draft-1', status: 'PROPOSED', fields: {} }], ['versión inválida', { schemaVersion: 'V 1', status: 'PROPOSED', fields: {} }], ['status inválido', { schemaVersion: 'v1', status: 'OK' as never, fields: {} }],
    ];
    for (const [name, d] of bad) { expect(validateDictionary(d).length, name).toBeGreaterThan(0); expect(() => compileContractDictionary(d, { ratifiedDecisions: ['D06'] }), name).toThrow(DictionaryError); }
    const secretish = (() => { try { compileContractDictionary(dict({ a: { type: 'string', required: true, max: 5, pattern: 'SECRETO-XYZ' } }), { ratifiedDecisions: [] }); return ''; } catch (e) { return JSON.stringify((e as DictionaryError).issues); } })(); expect(secretish).not.toContain('SECRETO-XYZ');
  });
  it('BARRERA D06: un diccionario RATIFIED solo se compila con D06 declarada; PROPOSED siempre; el hash cambia con cualquier cambio y no con el orden de claves', () => {
    const ratified: ContractDictionary = { ...LAB_DEMO_DICTIONARY, status: 'RATIFIED' };
    expect(() => compileContractDictionary(ratified, { ratifiedDecisions: [] })).toThrow(expect.objectContaining({ code: 'D06_NOT_RATIFIED' })); expect(() => compileContractDictionary(ratified, { ratifiedDecisions: ['D05', 'D09'] })).toThrow(DictionaryError);
    expect(compileContractDictionary(ratified, { ratifiedDecisions: ['D06'] }).status).toBe('RATIFIED'); expect(lab.status).toBe('PROPOSED');
    const reordered = { ...LAB_DEMO_DICTIONARY, fields: { notes: LAB_DEMO_DICTIONARY.fields.notes, deliveryDate: LAB_DEMO_DICTIONARY.fields.deliveryDate, address: LAB_DEMO_DICTIONARY.fields.address, recipient: LAB_DEMO_DICTIONARY.fields.recipient } };
    expect(dictionaryHash(reordered)).toBe(dictionaryHash(LAB_DEMO_DICTIONARY)); expect(dictionaryHash({ ...LAB_DEMO_DICTIONARY, schemaVersion: 'lab-demo-2' })).not.toBe(dictionaryHash(LAB_DEMO_DICTIONARY)); expect(lab.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('el compilado es inmutable y no se conecta a nada: no importa el runtime, rutas ni la base de datos', async () => {
    expect(Object.isFrozen(lab)).toBe(true);
    const { readFileSync } = await import('node:fs'); const { dirname, resolve } = await import('node:path'); const { fileURLToPath } = await import('node:url');
    const text = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'order-contract-dictionary.ts'), 'utf8');
    expect(text).not.toMatch(/mysql|process\.env|from '\.\/(runtime|service|http-transport|mariadb)|homologation\/runtime|lab-demo\/(composition|gate)/);
  });
});
