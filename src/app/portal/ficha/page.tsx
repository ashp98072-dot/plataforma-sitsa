import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { obtenerCentroCosto } from "@/lib/rrhh/centros-costo";

const FORMA_PAGO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  cheque: "Cheque",
  transferencia: "Transferencia",
};

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-0.5 text-sm">{valor || "—"}</p>
    </div>
  );
}

export default async function MiFichaPage() {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  const empleado = await obtenerEmpleado(session!.empresaId, session!.empleadoId);
  if (!empleado) {
    return (
      <main className="min-h-screen p-4 sm:p-8">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/portal"
            className="text-sm text-[var(--muted)] hover:underline"
          >
            ← Volver
          </Link>
          <p className="mt-6 text-sm">
            No se encontró tu ficha. Contacta a Recursos Humanos.
          </p>
        </div>
      </main>
    );
  }

  const centroCosto = empleado.centroCostoId
    ? await obtenerCentroCosto(session!.empresaId, empleado.centroCostoId)
    : null;

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/portal"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← Volver
        </Link>

        <header className="mt-4">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Mi ficha
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{empleado.nombre}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {empleado.puesto || "—"} · Código {empleado.codigo}
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Datos laborales
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Dato label="Estado" valor={empleado.estado} />
            <Dato
              label="Fecha de ingreso"
              valor={empleado.fechaInicioLaboral || empleado.fechaAlta}
            />
            <Dato
              label="Tipo de contrato"
              valor={
                empleado.tipoContrato === "outsourcing"
                  ? "Outsourcing"
                  : "Fijo / planilla"
              }
            />
            <Dato
              label="Forma de pago"
              valor={FORMA_PAGO_LABEL[empleado.formaPago ?? ""] ?? "—"}
            />
            <Dato label="Centro de costo" valor={centroCosto?.nombre ?? ""} />
            <Dato
              label="Supervisor"
              valor={empleado.supervisorNombre ?? ""}
            />
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Datos personales
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Dato label="DPI" valor={empleado.dpi ?? ""} />
            <Dato label="NIT" valor={empleado.nit ?? ""} />
            <Dato label="Afiliación IGSS" valor={empleado.igss ?? ""} />
            <Dato label="Teléfono" valor={empleado.telefono ?? ""} />
            <Dato label="Correo" valor={empleado.email ?? ""} />
            <Dato label="Dirección" valor={empleado.direccion ?? ""} />
            <Dato
              label="Contacto de emergencia"
              valor={empleado.contactoEmergencia ?? ""}
            />
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Datos bancarios
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Dato label="Banco" valor={empleado.banco ?? ""} />
            <Dato label="Tipo de cuenta" valor={empleado.tipoCuenta ?? ""} />
            <Dato label="No. de cuenta" valor={empleado.cuentaBancaria ?? ""} />
          </div>
        </section>

        <p className="mt-6 text-xs text-[var(--muted)]">
          ¿Algún dato incorrecto? Repórtalo con Recursos Humanos para
          corregirlo — esta pantalla es solo de consulta.
        </p>
      </div>
    </main>
  );
}
