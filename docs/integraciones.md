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
historias. También publica en Instagram y TikTok, y trae sus métricas. Es la
única integración cuya clave todavía puede estar en una columna vieja de la
base en vez de en Vault; la tarjeta lo avisa y ofrece **"Migrar a Vault"**.

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
