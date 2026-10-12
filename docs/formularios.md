# Formularios (personalizados, encuestas con NPS y contratos firmados)

Cada formulario se arma con un editor, se publica con un link, se embebe en cualquier web o se pone en una página del propio proyecto. **Cada respuesta crea o vincula el contacto correcto, con de dónde vino (UTM, ids de clic, cookies de anuncios), y puede disparar automatizaciones.** Un contrato firmado queda atado al texto exacto que se firmó, con su PDF y la copia por email.

Plano: [requerimientos-formularios.md](requerimientos-formularios.md). Avance: [PROGRESS-formularios.md](PROGRESS-formularios.md). Decisiones y pendientes: [PENDIENTE-formularios.md](PENDIENTE-formularios.md). Las páginas públicas del propio proyecto: [sitio.md](sitio.md).

## Los tres tipos

| Tipo | Qué es | Lo propio |
|---|---|---|
| **Personalizado** | Cualquier formulario: aplicación, contacto, registro | Campos, condiciones, mapeo al contacto |
| **Encuesta** | Mide satisfacción | Un campo de puntaje (NPS 0-10 o estrellas 1-5), categoría, "una vez por contacto", panel con NPS y evolución |
| **Contrato** | Se firma | Texto versionado con huella, casilla de aceptación, firma dibujada, PDF y copia por email |

Los tres comparten editor, publicación, versiones, envío, respuestas, métricas y automatizaciones.

## Datos

Cuatro tablas nuevas. Todas con RLS; **escribe solo el servidor**.

- `forms`: el formulario, su borrador, su versión vigente, el mapeo al contacto, las etiquetas y los avisos, y la configuración de encuesta o de contrato.
- `form_versions`: **cada publicación**, inmutable. Una respuesta apunta a la versión con la que se respondió y guarda las etiquetas de entonces (renombrar un campo no cambia las respuestas viejas). En un contrato guarda el texto y su huella.
- `form_submissions`: las respuestas. Idempotencia por `(form_id, idempotency_key)`; "una vez por contacto" por `(form_id, once_key)`. Nunca se borran.
- `contract_signatures`: una firma por respuesta de contrato, con la huella, la imagen, la metadata legal y el estado del PDF y del email. **La evidencia no se puede cambiar, ni con el service role** (trigger).

Además: `flows.form_id` (las automatizaciones creadas desde el formulario), los buckets privados `form-uploads` y `contracts` (sin policies: solo el servidor). **Las vistas, los inicios y los rechazados no tienen tabla**: van a `analytics_events` (`form_view`, `form_start`, `form_rejected`, sin contacto ni datos personales); los envíos salen de `form_submissions`.

Quién ve qué (`can_view_forms`, `can_see_form_submission`): Owner y Admin ven todo; un Member ve las respuestas de **sus** contactos (la misma regla de alcance de leads); un rol personalizado necesita `forms.view`. Administrar (`forms.manage`) es aparte. Los totales de métricas son conteos del formulario entero y los ve cualquiera que pase `can_view_forms`.

Migraciones: **00150** a **00158** (la 00158 corrige "una vez por contacto"; ver PENDIENTE).

## La definición pública: una sola puerta

`/f/<slug>`, el embed y `<Formulario>` leen la definición **solo** por `get_public_form` (una lista blanca en la base). Nunca sale: el valor de un campo oculto `fixed`, la configuración de éxito, el mapeo al contacto, las etiquetas ni los avisos. Un formulario en borrador, pausado, archivado o inexistente se ve igual ("no disponible"): no se puede enumerar.

## El envío (`lib/forms/submit.ts`), en orden

