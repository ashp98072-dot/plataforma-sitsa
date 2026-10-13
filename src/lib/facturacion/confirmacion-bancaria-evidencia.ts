import { createHash } from "crypto";
import { extname } from "path";
export const MAX_EVIDENCIA_BANCARIA = 10 * 1024 * 1024;
export function validarEvidenciaBancaria(buffer: Buffer, nombre: string, mime: string) {
  if (!buffer.length || buffer.length > MAX_EVIDENCIA_BANCARIA) throw new Error("La evidencia debe contener entre 1 byte y 10 MB.");
  const ext = extname(nombre).toLowerCase();
  const pdf = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const real = pdf ? "application/pdf" : png ? "image/png" : jpeg ? "image/jpeg" : null;
  if (!real || real !== mime || !(pdf ? ext === ".pdf" : png ? ext === ".png" : [".jpg", ".jpeg"].includes(ext))) throw new Error("El contenido, MIME y extensión de la evidencia no coinciden. Usa PDF, PNG o JPEG.");
  return { mime: real, tamano: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
}
