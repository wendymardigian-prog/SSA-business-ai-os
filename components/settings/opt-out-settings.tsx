"use client";

import { useState, useTransition } from "react";
import { Plus, X, Ban, Loader2, Check } from "lucide-react";
import { updateOptOutPhrases, findMatchingOptOutPhrase } from "@/lib/actions/opt-out";
import { ActionError } from "@/components/contacts/ui";

/**
 * Frases que marcan un contacto como "no contactar" (F18).
 *
 * El probador de abajo no es un adorno. Una frase corta parece razonable hasta
 * que se ve a quien atrapa: "baja" marca a quien escribe "mi hermana trabaja
 * con ustedes". Usa la misma funcion de la base que corre el receptor, asi que
 * lo que muestra es lo que va a pasar.
 */

export function OptOutSettings({ phrases: initial }: { phrases: string[] }) {
  const [phrases, setPhrases] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const dirty = phrases.join("|") !== initial.join("|");

  function add() {
    const phrase = draft.trim().toLowerCase().replace(/\s+/g, " ");
    if (!phrase) return;
    if (!phrases.includes(phrase)) setPhrases((prev) => [...prev, phrase]);
    setDraft("");
    setSaved(false);
  }

  function remove(phrase: string) {
    setPhrases((prev) => prev.filter((p) => p !== phrase));
    setSaved(false);
  }

  function save() {
    setError(null);
    start(async () => {
      const result = await updateOptOutPhrases(phrases);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <Ban className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Frases de &quot;no contactar&quot;</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Si un mensaje entrante contiene alguna de estas frases, el contacto queda marcado
        como &quot;no contactar&quot; y se le pausan las secuencias. Se comparan como palabras
        completas, sin distinguir mayúsculas ni acentos.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Agregar una frase..."
          aria-label="Nueva frase de no contactar"
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={add}
          disabled={!draft.trim()}
          aria-label="Agregar frase"
          className="rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {phrases.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {phrases.map((phrase) => (
            <span
              key={phrase}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium"
            >
              {phrase}
              <button
                onClick={() => remove(phrase)}
                aria-label={`Quitar ${phrase}`}
                className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground/70">
          Sin frases: ningún contacto se va a marcar solo. La marca manual desde la ficha
          sigue funcionando.
        </p>
      )}

      <PhraseTester phrases={phrases} />

      {error && <div className="mt-3"><ActionError message={error} /></div>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending || !dirty}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar frases
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <Check className="h-4 w-4" />
            Guardado
          </span>
        )}
      </div>
    </section>
  );
}

/** Probá un mensaje contra la lista antes de guardarla. */
function PhraseTester({ phrases }: { phrases: string[] }) {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ phrase: string | null } | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    const text = message.trim();
    if (!text || pending) return;

    // Sin useTransition a proposito: el resultado se pinta despues de esperar
    // al servidor, y una transicion descarta ese render cuando la accion
    // ademas revalida la pantalla.
    setPending(true);
    try {
      setResult(await findMatchingOptOutPhrase(text, phrases));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs font-medium text-muted-foreground">Probar un mensaje</p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder="mi hermana trabaja con ustedes"
          aria-label="Mensaje de prueba"
          className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={run}
          disabled={pending || !message.trim() || phrases.length === 0}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Probar"}
        </button>
      </div>

      {result && (
        <p className="mt-2 text-xs">
          {result.phrase ? (
            <span className="text-destructive">
              Este mensaje marca el contacto, por la frase &quot;{result.phrase}&quot;.
            </span>
          ) : (
            <span className="text-muted-foreground">
              Este mensaje no marca nada. El contacto sigue como está.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
