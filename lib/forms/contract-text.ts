/**
 * El texto de un contrato, normalizado (F8).
 *
 * Lo que se hashea es EXACTAMENTE lo que se guarda: NFC, saltos de línea `\n` y
 * sin espacios al final de cada línea. Módulo puro (el editor lo usa en el
 * navegador); el SHA-256 está aparte, en `contract-hash.ts`, que es de servidor.
 */
export function normalizeContractText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}
