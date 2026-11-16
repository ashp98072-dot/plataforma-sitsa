import { createHash } from 'node:crypto';
import { z } from 'zod';
import { reference, type OrderContractOptions } from './contracts';
import { isCalendarDate } from './tms-solicitud-draft';
import { TMS_LIMITS } from './tms-contract-proposal';

// PRICESMART API-27 — MECANISMO de configuración del contrato de la orden (D06). Un DICCIONARIO declarativo (datos) se compila a (1) un validador estricto y (2) la identidad de contenido que usa la idempotencia
// (`OrderContractOptions`). Cuando PriceSmart entregue el diccionario definitivo, el contrato será datos + pruebas, no código nuevo. ESTE módulo NO define el contrato definitivo ni ratifica D06: un diccionario
// `RATIFIED` solo se compila si `D06` está en las decisiones ratificadas que declara el operador; sin eso, el estado máximo es `PROPOSED` (laboratorio/homologación). Nada aquí está conectado a rutas ni al runtime.
//
// Reglas de seguridad fijas (no configurables): cada campo es obligatorio u opcional de forma EXPLÍCITA; objetos estrictos (campo desconocido ⇒ rechazo); cadenas normalizadas a NFC, recortadas si se pide, contadas en
// puntos de código (como un VARCHAR de utf8mb4), sin caracteres de control, sin sustitutos sueltos y sin caracteres de dirección o ancho cero que permiten suplantar texto; fechas de calendario REALES;
// profundidad ≤ 3, ≤ 40 campos, cadenas ≤ 2000, arreglos ≤ 50 elementos, patrones del lenguaje restringido de `analyzePattern` (sin grupos ni retroceso catastrófico).

export type StringField = { type: 'string'; required: boolean; max: number; min?: number; trim?: boolean; pattern?: string };
export type DateField = { type: 'date'; required: boolean };
export type EnumField = { type: 'enum'; required: boolean; values: readonly string[] };
export type ObjectField = { type: 'object'; required: boolean; fields: Readonly<Record<string, FieldDef>> };
export type ArrayField = { type: 'array'; required: boolean; max: number; min?: number; items: FieldDef; /** Nombre de un campo de cadena de los elementos (objetos) que no puede repetirse. */ uniqueBy?: string };
export type FieldDef = StringField | DateField | EnumField | ObjectField | ArrayField;
export type ContractDictionary = Readonly<{ schemaVersion: string; status: 'PROPOSED' | 'RATIFIED'; fields: Readonly<Record<string, FieldDef>> }>;

export const DICTIONARY_LIMITS = Object.freeze({ maxDepth: 3, maxFields: 40, maxString: 2000, maxArray: 50, maxEnumValues: 50, maxPattern: 200 });
export const RESERVED_FIELDS = Object.freeze(['schemaVersion', 'externalOrderId', 'originClubReference']);
const FIELD_NAME = /^[a-z][A-Za-z0-9]{0,39}$/; const SCHEMA_VERSION = /^[a-z0-9][a-z0-9.-]{0,31}$/;
const CONTROL = /\p{Cc}/u; const SPOOF = /[\u200B-‏‪-\u202E\u2066-\u2069\uFEFF\u00AD]/u;

