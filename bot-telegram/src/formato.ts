/**
 * Del Markdown que escribe el modelo al HTML que entiende Telegram.
 *
 * Migue contesta con `**negrita**`, listas con guion y algún backtick. En texto
 * plano eso se ve con los asteriscos a la vista.
 *
 * De los tres modos de Telegram elegimos HTML, y no es capricho: en MarkdownV2
 * un solo `-`, `.`, `(` o `!` sin escapar hace fallar el envío ENTERO con un
 * 400. Los textos vienen de un modelo y hablan de direcciones —"Av. Sarmiento
 * 1240 (entre Salta y Junín)"— así que ese modo garantiza que tarde o temprano
 * un mensaje no llegue. En HTML solo tres caracteres son especiales, y se
 * escapan todos de una.
 *
 * EL ORDEN IMPORTA Y ES LA MITAD DEL ASUNTO: primero se escapa TODO, después se
 * ponen las etiquetas. Así, si el modelo escribiera `<b>` o `<script>`, llega
 * como texto visible y no como marcado; y lo único que Telegram interpreta son
 * las etiquetas que pusimos nosotros. Al revés, cualquier `<` del modelo
 * rompería el mensaje o se colaría como formato.
 */

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function aHtml(texto: string): string {
  let s = escapar(texto);

  // Bloques de código antes que nada: adentro no se toca ningún otro patrón.
  s = s.replace(/```[a-z]*\n([\s\S]*?)```/g, (_, cuerpo: string) => `<pre>${cuerpo.trimEnd()}</pre>`);
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Títulos: Telegram no tiene, así que se degradan a negrita.
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Negrita y cursiva. Los pares tienen que cerrar en la misma línea: un
  // asterisco suelto queda como asterisco, que es feo pero inofensivo.
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/__([^_\n]+)__/g, "<b>$1</b>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");

  // Viñetas: el guion o el asterisco al principio de la línea se ven mejor así.
  s = s.replace(/^[ \t]*[-*]\s+/gm, "• ");

  // [texto](url) -> enlace. Solo http(s): un javascript: no tiene nada que
  // hacer acá aunque Telegram lo ignore.
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  return s;
}

/**
 * El mismo texto sin nada de marcado, para el reintento.
 *
 * Si Telegram rechaza el HTML —una etiqueta cortada al partir un mensaje largo,
 * un caso que no previmos— el mensaje se manda igual, en plano. Perder la
 * negrita es aceptable; perder la respuesta no.
 */
export function aPlano(texto: string): string {
  return texto
    .replace(/```[a-z]*\n?/g, "")
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-*]\s+/gm, "• ")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
}
