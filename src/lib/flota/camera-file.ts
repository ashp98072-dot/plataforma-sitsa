/** Normaliza fotos de cámara móvil (a veces File.size llega en 0). */

export async function normalizarFotoCamara(
  file: File | Blob | null | undefined,
  nombreBase = "foto",
): Promise<File | null> {
  if (!file) return null;

  const type =
    (file.type && file.type.startsWith("image/") ? file.type : "") ||
    "image/jpeg";
  const name =
    file instanceof File && file.name
      ? file.name
      : `${nombreBase}_${Date.now()}.jpg`;

  if (file.size > 0) {
    return file instanceof File
      ? file
      : new File([file], name, { type: file.type || type });
  }

  try {
    const buf = await file.arrayBuffer();
    if (!buf.byteLength) return null;
    return new File([buf], name, { type });
  } catch {
    return null;
  }
}

export async function normalizarFotosCamara(
  files: ArrayLike<File> | File[],
  nombreBase = "foto",
): Promise<File[]> {
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const n = await normalizarFotoCamara(files[i], `${nombreBase}_${i + 1}`);
    if (n) out.push(n);
  }
  return out;
}
