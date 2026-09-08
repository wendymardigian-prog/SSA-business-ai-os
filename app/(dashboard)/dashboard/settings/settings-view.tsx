"use client";

import { useState } from "react";
import {
  Settings,
  Key,
  Hash,
  Save,
  Plus,
  X,
  Check,
  Plug,
  Users,
  ChevronRight,
  MessageSquareQuote,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LeadScopeSettings } from "@/components/settings/lead-scope-settings";

interface WorkspaceSettings {
  id: string;
  name: string;
  globalKeywords: string[];
  leadScopeEnabled: boolean;
  unassignedVisibleToMembers: boolean;
}

export function SettingsView({
  workspace,
}: {
  workspace: WorkspaceSettings;
}) {
  const [name, setName] = useState(workspace.name);
  const [keywords, setKeywords] = useState<string[]>(workspace.globalKeywords);
  const [newKeyword, setNewKeyword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addKeyword() {
    const trimmed = newKeyword.trim().toLowerCase();
    if (!trimmed) return;
    if (keywords.includes(trimmed)) {
      setNewKeyword("");
      return;
    }
    setKeywords((prev) => [...prev, trimmed]);
    setNewKeyword("");
  }

  function removeKeyword(kw: string) {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const supabase = createClient();

      const update: Record<string, unknown> = {
        name: name.trim(),
        global_keywords: keywords,
      };

      const { error: updateError } = await supabase
        .from("workspaces")
        .update(update)
        .eq("id", workspace.id)
        .select("id")
        .single();

      if (updateError) {
        console.error("Settings save error:", updateError);
        throw new Error(updateError.message);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      setError(err instanceof Error ? err.message : "Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your workspace settings
        </p>
      </div>

      {/* Settings form */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          {/* Workspace name */}
          <section>
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">General</h2>
            </div>
            <div className="mt-4">
              <label className="text-xs font-medium text-muted-foreground">
                Workspace Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </section>

          <hr className="border-border" />

          <LeadScopeSettings
            leadScopeEnabled={workspace.leadScopeEnabled}
            unassignedVisibleToMembers={workspace.unassignedVisibleToMembers}
          />

          <hr className="border-border" />

          {/* Las API keys se configuran en Integraciones: van a Vault, no a
              columnas en texto plano. */}
          <section>
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">API keys</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Instagram, email y proveedores de IA se conectan desde Integraciones. Las
              keys se guardan encriptadas.
            </p>
            <Link
              href="/dashboard/settings/integrations"
              className="mt-4 flex items-center justify-between rounded-lg border border-border p-4 hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <Plug className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Integraciones</p>
                  <p className="text-xs text-muted-foreground">
                    Instagram (Zernio), Resend, OpenAI, Anthropic y Google
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </section>

          <hr className="border-border" />

          {/* Global Keywords */}
          <section>
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Global Keywords</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Keywords that trigger flows across all channels. Flow-specific triggers take priority over global keywords.
            </p>

            {/* Keyword input */}
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="Add a keyword..."
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={addKeyword}
                disabled={!newKeyword.trim()}
                className="rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Keyword list */}
            {keywords.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {keywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium"
                  >
                    {kw}
                    <button
                      onClick={() => removeKeyword(kw)}
                      className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground/70">
                No global keywords configured
              </p>
            )}
          </section>

          <hr className="border-border" />

          {/* Team */}
          <section>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Team</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage workspace members and invitations.
            </p>
            <Link
              href="/dashboard/settings/team"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <Users className="h-4 w-4" />
              Manage Team
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          </section>

          <hr className="border-border" />

          {/* Respuestas rapidas (F17) */}
          <section>
            <div className="flex items-center gap-2">
              <MessageSquareQuote className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Respuestas rápidas</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Textos que el equipo reutiliza en la bandeja, con variables del contacto.
            </p>
            <Link
              href="/dashboard/settings/templates"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <MessageSquareQuote className="h-4 w-4" />
              Gestionar respuestas
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          </section>

          <hr className="border-border" />

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </button>

            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <Check className="h-4 w-4" />
                Settings saved
              </span>
            )}

            {error && (
              <span className="text-sm text-red-600">
                {error}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
