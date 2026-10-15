/**
 * LA DIRECCIÓN COMO LA ENTIENDE EL CALLEJERO: solo la calle y la altura, o
 * las dos calles del cruce.
 *
 * Dos formas de escribirla rompían la búsqueda sin que nada lo avisara:
 *
 *  - LA CIUDAD AL FINAL. La Carga rápida buscaba "España y Laprida, San Miguel
 *    de Tucumán" y el cruce se partía en "España" y "Laprida, San Miguel de
 *    Tucumán" —una calle que no existe—: "no pude ubicar la dirección",
 *    mientras que tocando el mapa la esquina salía bien (14/10). Lo mismo con
 *    la altura: "Sarmiento 471, San Miguel de Tucumán" ya no termina en un
 *    número y salteaba el callejero. Los reclamos del 147 traen la cola
 *    entera: "Mario Bravo, San Miguel de Tucumán, Departamento Capital,
 *    Tucumán, T4000, Argentina". Nominatim agrega la ciudad por su cuenta, así
 *    que sacarla no le quita nada.
 *
 *  - EL "AL" DE LA ALTURA. "Eudoro Aráoz al 500" tomaba "Eudoro Aráoz al"
 *    como nombre de calle, el callejero no la conocía y Nominatim la mandaba a
 *    1,5 km (Leo, 13/10). "Eudoro Aráoz 500" salía exacta a 35 m.
 */

/** Lo que puede venir después de la calle y no es la calle. */
const COLA_DE_CIUDAD =
  /^(san miguel de tucum[aá]n|s\.?\s?m\.?\s?t\.?|smt|tucum[aá]n|provincia de tucum[aá]n|departamento capital|capital|argentina|municipalidad de san miguel de tucum[aá]n|t?\d{4}[a-z]{0,3})$/i;

export function limpiarDireccion(direccion: string): string {
  const partes = direccion.split(",").map((p) => p.trim());
  // De atrás para adelante: se saca la cola mientras sea ciudad, provincia,
  // país o código postal. Nunca la primera parte: esa es la calle.
  while (partes.length > 1 && COLA_DE_CIUDAD.test(partes[partes.length - 1] ?? "")) partes.pop();
  return partes
    .filter((p) => p.length > 0)
    .join(", ")
    .replace(/\s+al\s+(\d{1,5})\s*$/i, " $1")
    .replace(/\s+/g, " ")
    .trim();
}
