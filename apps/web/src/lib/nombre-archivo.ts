import { hoyISO } from "./formato";

/**
 * EL NOMBRE CODIFICADO de todo lo que se imprime o se baja: CIMBA, qué
 * documento es y el día, por ejemplo CIMBA-ORDEN-2026-0027-20261024. Pedido de
 * la Dirección (propuesta 10, 24/10): archivar, buscar y citar en expedientes
 * con la misma lógica que la NOTA-SAT numerada. Antes cada PDF salía con el
 * título genérico de la app y las planillas con la fecha en UTC, que después
 * de las 21 h ya era el día siguiente.
 *
 * Una sola función para el servidor (planillas) y el navegador (PDF): si cada
 * lugar armara el nombre por su cuenta, el mismo documento terminaría con dos
 * nombres distintos.
 */
export function nombreArchivo(documento: string, fecha: string = hoyISO()): string {
  const codigo = documento
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `CIMBA-${codigo}-${fecha.replaceAll("-", "")}`;
}

/** La orden se llama OT-2026-0027 en pantalla; en el nombre del archivo, ORDEN-2026-0027. */
export function documentoOrden(numero: string): string {
  return numero.replace(/^OT-/i, "ORDEN-");
}

/**
 * Imprimir (o guardar en PDF) con el nombre codificado. El navegador propone
 * como nombre del PDF el título de la página, así que se cambia el título solo
 * mientras dura la impresión y se devuelve después.
 */
export function imprimirComo(nombre: string): void {
  const anterior = document.title;
  document.title = nombre;
  const restaurar = () => {
    document.title = anterior;
    window.removeEventListener("afterprint", restaurar);
  };
  window.addEventListener("afterprint", restaurar);
  window.print();
}
