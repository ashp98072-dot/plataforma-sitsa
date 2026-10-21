import { inflateRawSync } from "node:zlib";
import { posix } from "node:path";
import { SaxesParser } from "saxes";
import { ErrorArchivoProveedor } from "./combustible-importacion-parser";

/** Solo v2: expansión real acotada, antes de entregar el ZIP a ExcelJS.
 * No extrae archivos al disco. Rechaza ZIP64, cifrado, entradas duplicadas, DTD y tamaños falsificados.
 */
export function leerOoxmlProveedor(buffer: Buffer): Map<string, Map<string, string>> {
  const fallo = () => new ErrorArchivoProveedor("Contenedor OOXML inválido o límites de expansión excedidos.");
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, buffer.length - 65557) || end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length) throw fallo();
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw fallo();
  const count = buffer.readUInt16LE(end + 10), directorySize = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (count > 2000 || count === 65535 || buffer.readUInt16LE(end + 8) !== count || start + directorySize !== end) throw fallo();
  const archivos = new Map<string, Buffer>(); let offset = start, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw fallo();
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const packed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24), local = buffer.readUInt32LE(offset + 42);
    const nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    if (offset + 46 + nameLength + extra + comment > end) throw fallo();
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if ((flags & 1) || ![0, 8].includes(method) || [packed, size, local].includes(0xffffffff) || local + 30 > start || archivos.has(name) || name.includes("..") || name.includes("\\") || name.startsWith("/")) throw fallo();
    if (buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 8) !== method) throw fallo();
    const localNameLength = buffer.readUInt16LE(local + 26), localExtra = buffer.readUInt16LE(local + 28);
    const body = local + 30 + localNameLength + localExtra;
    if (body + packed > start || body < local || (expanded += size) > 80 * 1024 * 1024) throw fallo();
    if (buffer.subarray(local + 30, local + 30 + localNameLength).toString("utf8") !== name) throw fallo();
    let data: Buffer;
    try { data = method === 0 ? buffer.subarray(body, body + packed) : inflateRawSync(buffer.subarray(body, body + packed), { maxOutputLength: Math.max(1, size) }); }
    catch { throw fallo(); }
    if (data.length !== size) throw fallo();
    if (/\.(xml|rels)$/i.test(name) && /<!DOCTYPE/i.test(data.toString("utf8"))) throw fallo();
    archivos.set(name, data);
    offset += 46 + nameLength + extra + comment;
  }
  if (offset !== end) throw fallo();
  const xml = (name: string, abrir: (tag: { name: string; attributes: Record<string, string> }) => void, texto?: (s: string) => void, cerrar?: (name: string) => void) => {
    const data = archivos.get(name); if (!data) throw fallo();
    const parser = new SaxesParser({ xmlns: false });
    parser.on("doctype", () => { throw fallo(); });
    parser.on("opentag", abrir); parser.on("text", s => texto?.(s)); parser.on("closetag", tag => cerrar?.(tag.name));
    try { parser.write(data.toString("utf8")).close(); } catch { throw fallo(); }
  };
  const relaciones = new Map<string, string>();
  xml("xl/_rels/workbook.xml.rels", tag => {
    if (tag.name.split(":").pop() !== "Relationship") return;
    if (tag.attributes.TargetMode === "External") return;
    const target = tag.attributes.Target;
    if (!target) throw fallo();
    relaciones.set(tag.attributes.Id, target.startsWith("/") ? target.slice(1) : posix.normalize(`xl/${target}`));
  });
  const hojas: { nombre: string; archivo: string }[] = [];
  xml("xl/workbook.xml", tag => {
    if (tag.name.split(":").pop() !== "sheet") return;
    const archivo = relaciones.get(tag.attributes["r:id"]);
    if (!archivo || !archivo.startsWith("xl/")) throw fallo();
    hojas.push({ nombre: tag.attributes.name, archivo });
  });
  const resultado = new Map<string, Map<string, string>>(); let totalFilas = 0;
  if (hojas.length > 20) throw fallo();
  let celdasCombinadas = 0;
  for (const hoja of hojas) {
    const valores = new Map<string, string>(); let direccion = "", numerica = false, capturar = false, valor = "", filas = 0;
    xml(hoja.archivo, tag => {
      const name = tag.name.split(":").pop();
      if (name === "row") {
        if (++filas > 5000 || ++totalFilas > 10000 || Number(tag.attributes.r) > 5000) throw fallo();
      }
      if (name === "c") {
        direccion = tag.attributes.r; numerica = !tag.attributes.t || tag.attributes.t === "n"; valor = "";
        // Evita asignaciones enormes de ExcelJS antes de que sus rowCount/columnCount puedan comprobarse.
        const m = /^([A-Z]{1,3})([1-9]\d{0,3})$/.exec(direccion ?? "");
        const col = m?.[1].split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
        if (!m || !col || col > 100 || Number(m[2]) > 5000) throw fallo();
      }
      if (name === "dimension" && tag.attributes.ref) {
        const last = tag.attributes.ref.split(":").pop()!;
        const m = /^([A-Z]{1,3})([1-9]\d{0,3})$/.exec(last);
        if (!m || Number(m[2]) > 5000 || m[1].split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) > 100) throw fallo();
      }
      if (name === "mergeCell") {
        const range = /^([A-Z]{1,3})([1-9]\d{0,3}):([A-Z]{1,3})([1-9]\d{0,3})$/.exec(tag.attributes.ref ?? "");
        if (!range) throw fallo();
        const col = (s: string) => s.split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
        const left = col(range[1]), right = col(range[3]), top = Number(range[2]), bottom = Number(range[4]);
        if (right > 100 || bottom > 5000 || right < left || bottom < top || (celdasCombinadas += (right - left + 1) * (bottom - top + 1)) > 10000) throw fallo();
      }
      if (name === "v") capturar = true;
    }, s => { if (capturar) valor += s; }, name => {
      if (name.split(":").pop() === "v") capturar = false;
      if (name.split(":").pop() === "c" && numerica && valor) valores.set(direccion, valor);
    });
    resultado.set(hoja.nombre, valores);
  }
  return resultado;
}
