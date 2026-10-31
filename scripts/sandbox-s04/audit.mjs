// Source inventory only: never imports application modules or opens a socket.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const sha = text => crypto.createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
export function statements(source) {
  source = source.replaceAll('\r\n', '\n'); // Same reviewed plan on Windows and Linux.
  let clean = '', quote = '', comment = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') { comment = ''; clean += '\n'; }
      else if (comment === 'block' && c === '*' && n === '/') { comment = ''; clean += '  '; i++; }
      else clean += c === '\n' ? '\n' : ' ';
    } else if (quote) {
      clean += c;
      if (c === '\\') { clean += source[++i] ?? ''; }
      else if (c === quote) { if (n === quote) clean += source[++i]; else quote = ''; }
    } else if (c === '#' || (c === '-' && n === '-' && /\s/.test(source[i + 2] ?? ' '))) { comment = 'line'; clean += ' '; }
    else if (c === '/' && n === '*') { comment = 'block'; clean += '  '; i++; }
    else { if (['\x27', '"', '`'].includes(c)) quote = c; clean += c; }
  }
  if (quote || comment === 'block') throw new Error('S04_SQL_UNTERMINATED');
  const result = []; let start = 0; quote = '';
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) { if (clean[i + 1] === quote) i++; else quote = ''; } }
    else if (['\x27', '"', '`'].includes(c)) quote = c;
    else if (c === ';') { const sql = clean.slice(start, i).trim(); if (sql) result.push({ sql, line: source.slice(0, start + clean.slice(start, i).search(/\S/)).split('\n').length }); start = i + 1; }
  }
  if (clean.slice(start).trim()) result.push({ sql: clean.slice(start).trim(), line: source.slice(0, start + clean.slice(start).search(/\S/)).split('\n').length });
  return result;
}
export function parts(body) {
  const out = []; let depth = 0, quote = '', start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) { if (body[i + 1] === quote) i++; else quote = ''; } }
    else if (['\x27', '"', '`'].includes(c)) quote = c;
    else if (c === '(') depth++; else if (c === ')') depth--;
    else if (c === ',' && !depth) { out.push(body.slice(start, i).trim()); start = i + 1; }
  }
  out.push(body.slice(start).trim()); return out;
}
const cols = text => text.split(',').map(s => s.trim().replaceAll('`', ''));
export function foreignKeys(sql) {
  return [...sql.matchAll(/(?:CONSTRAINT\s+`?(\w+)`?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`?(\w+)`?\s*\(([^)]+)\)/gi)]
    .map(m => ({ name: m[1] ?? null, columns: cols(m[2]), target: m[3], targetColumns: cols(m[4]) }));
}
export function schemaTables(source) {
  return statements(source).flatMap(({ sql, line }) => {
    const m = /^CREATE TABLE(?: IF NOT EXISTS)?\s+`?(\w+)`?\s*\(([\s\S]*)\)\s*ENGINE=InnoDB[\s\S]*$/i.exec(sql);
    if (!m) return [];
    const entries = parts(m[2]), columns = entries.filter(s => !/^(CONSTRAINT|PRIMARY|UNIQUE|KEY|INDEX|CHECK|FOREIGN)\b/i.test(s)).map(s => ({ name: /^`?(\w+)/.exec(s)[1], definition: s }));
    const indexes = entries.filter(s => /^(PRIMARY|UNIQUE|KEY|INDEX)\b/i.test(s));
    for (const c of columns) {
      if (/\bPRIMARY KEY\b/i.test(c.definition)) indexes.push(`PRIMARY KEY (${c.name})`);
      else if (/\bUNIQUE\b/i.test(c.definition)) indexes.push(`UNIQUE KEY (${c.name})`);
    }
    return [{ name: m[1], line, sha256: sha(sql), columns, indexes, foreignKeys: foreignKeys(sql), sql }];
  });
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
export function audit() {
  const source = fs.readFileSync(path.join(repo, 'sql/schema.sql'), 'utf8');
  const tables = schemaTables(source), alters = statements(source).filter(s => /^ALTER TABLE /i.test(s.sql));
  const baselineNames = new Set(tables.map(t => t.name)), additionalDefinitions = [];
  function recordAdditional(text, file, baseLine = 1) {
    for (const t of schemaTables(text)) if (!baselineNames.has(t.name)) {
      const definition = { ...t, file, line: t.line + baseLine - 1 }; delete definition.sql; additionalDefinitions.push(definition);
    }
  }
  const sqlFiles = walk(path.join(repo, 'sql')).filter(f => f.endsWith('.sql')).sort().map(file => {
    const text = fs.readFileSync(file, 'utf8');
    recordAdditional(text, path.relative(repo, file).replaceAll('\\', '/'));
    // DELIMITER/procedure files are listed with hash; splitting is lexical, not a server parser.
    return { file: path.relative(repo, file).replaceAll('\\', '/'), sha256: sha(text), delimiter: /\bDELIMITER\b/i.test(text),
      sites: statements(text).filter(s => /^(CREATE|ALTER|DROP|RENAME|PREPARE|EXECUTE|SET)\b/i.test(s.sql)).map(s => ({ line: s.line, operation: s.sql.split(/\s+/).slice(0, 3).join(' '), tables: [...s.sql.matchAll(/(?:TABLE(?: IF NOT EXISTS)?|REFERENCES)\s+`?(\w+)/gi)].map(m => m[1]) })) };
  });
  const runtime = [], crossSchema = [], schemaCalls = [];
  for (const file of walk(path.join(repo, 'src')).filter(f => /\.[cm]?[jt]sx?$/.test(f) && !/\.test\./.test(f))) {
    const text = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && /(?:asegurar|ensure).*?(?:Schema|Esquema|Column)/i.test(node.expression.getText(ast))) schemaCalls.push({ file: path.relative(repo, file).replaceAll('\\', '/'), line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1, callee: node.expression.getText(ast) });
      if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
        const value = ts.isTemplateExpression(node) ? node.getText(ast).slice(1, -1) : node.text;
        if (ts.isExpressionStatement(node.parent) && ['use client', 'use server', 'use strict'].includes(value)) return;
        if (!ts.isTemplateExpression(node) && /^\s*CREATE TABLE/i.test(value)) recordAdditional(value, path.relative(repo, file).replaceAll('\\', '/'), ast.getLineAndCharacterOfPosition(node.getStart()).line + 1);
        const qualified = [...value.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+`?(\w+)`?\s*\.\s*`?(\w+)`?/gi)].map(m => ({ schema: m[1], table: m[2] }));
        if (qualified.length) crossSchema.push({ file: path.relative(repo, file).replaceAll('\\', '/'), line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1, qualified });
        const ddl = /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX|INFORMATION_SCHEMA\.\w+|SHOW\s+COLUMNS)/i.exec(value) ?? /^\s*(USE\s+`?\w+`?)\s*;?\s*$/i.exec(value);
        if (ddl) runtime.push({ file: path.relative(repo, file).replaceAll('\\', '/'), line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1, operation: ddl[1].toUpperCase(), dynamic: ts.isTemplateExpression(node), tables: [...value.matchAll(/(?:TABLE(?: IF NOT EXISTS)?|REFERENCES)\s+`?(\w+)/gi)].map(m => m[1]) });
      }
      ts.forEachChild(node, visit);
    } visit(ast);
  }
  return { kind: 'STATIC_SOURCE_NOT_LIVE_DATABASE', schemaSha256: sha(source), tables: tables.map(t => { const table = { ...t }; delete table.sql; return table; }),
    deferredAlters: alters.map(s => ({ line: s.line, table: /^ALTER TABLE\s+`?(\w+)/i.exec(s.sql)[1], sha256: sha(s.sql), foreignKeys: foreignKeys(s.sql), indexes: parts(s.sql.replace(/^ALTER TABLE\s+`?\w+`?/i, '')).filter(p => /^ADD\s+(?:INDEX|KEY|UNIQUE)/i.test(p)) })), sqlFiles, runtime, schemaCalls, crossSchema, additionalDefinitions,
    limits: ['No live schema inspection', 'AST string candidates; dynamic SQL/import/call graph requires review', 'Migration order is not inferred from filenames', 'Executable version comments/procedures need native S06 review'] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = audit();
  if (process.argv[2] === '--write') fs.writeFileSync(path.join(repo, 'docs/integraciones/pricesmart/s04/schema-inventory.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ kind: result.kind, tables: result.tables.length, sqlFiles: result.sqlFiles.length, runtimeSites: result.runtime.length }));
}
