"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * «Chats | Grupos» arriba de la lista de la bandeja. Los grupos de WhatsApp activados viven en su propia vista
 * (`?vista=grupos`): no son conversaciones con un lead.
 */
export function InboxViewSwitch({ current }: { current: "chats" | "grupos" }) {
  const item = (key: "chats" | "grupos", label: string, href: string) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        current === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
  return (
    <div role="navigation" aria-label="Chats o grupos" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {item("chats", "Chats", "/dashboard/inbox")}
      {item("grupos", "Grupos", "/dashboard/inbox?vista=grupos")}
    </div>
  );
}
