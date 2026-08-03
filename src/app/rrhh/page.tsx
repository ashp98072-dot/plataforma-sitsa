import { redirect } from "next/navigation";

/** RRHH usa el mismo selector de empresa que Contabilidad. */
export default function RrhhRedirectPage() {
  redirect("/select-empresa");
}
