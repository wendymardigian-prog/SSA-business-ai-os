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

Cuatro tablas nuevas. Todas con RLS; **escribe solo el servidor**. `form_versions` además tiene un candado en la base (00177): ni el service role puede cambiar una versión publicada.

- `forms`: el formulario, su borrador, su versión vigente, el mapeo al contacto, las etiquetas y los avisos, y la configuración de encuesta o de contrato.
- `form_versions`: **cada publicación**, inmutable. Una respuesta apunta a la versión con la que se respondió y guarda las etiquetas de entonces (renombrar un campo no cambia las respuestas viejas). En un contrato guarda el texto y su huella.
- `form_submissions`: las respuestas. Idempotencia por `(form_id, idempotency_key)`; "una vez por contacto" por `(form_id, once_key)`. Nunca se borran.
- `contract_signatures`: una firma por respuesta de contrato, con la huella, la imagen, la metadata legal y el estado del PDF y del email. **La evidencia no se puede cambiar, ni con el service role** (trigger).

Además: `flows.form_id` (las automatizaciones creadas desde el formulario), los buckets privados `form-uploads` y `contracts` (sin policies: solo el servidor). **Las vistas, los inicios y los rechazados no tienen tabla**: van a `analytics_events` (`form_view`, `form_start`, `form_rejected`, sin contacto ni datos personales); los envíos salen de `form_submissions`.

Quién ve qué (`can_view_forms`, `can_see_form_submission`): Owner y Admin ven todo; un Member ve las respuestas de **sus** contactos (la misma regla de alcance de leads); un rol personalizado necesita `forms.view`. Administrar (`forms.manage`) es aparte. Los totales de métricas son conteos del formulario entero y los ve cualquiera que pase `can_view_forms`.

Migraciones: **00150** a **00158** (la 00158 corrige "una vez por contacto"; ver PENDIENTE) y las **correcciones del 12/10 (00172 a 00177)**: `get_public_form` sin Turnstile (00172) y con `social` (00174), el CHECK de `integration_configs.type` sin `captcha` (00173), `find_contact_for_form` e índices por red (00175), `submit_form_response` v5 (00176) y el candado de `form_versions` (00177).

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

**El interruptor "Vincular las respuestas con contactos"** (pestaña Contacto, arriba de todo) decide si una respuesta toca contactos. Apagado (`contact_config.mode = "none"`): no crea, no vincula ni actualiza ningún contacto (tampoco con un link firmado: **la base lo hace cumplir**), la respuesta queda "Sin contacto", no dispara automatizaciones, una encuesta no puede limitarse a "una vez por contacto" (la opción se deshabilita y publicar lo rechaza) y no hay link firmado por contacto. **Apagar no borra el mapeo.** Prendido: "Si la persona no está en tus contactos" (crear / no crear: dejar la respuesta sin contacto) y "Si la persona ya está en tus contactos" (completar solo lo que le falta / actualizar con lo que respondió; nunca se borra un dato con un vacío).

**Identificadores y orden de búsqueda.** Un contacto se crea o se vincula por **teléfono, email, WhatsApp o un usuario de Instagram, TikTok, X o LinkedIn**. Se busca en este orden: **teléfono → email → Instagram → TikTok → X → LinkedIn** (`find_contact_for_form`, 00175; `find_contact_by_phone_or_email` no se toca, la usa Ventas). Gana el primero que encuentra un contacto (el más antiguo, solo vivos); lo que apuntaba a **otro** contacto queda como conflicto: `dedupe.conflict_contact_id` (el primero distinto) y `dedupe.conflicts: [{ by, contact_id }]`, y el detalle de la respuesta dice "El @ de Instagram coincide con otro contacto: verlo". **Nunca se busca por nombre.** Facebook y YouTube solo se guardan: sus formatos no son confiables para identificar a nadie.

