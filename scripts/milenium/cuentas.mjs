// Analizador limitado al catálogo VFP observado. No importa ni modifica datos.
export const FUENTES = Object.freeze({
  KT: { codigo: "01", carpeta: "BASES001", identidad: "KUIQ", uso: "actual" },
  MONACO: { codigo: "08", carpeta: "BASES008", identidad: "MONACO", uso: "actual" },
  MONACO_HISTORICO: { codigo: "00", carpeta: "BASES000", identidad: "MONACO", uso: "historico_separado" },
});

const normalizar = (texto) => texto.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

/** Solo VFP 0x30 / Windows-1252; rechaza formatos no verificados, no interpreta FPT. */
export function leerDbf(buffer, seleccion) {
  if (buffer.length < 33 || buffer.length > 32 * 1024 * 1024) throw new Error("Tamaño DBF no admitido.");
  if (buffer[0] !== 0x30 || buffer[29] !== 0x03) throw new Error("Versión o codificación DBF no verificada.");
  const cantidad = buffer.readUInt32LE(4);
  const inicio = buffer.readUInt16LE(8);
  const largo = buffer.readUInt16LE(10);
  if (inicio < 33 || inicio > buffer.length || largo < 1 || inicio + cantidad * largo > buffer.length) throw new Error("DBF incompleto o cabecera inválida.");
  const campos = new Map();
  let offset = 1;
  let fin = false;
  for (let p = 32; p < inicio; p += 32) {
    if (buffer[p] === 13) { fin = true; break; }
    if (p + 32 > inicio) throw new Error("Descriptor DBF incompleto.");
    const nombre = buffer.toString("ascii", p, p + 11).replace(/\0.*$/, "");
    const longitud = buffer[p + 16];
    if (!/^[A-Z0-9_]+$/i.test(nombre) || !longitud || campos.has(nombre)) throw new Error("Descriptor DBF inválido.");
    campos.set(nombre, { offset, longitud, tipo: String.fromCharCode(buffer[p + 11]), decimales: buffer[p + 17], flags: buffer[p + 18] });
    offset += longitud;
  }
  if (!fin || offset !== largo) throw new Error("Longitud de campos DBF inconsistente.");
  for (const [nombre, tipo] of Object.entries(seleccion)) {
    const campo = campos.get(nombre);
    if (!campo || campo.tipo !== tipo || campo.flags !== 0 || (tipo === "N" && campo.decimales !== 0) || (tipo === "L" && campo.longitud !== 1) || !["C", "N", "L"].includes(tipo)) {
      throw new Error(`Campo no compatible: ${nombre}.`);
    }
  }
  const decoder = new TextDecoder("windows-1252", { fatal: true });
  const filas = [];
  let eliminadas = 0;
  for (let n = 0; n < cantidad; n++) {
    const p = inicio + n * largo;
    if (buffer[p] === 42) { eliminadas++; continue; }
    if (buffer[p] !== 32) throw new Error("Marca de registro DBF inválida.");
    const fila = {};
    for (const [nombre, tipo] of Object.entries(seleccion)) {
      const campo = campos.get(nombre);
      const valor = decoder.decode(buffer.subarray(p + campo.offset, p + campo.offset + campo.longitud)).trimEnd();
      if (tipo === "C") fila[nombre] = valor;
      else if (tipo === "N") {
        if (valor.trim() === "") fila[nombre] = null;
        else if (!/^[+-]?\d+$/.test(valor.trim()) || !Number.isSafeInteger(Number(valor))) throw new Error(`Número DBF inválido: ${nombre}.`);
        else fila[nombre] = Number(valor);
      } else {
        const logico = valor.toUpperCase();
        if (["T", "Y"].includes(logico)) fila[nombre] = true;
        else if (["F", "N"].includes(logico)) fila[nombre] = false;
        else if (["", "?"].includes(logico)) fila[nombre] = null;
        else throw new Error(`Lógico DBF inválido: ${nombre}.`);
      }
    }
    filas.push(fila);
  }
  return { declaradas: cantidad, eliminadas, filas };
}

