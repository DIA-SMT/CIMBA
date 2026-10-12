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

/** A qué repartición va un pedido (la columna `destino` de demandas). */
export type DestinoPedido = "bacheo" | "sat" | "ingenieria";

/**
 * Qué pedidos sueltos se ofrecen en cada tipo de orden, según su destino.
 *
 * El destino lo pone el clasificador: un "bache" que cae en una calle de
 * ripio va a Ingeniería, no a la cuadrilla de bacheo. Por eso una orden de
 * bacheo solo ofrece lo de Bacheo, y una de ripio o de cordón cuneta ofrece
 * también lo de Ingeniería, que es justamente donde terminan esos pedidos.
 */
export const DESTINOS_POR_ORDEN: Record<TipoOrden, DestinoPedido[]> = {
  bacheo: ["bacheo"],
  pano_hormigon: ["bacheo"],
  carpeta: ["bacheo"],
  ripio: ["bacheo", "ingenieria"],
  cordon_cuneta: ["bacheo", "ingenieria"],
  imbornales: ["ingenieria"],
  tapas: ["ingenieria", "sat"],
  perdida_agua: ["bacheo", "ingenieria", "sat"],
};

/**
 * Los reclamos de la SAT —las intimaciones a Aguas del Tucumán— solo entran
 * en una orden de pérdida de agua. En cualquier otra son trabajo ajeno: "los
 * reclamos de la SAT no deberían aparecer" (Dirección de Bacheo, 12/10).
 */
const aceptaReclamosSat = (tipoOrden: TipoOrden) => tipoOrden === "perdida_agua";

/**
 * ¿Este PROBLEMA ya relevado se ofrece en la orden?
 *
 * Dos cosas quedan afuera aunque el tipo coincida:
 * - las OBRAS DEL SIGOV: ya tienen contratista y expediente por su propia vía
 *   ("el SIGO sigue trabajando como venimos laborando"), así que ofrecerlas
 *   era invitar a mandar dos veces la misma obra;
 * - el problema que solo tiene detrás reclamos de la SAT, salvo en la orden
 *   de pérdida de agua. Si además lo pidió un vecino, entra: ese pedido es
 *   nuestro.
 */
export function problemaEntraEnOrden(
  tipoOrden: TipoOrden,
  p: { tipo: TipoProblema | null; origen: string | null; fuentes: readonly string[] },
): boolean {
  if (p.origen === "sigov") return false;
  if (!aceptaReclamosSat(tipoOrden) && p.fuentes.length > 0 && p.fuentes.every((f) => f === "sat")) {
    return false;
  }
  return entraEnOrden(tipoOrden, p.tipo);
}

/**
 * ¿Este PEDIDO suelto —todavía no relevado como problema— se ofrece en la
 * orden? El destino sin clasificar cuenta como Bacheo, el mismo criterio del
 * mapa y de la brecha.
 */
export function pedidoEntraEnOrden(
  tipoOrden: TipoOrden,
  p: { tipo: TipoProblema | null; destino: DestinoPedido | null; fuente: string },
): boolean {
  if (!aceptaReclamosSat(tipoOrden) && p.fuente === "sat") return false;
  if (!DESTINOS_POR_ORDEN[tipoOrden].includes(p.destino ?? "bacheo")) return false;
  return entraEnOrden(tipoOrden, p.tipo);
}

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
