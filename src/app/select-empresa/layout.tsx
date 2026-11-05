import { RegistroSalidaBorradores } from "@/components/borradores/registro-salida";
import { ownerKeyDeUsuario } from "@/lib/borradores/owner-key";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * BORR-1b — el selector de empresa vive fuera del shell (sin provider de sesión). Este layout solo registra la política de limpieza
 * local para la salida EXPLÍCITA, con un ownerKey derivado en el servidor del id interno de la sesión (`getSession` va cacheada por
 * petición: no agrega lecturas). Sin sesión, `null`: la página ya redirige a /login. No altera la página ni el cliente del selector.
 */
export default async function SelectEmpresaLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <>
      <RegistroSalidaBorradores ownerKey={session ? ownerKeyDeUsuario(session.id) : null} />
      {children}
    </>
  );
}
