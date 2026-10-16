# Pendientes — Mejoras de Chat, Agentes IA, Integraciones y Automatizaciones

## Antes de usarlo en producción

1. **Aplicar las migraciones, en este orden**, con `list_migrations` antes (el número de este archivo puede
   quedar viejo) y registrándolas en `supabase_migrations.schema_migrations`:
   - `00237_message_reactions` y `00240_booking_areas_team_other`: aditivas, sin riesgo para lo existente.
   - `00238_copywriter_seed_off`: solo cambia lo que nace de ahora; no toca los workspaces existentes.
   - `00239_knowledge_pending`: cambia el CHECK de `knowledge_base.status` y reclasifica como `pending` los
     documentos que hoy están en `error` solo por "Voyage AI no esta conectado". **Aplicarla ANTES de desplegar el
     código** (el código escribe `pending`; sin el CHECK nuevo la base lo rechazaría) y revisar antes cuántos son:
     `select count(*) from knowledge_base where status='error' and error_detail ilike 'Voyage AI no esta conectado%'`.
   - La `00237` también hace falta ANTES del código de reacciones (la bandeja la lee).
2. **Probar reacciones en vivo**, con una conversación de prueba (mandar una reacción es un mensaje real a un lead):
   - WhatsApp (Evolution): mandar, quitar y recibir una desde el teléfono. Confirmar que la entrante **no** crea un
     mensaje ni dispara al agente (hay tests, pero con Evolution simulado).
   - Instagram (Zernio): el código ofrece solo ❤️. **No verificado** que Zernio acepte más, ni cuál id acepta
     (`platform_message_id` o el nativo de Meta): se prueba el nativo primero y el propio si da 404. Si acepta más
     emojis, ampliar `INSTAGRAM_REACTIONS` en `lib/channels/reactions.ts`. Si Zernio no manda `reaction.received` para
     Instagram, las reacciones del contacto no aparecen (la doc del SDK solo menciona WhatsApp y Telegram).
3. **Probar "Sugerir respuesta"** contra el agente real en un canal en modo envío directo: tiene que dejar un
   borrador y no mandar nada.

## Decisiones que quedaron abiertas

- **El copywriter y su interruptor.** El generador no lee `agents.is_enabled`: genera igual aunque el agente figure
  "Apagado". La `00238` solo hace que los negocios nuevos muestren "Apagado". Si se quiere que el interruptor
  signifique algo, hay que hacer que el copywriter lo respete (y mostrarlo claro en Contenido).
- **Acciones bloqueadas: `sendMessage` y `sendAsset` piden "al menos un canal".** Es la regla más conservadora que
  evita publicar un flujo que no puede mandar nada, pero un flujo de Formularios o Agenda (sin conversación) que
  manda un mensaje queda bloqueado si el negocio no tiene ningún canal conectado.
- **El lienzo guarda directo en `flows`** (no por la API). Para un flujo ya publicado se agregó un freno en el
  navegador contra pasos nuevos sin conexión, pero no hay una validación del servidor en ese camino (viene de antes,
  ver `PENDIENTE-atribucion.md`).
- **`pauseAgent`/`resumeAgent` piden que exista un agente que converse**, no que esté encendido.
- **Reacciones solo a mensajes del contacto.** WhatsApp permite reaccionar a los propios; no se ofrece.
- **Límite del texto por canal (`lib/channels/text-limits.ts`)**: está probado y exportado, pero el composer todavía
  no avisa al pasarse (Instagram: 1000 bytes; WhatsApp: 4096). Falta conectarlo al composer.
- **`insertAsset` del composer** sigue reemplazando el texto (cuando se abre con "/" el texto era la búsqueda). Solo
  el emoji inserta en el cursor.

## Contratos (épica H e I1): NO se hicieron. Lo que se encontró al revisar el código

- El texto del contrato **no admite variables** (`{{contacto.nombre}}`): nada las reemplaza. La personalización
  viene solo de campos prellenados del formulario por parámetros de la URL.
- El orden es fijo: contrato → campos → firma. No hay "Modo A" (datos primero) ni "Modo B" (contrato ya completo).
- Los valores de la venta (monto, producto) viajan como parámetros de la URL: **la persona que firma puede
  cambiarlos**. Solo `sale_id` y `contact_id` van dentro del token firmado.
- El editor es una textarea con Markdown limitado (sin enlaces ni imágenes). Tiptap ya quedó instalado y servía de
  base (`components/editor/rich-text-editor.tsx`), pero el PDF usa Helvetica/WinAnsi y convierte los emojis en `?`.
- Estados que se pidieron (Enviado / Visto / Firmado / Vencido / Anulado) no existen: hoy solo "enviado sin firmar" y
  "firmado".
