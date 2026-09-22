import "server-only";
import { getDb, sql } from "@cimba/db";
import type { RolUsuario } from "@cimba/domain";
import { ROLES_USUARIO } from "@cimba/domain";
import { notificarEmpresa, notificarRoles, type CargaPush } from "./push";
import { mensajeDeError } from "@/lib/errores";

/**
 * El despachador de avisos de CIMBA. Un evento (orden emitida, orden vencida,
 * bache propuesto, aviso general) se manda a los destinatarios que la
 * Dirección de Bacheo configuró en /ordenes/avisos, por tres canales:
 *  - push     (VAPID, a todos los perfiles del rol destino con push suscripto)
 *  - email    (Resend, por API REST — sin SDK: es un POST con Bearer)
 *  - telegram (API de Telegram, igual: un POST; el destino es el id del chat)
 *
 * Sin RESEND_API_KEY los emails se saltean y se informa; sin
 * CIMBA_TELEGRAM_BOT_TOKEN pasa lo mismo con Telegram. Los demás canales
 * siguen andando igual. Nada de lo que pase acá puede romper la acción que
 * disparó el evento (emitir una orden vale más que su aviso).
 */

export type EventoAviso =
  | "orden_emitida"
  | "orden_vencida"
  | "item_propuesto"
  | "aviso_general"
  | "cierres_pendientes"
  | "pulso_diario"
  /* Los que le hablan a la EMPRESA de la orden: lo que ella necesita saber
     para trabajar, en su teléfono. */
  | "item_validado"
  | "item_rechazado"
  | "orden_reasignada"
  | "orden_cerrada";

export interface ResultadoAviso {
  push: number;
  emails: number;
  telegram: number;
  saltados: string[];
}

export async function enviarEmail(datos: {
  para: string;
  asunto: string;
  html: string;
}): Promise<{ ok: boolean; motivo?: string }> {
  const clave = process.env.RESEND_API_KEY;
  if (!clave) return { ok: false, motivo: "falta RESEND_API_KEY" };
  const de = process.env.RESEND_FROM ?? "CIMBA <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${clave}`, "content-type": "application/json" },
      body: JSON.stringify({ from: de, to: [datos.para], subject: datos.asunto, html: datos.html }),
    });
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => "");
      return { ok: false, motivo: `Resend ${r.status}: ${cuerpo.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: mensajeDeError(e, "error de red") };
  }
}

/**
 * Un mensaje a un chat de Telegram. Mismo criterio que enviarEmail: un POST
 * con fetch, sin SDK, y nunca lanza — devuelve el motivo para que el
 * despachador lo anote en `saltados`.
 *
 * Va en texto plano y sin parse_mode a propósito: los títulos y cuerpos de
 * los avisos traen direcciones con guiones, paréntesis y puntos, y en
 * MarkdownV2 un solo carácter sin escapar hace fallar el envío entero con un
 * 400. El texto se recorta a 4096, que es el máximo de un mensaje: un aviso
 * es corto por definición, y si alguna vez se pasa, preferimos que llegue
 * cortado antes que que no llegue.
 */
export async function enviarTelegram(datos: {
  chatId: string;
  texto: string;
  url?: string;
}): Promise<{ ok: boolean; motivo?: string }> {
  const token = process.env.CIMBA_TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, motivo: "falta CIMBA_TELEGRAM_BOT_TOKEN" };
  const cuerpo = datos.url ? `${datos.texto}\n\n${datos.url}` : datos.texto;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: datos.chatId,
        text: cuerpo.slice(0, 4096),
        link_preview_options: { is_disabled: true },
      }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(() => "");
      return { ok: false, motivo: `Telegram ${r.status}: ${detalle.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: mensajeDeError(e, "error de red") };
  }
}

/** La base pública, para armar enlaces absolutos desde las rutas de `carga.url`. */
function basePublica(): string {
  return process.env.CIMBA_URL_PUBLICA ?? "https://cimba-smt.vercel.app";
}

