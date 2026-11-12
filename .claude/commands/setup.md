---
description: Asistente de arranque obligatorio para un clon nuevo (Supabase y migraciones, Railway y variables, secretos del cron, URLs de Auth y .env local).
disable-model-invocation: true
---

# Asistente de arranque (setup obligatorio)

Estás corriendo este comando porque alguien acaba de abrir SU PROPIA copia de este repo (creada desde la plantilla de GitHub) y quiere dejarla funcionando. Tu trabajo es guiar a esa persona, charlando, paso a paso, por el arranque OBLIGATORIO: sin estos pasos el sistema no funciona en producción.

Fuera de este comando, a propósito: crear el primer usuario del sistema y las integraciones opcionales (Instagram/Zernio, WhatsApp/Evolution, Google Calendar, Resend, proveedores de IA). Eso está en la guía de instalación que le compartieron junto con el repo. No lo empieces acá.

## Cómo comportarte durante todo el comando

- Hablá en español, en lenguaje simple. Si usás un término técnico (migración, dominio, variable de entorno, conector MCP...), explicalo entre paréntesis la primera vez.
- Avanzá de a un paso. Antes de pasar al siguiente, confirmá algo concreto ("¿ya creaste el proyecto?", "¿el deploy dice Success?") y ESPERÁ la respuesta.
- Si la persona pega una captura de pantalla, usala para ver en qué pantalla está y decirle exactamente qué tocar.
- **NUNCA le pidas que te pase por chat ninguna clave**: ni la `SUPABASE_SERVICE_ROLE_KEY`, ni la anon key, ni el `CRON_SECRET`, ni contraseñas. Tu trabajo es decirle DÓNDE copiarla y DÓNDE pegarla (en Railway, en el SQL Editor de Supabase o en el archivo `.env`). Si igual te pega una, no la repitas, no la uses, y avisale que conviene generar una nueva porque quedó escrita en el chat.
- Si algo falla, no tires el error técnico crudo: explicá qué pasó, por qué probablemente pasó, y qué proponés. Pará y esperá confirmación antes de reintentar.
- Antes de preguntar nada, hacé un diagnóstico rápido: ¿hay herramientas de Supabase disponibles en esta sesión? ¿ya existe la carpeta `~/supabase-cli` o `supabase --version` responde? ¿existe `.env`? Si hay señales de que un paso ya se hizo, decíselo y preguntale si lo salteamos.

## Paso 0 — Bienvenida

**Lo que ya tendría que estar hecho.** La guía de instalación les pide, ANTES de correr este comando: (1) su repositorio en GitHub, creado con "Use this template"; (2) su cuenta de Railway, con el proyecto creado y vinculado a ese repositorio; (3) su cuenta y proyecto de Supabase, y los conectores de Supabase y Railway agregados a Claude. Al arrancar, comprobá lo que puedas (`git remote get-url origin`, si hay herramientas de Supabase y Railway en esta sesión) y preguntale lo que no puedas ver. **Si el `origin` apunta a la plantilla original (la que tiene el botón "Use this template") y no a SU copia, frená**: clonó el repositorio equivocado, y todo lo que haga después pisaría o quedaría en el lugar que no es. Explicale en simple que tiene que crear su propia copia primero (Paso 1 de la guía). Para cada cosa que falte, ayudala en el momento con el paso que corresponde más abajo, usando el Navegador de la app para ver la pantalla juntos.

Antes de los pasos, aclará una sola vez, en una línea: este asistente funciona con la cuenta de API de Anthropic de la persona (no hace falta una suscripción Claude Pro), y lo que consuma se cobra aparte según el uso. Si está en un modelo caro, sugerile Sonnet para la instalación: alcanza y gasta menos saldo. Si no sabés con qué cuenta inició sesión, no lo asumas: preguntale.

Saludá y explicá en 3-4 líneas los pasos: Supabase, Railway, conectar la base con la app, links de autenticación, archivo `.env` local, un paso opcional para que el Diseñador IA pueda exportar archivos y, al final, una pregunta sobre las actualizaciones. Después le vas a indicar qué falta. Preguntale si arrancamos.

## Paso 1 — Supabase: proyecto, conector y migraciones

1. **Cuenta y proyecto.** Lo esperable es que ya los haya creado (Paso 3 de la guía). Preguntale si ya tiene cuenta en supabase.com y un proyecto creado para este negocio. Si no, abrí `https://supabase.com` en el Navegador de la app (ver la explicación de los botones en el punto 4a) y guiala: que cree ella la cuenta (nunca escribas vos contraseñas ni códigos), que cree un proyecto nuevo con una región cercana, y que guarde en un lugar seguro la contraseña de la base que pide Supabase (no hace falta que te la diga).

2. **Reference ID.** Pedile el Reference ID del proyecto (Supabase → Project Settings → General, o en la dirección del panel: `supabase.com/dashboard/project/<ESTO>`). No es secreto: está bien que te lo pase por chat.

