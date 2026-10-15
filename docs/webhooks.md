# Webhooks entrantes

Cualquier herramienta de afuera (Typeform, Tally, Framer, un Zap, un formulario propio) puede mandarle datos al sistema por una
URL. Cada envío se guarda, se procesa con los flujos que lo escuchan y deja a la vista qué pasó. Construido en el Extra L
(bloques WH1 y WH2). Avance y decisiones: `docs/PROGRESS-atribucion.md` y `docs/PENDIENTE-atribucion.md`.

## En una frase

Una URL por herramienta (`/api/hooks/<token>`) recibe el envío, lo **guarda antes de procesarlo**, responde 200 y después corren
los flujos «Webhook recibido»; el paso «Crear o actualizar contacto» arma el contacto con su atribución.

## La URL y el token

- Se crea desde **Ajustes → Integraciones → Webhooks entrantes** (`flows.edit`; la lista de solo lectura, también `integrations.manage`).
- El token tiene 22 caracteres URL-safe (16 bytes aleatorios). **Es una credencial**: vive en `webhook_endpoints.token`, pero
  `authenticated` no puede leerlo (privilegio por columna, mismo patrón que los costos de `agents`). Se ve desde el servidor, después de
  chequear el permiso.
- Regenerar el token corta la URL vieja de inmediato. Borrar un endpoint es un borrado suave y libera el nombre.
- **Secreto opcional**: un header `x-webhook-secret` cuyo valor vive en Supabase Vault (nunca en una columna). Se compara en tiempo constante.
- Pausar un endpoint no pierde envíos: responde 200 y los guarda como `paused`.

## El receptor (`POST /api/hooks/[token]`)

El orden de las validaciones es parte del contrato (`lib/webhooks/receive.ts`, con puertos inyectables y test por orden):
forma del token (**sin tocar la base**) → endpoint → secreto → tope por hora → tamaño (256 KB) → parseo → idempotencia → guardar → responder.

- Acepta JSON, `application/x-www-form-urlencoded` y multipart; cualquier otra cosa se guarda cruda en `_raw`.
- **Idempotencia**: por el id del envío (`event_id_path`, una ruta dentro del payload) o, sin id, por el hash del cuerpo en una ventana
  de 10 minutos. Un repetido responde 200 y queda `ignored`.
- Se guarda la IP truncada (IPv4 /24, IPv6 /48), nunca la exacta. **Nada de lo que entra se loguea**: ni el token, ni el secreto, ni el payload.
- Responde 200 enseguida y procesa en `after()`. Si el proceso no llega a correr, lo levanta el **reaper** (cron de jobs, cada minuto):
  los `received` de más de 2 minutos se procesan; los `processing` de más de 15 se marcan `error` (no se repiten solos: ya pudieron mandar mensajes).

### Estados de un envío

Recibido · Procesando · Procesado · Con error · Ignorado (repetido) · Capturado (modo escucha) · Pausado.

### Modo escucha y el ejemplo

«Escuchar el próximo envío» deja el endpoint 15 minutos esperando; lo que llega queda como **ejemplo** (`sample_payload`): con él el editor
arma el árbol clickeable del payload, las variables `{{webhook.payload.*}}` y la sugerencia de campos. También se puede pegar un JSON o
usar un envío del historial.

### Historial, retención y avisos

- Cada envío muestra los datos, el resultado por flujo y el diff de lo que cambió en el contacto. «Reprocesar» vuelve a correr con la
  **versión publicada actual** (pide confirmación: los mensajes ya mandados se mandan de nuevo; la deduplicación evita duplicar el contacto).
- El payload se vacía a los **90 días**; la fila se borra a los **12 meses** (cron diario). Nunca se borra un envío con una sesión activa.
- 5 envíos con error en 1 hora → aviso en la campana (a quien creó el endpoint y a Owner/Admin), una vez por hora.

## El disparador «Webhook recibido»

- Es un disparador de **sujeto `webhook`**: el flujo arranca **sin contacto** (`flow_sessions.contact_id` puede ser null; la sesión lleva
  `inbound_webhook_id`). Detalle del motor en `docs/flow-registry.md`.
- Un endpoint puede tener **varios flujos**; cada flujo publicado corre una vez por envío (el reproceso usa otra clave de disparo).
- «Solo si…» filtra por datos del payload (`webhook.payload.*`, `webhook.query.*`) con el evaluador de Condiciones.
- Los pasos que necesitan contacto (mensaje, tags, campos, secuencia, agente) **solo pueden ir después** de «Crear o actualizar
  contacto», **en todos los caminos**. Guardar a medias se permite; **publicar** con un paso sin contacto se rechaza.

