# Revisión de octubre — plan de ejecución

> **Objetivo (goal) de la ejecución:** dejar hechos los puntos 1–3 y 5–15 de
> [`recorrido.md`](recorrido.md) tal como dice este plan, en la rama
> `feat/revision-octubre`, con un PR a `main`. El punto 4 (Gmail) **no se
> construye**: se documenta para un plano propio.
>
> **Terminado =** cada punto hecho o anotado en `docs/PENDIENTE.md` con el
> motivo · `npx vitest run` y `npm run build` en verde · los `verify-*`
> indicados en verde (de a uno) · lo visual comprobado en el navegador
> integrado con screenshot · PR abierto con resumen punto por punto.
>
> **Si algo se traba:** se anota con qué pasó y se sigue con el resto. No se
> frena a preguntar. Lo que este plan no autoriza, no se hace.

---

## 0. Antes de arrancar

**Lo que aprueba Wendy al aprobar este plan** (lo delicado, según CLAUDE.md):

| Qué | Tipo | Cuándo se aplica |
|---|---|---|
| Migración de productos (precio + estado en `content_offers`) | aditiva | durante la ejecución |
| Migración de `email_log.contact_id` + policy de lectura | aditiva + RLS | durante la ejecución |
| Migración de acciones y aviso de topes de gasto | aditiva | durante la ejecución |
| Migración de alcance por rol (`can_see_contact` sin los interruptores del workspace) | **cambia accesos (RLS)** | se escribe y se ensaya en una transacción que se deshace sola; **se aplica recién después del merge y el deploy** |

Los números son **tentativos** (00133 a 00136). Confirmar la próxima libre con
`list_migrations` (o `supabase migration list --linked`) antes de escribir la
primera. Después de cada una: `node scripts/build-all-migrations.mjs`. Se
aplica con la CLI y se registra en `supabase_migrations.schema_migrations`,
como dice CLAUDE.md.

**Nada se borra en esta tanda.** Las columnas que dejan de usarse
(`persist_zernio_inbound`, `lead_scope_enabled`,
`unassigned_leads_visible_to_members`, `agent_escalate_on_unreadable` del lado
del agente) quedan en la base y se anotan en `PENDIENTE.md` para borrarlas más
adelante, con el orden de siempre: primero el código desplegado, después el
borrado.

**Preparación:**
```
git checkout main && git pull
git worktree add ../ssa-revision -b feat/revision-octubre
cd ../ssa-revision && npm install
npx vitest run && npm run build   # punto de partida; si viene en rojo, anotar y seguir
```

**Antes de irse, Wendy inicia sesión** en el navegador integrado contra el dev
server local (`npm run dev`, localhost:3000). Sin eso no se puede hacer la
revisión visual: Claude no escribe contraseñas. Si la sesión no está, la
verificación visual se anota como pendiente y se sigue.

**Commits:** uno por tanda, con rutas explícitas (`git add <rutas>`, nunca
`git add -A`).

---

## Respuestas a las dudas del recorrido

**1b. ¿Cómo y cuándo se transcribe hoy?**
- **Audio que manda un lead:** se transcribe **en el momento**, apenas llega,
  y si falla queda en la cola para reintentar (corre cada minuto).
- **Audio que mandás vos desde la bandeja:** también en el momento. Pero por
  el bug del punto 1a, hoy tu grabación se guarda como **video** y por eso no
  se transcribe.
- **Audio guardado en Recursos:** **no** se transcribe en el momento. Queda en
  la cola, que lo agarra al minuto. Guardar nunca espera a la transcripción.
  Lo que sí espera es el agente: no puede usar un audio hasta que tenga la
  transcripción lista.
- **Escribirla a mano:** hoy se puede solo **después** de crear el recurso
  (botón "Escribirla a mano" al editarlo). Al crearlo no hay campo.

**4b/4c. Gmail.** No está hecho ni planificado: es una línea en "Extras". La
app de Google que ya cargaste (YouTube y Calendar) sirve: Gmail sería otro
proveedor en la misma app, y entraría como un canal de email más en la
bandeja. Pero es grande, por tres cosas:
- Hoy la base permite **un solo canal de email por negocio**.
- Gmail **no avisa solo** cuando llega un correo: hay que ir a buscarlo.
- Google exige una **auditoría de seguridad anual** para usar Gmail fuera del
  modo prueba, porque considera sus permisos "restringidos".

