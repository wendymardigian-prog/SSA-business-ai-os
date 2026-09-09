# Bitácora del proyecto

Registro de qué se construyó, qué se decidió y por qué. Se actualiza al cerrar
cada bloque.

---

## Etapa 1 · Fase 2 · Bloque 1 — Flow builder y triggers

**Fecha:** 8 de septiembre de 2026
**Alcance:** F1 a F8 del documento de requerimientos de la Fase 2.

### Estado del prerrequisito al arrancar

El receptor único de webhooks ya funcionaba: Zernio entrega en
`https://ssa-business-ai-os-production.up.railway.app/api/webhooks/late`, con el
secreto que coincide, y la cadena `route.ts → runInboundAutomation →
matchTrigger → executeFlow` corre de verdad (verificado contra la API de Zernio
y contra la base, no solo contra el código).

Lo que faltaba era retirar la Edge Function, que seguía desplegada pero
huérfana: no estaba registrada en Zernio, así que no recibía nada.

### Qué se hizo

**1. Edge Function retirada.** Se borró `supabase/functions/` (866 líneas), la
entrada de `config.toml` y el despliegue. Se corrigieron los comentarios que
afirmaban lo contrario de la realidad (`lib/zernio-webhook.ts` decía que la URL
registrada "hoy es la Edge Function"). Verificado: el endpoint devuelve 404,
igual que uno inexistente.

**2. Los cron jobs pasaron a pg_cron.** Estaban declarados en `vercel.json`, que
Vercel lee y Railway no. La app está en Railway: **no los corría nadie**. Eso no
era configuración pendiente, era funcionalidad apagada — un nodo Delay paraba el
flow para siempre y las secuencias no avanzaban.

Ahora los agenda `pg_cron` dentro de la base. Las rutas de la app se llaman con
`pg_net` y el secreto en el header `Authorization` (no en la query string, que
queda escrita en los logs del proxy). La purga de borrados se llama directo en
SQL, sin dar la vuelta por HTTP. `private.call_app_cron` solo acepta rutas de
una lista blanca: sin eso sería un trampolín para pegarle a cualquier URL de la
app con el secreto adjunto.

Se sumó la limpieza de `net._http_response`, donde pg_net guarda cada respuesta
HTTP: con dos jobs por minuto son ~2.900 filas por día que nadie vuelve a mirar.

**3. Registro extensible de nodos, triggers y condiciones (F7).** El motor tenía
un switch de dieciocho casos, el simulador otro, y la UI cinco listas de tipos
más. Ahora cada tipo se declara en `lib/flow-engine/registry` y el motor le
pregunta al registro. `engine.ts` pasó de 1076 a 394 líneas.

**4. Se arreglaron los 11 nodos que no se ejecutaban (F1).** Este era el
hallazgo grave del bloque: el panel guarda los nodos de acción como
`type: "action"` con el tipo real en `data.actionType`, y el motor no entendía
esa forma — los tiraba por el `default` del switch. **Add Tag, Remove Tag, Set
Field, HTTP Request, Go To Flow, Human Takeover, Subscribe, Unsubscribe, A/B
Split, Smart Delay y Enroll Sequence pasaban el panel de Test y en producción no
hacían nada.** Se resolvió con alias declarados en el registro, sin migrar
flows. Hay un test por cada uno.

**5. Envío canal-agnóstico, tope horario y errores legibles (F8).** El motor solo
sabía hablar Zernio: un flow sobre WhatsApp cortaba en silencio. Ahora hay una
sola puerta de salida que ramifica por `channels.provider`. Se agregó el tope de
200 mensajes automatizados por hora de Instagram, con el contador reclamado en
la misma sentencia que lo verifica (un SELECT y después un UPDATE dejarían que
dos envíos simultáneos leyeran 199 los dos). Y los rechazos de la API se
traducen a castellano: la causa más común es la ventana de 24 horas, que no es
un error del sistema sino una regla de la plataforma.

