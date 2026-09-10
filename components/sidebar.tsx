"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  GitBranch,
  MessageSquare,
  Users,
  Radio,
  ListOrdered,
  BarChart3,
  Sprout,
  Plug,
  Blocks,
  BookOpen,
  Settings,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { isAdminRole } from "@/lib/auth/roles";
import type { Database } from "@/lib/types/database";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

function subscribeToThemeClass(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

// adminOnly: la pantalla ademas esta protegida por requireWorkspaceAdmin y por
// RLS. Ocultarla del menu es para no ofrecerle a un Member un link que rebota.
const navigation = [
  { name: "Flows", href: "/dashboard/flows", icon: GitBranch, adminOnly: false },
  { name: "Inbox", href: "/dashboard/inbox", icon: MessageSquare, adminOnly: false },
  { name: "Contacts", href: "/dashboard/contacts", icon: Users, adminOnly: false },
  { name: "Broadcasts", href: "/dashboard/broadcasts", icon: Radio, adminOnly: false },
  { name: "Sequences", href: "/dashboard/sequences", icon: ListOrdered, adminOnly: false },
  { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3, adminOnly: false },
  { name: "Growth", href: "/dashboard/growth", icon: Sprout, adminOnly: false },
  { name: "Channels", href: "/dashboard/channels", icon: Plug, adminOnly: true },
  {
    name: "Conocimiento",
    href: "/dashboard/knowledge",
    icon: BookOpen,
    adminOnly: true,
  },
  { name: "Integraciones", href: "/dashboard/settings/integrations", icon: Blocks, adminOnly: true },
  { name: "Settings", href: "/dashboard/settings", icon: Settings, adminOnly: true },
];

export function Sidebar({
  workspace,
  role,
  workspaces,
}: {
  workspace: Workspace;
  user: { id: string; email?: string };
  role: string;
  workspaces: WorkspaceItem[];
}) {
  const navItems = navigation.filter(
    (item) => !item.adminOnly || isAdminRole(role)
  );
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const dark = useSyncExternalStore(
    subscribeToThemeClass,
    () => document.documentElement.classList.contains("dark"),
    () => false
  );

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full w-60 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-sidebar-border px-3 py-3">
        <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-1">
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? "Light mode" : "Dark mode"}
        </button>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}