// ---- Lenguaje de patrones ADMITIDO (política estructural, no heurística). Un patrón es `^` + elementos + `$`, donde cada elemento es un ÁTOMO (carácter literal, `.`, `\d` `\w` `\s`, un escape de metacarácter o una
// clase simple `[...]`) con un cuantificador opcional (`?` `*` `+` `{n}` `{n,}` `{n,m}`, m ≤ 255). NO hay grupos, alternancias, referencias hacia atrás, anticipaciones ni cuantificadores perezosos. Sin grupos no puede haber
// cuantificadores anidados ni alternativas ambiguas, así que lo único que puede costar es el producto de las elecciones de repetición de los cuantificadores VARIABLES: un retroceso explora, como máximo, ese producto de
// combinaciones (cada una cuesta a lo sumo la longitud de la cadena, que ya está acotada por `max` ANTES de aplicar el patrón). `patternCost` calcula esa cota y `MAX_PATTERN_COST` la limita; todo patrón que la supere
// (p. ej. muchos opcionales seguidos o varios `*` en fila) se rechaza. Para alternativas fijas se usa `enum`.
export const MAX_PATTERN_COST = 5000; const MAX_PATTERN_ITEMS = 60; const MAX_REPEAT = 255;
const META = new Set(['\\', '^', '$', '.', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}']);
export type PatternAnalysis = { ok: true; cost: number; items: number } | { ok: false; reason: string };
export function analyzePattern(pattern: string, maxLength: number): PatternAnalysis {
  const bad = (reason: string): PatternAnalysis => ({ ok: false, reason });
  if (typeof pattern !== 'string' || pattern.length > DICTIONARY_LIMITS.maxPattern) return bad('LONGITUD');
  if (!pattern.startsWith('^') || !pattern.endsWith('$') || pattern.length < 2 || pattern.endsWith('\\$')) return bad('SIN_ANCLAS');
  const body = [...pattern.slice(1, -1)]; let i = 0; let cost = 1; let items = 0;
  const readEscape = (): boolean => { const c = body[i + 1]; if (c === undefined) return false; if (c === 'd' || c === 'w' || c === 's') { i += 2; return true; } if (META.has(c) || c === '-' || c === '/') { i += 2; return true; } return false; };   // nada de \1, \b, \k, \p, \u…
  const readClass = (): boolean => {
    i++; if (body[i] === '^') i++; let n = 0;
    while (i < body.length && body[i] !== ']') {
      const c = body[i]; if (c === '[') return false;   // dentro de una clase los demás metacaracteres son literales (no hay anidación ni POSIX)
      if (c === '\\') { if (!readEscape()) return false; n++; continue; }
      if (body[i + 1] === '-' && body[i + 2] !== undefined && body[i + 2] !== ']') { const hi = body[i + 2]; if (hi === '\\' || hi === '[' || (hi.codePointAt(0) as number) < (c.codePointAt(0) as number)) return false; i += 3; n++; continue; }
      i++; n++; if (n > 30) return false;
    }
    if (body[i] !== ']' || n === 0 || n > 30) return false; i++; return true;
  };
  while (i < body.length) {
    const c = body[i]; items++; if (items > MAX_PATTERN_ITEMS) return bad('DEMASIADOS_ELEMENTOS');
    if (c === '\\') { if (!readEscape()) return bad('ESCAPE_NO_PERMITIDO'); }
    else if (c === '[') { if (!readClass()) return bad('CLASE_NO_PERMITIDA'); }
    else if (c === '(' || c === ')' || c === '|') return bad('GRUPOS_O_ALTERNANCIA');
    else if (c === '?' || c === '*' || c === '+' || c === '{') return bad('CUANTIFICADOR_SIN_ATOMO');
    else if (c === '^' || c === '$' || c === '}' || c === ']') return bad('METACARACTER_SUELTO');
    else i++;   // literal o `.`
    const q = body[i]; if (q === undefined) continue;
    const choices = (lo: number, hi: number | null): number => (hi === null ? Math.max(1, maxLength - lo + 1) : Math.min(hi - lo + 1, maxLength + 1));
    if (q === '?') { i++; cost *= 2; }
    else if (q === '*') { i++; cost *= choices(0, null); } else if (q === '+') { i++; cost *= choices(1, null); }
    else if (q === '{') {
      const m = /^\{(\d{1,3})(?:(,)(\d{1,3})?)?\}/.exec(body.slice(i).join('')); if (!m) return bad('CUANTIFICADOR_INVALIDO');
      const lo = Number(m[1]); const hi = m[2] ? (m[3] === undefined ? null : Number(m[3])) : lo; if (lo > MAX_REPEAT || (hi !== null && (hi > MAX_REPEAT || hi < lo))) return bad('CUANTIFICADOR_INVALIDO');
      i += m[0].length; cost *= choices(lo, hi);
    }
    if (body[i] === '?' || body[i] === '+' || body[i] === '*' || body[i] === '{') return bad('CUANTIFICADOR_DOBLE_O_PEREZOSO');
    if (!Number.isFinite(cost) || cost > MAX_PATTERN_COST) return bad('COSTO_EXCESIVO');
  }
  return { ok: true, cost, items };
}

export class DictionaryError extends Error { constructor(readonly code: 'INVALID_DICTIONARY' | 'D06_NOT_RATIFIED', readonly issues: readonly string[] = []) { super(code); this.name = 'DictionaryError'; } }

/** Valida el diccionario como DATOS (sin compilarlo). Devuelve las incidencias (vacío = válido). Los mensajes citan rutas de campo, nunca valores de pedidos. */
export function validateDictionary(dictionary: ContractDictionary): string[] {
  const issues: string[] = []; let count = 0;
  if (!SCHEMA_VERSION.test(dictionary?.schemaVersion ?? '') || dictionary.schemaVersion === 'api01-draft-1') issues.push('schemaVersion: formato inválido o reservado');
  if (dictionary?.status !== 'PROPOSED' && dictionary?.status !== 'RATIFIED') issues.push('status: debe ser PROPOSED o RATIFIED');
  const walk = (fields: Readonly<Record<string, FieldDef>>, depth: number, path: string) => {
    if (depth > DICTIONARY_LIMITS.maxDepth) { issues.push(`${path || '/'}: profundidad máxima ${DICTIONARY_LIMITS.maxDepth}`); return; }
    for (const [name, def] of Object.entries(fields)) {
      const at = `${path}/${name}`; count++;
      if (!FIELD_NAME.test(name) || (depth === 1 && RESERVED_FIELDS.includes(name))) issues.push(`${at}: nombre inválido o reservado`);
      if (typeof def?.required !== 'boolean') issues.push(`${at}: «required» debe declararse de forma explícita`);
      switch (def?.type) {
        case 'string': {
          if (!Number.isInteger(def.max) || def.max < 1 || def.max > DICTIONARY_LIMITS.maxString) issues.push(`${at}: max fuera de 1..${DICTIONARY_LIMITS.maxString}`);
          if (def.min !== undefined && (!Number.isInteger(def.min) || def.min < 0 || def.min > def.max)) issues.push(`${at}: min inválido`);
          if (def.pattern !== undefined) {
            const verdict = analyzePattern(def.pattern, def.max);
            if (!verdict.ok) issues.push(`${at}: patrón no permitido (${verdict.reason}); lenguaje admitido: ^átomos con cuantificador$ sin grupos, alternancias ni referencias, costo ≤ ${MAX_PATTERN_COST}`);
            else try { new RegExp(def.pattern, 'u'); } catch { issues.push(`${at}: patrón no compila`); }
          }
          break;
        }
        case 'date': break;
        case 'enum': if (!Array.isArray(def.values) || def.values.length < 1 || def.values.length > DICTIONARY_LIMITS.maxEnumValues || def.values.some((v) => typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(v)) || new Set(def.values).size !== def.values.length) issues.push(`${at}: valores de enumeración inválidos`); break;
        case 'object': walk(def.fields ?? {}, depth + 1, at); break;
        case 'array': {
          if (!Number.isInteger(def.max) || def.max < 1 || def.max > DICTIONARY_LIMITS.maxArray) issues.push(`${at}: max fuera de 1..${DICTIONARY_LIMITS.maxArray}`);
          if (def.min !== undefined && (!Number.isInteger(def.min) || def.min < 0 || def.min > def.max)) issues.push(`${at}: min inválido`);
          if (def.items?.type === 'array') issues.push(`${at}: arreglos anidados no permitidos`);
          else if (def.items) walk({ item: def.items }, depth + 1, at);
          else issues.push(`${at}: falta la definición de los elementos`);
          if (def.uniqueBy !== undefined && !(def.items?.type === 'object' && def.items.fields?.[def.uniqueBy]?.type === 'string')) issues.push(`${at}: uniqueBy debe ser un campo de cadena de los elementos`);
          break;
        }
        default: issues.push(`${at}: tipo desconocido`);
      }
    }
  };
  walk(dictionary?.fields ?? {}, 1, '');
  if (count > DICTIONARY_LIMITS.maxFields) issues.push(`más de ${DICTIONARY_LIMITS.maxFields} campos`);
  return issues;
}

/** Cadena segura: NFC, recorte opcional, longitud en puntos de código, sin control/suplantación/sustitutos sueltos y con patrón opcional. */
function safeString(def: StringField): z.ZodType<string> {
  const pattern = def.pattern ? new RegExp(def.pattern, 'u') : null;
  return z.string().transform((raw, ctx) => {
    const value = def.trim ? raw.trim().normalize('NFC') : raw.normalize('NFC'); const length = [...value].length;
    const bad = (message: string) => { ctx.addIssue({ code: 'custom', message }); return z.NEVER; };
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) return bad('sustituto suelto');
    if (CONTROL.test(value) || SPOOF.test(value)) return bad('caracteres no permitidos');
    if (length > def.max) return bad('demasiado largo'); if (length < (def.min ?? (def.required ? 1 : 0))) return bad('demasiado corto');
    if (pattern && !pattern.test(value)) return bad('formato inválido');
    return value;
  });
}
function build(def: FieldDef): z.ZodType<unknown> {
  let schema: z.ZodType<unknown>;
  switch (def.type) {
    case 'string': schema = safeString(def); break;
    case 'date': schema = z.string().refine(isCalendarDate, 'fecha calendario inválida'); break;
    case 'enum': schema = z.enum(def.values as [string, ...string[]]); break;
    case 'object': schema = z.object(Object.fromEntries(Object.entries(def.fields).map(([k, f]) => [k, build(f)]))).strict(); break;
    case 'array': {
      let a = z.array(build(def.items)).max(def.max).min(def.min ?? (def.required ? 1 : 0));
      if (def.uniqueBy) { const key = def.uniqueBy; a = a.refine((items) => new Set((items as Array<Record<string, string>>).map((i) => i[key])).size === items.length, 'elementos repetidos'); }
      schema = a; break;
    }
  }
  return def.required ? schema : schema.optional();
}
function canon(def: FieldDef, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  switch (def.type) {
    case 'object': return Object.keys(def.fields).sort().map((k) => canon(def.fields[k], (value as Record<string, unknown>)[k]));
    case 'array': return (value as unknown[]).map((v) => canon(def.items, v));
    default: return value;
  }
}
/** Hash estable del diccionario (auditoría: qué contrato está cargado). */
export function dictionaryHash(dictionary: ContractDictionary): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v;
  return createHash('sha256').update(JSON.stringify(sort(dictionary))).digest('hex');
}
export type CompiledContract = Readonly<{ contract: OrderContractOptions; schemaVersion: string; status: 'PROPOSED' | 'RATIFIED'; hash: string }>;
/**
 * Compila el diccionario. Falla con `INVALID_DICTIONARY` (incidencias por ruta de campo) o `D06_NOT_RATIFIED` (diccionario RATIFIED sin D06 declarada). Los campos base `externalOrderId` y
 * `originClubReference` se imponen siempre (misma regla que el borrador API-01) y la identidad de contenido incluye TODOS los campos en orden estable, de modo que el mismo id con otro contenido da CONFLICT.
 */
