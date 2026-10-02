/** El máximo de un mensaje de Telegram. */
export const MAX_CARACTERES = 4096;

/**
 * Parte un texto largo en varios mensajes, cortando por párrafos y después por
 * líneas para no romper una oración al medio.
 *
 * Es la misma función que usa el bot de Ambiente (canal/comun.ts). Está copiada
 * y no importada porque vive adentro de ese bot y no en un paquete compartido:
 * el día que un tercer bot la necesite, conviene subirla a @bots/core en vez de
 * tener tres copias.
 *
 * Acá se pasa de 4096 más seguido que allá: una lista de órdenes vencidas o el
 * detalle de un barrio se estiran, y perder la respuesta por larga sería una
 * falla tonta.
 */
export function partirTexto(texto: string, maximo = MAX_CARACTERES): string[] {
  if (texto.length <= maximo) return [texto];

  const partes: string[] = [];
  let actual = "";

  for (const parrafo of texto.split("\n\n")) {
    const candidato = actual === "" ? parrafo : `${actual}\n\n${parrafo}`;

    if (candidato.length <= maximo) {
      actual = candidato;
      continue;
    }

    if (actual !== "") {
      partes.push(actual);
      actual = "";
    }

    if (parrafo.length <= maximo) {
      actual = parrafo;
      continue;
    }
    let resto = parrafo;
    while (resto.length > maximo) {
      const corte = resto.lastIndexOf("\n", maximo) > 0 ? resto.lastIndexOf("\n", maximo) : maximo;
      partes.push(resto.slice(0, corte));
      resto = resto.slice(corte).replace(/^\n/, "");
    }
    actual = resto;
  }

  if (actual !== "") partes.push(actual);
  return partes;
}
