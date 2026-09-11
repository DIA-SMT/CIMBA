/**
 * Memoria local del portal de empresas. Dos problemas distintos, los dos del
 * capataz cargando en la calle con el teléfono:
 *
 *  1. REPETIR LO MISMO 40 VECES. En una jornada el espesor y la modalidad de
 *     obra son casi siempre los mismos (la cuadrilla trabaja con el mismo
 *     equipo y el mismo protocolo todo el día); lo que cambia es el ancho, el
 *     largo y la foto. Recordar lo repetido y dejar a la vista que se recordó
 *     convierte ocho toques por bache en tres.
 *
 *  2. PERDER LO ESCRITO. Se carga con datos móviles en la vereda: basta que
 *     se caiga la señal, entre una llamada o el navegador descarte la pestaña
 *     para que se borre lo tipeado. El borrador se guarda en el teléfono a
 *     cada tecla y se limpia solo cuando el reporte se envió de verdad.
 *
 * Todo vive en localStorage del dispositivo: no viaja al servidor, no es dato
 * compartido y no reemplaza a nada de la base. Si el navegador lo bloquea
 * (modo privado, almacenamiento lleno), cada lectura y escritura falla en
 * silencio y el formulario se comporta como antes.
 */

export interface MemoriaCarga {
  espesor?: string;
  tipoIntervencion?: string;
  /** null = "sin modalidad elegida"; undefined = "nunca se guardó nada". */
  tipoObra?: string | null;
  /** El capataz es el mismo toda la jornada: se escribe una vez por orden. */
  capataz?: string;
}

export interface BorradorItem {
  ancho?: string;
  largo?: string;
  espesor?: string;
  obs?: string;
  /** Para poder decirle al capataz de cuándo es lo que recuperó. */
  guardadoEn?: number;
}

const claveMemoria = (ordenId: number) => `cimba:carga:${ordenId}`;
const claveBorrador = (itemId: number) => `cimba:borrador-item:${itemId}`;

function leer<T>(clave: string): T | null {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo ? (JSON.parse(crudo) as T) : null;
  } catch {
    return null;
  }
}

function escribir(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* almacenamiento bloqueado o lleno: se sigue sin memoria */
  }
}

export const leerMemoria = (ordenId: number): MemoriaCarga => leer<MemoriaCarga>(claveMemoria(ordenId)) ?? {};
export const guardarMemoria = (ordenId: number, m: MemoriaCarga) => escribir(claveMemoria(ordenId), m);

export const leerBorrador = (itemId: number): BorradorItem | null => leer<BorradorItem>(claveBorrador(itemId));
export const guardarBorrador = (itemId: number, b: BorradorItem) =>
  escribir(claveBorrador(itemId), { ...b, guardadoEn: Date.now() });
export function borrarBorrador(itemId: number) {
  try {
    localStorage.removeItem(claveBorrador(itemId));
  } catch {
    /* ídem */
  }
}

/**
 * ¿Hay trabajo EMPEZADO que valga la pena rescatar?
 *
 * OJO con el espesor: NO cuenta. El espesor (y la modalidad, y el capataz) se
 * precargan solos desde la memoria de la jornada apenas se monta la tarjeta,
 * así que si contara, el guardado automático escribiría un borrador para
 * CADA bache pendiente sin que el capataz hubiera tocado nada — y en la
 * siguiente visita las cuarenta tarjetas se abrirían solas anunciando "quedó
 * a medias". Lo que marca que alguien empezó de verdad es la medida del pozo
 * o una observación escrita.
 */
export const borradorTieneAlgo = (b: BorradorItem) =>
  Boolean(b.ancho?.trim() || b.largo?.trim() || b.obs?.trim());
