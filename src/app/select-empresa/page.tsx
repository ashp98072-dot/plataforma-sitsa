import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { empresasParaUsuario } from "@/lib/empresas";
import { SelectEmpresaClient } from "./select-empresa-client";

export const dynamic = "force-dynamic";

/** Sesión vigente y empresas permitidas antes de pintar: sin waterfall cliente GET /auth/me. */
export default async function SelectEmpresaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const empresas = await empresasParaUsuario({ usuarioId: session.id, rol: session.rol, accesoTodas: Boolean(session.accesoTodas) });
  return <SelectEmpresaClient user={{ username: session.username, rol: session.rol }} empresas={empresas} />;
}
