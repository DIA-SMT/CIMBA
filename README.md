# CIMBA — Centro Inteligente de Monitoreo de Baches y Asfalto

Sistema de gestión de bacheo y reparación de pavimento de la **Municipalidad de
San Miguel de Tucumán**. Un solo lugar para todo el circuito:

```
DEMANDA  (lo que alguien pide: Atención Ciudadana, HCD, SAT, redes, secretarías)
   ↓  N demandas → 1 incidente (deduplicación asistida, nunca destructiva)
INCIDENTE  (el problema físico real, priorizado con score explicable)
   ↓  1 incidente → N intervenciones (reincidencia detectable)
INTERVENCIÓN  (el trabajo: cuadrilla u obra SIGOV, foto antes/después + GPS)
```

## Stack

Next.js 15 (App Router) · Supabase (Postgres 15 + PostGIS + Storage + RLS) ·
Drizzle · Zod · TanStack Query · **MapLibre GL** (mapa único WebGL con capas,
clusters, heatmap) · Tailwind 4 · pnpm + Turborepo · Vitest.

SSO: el de **Ciudad Digital** (la app se enchufa como sistema externo, igual
que UrbanIA/ELCOP). Sin Supabase Auth y sin contraseñas propias.

```
cimba/
├── apps/web                  la aplicación (mapa, bandeja, incidentes, campo…)
├── packages/domain           reglas puras: dedup, priorización, direcciones (+tests)
├── packages/db               esquema Drizzle + cliente con RLS por transacción
├── packages/integrations     adaptadores de fuentes + parsers de archivos reales
└── supabase/                 migraciones SQL + seed
```

## Desarrollo local

Requisitos: Node ≥ 20, pnpm 9 y un proyecto de **Supabase Cloud** (gratis,
sin Docker): la base es la misma en desarrollo y producción.

```bash
pnpm install
cp .env.example .env          # completar con la connection string y las API keys del proyecto
pnpm db:migrar                # aplica supabase/migrations/*.sql (idempotente)
pnpm db:seed                  # perfiles dev + cuadrillas + bucket de fotos
pnpm ingest:archivos -- "C:\ruta\a\Datos Bacheo Leo 20-08"   # datos reales (idempotente)
pnpm dev                      # http://localhost:3300
```

`DEV_FAKE_SSO=1` habilita el selector de rol en `/acceso` para trabajar sin el
backend municipal.

## Ingesta

- **Archivos reales** (`pnpm ingest:archivos`): intimaciones SAT, consolidado
  HCD/DIE/DRR (GeoPackage), reclamos abiertos de Atención Ciudadana (xlsx),
  planillas de bacheo mar–jul y obras SIGOV. Pipeline
  `normalizar → validar (Zod) → staging → promover`, idempotente por hash.
- **Cron** (`/api/sync/atencion-ciudadana`, cada 30 min en Vercel): adaptador
  `mock` hasta que AC publique `GET /reclamos/listarPorRango`
  (ver `docs/decisiones.md`).

## Tests

```bash
pnpm test        # Vitest: dedup, priorización, normalización de direcciones
```

## Documentación

- [`docs/decisiones.md`](docs/decisiones.md) — decisiones de arquitectura y pendientes.
- [`prompt-cimba-claude-code.md`] — especificación funcional v2 (fuera del repo).
