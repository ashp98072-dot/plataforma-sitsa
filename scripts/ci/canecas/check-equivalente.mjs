// Solo normaliza diferencias léxicas demostrables; no simplifica expresiones.
// Las comillas de identificador solo se quitan para nombres no reservados conocidos.
const identificadores = new Set(['id', 'cantidad', 'capacidad', 'estado', 'confirmado_por', 'confirmado_en', 'fisico', 'reservado', 'modulos_json']);
const palabras = new Set([...identificadores, 'and', 'or', 'is', 'not', 'null', 'json_valid']);

function tokens(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  const out = [];
  let i = 0;
  while (i < texto.length) {
    const resto = texto.slice(i);
    const espacio = /^[ \t\r\n\f]+/.exec(resto);
    if (espacio) { i += espacio[0].length; continue; }
    if (resto.startsWith('--') || resto.startsWith('/*') || resto.startsWith('#')) return null;
    if (texto[i] === "'") {
      let j = i + 1, cerrado = false;
      while (j < texto.length) {
        if (texto[j] === '\\') return null; // Depende del modo SQL.
        if (texto[j] === "'") {
          if (texto[j + 1] === "'") { j += 2; continue; }
          j++; cerrado = true; break;
        }
        j++;
      }
      if (!cerrado) return null;
      out.push(['literal', texto.slice(i, j)]); i = j; continue;
    }
    if (texto[i] === '`') {
      const match = /^`([A-Za-z_][A-Za-z0-9_]*)`/.exec(resto);
      if (!match || !identificadores.has(match[1].toLowerCase())) return null;
      out.push(['palabra', match[1].toLowerCase()]); i += match[0].length; continue;
    }
    const palabra = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(resto);
    if (palabra) {
      if (!palabras.has(palabra[0].toLowerCase())) return null;
      out.push(['palabra', palabra[0].toLowerCase()]); i += palabra[0].length; continue;
    }
    const numero = /^\d+(?:\.\d+)?/.exec(resto);
    if (numero) {
      if (/^[A-Za-z_$]/.test(resto.slice(numero[0].length))) return null;
      out.push(['numero', numero[0]]); i += numero[0].length; continue;
    }
    const operador = /^(?:<=>|<=|>=|<>|!=|[=<>+*/%(),.-])/.exec(resto);
    if (!operador) return null;
    out.push(['signo', operador[0]]); i += operador[0].length;
  }
  let depth = 0;
  for (const [, valor] of out) {
    if (valor === '(') depth++;
    if (valor === ')' && --depth < 0) return null;
    // No se modifica profundidad para otros tokens.
    if (valor !== ')' && valor !== '(') continue;
  }
  if (depth !== 0) return null;
  while (out[0]?.[1] === '(' && out.at(-1)?.[1] === ')') {
    let nivel = 0, cierre = -1;
    for (let j = 0; j < out.length; j++) {
      if (out[j][1] === '(') nivel++;
      if (out[j][1] === ')' && --nivel === 0) { cierre = j; break; }
    }
    if (cierre !== out.length - 1) break;
    out.shift(); out.pop();
  }
  return out.length ? out : null;
}

export function checksEquivalentes(esperado, actual) {
  if (typeof esperado !== 'string' || typeof actual !== 'string') return false;
  if (esperado === actual && esperado.trim()) return true;
  const a = tokens(esperado), b = tokens(actual);
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}
