-- ============================================================================
-- 00234 — Vinculo retroactivo de comentarios: el trigger y el barrido inicial (Extra I, F32)
-- ============================================================================
-- SE APLICA DESPUES DEL MERGE (el codigo que ejecuta los jobs `comment_backfill` y `comment_backfill_workspace` tiene que
-- estar desplegado antes: si no, la cola marcaria esos tipos como fallidos).
--
--   1. Trigger `contacts_comment_backfill` (AFTER INSERT OR UPDATE OF instagram_username, tiktok_username ON contacts):
--      cuando un contacto gana un usuario de Instagram o TikTok, encola un `comment_backfill` (5 s despues) que une a esa
--      persona con los comentarios viejos que dejo sin contacto. La FUNCION es `private.enqueue_comment_backfill()` (00230,
--      con `EXCEPTION WHEN OTHERS`: encolar nunca puede costar un contacto).
--   2. Encola UN `comment_backfill_workspace` por workspace (barrido inicial de los contactos que ya existian), con la
--      clave `comment_backfill_workspace:<workspace>:00234` (no se puede encolar dos veces mientras espere).
--
-- Despues de aplicarla:
--   node scripts/verify-organic-attribution.mjs --despues-de-00234
--   node scripts/verify-contacts-single-entry.mjs
--   select status, count(*) from scheduled_jobs where type like 'comment_backfill%' group by 1;
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS contacts_comment_backfill ON public.contacts;
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type LIKE 'comment_backfill%' AND status = 'pending';
-- Riesgo: bajo. El trigger esta envuelto en EXCEPTION y solo encola.
-- ============================================================================

SET search_path = '';

DROP TRIGGER IF EXISTS contacts_comment_backfill ON public.contacts;
CREATE TRIGGER contacts_comment_backfill
  AFTER INSERT OR UPDATE OF instagram_username, tiktok_username ON public.contacts
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION private.enqueue_comment_backfill();

INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
SELECT 'comment_backfill_workspace', jsonb_build_object('workspace_id', w.id), now(), 'comment_backfill_workspace:' || w.id::text || ':00234'
  FROM public.workspaces w
ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
