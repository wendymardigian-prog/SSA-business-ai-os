"use client";

import { useState } from "react";
import { Settings, Hash, Save, Plus, X, Check } from "lucide-react";
import { updateWorkspaceSettings } from "@/lib/actions/workspace";
import { ChatMediaSettings } from "@/components/settings/chat-media-settings";
import { OptOutSettings } from "@/components/settings/opt-out-settings";
import { TimezoneSettings } from "@/components/settings/timezone-settings";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SectionNav } from "@/components/settings/section-nav";
import Link from "next/link";
import { AiRunsLink } from "@/components/settings/ai-runs-link";
import { SETTINGS_EMPTY_STATES } from "@/lib/settings/empty-states";

interface WorkspaceSettings {
  id: string;
  name: string;
  globalKeywords: string[];
  optOutPhrases: string[];
  persistChatMedia: boolean;
  chatMediaRetentionDays: number;
  timezone: string;
}

/**
 * General (S2): antes era una columna de 13 bloques apilados, con seis de
 * ellos siendo tarjetas-link que repetían una pestaña o una ruta propia
 * (API keys, Team, Roles, Campos personalizados, Tareas, Banca de
 * recursos). Esas tarjetas se eliminaron: todo lo que linkeaban ya tiene su
 * propia pestaña en `SettingsTabs`.
 *
 * Lo que queda se agrupó en cuatro secciones con navegación interna
 * (`SectionNav`, mismo patrón que `components/scheduling/config-nav.tsx`,
 * pero por anclas en vez de rutas): Workspace, Conversaciones, Archivos e
 * IA. Cada ajuste conserva su forma de guardado actual — el botón de abajo
 * sigue guardando solo nombre y palabras clave, el resto se guarda solo —
 * y por eso quedan separados visualmente aunque compartan sección.
 */
export function SettingsView({
  workspace,
  canViewAiCosts,
}: {
  workspace: WorkspaceSettings;
  canViewAiCosts: boolean;
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

  /**
   * Guarda por Server Action y no con un update directo desde acá. El motivo
   * es el audit log (F20): registrar quien cambio el nombre del workspace o
   * las palabras clave necesita el usuario resuelto del lado del servidor.
   */
  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await updateWorkspaceSettings({ name, globalKeywords: keywords });

    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    setSaving(false);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/settings" />
      <SettingsTabs />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-8 md:flex-row md:items-start md:gap-10">
          <SectionNav />

          <div className="min-w-0 flex-1 space-y-10">
            {/* Workspace */}
            <section id="workspace" className="scroll-mt-20 space-y-6">
              <div>
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">General</h2>
                </div>
                <div className="mt-4">
                  <label className="text-xs font-medium text-muted-foreground">
                    Nombre del workspace
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={handleSave}
                    disabled={saving || !name.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                        Guardando...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Guardar cambios
                      </>
                    )}
                  </button>

                  {saved && (
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <Check className="h-4 w-4" />
                      Cambios guardados
                    </span>
                  )}

                  {error && <span className="text-sm text-red-600">{error}</span>}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Este botón guarda el nombre de acá arriba y las palabras clave globales
                  (sección Conversaciones, más abajo). Los demás ajustes de esta página se
                  guardan solos.
                </p>
              </div>

              <hr className="border-border" />

              <TimezoneSettings timezone={workspace.timezone} />
            </section>

            <hr className="border-border" />

            {/* Conversaciones */}
            <section id="conversaciones" className="scroll-mt-20 space-y-6">
              <p className="text-xs text-muted-foreground">
                Quién ve qué leads se define por rol, en{" "}
                <Link href="/dashboard/settings/roles" className="text-primary underline underline-offset-2">
                  Ajustes → Roles
                </Link>
                .
              </p>

              <hr className="border-border" />

              {/* Frases de "no contactar" (F18). Se guardan aparte del resto: son
                  las unicas que cambian como reacciona el sistema a un mensaje
                  entrante, y por eso llevan su propio registro en el audit log. */}
              <OptOutSettings phrases={workspace.optOutPhrases} />

              <hr className="border-border" />

              {/* Palabras clave globales */}
              <section>
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Palabras clave globales</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Palabras que disparan flows en todos los canales. Un disparador propio de un flow tiene prioridad sobre las palabras clave globales.
                </p>

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
                    placeholder="Agregar una palabra clave..."
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
                    {SETTINGS_EMPTY_STATES.generalKeywords}
                  </p>
                )}

                <p className="mt-2 text-[11px] text-muted-foreground">
                  Se guarda con el botón de arriba, en Workspace.
                </p>
              </section>
            </section>

            <hr className="border-border" />

            {/* Archivos */}
            <section id="archivos" className="scroll-mt-20">
              <ChatMediaSettings
                enabled={workspace.persistChatMedia}
                retentionDays={workspace.chatMediaRetentionDays}
              />
            </section>

            <hr className="border-border" />

            {/* IA */}
            <section id="ia" className="scroll-mt-20 space-y-6">
              <p className="text-sm text-muted-foreground">
                Los topes de gasto de IA y sus avisos se configuran en{" "}
                <Link href="/dashboard/agents" className="font-medium text-primary underline-offset-2 hover:underline">
                  Agentes → Gasto de IA
                </Link>
                .
              </p>
              <AiRunsLink canView={canViewAiCosts} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
