/*
 * RealTouch Tailwind plugin.
 *
 * The tactile *look* lives in `css/realtouch.css` — import that once in your
 * global stylesheet. This plugin adds the Tailwind-native ergonomics on top:
 *
 *   • theme presets as component classes: `.rt-mint`, `.rt-sunset`, `.rt-pill`
 *   • theming utilities that set the CSS custom properties, so you can write
 *       class="realtouch rt-hue-160 rt-hue2-190 rt-radius-full"
 *     or arbitrary values:
 *       class="realtouch rt-hue-[280] rt-radius-[100px]"
 *
 * Setup (tailwind.config.js):
 *   const realtouch = require('./integrations/tailwind/tailwind-plugin');
 *   module.exports = { plugins: [realtouch] };
 *
 * And in your CSS entry:  @import '../css/realtouch.css';
 */
const plugin = require('tailwindcss/plugin');

module.exports = plugin(function ({ addComponents, matchUtilities, theme }) {
  // Ready-made skins mirroring the demo variants.
  addComponents({
    '.rt-mint': { '--rt-hue-1': '160', '--rt-hue-2': '190' },
    '.rt-sunset': { '--rt-hue-1': '18', '--rt-hue-2': '340' },
    '.rt-pill': { '--rt-radius': '100px', '--rt-hue-1': '280', '--rt-hue-2': '250' },
  });

  // Theming utilities → CSS custom properties the engine/stylesheet read.
  matchUtilities(
    { 'rt-hue': (v) => ({ '--rt-hue-1': String(v) }) },
    { values: theme('realtouchHues'), type: ['number', 'any'] }
  );
  matchUtilities(
    { 'rt-hue2': (v) => ({ '--rt-hue-2': String(v) }) },
    { values: theme('realtouchHues'), type: ['number', 'any'] }
  );
  matchUtilities(
    { 'rt-radius': (v) => ({ '--rt-radius': v }) },
    { values: theme('borderRadius'), type: ['length', 'any'] }
  );
}, {
  theme: {
    // A handful of convenient named hues; arbitrary values always work too.
    realtouchHues: {
      violet: '262',
      indigo: '236',
      mint: '160',
      sky: '200',
      rose: '340',
      amber: '38',
    },
  },
});