1. Tope por IP (60/h) y por formulario (30/h): valores holgados a propósito, porque una oficina o un evento comparten la misma IP. Un envío cortado por el tope no deja rastro.
2. Formulario disponible (versión vigente).
3. Forma del pedido (Zod).
4. **Idempotencia**: si ya existe una respuesta con esa clave se devuelve la misma.
5. Honeypot: lleno → éxito falso, sin guardar, con `form_rejected`.
6. Versión: si se republicó mientras se completaba y ya no valida, 409 `form_changed`.
7. **Validación total**, con la visibilidad recalculada (lo oculto por condición se descarta) y el mismo `validateSubmission` que corre en el navegador.
8. Archivos por su **tipo real** (los primeros bytes, no el nombre) a un bucket privado.
9. Ocultos `fixed`: los pone el servidor.
10. **Contrato**: casilla aceptada, firma válida (PNG real, ≤ 200 KB, con trazos) y email del firmante; la imagen va al bucket antes de la RPC.
11. **RPC `submit_form_response`** (una transacción): lock → contacto → respuesta → firma si es contrato → evento de automatización.
12. Después del commit, en `try/catch`: el toque de atribución, la notificación al equipo y la limpieza. Si fallan, el envío sigue siendo un éxito.

**No hay captcha.** La protección anti-spam es honeypot + tope por IP + idempotencia, y publicar no depende de ninguna configuración externa. Cloudflare Turnstile se sacó el 12/10/2026 y está documentado para retomarlo en [docs/pendientes/turnstile-captcha.md](pendientes/turnstile-captcha.md).

Todo lo que toca base y Storage entra por `SubmitPorts`: el orden se prueba entero sin nada real, y `verify-forms.mjs` lo corre con los puertos de verdad. Los logs llevan solo `form_id`, `submission_id` y el resultado: nunca respuestas, emails, teléfonos ni la firma.

## El contacto

Un formulario tiene un **mapeo** campo → contacto (nombre completo, email, teléfono, WhatsApp, país, campos personalizados) y dos modos: *crear o vincular* / *solo vincular*, y *completar lo vacío* / *pisar con lo nuevo* (nunca se borra un dato con un vacío).

- Se busca por **teléfono y después por email normalizado**, nunca por nombre (`find_contact_by_phone_or_email`, el mismo criterio que `create_booking`). Si el teléfono y el email son de contactos distintos gana el teléfono y se guarda `conflict_contact_id`.
- **Sin email ni teléfono no se crea contacto**: la respuesta queda `no_contact`, no dispara automatizaciones y se puede vincular a mano desde su detalle.
- Dos respuestas simultáneas con el mismo teléfono nuevo dejan **un** contacto (lock en la base).
- `find_or_link_contact`, `create_booking` y `record_contact_touch` **no se tocaron** (las huellas md5 de su definición son las del punto de partida y `verify-forms` las compara).

## De dónde vino: la atribución

- **Las claves en un solo lugar**: `lib/attribution/keys.ts` (UTM, ids de clic de cada plataforma, ids del anuncio, cookies `fbp`/`fbc`/`ga_client_id`).
- **Atribución efectiva** (`effectiveAttribution`): si la URL trae un toque nuevo, gana; si no, vale el último guardado. La primera visita viaja aparte y **nunca se pisa**. El servidor vuelve a sanear todo lo que manda el navegador.
- **Persistente entre páginas** (`lib/attribution/store.ts`): cookie `ssa_attr` en las páginas del proyecto, `localStorage` de la web externa con el mismo `embed.js`, y un modo "solo seguimiento" (`data-agenda-track`). Ver [sitio.md](sitio.md).
- **El toque** (`formTouch`): `medium = "form"`, la campaña y los ids a sus columnas y el resto (`msclkid`, `gbraid`, `fbc`…) a `raw`. La regla del primer y último toque es la de `record_contact_touch`: contacto nuevo → este toque es el primero y el último; existente → pasa a ser el último y el primero no cambia.

## Automatizaciones

- **Tres triggers**: `form_submitted`, `survey_answered`, `contract_signed`. Un solo evento por respuesta, según el tipo. El payload es de **solo escalares** y nunca lleva `booking_id` (ver [flow-registry.md](flow-registry.md)).
- **Variables**: `{{form.*}}`, `{{answer.<clave>}}`, `{{submission.*}}` y `{{form_link.<slug>}}` (el link firmado para el contacto del flujo).
- **Link firmado por contacto** (`lib/forms/signed-link.ts`): `?c=<token>` con HMAC-SHA256, el `contact_id` (y el `service_id` y `sale_id` si los hay) **dentro de la firma**, 60 días. Un id suelto en la URL o en el cuerpo se ignora. Es lo que reusan Ventas y CX.
- **Desde el formulario** (pestaña Automatizaciones): crear una, o una plantilla de un clic (avisarme por email, mensaje de gracias, ponerle un tag, alerta por detractor), que nace apagada. El editor lineal es el mismo que usa la Agenda.