Va a su propio plano: ver 4 más abajo.

**8. ¿Los emails salen en Conversaciones?** Sí, los del canal de email: las
respuestas a mano y lo que manda un flow o una secuencia por ese canal. **No**
salen los emails automáticos de reservas (confirmación, recordatorio): hoy no
quedan asociados al contacto en ningún lado. El punto 8 los suma al historial.

**11d. ¿Se guardan los comentarios?** Sí: 354 comentarios guardados en los
últimos 30 días. El interruptor nunca los afectó.

**12. ¿Por qué el escalado está en Ajustes generales?** Porque se guardó como
dato del negocio y no del agente. Además lo usan los flows y las secuencias,
que no tienen agente. Ver 12.

---

## Tanda 1 — Audios: grabar, mandar y transcribir (puntos 1a–1d)

**Causa del bug (1a):** el navegador graba en MP4 (Chrome y Safari). El
detector de formato (`sniffMime`, `lib/content/media.ts:105-110`) solo llama
"audio" a un MP4 si su encabezado dice `M4A `; las grabaciones dicen `isom` o
`iso5`, así que las toma como **video**. En Recursos eso se rechaza. En la
bandeja pasa sin error, pero se manda y se guarda como video y no se
transcribe.

1. **Arreglo de raíz:** en `sniffUploadMime` (`lib/content/media.ts:153-176`),
   si el archivo es MP4 (no `qt  `, HEIC ni 3GP) y el tipo declarado empieza
   con `audio/`, devolver `audio/mp4`. `sniffMime` no se toca (la usa el
   pipeline de contenido). Con esto quedan arreglados Recursos y la bandeja,
   porque los dos usan el mismo grabador (`components/inbox/voice-recorder.tsx`,
   `lib/audio/recording.ts`).
   - Test: un MP4 con brand `isom` y declarado `audio/mp4` da `audio/mp4`;
     declarado `video/mp4` sigue dando `video/mp4`.
   - Test: `requestChatUpload` clasifica esa grabación como `voice`, no `video`
     (`lib/actions/chat-upload.ts:28-31`).
2. **Formatos por canal (1c):** WhatsApp (Evolution) acepta todo y convierte
   solo. Instagram (Zernio) acepta MP4/M4A, que es lo que graban Chrome y
   Safari. Firefox graba WebM, que Instagram rechaza: eso ya avisa antes de
   subir ("Probá desde Safari…") y se deja así. **No se agrega conversión
   propia** (no hay ffmpeg, a propósito).
3. **Flujo de transcripción en Recursos (1b).** Recomendación: **guardar nunca
   espera**.
   - Al crear un audio o un video con voz, se intenta transcribir **en el
     momento**, en el `after()` de la Server Action, igual que con lo que
     manda un lead. La cola queda como respaldo. Se reusa `transcribeAsset`
     (`lib/response-assets/transcribe.ts`) con su claim condicional, así no se
     cobra dos veces.
   - En el formulario de **alta**, un campo opcional **"Transcripción (si la
     querés escribir vos)"**. Si se completa, se guarda como manual y no se
     llama a la IA.
   - En la lista y en la edición, un botón **"Transcribir con IA"** cuando el
     estado es `none` o `failed`. Se amplía `retryTranscription` para aceptar
     `none`.
   - El estado se ve en la tarjeta: transcribiendo / lista / falló. El agente
     sigue sin poder usar el audio hasta que la transcripción esté lista
     (`agentUsable`, sin cambios).
4. **Guardar y transcribir lo que se manda desde la bandeja (1d):** ya se
   guarda en `messages` y en `chat-media` para los dos canales. Con el arreglo
   1 pasa a tipo `voice` y entra a la transcripción.
   - Mover `afterMediaStored` de la respuesta a un `after()` real
     (`app/api/v1/messages/route.ts:429-431`), como ya dice su comentario,
     para no demorar el envío.
5. **Revisar y corregir si se confirma:** cuando el agente manda un audio por
   Instagram, `lib/agent/send-asset.ts` guarda la transcripción como texto del
   mensaje, y `sendViaZernio` la manda también en el campo `message`
   (`lib/flow-engine/send.ts:314`). El lead recibiría el audio **más** la
   transcripción escrita. Si se confirma leyendo el código y el test de
   caracterización, no mandar texto junto al audio por Zernio (la
   transcripción queda guardada igual). **No se tocan las aserciones de
   `lib/publishing/zernio.test.ts`.**

