"use client";
import { Suspense } from "react";
import dynamic from "next/dynamic";
const FlotaClient = dynamic(() => import("./flota-client"), { ssr: false, loading: () => <p>Cargando flota…</p> });
export default function FlotaPageClient() {
  return <Suspense fallback={<p>Cargando flota…</p>}><FlotaClient /></Suspense>;
}