/** Plantilla mínima y sobria: el contenido manda, no el diseño. */
function htmlAviso(titulo: string, cuerpo: string, url?: string): string {
  const base = basePublica();
  const enlace = url ? `${base}${url}` : base;
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:16px">
    <p style="font-size:12px;letter-spacing:2px;color:#0066FF;margin:0 0 8px">CIMBA · BACHEO SMT</p>
    <h2 style="margin:0 0 10px;color:#131922">${escapar(titulo)}</h2>
    <p style="color:#374357;line-height:1.6;white-space:pre-line">${escapar(cuerpo)}</p>
    <p style="margin-top:18px"><a href="${enlace}" style="color:#0066FF">Abrir en CIMBA →</a></p>
    <p style="margin-top:22px;font-size:11px;color:#8a97a8">Aviso automático del Centro Inteligente de
    Monitoreo de Baches y Asfalto — Municipalidad de San Miguel de Tucumán.</p>
  </div>`;
}

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Despacha un evento a sus destinatarios configurados. Corre con la conexión
 * de servicio: los eventos los disparan acciones ya autorizadas y el cron.
 */
export async function notificarEvento(
  evento: EventoAviso,
  carga: CargaPush & { cuerpoEmail?: string },
  /**
   * La empresa a la que le concierne el evento. Con esto, un destinatario
   * configurado como `empresa` en /ordenes/avisos se resuelve a LOS TELÉFONOS
   * DE ESA CONTRATISTA y no al rol entero. La URL que le llega a la empresa es
   * la de su portal, que es la única que puede abrir.
   */
  opciones: { empresaId?: number; urlEmpresa?: string } = {},
): Promise<ResultadoAviso> {
  const resultado: ResultadoAviso = { push: 0, emails: 0, telegram: 0, saltados: [] };
  try {
    const destinos = (await getDb().execute(sql`
      select canal, destino from avisos_destinatarios
      where evento = ${evento} and activo
    `)) as unknown as Array<{ canal: string; destino: string }>;

    const rolesPush = destinos
      .filter((d) => d.canal === "push")
      .map((d) => d.destino)
      // "empresa" como rol NO entra acá: sería avisarle a las trece
      // contratistas de la orden de una. Se resuelve aparte, abajo.
      .filter((d): d is RolUsuario => d !== "empresa" && (ROLES_USUARIO as readonly string[]).includes(d));
    if (rolesPush.length > 0) {
      // Se informa lo ENTREGADO, no lo configurado: sin VAPID o sin nadie
      // suscripto, el número honesto es 0.
      const envio = await notificarRoles(rolesPush, { titulo: carga.titulo, cuerpo: carga.cuerpo, url: carga.url });
      resultado.push = envio.enviadas;
      if (envio.enviadas === 0) {
        resultado.saltados.push(`push a ${rolesPush.join(", ")}: nadie suscripto (o VAPID sin configurar)`);
      }
    }

    const quiereEmpresa = destinos.some((d) => d.canal === "push" && d.destino === "empresa");
    if (quiereEmpresa && opciones.empresaId != null) {
      const envio = await notificarEmpresa(opciones.empresaId, {
        titulo: carga.titulo,
        cuerpo: carga.cuerpo,
        url: opciones.urlEmpresa ?? "/empresa",
        tag: carga.tag,
      });
      resultado.push += envio.enviadas;
      if (envio.enviadas === 0) {
        resultado.saltados.push(`push a la empresa #${opciones.empresaId}: ningún teléfono suscripto`);
      }
    }

    for (const d of destinos.filter((x) => x.canal === "email")) {
      const r = await enviarEmail({
        para: d.destino,
        asunto: carga.titulo,
        html: htmlAviso(carga.titulo, carga.cuerpoEmail ?? carga.cuerpo, carga.url),
      });
      if (r.ok) resultado.emails++;
      else resultado.saltados.push(`${d.destino}: ${r.motivo}`);
    }

    /* Telegram va con el cuerpo corto, no con el de email: el de email lleva
       HTML y está pensado para leerse sentado. Acá el aviso tiene que
       entenderse de un vistazo, en la calle. */
    for (const d of destinos.filter((x) => x.canal === "telegram")) {
      const r = await enviarTelegram({
        chatId: d.destino,
        texto: `${carga.titulo}\n\n${carga.cuerpo}`,
        // carga.url es una ruta (/ordenes/123): se completa con la base, igual
        // que hace htmlAviso, o el enlace llega inservible.
        url: carga.url ? `${basePublica()}${carga.url}` : undefined,
      });
      if (r.ok) resultado.telegram++;
      else resultado.saltados.push(`telegram ${d.destino}: ${r.motivo}`);
    }
  } catch (e) {
    // El aviso nunca rompe a quien lo dispara: se anota y sigue.
    resultado.saltados.push(mensajeDeError(e, "error despachando"));
  }
  return resultado;
}