**Verificar:** tests nuevos y existentes de `lib/content/media`,
`response-assets` y `chat-upload`. En el navegador: grabar en Recursos →
Guardar → se guarda, y la transcripción aparece sola en un minuto como mucho.
Grabar en la bandeja → la burbuja sale como nota de voz.

---

## Tanda 2 — Limpieza de Ajustes generales (puntos 11 y 12)

**11. Guardar mensajes siempre.**
- Sacar `components/settings/message-persistence-settings.tsx` de
  `settings-view.tsx` y la acción que la escribe
  (`lib/actions/workspace.ts:171`).
- En `persistInboundMessage` (`lib/inbound.ts:290-354`) dejar de leer
  `persist_zernio_inbound`: siempre guarda.
- En `lib/agent/dispatch.ts:111-127`, quitar el salto
  `message_persistence_off`.
- La retención de **12 meses** queda igual (`purge_old_messages`, vale para
  todos los canales). Es lo que ya decía la pantalla.
- Actualizar `docs/flujo-de-mensajes.md` y la sección de webhooks de
  CLAUDE.md, que hablan del interruptor.

**12. Escalado al agente.**
- En `lib/agent/schemas.ts:120-141`, sumar
  `guardrails.escalation.onUnreadable: z.boolean().default(true)`. No hace
  falta migración ni GRANT: `guardrails` ya se lee.
- `lib/agent/runner.ts:1230-1239` lee el valor del agente.
- En la pestaña Configuración del agente (`components/agents/config-tab.tsx`,
  `GuardrailsSection`), un interruptor con el mismo texto de hoy.
- Sacar `components/settings/escalation-settings.tsx` de Ajustes generales.
- **Flows y secuencias** (`lib/ai/generate-reply.ts:155-161`) no tienen
  agente: siguen leyendo la columna del workspace, que hoy vale `true` en los
  dos workspaces y queda sin pantalla. Escalar ante la duda es lo seguro. Se
  anota en `docs/agente-ia.md`.

**Verificar:** `lib/agent/runner-unreadable.test.ts` actualizado (lee del
agente), tests de dispatch e inbound, y `node scripts/verify-rls.mjs`.

---

## Tanda 3 — Topes de gasto ligados a Agentes (punto 9)

**Hallazgo:** el cartel de Ajustes dice "el diario avisa", pero el tope diario
del workspace **ya frena** la IA hasta la medianoche, y el mensual apaga el
agente (`lib/ai/spend.ts:94,97`). El mismo editor de topes ya existe dos veces:
en Ajustes (`components/settings/ai-limits-settings.tsx`) y en la pestaña de
costos de cada agente (`components/agents/costs-tab.tsx:170`, `LimitsSection`).

**Recomendación: un solo lugar, la página Agentes.** Agentes pasa a ser "la
sección de IA".
1. **Migración aditiva** (tentativa `00135_ai_spend_actions`) en `workspaces`:
   - `ai_daily_limit_action text not null default 'disable'` y
     `ai_monthly_limit_action text not null default 'disable'`, ambos con
     CHECK `in ('disable','notify')`.
   - `ai_spend_alert_pct smallint null`, con CHECK entre 1 y 99.
   - Los defaults mantienen exactamente el comportamiento de hoy.
2. `lib/ai/spend.ts` lee las acciones de la base en vez de tenerlas fijas.
3. **Aviso por porcentaje:** al pasar el X % de cualquiera de los dos topes,
   una notificación nueva `ai_spend_threshold` en `lib/notifications/types.ts`
   vía `createNotificationOnce`, una por día (tope diario) o por mes (tope
   mensual). Sin porcentaje, no hay aviso.
4. **Pantalla:** en el panel "Gasto de IA" de `/dashboard/agents`
   (`components/agents/ai-dashboard/section.tsx`), una tarjeta **"Topes y
   avisos"**:
   - diario y mensual, cada uno con "al llegar: apagar / solo avisar";
   - "avisarme al llegar al __ % del tope";
   - el texto explica bien qué hace cada cosa.

   Reusar `LimitsSection` y `updateWorkspaceAiLimits`
   (`lib/actions/agents.ts:596-623`), ampliada con los campos nuevos y
   validada en el servidor. Se saca de Ajustes generales. La edición queda
   para quien hoy puede guardar topes.
