#!/usr/bin/env node
// Hook de Claude Code (UserPromptSubmit): en cada pedido nuevo le recuerda a Claude el
// protocolo de trabajo (preguntas y plan primero). Cubre el hueco del modo plan por defecto:
// despues de aprobar un plan la sesion sale de modo plan, y sin este aviso el pedido siguiente
// podria ir directo a editar.
//
// Regla de oro: este archivo NUNCA puede trabar a la persona. Cualquier cosa rara
// (sin entrada, JSON roto, pedido muy corto, comando con "/") termina en silencio con exit 0.

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("error", () => process.exit(0));
process.stdin.on("end", () => {
  let prompt = "";
  try {
    prompt = String(JSON.parse(input)?.prompt ?? "").trim();
  } catch {
    process.exit(0);
  }
  if (prompt.length < 15 || prompt.startsWith("/")) process.exit(0);

  const context =
    "Recordatorio del protocolo de trabajo (.claude/rules/00-protocolo-de-trabajo.md): " +
    "si este pedido implica cambiar archivos, la base de datos o la configuracion, entra en modo plan, " +
    "hace las preguntas necesarias en una sola ronda y presenta el plan en dos partes " +
    "(resumen para la persona + plan para Claude, con modelo y esfuerzo) antes de editar nada. " +
    "Si es solo una pregunta o una explicacion, responde directo.";

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
    }),
  );
});
