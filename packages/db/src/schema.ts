import {
  bigint,
  bigserial,
  boolean,
  customType,
  geometry,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ESTADOS_DEMANDA,
  ESTADOS_INCIDENTE,
  ESTADOS_INTERVENCION,
  FUENTES_DEMANDA,
  ROLES_USUARIO,
  TIPOS_PROBLEMA,
} from "@cimba/domain";

// Geometrías que Drizzle no tipa nativamente (MultiPolygon): se manipulan
// solo vía SQL crudo (ST_*); acá figuran para completar el espejo del esquema.
const multiPolygon = customType<{ data: string }>({
  dataType: () => "geometry(MultiPolygon, 4326)",
});

export const fuenteDemandaEnum = pgEnum("fuente_demanda", FUENTES_DEMANDA);
export const tipoProblemaEnum = pgEnum("tipo_problema", TIPOS_PROBLEMA);
export const estadoDemandaEnum = pgEnum("estado_demanda", ESTADOS_DEMANDA);
export const estadoIncidenteEnum = pgEnum("estado_incidente", ESTADOS_INCIDENTE);
export const estadoIntervencionEnum = pgEnum("estado_intervencion", ESTADOS_INTERVENCION);
export const rolUsuarioEnum = pgEnum("rol_usuario", ROLES_USUARIO);
export const momentoFotoEnum = pgEnum("momento_foto", ["antes", "durante", "despues"]);

export const distritos = pgTable("distritos", {
  id: integer("id").primaryKey(),
  nombre: text("nombre").notNull(),
  geom: multiPolygon("geom").notNull(),
  aproximado: boolean("aproximado").notNull().default(false),
});

export const cuadrantes = pgTable("cuadrantes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre"),
  material: text("material"),
  geom: multiPolygon("geom").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
});

export const perfiles = pgTable("perfiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  idPersona: bigint("id_persona", { mode: "number" }).notNull().unique(),
  idTusuario: integer("id_tusuario"),
  nombre: text("nombre").notNull(),
  documento: text("documento"),
  email: text("email"),
  rol: rolUsuarioEnum("rol").notNull().default("lectura"),
  area: text("area"),
  activo: boolean("activo").notNull().default(true),
  ultimoIngreso: timestamp("ultimo_ingreso", { withTimezone: true }),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const externalRef = pgTable(
  "external_ref",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sistema: text("sistema").notNull(),
    entidadLocal: text("entidad_local").notNull(),
    idLocal: bigint("id_local", { mode: "number" }).notNull(),
    idRemoto: text("id_remoto").notNull(),
    payloadHash: text("payload_hash").notNull(),
    sincronizadoEn: timestamp("sincronizado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("external_ref_unico").on(t.sistema, t.entidadLocal, t.idRemoto)],
);

export const syncRuns = pgTable("sync_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sistema: text("sistema").notNull(),
  desde: timestamp("desde", { withTimezone: true }),
  hasta: timestamp("hasta", { withTimezone: true }),
  leidos: integer("leidos").notNull().default(0),
  insertados: integer("insertados").notNull().default(0),
  actualizados: integer("actualizados").notNull().default(0),
  errores: integer("errores").notNull().default(0),
  detalle: jsonb("detalle").notNull().default({}),
  iniciadoEn: timestamp("iniciado_en", { withTimezone: true }).notNull().defaultNow(),
  finalizadoEn: timestamp("finalizado_en", { withTimezone: true }),
});

export const demandas = pgTable(
  "demandas",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    fuente: fuenteDemandaEnum("fuente").notNull(),
    estado: estadoDemandaEnum("estado").notNull().default("recibida"),
    tipo: tipoProblemaEnum("tipo"),
    descripcion: text("descripcion"),
    direccionTexto: text("direccion_texto"),
    direccionNormalizada: text("direccion_normalizada"),
    geocodConfianza: numeric("geocod_confianza", { precision: 4, scale: 3 }),
    geom: geometry("geom", { type: "point", mode: "xy", srid: 4326 }),
    distritoId: integer("distrito_id").references(() => distritos.id),
    contacto: jsonb("contacto").notNull().default({}),
    solicitante: text("solicitante"),
    prioridadInformada: smallint("prioridad_informada"),
    menciones: integer("menciones"),
    urlOrigen: text("url_origen"),
    creadoPor: uuid("creado_por").references(() => perfiles.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [index("demandas_fuente_estado_ix").on(t.fuente, t.estado)],
);

export const incidentes = pgTable("incidentes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tipo: tipoProblemaEnum("tipo").notNull(),
  estado: estadoIncidenteEnum("estado").notNull().default("detectado"),
  geom: geometry("geom", { type: "point", mode: "xy", srid: 4326 }).notNull(),
  direccion: text("direccion"),
  distritoId: integer("distrito_id").references(() => distritos.id),
  cuadranteId: bigint("cuadrante_id", { mode: "number" }).references(() => cuadrantes.id),
  prioridad: smallint("prioridad"),
  scorePrioridad: numeric("score_prioridad", { precision: 6, scale: 2 }),
  superficieM2: numeric("superficie_m2", { precision: 8, scale: 2 }),
  observaciones: text("observaciones"),
  detectadoEn: timestamp("detectado_en", { withTimezone: true }).notNull().defaultNow(),
  cerradoEn: timestamp("cerrado_en", { withTimezone: true }),
  creadoPor: uuid("creado_por").references(() => perfiles.id),
  metadata: jsonb("metadata").notNull().default({}),
});

export const demandaIncidente = pgTable(
  "demanda_incidente",
  {
    demandaId: bigint("demanda_id", { mode: "number" })
      .notNull()
      .references(() => demandas.id, { onDelete: "cascade" }),
    incidenteId: bigint("incidente_id", { mode: "number" })
      .notNull()
      .references(() => incidentes.id, { onDelete: "cascade" }),
    vinculadoPor: uuid("vinculado_por").references(() => perfiles.id),
    vinculadoEn: timestamp("vinculado_en", { withTimezone: true }).notNull().defaultNow(),
    automatico: boolean("automatico").notNull().default(false),
    confianza: numeric("confianza", { precision: 4, scale: 3 }),
  },
  (t) => [primaryKey({ columns: [t.demandaId, t.incidenteId] })],
);

export const cuadrillas = pgTable("cuadrillas", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  nombre: text("nombre").notNull(),
  responsable: uuid("responsable").references(() => perfiles.id),
  activa: boolean("activa").notNull().default(true),
});