5. **Centralizar notificaciones:** hoy no existe un lugar de ajustes de
   notificaciones. Se anota en `PENDIENTE.md`, como regla para cuando se
   construya, que el aviso de gasto tiene que aparecer ahí enlazado a esta
   tarjeta (una sola fuente del dato, dos pantallas).

**Verificar:** tests de `lib/ai/spend` con las dos acciones y el aviso (umbral
justo, una sola vez por período). En el navegador: la tarjeta guarda y
recarga los valores.

---

## Tanda 4 — Productos y pilares (punto 2)

**Recomendación: renombrar en pantalla, no en la base.** Renombrar la tabla
`content_offers` obligaría a tocar unos 30 archivos y una función de la base
de un saque, con riesgo en el deploy. Se suma lo nuevo y se documenta que
`content_offers` **es** el catálogo de productos. El renombre de tabla se
anota para cuando se construya Ventas.

1. **Migración aditiva** (tentativa `00133_products_price_status`) en
   `content_offers`:
   - `price_usd numeric(12,2)` con CHECK `>= 0`. Puede ser nulo en la base por
     las filas viejas, pero **es obligatorio** en el formulario y en la Server
     Action. Siempre USD, como pidió Wendy.
   - `status text not null default 'active'` con CHECK
     `in ('active','inactive','discontinued')`.
   - Backfill: lo que tenga `archived_at` pasa a `discontinued`.
   - `archived_at` se sigue escribiendo **en sincronía**: `discontinued` lo
     llena y los otros estados lo vacían. Así lo que ya filtra por archivado
     sigue funcionando.
   - Sigue sin policy de DELETE: un producto no se borra, se discontinúa.
2. **Reglas:** solo un producto `active` se puede elegir al clasificar una
   idea o una pieza nueva (`lib/content/classification-refs.ts`). Lo ya
   clasificado conserva su producto, aunque cambie de estado.
3. **Ajustes:** la pestaña "Contenido" pasa a **"Productos"**, con la ruta
   `/dashboard/settings/productos` (en `lib/settings/tabs.ts`) y redirección
   desde `/contenido`.
   - Lista de productos con nombre, precio en USD y estado (selector).
   - Reusa `lib/actions/content-taxonomy.ts`, ampliada con precio y estado;
     el permiso sigue siendo `settings.manage`.
4. **Pilares, a la página de Contenido:** un botón ⚙️ en el `PageHeader` de
   `/dashboard/content` (`content/page.tsx:327-341`), visible con
   `can("settings.manage")`.
   - Abre "Ajustes de contenido" en el drawer o el diálogo existente
     (`components/content/dialog.tsx`), con la sección de Pilares (se reusa
     `TaxonomySection`).
   - Pensado para sumar otros ajustes de contenido después.
5. **Textos:** "Oferta" pasa a "Producto" en todo lo visible: clasificación,
   drawers, kanban y el dashboard de contenido (agrupar y filtrar). El
   parámetro `?oferta=` **se mantiene** para no romper links. El copywriter
   (`lib/agent/copywriter.ts`) dice "producto" en el prompt.

**Verificar:** `lib/actions/content-taxonomy.test.ts` (sigue sin `.delete()`)
y `node scripts/verify-content.mjs` y `verify-rls.mjs`, actualizados con
precio y estado. En el navegador: crear un producto con precio, cambiarlo a
discontinuado y ver que deja de ofrecerse al clasificar.

---

## Tanda 5 — Zernio: Cuentas = Canales (punto 13)

1. Sacar el cuerpo de `channels-view.tsx` a un componente
   `components/channels/channels-panel.tsx`. Recibe el filtro de proveedor y
   trae adentro sus botones "Sincronizar" (solo Zernio) y "Conectar canal".
2. **Zernio → Cuentas** (`components/settings/integrations/accounts-tab.tsx`):
   arriba el panel filtrado a Zernio (tarjetas con foto, @, estado, link
   ig.me, apagar, borrar, Sincronizar, Conectar). Abajo se queda "Por donde
   publica cada cuenta".
3. **Evolution → Cuentas:** el mismo panel filtrado a WhatsApp, con el QR.
   Así las dos integraciones quedan iguales.
4. La vuelta del OAuth de Zernio (`app/api/v1/channels/connect/route.ts:69` y
   la página de callback) acepta un `return` y vuelve a
   `/dashboard/settings/integrations/zernio?tab=cuentas`.
