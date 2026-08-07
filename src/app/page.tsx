import { redirect } from "next/navigation";

/** Entrada pública: siempre pedir usuario y contraseña. */
export default function Home() {
  redirect("/login");
}
