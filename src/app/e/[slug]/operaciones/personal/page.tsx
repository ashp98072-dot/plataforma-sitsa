"use client";

import { Suspense } from "react";
import PersonalOperativoClient from "./personal-operativo-client";

/**
 * PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1 — Operaciones → Personal
 * operativo. Gestión ligera de pilotos/auxiliares utilizables en
 * Programación: propios (RRHH de esta empresa), compartidos (RRHH de otra
 * empresa del grupo, sin entrar a planilla de esta) y externos (sin RRHH).
 * NO es administración de RRHH.
 */
export default function PersonalOperativoPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Cargando personal operativo…</p>}>
      <PersonalOperativoClient />
    </Suspense>
  );
}
