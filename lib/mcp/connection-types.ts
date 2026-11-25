/** Una conexión MCP tal como la muestra Mi cuenta → Conexiones (los tipos viven fuera del archivo "use server"). */
export interface McpConnectionView {
  id: string;
  clientName: string;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * El nombre corto del conector para `claude mcp add` (la marca de la instalación en minúsculas, sin espacios ni
 * acentos). White label: nunca un nombre escrito en el código. Pura.
 */
export function mcpCliName(brand: string): string {
  const slug = brand
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "crm";
}
