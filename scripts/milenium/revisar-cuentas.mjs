import { open } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { analizarCuentas, FUENTES } from "./cuentas.mjs";

// Sin conexión SQL, sin variables de credenciales, sin escritura ni llamadas de red.
async function leerEstable(archivo) {
  const handle = await open(archivo, "r");
  try {
    const antes = await handle.stat();
    if (!antes.isFile() || antes.size > 32 * 1024 * 1024) throw new Error("Archivo fuera del límite admitido.");
    const buffer = await handle.readFile();
    const despues = await handle.stat();
    if (antes.size !== despues.size || antes.mtimeMs !== despues.mtimeMs || buffer.length !== antes.size) throw new Error("El archivo cambió durante la lectura. Usa una copia estable.");
    return buffer;
  } finally { await handle.close(); }
}

try {
  const [raiz, empresa, ...extra] = process.argv.slice(2);
  if (!raiz || !path.isAbsolute(raiz) || !Object.hasOwn(FUENTES, empresa ?? "") || extra.length) {
    throw new Error("Uso: node scripts/milenium/revisar-cuentas.mjs RUTA_ABSOLUTA KT|MONACO|MONACO_HISTORICO");
  }
  const fuente = FUENTES[empresa];
  const empresas = await leerEstable(path.join(raiz, "s02.dbf"));
  const cuentas = await leerEstable(path.join(raiz, fuente.carpeta, "co01.dbf"));
  const informe = analizarCuentas(empresa, empresas, cuentas);
  informe.huella_sha256 = {
    empresas: createHash("sha256").update(empresas).digest("hex"),
    cuentas: createHash("sha256").update(cuentas).digest("hex"),
  };
  console.log(JSON.stringify(informe, null, 2));
} catch (error) {
  // Los errores del SO pueden incluir rutas privadas. No imprimir rutas ni registros.
  console.error(error?.code ? "No se pudo leer el origen. Verifica acceso y copia estable." : error.message);
  process.exitCode = 1;
}