export const intervenciones = pgTable("intervenciones", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  incidenteId: bigint("incidente_id", { mode: "number" })
    .notNull()
    .references(() => incidentes.id),
  cuadrillaId: bigint("cuadrilla_id", { mode: "number" }).references(() => cuadrillas.id),
  estado: estadoIntervencionEnum("estado").notNull().default("asignada"),
  geomEjecucion: geometry("geom_ejecucion", { type: "point", mode: "xy", srid: 4326 }),
  iniciadaEn: timestamp("iniciada_en", { withTimezone: true }),
  finalizadaEn: timestamp("finalizada_en", { withTimezone: true }),
  superficieM2: numeric("superficie_m2", { precision: 8, scale: 2 }),
  materiales: jsonb("materiales").notNull().default({}),
  observaciones: text("observaciones"),
  ejecutadaPor: uuid("ejecutada_por").references(() => perfiles.id),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
});

export const fotografias = pgTable("fotografias", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  intervencionId: bigint("intervencion_id", { mode: "number" }).references(
    () => intervenciones.id,
    { onDelete: "cascade" },
  ),
  demandaId: bigint("demanda_id", { mode: "number" }).references(() => demandas.id, {
    onDelete: "cascade",
  }),
  momento: momentoFotoEnum("momento").notNull(),
  storagePath: text("storage_path"),
  urlExterna: text("url_externa"),
  geom: geometry("geom", { type: "point", mode: "xy", srid: 4326 }),
  tomadaEn: timestamp("tomada_en", { withTimezone: true }),
  subidaEn: timestamp("subida_en", { withTimezone: true }).notNull().defaultNow(),
});

export const geocodeCache = pgTable("geocode_cache", {
  direccionNorm: text("direccion_norm").primaryKey(),
  geom: geometry("geom", { type: "point", mode: "xy", srid: 4326 }).notNull(),
  confianza: numeric("confianza", { precision: 4, scale: 3 }),
  proveedor: text("proveedor").notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const auditoria = pgTable("auditoria", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entidad: text("entidad").notNull(),
  entidadId: bigint("entidad_id", { mode: "number" }).notNull(),
  accion: text("accion").notNull(),
  actor: uuid("actor").references(() => perfiles.id),
  diff: jsonb("diff"),
  ocurridoEn: timestamp("ocurrido_en", { withTimezone: true }).notNull().defaultNow(),
});
