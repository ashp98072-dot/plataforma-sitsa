import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ErrorMultas } from "./reglas";

export function errorMultas(error: unknown) {
  if (error instanceof ErrorMultas) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: "Datos inválidos.", detalles: error.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message })) }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  const code = (error as { code?: string } | null)?.code;
  if (code === "ER_DUP_ENTRY") return NextResponse.json({ error: "Ya existe un registro con esa identidad." }, { status: 409 });
  if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT")
    return NextResponse.json({ error: "Otra operación está modificando el expediente. Recargue e intente de nuevo." }, { status: 409 });
  console.error("Multas", error);
  return NextResponse.json({ error: "No se pudo completar la operación de Multas." }, { status: 500 });
}
