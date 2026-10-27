/** Iniciales y color de una persona, para los avatares de Tareas. PURO. */

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const PALETTE = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#ca8a04", "#4f46e5"];

/** Siempre el mismo color para la misma persona. */
export function colorOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** «Ana, Bruno y 2 más» (para el tooltip de los seguidores). */
export function summarizeNames(names: readonly string[], max = 3): string {
  if (names.length === 0) return "";
  if (names.length <= max) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} y ${names.length - max} más`;
}
