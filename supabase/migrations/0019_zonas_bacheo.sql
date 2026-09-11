-- LAS ZONAS DE BACHEO INTEGRAL COMO ÁMBITO DE LA ORDEN.
--
-- La ciudad está repartida en zonas fijas, una por contrato de bacheo
-- integral: cada empresa tiene la suya (SE → Ingeco-2, SO → Calleri,
-- Centro-Este → Ingeco-1, Norte → UOCRA). Hasta ahora eso vivía SOLO como una
-- capa dibujada en el mapa (public/data/bacheo-integral.json): se veía, pero
-- no se podía trabajar sobre ella — para armar una orden había que traducir
-- la zona a circuitos a ojo.
--
-- Con la geometría en la base, "zona" pasa a ser un ámbito más de la orden, al
-- lado de circuito, distrito, corredor y barrio: se elige la zona y salen sus
-- pendientes, igual que con los demás. Son fijas y cambian solo cuando cambia
-- la licitación, así que se cargan con un script y no se tocan a mano.

create table if not exists zonas_bacheo (
  id            bigint generated always as identity primary key,
  nombre        text not null unique,
  -- El nombre de la empresa TAL CUAL viene del contrato ("INGECO-2"), que no
  -- siempre coincide con empresas.nombre: se guarda el texto y, cuando hay
  -- match, también la FK.
  empresa       text,
  empresa_id    bigint references empresas (id),
  detalle       text,
  geom          geometry(MultiPolygon, 4326) not null,
  actualizado_en timestamptz not null default now()
);

create index if not exists zonas_bacheo_geom_idx on zonas_bacheo using gist (geom);

-- El ámbito nuevo. Un enum de Postgres solo admite agregar valores al final.
alter type ambito_orden add value if not exists 'zona';

alter table ordenes_trabajo add column if not exists zona_id bigint references zonas_bacheo (id);

comment on table zonas_bacheo is
  'Zonas fijas del contrato de bacheo integral, una por empresa. Se cargan con scripts/cargar-zonas-bacheo.mjs.';
