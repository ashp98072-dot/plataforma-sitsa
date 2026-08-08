import Link from "next/link";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import { MODULO_LABEL, modulosPorRol, type Modulo } from "@/lib/roles";
import { getSession } from "@/lib/session";

type Props = { params: Promise<{ slug: string }> };

export default async function DashboardPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  const empresa = await obtenerEmpresaPorSlug(slug);
  if (!session || !empresa) return null;

  const empMods = new Set(empresa.modulos as string[]);
  if (
    [...empMods].some((m) =>
      ["tms", "contabilidad", "reciclaje", "tarimas", "clientes"].includes(m),
    )
  ) {
    empMods.add("clientes");
  }
  if (
    [...empMods].some((m) =>
      ["contabilidad", "facturacion", "clientes", "tms", "reciclaje", "tarimas"].includes(
        m,
      ),
    )
  ) {
    empMods.add("facturacion");
  }
  const mods = modulosPorRol(session.rol).filter((m) => {
    if (m === "usuarios") return session.rol === "Admin";
    return empMods.has(m) || m === "gerencia";
  }) as Modulo[];
  if (session.rol === "Admin" && !mods.includes("usuarios")) {
    mods.push("usuarios");
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Gerencia · Dashboard</h1>
      <p className="mt-1 text-[var(--muted)]">
        Operando en {empresa.nombre}. Cada empresa trabaja de forma independiente.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mods.map((m) => (
          <Link
            key={m}
            href={m === "gerencia" ? `/e/${slug}/dashboard` : `/e/${slug}/${m}`}
            prefetch={false}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 hover:border-[var(--accent)]"
          >
            <h2 className="font-medium">{MODULO_LABEL[m]}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">Abrir módulo</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
