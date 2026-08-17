import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import LogoutButton from "./logout-button";

const PROXIMAMENTE = [
  {
    titulo: "Boletas de pago",
    detalle:
      "Descuentos, pagos adicionales, viáticos y devengados no afectos del mes.",
  },
  {
    titulo: "Vacaciones",
    detalle: "Días disponibles, historial y solicitud de vacaciones.",
  },
  {
    titulo: "Mi ficha",
    detalle: "Datos de ingreso, centro de costo y supervisor.",
  },
];

export default async function PortalHomePage() {
  // El middleware ya bloquea esta ruta sin sesión válida; esto es un
  // respaldo defensivo, no la única barrera de seguridad.
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
              Grupo SITSA · Portal de Colaboradores
            </p>
            <h1 className="mt-1 text-2xl font-semibold">
              Hola, {session.nombre ?? "colaborador"}
            </h1>
          </div>
          <LogoutButton />
        </header>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {PROXIMAMENTE.map((item) => (
            <div
              key={item.titulo}
              className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Próximamente
              </p>
              <h2 className="mt-1 text-lg font-semibold">{item.titulo}</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {item.detalle}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
