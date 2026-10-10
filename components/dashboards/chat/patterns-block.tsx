"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2, MessageSquare, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, SectionHeading } from "./block";
import { formatCount } from "@/lib/dashboards/chat/comparisons";
import { alsoLabel, type PatternCategory, type PatternVariant, type RepliesPanel } from "@/lib/dashboards/chat/patterns";
import { AUTHOR_GROUP_COLORS, AUTHOR_GROUP_LABELS, type AuthorGroup } from "@/lib/dashboards/chat/types";
import { createCategoryAndMoveAction, mergeCategoryAction, moveTextAction, renameCategoryAction } from "@/lib/actions/patterns";

/**
 * Patrones de mensajes: lo que mas se envia y que le responden (F22).
 *
 * Las correcciones (mover un texto, renombrar, unir) las hacen las Server
 * Actions que ya existian en `lib/actions/patterns.ts` y no tenian pantalla. Un
 * Member no ve ningun control: la accion lo rechazaria igual en el servidor, y
 * ofrecerle un boton que va a fallar es peor que no mostrarlo.
 */

export function PatternsSection({
  outbound,
  inbound,
  selectedCategoryId,
  onSelectCategory,
  replies,
  repliesLoading,
  isAdmin,
  authorLabel,
  quality,
}: {
  outbound: PatternCategory[];
  inbound: PatternCategory[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  replies: RepliesPanel | null;
  repliesLoading: boolean;
  isAdmin: boolean;
  authorLabel: string | null;
  quality?: React.ReactNode;
}) {
  const selected = outbound.find((c) => c.categoryId === selectedCategoryId) ?? null;

  return (
    <>
      <SectionHeading
        title="Patrones de mensajes"
        subtitle="Mensajes agrupados por lo que significan, no por cómo están escritos"
      />

      {outbound.length === 0 ? (
        <Panel>
          <p className="px-[18px] py-4 text-sm text-muted-foreground">
            {authorLabel
              ? `No hay mensajes repetidos de ${authorLabel} en este período.`
              : "Todavía no hay patrones. La clasificación agrupa los mensajes por lo que significan y corre de noche."}
          </p>
        </Panel>
      ) : (
        <div className="split">
          <Panel title="Lo que más se envía" subtitle="Tocá una categoría para ver qué le responden">
            <ul className="flex flex-col gap-0.5 px-2.5 pb-3 pt-1.5">
              {outbound.map((category) => (
                <CategoryRow
                  key={category.categoryId}
                  category={category}
                  direction="outbound"
                  categories={outbound}
                  selected={selected?.categoryId === category.categoryId}
                  onSelect={() => onSelectCategory(selected?.categoryId === category.categoryId ? null : category.categoryId)}
                  isAdmin={isAdmin}
                />
              ))}
            </ul>
          </Panel>

          <Panel
            title={selected ? "Qué le responden" : "Lo que más responden"}
            subtitle={selected ? undefined : "Todas las conversaciones del período"}
            actions={
              selected ? (
                <button type="button" onClick={() => onSelectCategory(null)} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                  Ver todas las respuestas
                </button>
              ) : undefined
            }
            footer={
              selected && replies ? (
                <span className="tabular-nums">
                  {replies.noReplyPct === null ? "Sin envíos en el período." : `${replies.noReplyPct} % no respondió a estos mensajes.`}
                </span>
              ) : undefined
            }
          >
            {selected && (
              <p className="mx-[18px] mb-2 mt-1 rounded-[10px] bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
                A <q className="text-foreground">{selected.name}</q>
              </p>
            )}

            {selected ? (
              repliesLoading ? (
                <p className="flex items-center gap-2 px-[18px] pb-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Buscando qué le responden…
                </p>
              ) : replies && replies.rows.length > 0 ? (
                <ul className="flex flex-col gap-2 px-[18px] pb-4 text-[13px]">
                  {replies.rows.map((r) => (
                    <li key={r.categoryId ?? "sin-clasificar"}>
                      <div className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{r.name}</span>
                        <b className="shrink-0 font-semibold tabular-nums">{r.pct === null ? formatCount(r.replies) : `${r.pct} %`}</b>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-[4px] bg-muted">
                        <div className="h-full rounded-[4px] bg-recv" style={{ width: `${r.pct ?? 0}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-[18px] pb-4 text-sm text-muted-foreground">Nadie respondió a estos mensajes en el período.</p>
              )
            ) : inbound.length > 0 ? (
              <ul className="flex flex-col gap-0.5 px-2.5 pb-3 pt-1.5">
                {inbound.slice(0, 8).map((category) => (
                  <CategoryRow
                    key={category.categoryId}
                    category={category}
                    direction="inbound"
                    categories={inbound}
                    selected={false}
                    isAdmin={isAdmin}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-[18px] pb-4 text-sm text-muted-foreground">Todavía no hay mensajes recibidos clasificados.</p>
            )}
          </Panel>
        </div>
      )}

      {quality}
    </>
  );
}

function authorChip(topAuthor: string | null): { label: string; color: string } | null {
  if (!topAuthor) return null;
  const group = AUTHOR_GROUP_LABELS[topAuthor as AuthorGroup];
  if (group) return { label: group, color: AUTHOR_GROUP_COLORS[topAuthor as AuthorGroup] };
  return { label: "Del equipo", color: "var(--c-team)" };
}

function CategoryRow({
  category,
  direction,
  categories,
  selected,
  onSelect,
  isAdmin,
}: {
  category: PatternCategory;
  direction: "inbound" | "outbound";
  categories: PatternCategory[];
  selected: boolean;
  onSelect?: () => void;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chip = authorChip(category.topAuthor);
  const max = Math.max(1, ...categories.map((c) => c.messageCount));

  return (
    <li className={cn("rounded-[10px]", selected && "bg-primary/10")}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Ocultar las variantes de ${category.name}` : `Ver las variantes de ${category.name}`}
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        </button>

        <div className="min-w-0 flex-1">
          {onSelect ? (
            <button type="button" onClick={onSelect} aria-pressed={selected} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left hover:bg-accent/60">
              <CategoryBody category={category} chip={chip} max={max} />
            </button>
          ) : (
            <div className="flex w-full items-center gap-2.5 px-1.5 py-2">
              <CategoryBody category={category} chip={chip} max={max} />
            </div>
          )}
        </div>

        {isAdmin && <CategoryMenu category={category} categories={categories} />}
      </div>

      {open && <VariantRows category={category} direction={direction} categories={categories} isAdmin={isAdmin} />}
    </li>
  );
}

function CategoryBody({
  category,
  chip,
  max,
}: {
  category: PatternCategory;
  chip: { label: string; color: string } | null;
  max: number;
}) {
  return (
    <>
      <span className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{category.rank}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{category.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {chip && (
            <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-muted px-[7px] py-px">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: chip.color }} aria-hidden />
              {chip.label}
            </span>
          )}
          <span>{category.textCount === 1 ? "1 variante" : `${category.textCount} variantes`}</span>
          {category.replyRate !== null && <span className="tabular-nums">{category.replyRate} % obtuvo respuesta</span>}
        </span>
        <span className="mt-1.5 block h-2 overflow-hidden rounded-[4px] bg-muted">
          <span className="block h-full rounded-[4px] bg-c-agent" style={{ width: `${(category.messageCount / max) * 100}%` }} />
        </span>
      </span>
      <span className="shrink-0 text-right font-semibold tabular-nums">
        {formatCount(category.messageCount)}
        <small className="block text-[11.5px] font-normal text-muted-foreground">envíos</small>
      </span>
    </>
  );
}

/** Las variantes de una categoria, con "Mover a…". */
function VariantRows({
  category,
  direction,
  categories,
  isAdmin,
}: {
  category: PatternCategory;
  direction: "inbound" | "outbound";
  categories: PatternCategory[];
  isAdmin: boolean;
}) {
  return (
    <ul className="mb-2.5 ml-[34px] mr-2 flex flex-col gap-0.5 border-l-2 border-border pl-2.5">
      {category.variants.map((v) => (
        <VariantRow key={v.textId} variant={v} direction={direction} categories={categories} currentId={category.categoryId} isAdmin={isAdmin} />
      ))}
      {category.variants.length === 0 && (
        <li className="py-1.5 text-xs text-muted-foreground">Sin variantes con mensajes en este período.</li>
      )}
    </ul>
  );
}

function VariantRow({
  variant,
  direction,
  categories,
  currentId,
  isAdmin,
}: {
  variant: PatternVariant;
  direction: "inbound" | "outbound";
  categories: PatternCategory[];
  currentId: string;
  isAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const also = alsoLabel(variant);

  function move(value: string) {
    if (!value) return;
    setError(null);
    start(async () => {
      const result =
        value === "__new"
          ? await createCategoryAndMoveAction(direction, window.prompt("Nombre de la categoría nueva:")?.trim() || "", variant.textId)
          : await moveTextAction(variant.textId, value);
      if (!result.ok) setError(result.error ?? "No se pudo mover el texto");
    });
  }

  return (
    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-2.5 rounded-md px-1 py-1.5 text-[13px] hover:bg-accent/40">
      <span className="min-w-0">
        <span className="block truncate">{variant.text || <em className="text-muted-foreground">sin texto</em>}</span>
        {also && <small className="block truncate text-[11.5px] text-muted-foreground">{also}</small>}
        {error && <small className="block text-[11.5px] text-bad">{error}</small>}
      </span>
      <span className="font-medium text-muted-foreground tabular-nums">{formatCount(variant.count)}</span>
      <span className="flex items-center gap-2">
        {variant.isButton && <span className="rounded-[5px] border border-border bg-muted px-1.5 text-[10px] text-muted-foreground">botón</span>}
        {variant.confidence !== null && (
          <span
            title={variant.source === "human" ? "Lo corrigió una persona" : "Confianza del modelo (orientativa)"}
            className={cn(
              "rounded-[5px] bg-muted px-1.5 text-[11.5px] font-semibold tabular-nums text-muted-foreground",
              variant.lowConfidence && "bg-warn/15 text-warn",
            )}
          >
            {Math.round(variant.confidence * 100)} %
          </span>
        )}
        {isAdmin && (
          <label>
            <span className="sr-only">Mover “{variant.text}” a otra categoría</span>
            <select
              value=""
              disabled={pending}
              onChange={(e) => move(e.target.value)}
              className="max-w-[150px] rounded-[7px] border border-input bg-background px-1.5 py-1 text-xs disabled:opacity-50"
            >
              <option value="">Mover a…</option>
              {categories
                .filter((c) => c.categoryId !== currentId)
                .map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.name}
                  </option>
                ))}
              <option value="__new">+ Nueva categoría</option>
            </select>
          </label>
        )}
      </span>
    </li>
  );
}

/** El menu ⋯ de una categoria: renombrar, describir, unir. */
function CategoryMenu({ category, categories }: { category: PatternCategory; categories: PatternCategory[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // "Otro" no se puede renombrar, unir ni archivar (F21).
  if (category.isFallback) return null;

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setOpen(false);
    start(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "No se pudo guardar");
    });
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Opciones de ${category.name}`}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
      </button>
      {error && <span className="absolute right-0 top-8 z-30 w-48 rounded-md bg-bad px-2 py-1 text-[11px] text-white">{error}</span>}
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-30 flex min-w-[210px] flex-col rounded-[10px] border border-border bg-popover p-1.5 shadow-lg">
          <button
            type="button"
            role="menuitem"
            className="rounded-[7px] px-2.5 py-1.5 text-left text-[13px] hover:bg-accent"
            onClick={() => {
              const name = window.prompt("Nombre de la categoría:", category.name)?.trim();
              if (name && name !== category.name) run(() => renameCategoryAction(category.categoryId, { name }));
              else setOpen(false);
            }}
          >
            Renombrar
          </button>
          <button
            type="button"
            role="menuitem"
            className="rounded-[7px] px-2.5 py-1.5 text-left text-[13px] hover:bg-accent"
            onClick={() => {
              const description = window.prompt("Qué entra en esta categoría (lo usa el clasificador):", category.description ?? "")?.trim();
              if (description !== undefined) run(() => renameCategoryAction(category.categoryId, { description }));
              else setOpen(false);
            }}
          >
            Editar descripción
          </button>
          <button
            type="button"
            role="menuitem"
            className="rounded-[7px] px-2.5 py-1.5 text-left text-[13px] hover:bg-accent"
            onClick={() => {
              const options = categories.filter((c) => c.categoryId !== category.categoryId && !c.isFallback);
              const target = window.prompt(
                `Unir “${category.name}” con cuál? Escribí el número:\n${options.map((c, i) => `${i + 1}. ${c.name}`).join("\n")}`,
              );
              const index = Number(target) - 1;
              if (options[index]) run(() => mergeCategoryAction(category.categoryId, options[index].categoryId));
              else setOpen(false);
            }}
          >
            Unir con otra categoría…
          </button>
        </div>
      )}
    </div>
  );
}

/** La linea de calidad del pie: ultima clasificacion, precision y link a Settings. */
export function QualityLineRow({
  lastRunAt,
  classifiedToday,
  unclassifiedPending,
  accuracyPct,
  reviewedCount,
  correctedPct,
}: {
  lastRunAt: string | null;
  classifiedToday: number;
  unclassifiedPending: number;
  accuracyPct: number | null;
  reviewedCount: number;
  correctedPct: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 px-1 py-0.5 text-xs text-muted-foreground">
      <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Última clasificación:{" "}
        <b className="font-semibold text-foreground">
          {lastRunAt ? new Date(lastRunAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "todavía ninguna"}
        </b>
      </span>
      <Dot />
      <span>
        Precisión estimada{" "}
        <b className="font-semibold text-foreground tabular-nums">{accuracyPct === null ? "sin revisiones" : `${accuracyPct} %`}</b>
        {reviewedCount > 0 && <span className="tabular-nums"> sobre {reviewedCount} textos revisados</span>}
      </span>
      {correctedPct !== null && (
        <>
          <Dot />
          <span className="tabular-nums">
            <b className="font-semibold text-foreground">{correctedPct} %</b> corregidos
          </span>
        </>
      )}
      <Dot />
      <span className="tabular-nums">
        <b className="font-semibold text-foreground">{unclassifiedPending}</b> sin clasificar
        {classifiedToday > 0 && <span> · {classifiedToday} clasificados hoy</span>}
      </span>
      <Link href="/dashboard/agents/tareas/message_classification" className="ml-auto font-medium text-primary underline-offset-2 hover:underline">
        Ver calidad y configuración →
      </Link>
    </div>
  );
}

function Dot() {
  return <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/60" aria-hidden />;
}
