-- 00289_messages_email_quoted: lo que un correo citó al responder, aparte de lo que la persona escribió.
--
-- `messages.text` de un email entrante pasa a guardar solo lo nuevo (lib/email/quoted-reply.ts). Con eso quedan limpios
-- la vista previa de la lista, los patrones, el contexto del agente y la regla de baja: una respuesta que citaba el pie
-- «Darme de baja» marcaba a la persona como «no contactar». La cita no se pierde: se guarda acá y se abre desde la burbuja.
--
-- Aditiva. Va ANTES de desplegar el código, que escribe esta columna al recibir un email.
--
-- Cómo volver atrás: ALTER TABLE public.messages DROP COLUMN IF EXISTS email_quoted_text;
-- (después de volver al código anterior; los textos ya guardados quedan sin su cita).

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_quoted_text text;

COMMENT ON COLUMN public.messages.email_quoted_text IS
  'Email entrante: lo que el correo citó al responder. `text` guarda solo lo que escribió la persona.';
