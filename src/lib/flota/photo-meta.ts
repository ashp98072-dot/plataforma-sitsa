/** Marca fecha, hora y GPS en la foto (cliente / canvas). */

export type GeoCoords = { lat: number; lng: number } | null;

export function obtenerGps(
  timeoutMs = 8000,
  opts?: { altaPrecision?: boolean },
): Promise<GeoCoords> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  const alta = opts?.altaPrecision ?? timeoutMs >= 4000;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      () => resolve(null),
      {
        enableHighAccuracy: alta,
        timeout: timeoutMs,
        // Reutilizar fix reciente acelera registros manuales en Hostinger.
        maximumAge: alta ? 90_000 : 180_000,
      },
    );
  });
}

function formatearAhora(): string {
  return new Date().toLocaleString("es-GT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export async function fotoConMarca(
  file: File,
  opts: {
    etiqueta: string;
    geo?: GeoCoords;
  },
): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxW = 1600;
    const scale = Math.min(1, maxW / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const geo = opts.geo;
    const lines = [
      opts.etiqueta,
      formatearAhora(),
      geo
        ? `Ubicación: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`
        : "Ubicación: no disponible",
    ];

    const pad = 10;
    const lineH = Math.max(16, Math.round(h * 0.028));
    const barH = pad * 2 + lineH * lines.length;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(0, h - barH, w, barH);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${lineH - 2}px sans-serif`;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      ctx.fillText(line, pad, h - barH + pad + i * lineH, w - pad * 2);
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.88),
    );
    if (!blob || blob.size < 100) return file;
    const base = (file.name || "foto").replace(/\.[^.]+$/, "") || "foto";
    return new File([blob], `${base}_marcado.jpg`, { type: "image/jpeg" });
  } catch {
    // HEIC u otros formatos: subir original sin marca
    return file;
  }
}

export async function marcarVarias(
  files: File[],
  etiqueta: string,
  geo?: GeoCoords,
): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    if (!f || f.size <= 0) continue;
    out.push(await fotoConMarca(f, { etiqueta, geo }));
  }
  return out.length ? out : files.filter((f) => f && f.size > 0);
}
