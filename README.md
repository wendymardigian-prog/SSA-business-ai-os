# Sistema Operativo de Negocio con IA

Sistema operativo centralizado que unifica CRM, inbox multicanal con bot de IA, automatizaciones, contenido, ventas y finanzas en una sola plataforma, para que ningún lead quede sin respuesta.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## White label

Este proyecto se duplica por cliente: cada copia es un deploy aparte con su propia marca, su propia base de Supabase y sin ningún dato del resto. La marca (nombre, logo, color) sale de tres variables de entorno, nunca de un valor escrito en el código — ver `.env.example` y [lib/brand.ts](lib/brand.ts).

```
NEXT_PUBLIC_BRAND_NAME=Nombre del negocio
NEXT_PUBLIC_BRAND_LOGO_URL=https://.../logo.png   # opcional; sin esto se muestra un monograma
NEXT_PUBLIC_BRAND_COLOR=#4f46e5                   # opcional; sin esto queda el color por defecto
```

No hay registro público: la única forma de entrar la primera vez es creando el primer Owner a mano, con la Service Role Key.

```bash
node scripts/create-owner.mjs --email=duena@negocio.com --name="Duena del negocio" --workspace="Nombre del negocio" --timezone=America/Costa_Rica
```

Después de eso, el resto del equipo entra por invitación (`Ajustes → Equipo`).

## Stack

| Capa | Herramienta |
|------|-------------|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript 5 |
| Base de datos + Auth + Realtime | Supabase (PostgreSQL) |
| Estilos | Tailwind CSS v4 |
| Flow builder | React Flow (@xyflow/react) |
| IA | Vercel AI SDK, BYOK multi-proveedor (OpenAI / Anthropic / Google) |
| Canal Instagram | Zernio (OAuth, mensajería cross-plataforma) |
| Canal WhatsApp | Evolution API (Baileys), self-hosted |
| Email saliente | Resend |
| Secrets | Supabase Vault (AES-256) |
| Testing | Vitest 3 |

## Puesta en marcha

### Requisitos

- Node.js 18+
- Un proyecto de [Supabase](https://supabase.com) (el plan free alcanza para desarrollo)

### Pasos

1. **Instalar dependencias**

   ```bash
   npm install
   ```

2. **Correr las migraciones**

   Cada archivo numerado de `supabase/migrations/`, en orden, desde `00001`. Con la CLI de Supabase:

   ```bash
   supabase db query --linked -f supabase/migrations/00001_initial_schema.sql
   # ... y así con cada archivo siguiente, en orden
   ```

   O pegando `supabase/migrations/ALL_MIGRATIONS.sql` entero en el editor SQL del panel de Supabase.

3. **Configurar el entorno**

   ```bash
   cp .env.example .env
   ```

   Completá las credenciales de Supabase y el resto de las variables — cada una documentada en el propio `.env.example`. Las claves de integraciones (Zernio, Resend, los proveedores de IA) **no van en variables de entorno**: se cargan desde `Ajustes → Integraciones` y se guardan cifradas en Supabase Vault.

4. **Crear el primer usuario**

   ```bash
   node scripts/create-owner.mjs --email=... --name=... --workspace=...
   ```

5. **Correr en desarrollo**

   ```bash
   npm run dev
   ```

   Abrí [http://localhost:3000](http://localhost:3000) e iniciá sesión con la cuenta que creaste en el paso anterior.

## Estructura del proyecto

```
app/
├── (auth)/              # Login (el único acceso público)
├── (dashboard)/         # La app: inbox, CRM, flows, contenido, agenda, ajustes
├── invite/              # Aceptar una invitación (y crear la cuenta, si hace falta)
├── calendario/          # Páginas públicas de agenda (sin sesión)
└── api/
    ├── webhooks/        # Receptores: Zernio (Instagram), Evolution (WhatsApp), Resend
    ├── cron/            # Jobs programados (pg_cron llama acá)
    └── v1/               # API interna
components/
├── flow-builder/        # Canvas, nodos, paneles
├── inbox/               # Bandeja, hilo de conversación, panel de contacto
├── scheduling/          # Agenda: admin y booker público
└── settings/            # Equipo, integraciones, recursos
lib/
├── supabase/            # Clientes server / browser / middleware
├── flow-engine/         # Motor de flows
├── agent/               # Agente de IA: runner, herramientas, guardarrails
├── actions/             # Server Actions
└── brand.ts             # Config de marca (white label)
supabase/
└── migrations/          # Esquema SQL + políticas RLS, numeradas en orden
```

## Testing

```bash
npx vitest run
```

Los scripts `scripts/verify-*.mjs` corren contra una base real, con usuarios de prueba que crean y limpian solos (prefijo `zz-test-`). No correr dos en simultáneo: comparten el prefijo y se pisan la limpieza.

## Licencia

MIT. Este proyecto se construyó sobre la base de un proyecto de código abierto bajo la misma licencia — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para el detalle y el aviso de copyright original.
