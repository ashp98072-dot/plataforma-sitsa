import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  empresasParaUsuario,
  obtenerEmpresaPorSlug,
} from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { modulosPorRol, type Modulo, type RolGlobal } from "@/lib/roles";
import { getSession } from "@/lib/session";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function EmpresaLayout({ children, params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const empresa = await obtenerEmpresaPorSlug(slug);
  if (!empresa) redirect("/select-empresa");

  const permitidas = await empresasParaUsuario({
    usuarioId: session.id,
    rol: session.rol,
    accesoTodas: Boolean(session.accesoTodas),
  });
  if (!permitidas.some((e) => e.id === empresa.id)) {
    redirect("/select-empresa");
  }

  const rolMods = modulosPorRol(session.rol);
  const empresaMods = (
    empresa.modulos.length ? empresa.modulos : rolMods
  ) as Modulo[];

  // Usuarios solo Admin
  const finalMods: Modulo[] =
    session.rol === "Admin"
      ? ([...new Set([...empresaMods, "usuarios", "gerencia", "cms"])] as Modulo[])
      : rolMods.filter(
          (m) => empresaMods.includes(m) || m === "gerencia",
        );

  let permisos: PermisoModulo[] = [];
  try {
    permisos = await permisosEfectivos(
      session.id,
      session.rol as RolGlobal,
    );
  } catch {
    permisos = [];
  }

  return (
    <AppShell
      slug={empresa.slug}
      empresaNombre={empresa.nombre}
      username={session.username}
      rol={session.rol}
      modulos={finalMods}
      permisos={permisos}
    >
      <div className="pb-10">{children}</div>
    </AppShell>
  );
}
