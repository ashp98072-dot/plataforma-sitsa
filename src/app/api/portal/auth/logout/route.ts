import { NextResponse } from "next/server";
import { clearColaboradorSessionCookie } from "@/lib/rrhh/colaborador-session";

export async function POST() {
  await clearColaboradorSessionCookie();
  return NextResponse.json({ ok: true });
}