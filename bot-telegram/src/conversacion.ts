import type { Turno } from "./cimba.ts";

/**
 * El hilo de cada chat, en memoria y descartable.
 *
 * Mismo criterio que el estado de flujo del bot de Ambiente: es estado
 * CALIENTE. Si el proceso se reinicia se pierde, y lo peor que pasa es que la
 * siguiente pregunta no herede el contexto de la anterior — se vuelve a
 * preguntar y listo. No va a Redis porque no hace falta todavía: el día que
 * dos instancias del bot corran a la vez, sí.
 *
 * CIMBA se queda con los últimos 12 turnos de todos modos, así que guardar más
 * es peso muerto.
 */

const TURNOS = 12;
/** Un hilo que estuvo quieto dos horas arranca de nuevo. */
const VENCE_MS = 2 * 60 * 60 * 1000;

interface Hilo {
  turnos: Turno[];
  ultimo: number;
}

const hilos = new Map<number, Hilo>();

export function recordar(chatId: number, turno: Turno, ahora: number): Turno[] {
  const hilo = hilos.get(chatId);
  const vigente = hilo && ahora - hilo.ultimo < VENCE_MS ? hilo.turnos : [];
  const turnos = [...vigente, turno].slice(-TURNOS);
  hilos.set(chatId, { turnos, ultimo: ahora });
  return turnos;
}

export function olvidar(chatId: number): void {
  hilos.delete(chatId);
}

/**
 * Saca los hilos vencidos. Se llama al atender, no con un temporizador: un
 * intervalo más que registrar en el apagado, para limpiar un Map de tres
 * entradas, no se justifica.
 */
export function limpiar(ahora: number): void {
  for (const [chatId, hilo] of hilos) {
    if (ahora - hilo.ultimo >= VENCE_MS) hilos.delete(chatId);
  }
}
