import type { BranchExplanation, ConditionExplanation, PathsExplanation } from "@/lib/automations/explain-paths";

/**
 * El resultado de "Probar condiciones", en palabras: por cada nodo Condiciones,
 * por que camino iria y cada condicion con su ✓ o ✗. Solo pinta lo que
 * `explainPaths` ya decidio.
 */

function ConditionLine({ condition }: { condition: ConditionExplanation }) {
  const tone = condition.ok ? "text-green-600 dark:text-green-400" : condition.status === "fail" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className={`mt-px font-semibold ${tone}`} aria-label={condition.ok ? "se cumple" : "no se cumple"}>
        {condition.ok ? "✓" : "✗"}
      </span>
      <span>
        {condition.text}
        {condition.reason && <span className={`ml-1 ${tone}`}>({condition.reason})</span>}
      </span>
    </li>
  );
}

function BranchView({ branch, title }: { branch: BranchExplanation; title: string }) {
  return (
    <section className="rounded-lg border border-border p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        {branch.inside && <span className="ml-1 normal-case tracking-normal">· {branch.inside}</span>}
      </p>
      <p className="mt-1 text-sm">
        {branch.isElse ? (
          <>
            Ningún camino se cumple: iría por <strong>{branch.takenLabel}</strong>
          </>
        ) : (
          <>
            Iría por <strong>{branch.takenLabel}</strong>
          </>
        )}
      </p>
      <ol className="mt-2 space-y-2">
        {branch.paths.map((path) => (
          <li key={path.id} className="rounded-md bg-muted/50 p-2">
            <p className="text-xs font-medium">
              {path.label} <span className="font-normal text-muted-foreground">· {path.passed ? "se cumple" : "no se cumple"}</span>
              {path.conditions.length > 1 && <span className="font-normal text-muted-foreground"> · {path.logic === "or" ? "alcanza con una" : "tienen que cumplirse todas"}</span>}
            </p>
            <ul className="mt-1 space-y-0.5">
              {path.conditions.length === 0 ? <li className="text-xs text-muted-foreground">Sin condiciones.</li> : path.conditions.map((c, i) => <ConditionLine key={i} condition={c} />)}
            </ul>
          </li>
        ))}
      </ol>
      {!branch.isElse && <p className="mt-2 text-[11px] text-muted-foreground">Los caminos de más abajo no se miran: va por el primero que se cumple.</p>}
    </section>
  );
}

export function ExplanationView({ explanation }: { explanation: PathsExplanation }) {
  const total = explanation.branches.length;
  if (total === 0) return <p className="text-sm text-muted-foreground">No hay ningún paso Condiciones al que se llegue con estos datos.</p>;
  return (
    <div className="space-y-3">
      {explanation.branches.map((branch, index) => (
        <BranchView key={branch.stepId} branch={branch} title={total > 1 ? `${branch.name} (${index + 1} de ${total})` : branch.name} />
      ))}
    </div>
  );
}
