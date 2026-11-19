"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { acceptLearnedRule, discardLearnedRule, retireLearnedRule } from "@/lib/actions/learned-rules";
import type { AgentScreenData } from "@/lib/agent/screen";
import { RULE_STATUS_LABELS, reasonLabel } from "@/lib/ai-learning/rules";
import { formatDateTime } from "@/components/contacts/ui";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { Notice, Section } from "./fields";

type Rule = NonNullable<AgentScreenData["learnedRules"]>[number];

/**
 * Reglas aprendidas: la sección aparte del prompt. Las propuestas salen de los rechazos repetidos
 * con el mismo motivo; una persona las acepta (puede editar el texto), las descarta o retira una activa. Cada cambio
 * es una versión nueva del prompt, y «Volver a esta» restaura también sus reglas.
 */
export function LearnedRulesPanel({ data }: { data: AgentScreenData }) {
  const rules = data.learnedRules ?? [];
  const proposed = rules.filter((r) => r.status === "proposed");
  const active = rules.filter((r) => r.status === "active");
  const retired = rules.filter((r) => r.status === "retired").slice(0, 5);

  return (
    <Section
      title="Reglas aprendidas"
      description="Una sección aparte del prompt, también versionada. El sistema propone una regla cuando se repiten los rechazos con el mismo motivo; solo entra al prompt si una persona la acepta."
    >
      {rules.length === 0 && (
        <p className="text-sm text-muted-foreground">Todavía no hay reglas. Aparecen cuando se rechazan varias propuestas por el mismo motivo.</p>
      )}
      {proposed.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold">Para revisar</h3>
          {proposed.map((rule) => (
            <ProposedRule key={rule.id} rule={rule} />
          ))}
        </div>
      )}
      {active.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold">Activas en el prompt</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {active.map((rule) => (
              <ActiveRule key={rule.id} rule={rule} />
            ))}
          </ul>
        </div>
      )}
      {retired.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Retiradas ({retired.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {retired.map((rule) => (
              <li key={rule.id}>{rule.text}</li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function ProposedRule({ rule }: { rule: Rule }) {
  const router = useRouter();
  const timeZone = useViewerTimezone();
  const [text, setText] = useState(rule.text);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) return setError(result.error ?? "No se pudo.");
      router.refresh();
    });

  return (
    <article className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden />
        {rule.rejections} rechazos por «{reasonLabel(rule.reasonKey)}» · {formatDateTime(rule.proposedAt, timeZone)}
      </p>
      {rule.evidence.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
          {rule.evidence.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
      <label htmlFor={`rule-${rule.id}`} className="mt-2 block text-xs font-medium">
        Texto de la regla
      </label>
      <textarea
        id={`rule-${rule.id}`}
        value={text}
        maxLength={500}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => acceptLearnedRule(rule.id, text))} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          Aceptar
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => discardLearnedRule(rule.id))} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">
          Descartar
        </button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </article>
  );
}

function ActiveRule({ rule }: { rule: Rule }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p>{rule.text}</p>
        <p className="text-[11px] text-muted-foreground">
          {RULE_STATUS_LABELS[rule.status]} · por «{reasonLabel(rule.reasonKey)}»{rule.decidedByLabel ? ` · aceptada por ${rule.decidedByLabel}` : ""}
        </p>
        {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await retireLearnedRule(rule.id);
            if (!result.ok) return setError(result.error);
            router.refresh();
          })
        }
        className="w-fit shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        Retirar
      </button>
    </li>
  );
}
