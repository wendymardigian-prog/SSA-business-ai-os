-- 00521 · Archivos adjuntos en los comentarios de las tareas (25/11/2026, traído de RER #140 B-TAR-27, su 00515).
--
-- En SSA los comentarios del equipo son `public.comments` (00364: tareas y reuniones), no una tabla por módulo. Un
-- comentario puede llevar hasta 5 archivos de 25 MB (imágenes, PDF u Office, validados por sus BYTES en el servidor),
-- igual que los comentarios de la ficha del cliente (00520). Por ahora la pantalla y el servidor solo lo ofrecen en las
-- TAREAS (`entity_type = 'task'`); la tabla ya sirve para cualquier entidad de `comments`.
--
-- Los archivos van al MISMO bucket privado `record-attachments`, siempre en `<workspace>/comments/<comentario>/`, y se
-- bajan con enlaces firmados de 5 minutos que firma el servidor: el bucket no tiene políticas para la sesión.
--
-- Lectura: quien ve la entidad (`can_see_comment_entity`, la misma regla que el comentario) y mientras el comentario no
-- esté borrado. Escritura: solo el servidor (`service_role`), después de comprobar que la persona escribió el
-- comentario y lo ve. Sin `contact_id` a propósito: la fusión de contactos no tiene que tocar esta tabla.
--
-- Aditiva: se puede aplicar antes o después del código. Para volver atrás: DROP TABLE public.comment_attachments (y
-- vaciar `record-attachments/<ws>/comments/`).

CREATE TABLE IF NOT EXISTS public.comment_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  comment_id   uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  storage_path text NOT NULL,
  file_name    text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  mime         text NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
  created_by   uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_attachments_path') THEN
    ALTER TABLE public.comment_attachments ADD CONSTRAINT comment_attachments_path
      CHECK (storage_path LIKE workspace_id::text || '/comments/' || comment_id::text || '/%');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comment_attachments_comment ON public.comment_attachments (comment_id);

-- La entidad copiada tiene que ser la del comentario (así la política mira la regla correcta), y hasta 5 por comentario.
CREATE OR REPLACE FUNCTION private.comment_attachments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.comments c
                  WHERE c.id = NEW.comment_id AND c.workspace_id = NEW.workspace_id
                    AND c.entity_type = NEW.entity_type AND c.entity_id = NEW.entity_id) THEN
    RAISE EXCEPTION 'El archivo no coincide con su comentario.' USING ERRCODE = 'P0001', HINT = 'RA002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('comment_attachments:' || NEW.comment_id::text, 0));
  IF (SELECT count(*) FROM public.comment_attachments a WHERE a.comment_id = NEW.comment_id) >= 5 THEN
    RAISE EXCEPTION 'Un comentario lleva como máximo 5 archivos.' USING ERRCODE = 'P0001', HINT = 'RA001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.comment_attachments_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS comment_attachments_guard ON public.comment_attachments;
CREATE TRIGGER comment_attachments_guard BEFORE INSERT ON public.comment_attachments
  FOR EACH ROW EXECUTE FUNCTION private.comment_attachments_guard();

ALTER TABLE public.comment_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comment_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comment_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comment_attachments TO service_role;

DROP POLICY IF EXISTS comment_attachments_select ON public.comment_attachments;
CREATE POLICY comment_attachments_select ON public.comment_attachments FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND public.can_see_comment_entity(entity_type, entity_id)
    AND EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_attachments.comment_id AND c.deleted_at IS NULL));

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('record-attachments', 'record-attachments', false, 26214400)
ON CONFLICT (id) DO NOTHING;
