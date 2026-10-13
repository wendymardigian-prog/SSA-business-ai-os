# Pendientes — Contactos: regla única

Formato: **qué quedó** / por qué / qué se decidió.

## Duplicados que ya existen (C4)
- **Qué quedó:** al 13/10/2026, **un solo par** (844 contactos vivos, 1 workspace): el de Instagram `fede.com.ia` (abajo). Cero por teléfono, email (principal o secundario), cruces teléfono↔WhatsApp o email↔secundario, TikTok, X o LinkedIn.
- **Cómo se vuelve a mirar** (solo lectura; pegar en `supabase db query --linked -f`):

```sql
-- Duplicados vivos por dato fuerte, por workspace. Cada fila es UN dato compartido por 2 o mas contactos.
WITH live AS (
  SELECT id, workspace_id, created_at, display_name, phone, whatsapp_phone, email, secondary_email,
         lower(instagram_username) AS ig, lower(tiktok_username) AS tt, lower(twitter_username) AS x,
         public.linkedin_slug(linkedin_profile_url) AS li
  FROM public.contacts WHERE deleted_at IS NULL
), vals AS (
  SELECT workspace_id, 'telefono' AS tipo, phone AS dato, id, created_at FROM live WHERE phone IS NOT NULL AND btrim(phone) <> ''
  UNION ALL SELECT workspace_id, 'telefono', whatsapp_phone, id, created_at FROM live WHERE whatsapp_phone IS NOT NULL AND btrim(whatsapp_phone) <> ''
  UNION ALL SELECT workspace_id, 'email', public.normalize_email(email), id, created_at FROM live WHERE public.normalize_email(email) IS NOT NULL
  UNION ALL SELECT workspace_id, 'email', public.normalize_email(secondary_email), id, created_at FROM live WHERE public.normalize_email(secondary_email) IS NOT NULL
  UNION ALL SELECT workspace_id, 'instagram', ig, id, created_at FROM live WHERE ig IS NOT NULL
  UNION ALL SELECT workspace_id, 'tiktok', tt, id, created_at FROM live WHERE tt IS NOT NULL
  UNION ALL SELECT workspace_id, 'x', x, id, created_at FROM live WHERE x IS NOT NULL
  UNION ALL SELECT workspace_id, 'linkedin', li, id, created_at FROM live WHERE li IS NOT NULL
)
SELECT workspace_id, tipo, dato, count(DISTINCT id) AS contactos,
       array_agg(DISTINCT id::text) AS ids, min(created_at) AS primero, max(created_at) AS ultimo
FROM vals GROUP BY workspace_id, tipo, dato HAVING count(DISTINCT id) > 1
ORDER BY tipo, dato;
```

- **Decisión:** nada se fusiona solo. Cada par lo decide una persona (Owner/Admin).

## Duplicado existente: Instagram `fede.com.ia`
- **Qué quedó:** dos contactos con el mismo @ de Instagram, creados con 8 ms de diferencia el 10/10/2026: `7c8a2ad4-40b2-46f3-a80b-9748962c0409` (12:33:00.290, sin canal, 1 conversación) y `f370f154-a81e-4e86-a82e-1893d1153493` (12:33:00.298, con canal, 1 conversación).
- **Por qué:** la carrera que esta regla única cierra; antes no había bloqueo.
- **Decisión:** no se fusiona solo. Se unen a mano con `linkContacts` (Owner/Admin), recomendado conservar `f370f154…` (tiene el canal).

## Índices únicos (`00205`)
- **Qué quedó:** a definir al cerrar C3.
- **Decisión de plan:** se escribe y ensaya, pero se aplica DESPUÉS de desplegar el PR.

## Fusión de contactos sin pantalla propia
- **Qué quedó:** `linkContacts` solo se alcanza desde el banner de sugerencia.
- **Decisión:** pendiente una pantalla "fusionar con…".
