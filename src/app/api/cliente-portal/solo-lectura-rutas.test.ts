import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Acceso de SOLO CONSULTA del Portal del Cliente: ninguna OTRA ruta autenticada del portal puede escribir información operativa. Esta prueba recorre TODAS las rutas del portal y obliga a que cualquier método que modifique
// estado esté en una lista explícita y justificada; una ruta de escritura nueva hace fallar la prueba hasta que alguien decida (y documente) si una cuenta de solo consulta puede usarla.
const root = path.resolve(__dirname);
const routes = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const f = path.join(dir, n); return statSync(f).isDirectory() ? routes(f) : n === 'route.ts' ? [f] : []; });
const rel = (f: string) => path.relative(root, f).replaceAll('\\', '/');
const methods = (text: string) => [...text.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);

/** Métodos que cambian estado y por qué NO modifican información operativa (o por qué exigen el guard de escritura). */
const MUTATING_ALLOWED: Record<string, { why: string; guard?: RegExp }> = {
  'auth/login/route.ts:POST': { why: 'público: abre la sesión; solo actualiza ultimo_acceso de la propia cuenta tras verificar la contraseña' },
  'auth/logout/route.ts:POST': { why: 'cierra la propia sesión (borra la cookie)' },
  'auth/activity/route.ts:POST': { why: 'renueva la cookie de la propia sesión; no escribe en la base de datos' },
  'auth/cambiar-password/route.ts:POST': { why: 'cambia SOLO la contraseña de la propia cuenta (empresa + cliente + usuario de la sesión)', guard: /requireClienteSession\(\)/ },
  'solicitudes/route.ts:POST': { why: 'crea solicitudes: modifica información operativa → exige requireClienteEscritura', guard: /requireClienteEscritura\(\)/ },
};

describe('Portal del Cliente — cuentas de solo consulta y rutas de escritura', () => {
  const files = routes(root);
  it('todo método que cambia estado está en la lista justificada; PUT/PATCH/DELETE no existen en el portal', () => {
    const found: string[] = [];
    for (const f of files) for (const m of methods(readFileSync(f, 'utf8'))) { if (['PUT', 'PATCH', 'DELETE'].includes(m)) found.push(`${rel(f)}:${m}`); if (m === 'POST') found.push(`${rel(f)}:POST`); }
    expect(found.sort(), 'ruta de escritura nueva en el portal: decidir y documentar si una cuenta de solo consulta puede usarla').toEqual(Object.keys(MUTATING_ALLOWED).sort());
  });
  it('la creación de solicitudes usa el guard de escritura y NO el de consulta; las demás rutas protegidas usan requireClienteSession', () => {
    const post = readFileSync(path.join(root, 'solicitudes/route.ts'), 'utf8'); const postBody = post.slice(post.indexOf('export async function POST'));
    expect(postBody).toMatch(/requireClienteEscritura\(\)/); expect(postBody).not.toMatch(/requireClienteSession\(\)/);
    for (const [key, v] of Object.entries(MUTATING_ALLOWED)) if (v.guard) { const t = readFileSync(path.join(root, key.split(':')[0]), 'utf8'); expect(t, key).toMatch(v.guard); }
    for (const f of files.filter((x) => !/auth\//.test(rel(x)))) { const t = readFileSync(f, 'utf8'); expect(t, rel(f)).toMatch(/requireClienteSession\(\)|requireClienteEscritura\(\)/); }
  });
  it('ninguna ruta GET del portal escribe en la base de datos, y no hay server actions ni otras rutas que usen la cookie del cliente fuera del portal', () => {
    for (const f of files) { const t = readFileSync(f, 'utf8'); const getBody = /export async function GET[\s\S]*?(?=\nexport async function |$)/.exec(t)?.[0] ?? ''; expect(getBody, rel(f)).not.toMatch(/\b(execute|INSERT|UPDATE|DELETE)\b|crearSolicitudCliente|cambiarPassword/); }
    const pagesDir = path.resolve(__dirname, '../../cliente-portal'); const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const f = path.join(d, n); return statSync(f).isDirectory() ? walk(f) : /\.tsx?$/.test(n) ? [f] : []; });
    for (const f of walk(pagesDir)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/['"]use server['"]/);
    const outside = (d: string): string[] => readdirSync(d).flatMap((n) => { const f = path.join(d, n); return statSync(f).isDirectory() ? outside(f) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [f] : []; });
    const apiRoot = path.resolve(__dirname, '..'); const holders = outside(apiRoot).filter((f) => !f.startsWith(root) && /getClienteSession|requireClienteSession|requireClienteEscritura|sitsa_cliente_session/.test(readFileSync(f, 'utf8')));
    expect(holders.map((f) => path.relative(apiRoot, f))).toEqual([]);
  });
});
