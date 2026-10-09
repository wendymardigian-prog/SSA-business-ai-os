-- ============================================================
-- 00135_email_log_contact.sql
--
-- Los emails que manda una automatizacion al (o sobre el) contacto tienen que
-- aparecer en su historial. `email_log` no sabia de que contacto era cada email:
-- solo guardaba la direccion de destino, el asunto y la entidad relacionada (el
-- flow). Sin eso, un email de confirmacion de reunion que mando un flow no
-- dejaba rastro en la ficha de nadie.
--
-- 1. `contact_id` (nullable: los emails del sistema -invitaciones, avisos de
--    canal- no son de ningun contacto). ON DELETE SET NULL: el registro del
--    envio sobrevive al contacto, que se purga a los 30 dias.
-- 2. Una policy de lectura por contacto. Hoy `email_log` la leen solo Owner y
--    Admin (`email_log_select`); un Member que ve a SU lead tiene que ver los
--    emails de ese lead, y solo los de los leads que puede ver
--    (`can_see_contact`, el mismo scope de siempre). Las dos policies se suman:
--    Owner/Admin siguen viendo todo.
--
-- Aditiva e idempotente. Los registros anteriores quedan con `contact_id` en
-- NULL: no se puede saber de que contacto eran.
-- ============================================================

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_log_contact
  ON public.email_log (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

COMMENT ON COLUMN public.email_log.contact_id IS
  'El contacto al que se refiere el email (el que lo recibe, o sobre quien trata un aviso al equipo). NULL en los emails del sistema y en los anteriores a la 00135.';

DROP POLICY IF EXISTS "email_log_select_contact" ON public.email_log;
CREATE POLICY "email_log_select_contact" ON public.email_log
  FOR SELECT USING (
    contact_id IS NOT NULL
    AND public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = email_log.contact_id
        AND public.can_see_contact(c.*)
    )
  );