## El paso «Crear o actualizar contacto»

Dos salidas: **Listo** y **No se pudo**. Variables de salida: `contact_result` y `contact_fail_reason`.

1. **Mapeo** (`lib/webhooks/mapping.ts`, nunca lanza): cada destino (campos del contacto, personalizados, tags, atribución) toma una ruta del
   payload o de la URL, con rutas alternativas o un valor fijo. Un destino sin valor se omite (nunca se escribe `""`). El teléfono se normaliza
   con la regla del CRM; el email, en minúsculas.
2. **Quién es la persona** (la regla única de contactos, `find_or_create_contact`, ver [contactos.md](contactos.md)): por teléfono, email, WhatsApp o usuario de una red; **nunca por nombre**. Sin ningún
   identificador → «No se pudo» (`no_identifier`) y no se crea nada.
3. **Política**: «solo completar lo vacío» (por defecto) o «sobrescribir». Los tags se suman siempre (solo los que ya existen). El @ de
   Instagram de un contacto con canal vinculado **nunca** se pisa. Un identificador que ya es de otro contacto no se escribe y no se fusiona.
4. **Atribución**: detecta sola las UTMs, ids de anuncio y ids de clic (URL → raíz del payload → contenedores como `hidden`), ignorando
   valores sin reemplazar (`{{campaign.id}}`). Se anota un toque `origin = webhook` (`dedupe webhook:<envío>:<nodo>`). Si el contacto ya existía y
   no tenía ningún toque, antes se anota un toque ancla (`manual`) para que el primer toque no sea el webhook (decisión #254).
5. **Historial del contacto**: `contact.created`, `contact.updated` o `contact.linked`, con el actor «Webhook: <nombre>».

Todo se escribe con el cliente de servicio y **siempre sobre el workspace del endpoint** (nunca el del payload). Un fallo interno de la base
sí lanza: el envío queda `error` y se puede reprocesar.

## Avisar y escribir sin contacto (Tirón 2, D3–D5)

Un flujo de webhook arranca sin contacto. Dos pasos sirven igual en ese tramo, antes de «Crear o actualizar contacto»:

- **Enviar WhatsApp a un número**: un aviso (por ejemplo, a la dueña cuando entra un lead) a un número fijo o al de una variable
  (`{{webhook.body.telefono}}`), por un canal de WhatsApp que se elige en el paso. Busca el número entre los contactos pero **no crea nada**:
  si es de alguien marcado «no contactar» no se manda; si es de un contacto con conversación en ese canal, queda guardado ahí; si no es de
  nadie, se manda igual y queda en el historial del flujo. Un mismo paso nunca manda dos veces al mismo número en la misma ejecución, y
  respeta el tope de 200 mensajes automáticos por hora del canal.
- **Enviar email** con el destino **«la dirección de una variable»** (`{{webhook.body.email}}`): se valida al correr y, si no es un email o es
  de un contacto «no contactar», se saltea con el motivo.

Los pasos salteados aparecen en el detalle del envío («pasos salteados»).

**Guardar un flujo publicado** por la API (`PUT /api/v1/flows/:id`) se valida igual que al publicar (con las aristas): si el grafo ya no
cumple la regla del contacto, no se guarda y la respuesta trae el motivo. Un borrador se puede guardar a medias.

## Dónde está el código

`app/api/hooks/[token]/route.ts` (envoltorio delgado) · `lib/webhooks/*` · `lib/actions/webhook-endpoints.ts` ·
`lib/flow-engine/{contact-requirement,nodes/upsert-contact,registry/webhook-triggers,registry/webhook-conditions}.ts` ·
`components/webhooks/*` y `components/flow-builder/panels/{WebhookTriggerPanel,UpsertContactPanel}.tsx` ·
migraciones `00186` a `00188` · verificación: `node scripts/verify-inbound-webhooks.mjs` (con la app local corriendo prueba el receptor de punta a punta).

## Lo que esto NO es

- No hay autenticación HMAC todavía (`auth_mode` solo admite `token`; `hmac` queda reservado para Ventas Fase 2 / Whop, y `handler_key` también).
- Un envío no crea mensajes ni conversaciones: crea o actualiza el contacto y dispara flujos.
- No es un conector de ida: para llamar a un servicio de afuera está el nodo «HTTP Request».
