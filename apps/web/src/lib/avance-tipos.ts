import type { FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";

/**
 * AVANCE — los tipos y las constantes que comparten el servidor y el cliente.
 *
 * Están separados de lib/avance.ts (que hace las consultas) por la misma razón
 * que formato.ts está separado de fecha-ejecucion.ts: lo que importa un client
 * component no puede arrastrar @cimba/db al bundle del navegador.
 */

/**
 * Las ventanas de tiempo. La que abre por defecto es la del MES —"que sea el
 * trabajo del mes, no de hoy solamente" (Marcos, 22/9)— porque hay días sin
 * carga y una pantalla que abre en "Hoy" mostraría una ciudad vacía la mitad
 * de las mañanas. "Hoy" sigue estando, para la pregunta de la mañana de Bacheo.
 */
export const VENTANAS = [
  { dias: 1, etiqueta: "Hoy" },
  { dias: 7, etiqueta: "7 días" },
  { dias: 30, etiqueta: "30 días" },
  { dias: 90, etiqueta: "90 días" },
  { dias: 0, etiqueta: "Todo" },
] as const;
export type DiasVentana = (typeof VENTANAS)[number]["dias"];
export const VENTANA_DEFAULT: DiasVentana = 30;

/** `?dias=` en la URL: cualquier cosa fuera de la lista abre en el mes. */
export function ventanaValida(crudo: unknown): DiasVentana {
  const n = Number(crudo);
  const v = VENTANAS.find((x) => x.dias === n);
  return v ? v.dias : VENTANA_DEFAULT;
}

/**
 * EL RECORTE TERRITORIAL: la misma pantalla, para un distrito o un barrio.
 * "¿Qué se hizo en el distrito 9?" es la pregunta política concreta, y "¿qué
 * se hizo en mi barrio?" la del vecino.
 */
export type TipoTerritorio = "distrito" | "barrio";
export interface TerritorioRef {
  tipo: TipoTerritorio;
  id: number;
}
export interface Territorio extends TerritorioRef {
  nombre: string;
  /** El contorno simplificado, para dibujarlo y encuadrarlo. */
  contorno: Polygon | MultiPolygon;
}
export interface OpcionTerritorio {
  id: number;
  nombre: string;
}
export interface ListasTerritorios {
  distritos: OpcionTerritorio[];
  barrios: OpcionTerritorio[];
}

/** `?distrito=9` o `?barrio=79`; el distrito manda si vienen los dos. */
export function leerTerritorio(sp: { distrito?: string; barrio?: string }): TerritorioRef | null {
  const d = Number(sp.distrito);
  if (Number.isInteger(d) && d > 0 && d < 1000) return { tipo: "distrito", id: d };
  const b = Number(sp.barrio);
  if (Number.isInteger(b) && b > 0 && b < 100_000) return { tipo: "barrio", id: b };
  return null;
}

/** La cámara del mapa en una URL compartida: `c=lat,lon,zoom`. */
export interface Camara {
  lat: number;
  lon: number;
  zoom: number;
}
export function leerCamara(crudo: string | undefined): Camara | null {
  if (!crudo) return null;
  const [lat, lon, zoom] = crudo.split(",").map(Number);
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -27.2 || lat > -26.5 || lon < -65.6 || lon > -64.9) return null;
  return { lat, lon, zoom: Math.min(19, Math.max(10, zoom ?? 13)) };
}

export interface HechoProps {
  id: number;
  /** Día del trabajo, YYYY-MM-DD en Tucumán. */
  fecha: string;
  /** Días desde el 1/1/2026: la línea de tiempo del mapa filtra por esto sin parsear fechas. */
  dia: number;
  /** Nombre corto de la empresa (primera palabra del nombre canónico), u "Otros". */
  empresa: string;
  m2: number | null;
  toneladas: number | null;
  /** Mandado por una orden de CIMBA, o informado por planilla / SIGOV / la app de la empresa. */
  fuente: "orden" | "archivo";
  orden: string | null;
  ordenId: number | null;
  direccion: string | null;
  /** La foto del "después", si la hay. */
  foto: string | null;
  /** La foto del "antes", si la hay: con las dos se arma el comparador. */
  fotoAntes: string | null;
  tipo: string | null;
  /** Cargado en las últimas 48 horas: late en el mapa. */
  reciente: boolean;
}

export interface PendienteProps {
  id: number;
  fecha: string;
  direccion: string | null;
}

/** Una obra en curso: empezada y no terminada (paños de hormigón, carpetas). */
export interface EnCursoProps {
  id: number;
  empresa: string;
  m2: number | null;
  tipo: string | null;
  /** Cuándo empezó, YYYY-MM-DD, si se cargó. */
  iniciada: string | null;
  direccion: string | null;
}

export interface OrdenActiva {
  id: number;
  numero: string;
  estado: string;
  tipo: string;
  empresa: string;
  items: number;
  hechos: number;
  ultimo: string | null;
}

export interface Cifra {
  n: number;
  m2: number;
  toneladas: number;
}

export interface FilaEmpresa {
  empresa: string;
  n: number;
  m2: number;
  toneladas: number;
  ultimo: string | null;
}

export interface PuntoSerie {
  /** Lunes de la semana, YYYY-MM-DD. */
  semana: string;
  n: number;
  m2: number;
}

