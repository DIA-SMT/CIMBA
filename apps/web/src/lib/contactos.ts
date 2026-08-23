import { z } from "zod";

/**
 * Contactos para compartir vistas del mapa por WhatsApp. Viven en una
 * variable de entorno (nunca en el código: el repo es público) como JSON:
 * CONTACTOS_WHATSAPP=[{"nombre":"Leo (Bacheo)","telefono":"5493814591205"}]
 * El teléfono va SIN "+" ni espacios (formato wa.me).
 */
const contactoSchema = z.object({ nombre: z.string().min(1), telefono: z.string().regex(/^\d{8,15}$/) });

export function contactosWhatsapp(): Array<{ nombre: string; telefono: string }> {
  const crudo = process.env.CONTACTOS_WHATSAPP;
  if (!crudo) return [];
  try {
    return z.array(contactoSchema).parse(JSON.parse(crudo));
  } catch {
    return [];
  }
}
