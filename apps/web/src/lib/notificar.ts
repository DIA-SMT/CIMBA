import "server-only";
import { getDb, sql } from "@cimba/db";
import type { RolUsuario } from "@cimba/domain";
import { ROLES_USUARIO } from "@cimba/domain";
import { notificarRoles, type CargaPush } from "./push";

/**
 * El despachador de avisos de CIMBA. Un evento (orden emitida, orden vencida,
 * bache propuesto, aviso general) se manda a los destinatarios que la
 * Dirección de Bacheo configuró en /ordenes/avisos, por dos canales:
 *  - push  (VAPID, a todos los perfiles del rol destino con push suscripto)
 *  - email (Resend, por API REST — sin SDK: es un POST con Bearer)
 *
 * Sin RESEND_API_KEY los emails se saltean y se informa: el push sigue
 * andando igual. Nada de lo que pase acá puede romper la acción que disparó
 * el evento (emitir una orden vale más que su aviso).
 */

export type EventoAviso = "orden_emitida" | "orden_vencida" | "item_propuesto" | "aviso_general";

export interface ResultadoAviso {
  push: number;
  emails: number;
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
    return { ok: false, motivo: e instanceof Error ? e.message : "error de red" };
  }
}

/** Plantilla mínima y sobria: el contenido manda, no el diseño. */
function htmlAviso(titulo: string, cuerpo: string, url?: string): string {
  const base = process.env.CIMBA_URL_PUBLICA ?? "https://cimba-smt.vercel.app";
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
): Promise<ResultadoAviso> {
  const resultado: ResultadoAviso = { push: 0, emails: 0, saltados: [] };
  try {
    const destinos = (await getDb().execute(sql`
      select canal, destino from avisos_destinatarios
      where evento = ${evento} and activo
    `)) as unknown as Array<{ canal: string; destino: string }>;

    const rolesPush = destinos
      .filter((d) => d.canal === "push")
      .map((d) => d.destino)
      .filter((d): d is RolUsuario => (ROLES_USUARIO as readonly string[]).includes(d));
    if (rolesPush.length > 0) {
      // Se informa lo ENTREGADO, no lo configurado: sin VAPID o sin nadie
      // suscripto, el número honesto es 0.
      const envio = await notificarRoles(rolesPush, { titulo: carga.titulo, cuerpo: carga.cuerpo, url: carga.url });
      resultado.push = envio.enviadas;
      if (envio.enviadas === 0) {
        resultado.saltados.push(`push a ${rolesPush.join(", ")}: nadie suscripto (o VAPID sin configurar)`);
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
  } catch (e) {
    // El aviso nunca rompe a quien lo dispara: se anota y sigue.
    resultado.saltados.push(e instanceof Error ? e.message : "error despachando");
  }
  return resultado;
}