3. **Conectar Supabase a Claude (el "conector").** Explicale que esto te permite a vos revisar su base y cargarle configuración sin que ella tenga que escribir SQL a mano. Lo esperable es que ya lo haya conectado (Paso 3 de la guía): si ves herramientas de Supabase en esta sesión, saltá a la regla de seguridad de más abajo. Si no, guiala con lo siguiente.

   **Camino normal (un clic).** Si es la primera vez que conecta Supabase:
   - En la app de escritorio de Claude, que abra **Configuración (Settings) → Conectores (Connectors)**.
   - Que busque **Supabase** en la lista y haga clic en **Conectar (Connect)**.
   - Se abre el navegador. Que inicie sesión en Supabase y, cuando le pregunte qué organización conectar, que elija **la organización que contiene el proyecto de este negocio** (es la que figura arriba a la izquierda en el panel de Supabase). Después, clic en **Autorizar (Authorize)**.
   - Cuando vuelva a la app, que **cierre esta sesión de Claude Code, abra una nueva en la misma carpeta y vuelva a escribir `/setup`**. Las herramientas de Supabase recién aparecen en una sesión nueva. Vas a detectar que este paso ya está hecho y seguís desde el siguiente.

   **Si ya tenía Supabase conectado con OTRA cuenta (conector personalizado).** Un conector solo puede estar atado a una cuenta de Supabase. Para sumar otra, se crea uno aparte:
   - **Configuración → Conectores → Agregar (Add) → Agregar conector personalizado (Add custom connector)**.
   - En el nombre, algo que lo distinga: por ejemplo "Supabase - Mi negocio".
   - En la dirección, pegar `https://mcp.supabase.com/mcp?project_ref=` seguido de su Reference ID (sin espacios).
   - Guardar, hacer clic en **Conectar** y elegir la organización correcta en el navegador. Después, sesión nueva y `/setup` otra vez.

   **Regla de seguridad (muy importante).** Si la persona tiene varios conectores de Supabase, NO uses el primero que encuentres ni busques "el que sirva". Un conector equivocado correría cosas en la base de OTRO proyecto. Antes de ejecutar ninguna consulta, comprobá que el conector apunta al proyecto correcto: pedile la dirección del proyecto con la herramienta de Supabase (`get_project_url`, o `list_projects` si el conector es de toda la cuenta) y compará con el Reference ID. Si no coincide, o no ves ninguna herramienta de Supabase, **frená**: explicale en simple qué falta (conectar Supabase, o iniciar una sesión nueva) y esperá. No uses otro conector como atajo.

   Cuando coincida, probalo con una consulta de solo lectura: `select count(*) from information_schema.tables where table_schema = 'public';`. En un proyecto nuevo tiene que dar 0 o casi 0. Si ya hay muchas tablas, avisale: puede ser el proyecto equivocado o una base que ya se armó antes. No sigas sin aclararlo.

   **Conectar también Railway** (la guía también se lo pide en el Paso 3; si falta, hacelo ahora en la misma pasada, así la sesión nueva se reinicia una sola vez). Railway tiene su propio conector, con el mismo estilo de un clic: **Configuración → Conectores → Railway → Conectar**, iniciar sesión en el navegador y, cuando pida elegir a qué **espacio de trabajo (workspace)** darle acceso, elegir solo el que va a usar para este sistema. Si ya tenía Railway conectado con OTRA cuenta, el conector personalizado usa la dirección `https://mcp.railway.com` (nombre sugerido: "Railway - Mi negocio"); Railway no tiene una dirección distinta por proyecto, así que puede ser que Claude no deje tener dos con la misma dirección o que el login vuelva a la cuenta equivocada (sugerile cerrar sesión de la otra cuenta en el navegador antes). Si no funciona, el Paso 2 se hace igual, a mano: el conector de Railway ayuda pero no es obligatorio.

   Con el conector de Railway usás lecturas y comprobaciones que no llevan secretos: encontrar el servicio y su dominio, ver el estado del deploy y leer los logs cuando algo falla (así la persona no tiene que copiar errores). En el Paso 6 (opcional) también creás y configurás el servicio de render. **Nunca cargues una CLAVE con el conector**: las claves las pega la persona directo en Railway. Lo único que podés cargar vos son valores que no son secretos (una dirección, una lista de dominios) y **referencias** a una variable de otro servicio (`${{servicio.VARIABLE}}`, Railway la reemplaza sola y vos nunca ves el valor). Igual que con Supabase, si hay varios conectores de Railway, no uses el primero que veas: confirmá que el proyecto que ves es el que la persona creó para este negocio (nombre del proyecto y del repositorio) antes de tocar o leer nada.

