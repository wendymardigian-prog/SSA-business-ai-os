-- 00091 · Que parte de una publicacion ya salio (A10, A14)
--
-- Algunas publicaciones tienen varios pasos contra el proveedor. Un hilo de
-- Threads es el caso claro: se publica el post principal y despues cada
-- respuesta. Si falla la segunda respuesta, el reintento volvia a empezar
-- desde el principio y **duplicaba el post principal**, que ya estaba en la
-- red.
--
-- Con esto el publicador deja anotado que paso ya salio, y el reintento
-- arranca donde quedo. Es del publicador y de nadie mas: ninguna pantalla lo
-- lee.
--
-- Aditiva. No borra ni modifica nada.

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS publish_progress jsonb;

COMMENT ON COLUMN public.social_posts.publish_progress IS
  'Que pasos de la publicacion ya salieron, para que un reintento no los repita (A10). Lo escribe solo el publicador.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_publish_progress_object'
  ) THEN
    ALTER TABLE public.social_posts
      ADD CONSTRAINT social_posts_publish_progress_object
      CHECK (publish_progress IS NULL OR jsonb_typeof(publish_progress) = 'object');
  END IF;
END $$;
