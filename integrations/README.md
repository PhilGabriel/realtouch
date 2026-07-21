# RealTouch integrations

RealTouch's engine (`js/realtouch.js`) and look (`css/realtouch.css`) are
framework-agnostic — they operate on plain DOM and CSS custom properties. These
adapters wire that up idiomatically for the tools you already use.

> **Sound is off by default.** Enable it explicitly per button (`sound` /
> `data-rt-sound` / `sound={true}`). Haptics remain on by default.

## Core building blocks used by every adapter

- **`data-rt-*` attributes** configure a button with zero JavaScript:
  `data-rt-sound`, `data-rt-haptics="false"`, `data-rt-give`,
  `data-rt-max-depth`, `data-rt-max-tilt`, `data-rt-hold-give`,
  `data-rt-hold-time`.
- **`RealTouch.auto(root?)`** enhances every `[data-realtouch]` under `root`
  (default `document`) that isn't enhanced yet. Idempotent.
- **`<script src="js/realtouch.js" data-auto>`** runs `auto()` for you on load.
- **`RealTouch.enhance()`** is idempotent too — one instance per element.

## Astro — `astro/RealTouchButton.astro`

```astro
---
import RealTouchButton from '../integrations/astro/RealTouchButton.astro';
---
<RealTouchButton hue={160} hue2={190} sound onactivate="addToCart()">
  Add to cart
</RealTouchButton>
```

Ships the engine + CSS once per page and re-initialises after
`astro:page-load` (view transitions). Props: `hue`, `hue2`, `radius`, `sound`,
`haptics`, `maxDepth`, `maxTilt`, `holdGive`, `holdTime`, `class`, `onactivate`.

## Tailwind — `tailwind/tailwind-plugin.js`

```js
// tailwind.config.js
module.exports = {
  plugins: [require('./integrations/tailwind/tailwind-plugin')],
};
```

```css
/* your global stylesheet */
@import '../css/realtouch.css';
```

```html
<button class="realtouch rt-mint rounded-full" data-realtouch>Add to cart</button>
<button class="realtouch rt-hue-[280] rt-radius-[100px]" data-realtouch>Subscribe</button>
```

Adds skins (`.rt-mint`, `.rt-sunset`, `.rt-pill`) and theming utilities
(`rt-hue-*`, `rt-hue2-*`, `rt-radius-*`, including arbitrary values).

## Bootstrap — `bootstrap/realtouch-bootstrap.css`

```html
<link rel="stylesheet" href="bootstrap.css" />
<link rel="stylesheet" href="../css/realtouch.css" />
<link rel="stylesheet" href="integrations/bootstrap/realtouch-bootstrap.css" />

<button class="btn btn-primary realtouch" data-realtouch>Save</button>
<button class="btn btn-success realtouch rounded-pill" data-realtouch>Confirm</button>

<script src="js/realtouch.js" data-auto></script>
```

Keep your Bootstrap `.btn btn-*` classes — the adapter maps each contextual
variant (`primary`, `success`, `danger`, …) to a matching RealTouch hue pair.

## Web Component — `webcomponent/real-touch-button.js`

Universal, no framework required (and the recommended path inside Astro too):

```html
<link rel="stylesheet" href="css/realtouch.css" />
<script src="js/realtouch.js"></script>
<script type="module" src="integrations/webcomponent/real-touch-button.js"></script>

<real-touch-button hue="160" hue2="190" sound>Add to cart</real-touch-button>
```

A deliberate press also dispatches a native `click`, so existing handlers just
work. Attributes: `hue`, `hue2`, `radius`, `sound`, `haptics`, `max-depth`,
`max-tilt`, `hold-give`, `hold-time`.

## React — `react/RealTouchButton.jsx`

```jsx
import RealTouchButton from './integrations/react/RealTouchButton';
import '../css/realtouch.css';

<RealTouchButton hue={160} hue2={190} sound onActivate={() => addToCart()}>
  Add to cart
</RealTouchButton>
```

Callbacks: `onPress`, `onRelease`, `onActivate`, `onCancel` — each receives the
event `detail`. Cleans up the engine on unmount.

---

### Events (all adapters)

| Event | Detail | When |
| --- | --- | --- |
| `realtouch:press` | `{ pressure, x, y, area }` | contact begins |
| `realtouch:actuate` | `{ pressure }` | the key gives way at the actuation point |
| `realtouch:release` | `{ held }` (`{ held, cancelled }` if aborted) | contact ends |
| `realtouch:activate` | `{ held }` | a genuine, deliberate press completed |
| `realtouch:cancel` | `{ held }` | interaction aborted (gesture/scroll) — no activation |