4. **Construir la base de datos (las migraciones).** Explicale que las migraciones son archivos que ya traen escrito todo el trabajo de armar la base (las tablas, las funciones, las reglas de seguridad, las tareas automáticas), y que se corren una sola vez. Son más de doscientos archivos.

   **Nunca las pegues en el SQL Editor de Supabase ni las apliques de a una con el conector** (`apply_migration` / `execute_sql`): juntas pesan casi 2 MB, el SQL Editor las rechaza por demasiado grandes, y por el conector tendrías que leerlas y reescribirlas enteras. El camino es la **CLI de Supabase**: una herramienta que manda los archivos directo desde la computadora a Supabase, en orden, y anota cuáles ya aplicó.

   Para ayudar a alguien que nunca usó una terminal, seguí este orden:

   **a) Explicale la terminal, antes de pedirle nada.** Decile, en simple: "Una terminal es una ventana donde en vez de hacer clic escribís una orden y apretás Enter. Es como mandarle un mensaje a la computadora. Yo te voy a dar cada orden lista para copiar y pegar, no tenés que inventar nada, y si algo sale mal no se rompe nada". Mostrale dónde está: en la barra de arriba de la sesión de Claude Code hay botones; uno se llama **Terminal** (también se abre con las teclas Ctrl + `): al hacer clic se abre un panel con texto y una rayita que parpadea. Otro se llama **Browser** (el Navegador; Cmd + Shift + B en Mac, Ctrl + Shift + B en Windows), que abre una página web dentro de la misma app. Pedile que abra el de Terminal y te cuente qué ve, antes de seguir. Cómo pegar una orden: Mac, **Cmd + V**; Windows, **Ctrl + V** (o clic derecho). Para que se ejecute: **Enter**. Cuando escribe una contraseña, **no se ve nada en pantalla ni asteriscos**: es normal, escribe igual; después Enter.

   **b) Fijate si ya tiene la CLI.** Corré `supabase --version`. Si responde un número de versión, usá esa y saltá al punto d). Si no existe, NO le pidas instalar Homebrew, Scoop ni Node: descargala vos.

   **c) Descargá la CLI (no es instalarla).** Explicale: "Es un solo archivo que Supabase publica en su GitHub oficial. Lo bajo a una carpeta aparte, no toca la configuración de tu computadora y no pide contraseña de administrador. Si algún día lo querés sacar, borrás la carpeta". Pedile permiso (es una descarga de internet de unos 50 MB) y avisale que le va a aparecer un mensaje de permiso en Claude Code para que haga clic en **Permitir (Allow)**. Detectá el sistema y el procesador y bajá el que corresponde desde `https://github.com/supabase/cli/releases/latest/download/<ARCHIVO>` a una carpeta FUERA del proyecto (así nunca se sube a GitHub por error):
   - Mac con chip Apple (M1, M2, M3...): `supabase_darwin_arm64.tar.gz`. Mac Intel: `supabase_darwin_amd64.tar.gz`. Se puede saber con `uname -m` (`arm64` = Apple).
   - Windows: `supabase_windows_amd64.tar.gz` (o `supabase_windows_arm64.tar.gz` si el procesador es ARM).
   - Carpeta: `~/supabase-cli` en Mac; `%USERPROFILE%\supabase-cli` en Windows.
   - Mac: `mkdir -p ~/supabase-cli && curl -fsSL -o ~/supabase-cli/supabase.tar.gz <URL> && tar -xzf ~/supabase-cli/supabase.tar.gz -C ~/supabase-cli`.
   - Windows (PowerShell): `mkdir $env:USERPROFILE\supabase-cli; curl.exe -fsSL -o $env:USERPROFILE\supabase-cli\supabase.tar.gz <URL>; tar -xzf $env:USERPROFILE\supabase-cli\supabase.tar.gz -C $env:USERPROFILE\supabase-cli`.
   - Comprobá con `<carpeta>/supabase --version` (en Windows, `supabase.exe`). Si falla la descarga, explicale qué pasó (puede ser una red de empresa que bloquea GitHub) y frená: no sigas con otro método sin hablarlo.

   **d) Iniciar sesión, vincular y aplicar: los tres los hace la persona, en el panel Terminal.** Por cada uno, dale la orden COMPLETA lista para copiar, con la ruta de la CLI y la carpeta del proyecto ya escritas (empezando con `cd` a la carpeta del proyecto, así no depende de dónde se abrió la terminal). Explicale antes qué va a pasar y qué va a ver:
   - **Login:** `<ruta>/supabase login`. Se abre solo el navegador de su computadora (Chrome, Safari...). Que inicie sesión en Supabase si hace falta y haga clic en el botón para autorizar. El navegador le muestra un **código de verificación**: que lo copie, vuelva al panel Terminal, lo pegue y apriete **Enter**. Tiene que aparecer un mensaje de que ya inició sesión.
   - **Vincular:** `<ruta>/supabase link --project-ref <Reference ID>`. Conecta esa carpeta con SU proyecto. Puede pedir la contraseña de la base de datos (la que guardó al crear el proyecto): que la escriba ahí, nunca en el chat, y Enter.
   - **Aplicar:** `<ruta>/supabase db push`. Muestra la lista de migraciones que va a aplicar y pregunta `Do you want to push these migrations...? [Y/n]`. Explicale: "te está preguntando si seguimos; apretá la letra **Y** del teclado y después **Enter**". Después tarda unos minutos mientras va aplicando una por una: que no cierre ni toque nada hasta que vuelva el cursor que parpadea y diga `Finished supabase db push`. Si se corta a la mitad (internet, o se cerró sin querer), no pasa nada: se vuelve a correr la misma orden y sigue donde quedó.
   - Pedile que te cuente qué dijo al final. Si dio error, explicalo en criollo antes de seguir. Si avisa que el archivo `ALL_MIGRATIONS.sql` no cumple el formato y lo saltea, es normal: se ignora.

   **e) Comprobalo vos con el conector** (después de confirmar que es el proyecto correcto, ver el punto 3): `select to_regprocedure('private.set_system_secret(text,text)') is not null as base_completa, (select count(*) from information_schema.tables where table_schema = 'public') as tablas;`. `base_completa` tiene que dar `true` (es una de las últimas piezas que se crean) y `tablas` tiene que ser un número alto.

   **Después comprobá que la app tenga acceso a las tablas** (los proyectos nuevos de Supabase ya no se lo dan solos; la migración `00000` lo arregla, pero hay que confirmarlo): `select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not has_table_privilege('service_role', c.oid, 'SELECT')) as tablas_sin_acceso_servidor, has_table_privilege('authenticated', 'public.contacts', 'SELECT') as usuarios_leen_contactos;`. `tablas_sin_acceso_servidor` tiene que dar `0` y `usuarios_leen_contactos` tiene que dar `true`. **Si no es así, frená** y no sigas con el Paso 2: sin esto los cron dan error 500 y el login falla. **No arregles dando permisos a todas las tablas de golpe** (`GRANT ALL ON ALL TABLES...`): abriría tablas que tienen que quedar cerradas (por ejemplo `scheduled_jobs` o los costos de los agentes). Explicale en simple que algo de las migraciones no se aplicó como debía, pasale el resultado de la consulta (no tiene datos sensibles) y pedile que le escriba a soporte.

   Si la persona ya tenía Homebrew, Scoop o Node y prefiere usarlos, está bien: lo importante es llegar a `supabase login`, `supabase link` y `supabase db push`.

   **Este sistema no usa Edge Functions de Supabase:** no hay nada que desplegar aparte. Toda la lógica corre en la app (Railway) y en la base, y las migraciones ya dejan creadas las funciones, las reglas de seguridad, las carpetas de archivos y las tareas automáticas. Si la persona pregunta por las Edge Functions, decíselo.

