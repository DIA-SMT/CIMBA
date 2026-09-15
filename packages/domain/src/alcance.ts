import type { TipoProblema } from "./tipos";

/**
 * QUÉ PUEDE HACER BACHEO Y QUÉ NO.
 *
 * De los 202 incidentes abiertos, 59 son pérdidas de agua y 11 son tapas de
 * registro: 70, más de un tercio, no le tocan a la Dirección de Bacheo. Y sin
 * embargo aparecían en la pantalla de armar la orden, mezclados con los
 * baches, listos para que alguien se los mandara a una contratista que no
 * puede resolverlos. "Están apareciendo para ejecutar como bache tapas de
 * registro o pérdidas de agua, que corresponde a la SAT" (12/09).
 *
 * El problema de fondo era que el TIPO de orden —que se elige en el paso 1— no
 * tenía ninguna consecuencia: una orden de bacheo ofrecía exactamente lo mismo
 * que una de imbornales. Acá vive esa consecuencia.
 *
 * Ojo con la diferencia entre este mapa y `destino` (la columna de demandas
 * que decide a qué repartición va el reclamo): destino contesta "¿de quién es
 * este problema?", esto contesta "¿entra en ESTA orden?". Una pérdida de agua
 * es de la SAT en los dos casos, pero igual puede entrar en una orden nuestra
 * —de relevamiento, o de ejecución con UOCRA o INGECO— y por eso son dos
 * preguntas y no una.
 */

export const TIPOS_ORDEN = [
  "bacheo",
  "pano_hormigon",
  "carpeta",
  "cordon_cuneta",
  "imbornales",
  "tapas",
  "ripio",
  /**
   * La pérdida de agua es de la SAT, pero el municipio la ejecuta cuando no
   * puede esperar: solo con UOCRA e INGECO, que son las únicas habilitadas
   * (ver EMPRESAS_HABILITADAS_AGUA). La misma orden sirve de relevamiento
   * fotográfico para la nota a la SAT cuando no se puede resolver.
   */
  "perdida_agua",
] as const;
export type TipoOrden = (typeof TIPOS_ORDEN)[number];

/** El vocabulario del pavimento: lo que se arregla con asfalto u hormigón. */
const CALZADA: TipoProblema[] = [
  "bache",
  "pavimento_deteriorado",
  "hundimiento",
  "fisura",
  "bocacalle_rota",
  "cuadra_completa",
  "otro",
];

/**
 * Qué tipos de problema entran en cada tipo de orden.
 *
 * "otro" entra en las de calzada a propósito: es el cajón de lo sin clasificar,
 * y dejarlo afuera escondería trabajo real detrás de una etiqueta floja. Lo que
 * NO entra en una orden de bacheo es lo que tiene dueño conocido y no es
 * Bacheo: el agua, la cloaca, la tapa de registro y el imbornal.
 */
export const TIPOS_POR_ORDEN: Record<TipoOrden, TipoProblema[]> = {
  bacheo: CALZADA,
  pano_hormigon: CALZADA,
  carpeta: CALZADA,
  ripio: ["pavimento_deteriorado", "hundimiento", "otro"],
  cordon_cuneta: ["cuneta_rota", "bocacalle_rota"],
  imbornales: ["sumidero"],
  tapas: ["tapa_registro"],
  perdida_agua: ["perdida_agua", "perdida_cloacal"],
};

/**
 * Las únicas empresas que pueden recibir una orden de pérdida de agua.
 * "Nosotros solo podemos resolver pérdidas de agua con la UOCRA e INGECO"
 * (12/09). Se identifican por slug y no por id: los ids son de esta base, el
 * slug es el nombre del contrato.
 */
export const EMPRESAS_HABILITADAS_AGUA = ["uocra", "ingeco"] as const;

/** ¿Este problema entra en una orden de este tipo? */
export const entraEnOrden = (tipoOrden: TipoOrden, tipo: TipoProblema | null): boolean =>
  tipo == null ? tipoOrden === "bacheo" : TIPOS_POR_ORDEN[tipoOrden].includes(tipo);

/**
 * Lo que la orden NO va a poder resolver aunque esté en la zona: sirve para
 * decirlo en pantalla en vez de esconderlo. Que el Director vea "hay 59
 * pérdidas de agua acá que no entran en esta orden" es información; que
 * desaparezcan sin aviso es lo que venía pasando al revés.
 */
export const ES_DE_OTRA_REPARTICION: TipoProblema[] = [
  "perdida_agua",
  "perdida_cloacal",
  "tapa_registro",
  "sumidero",
];
