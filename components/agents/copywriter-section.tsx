"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCopywriterConfig } from "@/lib/actions/copywriter-config";
import { readCopywriterConfig } from "@/lib/content/copywriter";

/**
 * La configuracion del copywriter (E3).
 *
 * Tiene su propio formulario y su propio boton, aparte del de la
 * configuracion del agente de conversacion: nada de lo que hay aca —la voz,
 * las frases prohibidas, las etiquetas de conocimiento— significa algo para
 * un agente que atiende leads, y al reves tampoco.
 */

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

export interface CopywriterSectionProps {
  agentId: string;
  agent: {
    system_prompt?: string | null;
    config?: unknown;
    knowledge_tags?: string[] | null;
    daily_cost_limit_usd?: number | null;
    monthly_cost_limit_usd?: number | null;
  };
  /** El respaldo de la voz de marca, de antes de que existiera el agente. */
  workspaceSettings: unknown;
  /** Las etiquetas que existen en la base de conocimiento. */
  availableTags: string[];
}

export function CopywriterSection({
  agentId,
  agent,
  workspaceSettings,
  availableTags,
}: CopywriterSectionProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const initial = readCopywriterConfig(agent, workspaceSettings);

  const [voice, setVoice] = useState(initial.brand.voice ?? "");
  const [audience, setAudience] = useState(initial.brand.audience ?? "");
  const [avoid, setAvoid] = useState(initial.brand.avoid ?? "");
  const [examples, setExamples] = useState((initial.brand.examples ?? []).join("\n"));
  const [bannedPhrases, setBannedPhrases] = useState(initial.guardrails.bannedPhrases.join("\n"));
  const [bannedClaims, setBannedClaims] = useState(initial.guardrails.bannedClaims.join("\n"));
  const [maxLength, setMaxLength] = useState(
    initial.guardrails.maxLength === null ? "" : String(initial.guardrails.maxLength),
  );
  const [tags, setTags] = useState<string[]>(initial.knowledgeTags);
  const [autoOnApprove, setAutoOnApprove] = useState(initial.autoOnApprove);
  const [daily, setDaily] = useState(
    agent.daily_cost_limit_usd === null || agent.daily_cost_limit_usd === undefined
      ? ""
      : String(agent.daily_cost_limit_usd),
  );
  const [monthly, setMonthly] = useState(
    agent.monthly_cost_limit_usd === null || agent.monthly_cost_limit_usd === undefined
      ? ""
      : String(agent.monthly_cost_limit_usd),
  );

  const numberOrNull = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  function save() {
    setMessage(null);
    start(async () => {
      const result = await updateCopywriterConfig({
        agentId,
        brand: { voice, audience, avoid, examples },
        guardrails: { bannedPhrases, bannedClaims, maxLength: numberOrNull(maxLength) },
        knowledgeTags: tags,
        autoOnApprove,
        dailyCostLimitUsd: numberOrNull(daily),
        monthlyCostLimitUsd: numberOrNull(monthly),
      });

      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({ tone: "ok", text: "Configuración guardada." });
      router.refresh();
    });
  }

  return (
    <section className="space-y-6 rounded-xl border border-border p-4">
      <div>
        <h3 className="text-sm font-semibold">Voz de la marca</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Con esto escribe. Cuanto más concreto, menos vas a tener que corregir.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium">Cómo escribís</span>
        <textarea
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          rows={3}
          placeholder="Directa, sin vueltas, de vos. Nada de jerga de agencia."
          className={inputClass}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">Para quién</span>
        <input
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="Dueños de negocios chicos que pierden leads en planillas"
          className={inputClass}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">Ejemplos de posts que funcionaron</span>
        <textarea
          value={examples}
          onChange={(e) => setExamples(e.target.value)}
          rows={4}
          placeholder="Uno por línea."
          className={inputClass}
        />
        <span className="block text-[11px] text-muted-foreground">
          Uno por línea. Es lo que más mueve el resultado.
        </span>
      </label>

      <div className="border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Límites</h3>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          Si el copy los pasa por alto, igual se guarda: te lo avisa al lado para que lo corrijas.
        </p>

        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Frases prohibidas</span>
            <textarea
              value={bannedPhrases}
              onChange={(e) => setBannedPhrases(e.target.value)}
              rows={3}
              placeholder="Una por línea."
              className={inputClass}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">Promesas que no se pueden hacer</span>
            <textarea
              value={bannedClaims}
              onChange={(e) => setBannedClaims(e.target.value)}
              rows={3}
              placeholder="Resultados garantizados&#10;Ingresos en 30 días"
              className={inputClass}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">Largo máximo del caption base</span>
            <input
              type="number"
              min={1}
              value={maxLength}
              onChange={(e) => setMaxLength(e.target.value)}
              placeholder="Sin límite"
              className={inputClass}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">Qué evitar</span>
            <input
              value={avoid}
              onChange={(e) => setAvoid(e.target.value)}
              placeholder="Emojis de más, signos de exclamación dobles"
              className={inputClass}
            />
          </label>
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Qué sabe del negocio</h3>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          Lee los documentos de la base de conocimiento que tengan estas etiquetas.
        </p>
        {availableTags.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Todavía no hay documentos con etiquetas en Conocimiento.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map((tag) => {
              const on = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTags(on ? tags.filter((t) => t !== tag) : [...tags, tag])}
                  className={
                    on
                      ? "rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                      : "rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
                  }
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Cuándo escribe</h3>
        <label className="mt-3 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={autoOnApprove}
            onChange={(e) => setAutoOnApprove(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-sm">
            Producir el copy automáticamente al aprobar una idea
            <span className="block text-xs text-muted-foreground">
              Apagado, escribe solo cuando se lo pedís con el botón. Prendido, cada idea aprobada
              gasta del presupuesto de IA.
            </span>
          </span>
        </label>
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Topes de gasto propios</h3>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          Además de los del negocio. Se respeta el más bajo de los dos.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Por día (USD)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              placeholder="Sin tope"
              className={inputClass}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Por mes (USD)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="Sin tope"
              className={inputClass}
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Guardar configuración
        </button>
        {message && (
          <span
            role={message.tone === "error" ? "alert" : "status"}
            className={
              message.tone === "error"
                ? "text-xs text-red-700 dark:text-red-400"
                : "text-xs text-emerald-700 dark:text-emerald-400"
            }
          >
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