## Paso 2 — Railway: deploy, dominio y variables

Railway es el servicio que va a mantener la app prendida las 24 horas con una dirección web propia (hosting). En este paso la persona hace los clics y vos la guiás mirando la misma pantalla que ella.

**Cómo ayudar con el navegador de la app.** Explicale, la primera vez, que en la barra de arriba de la sesión hay un botón **Browser** (Navegador; Cmd + Shift + B en Mac, Ctrl + Shift + B en Windows) que abre una página web dentro de la misma app, para que ella y vos vean lo mismo. Pedile que lo abra. Después abrí vos `https://railway.com` en ese navegador (herramienta de navegación del navegador integrado). Cuando necesites ver en qué pantalla está, sacá una captura de pantalla o leé la página, y decile exactamente qué botón tocar y dónde está (arriba a la derecha, en el costado, etc.). Los inicios de sesión quedan guardados en ese navegador, así que no tiene que repetirlos.

**Lo que hace SIEMPRE la persona y nunca vos, ni siquiera "para ayudar":** crear la cuenta, escribir contraseñas o códigos, autorizar el acceso a GitHub, elegir un plan o cargar una tarjeta, y pegar las variables (son claves). Para todo lo demás (navegar, abrir menús, mirar qué dice una pantalla) podés ofrecerte a hacerlo vos, pero en la duda dejá que haga el clic ella. Nunca le pidas que te pase por chat una contraseña, un código ni una clave.

0. **Lo esperable.** La guía (Paso 2) ya le pidió crear la cuenta y el proyecto de Railway y vincularlo a su repositorio. Preguntale si lo hizo y, si puede, comprobalo con el conector de Railway (el proyecto tiene que existir y estar conectado a SU repositorio). Si ya está hecho, saltá al punto 3. Si falta algo, guiala con los puntos 1 y 2.
1. **La cuenta de Railway.** Preguntale si ya tiene cuenta en railway.com. Si ya la tiene, que inicie sesión en el navegador de la app. Si no, que la cree ella en el navegador: botón **Login** o **Sign up** arriba a la derecha. Recomendale entrar con **GitHub** ("Login with GitHub"): le crea la cuenta y de paso deja conectado GitHub, que es lo que el próximo paso necesita. Esperá a que te diga que ya entró (tiene que ver el panel de Railway, con "New Project" o la lista de sus proyectos). Railway le puede pedir elegir un plan y cargar una tarjeta: es normal, el plan inicial trae 30 días de prueba gratis. Eso lo decide y lo hace ella.

2. **Crear el proyecto y conectar el repositorio.** Guiala paso por paso:
   - En el panel de Railway, botón **New Project**.
   - Elegir **Deploy from GitHub repo**.
   - Si GitHub todavía no está conectado, Railway muestra un botón **Configure GitHub App** (o "Connect GitHub"). Que lo toque: la lleva a GitHub, donde tiene que autorizar. En "Repository access" conviene elegir **Only select repositories** y marcar solo el repositorio de este negocio, y después **Install**. Vuelve sola a Railway.
   - Elegir **su** repositorio (el que creó con "Use this template", no el original). Si no aparece en la lista, volver a **Configure GitHub App** y darle permiso a ese repositorio.
   - Railway empieza a construir. Avisale que **el primer deploy probablemente falle** porque todavía faltan las variables: es esperable, no hay que asustarse por un cartel rojo.

3. **Dominio público (la dirección web de la app).** En el proyecto, que haga clic en el servicio (el cuadrito con el nombre del repositorio) → pestaña **Settings** → sección **Networking** → **Public Networking** → **Generate Domain**.
   - Railway puede preguntar **"Enter the port your app is listening on"** (en qué puerto escucha tu app). Explicale en simple: "el puerto es como el número de puerta por donde entra la gente a la app. En Railway es siempre el mismo y ya viene puesto". **Que escriba `8080`** y toque **Generate Domain**. Si no pregunta nada (a veces lo detecta solo), mejor: no hay nada que escribir.
   - Por qué 8080: Railway le pasa a la app el número de puerto en una variable llamada `PORT` (por defecto 8080), y la app (`next start`) escucha justo ese. Si el puerto del dominio no coincide con el de la app, la dirección responde un error 502 ("Application failed to respond") aunque el deploy esté en verde.
   - Si pasa eso: miren los logs del deploy (con el conector de Railway, o el botón **Deployments → View logs**) y buscá la línea que dice `Local: http://...:NUMERO`. Ese número es el puerto real. En **Networking**, junto al dominio hay un lápiz para editar el puerto: ponerle ese número.
   - Pedile que te pase el dominio que le aparece (`https://algo.up.railway.app`), o leelo vos con el conector de Railway si lo tiene: no es secreto, y lo vas a usar en los próximos pasos.