export function analizarCuentas(empresa, empresasBuffer, cuentasBuffer) {
  if (!Object.hasOwn(FUENTES, empresa)) throw new Error("Empresa origen no admitida.");
  const fuente = FUENTES[empresa];
  const registro = leerDbf(empresasBuffer, { CODIGO_EMP: "C", NOMBRE_EMP: "C", RAZON_EMP: "C" });
  const coincidencias = registro.filas.filter((fila) => fila.CODIGO_EMP === fuente.codigo);
  if (coincidencias.length !== 1 || !normalizar(`${coincidencias[0].NOMBRE_EMP} ${coincidencias[0].RAZON_EMP}`).includes(fuente.identidad)) {
    throw new Error("La identidad de la empresa no coincide con el mapeo aprobado.");
  }
  const catalogo = leerDbf(cuentasBuffer, { CODIGO_CTA: "C", NOMBRE_CTA: "C", TIPO_CTA: "N", NIVEL_CTA: "N", LINACTIVA_: "L", CTACOM_CTA: "L", MULTIP_CTA: "N" });
  const codigos = new Set();
  const incidencias = { codigo_vacio: 0, nombre_vacio: 0, codigo_largo: 0, nombre_largo: 0, codigo_con_espacios: 0, duplicado_normalizado: 0, nivel_invalido: 0, estado_desconocido: 0 };
  const tipos = {};
  const niveles = {};
  // FASE3-HOMOLOGACION-CATALOGO: mismo patrón de distribución que
  // tipos/niveles, ahora también para CTACOM_CTA y MULTIP_CTA — se leían
  // desde Fase 1 pero nunca se reportaba su distribución. Solo conteos por
  // valor, nunca qué cuenta concreta tiene cada valor.
  const ctacom = {};
  const multip = {};
  let inactivas = 0;
  for (const fila of catalogo.filas) {
    const codigo = fila.CODIGO_CTA;
    if (!codigo.trim()) incidencias.codigo_vacio++;
    if (!fila.NOMBRE_CTA.trim()) incidencias.nombre_vacio++;
    if (codigo.length > 40) incidencias.codigo_largo++;
    if (fila.NOMBRE_CTA.length > 200) incidencias.nombre_largo++;
    if (codigo !== codigo.trim()) incidencias.codigo_con_espacios++;
    const clave = normalizar(codigo.trim());
    if (codigos.has(clave)) incidencias.duplicado_normalizado++;
    codigos.add(clave);
    if (!Number.isInteger(fila.NIVEL_CTA) || fila.NIVEL_CTA < 1) incidencias.nivel_invalido++;
    if (fila.LINACTIVA_ === null) incidencias.estado_desconocido++;
    if (fila.LINACTIVA_ === true) inactivas++;
    const tipo = fila.TIPO_CTA === null ? "sin_valor" : String(fila.TIPO_CTA);
    const nivel = fila.NIVEL_CTA === null ? "sin_valor" : String(fila.NIVEL_CTA);
    const ctacomValor = fila.CTACOM_CTA === null ? "sin_valor" : String(fila.CTACOM_CTA);
    const multipValor = fila.MULTIP_CTA === null ? "sin_valor" : String(fila.MULTIP_CTA);
    tipos[tipo] = (tipos[tipo] ?? 0) + 1;
    niveles[nivel] = (niveles[nivel] ?? 0) + 1;
    ctacom[ctacomValor] = (ctacom[ctacomValor] ?? 0) + 1;
    multip[multipValor] = (multip[multipValor] ?? 0) + 1;
  }
  // No devuelve cuentas, nombres, movimientos ni rutas de archivos al informe.
  return {
    modo: "SOLO_LECTURA", origen: { empresa, codigo: fuente.codigo, carpeta: fuente.carpeta, uso: fuente.uso },
    registros: { declarados: catalogo.declaradas, vigentes: catalogo.filas.length, marcados_borrados: catalogo.eliminadas, inactivos: inactivas },
    tipos_origen: tipos, niveles_origen: niveles, ctacom_origen: ctacom, multip_origen: multip, incidencias,
    listo_para_importar: false,
    // "Definir entidad contable destino" se retiró de esta lista: el modelo
    // (entidad_id por KT/Mónaco) ya se definió y aplicó en producción en
    // trabajo posterior (ver docs/CONTABILIDAD-C2-TRANSICION.md y
    // docs/CONTABILIDAD-C3A-CAPTURA.md) — repetirlo aquí como pendiente
    // afirmaría como abierta una decisión ya resuelta.
    pendientes: ["Asociar el catálogo importado a la entidad contable ya definida (KT/Mónaco vía entidad_id) — no crear un modelo de identidad nuevo.", "Homologar TIPO_CTA, MULTIP_CTA y CTACOM_CTA con Contabilidad; no inferir por número.", "Validar jerarquía, cuentas de movimiento y naturaleza de saldos.", "Diseñar la estrategia transaccional/idempotente del importador masivo (distinta de la transacción ya existente para un asiento manual).", "Comparar contra catálogo destino y conciliar antes de cualquier escritura."],
  };
}
