/**
 * Cómo se le escribe al vecino. Módulo plano: lo usan la bandeja de Cierres y
 * el cierre directo desde el mapa, y tienen que armar el mismo número.
 *
 * wa.me solo ABRE WhatsApp con el texto puesto; el envío lo hace la persona.
 * CIMBA no le manda nada solo al vecino.
 */

/** Argentina para WhatsApp: 54 + 9 + área + número, sin símbolos.
 *  Devuelve null si el número no tiene la forma esperada — mejor no ofrecer
 *  el botón que abrir un chat con un desconocido. */
export function whatsappDe(tel: string | undefined | null): string | null {
  if (!tel) return null;
  let d = tel.replace(/[^0-9]/g, "").replace(/^00/, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  // Área (2 a 4 dígitos) + el 15 viejo de celular: WhatsApp no lo lleva.
  d = d.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");
  return d.length === 10 ? `549${d}` : null;
}
