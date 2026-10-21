// Lazy-mount the animated Tabscape wheel once a [data-tabscape-wheel] element is
// near the viewport (unless reduced motion); mirrors initTabscapeWheel() in next.
import { mountTabscapeWheel } from './TabscapeWheel.js';
function boot() {
    const components = Array.from(document.querySelectorAll('[data-tabscape-wheel]'));
    if (!components.length)
        return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        return;
    const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            mountTabscapeWheel(components);
        }
    }, { rootMargin: '600px' });
    components.forEach((el) => observer.observe(el));
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
}
else {
    boot();
}
