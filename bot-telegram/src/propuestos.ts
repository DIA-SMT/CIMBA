import { pedirA } from "./cimba.ts";
import type { ConfigCimba } from "./cimba.ts";

/**
 * Los baches propuestos, del lado del bot.
 *
 * El aviso lo manda CIMBA directo a Telegram, con dos botones. El toque llega
 * acá —mismo bot, mismo token— y este módulo lo traduce en una llamada a CIMBA.
 * Ninguna decisión se toma de este lado: acá solo se arma qué preguntar y qué
 * mostrar.
 */

/** Lo que viaja en el botón. Telegram corta en 64 bytes, así que va corto. */
export interface Toque {
  itemId: number;
  /** v: validar · V: validar confirmado · r: rechazar · r0/r1/r2: con motivo · x: cancelar */
  accion: string;
}

export function leerToque(dato: string): Toque | null {
  const m = /^p:(\d{1,12}):([a-zA-Z0-9]{1,2})$/.exec(dato);
  if (!m?.[1] || !m[2]) return null;
  return { itemId: Number(m[1]), accion: m[2] };
}

/** Los motivos de rechazo que se ofrecen con un toque. */
export const MOTIVOS: Record<string, string> = {
  r1: "No corresponde a esta orden.",
  r2: "Ya estaba reparado.",
};

export interface Propuesto {
  itemId: number;
  direccion: string | null;
  tipoTrabajo: string | null;
  superficieM2: number | null;
  espesorCm: number | null;
  habilitaCertificacion: boolean;
  numero: string;
  empresa: string;
  propuestoPor: string | null;
}

const pedir = <T,>(config: ConfigCimba, chatId: number, cuerpo: Record<string, unknown>) =>
  pedirA<T>(config, chatId, "propuesto", cuerpo);

export function verPropuesto(config: ConfigCimba, chatId: number, itemId: number) {
  return pedir<{ propuesto: Propuesto }>(config, chatId, { itemId, accion: "ver" });
}

export function resolver(
  config: ConfigCimba,
  chatId: number,
  itemId: number,
  decision: "validar" | "rechazar",
  motivo?: string,
) {
  return pedir<{ resultado: "encolado" | "certificado" | "rechazado"; numero: string | null; direccion: string | null }>(
    config,
    chatId,
    { itemId, accion: decision, ...(motivo ? { motivo } : {}) },
  );
}

/** La tarjeta del propuesto, para que la decisión sea informada. */
export function describir(p: Propuesto): string {
  const partes = [`${p.numero} · ${p.empresa}`, p.direccion ?? "sin dirección"];
  if (p.superficieM2 != null) {
    partes.push(`${p.superficieM2} m²${p.espesorCm != null ? ` · ${p.espesorCm} cm` : ""}`);
  }
  if (p.propuestoPor) partes.push(`Lo propuso ${p.propuestoPor}`);
  return partes.join("\n");
}

/** Qué va a pasar si se valida. Es la frase que hace informada la decisión. */
export function quePasaSiValida(p: Propuesto): string {
  return p.habilitaCertificacion
    ? "Este bache ya viene medido: validarlo lo da por HECHO y habilita que se le certifique a la empresa. No se puede deshacer desde CIMBA."
    : "Validarlo lo suma a los pendientes de la orden. Lo reportan cuando lo tapen.";
}

export interface Pendientes {
  propuestos: Propuesto[];
  propuestosTotal: number;
  ordenesVencidas: Array<{ numero: string; empresa: string; vence: string; itemsPendientes: number }>;
  cierresPendientes: number;
}

export function verPendientes(config: ConfigCimba, chatId: number) {
  return pedirA<Pendientes>(config, chatId, "pendientes", {});
}

/**
 * El encabezado de la bandeja: qué hay, en una mirada.
 *
 * Los propuestos van aparte, un mensaje por cada uno con sus botones, así que
 * acá solo se cuentan. Las órdenes vencidas y los cierres se listan nomás: son
 * decisiones que todavía no se pueden tomar desde el teléfono, y decir cuántas
 * hay ya sirve para saber si hay que sentarse.
 */
export function describirPendientes(p: Pendientes): string {
  if (p.propuestosTotal === 0 && p.ordenesVencidas.length === 0 && p.cierresPendientes === 0) {
    return "No tenés nada esperando una decisión. Todo al día.";
  }

  const lineas: string[] = ["**Lo que espera una decisión tuya**", ""];

  if (p.propuestosTotal > 0) {
    lineas.push(
      `**${p.propuestosTotal} bache${p.propuestosTotal === 1 ? "" : "s"} propuesto${p.propuestosTotal === 1 ? "" : "s"}** por las cuadrillas` +
        (p.propuestos.length < p.propuestosTotal ? ` — te muestro los ${p.propuestos.length} últimos abajo` : ""),
    );
  }

  if (p.ordenesVencidas.length > 0) {
    lineas.push("", `**${p.ordenesVencidas.length} orden${p.ordenesVencidas.length === 1 ? "" : "es"} vencida${p.ordenesVencidas.length === 1 ? "" : "s"}**`);
    for (const o of p.ordenesVencidas) {
      lineas.push(`• ${o.numero} — ${o.empresa}, venció el ${o.vence}, ${o.itemsPendientes} sin reportar`);
    }
  }

  if (p.cierresPendientes > 0) {
    lineas.push("", `**${p.cierresPendientes} reclamo${p.cierresPendientes === 1 ? "" : "s"} listo${p.cierresPendientes === 1 ? "" : "s"} para cerrar** — el problema ya se reparó, falta responderle al vecino.`);
  }

  return lineas.join("\n");
}

export function contarResultado(
  resultado: "encolado" | "certificado" | "rechazado",
  direccion: string | null,
): string {
  const donde = direccion ?? "el bache";
  if (resultado === "certificado") {
    return `✓ ${donde} quedó como hecho. Ya cuenta para la certificación de la empresa.`;
  }
  if (resultado === "encolado") {
    return `✓ ${donde} entró en la orden. La empresa lo reporta cuando lo tape.`;
  }
  return `✗ ${donde} quedó rechazado. La empresa ya fue avisada.`;
}
