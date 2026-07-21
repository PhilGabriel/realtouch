/*
 * <real-touch-button> — a framework-agnostic custom element.
 *
 * Works anywhere HTML works (Astro, plain pages, any framework that renders
 * DOM). It uses the light DOM on purpose so the global `css/realtouch.css`
 * (or the Tailwind / Bootstrap adapters) styles it exactly like a plain
 * `.realtouch` button.
 *
 * Usage:
 *   <link rel="stylesheet" href="/css/realtouch.css" />
 *   <script src="/js/realtouch.js"></script>
 *   <script type="module" src="/integrations/webcomponent/real-touch-button.js"></script>
 *
 *   <real-touch-button hue="160" hue2="190">Add to cart</real-touch-button>
 *   <real-touch-button sound haptics="false">Silent hold? no — with sound</real-touch-button>
 *
 * Attributes (all optional):
 *   hue, hue2       highlight- / shadow-side hue for theming
 *   radius          border-radius (any CSS length, e.g. "100px")
 *   sound           presence enables the soft contact sound (off by default)
 *   haptics         "false" disables vibration (on by default)
 *   max-depth, max-tilt, hold-give, hold-time   forwarded to the engine
 *
 * Events: re-dispatches realtouch:press / release / activate / cancel, and
 * mirrors `activate` as a native `click` so it drops into existing handlers.
 */
(function () {
  'use strict';

  const NUM = ['max-depth', 'max-tilt', 'hold-give', 'hold-time', 'give'];
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  class RealTouchButtonElement extends HTMLElement {
    connectedCallback() {
      const RealTouch = window.RealTouch;
      if (!RealTouch) {
        console.warn(
          '<real-touch-button> requires js/realtouch.js to be loaded first.'
        );
        return;
      }
      this.classList.add('realtouch');

      // Theming via CSS custom properties.
      if (this.hasAttribute('hue')) this.style.setProperty('--rt-hue-1', this.getAttribute('hue'));
      if (this.hasAttribute('hue2')) this.style.setProperty('--rt-hue-2', this.getAttribute('hue2'));
      if (this.hasAttribute('radius')) this.style.setProperty('--rt-radius', this.getAttribute('radius'));

      const opts = {
        sound: this.hasAttribute('sound'),
        haptics: this.getAttribute('haptics') !== 'false',
      };
      for (const name of NUM) {
        if (this.hasAttribute(name)) opts[camel(name)] = parseFloat(this.getAttribute(name));
      }

      this._instance = new RealTouch.Button(this, opts);

      // Make it feel like a real button to the rest of the app: a genuine,
      // deliberate press dispatches a native click.
      this._onActivate = () => this.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      this.addEventListener('realtouch:activate', this._onActivate);
    }

    disconnectedCallback() {
      if (this._instance) this._instance.destroy();
      this.removeEventListener('realtouch:activate', this._onActivate);
    }
  }

  if (typeof customElements !== 'undefined' && !customElements.get('real-touch-button')) {
    customElements.define('real-touch-button', RealTouchButtonElement);
  }
})();