- **Usuarios de redes sociales.** Campo nuevo "Usuario de red social" (tipo 14) con prefijo "@" en la página. `normalizeSocialHandle` (`lib/contacts/social.ts`) acepta el @ o la URL del perfil; Instagram, TikTok y X quedan sin "@" y en minúsculas (como `contacts.instagram_username`), LinkedIn como `https://www.linkedin.com/in/<slug>`. Un usuario que no cumple el formato es un error del campo. Un texto corto mapeado a una red se normaliza igual; si no es válido, ese dato no se guarda en el contacto (la respuesta queda).
- **`instagram_username` nunca se pisa** si el contacto tiene un canal de Instagram vinculado (lo mantiene la conversación real), ni siquiera con "actualizar". Un usuario que ya es de otro contacto no se escribe.
- **Un contacto nuevo sin nombre** y solo con un @ usa el @ como nombre ("@ana"): la app mostraría "Sin nombre" y la base lo marcaría anónimo (`is_anonymous` solo mira Instagram; ver PENDIENTE).
- **El país** se entiende por código o por nombre en español o inglés (`resolveCountry`, sobre los 250 códigos ISO con `Intl.DisplayNames`). Si no se reconoce, no se guarda en el contacto y el detalle dice "País no reconocido: <texto>".
- **El mapeo se arma solo** (`autoMapOnFieldAdded`): al agregar un campo de email, teléfono, red social o un texto corto llamado nombre/name, se mapea; nunca pisa un mapeo elegido a mano. Al borrar un campo se va su mapeo. **El mapeo se guarda junto con el borrador.** Publicar con el interruptor prendido y sin ningún identificador mapeado pide confirmación ("Ir a Contacto" / "Publicar igual"); con el interruptor apagado no hay aviso.
- Dos respuestas simultáneas con el mismo dato nuevo (teléfono, email o @) dejan **un** contacto: un lock por cada identificador, en orden fijo.
- `find_or_link_contact`, `create_booking`, `record_contact_touch` y `find_contact_by_phone_or_email` **no se tocaron** (las huellas md5 de su definición son las del punto de partida).

**En la ficha del contacto**, la sección **Formularios** (debajo de Llamadas y Ventas, solo con `forms.view`) muestra sus últimas 20 respuestas sin spam: formulario, tipo, fecha en la zona de quien mira, y el puntaje y la categoría NPS (encuesta) o "Firmado", la versión y el estado de la copia con "Ver PDF" (contrato). Lee con el cliente de quien mira: la RLS decide. "Ver todas" abre `/dashboard/contacts/<id>/formularios`.

## De dónde vino: la atribución

- **Las claves en un solo lugar**: `lib/attribution/keys.ts` (UTM, ids de clic de cada plataforma, ids del anuncio, cookies `fbp`/`fbc`/`ga_client_id`).
- **Atribución efectiva** (`effectiveAttribution`): si la URL trae un toque nuevo, gana; si no, vale el último guardado. La primera visita viaja aparte y **nunca se pisa**. El servidor vuelve a sanear todo lo que manda el navegador.
- **Persistente entre páginas** (`lib/attribution/store.ts`): cookie `ssa_attr` en las páginas del proyecto, `localStorage` de la web externa con el mismo `embed.js`, y un modo "solo seguimiento" (`data-agenda-track`). Ver [sitio.md](sitio.md).
- **El toque** (`formTouch`): `medium = "form"`, la campaña y los ids a sus columnas y el resto (`msclkid`, `gbraid`, `fbc`…) a `raw`. La regla del primer y último toque es la de `record_contact_touch`: contacto nuevo → este toque es el primero y el último; existente → pasa a ser el último y el primero no cambia.

## Automatizaciones

- **Tres triggers**: `form_submitted`, `survey_answered`, `contract_signed`. Un solo evento por respuesta, según el tipo. El payload es de **solo escalares** y nunca lleva `booking_id` (ver [flow-registry.md](flow-registry.md)).
- **Variables**: `{{form.*}}`, `{{answer.<clave>}}`, `{{submission.*}}` y `{{form_link.<slug>}}` (el link firmado para el contacto del flujo).
- **Link firmado por contacto** (`lib/forms/signed-link.ts`): `?c=<token>` con HMAC-SHA256, el `contact_id` (y el `service_id` y `sale_id` si los hay) **dentro de la firma**, 60 días. Un id suelto en la URL o en el cuerpo se ignora. Es lo que reusan Ventas y CX.
- **Desde el formulario** (pestaña Automatizaciones): crear una, o una plantilla de un clic (avisarme por email, mensaje de gracias, ponerle un tag, alerta por detractor, email distinto según una respuesta), que nace apagada. Todo flujo sigue siendo un flujo normal (`flows.form_id`): también aparece en Automatizaciones y se abre en el canvas. "+ Nueva automatización" abre el editor con el disparador del formulario ya puesto.
- **La lista** muestra, de cada flujo, qué hace en una línea (`describeTree`, vía `summarizeFlow`): "Cuando se envía · 2 caminos + si no · 3 emails". Un flujo que no se puede leer como lista de pasos (caminos que se vuelven a juntar, un A/B, un ciclo) dice "Armado en el canvas".

