import { NextResponse } from "next/server";
import { clearClienteSessionCookie } from "@/lib/tms/cliente-portal-session";

export async function POST() {
  await clearClienteSessionCookie();
  return NextResponse.json({ ok: true });
}
