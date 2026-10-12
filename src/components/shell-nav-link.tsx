"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";

type Props = {
  href: string;
  className?: string;
  children: React.ReactNode;
  onNavigate?: () => void;
};

function PendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={[
        "ml-auto inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current transition-opacity duration-150",
        pending ? "animate-pulse opacity-80" : "opacity-0",
      ].join(" ")}
    />
  );
}

/**
 * Navegación lateral bajo demanda: sin precarga por viewport, hover,
 * foco o touch. Next Link conserva navegación cliente y pending al clic.
 */
export function ShellNavLink({ href, className, children, onNavigate }: Props) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={() => {
        onNavigate?.();
      }}
      className={["flex items-center gap-2", className].filter(Boolean).join(" ")}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <PendingHint />
    </Link>
  );
}