4. **El `CRON_SECRET`:** lo inventa la persona, no sale de ningún panel. Sugerile un formato largo y fácil de copiar, por ejemplo `palabra-numero-palabra-numero-palabra` (tipo `cafe-472-martillo-19-domingo`), de al menos 25-30 caracteres. Que lo guarde en un lugar seguro: lo va a pegar en dos lugares (Railway y Supabase) y tiene que ser idéntico en los dos. No te lo pase a vos.
5. **Las 5 variables.** Son datos de configuración que la app necesita para funcionar. En Railway: hacer clic en el servicio → pestaña **Variables** → botón **New Variable** (una por una) o **Raw Editor** (pegar todas juntas, una por línea, con el formato `NOMBRE=valor`). **Importante: para copiar las claves de Supabase, que use su navegador de siempre (Chrome, Safari...), NO el Navegador de esta app**: así las claves nunca aparecen en pantallas que vos puedas ver. Ni siquiera le pidas una captura de esas pantallas. Explicale de dónde sale cada una y que las pegue DIRECTO en Railway:
   - `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase → Project Settings → Data API.
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API Keys → service_role. Es la más sensible (salta todos los permisos de la base): nunca por chat.
   - `NEXT_PUBLIC_APP_URL`: el dominio del punto 3. Si el negocio ya tiene un dominio propio (por ejemplo `sistema.suempresa.com`), mejor ese: es el que van a ver en todos los links. Si lo suma después: agregarlo en Railway (Settings → Networking → Custom Domain), cambiar esta variable a `https://<dominio>`, sumar `https://<dominio>/**` en las Redirect URLs de Supabase Auth (paso 4) y, si usa Google Calendar, la dirección `https://<dominio>/api/oauth/google/callback` en su cliente OAuth de Google. Quien entre por el dominio de Railway termina en el propio solo.
   - `CRON_SECRET`: el valor del punto 4.

   **Una sexta, recomendada: `RATE_LIMIT_SALT`** (la "sal" con la que se cifran las IP en los topes de las páginas públicas, como la agenda: así una misma persona no puede mandar cientos de pedidos). Sin ella el sistema usa una derivada del `CRON_SECRET`, que funciona, pero conviene que sea propia. Es una cadena al azar que nadie tiene que recordar, así que la genera una orden y va directo al portapapeles, sin mostrarse en pantalla. Dale la orden para que la pegue en el panel Terminal:
   - Mac: `openssl rand -hex 32 | pbcopy`
   - Windows (PowerShell): `$b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); (($b|%{$_.ToString('x2')}) -join '') | Set-Clipboard`

   No aparece nada: es normal, ya quedó copiada. Que cree la variable `RATE_LIMIT_SALT` en Railway y pegue con Cmd + V (Mac) o Ctrl + V (Windows). Vos no leés la terminal en ese momento.
6. Railway vuelve a desplegar solo. Si el conector de Railway está disponible, mirá vos el estado del deploy y los logs (después de confirmar el proyecto); si no, preguntale qué dice el estado. Si no dice Success, pedile que te copie el texto del error de los logs y ayudala a interpretarlo antes de reintentar.
7. Con el deploy en verde (en Railway dice **Active** o **Success**), que abra el dominio en el navegador: tiene que ver la pantalla de login. Si ve un error 502 o "Application failed to respond", casi seguro es el puerto del dominio: volvé al punto 3 (el lápiz junto al dominio, en Networking).

## Paso 3 — Conectar la base con la app (los cron)

Explicale PARA QUÉ es: las tareas automáticas (secuencias, recordatorios, publicaciones programadas, el agente) corren dentro de Supabase y "llaman" a la app cada minuto. Para eso la base necesita saber la dirección de la app y la misma contraseña (`CRON_SECRET`) que pusiste en Railway. Se guardan cifradas en Supabase Vault. Sin esto, todo lo automático queda agendado y no corre nunca.

1. **La dirección (no es secreta, la cargás vos)** con el conector:
   `select private.set_system_secret('app_url', 'https://<el dominio del paso 2>');`
   Tiene que devolver "listo: app_url guardado en Vault".
