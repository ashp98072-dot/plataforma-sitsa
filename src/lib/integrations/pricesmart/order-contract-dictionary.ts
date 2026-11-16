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
// profundidad ≤ 3, ≤ 40 campos, cadenas ≤ 2000, arreglos ≤ 50 elementos, patrones acotados y anclados.

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
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]|\\[1-9]/;   // heurística contra patrones de retroceso catastrófico y referencias hacia atrás

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
            if (def.pattern.length > DICTIONARY_LIMITS.maxPattern || !def.pattern.startsWith('^') || !def.pattern.endsWith('$') || NESTED_QUANTIFIER.test(def.pattern)) issues.push(`${at}: patrón no permitido (anclado ^…$, ≤ ${DICTIONARY_LIMITS.maxPattern}, sin cuantificadores anidados ni referencias)`);
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
