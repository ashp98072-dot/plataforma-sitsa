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
  const rows = await query<RowDataPacket[]>(
    "SELECT * FROM empresas WHERE activa = 1 ORDER BY nombre",
  );
  return rows.map(mapEmpresa);
}

export async function obtenerEmpresaPorId(id: number): Promise<Empresa | null> {
  const rows = await query<RowDataPacket[]>(
    "SELECT * FROM empresas WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ? mapEmpresa(rows[0]) : null;
}

export async function obtenerEmpresaPorSlug(
  slug: string,
): Promise<Empresa | null> {
  const rows = await query<RowDataPacket[]>(
    "SELECT * FROM empresas WHERE slug = ? LIMIT 1",
    [slug],
  );
  return rows[0] ? mapEmpresa(rows[0]) : null;
}

export async function empresasParaUsuario(input: {
  usuarioId: number;
  rol: RolGlobal;
  accesoTodas: boolean;
}): Promise<Empresa[]> {
  if (input.accesoTodas || rolVeTodasLasEmpresas(input.rol)) {
    return listarEmpresasActivas();
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT e.* FROM empresas e
     INNER JOIN usuario_empresa ue ON ue.empresa_id = e.id
     WHERE ue.usuario_id = ? AND e.activa = 1
     ORDER BY e.nombre`,
    [input.usuarioId],
  );
  return rows.map(mapEmpresa);
}
