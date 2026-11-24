// Interpreta SHOW GRANTS FOR CURRENT_USER. En MariaDB el nombre de base de una
// concesión a nivel de base es un patrón: `\_` y `\%` son literales, mientras
// que `_` (un carácter) y `%` (cualquier cadena) sin escapar son comodines.
// Solo se acepta la concesión cuando su cobertura de la base real está
// demostrada: coincidencia exacta carácter a carácter, donde un `_` sin escapar
// solo puede cubrir un único carácter. Los patrones con `%` sin escapar se
// rechazan (cobertura amplia no demostrable); así no se amplían permisos.
const GRANT = /^GRANT\s+([\s\S]+?)\s+ON\s+(\*\.\*|`(?:[^`\\]|``|\\[\s\S])*`\.\*)\s+TO\s/i;

export function patronCubreBase(objeto, base) {
  const interior = objeto.slice(1, -3); // sin comillas iniciales ni "`.*"
  const patron = [];
  for (let i = 0; i < interior.length; i++) {
    const c = interior[i];
    if (c === '`' && interior[i + 1] === '`') { patron.push({ literal: '`' }); i++; }
    else if (c === '\\') {
      const n = interior[i + 1];
      if (!['_', '%', '\\'].includes(n)) return false; // escape desconocido: no se interpreta
      patron.push({ literal: n }); i++;
    } else if (c === '%') return false;
    else if (c === '_') patron.push({ cualquiera: true });
    else patron.push({ literal: c });
  }
  const real = [...String(base)];
  return patron.length === real.length && patron.every((p, i) => p.cualquiera || p.literal === real[i]);
}

export function privilegiosDirectos(grants, base) {
  const permisos = new Set();
  for (const row of grants ?? []) {
    const match = GRANT.exec(String(Object.values(row)[0]));
    if (!match) continue;
    const [, lista, objeto] = match;
    if (objeto !== '*.*' && !patronCubreBase(objeto, base)) continue;
    for (const item of lista.split(',')) permisos.add(item.trim().toUpperCase());
  }
  return permisos;
}
