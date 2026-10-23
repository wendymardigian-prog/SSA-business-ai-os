"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryKey, MAX_CATEGORIES_PER_FLOW, MAX_CATEGORY_LENGTH, normalizeCategories, normalizeCategory } from "@/lib/flows/categories";
import { matchesQuery } from "@/lib/flows/search";

/**
 * Las categorias de una automatizacion, como etiquetas: se escriben a mano (Enter o coma) o se eligen de la lista,
 * que muestra las que ya usan las demas automatizaciones (de la mas usada a la menos) y se filtra mientras se escribe.
 * Si lo escrito no existe, la lista ofrece crearla. Teclado: flechas para moverse, Enter para elegir, Escape cierra,
 * Backspace con el campo vacio saca la ultima.
 */
export function CategoryInput({
  values,
  onChange,
  suggestions,
  label = "Categorías",
}: {
  values: string[];
  onChange: (values: string[]) => void;
  /** Las categorias que ya existen en el negocio (`listFlowCategories`). */
  suggestions: Array<{ name: string; count: number }>;
  label?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const full = values.length >= MAX_CATEGORIES_PER_FLOW;

  const taken = useMemo(() => new Set(values.map(categoryKey)), [values]);
  const typed = normalizeCategory(text);
  const options = useMemo(() => {
    const matches = suggestions.filter((s) => !taken.has(categoryKey(s.name)) && matchesQuery([s.name], text)).slice(0, 8);
    const exists = typed ? suggestions.some((s) => categoryKey(s.name) === categoryKey(typed)) || taken.has(categoryKey(typed)) : true;
    return [...matches.map((s) => ({ kind: "pick" as const, name: s.name, count: s.count })), ...(!exists && typed ? [{ kind: "create" as const, name: typed, count: 0 }] : [])];
  }, [suggestions, taken, text, typed]);

  function add(name: string) {
    onChange(normalizeCategories([...values, name]));
    setText("");
    setActive(0);
    inputRef.current?.focus();
  }

  return (
    <div className="relative">
      <div
        className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((value) => (
          <span key={value} className="inline-flex h-7 max-w-[14rem] items-center gap-1 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary">
            <span className="truncate">{value}</span>
            <button type="button" onClick={() => onChange(values.filter((v) => v !== value))} aria-label={`Quitar la categoría ${value}`} className="rounded-full p-0.5 hover:bg-primary/20">
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          value={text}
          disabled={full}
          maxLength={MAX_CATEGORY_LENGTH + 5}
          onChange={(e) => {
            const next = e.target.value;
            if (next.includes(",")) {
              const parts = next.split(",");
              const last = parts.pop() ?? "";
              onChange(normalizeCategories([...values, ...parts]));
              setText(last);
            } else setText(next);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const option = open ? options[active] : undefined;
              if (option) add(option.name);
              else if (typed) add(typed);
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "Backspace" && text === "" && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          placeholder={full ? `Máximo ${MAX_CATEGORIES_PER_FLOW}` : values.length === 0 ? "Escribí o elegí una categoría…" : "Agregar otra…"}
          className="min-w-[9rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none disabled:cursor-not-allowed"
        />
      </div>
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg">
          {options.map((option, index) => (
            <li
              key={`${option.kind}:${option.name}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add(option.name);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm", index === active ? "bg-accent" : "")}
            >
              {option.kind === "create" ? (
                <span className="inline-flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Crear «{option.name}»
                </span>
              ) : (
                <>
                  <span className="truncate">{option.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{option.count === 1 ? "1 automatización" : `${option.count} automatizaciones`}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