5. `/dashboard/channels` **sigue funcionando** (lo cuida
   `lib/nav/channels-links.test.ts`), usando el mismo panel sin filtro.

**Verificar:** `lib/nav/channels-links.test.ts` y el build. En el navegador:
la pestaña Cuentas de Zernio muestra la tarjeta del canal de Instagram y los
dos botones.

---

## Tanda 6 — Barras de Agenda y Contactos (puntos 5 y 6)

**Piezas compartidas nuevas** en `components/ui/`, que las dos barras usan
iguales:
- `FilterIconButton`: botón de solo ícono (`SlidersHorizontal`) con un
  globito con la cantidad de filtros activos. Sobre `FilterMenu`
  (`components/ui/filter-menu.tsx`), que ya maneja teclado y clic afuera.
- `ExpandableSearch`: lupa que al hacer clic se expande en un campo. Enter
  aplica, Esc cierra, y si está vacía se cierra sola al salir. Recibe un
  `hint` opcional para el cartelito.
- `Tooltip` genérico simple (hoy solo existe `InfoTooltip`).

**Arreglo de base en `PageHeader`** (`components/page-header.tsx:68-71`):
`min-w-0` y `shrink-0` donde corresponde, para que nada quede cortado contra
el borde derecho (hoy `main` es `overflow-hidden`).
- Revisar que las otras pantallas que usan `PageHeader` no cambien: Bandeja,
  Contenido y dashboards.

**5. Agenda** (`components/scheduling/bookings/bookings-view.tsx:173-249`):
- **5b.** "+ Agendar": ícono `<Plus/>` más texto con `whitespace-nowrap
  shrink-0`, igual que "Nuevo contacto".
- **5c.** Se saca el chip de zona horaria. El ícono de ajustes de Agenda que
  ya existe (hoy no se veía porque quedaba cortado) queda visible, con
  tooltip "Ajustes de agenda · hora de Costa Rica (GMT-6)". La zona ya figura
  en cada fecha de la lista.
- **5d.** `AgendaFiltersMenu` usa `FilterIconButton`.
- **5e/5f.** `PeriodPopover`
  (`components/dashboards/chat/filters/period-popover.tsx`):
  - se cierra con clic afuera (listener `mousedown`) y con Esc (el foco entra
    al abrir);
  - celdas del calendario con ancho mínimo (~34 px) y el panel con ancho fijo
    (~640 px) para que respire.

  Lo usan también los dashboards de Chat e IA: mejora para los tres.
- **5g.** "Buscar contacto" pasa a `ExpandableSearch`. Si hay un rango de
  fechas, el cartelito dice "Buscás dentro de: {rango}".
- **5a.** Queda resuelto con lo anterior. Si "la IVA" del dictado era otra
  cosa, se anota.

**6. Contactos** (`app/(dashboard)/dashboard/contacts/contacts-view.tsx`):
- Se eliminan las dos filas de filtros (líneas 164-264). Todo sube al
  `PageHeader`: `ExpandableSearch` + `FilterIconButton` (con todos los
  filtros como grupos dentro del menú: Tag, Setter, Vendedor, Temperatura,
  Origen y Medio del 1er toque, Canal, Sin datos, y "Limpiar") + **Ordenar
  por**.
- **Ordenar por** (nuevo):
  - parámetro `orden` con lista blanca en `contacts/page.tsx:110-111`:
    última interacción (por defecto), más nuevos, más viejos, nombre A-Z;
  - el selector es un `FilterMenu` con ícono `ArrowUpDown`.
- Los parámetros de URL actuales no cambian. Los links viejos siguen
  funcionando.

**Verificar:** tests de los helpers nuevos (conteo de filtros de contactos,
lista blanca de `orden`), `node scripts/verify-crm.mjs`. En el navegador, a
1440 px y a 375 px: nada se corta; el calendario se cierra con clic afuera;
la lupa se expande; el globito cuenta bien.

---

## Tanda 7 — Ficha del contacto (puntos 7 y 14)

Todo en `app/(dashboard)/dashboard/contacts/[contactId]/page.tsx` (el orden es
el del JSX).

1. **Componente nuevo `InlineField`** (`components/contacts/inline-field.tsx`):
   - muestra el valor; con clic (o Enter con foco) pasa a input;
   - guarda al salir o con Enter, y Esc cancela;
   - valida con `validateContactField` (`lib/contacts/fields.ts:96`) mientras
     escribís;
   - guarda **un solo campo** con `updateContact`
     (`lib/actions/contacts.ts:135-150`), que ya valida en el servidor y deja
     el registro en `audit_log`;
   - error con toast y vuelta al valor anterior.
