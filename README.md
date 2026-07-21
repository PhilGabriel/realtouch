# RealTouch

A real touch button which feels like a soft, gentle touch — on your phone or on the web.

RealTouch turns an ordinary `<button>` into a tactile surface. It reads the raw
signals a real finger (or a cursor) produces and translates them into the
micro-interactions of pressing something soft and physical.

## The feel

The default response is modelled on the **force–travel curve of a rubber-dome
key from an old phone crossed with a soft tactile mechanical switch** (minus the
click): resistance builds as you press, then the key **gives way** at the
actuation point, and finally settles into a **cushioned bottom-out** — a soft,
analog "something just happened".

This isn't keyframed. The key is a mass on a **non-linear spring** integrated
every frame:

```
restoring(y) = K1·y          gentle return spring
             + KBOTTOM·y⁸     progressive cushion near the floor
             − bump(y)        a localized dip = the tactile "give"
```

The dip lowers the resisting force around the actuation point, so under a steady
press the key accelerates *through* it — the analog snap you feel. The curve
stays positive everywhere (monostable), so the key always springs fully back.
Tune it with the `give` option (`0` = linear, `1` = full rubber dome).

## What it reads

| Signal | Source | What it does |
| --- | --- | --- |
| **Pressure** | `PointerEvent.pressure` / `Touch.force` | Pushes the key harder — deeper travel, further into the cushion. |
| **Position** | contact point on the button | The surface tilts *toward* your finger, like a soft pad dipping. |
| **Contact area** | `PointerEvent.width/height` (finger footprint) | A broad, soft finger spreads a wider, gentler highlight and ripple than a sharp tap. |
| **Duration** | time held down | The material keeps creeping the longer you hold — a long, deliberate press feels different from a quick tap. |
| **Release** | pointer up | The dome springs the key back through the give and settles softly — never a hard snap. |

On top of the visuals it adds gentle **haptics** (`navigator.vibrate`) and an
optional warm, low **contact sound** — both soft, never buzzy — and every
motion is driven by a spring integrator on a single `requestAnimationFrame`
loop so it always feels alive. Sound is **off by default**; opt in with
`sound: true` (or `data-rt-sound`).

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
  maxDepth: 14,   // px of key travel at a firm press
  maxTilt: 9,     // deg the face tilts toward the contact point
  holdGive: 0.55, // extra drive accumulated by simply holding (creep)
  holdTime: 900,  // ms to reach full hold-give
  give: 1,        // tactile "give" strength (0 = linear, 1 = full rubber dome)
  haptics: true,  // gentle vibration on supported devices
  sound: false,   // soft contact sound — off by default
});
```

Options can also be set per element via `data-rt-*` attributes (no JS needed):

```html
<button class="realtouch" data-realtouch data-rt-sound data-rt-max-depth="20">
  Press &amp; hold me
</button>
<!-- data-auto enhances every [data-realtouch] on load -->
<script src="js/realtouch.js" data-auto></script>
```

`RealTouch.auto(root?)` enhances all `[data-realtouch]` under `root`, and both
`enhance()` and `auto()` are idempotent (one instance per element).

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
- `realtouch:actuate` — the key crossed the actuation point (the "give") — `{ pressure }`
- `realtouch:release` — `{ held }` (ms); `{ held, cancelled: true }` when aborted
- `realtouch:activate` — a genuine, deliberate press completed — `{ held }`
- `realtouch:cancel` — the interaction was aborted (OS gesture, scroll); no activation fires — `{ held }`

Synthetic keyboard presses (`Space` / `Enter`) emit the same `press` → `release`
→ `activate` sequence as pointer interactions.

## Accessibility

- Fully keyboard-operable: `Space` / `Enter` trigger a synthetic soft press, and
  buttons get `role="button"` and `tabindex` automatically.
- A visible focus ring via `:focus-visible`.
- Honors `prefers-reduced-motion`, falling back to calm, instant feedback.

## Framework integrations

Ready-made adapters for Astro, Tailwind, Bootstrap, a universal Web Component,
and React live in [`integrations/`](integrations/README.md). They all reuse the
same engine and honour the sound-off default.

## Files

```
index.html                     demo + live telemetry
css/realtouch.css              the tactile look
js/realtouch.js                the touch-physics engine (no dependencies)
integrations/                  Astro · Tailwind · Bootstrap · Web Component · React
```

No build step, no dependencies.
