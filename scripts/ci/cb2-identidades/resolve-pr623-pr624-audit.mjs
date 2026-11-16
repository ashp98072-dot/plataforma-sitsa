// Solo resuelve los cinco solapamientos conocidos en una COPIA de auditoría.
// No ejecuta Git, SQL, red, commits ni publicaciones.
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.length !== 1) throw Error('Uso: node resolve-pr623-pr624-audit.mjs <copia-con-marcadores>');
const root = path.resolve(args[0]);
const files = ['src/lib/flota/cb2/service.ts', 'src/lib/flota/cb2/terceros.db.test.ts'];
const outputs = files.map(file => {
  const target = path.join(root, file);
  let count = 0;
  const source = fs.readFileSync(target, 'utf8');
  const result = source.replace(/^<<<<<<<[^\n]*\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>>[^\n]*\r?\n/gm, (_, a, b) => {
    count++;
    // Ambos imports y ambas pruebas completas deben conservarse.
    if (file.endsWith('terceros.db.test.ts') || count === 1) return a + b;
    // Conservar perfil de Shell y agregar la normalización de unidades.
    if (count === 2 && a.includes('perfil:string="HALEL"') && b.includes('originalesSeleccion')) return a + b.slice(b.indexOf('\n') + 1);
    // Conservar la comparación del piloto y aceptar IDs históricos equivalentes.
    if (count === 3 && a.includes('choice.decisionNombre') && a.includes('!== vehicle ||')) return a.replace('!== vehicle ||', '!== vehicle && !(vehicle>0 && equivalencias.get(vehicle)?.includes(Number(p.vehiculo_id))) ||');
    throw Error(`Solapamiento inesperado: ${file} #${count}`);
  });
  if (count !== (file.endsWith('service.ts') ? 3 : 2) || /^<<<<<<<|^=======|^>>>>>>>/m.test(result)) throw Error(`Inventario de conflictos distinto: ${file}`);
  return { target, result };
});
for (const { target, result } of outputs) fs.writeFileSync(target, result);
console.log('Cinco solapamientos resueltos en la copia de auditoría. Revisar diff antes de usar.');