2. **Título editable:** el nombre del encabezado usa `InlineField`.
3. **Columna principal, en este orden:**
   1. **Notas**
   2. **Datos de contacto**, ordenado por secciones, todo con `InlineField`:
      - *Contacto:* email, email secundario, teléfono, WhatsApp, país.
      - *Redes:* Instagram, TikTok, Twitter/X, Facebook, YouTube, LinkedIn
        (el @ de Instagram sigue siendo link, `lib/contacts/links.ts`).
      - *Resumen del agente IA.*
   3. Conversaciones · Secuencias · Reuniones · Atribución · Historial.
4. **Columna derecha:** Asignación · Seguimiento (suma **Temperatura** junto a
   "Próximo seguimiento", que ya se edita en el lugar) · **Tags** · Acciones
   rápidas · Campos personalizados · Canales vinculados.
5. Se elimina `ContactEditor` con su botón "Editar"
   (`components/contacts/contact-editor.tsx`): todo lo que editaba
   (`CONTACT_FIELDS`) queda en la ficha. Con eso desaparece también el bug de
   que no tenía scroll.
6. El scope de leads no cambia: un Member sin permiso de edición ve los datos
   pero no puede editarlos (mismo guard que hoy en `updateContact`).

**Verificar:** test de `InlineField` (guarda, cancela, muestra el error de
validación). `node scripts/verify-crm.mjs`. En el navegador: editar el nombre
y el teléfono desde la ficha y recargar.

---

## Tanda 8 — Historial con todo lo automático (punto 8)

Hoy el historial (`components/contacts/history-section.tsx`) muestra solo
`audit_log` del contacto, 20 filas, y la automatización aparece genérica, sin
nombre.

1. **Migración** (tentativa `00134_email_log_contact`):
   - `email_log.contact_id uuid null references contacts on delete set null`,
     con índice;
   - policy de SELECT para que lo vea quien puede ver ese contacto
     (`can_see_contact`), además de lo que ya hay.
2. El nodo `send_email` (`lib/flow-engine/nodes/send-email.ts:90-101`) pasa
   `context.contactId` y lo escribe en `email_log`.
3. **El historial junta**, ordenado por fecha, con "Ver más" en vez del tope
   fijo de 20:
   - lo de `audit_log` que ya muestra;
   - `automation_triggered` con el **nombre** del flow;
   - inicio y fin de flows (`analytics_events`: `flow_started`,
     `flow_completed`), con nombre;
   - inscripciones a secuencias (las que hoy van con
     `entity_type='sequence_enrollment'`, buscadas por el contacto);
   - emails automáticos (`email_log` del contacto): "Email automático
     enviado: {asunto}".
4. Los mensajes de chat y del canal de email **no** se repiten: ya están en
   Conversaciones.
5. La lectura respeta el scope: se hace con el cliente del usuario, nunca con
   el service role.

**Verificar:** test del armado del historial (orden, etiquetas, sin
duplicados). `node scripts/verify-rls.mjs` con un caso nuevo: un Member ve el
email automático de su lead y no el de un lead ajeno.

---

## Tanda 9 — Recursos en automatizaciones (punto 3)

Hoy ningún flow ni secuencia conoce la banca: el nodo "Enviar mensaje" solo
acepta una URL suelta.

1. **Helper único de envío de recurso**: se saca de `lib/agent/send-asset.ts`
   a `lib/response-assets/send-asset.ts`, para que lo usen el agente, los
   flows y las secuencias.
   - Texto y enlace: se interpolan con el contacto y el workspace.
   - Archivos: `copyAssetToChat` → `sendChannelMessage` con `media` → se
     guarda el mensaje.
   - Siempre consulta `channelAccepts`.
   - Siempre `touch_response_asset` después de mandar.
   - Si el canal no acepta ese tipo, el paso se saltea con un registro claro,
     nunca falla en silencio.
2. **Flows: nodo nuevo "Enviar recurso"** (`lib/flow-engine/nodes/send-asset.ts`):
   - registrado en `lib/flow-engine/registry/nodes.ts` y en
     `components/flow-builder/node-palette.tsx`, según `docs/flow-registry.md`;
   - el panel tiene un selector de la banca con búsqueda por nombre, atajo y
     tipo (se reusa la lista de `lib/response-assets/list.ts`).