## Encuesta

El puntaje es un campo de estrellas o de NPS **obligatorio** (se valida al publicar). La base calcula `score` y `nps_category` (promotor 9-10, pasivo 7-8, detractor 0-6; el espejo `npsCategory()` tiene su test de paridad). "Una vez por contacto": la clave guardada es `contact:<id>` (o `email:<email>` si no hay contacto); una respuesta marcada spam no cuenta. Con un link firmado válido, la página dice "Ya respondiste, ¡gracias!" **antes** de mostrar el formulario. El panel (`/formularios/<id>/encuesta`) calcula NPS, distribución y evolución sobre las respuestas que la persona ve.

## Contrato y su huella

- El texto es Markdown acotado (títulos, negrita, cursiva, listas; **nada de HTML, links ni imágenes**) y se renderiza con el mismo `renderContractMarkdown` en la página y en el PDF.
- Al publicar, el texto se congela en `form_versions.contract_text` con su **SHA-256, calculado en la base**. **Nada de lo que manda el navegador entra en la huella**: el pedido ni siquiera trae el texto. La RPC la vuelve a calcular al firmar; si no coincide con la guardada, la firma falla y no queda ni respuesta, ni contacto, ni firma, ni job.
- La firma guarda la versión, la huella, el firmante, la hora **del servidor**, la imagen y la metadata legal (la IP va en claro **solo acá**: es evidencia; en el resto del sistema va hasheada). Publicar una versión nueva **no toca** las firmas de la anterior.
- El **PDF** (`pdf-lib`, solo servidor) lleva el título, el texto, el firmante, sus respuestas, la firma, los "Datos de aceptación" y, **al pie de cada página, la huella y la versión**. Se genera en un job (`contract_pdf`) que se encola en la misma transacción que la firma.
- La **copia por email** (`contract_email`) manda el PDF adjunto al firmante y un envío aparte a cada dirección de copia. Los jobs **no lanzan por un fallo de un proveedor**: reintentan a los 5, 15 y 30 minutos (`scheduleJob`, no la cola) y después quedan visibles (**No se pudo generar** / **No enviado**) con "Regenerar PDF" y "Reenviar copia". **La firma queda guardada igual.**
- Ver el PDF es un link firmado de 60 segundos, solo para quien ve la respuesta (la RLS de `contract_signatures`).

## Embed y sitio

El mismo `embed.js` de la Agenda con el link `f/<slug>`, el modo botón flotante y el seguimiento. Para páginas del propio proyecto: `<Formulario slug="…" />` ([sitio.md](sitio.md)).

## Lo que no se puede romper

- La definición pública **solo** por `get_public_form`.
- La huella sobre el texto **guardado**, calculada en la base.
- La idempotencia es un índice único, no una comprobación previa.
- La protección anti-spam es honeypot + tope por IP + idempotencia (el captcha está en `docs/pendientes/turnstile-captcha.md`).
- Las claves de atribución están en **un solo lugar** (`lib/attribution/keys.ts`).
- Un `service_id` o `sale_id` suelto nunca se guarda: solo viaja dentro de un link firmado válido.
- Los eventos de automatización llevan solo escalares y nunca `booking_id`.
- Nada de lo de acá tumba un envío: el toque, el aviso y el correo van después del commit y dentro de `try/catch`.

## Scripts de verificación

```
node scripts/verify-forms.mjs   # RLS, la huella, la RPC, el envío real (Resend simulado), el PDF, la atribución
```

Crea y limpia sus datos (prefijo `zz-test-`) y no se corre en simultáneo con los otros `verify-*`.
