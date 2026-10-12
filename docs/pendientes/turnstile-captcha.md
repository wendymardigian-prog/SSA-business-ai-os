# Cloudflare Turnstile (captcha) — sacado el 12/10/2026, para retomarlo

## Qué hacía

- **El widget** de Cloudflare dentro de la página pública del formulario (`/f/<slug>`, el embed y `<Formulario>`), que pedía un token por envío.
- **La verificación en el servidor**: `lib/forms/turnstile.ts` llamaba a `siteverify` con la secret key y el `idempotency_key` del envío. Si Cloudflare no respondía, el envío daba 503 (jamás se aceptaba sin verificar); `timeout-or-duplicate` volvía a buscar la respuesta.
- **La card de Integraciones** ("Seguridad → Cloudflare Turnstile"): site key en `integration_configs` (`type = 'captcha'`) y secret key en Vault (`turnstile_secret_key`), con "Probar y guardar".
- **La regla "publicar exige Turnstile"**: `checkPublishable` rechazaba la publicación si faltaba, y el editor mostraba "Falta configurar Turnstile".
- `get_public_form` devolvía la `turnstile_site_key` del workspace.

## Por qué se sacó

Decisión de Wendy del 12/10/2026: no depender de un captcha en la primera versión. Hoy no se podía publicar ningún formulario porque Turnstile no estaba configurado, y eso no puede pasar. La protección queda en lo que no necesita configuración:

- **campo trampa** (honeypot, deja `form_rejected` con `reason: "honeypot"`),
- **tope por IP** (30 envíos por hora por IP y formulario, 60 por IP en total),
- **idempotencia** (índice único por `(form_id, idempotency_key)`).

## Cómo restaurarlo

El último commit con Turnstile entero es **`9eee8bb`** (merge del PR #42, `main` al 12/10/2026). Traer los archivos con `git show 9eee8bb:<ruta>`:

| Archivo | Qué es |
|---|---|
| `lib/forms/turnstile.ts` y `turnstile.test.ts` | verificación en el servidor y prueba de la secret key |
| `components/forms/public/turnstile-widget.tsx` | el widget |
| `lib/forms/submit.ts` | el paso 6 (verificar), `timeout-or-duplicate`, el 503, `form_rejected` con `reason: "captcha"`, y `turnstile_token` en el esquema del pedido |
| `lib/forms/public-client.ts` | `turnstile_token`, `turnstileToken` y la falla `captcha` |
| `components/forms/public/public-form.tsx` | token, `captchaBroken`, reset y render del widget |
| `lib/forms/publish.ts` | `turnstileConfigured` y `TURNSTILE_MISSING_MESSAGE` |
| `lib/forms/server-ports.ts` | `turnstileSecret`, `verifyTurnstile`, `isTurnstileConfigured` |
| `lib/actions/forms/forms.ts`, `app/(dashboard)/dashboard/formularios/[id]/page.tsx`, `components/forms/editor/{publish-tab,form-editor,fields-tab}.tsx` | el aviso y el chequeo al publicar |
| `lib/integrations/providers.ts`, `test-connection.ts`, `lib/secret-names.ts` | la card (`turnstile`, sección `security`) y `turnstileSecretKey` |
| `lib/types/database.ts` | `"captcha"` en `IntegrationType` |
| `lib/vault-boundary.test.ts`, `providers.test.ts`, `catalog-characterization.test.ts`, `grid-filter.test.ts` | frontera y catálogo (el catálogo vuelve a 15) |

Migraciones necesarias (nuevas, con el número libre de ese momento):

1. Sumar `'captcha'` otra vez al CHECK de `integration_configs.type` (la definición de antes está en la cabecera de `00173_integration_type_sin_captcha.sql`).
2. Devolver `turnstile_site_key` en `get_public_form` (la definición de antes está en la cabecera de `00172_get_public_form_sin_captcha.sql`; ojo: desde entonces la función puede haber cambiado, partir de la definición VIVA).

**Recomendación: no volver a hacerlo obligatorio para publicar.** Si vuelve, que sea una opción *por formulario* que se prende cuando hay spam; así publicar nunca depende de una configuración externa.

## Nota para Cloudflare

El widget corre dentro de la página del propio sistema (también en el embed, que es un iframe del sistema), así que en Cloudflare alcanza con dar de alta **el dominio de la app**.
