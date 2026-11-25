-- 00520 · Archivos adjuntos en los comentarios de la ficha del cliente (25/11/2026, traído de RER #110, su 00506).
--
-- Un comentario de la ficha del cliente o de uno de sus servicios (`contact_notes`) puede llevar hasta 5 archivos de
-- 25 MB (imágenes, PDF u Office, validados por sus BYTES en el servidor: `lib/attachments/record-files.ts`). Los
-- archivos van al bucket privado `record-attachments`, siempre en la carpeta `<workspace>/notes/<nota>/`, y se bajan con
-- enlaces firmados de 5 minutos que firma el servidor: el bucket no tiene políticas para la sesión.
--
-- Lectura: quien ve la nota. La política consulta `contact_notes` con la sesión, así que se aplica su propia RLS (que a
-- su vez pasa por la de `contacts`: el alcance de leads). Escritura: solo el servidor (`service_role`), después de
-- comprobar el permiso y que la persona escribió la nota. Sin `contact_id` a propósito: la fusión de contactos no tiene
-- que tocar esta tabla (va por `note_id`, y `merge_contacts` ya mueve las notas).
--
-- Aditiva: se puede aplicar antes o después del código (sin la tabla, la pantalla dice que todavía no se puede
-- adjuntar). Para volver atrás: DROP TABLE public.contact_note_attachments (y vaciar `record-attachments/<ws>/notes/`).

CREATE TABLE IF NOT EXISTS public.contact_note_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  note_id      uuid NOT NULL REFERENCES public.contact_notes(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name    text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  mime         text NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
  created_by   uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_note_attachments_path') THEN
    -- El archivo siempre en la carpeta de su negocio y su nota.
    ALTER TABLE public.contact_note_attachments ADD CONSTRAINT contact_note_attachments_path
      CHECK (storage_path LIKE workspace_id::text || '/notes/' || note_id::text || '/%');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contact_note_attachments_note ON public.contact_note_attachments (note_id);

-- Hasta 5 por nota también en la base: el servidor cuenta antes de subir, pero dos subidas a la vez podrían pasar las dos.
CREATE OR REPLACE FUNCTION private.contact_note_attachments_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('note_attachments:' || NEW.note_id::text, 0));
  IF (SELECT count(*) FROM public.contact_note_attachments a WHERE a.note_id = NEW.note_id) >= 5 THEN
    RAISE EXCEPTION 'Un comentario lleva como máximo 5 archivos.' USING ERRCODE = 'P0001', HINT = 'RA001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.contact_note_attachments_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contact_note_attachments_cap ON public.contact_note_attachments;
CREATE TRIGGER contact_note_attachments_cap BEFORE INSERT ON public.contact_note_attachments
  FOR EACH ROW EXECUTE FUNCTION private.contact_note_attachments_cap();

ALTER TABLE public.contact_note_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_note_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_note_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_note_attachments TO service_role;

DROP POLICY IF EXISTS contact_note_attachments_select ON public.contact_note_attachments;
CREATE POLICY contact_note_attachments_select ON public.contact_note_attachments FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.contact_notes n
       WHERE n.id = contact_note_attachments.note_id
         AND n.workspace_id = contact_note_attachments.workspace_id
         AND n.deleted_at IS NULL));

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('record-attachments', 'record-attachments', false, 26214400)
ON CONFLICT (id) DO NOTHING;
