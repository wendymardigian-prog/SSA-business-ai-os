# Integraciones

Todo lo que el sistema conecta con afuera vive en una sola pantalla:
**Ajustes → Integraciones**. Cada cosa es una tarjeta, y cada tarjeta dice en
qué estado está sin que haya que entrar.

## Los estados de una tarjeta

| Estado | Qué significa |
|---|---|
| **Sin conectar** | Nunca se cargó nada. La tarjeta explica para qué sirve. |
| **Conectada** | Anda. Muestra con qué cuenta y, si tiene tope, cuánto se lleva usado. |
| **Requiere atención** | Está conectada pero algo va a fallar pronto: el token vence, falta un permiso, o se está por acabar la cuota. |
| **Con error** | Lo último que se intentó falló. La tarjeta dice qué pasó y qué hacer. |

El filtro **"Requiere atención"** de la barra superior deja solo las que
necesitan algo. Es lo primero que conviene mirar cuando algo dejó de andar.

## Dónde viven las claves

En **Supabase Vault**, cifradas con AES-256. Nunca en el `.env`, nunca en el
código, nunca en un log.

De un secreto guardado, la pantalla solo sabe que **existe**: el valor no
vuelve del servidor ni siquiera para mostrarlo con puntitos. Para cambiarlo
se escribe uno nuevo encima.

Hay un test que lo hace cumplir (`lib/vault-boundary.test.ts`): recorre los
imports reales desde cada componente de navegador y falla si alguno llega al
módulo que lee Vault. No es un comentario que pide buena voluntad.

## Aislamiento entre workspaces

Cada workspace tiene sus propias claves, y no puede ver ni usar las de otro.
Lo garantiza la base, no la pantalla:

- El nombre real de cada secreto es `ws:<workspace>:<nombre>`, y ese prefijo lo
  arma la base (`vault_secret_key`, migración 00017). El nombre que llega de
  afuera no puede tener `:`, así que no hay forma de apuntar a otro workspace.
- `store_secret`, `delete_secret` y `list_secret_names` comprueban con
  `auth.uid()` que quien llama es Owner o Admin de **ese** workspace. Si no,
  responden `forbidden`. Solo el service role (webhooks, cron) pasa sin ese
  chequeo, y siempre usa el workspace de la fila que está procesando.
- `read_secret`, la única que devuelve un valor, **solo la ejecuta el service
  role** (migración 00143). Ningún usuario, tampoco el Owner, puede leer una
  clave con su sesión. El servidor la lee con `createServiceClient()`, después
  de que el que llama ya decidió si se puede usar (el guard de Admin de la
  ruta, o la RLS de la conversación en la bandeja), y con el workspace de la
  sesión, nunca del pedido.
- `integration_configs` es una fila por workspace y proveedor, y su RLS solo
  deja verla y tocarla a los admins del propio workspace.
- Las acciones de Integraciones toman el workspace de la sesión del servidor,
  nunca de lo que manda el navegador.

**La única integración con respaldo en el entorno es Evolution**
(`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN`). Regla: la
dirección y la clave salen **de la misma fuente**. Si el workspace guardó su
propia dirección, la clave tiene que estar en su Vault; la del entorno nunca
viaja a una dirección cargada desde la pantalla (`lib/evolution-config.ts`).

Lo prueba `node scripts/verify-workspace-isolation.mjs` contra la base real: dos
workspaces, y el Admin de uno intentando leer, pisar, borrar y listar los
secretos y las integraciones del otro.

Dentro de un mismo workspace, hasta la 00143 un Admin podía leer en texto plano
cualquier clave llamando a `read_secret` directo desde el navegador (incluidos
los tokens de Google Calendar de otra persona). Desde la 00143 no: lo prueban
`verify-rls.mjs --despues-de-00143` y
`verify-workspace-isolation.mjs --despues-de-00143`.

## "Probar y guardar"

El botón no es "guardar". Antes de escribir nada en Vault, el sistema usa la
clave contra el proveedor de verdad:

- **Postproxy**: pide los perfiles y cuenta cuántas cuentas de YouTube hay.
- **Meta**: consulta `/me` para ver si el token sirve, y `/me/adaccounts`
  para ver si tiene el permiso `ads_read`. Un token válido sin ese permiso
  pasaría lo primero y no traería ningún dato.

Si la prueba falla, no se guarda nada. Una clave revocada guardada deja la
tarjeta en verde y el problema aparece el día que hay que publicar.

Las que se conectan por OAuth (Google, LinkedIn, Threads) no tienen botón de
probar: la prueba es conectar.

## Qué hace cada una

### Mensajería

**Zernio** conecta Instagram: mensajes directos, comentarios y respuestas a
historias. También publica en Instagram y TikTok, y trae sus métricas. Su
clave vive solo en Vault: las columnas viejas donde estaba se borraron con la
migración 00090 (26/9/2026).

**Evolution API** conecta WhatsApp por código QR. La instancia corre aparte,
en su propio proyecto de Railway, así que se comunican por dominio público.

### Publicación

**Postproxy** publica en YouTube sin pedir un proyecto de Google propio. Su
plan gratuito tiene tope mensual y la tarjeta lo muestra.

**Google** es la alternativa: sube el video directo a YouTube con la API
oficial, sin tope mensual. Tiene una trampa conocida y por eso tiene su
propio botón, **"Probar la subida directa"**: si el proyecto de Google no
pasó la auditoría, YouTube acepta un video pedido como público, lo sube,
devuelve 200 y **lo deja privado sin decir nada**. La prueba sube un video de
un segundo, mira cómo quedó y lo borra. Si detecta el problema, deshabilita
ese camino y YouTube sigue publicando por Postproxy.

**LinkedIn** publica texto. Con imagen o video falla con un mensaje claro en
vez de publicar solo el texto: eso último se vería como que salió bien.

**Threads** publica texto, imagen, video e hilos.

### Meta

Trae el rendimiento de los anuncios y los datos de Instagram que la API de
Zernio no da: el alcance repartido entre seguidores y no seguidores, la
audiencia por edad y país, y las historias activas.

El token es de **system user**, que no vence. Las cuentas publicitarias no se
escriben a mano: se descubren con el token y se tildan las que se quieren
sincronizar. Pedirle a alguien que copie un `act_1234567` del Business
Manager es pedirle que se equivoque en un dígito y después no entienda por
qué no hay datos.

### Email

**Resend (saliente)** manda las invitaciones al equipo y los avisos.

**Resend (entrante)** convierte una dirección tuya en un canal más de la
bandeja. Los correos entran como conversaciones, se responden desde el mismo
lugar que un DM, y el hilo se arma bien del otro lado. Son dos tarjetas
separadas porque son dos conexiones con dos secretos distintos.

### Inteligencia artificial

OpenAI, Anthropic y Google generan texto; Voyage genera los embeddings de la
base de conocimiento. Se usa la cuenta propia (BYOK): el gasto va a tu
factura y lo controlás vos, con los topes diarios y mensuales de Ajustes.

## Desconectar

Antes de desconectar algo, la pantalla cuenta **cuántas publicaciones
programadas dependen de esa integración** y lo dice. Desconectar LinkedIn con
tres posts agendados para el jueves los deja fallando el jueves, y enterarse
ese día es tarde.

Desconectar borra las claves de Vault. No borra los datos ya recolectados.
