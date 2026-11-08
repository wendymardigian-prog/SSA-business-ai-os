/**
 * El selector de grupos del editor de automatizaciones, agrupado por comunidad (00344). PURO.
 */

import type { EditorGroup } from "@/lib/whatsapp-groups/editor-types";

export interface EditorGroupSection {
  label: string;
  groups: Array<{ id: string; label: string }>;
}

/**
 * Una seccion por comunidad («Comunidad X», con «Avisos» primero) y al final «Grupos sueltos». Si hay mas de un
 * numero, cada grupo dice de cual es.
 */
export function editorGroupSections(groups: readonly EditorGroup[]): EditorGroupSection[] {
  const multiChannel = new Set(groups.map((g) => g.channelLabel)).size > 1;
  const byCommunity = new Map<string, EditorGroup[]>();
  const loose: EditorGroup[] = [];
  for (const group of groups) {
    if (group.communitySubject) {
      const list = byCommunity.get(group.communitySubject) ?? [];
      list.push(group);
      byCommunity.set(group.communitySubject, list);
    } else loose.push(group);
  }
  const name = (g: EditorGroup) => {
    const base = g.kind === "announce" ? "Avisos" : g.subject;
    return multiChannel ? `${base} · ${g.channelLabel}` : base;
  };
  const byName = (a: EditorGroup, b: EditorGroup) =>
    Number(b.kind === "announce") - Number(a.kind === "announce") || a.subject.localeCompare(b.subject, "es", { sensitivity: "base" });
  const sections: EditorGroupSection[] = [...byCommunity.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es", { sensitivity: "base" }))
    .map(([community, list]) => ({ label: `Comunidad ${community}`, groups: [...list].sort(byName).map((g) => ({ id: g.id, label: name(g) })) }));
  if (loose.length > 0) sections.push({ label: "Grupos sueltos", groups: [...loose].sort(byName).map((g) => ({ id: g.id, label: name(g) })) });
  return sections;
}
