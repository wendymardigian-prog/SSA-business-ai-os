#!/usr/bin/env node
// Hook de Claude Code (PostToolUse sobre Bash, solo para `gh pr merge`).
// Despues de mergear un PR, le recuerda a Claude que pregunte si hay que
// actualizar la plantilla de clientes B2B. Nunca sincroniza solo: publicar es
// una accion hacia afuera y la decide una persona.
// Este archivo y .claude/settings.json NO viajan a la plantilla de clientes
// (ver scripts/export-template.mjs).

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let command = "";
  try {
    command = JSON.parse(input)?.tool_input?.command ?? "";
  } catch {
    process.exit(0); // sin payload legible, no molestamos
  }
  if (!/\bgh\s+pr\s+merge\b/.test(command)) process.exit(0);

  const context =
    "Se acaba de mergear un PR a main. Antes de cerrar este turno, preguntale a Wendy " +
    "si quiere actualizar la plantilla de clientes B2B (Scaling-Systems/BAIOS) con lo que entro. " +
    "Con una sola pregunta y una recomendacion: si el cambio toca lo que ve un cliente " +
    "(app, migraciones, .claude/commands/setup.md, README), recomendar que si; si es solo interno " +
    "(docs/, scripts de verificacion, BITACORA), recomendar que no hace falta. " +
    "No sincronices sin su OK. Procedimiento en docs/plantilla-clientes.md " +
    "(`node scripts/sync-template.mjs --template=../BAIOS-b2b`, desde main y al dia; " +
    "primero mostrar el resumen y recien con su OK hacer commit y push).";

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context },
    }),
  );
});