3. **Secuencias:** un tipo de paso nuevo `asset` en el processor
   (`lib/sequences/processor.ts`) y su editor, con el mismo helper.
   - Antes de escribir, comprobar si los pasos se guardan en jsonb sin CHECK.
     Si hay CHECK, hace falta una migración aditiva: escribirla con el
     siguiente número libre y aplicarla (queda autorizada por este plan).
4. **Emails:** en el nodo `send_email`, botón "Insertar recurso" para **texto
   y enlace** (es lo que `channelAccepts` permite para email). Adjuntar
   archivos a un email se anota en `PENDIENTE.md`: exige sumar adjuntos a
   `SendEmailParams` y cambiar la regla de `channelAccepts` para email.
5. La prueba de frontera `lib/response-assets/table-boundary.test.ts` sigue
   en verde.

**Verificar:** tests del helper (canal que no acepta → se saltea; archivo →
pasa por `copyAssetToChat`, nunca el path de `library/`) y el test de
consistencia de la paleta y el registro. `node scripts/verify-publishing.mjs`
no debería cambiar.

---

## Tanda 10 — Visibilidad por rol (punto 10) · *delicada*

Decisiones de Wendy: **tercera opción por rol** para los sin asignar; Agenda
queda **solo donde es anfitrión**, como hoy.

Lo que ya existe: los roles ya tienen alcance "Solo los suyos / Todos" para
contactos, conversaciones y agendas (`SCOPED_MODULES`,
`lib/auth/permissions.ts:134`; `ScopeField` en
`components/settings/roles/roles-view.tsx`).

1. **Catálogo:** el alcance de `leads` suma un tercer valor `own_unassigned`
   ("Asignados + sin asignar"). Member sigue en `own`. Admin y Owner, todo.
   Conversaciones sigue a contactos. Agenda no cambia.
2. **Pantalla de Roles:** `ScopeField` muestra las tres opciones para
   Contactos.