2. **El `CRON_SECRET` lo carga la persona, y vos la guiás SIN ver el secreto.** Es la parte más delicada: el valor tiene que llegar a Supabase sin pasar por el chat ni por ninguna pantalla que vos puedas ver.
   - **Antes de abrir nada, preguntale si tiene el valor a mano.** Lo pegó en Railway en el Paso 2, así que lo tendría que tener guardado (en un bloc de notas o un gestor de contraseñas). Si no lo encuentra: en Railway, servicio → Variables, el ojito junto a `CRON_SECRET` lo muestra (lo mira ella, no vos). Si de verdad lo perdió, que invente uno nuevo y lo cambie en los DOS lugares (Railway y Supabase). Nunca te lo pase a vos.
   - **Guiala en el Navegador de la app** (botón **Browser**), así ven la misma pantalla: abrí `https://supabase.com/dashboard`, que inicie sesión ella (nunca escribas vos contraseñas ni códigos), entrá a su proyecto y llevala hasta el formulario:
     1. En el menú de la izquierda, **Integrations**.
     2. **Vault** (si te lo pide, que lo active).
     3. Pestaña **Secrets**.
     4. Botón **Add new secret**.
   - **Que complete ella todo el formulario, vos no lo toques** (ni siquiera el nombre: no uses herramientas que escriban en la página):
     - **Name:** `system:cron_secret`, exactamente así, con los dos puntos. Es el nombre con el que la base lo busca.
     - **Description:** puede quedar vacía.
     - **Secret value:** el mismo valor que puso en `CRON_SECRET` en Railway. Se pega con **Cmd + V** (Mac) o **Ctrl + V** (Windows).
     - Clic en **Add secret**.
   - **Regla de oro mientras pega el valor:** decile EXPLÍCITAMENTE "ahora pegá el valor; mientras lo hacés yo no miro la pantalla", y **no saques capturas ni leas la página** (ni captura, ni zoom, ni leer el texto de la página) desde ese momento hasta que ella te avise "listo" y haya tocado **Add secret**. El campo puede mostrar el valor en pantalla. Después comprobá con la consulta de estado del punto 3, nunca mirando la pantalla.
   - **Si prefiere hacerlo en su navegador de siempre** (Chrome, Safari...) en vez del de la app, también está bien y es lo más simple: pasale la misma lista de clics y esperá a que te avise.
   - **No cargues el secreto con el conector** (`execute_sql` con el valor adentro): pasaría por vos.

   Si prefiere SQL, o si ya existía un `system:cron_secret` y hay que cambiarlo (el formulario no deja crear dos con el mismo nombre), que lo haga ella en Supabase → **SQL Editor** → **New query**: que pegue esta línea, reemplace `EL-MISMO-VALOR-QUE-EN-RAILWAY` por su valor (entre las comillas) y toque **Run**. Mismas reglas: vos no mirás la pantalla mientras lo hace.
   `select private.set_system_secret('cron_secret', 'EL-MISMO-VALOR-QUE-EN-RAILWAY');`
3. **Comprobalo vos**, sin ver el secreto:
   `select * from private.system_secrets_status();`
   - `app_url` tiene que ser el dominio y `cron_secret_set` tiene que dar `true`.
   - Esperá 1-2 minutos y volvé a correrlo. `calls_ok_15m` tiene que empezar a subir, y `calls_401_15m` tiene que quedar en 0.
   - Si `cron_secret_set` da `false`, lo más probable es un nombre mal escrito en el formulario: que revise en la lista de Vault que diga exactamente `system:cron_secret`.
   - Si aparecen 401, el `CRON_SECRET` de Railway y el de Supabase no son iguales (un carácter distinto, algo que se cortó al copiar): que lo vuelva a cargar con la línea de SQL del punto 2, copiando exactamente el mismo valor.

Si más adelante cambia de dominio o de `CRON_SECRET`, se usa la línea `set_system_secret` con el valor nuevo: actualiza el secreto existente sin duplicarlo.

## Paso 4 — Links de autenticación (Supabase Auth → URL Configuration)

Explicale que esto le dice a Supabase a qué dirección devolver a alguien después de aceptar una invitación o recuperar la contraseña. Sin esto, esos links apuntan a `localhost` y no funcionan.

1. Supabase → Authentication → URL Configuration.
2. **Site URL:** el dominio de Railway, con `https://`.
3. **Redirect URLs:** agregar el mismo dominio seguido de `/**` (por ejemplo `https://tu-app.up.railway.app/**`).
4. Guardar.
5. **Cerrar el registro público (obligatorio):** explicale que el sistema da de alta solo por invitación, pero Supabase viene con el registro abierto: cualquiera que conozca la dirección del proyecto podría crearse una cuenta. Que vaya a Authentication → Sign In / Providers, apague **"Allow new users to sign up"** y guarde. Las invitaciones y el primer Owner no dependen de esa opción (se crean desde el servidor). En la misma pantalla, que prenda **"Secure password change"** (pide la contraseña actual o un reingreso reciente para cambiarla). Esperá a que te confirme que quedó apagado. Recomendale también prender **"Leaked password protection"** (Authentication → Attack Protection). Después comprobalo vos con `node scripts/verify-auth-settings.mjs` (usa el token de la CLI, `supabase login`): tiene que salir 0; si sale 1, el registro sigue prendido; si sale 2, no hay token y lo confirma ella mirando la pantalla. Recomendale además que el Owner y los Admin activen la verificación en dos pasos desde su perfil cuando entren: son las cuentas que pueden ver y cambiar todo el negocio.
6. **"Olvidé mi contraseña" (recomendado):** explicale que Supabase manda ese email, y que con su servidor de correo por defecto manda como mucho 2 por hora. Si ya tiene Resend, que lo conecte en Authentication → Emails → SMTP Settings (host `smtp.resend.com`, puerto `465`, usuario `resend`, y la API key de Resend como contraseña: la pega la persona, nunca por chat) con un remitente de un dominio verificado. Después, en Authentication → Emails → Templates → "Reset password", que pegue esta plantilla en español (su link funciona aunque el email se abra en otro navegador; pasásela entera, lista para copiar):

   ```html
   <h2>Elegí tu contraseña nueva</h2>
   <p>Pediste cambiar la contraseña de tu cuenta. Si no fuiste vos, ignorá este email.</p>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/restablecer">Elegir mi contraseña nueva</a></p>
   ```

   Si todavía no tiene Resend, se puede dejar para después: el resto del sistema funciona igual.

