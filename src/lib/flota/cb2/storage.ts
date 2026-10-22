import { mkdir, open, realpath, lstat, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getUploadsRoot, validarRutaArchivoEmpresa, verificarDirectorioPadreReal } from "@/lib/uploads";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";
import { ErrorCB2, hash } from "./model";
async function seguro(empresa: number, ruta: string) {
    const abs = validarRutaArchivoEmpresa(empresa, ruta);
    if (!abs || !ruta.startsWith(`empresas/${empresa}/flota/cb2/`) || verificarDirectorioPadreReal(empresa, abs).estado !== "ok")
        throw new ErrorCB2("Evidencia privada no disponible.");
    const root = await realpath(getUploadsRoot()), parent = await realpath(path.dirname(abs));
    const esperado = path.join(root, "empresas", String(empresa), "flota", "cb2");
    // Rechazar tambien enlaces hacia OTRA empresa dentro de la misma raiz.
    if (parent !== esperado)
        throw new ErrorCB2("Directorio privado invalido.");
    return abs;
}
export async function guardar(empresa: number, buffer: Buffer) {
    await mkdir(getUploadsRoot(), { recursive: true });
    let dir = await realpath(getUploadsRoot());
    // No descender por enlaces de empresas/subdirectorios ni siquiera al crear
    // la carpeta: evitar escrituras previas a la verificacion del padre final.
    for (const segmento of ["empresas", String(empresa), "flota", "cb2"]) {
        dir = path.join(dir, segmento);
        try { await mkdir(dir); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        const st = await lstat(dir);
        if (!st.isDirectory() || st.isSymbolicLink()) throw new ErrorCB2("Directorio privado invalido.");
    }
    const ruta = `empresas/${empresa}/flota/cb2/${randomUUID()}.xlsx`, abs = await seguro(empresa, ruta);
    const f = await open(abs, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
        await f.writeFile(buffer);
    }
    finally {
        await f.close();
    }
    return ruta;
}
/** Solo la ruta nueva de ESTE intento, tras rollback confirmado o carrera perdida. */
export async function compensar(empresa: number, ruta: string) {
    try {
        const abs = await seguro(empresa, ruta), st = await lstat(abs);
        if (st.isFile() && !st.isSymbolicLink())
            await unlink(abs);
    }
    catch {
        // No falsear un commit correcto por fallo de limpieza. Reconciliacion posterior.
        console.warn("[combustibles-cb2] Evidencia nueva sin referencia pendiente de reconciliacion");
    }
}
export async function leer(empresa: number, ruta: string, sha: string) {
    const abs = await seguro(empresa, ruta), st = await lstat(abs);
    if (!st.isFile() || st.isSymbolicLink() || st.size <= 0 || st.size > MAX_UPLOAD_BYTES)
        throw new ErrorCB2("Evidencia privada ausente o invalida.");
    const f = await open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const stat = await f.stat();
        if (stat.size !== st.size || stat.ino !== st.ino || stat.dev !== st.dev)
            throw new ErrorCB2("Evidencia privada cambio durante lectura.");
        const buffer = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < buffer.length) {
            const r = await f.read(buffer, offset, buffer.length - offset, offset);
            if (!r.bytesRead)
                break;
            offset += r.bytesRead;
        }
        if (offset !== buffer.length || (await f.stat()).size !== stat.size || hash(buffer) !== sha)
            throw new ErrorCB2("Hash de evidencia incompatible.");
        return buffer;
    }
    finally {
        await f.close();
    }
}