**6. BYOK real en el nodo AI Response (F2).** Leía `workspaces.ai_api_key` —una
columna en claro, vacía— y pasaba por el AI Gateway de Vercel. Ahora usa
`integration_configs` + Vault. La key nunca sale de `lib/ai/provider.ts`. Si
falta, el flow no se rompe: corta con un aviso legible y distingue "no hay
proveedor" de "falta la key" de "falló la generación".

**7. Los cuatro triggers nuevos (F3–F6).** Ninguno toca `engine.ts`: se
implementaron a través del registro, que es la prueba viva de que el patrón
sirve.

**8. RLS de `triggers` endurecida.** Las policies que venían de ZernFlow daban
`FOR ALL` a cualquier miembro del workspace: un Member podía crear, editar y
borrar los triggers de cualquier flow. Un trigger decide qué automatización le
contesta a un lead; pasó a ser cosa de Owner/Admin, como publicar un flow.

### Decisiones y por qué

| Decisión | Por qué |
|---|---|
| Los eventos de CRM se detectan en la **base**, con triggers de Postgres | Un contacto se crea por tres caminos y los tags se agregan desde cuatro lugares. Emitirlos en el código significa acordarse en cada lugar, hoy y en cada camino nuevo. En la base se captura una vez. |
| Pero **no** disparan el flow desde la base: encolan | El motor manda mensajes y llama a la IA; nada de eso se puede hacer desde plpgsql. Y si fuera sincrónico, un flow lento frenaría el guardado del contacto. |
| F6 no es un tipo de trigger nuevo | Es un filtro dentro del config del trigger de palabra clave, como pide el requerimiento. Un tipo aparte duplicaría el matcher. |
| Idempotencia con una sola tabla `trigger_fires` | Los tres triggers nuevos necesitan lo mismo; cambia solo qué es "el mismo motivo". El índice único es lo que decide, así que dos corridas del cron chocan en la base y no en la lógica. |
| Inactividad se mide por `contacts.last_interaction_at` | Los mensajes entrantes de Instagram no se guardan localmente: contar la tabla `messages` daría siempre cero. |
| Anthropic como proveedor de IA | Decisión de negocio. Sirve para el nodo AI Response. Los embeddings del Bloque 3 van con **Voyage AI**, ya decidido. |

### Scope de leads

El disparo lo hace el sistema, sin usuario. Se respeta el scope porque **el
evento solo puede nacer de un cambio que la RLS ya permitió**: un Member no
puede tocar un lead que no ve, así que no puede generar un evento sobre él. La
barrera está antes, en la escritura.

### Migraciones

| # | Qué crea |
|---|---|
| 00036 | pg_cron, pg_net, `private.system_config`, `call_app_cron()`, los jobs |
| 00037 | tope de envíos por canal y por hora |
| 00038 | tipos nuevos de trigger, `workspace_id`, RLS endurecida, `trigger_fires` |
| 00039 | `automation_events` y los triggers de Postgres del CRM |
| 00040 | arreglo: un trigger de la 00039 escuchaba una columna generada y nunca iba a dispararse |

Todas aplicadas y verificadas contra la base real.

### Deuda anotada (fuera del alcance de este bloque)

- **`scheduled_jobs` tiene la RLS abierta.** Las policies de la migración 00009
  permiten a *cualquier usuario autenticado* leer, insertar y actualizar la cola
  entera, y la tabla no tiene `workspace_id`. Hoy los payloads incluyen
  variables de flow. **No se tocó porque está fuera del alcance del bloque**,
  pero conviene cerrarlo: agregar `workspace_id` y limitar las policies.
- **`goToFlow` no vuelve al flow original** y abre una segunda sesión para el
  mismo contacto. El campo `returnAfter` está declarado y se ignora. Volver
  requiere usar la columna `flow_stack` de `flow_sessions`, que existe y está sin
  usar: es más que un arreglo puntual.
- **Tres sistemas reciben los mismos DMs de @wenmardigian**: este OS, `WenOS` y
  `Agente Chat`. Antes de dejar automatizaciones encendidas en serio hay que
  decidir qué hacer con los otros dos.
- **La verificación visual de la bandeja** (aviso de conversación enfriada,
  burbuja de envío rechazado) quedó sin hacer: la app pide login y no se ingresan
  credenciales.
