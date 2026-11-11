/**
 * Red de seguridad del protocolo de trabajo (plan primero). Falla si alguien:
 *  - borra o vacía el protocolo, el comando /planificar o el recordatorio;
 *  - saca el modo plan por defecto de la configuración (la del repo o la de los clientes);
 *  - deja que las dos configuraciones se desfasen;
 *  - hace que el recordatorio pueda trabar a la persona;
 *  - o escribe en lo que viaja a los clones un nombre propio (el control de nombres del export
 *    lo rechazaría).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const PROTOCOL = ".claude/rules/00-protocolo-de-trabajo.md";
const SKILL = ".claude/skills/planificar/SKILL.md";
const HOOK = ".claude/hooks/plan-reminder.mjs";
const CLIENT_SETTINGS = "scripts/template-files/clientes/settings.json";
const SETTINGS = ".claude/settings.json";

/** Pasa por el hook con una entrada y devuelve { code, stdout }. */
function runHook(input: string): { code: number; stdout: string } {
  try {
    const stdout = execFileSync("node", [join(ROOT, HOOK)], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { code: e.status ?? 1, stdout: String(e.stdout ?? "") };
  }
}

describe("el protocolo de trabajo", () => {
  const text = read(PROTOCOL);

  it("existe, carga siempre (sin `paths:`) y es corto", () => {
    expect(text).not.toMatch(/^---\s*\n[\s\S]*?paths:/);
    expect(text.split("\n").length).toBeLessThanOrEqual(120);
  });

  it("tiene las secciones que no pueden faltar", () => {
    for (const heading of [
      "## Regla 0",
      "## Paso 1",
      "## Paso 2",
      "Resumen para vos",
      "Plan para Claude",
      "Modelo y esfuerzo recomendados",
      "## Paso 3",
      "## Paso 4",
      "Frená y preguntá siempre",
      "## Paso 5",
      "## Definición de terminado",
    ]) {
      expect(text, heading).toContain(heading);
    }
  });

  it("pide modo plan en cada pedido nuevo y nunca pedir claves por chat", () => {
    expect(text).toContain("EnterPlanMode");
    expect(text).toMatch(/Nunca le pidas una clave/);
  });
});

describe("el comando /planificar", () => {
  const skill = read(SKILL);

  it("declara nombre, modelo y esfuerzo", () => {
    const front = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    expect(front).toMatch(/^name: planificar$/m);
    expect(front).toMatch(/^model: \S+$/m);
    expect(front).toMatch(/^effort: (low|medium|high|xhigh|max)$/m);
    expect(front).toMatch(/^description: .{40,}/m);
  });

  it("trae la plantilla de dos partes y los casos borde", () => {
    expect(skill).toContain("PARTE A");
    expect(skill).toContain("PARTE B");
    expect(skill).toContain("Cómo ejecutarlo");
    for (const caso of ["Vacío", "A la vez", "Permisos", "Celular", "Deshacer"]) expect(skill, caso).toContain(caso);
  });
});

describe("la configuración de Claude Code", () => {
  const client = JSON.parse(read(CLIENT_SETTINGS));
  const own = JSON.parse(read(SETTINGS));

  it("las dos arrancan en modo plan y avisan el protocolo en cada pedido", () => {
    for (const [name, settings] of [["clientes", client], ["repo", own]] as const) {
      expect(settings.permissions?.defaultMode, name).toBe("plan");
      expect(JSON.stringify(settings.hooks?.UserPromptSubmit), name).toContain("plan-reminder.mjs");
    }
  });

  it("nunca se fija un modo que el proyecto no puede imponer ni uno sin control", () => {
    for (const settings of [client, own]) {
      expect(["auto", "bypassPermissions", "dontAsk"]).not.toContain(settings.permissions?.defaultMode);
    }
  });

  it("la de clientes no lleva nada del aviso interno de la plantilla", () => {
    expect(JSON.stringify(client)).not.toContain("baios-reminder");
  });

  it("la del repo incluye todo lo de la de clientes (no se desfasan)", () => {
    expect(own.model).toBe(client.model);
    expect(own.permissions.defaultMode).toBe(client.permissions.defaultMode);
    for (const rule of client.permissions.allow) expect(own.permissions.allow, rule).toContain(rule);
    expect(own.hooks.UserPromptSubmit).toEqual(client.hooks.UserPromptSubmit);
  });

  it("los permisos que se dan de entrada son solo de lectura o de verificación", () => {
    for (const rule of client.permissions.allow as string[]) {
      expect(rule, rule).toMatch(/^Bash\((git (status|diff|log)|npx tsc --noEmit|npm run lint|npx vitest run)/);
    }
  });
});

describe("el recordatorio (hook UserPromptSubmit)", () => {
  it("ante un pedido de cambio, devuelve JSON válido con el recordatorio", () => {
    const { code, stdout } = runHook(JSON.stringify({ prompt: "agregá un campo de teléfono al formulario" }));
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain("00-protocolo-de-trabajo.md");
  });

  it("nunca traba: entrada vacía, JSON roto, pedido corto o comando salen en silencio con 0", () => {
    for (const input of ["", "{", "null", "[]", JSON.stringify({ prompt: "hola" }), JSON.stringify({ prompt: "/planificar algo largo que no debe avisar" })]) {
      const { code, stdout } = runHook(input);
      expect(code, JSON.stringify(input)).toBe(0);
      expect(stdout, JSON.stringify(input)).toBe("");
    }
  });
});

describe("los CLAUDE.md nombran el protocolo", () => {
  it("el del repo", () => {
    expect(read("CLAUDE.md")).toContain(".claude/rules/00-protocolo-de-trabajo.md");
  });
  it("el de la plantilla de estudiantes (si esta copia lo trae)", () => {
    const rel = "scripts/template-files/estudiantes/CLAUDE.md";
    if (!existsSync(join(ROOT, rel))) return;
    expect(read(rel)).toContain(".claude/rules/00-protocolo-de-trabajo.md");
  });
});

describe("lo que viaja a los clones no nombra a nadie", () => {
  // Misma lista que el control del export (`SELF_CHECK_WORDS`), partida a propósito.
  const pattern = new RegExp(["wend" + "y", "mardig" + "ian", "scale" + "os", "zernfl" + "ow", "knrxj" + "n", "businessxcelera" + "t"].join("|"), "i");
  for (const rel of [PROTOCOL, SKILL, HOOK, CLIENT_SETTINGS, SETTINGS]) {
    it(rel, () => {
      expect(read(rel)).not.toMatch(pattern);
    });
  }
});