export function compileContractDictionary(dictionary: ContractDictionary, options: { ratifiedDecisions: readonly string[]; refinements?: ReadonlyArray<{ message: string; test: (input: Record<string, unknown>) => boolean }> }): CompiledContract {
  const issues = validateDictionary(dictionary); if (issues.length) throw new DictionaryError('INVALID_DICTIONARY', issues);
  if (dictionary.status === 'RATIFIED' && !options.ratifiedDecisions.includes('D06')) throw new DictionaryError('D06_NOT_RATIFIED');
  const names = Object.keys(dictionary.fields).sort();
  let schema: z.ZodType<Record<string, unknown>> = z.object({
    schemaVersion: z.literal(dictionary.schemaVersion), externalOrderId: reference, originClubReference: reference.max(64),
    ...Object.fromEntries(names.map((k) => [k, build(dictionary.fields[k])])),
  }).strict();
  for (const r of options.refinements ?? []) schema = schema.refine(r.test, { message: r.message });
  const contract: OrderContractOptions = {
    orderSchema: schema as unknown as OrderContractOptions['orderSchema'],
    canonicalInput: (input) => { const o = input as unknown as Record<string, unknown>; return [o.schemaVersion, o.externalOrderId, o.originClubReference, ...names.map((k) => canon(dictionary.fields[k], o[k]))]; },
  };
  return Object.freeze({ contract, schemaVersion: dictionary.schemaVersion, status: dictionary.status, hash: dictionaryHash(dictionary) });
}

/** `lab-demo-1` expresado como diccionario (solo laboratorio): demuestra el mecanismo y fija la equivalencia con el esquema de laboratorio existente. NO es el contrato definitivo. */
export const LAB_DEMO_DICTIONARY: ContractDictionary = Object.freeze({
  schemaVersion: 'lab-demo-1', status: 'PROPOSED',
  fields: {
    recipient: { type: 'object', required: true, fields: { name: { type: 'string', required: true, trim: true, min: 1, max: TMS_LIMITS.placeNameMax } } },
    address: { type: 'string', required: true, trim: true, min: 1, max: TMS_LIMITS.stopReferenceMax },
    deliveryDate: { type: 'date', required: true },
    notes: { type: 'string', required: false, trim: true, max: 200 },
  },
} as const);
