"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";

type Props = {
  href: string;
  className?: string;
  children: React.ReactNode;
  onNavigate?: () => void;
};

/** Prefetch solo al hover/focus (evita ráfaga 429 en Hostinger). */
const prefetched = new Set<string>();
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePrefetch(router: ReturnType<typeof useRouter>, href: string) {
  if (prefetched.has(href)) return;
  if (prefetchTimer) clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    if (prefetched.has(href)) return;
    prefetched.add(href);
    try {
      void router.prefetch(href);
    } catch {
      prefetched.delete(href);
    }
  }, 40);
}

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
 * Link del sidebar: sin prefetch automático (Hostinger 429),
 * pero calienta la ruta al apuntar y muestra pending al clic.
 */
export function ShellNavLink({ href, className, children, onNavigate }: Props) {
  const router = useRouter();
  const armed = useRef(false);

  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={() => {
        armed.current = true;
        schedulePrefetch(router, href);
      }}
      onFocus={() => schedulePrefetch(router, href)}
      onTouchStart={() => schedulePrefetch(router, href)}
      onClick={() => {
        if (!armed.current) schedulePrefetch(router, href);
        onNavigate?.();
      }}
      className={["flex items-center gap-2", className].filter(Boolean).join(" ")}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <PendingHint />
    </Link>
  );
}
