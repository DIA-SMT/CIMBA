"use server";

import { requerirSesion } from "./auth";
import { contactosWhatsapp } from "./contactos";

/** Lista de contactos para compartir por WhatsApp, solo para sesiones autenticadas. */
export async function listarContactosWhatsapp(): Promise<Array<{ nombre: string; telefono: string }>> {
  await requerirSesion();
  return contactosWhatsapp();
}
