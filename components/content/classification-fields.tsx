"use client";

import { useState, useTransition } from "react";
import { createPillar } from "@/lib/actions/content-taxonomy";
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
 * El selector de pilar termina en "+ Crear": cargar una idea no se frena por
 * un pilar que falta. Solo aparece para quien puede cambiar la configuracion
 * (`settings.general`); para el resto el selector ofrece lo que hay y nada mas.
 *
 * El de PRODUCTO (las ofertas de antes) no se crea desde aca: un producto lleva
 * precio y estado, y se carga en Ajustes -> Productos. Solo se ofrecen los
 * activos (inactivo y discontinuado son archivados), mas el que la pieza ya
 * tiene.
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

/**
 * La version compacta (el drawer de la pieza): etiqueta chica arriba y un campo
 * de una linea, sin pistas debajo. Lo que la version comun explica en un
 * parrafo, aca va en el tooltip del campo (`title`).
 */
const compactInput = "h-8 w-full rounded-md border border-border bg-background px-2 text-xs disabled:opacity-70";

function CompactField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-0.5 block truncate text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function FormatField({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const input = (
    <>
      <input
        list="formatos-de-contenido"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Reel"
        className={compact ? compactInput : fieldInput}
      />
      <datalist id="formatos-de-contenido">
        {FORMAT_SUGGESTIONS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  );

  return compact ? <CompactField label="Formato">{input}</CompactField> : <DialogField label="Formato">{input}</DialogField>;
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
  hint,
  compact,
  onChange,
}: {
  label: string;
  none: string;
  singular: string;
  feminine: boolean;
  items: TaxonomyItem[];
  value: string;
  /** Si ofrece "+ Crear" al final. Sin `create`, no se ofrece aunque sea true. */
  canCreate: boolean;
  disabled?: boolean;
  create?: (name: string) => Promise<
    { ok: true; data: { id: string; name: string; color?: string | null } } | { ok: false; error: string }
  >;
  hint?: string;
  /** Una linea, sin pista debajo: la pista pasa al tooltip. */
  compact?: boolean;
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
    if (!create) return;
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

  const select = (
    <select
      value={creating ? NEW : value}
      disabled={disabled}
      title={compact ? hint : undefined}
      onChange={(e) => {
        if (e.target.value === NEW) {
          setCreating(true);
          return;
        }
        setCreating(false);
        onChange(e.target.value);
      }}
      className={compact ? compactInput : fieldInput}
    >
      <option value="">{none}</option>
      {options.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
          {item.archivedAt ? " (archivad" + (feminine ? "a)" : "o)") : ""}
        </option>
      ))}
      {canCreate && create && <option value={NEW}>+ Crear {singular}…</option>}
    </select>
  );

  return (
    <div className="min-w-0 space-y-1">
      {compact ? (
        <CompactField label={label}>{select}</CompactField>
      ) : (
        <DialogField label={label} hint={hint}>
          {select}
        </DialogField>
      )}

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
            className={cn(compact ? compactInput : fieldInput, "min-w-0 flex-1")}
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
  compact,
}: {
  value: ClassificationValue;
  onChange: (patch: Partial<ClassificationValue>) => void;
  taxonomy: TaxonomyOptions;
  disabled?: boolean;
  /**
   * Las redes a elegir, solo en la idea. En la pieza las redes son sus filas
   * de "Redes", asi que no se repiten aca.
   */
  /** Una sola franja de campos chicos, para el drawer de la pieza. */
  compact?: boolean;
  platforms?: {
    /** Las cinco redes (Contenido v4, C1): siempre se puede elegir cualquiera. */
    available: string[];
    /** Las que no tienen cuenta conectada: se marcan "a mano", no se ocultan. */
    manual: string[];
    selected: string[];
    onChange: (next: string[]) => void;
  };
}) {
  const stage = funnelStageInfo(value.funnelStage);

  // El drawer de la pieza: todo en una franja de una o dos lineas, en el orden
  // en que se piensa (de donde sale, que es, para que sirve). La descripcion de
  // la etapa va en el tooltip y no en un parrafo que ocupa una linea mas.
  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6" data-testid="classification-compact">
        <CompactField label="Referencia" className="col-span-2">
          <input
            value={value.reference}
            disabled={disabled}
            onChange={(e) => onChange({ reference: e.target.value })}
            placeholder="https://… o de dónde salió"
            title="Un link o de dónde salió la idea."
            className={compactInput}
          />
        </CompactField>
        <FormatField compact value={value.format} onChange={(format) => onChange({ format })} disabled={disabled} />
        <TaxonomySelect
          compact
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
        <CompactField label="Etapa del embudo">
          <select
            value={value.funnelStage}
            disabled={disabled}
            title={stage ? `${stage.label}: ${stage.description}` : "En qué momento del camino de compra está quien lo ve."}
            onChange={(e) => onChange({ funnelStage: e.target.value })}
            className={compactInput}
          >
            <option value="">Sin etapa</option>
            {FUNNEL_STAGES.map((s) => (
              <option key={s.value} value={s.value} title={s.description}>
                {s.value.toUpperCase()} · {s.label}
              </option>
            ))}
          </select>
        </CompactField>
        <TaxonomySelect
          compact
          label="Producto"
          none="Sin producto"
          singular="producto"
          feminine={false}
          items={taxonomy.offers}
          value={value.offerId}
          canCreate={false}
          disabled={disabled}
          hint="Se cargan, con su precio, en Ajustes → Productos."
          onChange={(offerId) => onChange({ offerId })}
        />
      </div>
    );
  }

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
          label="Producto"
          none="Sin producto"
          singular="producto"
          feminine={false}
          items={taxonomy.offers}
          value={value.offerId}
          canCreate={false}
          disabled={disabled}
          hint="Se cargan, con su precio, en Ajustes → Productos."
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
                  {s.value.toUpperCase()} · {s.label}
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
        <DialogField
          label="Redes"
          hint="A cuáles apunta. Pueden ser redes todavía no conectadas: al aprobar la idea pasan a la pieza, y ahí se define la fecha de cada una."
        >
          <div className="flex flex-wrap gap-1.5">
            {platforms.available.map((platform) => {
              const on = platforms.selected.includes(platform);
              const manual = platforms.manual.includes(platform);
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
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full",
                    on ? "ring-2 ring-primary" : "opacity-60 hover:opacity-100",
                  )}
                >
                  <NetworkBadge platform={platform} />
                  {manual && <span className="text-[10px] text-amber-700 dark:text-amber-400">a mano</span>}
                </button>
              );
            })}
          </div>
        </DialogField>
      )}
    </div>
  );
}
