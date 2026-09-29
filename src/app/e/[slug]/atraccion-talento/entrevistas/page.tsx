import EntrevistasPageClient from "@/components/rrhh/entrevistas-page-client";

/**
 * ATRACCION-TALENTO-1 — nueva ubicación de Entrevistas (antes
 * /e/[slug]/rrhh/entrevistas, ahora un redirect a esta ruta). Misma
 * lógica/backend, sin duplicar — ver src/components/rrhh/entrevistas-page-client.tsx.
 */
export default function AtraccionTalentoEntrevistasPage() {
  return <EntrevistasPageClient />;
}