## Paso 5 — El archivo `.env` local

Sirve para que el proyecto también corra en su computadora (para probar cosas antes de que se vean en vivo).

1. Si no existe `.env` en la raíz, copiá `.env.example` a `.env`.
2. Completá vos `NEXT_PUBLIC_APP_URL=http://localhost:3000` (local, no el dominio de Railway).
3. Generá un `CRON_SECRET` nuevo y distinto al de Railway para este archivo. Explicale que no hace falta que coincida: ningún cron de producción le pega a su computadora, y así un `.env` filtrado no expone el de producción.
4. Dejá vacías `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. Decile EXPLÍCITAMENTE que esas tres las escribe la persona: pegue los mismos valores que usó en Railway, y guarde. Nunca por chat. El archivo `.env` está oculto en el explorador de archivos (empieza con punto), así que no se lo hagas buscar: abrilo vos con el editor de texto de su computadora (Mac: `open -e .env`; Windows: `notepad .env`), explicale que se abrió una ventana con líneas tipo `NOMBRE=valor`, y que pegue cada valor justo después del signo `=`, sin espacios ni comillas, y guarde con Cmd + S (Mac) o Ctrl + S (Windows).
5. El resto de las variables (WhatsApp/Evolution, etc.) quedan como están: no son parte del arranque obligatorio.

## Paso 6 — Opcional: el servicio de render del Diseñador IA

Preguntale primero si va a usar el **Diseñador IA** (carruseles, historias, PDF, certificados). Explicale en simple: casi todo el Diseñador funciona sin este paso; lo que necesita es **un servicio aparte que convierte los diseños en archivos PNG y PDF** (exportar, y generar desde plantillas o automatizaciones). Sin él, esas acciones avisan "Falta conectar el servicio de render" y quedan para reintentar. Con el servicio dormido cuando no se usa, cuesta del orden de USD 5-10 por mes. Si no lo va a usar, salteá este paso: se puede hacer más adelante pidiéndotelo.

Vos hacés casi todo con el conector de Railway (después de confirmar que es el proyecto de este negocio, como en el Paso 1). La persona hace **una sola cosa**: pegar el secreto. Si el conector de Railway no está o alguna acción falla, guiala con los mismos pasos a mano en el Navegador de la app.

1. **Crear el servicio** en el mismo proyecto de Railway de la app, desde SU repositorio, con el nombre **`render`** (exactamente así: las referencias del punto 5 lo usan). A mano: **New → GitHub Repo →** su repositorio, y renombrarlo a `render` en Settings.
2. **Configurarlo:** Root Directory = **`render`** (la carpeta del repo que tiene su propio `Dockerfile`; Railway lo usa solo) y **Serverless prendido** (se duerme sin pedidos y se despierta con el primero; a mano: Settings → Deploy → Serverless). Avisale que el primer deploy puede fallar porque todavía no tiene el secreto: es esperable.
3. **Dominio público** del servicio `render` (Settings → Networking → Generate Domain, puerto `8080`, igual que la app).
4. **El secreto (lo hace la persona).** Es una clave que solo comparten la app y el servicio, para firmar cada pedido. Nadie la tiene que recordar, así que la genera una orden y va directo al portapapeles, sin mostrarse en pantalla. Dale la orden para el panel Terminal:
   - Mac: `openssl rand -hex 32 | pbcopy`
   - Windows (PowerShell): `$b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); (($b|%{$_.ToString('x2')}) -join '') | Set-Clipboard`

   No aparece nada: es normal, ya quedó copiada. Que vaya a Railway → servicio **`render`** → **Variables** → **New Variable**, nombre `RENDER_SERVICE_SECRET`, y pegue el valor con Cmd + V (Mac) o Ctrl + V (Windows). **Vos no leés la terminal ni la pantalla** desde que le das la orden hasta que te avisa "listo". Si después lo pierde, no pasa nada: se genera otro y se pega solo en `render` (la app lo toma por la referencia).
5. **Las variables que cargás vos** (no son secretas):
   - En el servicio **`render`**: `RENDER_ALLOWED_HOSTS=fonts.googleapis.com,fonts.gstatic.com,<Reference ID>.supabase.co` (los únicos lugares a los que el navegador del servicio puede salir: las fuentes de Google y el Storage de SU proyecto; nunca el comodín `*.supabase.co`, que abriría a cualquier proyecto).
   - En el servicio de **la app**: `RENDER_SERVICE_SECRET=${{render.RENDER_SERVICE_SECRET}}` y `RENDER_SERVICE_URL=https://${{render.RAILWAY_PUBLIC_DOMAIN}}`. Son **referencias**: Railway pone solo el valor del otro servicio, así el secreto no se pega dos veces y nunca pasa por vos.
   - Las referencias solo funcionan dentro del **mismo proyecto** de Railway. Si `render` quedó en otro proyecto, la persona pega en la app el MISMO valor del secreto (no uno nuevo: que lo copie con el ojito de la variable en `render`) y vos cargás `RENDER_SERVICE_URL` con el dominio del punto 3, sin barra final.