### El editor de pasos (Cuándo / Solo si… / Pasos)

Es el mismo que usa la Agenda (`components/automations/step-tree-editor.tsx`). Lee el grafo como un **árbol de pasos** (`lib/automations/step-tree.ts`); no es el canvas, es la misma información. Si el flujo no es un árbol, el editor es de solo lectura con "Abrir en el canvas": guardar desde una vista simplificada borraría lo que no se ve.

- **Cuándo**: el disparador, **fijo**. El servidor toma el disparador de la base al guardar; de lo que manda el navegador solo acepta cambios en "Solo si…" (`answer_conditions`, validado con `parseFormTriggerConfig`, mismo formato de siempre).
- **Solo si…**: decide si el flujo **arranca**. Si no se cumple, no hay sesión ni pasos. Es el filtro de siempre.
- **Pasos**: email (al contacto o a una dirección fija), mensaje, esperar, agregar o quitar un tag y **Condiciones**. "+ Agregar paso", subir, bajar, duplicar y borrar (borrar un camino con pasos pide confirmación).
- **Condiciones** reparte el flujo por **caminos**: arriba va el primero que se cumple (en el orden en que están) y al final siempre hay un **"Si no"**. Cada camino tiene sus condiciones con "y / o" y sus propios pasos, y **termina en sí mismo**: lo que viene después de Condiciones va adentro de un camino (para repetir un paso en varios caminos, "Duplicar paso"). Hasta 3 niveles de Condiciones anidadas.
- **Las condiciones se arman con campos que existen**: las preguntas del formulario con su tipo (una selección se elige de un desplegable con sus opciones, nunca se escribe), el nombre del formulario, el puntaje y la categoría NPS en encuestas, lo que dejó un paso anterior del mismo camino y datos del contacto. Se comparan con el **valor real** de la respuesta, no con su texto.
- Si una pregunta se borra del formulario, la condición lo avisa ("esta pregunta ya no existe") y no se cumple.

**"Solo si…" vs. Condiciones.** "Solo si…" es un portón: o el flujo corre entero o no corre. Condiciones es una bifurcación: el flujo corre siempre y hace cosas **distintas** según la respuesta. Para "mandar el email A a quien facturó mucho y el B al resto", Condiciones; para "no hacer nada si no dejó teléfono", "Solo si…".

### Probar condiciones

Junto a "Enviarme una prueba" (solo si el flujo tiene algún paso Condiciones). Muestra **por qué camino iría** cada Condiciones y cada condición en palabras con ✓ o ✗ ("Facturación es «Más de USD 10.000» ✓; Presupuesto es mayor que 5000 ✗"), siguiendo el camino que toma si hay Condiciones anidadas. Se prueba con:

- **una respuesta real**: las últimas 20 que la persona puede ver (la RLS decide), leídas con la definición de **la versión con la que se respondió**; o
- **datos cargados a mano** en un formulario chico con las preguntas (las selecciones, con desplegable).

Lo que mira un paso anterior o el contacto figura **"sin dato en la prueba"** y no se cumple; una pregunta que ya no existe lo dice. **No ejecuta nada**: ni sesión, ni evento, ni email, ni mensaje (la acción solo hace `select`; la cuenta es `explainPaths`, pura, sobre el mismo `pickPath` del nodo; hay tests de paridad con el motor y un test con espías que prueban que no se crea nada). Se calcula en el navegador con el árbol que está en pantalla, aunque tenga cambios sin guardar.

### La plantilla "Email distinto según una respuesta"

Se elige una pregunta del formulario (selección única, número, calificación o NPS) y se arma un Condiciones con **dos caminos + "Si no"**, cada uno con un paso "Enviar email" **vacío** para completar (nace apagada: completá los tres emails antes de encenderla).

