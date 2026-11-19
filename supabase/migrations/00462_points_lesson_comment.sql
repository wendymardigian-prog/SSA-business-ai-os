-- ============================================================
-- 00462_points_lesson_comment.sql
-- ============================================================
-- Puntos (00379, F246 del portal): un comentario en una clase suma como COMENTARIO, no como post. NO BORRA.
--
-- Un comentario de clase es un post del espacio Clases con `program_item_id` (F220 del portal). La 00379 lo sumaba como
-- `post`, así que gastaba el único post del día que suma (`points.caps.post`): quien comentaba una clase a la mañana ya
-- no sumaba por su post de la tarde en la comunidad. Ahora suma como `comment` (su valor y el tope de comentarios del
-- día) y el tope de posts queda solo para los posts de la comunidad. Las respuestas siguen siendo `comment`, como antes.
-- Las filas que ya estaban en points_ledger no cambian; ocultar un comentario de clase viejo (sumado como `post:`) no lo
-- descuenta.
--
-- Volver atrás: la definición de `app_servicio.points_post_hook()` de la 00379.
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION app_servicio.points_post_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_event text;
  v_key text;
BEGIN
  BEGIN
    IF NEW.author_contact_id IS NULL OR NEW.as_business THEN RETURN NULL; END IF;
    v_event := CASE WHEN NEW.parent_id IS NULL AND NEW.program_item_id IS NULL THEN 'post' ELSE 'comment' END;
    v_key := v_event || ':' || NEW.id;
    IF TG_OP = 'INSERT' THEN
      PERFORM app_servicio.award_points(NEW.author_contact_id, NEW.product_id, NULL, v_event, v_key, NULL, NULL, NEW.created_at);
    ELSIF NEW.hidden_at IS NOT NULL AND OLD.hidden_at IS NULL THEN
      -- Lo ocultó el equipo (moderación): se descuenta.
      PERFORM app_servicio.revoke_points(NEW.author_contact_id, NEW.product_id, v_key, 'Publicación ocultada por moderación');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_post', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$function$;
