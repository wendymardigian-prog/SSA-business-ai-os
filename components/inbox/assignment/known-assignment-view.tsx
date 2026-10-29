"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveCustomerContactsSettings, saveKnownContactsSettings } from "@/lib/actions/conversation-assignment-rules";
import type { KnownSettings } from "@/lib/inbox/known";
import { ActionError } from "@/components/contacts/ui";
import { PlatformIcon } from "@/components/platform-icon";
import type { RuleAccount, RuleMember } from "./conversation-rules-view";

const control = "h-9 rounded-lg border border-border bg-background px-2 text-sm";

/**
 * Ajustes > Asignación > Conocidos (00256) y Clientes (00268): a quién van los
 * chats de un conocido o de un cliente, cuenta por cuenta. "Instagram 1 → Ana,
 * Instagram 2 → Beto". Una cuenta sin persona usa la por defecto; sin por
 * defecto, un conocido va al Owner y un cliente se queda con su responsable.
 */
export function KnownAssignmentView({
  kind = "known",
  settings,
  accounts,
  members,
  ownerName,
}: {
  kind?: "known" | "customer";
  settings: KnownSettings;
  accounts: RuleAccount[];
  members: RuleMember[];
  ownerName: string | null;
}) {
  const router = useRouter();
  const [byChannel, setByChannel] = useState<Record<string, string>>(settings.byChannel);
  const [defaultUserId, setDefaultUserId] = useState<string>(settings.defaultUserId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const fallback = kind === "customer" ? "Nadie: queda su responsable" : ownerName ? `${ownerName} (Owner)` : "El Owner";
  const defaultLabel = defaultUserId
    ? members.find((m) => m.userId === defaultUserId)?.label ?? "la persona por defecto"
    : kind === "customer"
      ? "queda su responsable"
      : ownerName
        ? `${ownerName} (Owner)`
        : "el Owner";

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const payload = { byChannel, defaultUserId: defaultUserId || null };
      const result = kind === "customer" ? await saveCustomerContactsSettings(payload) : await saveKnownContactsSettings(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Por defecto</span>
        <select
          value={defaultUserId}
          onChange={(e) => {
            setDefaultUserId(e.target.value);
            setSaved(false);
          }}
          className={control}
        >
          <option value="">{fallback}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      {accounts.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">Cuenta</th>
              <th className="py-1 font-medium">Va a</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    <PlatformIcon platform={a.platform} className="h-3.5 w-3.5" size={14} />
                    {a.label}
                  </span>
                </td>
                <td className="py-2">
                  <select
                    value={byChannel[a.id] ?? ""}
                    aria-label={`A quién van los ${kind === "customer" ? "clientes" : "conocidos"} de ${a.label}`}
                    onChange={(e) => {
                      const value = e.target.value;
                      setByChannel((prev) => {
                        const next = { ...prev };
                        if (value) next[a.id] = value;
                        else delete next[a.id];
                        return next;
                      });
                      setSaved(false);
                    }}
                    className={control}
                  >
                    <option value="">Por defecto ({defaultLabel})</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ActionError message={error} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar
        </button>
        {saved && <span className="text-xs text-muted-foreground">Guardado.</span>}
      </div>
    </div>
  );
}
