"use client";

import { useState, useTransition } from "react";
import { createOffer, createPillar } from "@/lib/actions/content-taxonomy";
import { FORMAT_SUGGESTIONS } from "@/lib/content/ideas";
import { FUNNEL_STAGES, funnelStageInfo } from "@/lib/content/classification";
import { selectableItems, TAXONOMY_NAME_MAX, type TaxonomyItem } from "@/lib/content/taxonomy";
import { cn } from "@/lib/utils";
import { DialogField, fieldInput } from "./dialog";
import { NetworkBadge } from "./network-badge";

/**
 * Los campos de clasificacion de una idea o una pieza (F91).
 *
 * Los mismos en las dos: formato, pilar, oferta, etapa del embudo, referencia
 * y, solo en la idea, las redes a las que apunta. Es un componente suelto a
 * proposito: lo usa el dialogo de la idea y el editor de la pieza, y lo van a
 * usar los drawers de B13 sin reescribirlo.
 *
 * Los selectores de pilar y oferta terminan en "+ Crear": cargar una idea no
 * se frena por un pilar que falta. Solo aparece para quien puede cambiar la
 * configuracion (`settings.manage`); para el resto el selector ofrece lo que
 * hay y nada mas.
 */

export interface ClassificationValue {
  format: string;
  pillarId: string;
  offerId: string;
  funnelStage: string;
  reference: string;
}

export interface TaxonomyOptions {
  pillars: TaxonomyItem[];
  offers: TaxonomyItem[];
  /** Si puede crear un pilar u oferta desde el selector. */
  canCreate: boolean;
}

const NEW = "__nuevo__";

export function FormatField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <DialogField label="Formato">
      <>
        <input
          list="formatos-de-contenido"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Reel"
          className={fieldInput}
        />
        <datalist id="formatos-de-contenido">
          {FORMAT_SUGGESTIONS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </>
    </DialogField>
  );
}

/** Un selector de pilar u oferta con "+ Crear" al final. */
function TaxonomySelect({
  label,
  none,
  singular,
  feminine,
  items,
  value,
  canCreate,
  disabled,
  create,
  onChange,
}: {
  label: string;
  none: string;
  singular: string;
  feminine: boolean;
  items: TaxonomyItem[];
  value: string;
  canCreate: boolean;
  disabled?: boolean;
  create: (name: string) => Promise<
    { ok: true; data: { id: string; name: string; color?: string | null } } | { ok: false; error: string }
  >;
  onChange: (id: string) => void;
}) {
  // Lo recien creado se ve ya, sin esperar a que la pagina vuelva a leer.
  const [added, setAdded] = useState<TaxonomyItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const all = [...items, ...added.filter((a) => !items.some((i) => i.id === a.id))];
  const options = selectableItems(all, value);

  function submit() {
    setError(null);
    start(async () => {
      const result = await create(name);
      if (!result.ok) return setError(result.error);
      setAdded((prev) => [
        ...prev,
        { id: result.data.id, name: result.data.name, color: result.data.color ?? null, archivedAt: null },
      ]);
      onChange(result.data.id);
      setCreating(false);
      setName("");
    });
  }

  return (
    <div className="space-y-1">
      <DialogField label={label}>
        <select
          value={creating ? NEW : value}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value === NEW) {
              setCreating(true);
              return;
            }
            setCreating(false);
            onChange(e.target.value);
          }}
          className={fieldInput}
        >
          <option value="">{none}</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.archivedAt ? " (archivad" + (feminine ? "a)" : "o)") : ""}
            </option>
          ))}
          {canCreate && <option value={NEW}>+ Crear {singular}…</option>}
        </select>
      </DialogField>

      {creating && (
        <div className="flex gap-1.5">
          <label className="sr-only" htmlFor={`nuevo-${singular}`}>
            Nombre {feminine ? "de la" : "del"} {singular} {feminine ? "nueva" : "nuevo"}
          </label>
          <input
            id={`nuevo-${singular}`}
            autoFocus
            value={name}
            maxLength={TAXONOMY_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (name.trim()) submit();
              }
            }}
            placeholder={`Nombre ${feminine ? "de la" : "del"} ${singular}`}
            className={cn(fieldInput, "min-w-0 flex-1")}
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending || !name.trim()}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Crear
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setError(null);
            }}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancelar
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function ClassificationFields({
  value,
  onChange,
  taxonomy,
  disabled,
  platforms,
}: {
  value: ClassificationValue;
  onChange: (patch: Partial<ClassificationValue>) => void;
  taxonomy: TaxonomyOptions;
  disabled?: boolean;
  /**
   * Las redes a elegir, solo en la idea. En la pieza las redes son sus filas
   * de "Redes", asi que no se repiten aca.
   */
  platforms?: { available: string[]; selected: string[]; onChange: (next: string[]) => void };
}) {
  const stage = funnelStageInfo(value.funnelStage);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormatField value={value.format} onChange={(format) => onChange({ format })} disabled={disabled} />
        <TaxonomySelect
          label="Pilar"
          none="Sin pilar"
          singular="pilar"
          feminine={false}
          items={taxonomy.pillars}
          value={value.pillarId}
          canCreate={taxonomy.canCreate}
          disabled={disabled}
          create={(name) => createPillar({ name })}
          onChange={(pillarId) => onChange({ pillarId })}
        />
        <TaxonomySelect
          label="Oferta"
          none="Sin oferta"
          singular="oferta"
          feminine
          items={taxonomy.offers}
          value={value.offerId}
          canCreate={taxonomy.canCreate}
          disabled={disabled}
          create={(name) => createOffer({ name })}
          onChange={(offerId) => onChange({ offerId })}
        />
        <div className="space-y-1">
          <DialogField label="Etapa del embudo">
            <select
              value={value.funnelStage}
              disabled={disabled}
              onChange={(e) => onChange({ funnelStage: e.target.value })}
              className={fieldInput}
            >
              <option value="">Sin etapa</option>
              {FUNNEL_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </DialogField>
        </div>
      </div>

      {/* La descripcion bajo el selector: sin ella tofu/mofu/bofu no le dice
          nada a quien no es del rubro. */}
      {stage && (
        <p className="text-[11px] text-muted-foreground" data-testid="funnel-description">
          <b className="font-medium text-foreground">{stage.label}:</b> {stage.description}
        </p>
      )}

      <DialogField label="Referencia" hint="Un link o de dónde salió.">
        <input
          value={value.reference}
          disabled={disabled}
          onChange={(e) => onChange({ reference: e.target.value })}
          placeholder="https://…"
          className={fieldInput}
        />
      </DialogField>

      {platforms && (
        <DialogField label="Redes" hint="A cuáles apunta. Al aprobar la idea pasan a la pieza.">
          {platforms.available.length === 0 ? (
            <p className="text-xs text-muted-foreground">Todavía no hay ninguna red conectada.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {platforms.available.map((platform) => {
                const on = platforms.selected.includes(platform);
                return (
                  <button
                    key={platform}
                    type="button"
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() =>
                      platforms.onChange(
                        on ? platforms.selected.filter((p) => p !== platform) : [...platforms.selected, platform],
                      )
                    }
                    className={on ? "rounded-full ring-2 ring-primary" : "rounded-full opacity-60 hover:opacity-100"}
                  >
                    <NetworkBadge platform={platform} />
                  </button>
                );
              })}
            </div>
          )}
        </DialogField>
      )}
    </div>
  );
}
