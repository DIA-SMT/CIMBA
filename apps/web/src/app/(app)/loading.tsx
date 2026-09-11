/**
 * EL ESQUELETO DE TODA LA SECCIÓN.
 *
 * Sin esto, tocar un ítem del menú no producía NINGUNA señal: la pantalla
 * anterior se quedaba quieta —mismo contenido, mismo scroll, sin spinner— y
 * recién cuando el servidor terminaba cambiaba de golpe. Todas estas páginas
 * son server components que consultan Postgres, así que esa espera dura de
 * verdad; el usuario tocaba dos veces creyendo que no había registrado.
 *
 * Es NEUTRO a propósito: lo cubre todo, incluido /mapa, que es un MapLibre a
 * pantalla completa. Un esqueleto con forma de tabla ahí sería peor que nada.
 * Las pantallas con una forma muy propia pueden poner su loading.tsx al lado
 * de su page.tsx y este queda de piso.
 */
export default function Cargando() {
  return (
    <div className="mx-auto max-w-6xl p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando la pantalla…</span>
      <div className="animate-pulse space-y-4">
        <div className="h-7 w-64 rounded-lg bg-panel-2" />
        <div className="h-4 w-96 max-w-full rounded bg-panel-2" />
        <div className="flex flex-wrap gap-2 pt-2">
          {[64, 88, 72, 96].map((w, i) => (
            <div key={i} className="h-8 rounded-lg bg-panel-2" style={{ width: w }} />
          ))}
        </div>
        <div className="space-y-2 pt-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-12 rounded-xl border border-borde bg-panel-2"
              // Se apagan hacia abajo: el ojo entiende "hay más y está llegando"
              // en vez de leer seis bloques iguales como un error de render.
              style={{ opacity: 1 - i * 0.13 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
