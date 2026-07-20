# RealTouch

A real touch button which feels like a soft, gentle touch — on your phone or on the web.

RealTouch turns an ordinary `<button>` into a tactile surface. It reads the raw
signals a real finger (or a cursor) produces and translates them into the
micro-interactions of pressing something soft and physical.

## What it feels

| Signal | Source | What it does |
| --- | --- | --- |
| **Pressure** | `PointerEvent.pressure` / `Touch.force` | The face sinks deeper the harder you press. |
| **Position** | contact point on the button | The surface tilts *toward* your finger, like a soft pad dipping. |
| **Contact area** | `Touch.radiusX/Y` (finger width) | A broad, soft finger spreads a wider, gentler highlight and ripple than a sharp tap. |
| **Duration** | time held down | The material keeps yielding the longer you hold — a long, deliberate press feels different from a quick tap. |
| **Release** | pointer up | A soft, springy return with a gentle overshoot — never a hard snap. |

On top of the visuals it adds gentle **haptics** (`navigator.vibrate`) and a
warm, low **contact sound** — both soft, never buzzy — and every motion is
driven by a spring integrator on a single `requestAnimationFrame` loop so it
always feels alive.

## Try it

Open `index.html` in a browser. Press and hold the hero button; a live
telemetry panel shows the pressure, hold time, contact area and position it's
reading in real time. Best experienced on a phone or a pressure-sensitive
trackpad/pen, but it feels good with a plain mouse too.

## Usage

```html
<link rel="stylesheet" href="css/realtouch.css" />
<button class="realtouch" data-realtouch>Press &amp; hold me</button>
<script src="js/realtouch.js"></script>
<script>
  RealTouch.enhance('[data-realtouch]');
</script>
```

### Options

```js
RealTouch.enhance('[data-realtouch]', {
  maxDepth: 14,   // px the face can sink under full pressure
  maxTilt: 9,     // deg the face tilts toward the contact point
  holdGive: 0.55, // extra sink accumulated by simply holding
  holdTime: 900,  // ms to reach full hold-give
  haptics: true,  // gentle vibration on supported devices
  sound: true,    // soft contact sound
});
```

### Theming

The engine is theme-agnostic — it only writes CSS custom properties. Recolor a
button by overriding two hues:

```css
.my-button {
  --rt-hue-1: 160; /* highlight-side hue */
  --rt-hue-2: 190; /* shadow-side hue   */
  --rt-radius: 100px;
}
```

### Events

Each button dispatches bubbling `CustomEvent`s:

- `realtouch:press` — `{ pressure, x, y, area }`
- `realtouch:release` — `{ held }` (ms)
- `realtouch:activate` — a genuine, deliberate press completed — `{ held }`

## Accessibility

- Fully keyboard-operable: `Space` / `Enter` trigger a synthetic soft press, and
  buttons get `role="button"` and `tabindex` automatically.
- A visible focus ring via `:focus-visible`.
- Honors `prefers-reduced-motion`, falling back to calm, instant feedback.

## Files

```
index.html          demo + live telemetry
css/realtouch.css   the tactile look
js/realtouch.js     the touch-physics engine (no dependencies)
```

No build step, no dependencies.
