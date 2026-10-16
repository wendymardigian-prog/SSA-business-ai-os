# Mejoras de Chat, Agentes IA, Integraciones y Automatizaciones (16/10/2026)

Rama `claude/ai-agent-chat-improvements-f2c005`. Lo que se construyó a partir del backlog de nueve épicas
(A a I) más el punto O. **Contratos (épica H y la parte de contratos de la épica I) quedaron afuera a
propósito**: ver `PENDIENTE-mejoras-chat-agentes.md`.

Decisiones que tomó Wendy: las entrevistas de candidatos van en el área **Equipo**; una acción sin su
conexión **se puede guardar en borrador pero no publicar**.

## Qué se hizo, por épica

| Épica | Qué quedó | Dónde está lo importante |
|---|---|---|
| **A2** Emojis | Selector con búsqueda en español, categorías, varios seguidos, teclado/mouse/toque. Inserta en el cursor. Datos de `emojibase-data` servidos desde `public/emoji/es` (sin CDN). | `components/ui/emoji-picker.tsx` (`EmojiButton`, `EmojiPickerPanel`, `FieldEmojiButton`, `useEmojiInsert`); `lib/channels/text-limits.ts` (topes por canal contados como los cuenta cada proveedor) |
| **I2** Email con formato | Editor Tiptap: negrita, cursiva, subrayado, H1-H3, listas, enlaces, emojis y variables como fichas. Guarda HTML en el mismo campo `body`; un texto plano viejo se abre como párrafos. | `components/editor/rich-text-editor.tsx`, `lib/editor/email-body.ts`, `lib/email/html.ts` |
| **A1** Agente en el chat | "Sugerir respuesta" (deja un borrador, nunca envía), sugerencias descartadas recuperables, y "Qué hizo el agente" con un indicador por mensaje y un panel (popover en desktop, hoja en mobile). | `lib/agent/drafts/suggest.ts`, `lib/agent/runner.ts` (flag `suggest`), `lib/inbox/message-activity.ts`, `components/inbox/message-activity-panel.tsx` |
| **A3** Reacciones | Tabla `message_reactions` (00237). WhatsApp: cualquier emoji; Instagram: solo ❤️. Se envían por Evolution y por Zernio; las entrantes ya no entran como un mensaje vacío. | `lib/channels/reactions.ts`, `lib/channels/send-reaction.ts`, `lib/messages/reactions*.ts`, los dos webhooks |
| **A4 + C1** Chat limpio | Cabecera en una fila con menú "⋯", composer con "+" en mobile, secciones del chat en dropdown debajo de 860 px. | `lib/inbox/header-actions.ts`, `lib/inbox/composer-actions.ts`, `components/comunicacion/section-tabs.tsx` |
| **E1 + O** Agentes sin IA | Una sola regla de disponibilidad. Pantalla vacía con las tres opciones, interruptor bloqueado con el motivo, sección del agente del dashboard que se oculta / invita / avisa. | `lib/agent/availability.ts`, `lib/dashboards/chat/agent-visibility.ts`, `components/agents/no-ai-connection.tsx` |
| **F1** Conocimiento | Estado `pending` (00239): se puede subir sin Voyage y se indexa al conectarlo o con "Indexar pendientes". | `lib/knowledge/pending.ts`, `lib/knowledge/index-document.ts` |
| **G1** Acciones bloqueadas | Las acciones siguen en el constructor pero se ven bloqueadas; no se puede publicar/prender un flujo con un paso bloqueado. | `lib/flow-engine/node-requirements.ts`, `connection-problems.ts`, `capabilities.ts`, `components/flow-builder/capabilities-context.tsx` |
| **D1 + D2** Integraciones | Sin franja de "conviene conectar", tarjetas parejas, Fathom junto a las demás con los campos bajo demanda. | `components/settings/integrations/*` |
| **C2** Social mobile | Red y Formato en la franja de filtros; Analíticas y Actualizar solo con icono en pantallas chicas. | `components/social/social-view.tsx` |
| **B1** Agenda | Áreas Equipo (con Entrevista) y Otros (00240). | `supabase/migrations/00240_*`, `lib/scheduling/categories.ts` |

## Migraciones (escritas, probadas, **sin aplicar a la base real**)

`00237` (`message_reactions`), `00238` (el copywriter nace apagado), `00239` (estado `pending` de
Conocimiento, y reclasifica los errores que eran solo "falta Voyage"), `00240` (áreas Equipo y Otros).
Las cuatro son aditivas. Ver `docs/PENDIENTE-mejoras-chat-agentes.md` para el orden de aplicación.

## Lo que no se construyó tal cual estaba en el plan

- **Sin migración `agent_runs.message_ids`.** Se pensó para saber qué corrida corresponde a qué mensaje, pero se
  resolvió sin tocar la base: cada corrida ya guarda `inbound_at` (el último mensaje del contacto de su ráfaga), y
  `buildActivity` ancla por ahí (o por el último entrante anterior si no lo trae). Una migración menos.
- El plan numeraba `00239` para el copywriter y `00240` para Conocimiento; al no hacer `message_ids`, quedaron
  `00238` y `00239`, y Agenda es la `00240`.

## Verificación hecha

- `npx vitest run`: todo en verde; `tsc --noEmit` y eslint sin errores nuevos.
- Revisión visual en el navegador (desktop y 375 px) de: selector de emojis, editor de email, menú "⋯" de la
  cabecera, dropdown de secciones, panel "Qué hizo el agente", sugerencia descartada, tarjeta de Fathom, pantalla
  de "falta conectar una IA", acciones bloqueadas, estados de Conocimiento. Con datos de ejemplo en una página
  descartable (las pantallas reales piden sesión y no se probaron con datos reales).
- **No verificado en vivo**: mandar una reacción por WhatsApp o Instagram, recibir una, "Sugerir respuesta" contra
  el agente real, ni la indexación al conectar Voyage. Eso necesita las migraciones aplicadas y cuentas de prueba.
