/** Sin acentos y en minusculas, para buscar y ordenar texto (Extra A). */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
