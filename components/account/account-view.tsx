"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { ACCOUNT_TABS, accountTabHref, parseAccountTab, type AccountTab } from "@/lib/account/tabs";
import { cn } from "@/lib/utils";

/**
 * Mi cuenta: dos pestañas (Perfil y Notificaciones). La elegida vive en
 * `?tab=` y se cambia con `history.pushState`, sin pedirle la pagina al
 * servidor: las dos ya vinieron dibujadas.
 */
export function AccountView({
  initialTab,
  profile,
  notifications,
}: {
  initialTab: AccountTab;
  profile: ReactNode;
  notifications: ReactNode;
}) {
  const [tab, setTab] = useState<AccountTab>(initialTab);

  // Atras / adelante del navegador.
  useEffect(() => {
    const onPop = () => setTab(parseAccountTab(new URLSearchParams(window.location.search).get("tab")));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // El menu de usuario lleva a esta misma pagina con otra pestaña: Next la
  // re-renderiza con otro `initialTab` sin desmontar el componente.
  const [seenInitial, setSeenInitial] = useState(initialTab);
  if (seenInitial !== initialTab) {
    setSeenInitial(initialTab);
    setTab(initialTab);
  }

  function select(next: AccountTab) {
    if (next === tab) return;
    setTab(next);
    window.history.pushState(null, "", accountTabHref(next));
  }

  const tabs = (
    <nav aria-label="Secciones de Mi cuenta" className="flex shrink-0 items-center rounded-lg border border-border p-0.5">
      {ACCOUNT_TABS.map((t) => {
        const active = t.value === tab;
        return (
          <a
            key={t.value}
            href={accountTabHref(t.value)}
            aria-current={active ? "page" : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              select(t.value);
            }}
            className={cn(
              "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-sm transition-colors",
              active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {t.label}
          </a>
        );
      })}
    </nav>
  );

  return (
    <>
      <PageHeader route="/dashboard/cuenta" tabs={tabs} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto w-full max-w-2xl">
          <div hidden={tab !== "perfil"}>{profile}</div>
          <div hidden={tab !== "notificaciones"}>{notifications}</div>
        </div>
      </div>
    </>
  );
}