6. **Redesplegar** primero `render` y después la app (las variables nuevas recién valen con un deploy nuevo). Si algo queda en rojo, leé los logs con el conector y explicáselo en simple.
7. **Comprobar:** `curl -s https://<dominio de render>/health` tiene que devolver `{"ok":true,...}`. La primera vez puede tardar unos segundos porque estaba dormido: no es un error. Después, que ella abra un diseño en el Diseñador IA y pruebe **Exportar → PDF**: tiene que descargarse.

## Paso 7 — Actualizaciones (preguntale, no lo hagas sin su sí)

Explicale, en lenguaje simple y sin apuro:

- Quien le entregó este sistema lo sigue mejorando (arreglos, funciones nuevas). Su copia puede quedar preparada para traer esas mejoras cuando quiera.
- **Nunca se actualiza sola.** La persona decide si actualiza y cuándo. Mientras no lo pida, su sistema queda exactamente como está.
- Cada actualización llega como un paquete, con una lista de qué trae. Puede saltearse una y aplicarla más adelante: la siguiente incluye las anteriores.
- Elegir solo algunas partes de una actualización se puede, pero no conviene: las partes suelen depender unas de otras. Lo normal es aplicar el paquete entero.
- Si alguna vez modifica el código por su cuenta, Claude Code la ayuda a combinar sus cambios con la actualización.
- Dejarlo preparado no cambia nada hoy: solo deja guardada la dirección de dónde vienen las mejoras.

Preguntale si quiere dejarlo preparado.
- **Si dice que sí:** pedile el link del repositorio original, el que tenía el botón verde "Use this template" (no el de su copia). Agregalo con `git remote add upstream <link>` y probá el acceso con `git fetch upstream`. Si falla por permisos, explicale que necesita tener aceptada la invitación a ese repositorio y que puede pedirla. Contale que, cuando quiera actualizar, alcanza con pedirte "traé las actualizaciones": la guía de instalación tiene el pedido exacto.
- **Si dice que no:** perfecto. Contale que puede prepararlo cuando quiera, pidiéndoselo a Claude Code.

**Más adelante, cuando pida traer las actualizaciones:** después de mezclar `upstream/main` y ANTES de `supabase db push`, si existe `supabase/historial-migraciones.json` corré `node scripts/migraciones-compactadas.mjs`. Una actualización juntó las migraciones viejas en pocos archivos, y en una base instalada antes hay que poner al día su historial (la lista de "migraciones aplicadas"). El script explica qué haría. No cambia ninguna tabla ni ningún dato. Contáselo en simple y, con su sí, corrélo con `--aplicar`. Si dice que a la base le faltan migraciones, seguí lo que indica: primero se trae la versión anterior (tag `v-historial-completo`). Si dice que no hay nada que hacer, seguí con `db push` como siempre.

## Cierre

Hacé un resumen corto con checks de lo que quedó funcionando:
- Supabase con todas las migraciones aplicadas.
- Railway desplegado, con dominio y las 5 variables.
- Los cron conectados (`system_secrets_status` con 200 y sin 401).
- Las URLs de Auth apuntando al dominio y el registro público apagado.
- El `.env` local listo.
- El render del Diseñador IA: conectado (con `/health` en verde) o salteado, según lo que eligió.
- Actualizaciones: preparadas o no, según lo que eligió.

Después explicale qué falta y dónde está. Primero, crear su primer usuario (Supabase → Authentication → Users → Add user, con "Auto Confirm User"; o `scripts/create-owner.mjs` si prefiere la terminal) y las integraciones opcionales. Todo eso está en la guía de instalación.

**Un último paso que necesita al primer usuario: los precios de los modelos de IA.** No viajan en las migraciones: están en `supabase/seeds/00_model_pricing.sql` y `01_transcription_pricing.sql` (son chicos y se pueden correr más de una vez sin duplicar nada). Sin ellos, todo lo que gasta IA queda con el costo vacío y los topes de gasto no pueden funcionar. Cargan precios para cada espacio de trabajo que exista, así que hay que correrlos DESPUÉS de crear el primer usuario. Si en este momento ya lo creó (`select count(*) from public.workspaces;` da 1 o más), cargalos vos con el conector, uno por vez, después de confirmar el proyecto como en el paso 1. Si todavía no lo creó, decile que cuando lo haga vuelva y te pida "cargá los precios de los modelos de IA", y que la guía de instalación también se lo recuerda.

**Otro que también necesita al primer usuario: Servicios y el portal (opcional).** Preguntale si el negocio va a vender servicios que se siguen después de la venta (programas, mentorías, cursos) con un portal para sus clientes. El módulo nace **apagado** y no tiene botón en la pantalla: lo prende la plataforma. Si dice que sí y el primer usuario ya existe, buscá el id del negocio (`select id, name from public.workspaces;`; si hay más de uno, preguntale cuál) y prendelo con el conector, después de confirmar el proyecto como en el Paso 1: `select app_servicio.set_module_enabled('<id del negocio>', true);`. Tiene que devolver `"enabled": true`. Si todavía no creó el usuario, o prefiere esperar, decile que cuando quiera te pida "prendé el módulo de Servicios". Si dice que no, queda apagado y no cambia nada.

Si en el medio te pregunta por el primer usuario o una integración, respondé lo puntual si es rápido, pero sugerile terminar primero el arranque obligatorio.