- Selección única: un camino por cada una de las **dos primeras opciones**; las demás van por "Si no".
- Número: dos umbrales, "Alto: X o más" y "Medio: Y o más" (gana el primero que se cumple, así arman tres rangos con "Si no"). Salen de partir el rango de la pregunta en tercios (7 y 3 en un NPS, 4 y 2 en una calificación de 1 a 5, 70 y 30 si no hay mínimo ni máximo). **Son un punto de partida: se editan en el flujo.**

## Encuesta

El puntaje es un campo de estrellas o de NPS **obligatorio** (se valida al publicar). La base calcula `score` y `nps_category` (promotor 9-10, pasivo 7-8, detractor 0-6; el espejo `npsCategory()` tiene su test de paridad). "Una vez por contacto": la clave guardada es `contact:<id>` (o `email:<email>` si no hay contacto); una respuesta marcada spam no cuenta. Con un link firmado válido, la página dice "Ya respondiste, ¡gracias!" **antes** de mostrar el formulario. El panel (`/formularios/<id>/encuesta`) calcula NPS, distribución y evolución sobre las respuestas que la persona ve.

## Contrato y su huella

- El texto es Markdown acotado (títulos, negrita, cursiva, listas; **nada de HTML, links ni imágenes**) y se renderiza con el mismo `renderContractMarkdown` en la página y en el PDF.
- Al publicar, el texto se congela en `form_versions.contract_text` con su **SHA-256, calculado en la base**. **Nada de lo que manda el navegador entra en la huella**: el pedido ni siquiera trae el texto. La RPC la vuelve a calcular al firmar; si no coincide con la guardada, la firma falla y no queda ni respuesta, ni contacto, ni firma, ni job.
- La firma guarda la versión, la huella, el firmante, la hora **del servidor**, la imagen y la metadata legal (la IP va en claro **solo acá**: es evidencia; en el resto del sistema va hasheada). Publicar una versión nueva **no toca** las firmas de la anterior.
- El **PDF** (`pdf-lib`, solo servidor) lleva el título, el texto, el firmante, sus respuestas (sin repetir el nombre ni el email del firmante), la firma, los "Datos de aceptación" y, **al pie de cada página, la huella y la versión**. Se genera en un job (`contract_pdf`) que se encola en la misma transacción que la firma.
- La **copia por email** (`contract_email`) manda el PDF adjunto al firmante y un envío aparte a cada dirección de copia. Los jobs **no lanzan por un fallo de un proveedor**: reintentan a los 5, 15 y 30 minutos (`scheduleJob`, no la cola) y después quedan visibles (**No se pudo generar** / **No enviado**) con "Regenerar PDF" y "Reenviar copia". **La firma queda guardada igual.**
- Ver el PDF es un link firmado de 60 segundos, solo para quien ve la respuesta (la RLS de `contract_signatures`).

## Embed y sitio

El mismo `embed.js` de la Agenda con el link `f/<slug>`, el modo botón flotante y el seguimiento. Para páginas del propio proyecto: `<Formulario slug="…" />` ([sitio.md](sitio.md)).

## Lo que no se puede romper

- La definición pública **solo** por `get_public_form`.
- La huella sobre el texto **guardado**, calculada en la base.
- La idempotencia es un índice único, no una comprobación previa.
- La protección anti-spam es honeypot + tope por IP + idempotencia (el captcha está en `docs/pendientes/turnstile-captcha.md`).
- Una versión publicada no se puede cambiar (trigger `form_versions_protect`, también para el service role).
- Con el interruptor de contactos apagado, la base no toca ningún contacto (aunque el servidor mande datos).
- Las claves de atribución están en **un solo lugar** (`lib/attribution/keys.ts`).
- Un `service_id` o `sale_id` suelto nunca se guarda: solo viaja dentro de un link firmado válido.
- Los eventos de automatización llevan solo escalares y nunca `booking_id`.
- Un flujo con Condiciones se guarda desde el servidor (`saveFormFlowTree`): el disparador sale de la base y solo "Solo si…" es editable; "Probar condiciones" nunca escribe nada.
- Nada de lo de acá tumba un envío: el toque, el aviso y el correo van después del commit y dentro de `try/catch`.

## Scripts de verificación

```
node scripts/verify-forms.mjs   # RLS, la huella, la RPC, el envío real (Resend simulado), el PDF, la atribución, el interruptor de contactos y las redes sociales
```

Crea y limpia sus datos (prefijo `zz-test-`) y no se corre en simultáneo con los otros `verify-*`.
