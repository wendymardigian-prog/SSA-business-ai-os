// @plantilla-quitar(servicios)
/**
 * Qué módulos incluye la variante de una persona (F101), puro: la fila Programa de cada variante dice «todos» o una
 * lista; con dos servicios del mismo producto vale la UNIÓN. Es lo que arma `program_item_unlocked` en la base.
 */
export function includedModules(variantSections: Array<Array<{ section: string; included?: boolean; content?: { modules?: "all" | string[] } }>>): "all" | Set<string> {
  const ids = new Set<string>();
  let any = false;
  for (const sections of variantSections) {
    const program = sections.find((s) => s.section === "program" && s.included !== false);
    if (!program) continue;
    any = true;
    const m = program.content?.modules;
    if (!Array.isArray(m)) return "all";
    for (const id of m) ids.add(id);
  }
  return any ? ids : new Set();
}

export function moduleIncluded(included: "all" | Set<string>, moduleId: string): boolean {
  return included === "all" || included.has(moduleId);
}