export interface TopBarrio {
  id: number;
  nombre: string;
  n: number;
  m2: number;
}

/**
 * Un movimiento del feed "Pasando ahora", ya redactado en el servidor: el
 * cliente no interpreta tablas ni acciones, muestra una frase. Trae además lo
 * necesario para ir al lugar en el mapa con un toque.
 */
export interface EventoAvance {
  id: string;
  /** Cuándo pasó, ISO (UTC). */
  en: string;
  tipo:
    | "hecho"
    | "propuesto"
    | "validado"
    | "descartado"
    | "orden"
    | "verificado"
    | "vecino"
    | "carga"
    | "corregido"
    | "sync";
  frase: string;
  /** Empresa involucrada (nombre corto), para el chip de color. */
  empresa: string | null;
  lugar: string | null;
  lon: number | null;
  lat: number | null;
  ordenId: number | null;
}

/** Una de las últimas fotos de trabajo terminado, con su lugar para ir al mapa. */
export interface FotoAvance {
  url: string;
  /** La del antes, si la hay: al pasar el cursor se ve cómo estaba. */
  urlAntes: string | null;
  direccion: string | null;
  empresa: string | null;
  lon: number | null;
  lat: number | null;
  intervencionId: number | null;
}

/** Un lugar al que el mapa tiene que ir (desde una foto o un movimiento del feed). */
export interface Foco {
  lon: number;
  lat: number;
  /** La intervención, si la hay: el mapa abre su ficha cuando está en la ventana. */
  id: number | null;
  /** Cambia en cada pedido para que ir dos veces al mismo lugar también vuele. */
  clave: number;
}

export interface DatosAvance {
  generadoEn: string;
  /** Hoy en Tucumán, YYYY-MM-DD, y su índice de día. */
  hoy: string;
  hoyDia: number;
  ventana: { dias: DiasVentana; desde: string | null; desdeDia: number | null };
  /** El recorte aplicado, con su contorno; null = toda la ciudad. */
  territorio: Territorio | null;
  /** Versión pública: sin nombres de personas, sin direcciones de pedidos, sin feed. */
  publico: boolean;
  hechos: FeatureCollection<Point, HechoProps>;
  pendientes: FeatureCollection<Point, PendienteProps>;
  /** Las obras empezadas y no terminadas, sin importar la ventana: son el "ahora". */
  enCurso: FeatureCollection<Point, EnCursoProps>;
  /** El área real de cada orden activa: la envolvente de sus items. */
  areas: FeatureCollection<Polygon | MultiPolygon, OrdenActiva>;
  ordenes: OrdenActiva[];
  cifras: {
    ventana: Cifra & {
      empresas: number;
      /** Trabajos de la ventana sin superficie cargada: los m² los subestiman. */
      sinMedida: number;
      /** Pedidos de vecinos cerrados en la ventana. */
      vecinos: number;
    };
    hoy: Cifra;
    ayer: Cifra;
    semana: Cifra;
    mes: Cifra;
    total: Cifra & { desde: string | null };
    /** Lo que está pasando: obras en curso y órdenes activas. */
    ahora: { obras: number; m2: number; ordenesActivas: number };
    /** Lo que falta: pedidos en cola, baches en agenda, obras asignadas sin empezar. */
    pendientes: { pedidos: number; incidentes: number; asignadas: number; asignadasM2: number };
  };
  porEmpresa: FilaEmpresa[];
  serie: PuntoSerie[];
  /** Los barrios con más trabajo en la ventana (dentro del recorte, si es un distrito). */
  topBarrios: TopBarrio[];
  /** Los últimos movimientos de trabajo, redactados. Vacío para los roles que no ven el feed. */
  feed: EventoAvance[];
  /** Las últimas fotos del "después". */
  fotos: FotoAvance[];
}

const DIA_CERO = Date.UTC(2026, 0, 1, 12);

/** "miércoles, 2 de septiembre" → "Miércoles, 2 de septiembre": solo la primera letra. */
export const conMayuscula = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** El índice de día de vuelta a fecha, formateado largo: "Lunes, 17 de agosto". */
export function fechaDeDia(dia: number): string {
  return conMayuscula(
    new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(DIA_CERO + dia * 86_400_000)),
  );
}

/** "YYYY-MM-DD" → "17 de agosto". Anclada al mediodía para que no corra un día. */
export function fechaLarga(iso: string, conAnio = false): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    ...(conAnio ? { year: "numeric" } : {}),
  }).format(d);
}

/** Días entre dos fechas YYYY-MM-DD (hoy − entonces). */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`);
  const b = Date.parse(`${hasta}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** El título de lo que se está mirando: "Últimos 30 días", "Hoy", "Desde el 15 de marzo". */
export function etiquetaVentana(dias: DiasVentana, desdeTotal: string | null): string {
  if (dias === 1) return "Hoy";
  if (dias === 0) return desdeTotal ? `Desde el ${fechaLarga(desdeTotal)}` : "Todo lo cargado";
  return `Últimos ${dias} días`;
}

/** "Distrito 9" / "Barrio Villa 9 de Julio" / "Toda la ciudad". */
export function nombreRecorte(t: Territorio | null): string {
  if (!t) return "Toda la ciudad";
  return t.tipo === "barrio" ? `Barrio ${t.nombre}` : t.nombre;
}
