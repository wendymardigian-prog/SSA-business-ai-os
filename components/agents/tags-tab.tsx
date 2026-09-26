"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TagChip } from "@/components/contacts/ui";
import { setTagEffect } from "@/lib/actions/tag-effects";
import { describeEffect, sortEffectFirst } from "@/lib/tags/effects";
import type { AgentScreenData, TagsTabData } from "@/lib/agent/screen";
import { Notice, Section } from "./fields";

/**
 * Pestana Etiquetas (Bloque 2d-A): que etiquetas ademas de clasificar tienen
 * efecto sobre el agente. Pensado para `es-conocido` (contactos personales de
 * Wendy) y `no-es-lead` (autorespuestas de otras empresas, spam), pero vale
 * para cualquiera: es una sola regla, no dos casos especiales.
 *
 * El efecto lo aplica la base (00073), sea quien sea que ponga la etiqueta:
 * la ficha, la bandeja, la accion masiva, un CSV o un flow.
 */

type Tag = TagsTabData["tags"][number];

export function TagsTab({ data }: { data: AgentScreenData }) {
  const router = useRouter();
  const tabData = data.tags;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ tag: Tag; disablesAgent: boolean; assignsTo: string | null } | null>(null);
  const [, start] = useTransition();

  if (!tabData) return null;
  const memberName = new Map(tabData.members.map((m) => [m.userId, m.label]));
  const tags = sortEffectFirst(tabData.tags);

  function save(tag: Tag, next: { disablesAgent: boolean; assignsTo: string | null }) {
    setError(null);
    setPendingId(tag.id);
    start(async () => {
      const result = await setTagEffect(tag.id, next);
      setPendingId(null);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  // Prender o apagar el efecto de una etiqueta que ya tienen contactos los
  // afecta en el acto: se confirma con el numero a la vista.
  function request(tag: Tag, next: { disablesAgent: boolean; assignsTo: string | null }) {
    if (next.disablesAgent !== tag.disablesAgent && tag.contactCount > 0) {
      setConfirm({ tag, ...next });
      return;
    }
    save(tag, next);
  }

  return (
    <>
      <Section
        title="Etiquetas con efecto sobre el agente"
        description="Una etiqueta con efecto hace algo además de clasificar. Sirve para que el agente nunca le escriba a un contacto personal ni a una cuenta que no es un lead."
      >
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Apaga el agente:</span> sus conversaciones pasan a &quot;forzado apagado&quot;,
            también las que se abran después. No se generan borradores ni se gastan tokens.
          </li>
          <li>
            <span className="font-medium text-foreground">Asigna a:</span> setter y vendedor pasan a esa persona cuando se pone la
            etiqueta. Cambiar a quién asigna no reasigna a los contactos que ya la tienen.
          </li>
          <li>
            Sacar la etiqueta devuelve el agente solo en las conversaciones que ella apagó; la asignación queda como está. Si en una
            conversación alguien prende el agente a mano, eso gana sobre la etiqueta.
          </li>
          <li>Si una importación de CSV asigna setter o vendedor y además pone una etiqueta que asigna, gana la etiqueta.</li>
        </ul>

        {error && <Notice tone="error">{error}</Notice>}

        {tags.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Todavía no hay etiquetas en el workspace. Se crean desde la ficha de un contacto o desde el panel de la bandeja.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {tags.map((tag) => {
              const effect = describeEffect(tag, tag.assignsTo ? (memberName.get(tag.assignsTo) ?? null) : null);
              const busy = pendingId === tag.id;
              return (
                <li key={tag.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <TagChip name={tag.name} color={tag.color} />
                      <span className="text-[11px] text-muted-foreground">
                        {tag.contactCount === 1 ? "1 contacto" : `${tag.contactCount} contactos`}
                      </span>
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
                    </div>
                    {effect && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{effect}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex min-h-11 items-center gap-2 text-xs sm:min-h-0">
                      <Switch
                        checked={tag.disablesAgent}
                        disabled={busy}
                        onChange={(next) => request(tag, { disablesAgent: next, assignsTo: tag.assignsTo })}
                        label={`Apaga el agente: ${tag.name}`}
                      />
                      Apaga el agente
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      Asigna a
                      <select
                        value={tag.assignsTo ?? ""}
                        disabled={busy}
                        onChange={(e) => request(tag, { disablesAgent: tag.disablesAgent, assignsTo: e.target.value || null })}
                        aria-label={`A quién asigna la etiqueta ${tag.name}`}
                        className="min-h-11 rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 sm:min-h-0 sm:text-xs"
                      >
                        <option value="">Nadie</option>
                        {tabData.members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.disablesAgent ? `¿Apagar el agente con «${confirm?.tag.name}»?` : `¿Quitarle el efecto a «${confirm?.tag.name}»?`}
        message={
          confirm
            ? confirm.disablesAgent
              ? `${confirm.tag.contactCount} ${confirm.tag.contactCount === 1 ? "contacto ya la tiene" : "contactos ya la tienen"}: el agente se apaga ahora en sus conversaciones${confirm.assignsTo ? " y pasan a la persona elegida" : ""}.`
              : `El agente vuelve a heredar del canal en las conversaciones que esta etiqueta había apagado (${confirm.tag.contactCount} ${confirm.tag.contactCount === 1 ? "contacto" : "contactos"}). Las que alguien apagó a mano siguen apagadas.`
            : ""
        }
        confirmLabel={confirm?.disablesAgent ? "Apagar el agente" : "Quitar el efecto"}
        cancelLabel="Cancelar"
        destructive={confirm?.disablesAgent ?? false}
        onConfirm={() => {
          if (confirm) save(confirm.tag, { disablesAgent: confirm.disablesAgent, assignsTo: confirm.assignsTo });
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
