import { pedirA } from "./cimba.ts";
import type { ConfigCimba, Salida } from "./cimba.ts";

/**
 * Cerrar o reasignar una orden, del lado del bot.
 *
 * Mismo criterio que con los baches propuestos: acá no se decide nada. Se
 * muestra qué está por pasar, se toca un botón y CIMBA hace el resto con los
 * permisos de quien tocó.
 *
 * La diferencia con un propuesto es que reasignar necesita un DATO además de la
 * decisión: a qué empresa. Por eso son dos toques — el primero pregunta, el
 * segundo elige — y las opciones las manda CIMBA, que es el que sabe cuáles
 * están habilitadas para esa orden.
 */

export interface OrdenParaDecidir {
  ordenId: number;
  numero: string;
  empresa: string;
  estado: string;
  vence: string | null;
  itemsPendientes: number;
  empresasPosibles: Array<{ id: number; nombre: string }>;
}

export interface ToqueOrden {
  ordenId: number;
  /** c: cerrar · C: cerrar confirmado · r: pedir empresa · a<id>: reasignar · x: cancelar */
  accion: string;
  empresaId?: number;
}

export function leerToqueOrden(dato: string): ToqueOrden | null {
  const m = /^o:(\d{1,10}):([cCrx])$/.exec(dato);
  if (m?.[1] && m[2]) return { ordenId: Number(m[1]), accion: m[2] };
  const a = /^o:(\d{1,10}):a:(\d{1,10})$/.exec(dato);
  if (a?.[1] && a[2]) return { ordenId: Number(a[1]), accion: "a", empresaId: Number(a[2]) };
  return null;
}

export function verOrden(config: ConfigCimba, chatId: number, ordenId: number) {
  return pedirA<{ orden: OrdenParaDecidir }>(config, chatId, "orden", { ordenId, accion: "ver" });
}

export function cerrar(config: ConfigCimba, chatId: number, ordenId: number) {
  return pedirA<{ pendientes?: number }>(config, chatId, "orden", { ordenId, accion: "cerrar" });
}

export function reasignar(config: ConfigCimba, chatId: number, ordenId: number, empresaId: number) {
  return pedirA<{ de: string; a: string; pendientes: number; numero: string }>(config, chatId, "orden", {
    ordenId,
    accion: "reasignar",
    empresaId,
  });
}

/**
 * Lo que hay que ver antes de cerrar. El número de pendientes es EL dato: una
 * orden con ítems sin reportar se puede cerrar igual, pero eso deja trabajo sin
 * registrar y la persona tiene que saberlo antes, no después.
 */
export function avisoDeCierre(o: OrdenParaDecidir): string {
  if (o.itemsPendientes === 0) {
    return `${o.numero} — ${o.empresa}\n\nNo le queda nada sin reportar. Cerrarla la da por terminada.`;
  }
  return (
    `${o.numero} — ${o.empresa}\n\n` +
    `Le quedan ${o.itemsPendientes} ${o.itemsPendientes === 1 ? "item" : "items"} sin reportar. ` +
    `Si la cerrás, ese trabajo queda sin registrar y la empresa ya no lo puede cargar.`
  );
}

export type SalidaOrden<T> = Salida<T>;
