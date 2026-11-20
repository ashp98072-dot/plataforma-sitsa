import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantFacturacion } from '@/lib/tenant';
import { listarPermisosUsuario, permisosEfectivos } from '@/lib/permisos';
import { tieneAccionCatalogo } from '@/lib/permisos-catalogo';
import { guardarPerfilCredito, obtenerPerfilCredito, respuestaErrorCredito, ErrorCredito } from './credito';

const id = z.coerce.number().int().positive().max(2147483647);
export async function perfilCreditoHttp(req: Request, slug: string, clienteEntrada: string, editar: boolean) {
  const g = await requireTenantFacturacion(slug, 'ver');
  if (g.error) return g.error;
  // Capacidad nueva sin concesión automática, incluso para administradores existentes.
  const permisos = g.session.rol === 'Admin' ? await listarPermisosUsuario(g.session.id) : await permisosEfectivos(g.session.id, g.session.rol);
  if (!tieneAccionCatalogo(permisos, 'facturacion', 'administrar_credito')) return NextResponse.json({ error: 'Sin permiso específico para administrar crédito.' }, { status: 403 });
  try {
    const params = new URL(req.url).searchParams.getAll('entidad');
    if (params.length !== 1) throw new ErrorCredito('Selecciona una entidad.', 400);
    const entidad = id.safeParse(params[0]), cliente = id.safeParse(clienteEntrada);
    if (!entidad.success || !cliente.success) throw new ErrorCredito('Ámbito inválido.', 400);
    const perfil = editar
      ? await guardarPerfilCredito({ empresaId: g.empresa.id, usuarioId: g.session.id, usuario: g.session.username }, entidad.data, cliente.data, await req.json().catch(() => null))
      : await obtenerPerfilCredito(g.empresa.id, entidad.data, cliente.data);
    return NextResponse.json({ perfil }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { const r = respuestaErrorCredito(e); return NextResponse.json({ error: r.error }, { status: r.status }); }
}