3. **Migración** (tentativa `00136_lead_scope_by_role`): reescribe
   `can_see_contact` (copiando la `00089` letra por letra y cambiando solo
   lo necesario). La definición vieja va completa en el comentario de
   cabecera, para volver atrás.
   - Deja de leer `lead_scope_enabled` y `unassigned_leads_visible_to_members`.
   - Ve el contacto: admin → alcance `all` → asignado (setter, vendedor o
     conversación) → alcance `own_unassigned` y el contacto sin asignar.
   - **Paso de lo que hay hoy, sin ganar ni perder accesos por accidente:**
     los roles personalizados con `leads='own'` en un workspace que tenía
     "sin asignar visibles" prendido pasan a `own_unassigned`.
   - **Lo que sí cambia, a propósito:** el Member de sistema vive en el
     código con `own`. En el workspace que hoy tiene "sin asignar visibles"
     prendido (hay uno de los dos), los Members **dejan de ver los leads sin
     asignar**. Es lo que se eligió ("Member por defecto ve solo los
     asignados"). Si se quiere otra cosa para ese equipo, se crea un rol con
     "Asignados + sin asignar".
4. Se saca `components/settings/lead-scope-settings.tsx` de Ajustes
   generales, junto con su acción (`updateLeadScope`).
5. **Orden de aplicación:**
   1. el código va en el PR;
   2. la migración se **ensaya** contra la base en una transacción que se
      deshace sola, corriendo los casos de `verify-roles`;
   3. un respaldo de `workspace_roles` y de los dos interruptores;
   4. **se aplica recién después del merge y el deploy**.

   Con el código nuevo y la función vieja, `own_unassigned` se comporta como
   `own`: no abre nada de más.

**Verificar:** `scripts/verify-roles.mjs` y `verify-rls.mjs` actualizados
(dejan de forzar el interruptor; prueban los tres alcances y que un Member no
ve un lead sin asignar). `lib/auth/member-baseline.test.ts` en verde.

---

## Tanda 10b — Dashboards: sacar "Gasto de IA" y sumar Agenda (punto 15)

1. **15a.** Sacar la entrada `ai-spend` de `DASHBOARDS`
   (`lib/dashboards/available.ts:69-76`) y ajustar
   `lib/dashboards/available.test.ts`. El mecanismo de "Próximamente" queda,
   sin entradas.
2. **15b. Dashboard de Agenda**, en `/dashboard/dashboards/agenda`:
   - **Entrada en el selector:** "Agenda — Reuniones, quién agenda y de
     dónde viene".
   - **Permiso nuevo:** `dashboards.agenda.view` en `lib/auth/permissions.ts`.
     Owner y Admin lo tienen siempre; Member, no por defecto (se actualiza
     `lib/auth/member-baseline.test.ts`, como pasa con los otros dashboards).
   - **Lógica pura** en `lib/dashboards/agenda.ts`, con su test; la pantalla
     solo pinta.
   - **Lectura con el cliente del usuario**, así respeta el alcance de Agenda
     (un Member ve solo las reuniones donde es anfitrión).
   - **Período:** reusa `PeriodPopover`. Cuenta por **fecha de creación** de
     la agenda (cuándo agendó el lead), que es lo que sirve para medir
     atribución. Un selector "por fecha de reunión" cambia el eje.
   - **Tarjetas:**
     - **Agendas**: total;
     - **Contactos que agendaron**: `contact_id` distintos;
     - **Canceladas**;
     - **No asistieron** (`no_show`);
     - **Con resultado** (`status_group = 'outcome'`);
     - **Ventas** (`status = 'sale'`).
   - **Tablas de desglose:**
     - por **estado**;
     - por **categoría** (`category_snapshot`, la congelada);
     - por **responsable** (`host_user_id`);
     - por **origen** (link público / manual / agente);
     - por **UTM**: source, medium y campaign desde `bookings.utm`, con los
       índices de la `00129`.
   - **Reglas de siempre del módulo:**
     - **nada se pierde**: lo que no tiene valor va a "Sin asignar" y la suma
       de las filas es el total;
     - **nunca se inventa un cero**: un período sin datos muestra el estado
       vacío;
     - cada tabla aclara si cuenta agendas o contactos.
   - Tomar como molde el dashboard de Chat (`lib/dashboards/chat/`,
     `components/dashboards/`) y `components/dashboards/group-table.tsx`.

**Verificar:** test de `lib/dashboards/agenda.ts` (contactos únicos ≠ agendas,
"Sin asignar", suma = total) y `node scripts/verify-dashboards.mjs`. En el
navegador: el selector ya no muestra "Gasto de IA" y Agenda abre con los
números de la reunión de prueba.

---

## 4 — Gmail: fuera de esta tanda

No se construye. Se anota en `docs/PENDIENTE.md` una sección **"Gmail
multicuenta — hallazgos para el plano"** con lo ya investigado:
- **Lo que se reutiliza:** el cliente OAuth de Google en Vault, los
  adaptadores (`lib/oauth/registry.ts`), el modelo multicuenta de Calendar y
  el canal de email (`lib/email/*`).
- **Lo que falta:**
  - `gmail` en los CHECK de `oauth_connections` y `channels`;
  - aflojar `uq_channels_email_per_workspace`;
  - `channels.oauth_connection_id`;
  - recepción con `users.watch` (Pub/Sub) o lectura periódica;
  - envío MIME con `threadId`;
  - la rama `gmail` en los dos caminos de envío.
- **Decisiones abiertas:** si las cuentas son del negocio o de cada persona;
  y la verificación CASA de Google o quedarse en modo prueba (tokens de 7
  días).

Próximo paso sugerido: armar su documento de requerimientos (skill
`metodo-builder:05-requerimientos`).

---

## Tanda 11 — Cierre

- `docs/PENDIENTE.md`:
  - Gmail;
  - columnas a borrar más adelante;
  - centro de notificaciones;
  - adjuntos en emails;
  - renombre de `content_offers` cuando llegue Ventas;
  - lo que se haya trabado.
- CLAUDE.md: migraciones nuevas y la próxima libre; productos =
  `content_offers`; guardado de mensajes siempre prendido; escalado por agente;
  alcance de leads por rol.
- `npx vitest run`, `npm run build`, y los `verify-*` tocados, de a uno:
  `verify-rls`, `verify-roles`, `verify-content`, `verify-crm`.
- PR a `main` con un resumen punto por punto: hecho / anotado / por qué.
  Incluir screenshots de antes y después de las barras, la ficha y Recursos.
- Avisar a Wendy qué falta de su lado:
  - mergear;
  - después del deploy, autorizar la aplicación de la migración de la tanda 10
    (o dejar que la sesión la aplique, si quedó autorizada).
