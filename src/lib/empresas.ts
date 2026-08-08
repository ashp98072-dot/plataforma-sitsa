import type { RowDataPacket } from "mysql2";
import { query } from "./db";
import { rolVeTodasLasEmpresas, type RolGlobal } from "./roles";

export type Empresa = {
  id: number;
  codigo: string;
  nombre: string;
  slug: string;
  logoUrl: string | null;
  activa: boolean;
  modulos: string[];
};

/** Caché de lectura de empresas (Hostinger): menos hits a MySQL al navegar. */
const TTL_MS = 180_000;
const slugCache = new Map<string, { at: number; data: Empresa | null }>();
const idCache = new Map<number, { at: number; data: Empresa | null }>();
const activasCache: { at: number; data: Empresa[] | null } = {
  at: 0,
  data: null,
};
const userEmpresasCache = new Map<string, { at: number; data: Empresa[] }>();

function mapEmpresa(r: RowDataPacket): Empresa {
  let modulos: string[] = [];
  try {
    modulos = r.modulos_json
      ? typeof r.modulos_json === "string"
        ? JSON.parse(r.modulos_json)
        : (r.modulos_json as string[])
      : [];
  } catch {
    modulos = [];
  }
  return {
    id: Number(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    slug: String(r.slug),
    logoUrl: r.logo_url ? String(r.logo_url) : null,
    activa: Boolean(r.activa),
    modulos,
  };
}

export async function listarEmpresasActivas(): Promise<Empresa[]> {
  if (activasCache.data && Date.now() - activasCache.at < TTL_MS) {
    return activasCache.data;
  }
  const rows = await query<RowDataPacket[]>(
    "SELECT id, codigo, nombre, slug, logo_url, activa, modulos_json FROM empresas WHERE activa = 1 ORDER BY nombre",
  );
  const data = rows.map(mapEmpresa);
  activasCache.at = Date.now();
  activasCache.data = data;
  return data;
}

export async function obtenerEmpresaPorId(id: number): Promise<Empresa | null> {
  const hit = idCache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const rows = await query<RowDataPacket[]>(
    "SELECT id, codigo, nombre, slug, logo_url, activa, modulos_json FROM empresas WHERE id = ? LIMIT 1",
    [id],
  );
  const data = rows[0] ? mapEmpresa(rows[0]) : null;
  idCache.set(id, { at: Date.now(), data });
  if (data) slugCache.set(data.slug, { at: Date.now(), data });
  return data;
}

export async function obtenerEmpresaPorSlug(
  slug: string,
): Promise<Empresa | null> {
  const hit = slugCache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const rows = await query<RowDataPacket[]>(
    "SELECT id, codigo, nombre, slug, logo_url, activa, modulos_json FROM empresas WHERE slug = ? LIMIT 1",
    [slug],
  );
  const data = rows[0] ? mapEmpresa(rows[0]) : null;
  slugCache.set(slug, { at: Date.now(), data });
  if (data) idCache.set(data.id, { at: Date.now(), data });
  return data;
}

export async function empresasParaUsuario(input: {
  usuarioId: number;
  rol: RolGlobal;
  accesoTodas: boolean;
}): Promise<Empresa[]> {
  if (input.accesoTodas || rolVeTodasLasEmpresas(input.rol)) {
    return listarEmpresasActivas();
  }
  const key = String(input.usuarioId);
  const hit = userEmpresasCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const rows = await query<RowDataPacket[]>(
    `SELECT e.id, e.codigo, e.nombre, e.slug, e.logo_url, e.activa, e.modulos_json
     FROM empresas e
     INNER JOIN usuario_empresa ue ON ue.empresa_id = e.id
     WHERE ue.usuario_id = ? AND e.activa = 1
     ORDER BY e.nombre`,
    [input.usuarioId],
  );
  const data = rows.map(mapEmpresa);
  userEmpresasCache.set(key, { at: Date.now(), data });
  return data;
}
