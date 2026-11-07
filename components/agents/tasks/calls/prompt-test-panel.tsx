"use client";

import { useViewerTimezone } from "@/components/dashboard-chrome";
import { useState, useTransition } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { testCallDraft } from "@/lib/actions/calls-test";
import { MAX_TEST_CALLS, type TestCallResult } from "@/lib/calls/prompt-test";
import { Notice, Section } from "@/components/agents/fields";
import type { TestableCall } from "@/lib/calls/config-data";
import type { ProfileShape } from "@/lib/calls/profiles";

/**
 * "Probar antes de guardar" (F26): corre el analizador del editor sobre 1 a 5 grabaciones de ese
 * tipo y muestra que daria. No guarda nada: ni las grabaciones, ni las instrucciones, ni el analizador.
 * Cuesta lo que cuesta un analisis por llamada, y lo dice antes de probar.
 */
export function PromptTestPanel({
  calls,
  getDraft,
  general = false,
  disabled = false,
  disabledReason,
}: {
  calls: TestableCall[];
  /** Lo que tiene el editor, en el momento de apretar "Probar". */
  getDraft: () => { categoryId: string; shape: ProfileShape; instructionsText?: string; rubricDraft: unknown };
  /** El formato general no tiene lead ni resultado: no se muestran. */
  general?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const timeZone = useViewerTimezone();
  const [selected, setSelected] = useState<string[]>(() => calls.slice(0, 1).map((c) => c.id));
  const [results, setResults] = useState<TestCallResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_TEST_CALLS ? cur : [...cur, id]));

  function run() {
    setError(null);
    setResults(null);
    start(async () => {
      const result = await testCallDraft({ callIds: selected, ...getDraft() });
      if (!result.ok) return setError(result.error);
      setResults(result.results);
    });
  }

  return (
    <Section
      title="Probar antes de guardar"
      description="Corre lo que tiene el editor, aunque no lo hayas guardado, sobre grabaciones de este tipo y te muestra qué daría. No guarda nada. Cada grabación probada gasta un análisis."
    >
      {calls.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay grabaciones de este tipo con transcripción. Cuando haya alguna, aparece acá.</p>
      ) : (
        <>
          <fieldset>
            <legend className="text-xs font-semibold">
              Grabaciones a probar ({selected.length} de {MAX_TEST_CALLS} como máximo)
            </legend>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {calls.map((c) => {
                const checked = selected.includes(c.id);
                return (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(c.id)}
                        disabled={!checked && selected.length >= MAX_TEST_CALLS}
                        className="h-4 w-4"
                      />
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(c.recordedAt).toLocaleDateString("es", { timeZone })}
                        {c.closerScore !== null ? ` · closer ${c.closerScore}` : ""}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={disabled || pending || selected.length === 0}
              title={disabled ? disabledReason : undefined}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />}
              {pending ? "Probando…" : "Probar"}
            </button>
            {disabled && disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
          </div>
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {results && <TestResults results={results} general={general} />}
    </Section>
  );
}

const show = (n: number | null) => (n === null ? "—" : String(n));

function Change({ current, draft }: { current: number | null; draft: number | null }) {
  const same = current === draft;
  return (
    <span className={same ? "text-muted-foreground" : "font-medium"}>
      {show(current)} <span aria-hidden>→</span>
      <span className="sr-only">pasa a</span> {show(draft)}
    </span>
  );
}

function TestResults({ results, general }: { results: TestCallResult[]; general: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Resultado de la prueba: lo que hay hoy y lo que daría el borrador</caption>
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Llamada</th>
            <th scope="col" className="px-3 py-2 font-medium">{general ? "Puntaje" : "Closer"}</th>
            {!general && <th scope="col" className="px-3 py-2 font-medium">Lead</th>}
            {!general && <th scope="col" className="px-3 py-2 font-medium">Resultado</th>}
            <th scope="col" className="px-3 py-2 font-medium">Criterios que cambian</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {results.map((r) => (
            <tr key={r.callId}>
              <th scope="row" className="max-w-[14rem] truncate px-3 py-2 font-medium">{r.title}</th>
              {r.ok ? (
                <>
                  <td className="px-3 py-2"><Change current={r.closer.current} draft={r.closer.draft} /></td>
                  {!general && <td className="px-3 py-2"><Change current={r.lead.current} draft={r.lead.draft} /></td>}
                  {!general && (
                    <td className="px-3 py-2">
                      {r.outcome.same ? <span className="text-muted-foreground">Igual</span> : <span className="font-medium">Cambió: {r.outcome.current ?? "—"} → {r.outcome.draft ?? "—"}</span>}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {r.changedCriteria.length === 0 ? (
                      <span className="text-muted-foreground">Ninguno</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {r.changedCriteria.map((c) => (
                          <li key={c.clave}>
                            {c.nombre}: {show(c.antes)} → {show(c.despues)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </>
              ) : (
                <td colSpan={general ? 2 : 4} className="px-3 py-2 text-red-700 dark:text-red-400">No se pudo probar: {r.error}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
