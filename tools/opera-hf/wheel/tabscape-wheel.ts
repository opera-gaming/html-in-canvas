// Boot entry for the animated Tabscape wheel on the static html-in-canvas
// landing page. Mirrors `initTabscapeWheel()` in src/ts/main.ts of the next
// repo: lazy-load the wheel module once a [data-tabscape-wheel] element is
// near the viewport, unless the user opted into reduced motion. The
// TabscapeWheel class itself also refuses to boot for reduced motion and for
// touch devices ((hover: none)) — on those the static SVG layer stays visible.
import { mountTabscapeWheel } from './TabscapeWheel';

function boot(): void {
  const components = Array.from(
    document.querySelectorAll('[data-tabscape-wheel]'),
  ) as HTMLElement[];
  if (!components.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        mountTabscapeWheel(components);
      }
    },
    { rootMargin: '600px' },
  );
  components.forEach((el) => observer.observe(el));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
