/**
 * Las funciones de la 00305 son SECURITY DEFINER: leen sin la RLS de cada mensaje.
 * Si pierden alguna de estas protecciones no falla nada a la vista, por eso se fijan
 * aca. Que den lo mismo que las viejas para cada rol lo prueba
 * `scripts/verify-chat-core.mjs`, contra la base.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/00305_chat_dashboard_core.sql"), "utf8");

function functionBody(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `no encontre ${name}`).toBeGreaterThanOrEqual(0);
  const open = SQL.indexOf("AS $$", start);
  const close = SQL.indexOf("$$;", open);
  return SQL.slice(start, close);
}

const DEFINER = ["chat_visible_messages", "chat_dashboard_core", "chat_dashboard_patterns_v2"];
const ALL = [...DEFINER, "chat_dashboard_team_v2"];

describe("00305: el acceso a los datos", () => {
  it.each(DEFINER)("%s es DEFINER, con search_path vacio", (name) => {
    const head = functionBody(name);
    expect(head).toMatch(/SECURITY DEFINER/);
    expect(head).toMatch(/SET search_path = ''/);
  });

  it.each(DEFINER)("%s corta a quien no es miembro y aplica la regla de cada conversacion", (name) => {
    const body = functionBody(name);
    expect(body).toMatch(/public\.is_workspace_member\(p_workspace_id\)/);
    expect(body).toMatch(/\(SELECT me\.member FROM me\)/);
    expect(body).toMatch(/public\.can_see_conversation\(c\)/);
    // CASE y no OR: para un admin no puede correr por cada conversacion.
    expect(body).toMatch(/CASE WHEN \(SELECT me\.admin FROM me\) THEN true ELSE public\.can_see_conversation\(c\) END/);
  });

  it("los mensajes de core salen solo de las conversaciones visibles", () => {
    expect(functionBody("chat_dashboard_core")).toMatch(/FROM public\.messages m\s+JOIN vis v ON v\.id = m\.conversation_id/);
  });

  it("patrones corta tambien las categorias y los textos a quien no es miembro", () => {
    const body = functionBody("chat_dashboard_patterns_v2");
    expect(body).toMatch(/FROM public\.message_texts t[\s\S]{0,120}\(SELECT me\.member FROM me\)/);
    expect(body).toMatch(/FROM public\.message_categories c[\s\S]{0,200}\(SELECT me\.member FROM me\)/);
  });

  it("quien responde sigue siendo INVOKER: lo que ve de audit_log depende del rol", () => {
    expect(functionBody("chat_dashboard_team_v2")).toMatch(/SECURITY INVOKER/);
  });

  it("la lectura sin texto no devuelve el texto de los mensajes", () => {
    const head = functionBody("chat_visible_messages");
    const columns = head.slice(head.indexOf("RETURNS TABLE"), head.indexOf("LANGUAGE sql"));
    expect(columns).not.toMatch(/\btext_norm\b|\bbody\b|\bcontent\b/);
    expect(columns).not.toMatch(/^\s*text\s/m);
  });

  it.each(ALL)("%s no queda abierta a anon y la pueden llamar los que corresponde", (name) => {
    expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon;`));
    expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated, service_role;`));
  });

  it("es idempotente y no toca las funciones viejas", () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_audit_log_entity_agent/);
    for (const old of ["chat_episodes", "chat_response_turns", "chat_dashboard_numbers", "chat_dashboard_team", "chat_dashboard_patterns"]) {
      expect(SQL).not.toMatch(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${old}\\(`));
    }
    expect(SQL).not.toMatch(/\bDROP\b/);
  });
});
