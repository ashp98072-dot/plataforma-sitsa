import Link from "next/link";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import {
  permisosEfectivos,
  tienePermiso,
  type PermisoModulo,
} from "@/lib/permisos";
import { modulosPorRol, type RolGlobal } from "@/lib/roles";
import { getSession } from "@/lib/session";

type Props = { params: Promise<{ slug: string }> };

export default async function DashboardOperacionesPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  const empresa = await obtenerEmpresaPorSlug(slug);
  if (!session || !empresa) return null;

  const rol = session.rol as RolGlobal;
  let permisos: PermisoModulo[] = [];
  try {
    permisos = await permisosEfectivos(session.id, rol);
  } catch {
    permisos = [];
  }

  const rolMods = modulosPorRol(rol);
  // Sin matriz cargada: caer al rol. Con matriz: solo si "ver" está activo.
  const puedeTms =
    rol === "Admin" ||
    (permisos.length > 0
      ? tienePermiso(permisos, "tms", "ver")
      : rolMods.includes("tms"));
  const puedeFlota =
    rol === "Admin" ||
    (permisos.length > 0
      ? permisos.some(
          (p) =>
            (p.modulo === "flota" || p.modulo.startsWith("flota_")) &&
            p.puedeVer,
        )
      : rolMods.includes("flota") || empresa.modulos.includes("flota"));

  const puedeDisponibilidad = puedeTms || puedeFlota;
  const puedeClientes =
    rol === "Admin" ||
    (permisos.length > 0
      ? tienePermiso(permisos, "clientes", "ver")
      : rolMods.includes("clientes") || empresa.modulos.includes("clientes"));
  const puedeFactClientes =
    rol === "Admin" ||
    rol === "Operaciones" ||
    (permisos.length > 0
      ? tienePermiso(permisos, "facturacion", "ver")
      : rolMods.includes("facturacion") ||
        empresa.modulos.includes("facturacion"));

  const cards = [
    puedeDisponibilidad
      ? {
          href: `/e/${slug}/disponibilidad`,
          title: "Disponibilidad de flota",
          desc: "Qué unidades propias o compartidas puedes enviar: activas, en taller, en ruta o inactivas.",
        }
      : null,
    puedeClientes
      ? {
          href: `/e/${slug}/clientes`,
          title: "Clientes",
          desc: "Catálogo compartido con Facturación y Contabilidad (KT / Mónaco y demás empresas).",
        }
      : null,
    puedeFactClientes
      ? {
          href: `/e/${slug}/facturacion?vista=clientes`,
          title: "Facturación clientes",
          desc: "Cómo se factura a cada cliente (NIT, OC, evidencias, tarifa). La empresa la llena Contabilidad.",
        }
      : null,
    puedeTms
      ? {
          href: `/e/${slug}/tms`,
          title: "TMS / Planes de viaje",
          desc: "Rutas, programación, evidencias. Ahí eliges pilotos y auxiliares de la planilla.",
        }
      : null,
    puedeFlota
      ? {
          href: `/e/${slug}/flota`,
          title: "Flota / Predios",
          desc: "Vehículos, km, talleres y servicios.",
        }
      : null,
  ].filter(Boolean) as { href: string; title: string; desc: string }[];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          Dashboard Operaciones
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{empresa.nombre}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {puedeTms
            ? "Transporte y flota. El alta de personal es solo RRHH; Operaciones selecciona pilotos al crear planes en TMS."
            : "Acceso a flota y predios según tus permisos."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            prefetch={false}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 hover:border-[var(--accent)]"
          >
            <h2 className="font-medium">{c.title}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
