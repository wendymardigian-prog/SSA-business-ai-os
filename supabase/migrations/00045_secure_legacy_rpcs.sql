-- ============================================================================
-- 00045 — Asegurar las funciones de la era pre-hardening
-- ============================================================================
-- Las migraciones 00001-00003 son anteriores al convenio que el repo adopto en
-- la 00017 (REVOKE a PUBLIC/anon + GRANT explicito + SET search_path = '').
-- Postgres le da EXECUTE a PUBLIC a toda funcion nueva, anon hereda de PUBLIC,
-- y PostgREST publica todo lo invocable del schema public. Nadie escribio el
-- REVOKE, asi que quedaron abiertas.
--
-- El agujero concreto: increment_unread es SECURITY DEFINER, no valida nada, y
-- cualquiera con la anon key (que es publica, va en el frontend) podia llamarla
-- por REST para reabrir conversaciones de cualquier workspace y escribir texto
-- arbitrario en last_message_preview, que es lo que se pinta en la bandeja.
-- Los dos contadores de broadcast son el mismo defecto sobre las metricas.
-- Sus unicos llamadores son los webhooks y el cron, todos con service role.
--
-- Sobre lo que NO se toca, para que el proximo scan no lo reabra:
--
--   * Las funciones de Vault (read_secret, store_secret, delete_secret,
--     list_secret_names) siguen con EXECUTE de authenticated, y esta bien: el
--     control esta adentro (assert_can_manage_secrets exige Owner/Admin o
--     service_role, y a un Member lo rechaza con "forbidden"). Sus llamadores
--     usan el cliente del usuario a proposito, porque es el usuario quien tiene
--     que estar autorizado. Pasarlas a service role moveria la decision de
--     autorizacion de la base a la app, que es al reves de como funciona todo
--     el resto del sistema.
--
--   * is_workspace_member y sus hermanas conservan EXECUTE de authenticated
--     porque es OBLIGATORIO. Ver el comentario de cada una mas abajo.
--
-- Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Las tres RPC sin guard: search_path fijo y solo service role
-- ----------------------------------------------------------------------------
-- El CREATE OR REPLACE va ANTES del REVOKE y califica las tablas: fijar
-- search_path = '' sin calificar los nombres las romperia en silencio.

CREATE OR REPLACE FUNCTION public.increment_unread(conv_id uuid, preview text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations
  SET unread_count = unread_count + 1,
      last_message_at = now(),
      last_message_preview = preview,
      status = 'open'
  WHERE id = conv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_broadcast_sent(b_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.broadcasts
  SET sent = sent + 1,
      delivered = delivered + 1
  WHERE id = b_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_broadcast_failed(b_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.broadcasts
  SET failed = failed + 1
  WHERE id = b_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_unread(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_unread(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.increment_broadcast_sent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_broadcast_sent(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.increment_broadcast_failed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_broadcast_failed(uuid) TO service_role;

COMMENT ON FUNCTION public.increment_unread(uuid, text) IS
  'Suma un no leido y pisa el preview de la conversacion. Solo service_role: la llaman los receptores de webhooks (lib/inbound.ts). No valida permisos, por eso no puede quedar expuesta a la anon key.';

-- ----------------------------------------------------------------------------
-- 2. update_updated_at: search_path fijo
-- ----------------------------------------------------------------------------
-- La unica de las ocho trigger functions con un defecto propio. Corre como
-- definer en el contexto del rol que dispara el trigger, y ese rol controla el
-- search_path.

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Trigger functions: sacarles el EXECUTE de anon
-- ----------------------------------------------------------------------------
-- No son explotables: retornan `trigger` y Postgres rechaza llamarlas fuera de
-- un trigger ("trigger functions can only be called as triggers"). El linter
-- las marca porque mira el GRANT, no la invocabilidad. Se revocan para que el
-- reporte quede limpio y siga siendo legible: un linter con ruido cronico es
-- uno que nadie lee. Un trigger corre con los privilegios del dueño de la
-- tabla, asi que esto no los afecta.

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.triggers_set_workspace_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contacts_emit_created() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contacts_emit_deanonymized() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contacts_emit_changes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contact_tags_emit() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contact_custom_fields_emit() FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 4. is_workspace_member: revocar anon, JAMAS authenticated
-- ----------------------------------------------------------------------------
-- Es la unica del grupo de helpers a la que nunca se le aplico el REVOKE.
-- Para anon devuelve false para cualquier entrada (no hay auth.uid()), asi que
-- no filtra nada; se cierra igual porque cuesta una linea.

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated, service_role;

-- ADVERTENCIA, y el motivo de que este escrita:
--
-- Un scanner de seguridad va a seguir marcando estas cinco funciones como
-- "SECURITY DEFINER ejecutable por usuarios logueados". NO se les puede revocar
-- authenticated. Las llaman ~37 expresiones de policy RLS sobre 23 tablas, y
-- una expresion de policy se evalua con el rol de la SESION, no como definer:
-- sin EXECUTE, cada SELECT sobre contacts, conversations, channels o flows
-- falla con "permission denied for function ...". Es decir, la app entera.
--
-- Si el objetivo es callar al linter, la unica salida correcta seria mover las
-- funciones a un schema no publicado por PostgREST y actualizar las 37
-- policies. No vale la pena por un warning.

COMMENT ON FUNCTION public.is_workspace_member(uuid) IS
  'Helper de RLS. authenticated NECESITA EXECUTE: la llaman ~37 policies y una expresion de policy se evalua con el rol de la sesion. Revocarlo rompe toda lectura de la app.';
COMMENT ON FUNCTION public.is_workspace_admin(uuid) IS
  'Helper de RLS. authenticated NECESITA EXECUTE (ver is_workspace_member).';
COMMENT ON FUNCTION public.is_workspace_owner(uuid) IS
  'Helper de RLS. authenticated NECESITA EXECUTE (ver is_workspace_member).';
COMMENT ON FUNCTION public.can_see_contact(public.contacts) IS
  'Scope de leads. authenticated NECESITA EXECUTE (ver is_workspace_member).';
COMMENT ON FUNCTION public.can_see_conversation(public.conversations) IS
  'Scope de leads. authenticated NECESITA EXECUTE (ver is_workspace_member).';
