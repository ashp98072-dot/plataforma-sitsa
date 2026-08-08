import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  empresasParaUsuario,
  obtenerEmpresaPorSlug,
} from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import {
  esPlataformaPermisible,
  modulosPlataformaDesdePermisos,
  tienePermiso,
  type PermisoModulo,
} from "@/lib/permisos-shared";
import { modulosPorRol, type Modulo, type RolGlobal } from "@/lib/roles";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function EmpresaLayout({ children, params }: Props) {
  const { slug } = await params;

  // Session + tenant en paralelo (JWT es local; no depende de MySQL).
  const sessionPromise = getSession();
  const empresaPromise = obtenerEmpresaPorSlug(slug);
  const session = await sessionPromise;
  if (!session) redirect("/login");

  // Paralelizar lecturas de tenant (menos latencia / menos riesgo de timeout).
  const [empresa, permitidas, permisosRaw] = await Promise.all([
    empresaPromise,
    empresasParaUsuario({
      usuarioId: session.id,
      rol: session.rol,
      accesoTodas: Boolean(session.accesoTodas),
    }),
    permisosEfectivos(session.id, session.rol as RolGlobal).catch(
      () => [] as PermisoModulo[],
    ),
  ]);

  if (!empresa) redirect("/select-empresa");
  if (!permitidas.some((e) => e.id === empresa.id)) {
    redirect("/select-empresa");
  }

  const permisos = permisosRaw;
  const rolMods = modulosPorRol(session.rol);
  const baseEmpresaMods = (
    empresa.modulos.length ? empresa.modulos : rolMods
  ) as Modulo[];
  // Clientes / Facturación: visibles si la empresa ya opera TMS/Conta/etc.
  // (el JSON se actualiza al abrir esos módulos; aquí no bloqueamos el layout).
  const empresaMods = [...new Set([
    ...baseEmpresaMods,
    ...(baseEmpresaMods.some((m) =>
      ["tms", "contabilidad", "reciclaje", "tarimas", "clientes"].includes(m),
    )
      ? (["clientes"] as Modulo[])
      : []),
    ...(baseEmpresaMods.some((m) =>
      ["contabilidad", "facturacion", "clientes"].includes(m),
    ) ||
    baseEmpresaMods.some((m) =>
      ["tms", "reciclaje", "tarimas"].includes(m),
    )
      ? (["facturacion"] as Modulo[])
      : []),
  ])] as Modulo[];

  const extraMods = modulosPlataformaDesdePermisos(permisos);
  const moduloVisible = (m: Modulo) => {
    if (!(empresaMods.includes(m) || m === "gerencia")) return false;
    if (
      permisos.length > 0 &&
      esPlataformaPermisible(m) &&
      !tienePermiso(permisos, m, "ver")
    ) {
      return false;
    }
    return true;
  };
  const finalMods: Modulo[] =
    session.rol === "Admin"
      ? ([...new Set([...empresaMods, "usuarios", "gerencia", "cms"])] as Modulo[])
      : ([
          ...new Set([
            ...rolMods.filter(moduloVisible),
            ...extraMods.filter(moduloVisible),
          ]),
        ] as Modulo[]);

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
