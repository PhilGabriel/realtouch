/*
 * RealTouch — a button that feels like a soft, gentle, physical touch.
 *
 * It listens to the raw signals a real finger (or cursor) produces and
 * translates them into the micro-interactions of pressing something soft:
 *
 *   • pressure  — PointerEvent.pressure / Touch.force → how deep it gives
 *   • position  — where the contact lands → the surface tilts toward it
 *   • area      — PointerEvent.width/height → a broad, soft finger vs. a sharp tap
 *   • duration  — how long you hold → the material keeps yielding, then relaxes
 *   • release   — a soft, springy return, never a hard snap
 *
 * Everything is driven by a spring integrator on a single rAF loop so the
 * motion always feels alive and continuous rather than keyframed.
 */
(function (global) {
  'use strict';

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* A tiny critically-damped-ish spring. Keeps motion soft and organic. */
  function spring(current, velocity, target, stiffness, damping, dt) {
    const force = (target - current) * stiffness;
    const nextVel = (velocity + force * dt) * Math.pow(damping, dt * 60);
    return [current + nextVel * dt, nextVel];
  }

  const SUPPORTS_VIBRATE = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  /* A shared, lazily-created audio context for the soft contact sound. */
  let audioCtx = null;
  function softClick(kind) {
    if (typeof window === 'undefined') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      // Press: low, warm thud. Release: a touch brighter and shorter.
      const base = kind === 'press' ? 150 : 220;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 0.6, t + 0.08);
      const peak = kind === 'press' ? 0.06 : 0.035;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.14);
    } catch (_) {
      /* audio is a nicety, never a requirement */
    }
  }

  const DEFAULTS = {
    maxDepth: 14, // px of key travel at a firm press
    maxTilt: 9, // deg the surface tilts toward the contact point
    holdGive: 0.55, // extra drive accumulated by simply holding (creep)
    holdTime: 900, // ms to reach full hold-give
    give: 1, // strength of the tactile "give" (0 = linear, 1 = full rubber dome)
    haptics: true, // gentle vibration on supported devices
    sound: false, // soft contact sound — off by default, opt in explicitly
  };

  /*
   * The feel: a rubber-dome key from an old phone crossed with a soft tactile
   * mechanical switch (minus the click). It comes from the FORCE–TRAVEL curve,
   * not from keyframes. As you press, resistance builds, then *gives way* at the
   * actuation point (the dome collapses / the switch actuates), then settles
   * softly into a cushioned bottom-out. We model the key as a mass on a
   * non-linear spring and integrate it every frame:
   *
   *   restoring(y) = K1·y            gentle return spring
   *                + KBOTTOM·y^8     progressive cushion near the bottom
   *                − bump(y)         a localized dip = the tactile "give"
   *
   * The dip lowers the resisting force around the actuation point, so under a
   * steady press the key accelerates through it — that's the analog snap you
   * feel. The curve stays positive everywhere (monostable), so the key always
   * springs fully back on release.
   */
  const DOME = {
    K1: 72,
    KB: 22, // bump amplitude — scaled by opts.give
    YC: 0.4, // actuation point (normalized travel)
    W: 0.11, // bump width
    KBOTTOM: 340,
    POW: 8,
    MASS: 0.05,
    DAMP: 56, // slightly under-damped → a small, lively settle
    PUSH: 110, // press-force gain
  };

  function domeRestoring(y, give) {
    const bump = DOME.KB * give * Math.exp(-((y - DOME.YC) * (y - DOME.YC)) / (2 * DOME.W * DOME.W));
    const bottom = DOME.KBOTTOM * Math.pow(clamp(y, 0, 1), DOME.POW);
    return DOME.K1 * y + bottom - bump;
  }

  class RealTouchButton {
    constructor(el, options = {}) {
      this.el = el;
      this.opts = Object.assign({}, DEFAULTS, options);
      // Make (re-)enhancement idempotent: one instance per element.
      el.__realtouch = this;

      // Animated state (what the eye sees) + velocities for the springs.
      this.s = { depth: 0, tiltX: 0, tiltY: 0, glow: 0, hlx: 50, hly: 50, area: 0.5 };
      this.v = { depth: 0, tiltX: 0, tiltY: 0, glow: 0, hlx: 0, hly: 0, area: 0 };

      // Live targets, updated from raw pointer signals.
      this.t = { depth: 0, tiltX: 0, tiltY: 0, glow: 0, hlx: 50, hly: 50, area: 0.5 };

      // Physical key travel (the rubber-dome model): normalized position + vel.
      this.y = 0;
      this.vy = 0;
      this._actuated = false;

      this.pressed = false;
      this.pressStart = 0;
      this.pressure = 0;
      this.lastHapticStep = 0;
      this.raf = null;
      this._running = false;

      this._buildDom();
      this._bind();
    }

    /* Wrap the button's label so we can layer highlight + ripple beneath it. */
    _buildDom() {
      const el = this.el;
      el.classList.add('realtouch');
      if (!el.querySelector('.realtouch__label')) {
        const label = document.createElement('span');
        label.className = 'realtouch__label';
        while (el.firstChild) label.appendChild(el.firstChild);
        el.appendChild(label);
      }
      this.highlight = document.createElement('span');
      this.highlight.className = 'realtouch__highlight';
      this.rippleLayer = document.createElement('span');
      this.rippleLayer.className = 'realtouch__ripples';
      el.insertBefore(this.rippleLayer, el.firstChild);
      el.insertBefore(this.highlight, el.firstChild);

      // Never let native selection / callouts break the illusion.
      el.style.touchAction = 'none';
      el.style.webkitUserSelect = 'none';
      el.style.userSelect = 'none';
    }

    _bind() {
      const el = this.el;
      // All handlers are stored on `this` so destroy() can remove every one.
      this._onDown = this._down.bind(this);
      this._onMove = this._move.bind(this);
      this._onUp = this._up.bind(this);
      this._onCancel = this._cancel.bind(this);
      this._onLeaveH = this._leave.bind(this);
      // Keyboard accessibility: Space/Enter give a synthetic soft press.
      this._onKeyDown = (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !this.pressed) {
          e.preventDefault();
          this._syntheticDown();
        }
      };
      this._onKeyUp = (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && this.pressed) {
          e.preventDefault();
          this._syntheticUp();
        }
      };

      el.addEventListener('pointerdown', this._onDown);
      el.addEventListener('pointermove', this._onMove);
      el.addEventListener('pointerup', this._onUp);
      el.addEventListener('pointercancel', this._onCancel);
      el.addEventListener('pointerleave', this._onLeaveH);
      el.addEventListener('keydown', this._onKeyDown);
      el.addEventListener('keyup', this._onKeyUp);

      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    }

    /* Convert a pointer event into normalized contact geometry. */
    _geometry(e) {
      const r = this.el.getBoundingClientRect();
      // Guard against a not-yet-laid-out / hidden element (0 size) so we never
      // divide by zero and leak NaN into the CSS custom properties.
      const w = r.width || 1;
      const h = r.height || 1;
      const x = clamp((e.clientX - r.left) / w, 0, 1);
      const y = clamp((e.clientY - r.top) / h, 0, 1);
      // Contact area: a fat, soft finger produces a wider contact than a stylus
      // or a mouse. Normalize against button size to a 0..1 "softness".
      let area = 0.5;
      if (e.width && e.height) {
        area = clamp((e.width + e.height) / (w + h), 0, 1);
      }
      return { x, y, area, rect: r };
    }

    /* Best available pressure for the device, normalized 0..1. */
    _readPressure(e) {
      // Real pens/trackpads report continuous pressure. Touch reports force.
      // A plain mouse reports 0.5 while down — we treat that as a firm default
      // and let click *duration* carry the expressiveness instead.
      if (typeof e.pressure === 'number' && e.pressure > 0) {
        if (e.pointerType === 'mouse' && e.pressure === 0.5) return 0.5;
        return clamp(e.pressure, 0, 1);
      }
      return 0.5;
    }

    _down(e) {
      // Capture so we keep tracking the finger even if it slides off the edge.
      try {
        this.el.setPointerCapture && this.el.setPointerCapture(e.pointerId);
      } catch (_) {
        /* no active pointer (e.g. synthetic events) — safe to ignore */
      }
      this.pressed = true;
      this.pressStart = performance.now();
      this.lastHapticStep = 0;
      this._actuated = false;
      const g = this._geometry(e);
      this.pressure = this._readPressure(e);
      this._applyTargets(g);
      this._spawnRipple(g.x, g.y, this.pressure, g.area);
      this._haptic('down');
      if (this.opts.sound) softClick('press');
      this.el.classList.add('is-pressed');
      this._emit('realtouch:press', { pressure: this.pressure, x: g.x, y: g.y, area: g.area });
      this._start();
    }

    _move(e) {
      const g = this._geometry(e);
      if (this.pressed) {
        this.pressure = this._readPressure(e);
        this._applyTargets(g);
        this._maybeHapticStep();
      } else {
        // Even before pressing, the specular highlight follows the cursor so
        // the surface looks lit and inviting — a subtle hover life.
        this.t.hlx = g.x * 100;
        this.t.hly = g.y * 100;
        this.t.glow = 0.28;
        this.t.tiltX = (0.5 - g.y) * this.opts.maxTilt * 0.35;
        this.t.tiltY = (g.x - 0.5) * this.opts.maxTilt * 0.35;
        this._start();
      }
    }

    _up(e) {
      if (!this.pressed) return;
      const held = performance.now() - this.pressStart;
      this.pressed = false;
      this.pressure = 0;
      // Drive drops to 0 → the dome springs the key back on its own curve.
      this._relax();
      this._haptic('up');
      if (this.opts.sound) softClick('release');
      this.el.classList.remove('is-pressed');
      this._emit('realtouch:release', { held });
      // A real "click" only fires on a genuine, deliberate press.
      this._emit('realtouch:activate', { held });
    }

    /* An aborted interaction (OS gesture, scroll, focus loss): release the
     * visuals softly but never fire a click-like activation. */
    _cancel() {
      if (!this.pressed) return;
      const held = performance.now() - this.pressStart;
      this.pressed = false;
      this.pressure = 0;
      this._relax();
      this._haptic('up');
      this.el.classList.remove('is-pressed');
      this._emit('realtouch:release', { held, cancelled: true });
      this._emit('realtouch:cancel', { held });
      this._start();
    }

    _leave() {
      if (!this.pressed) {
        this.t.glow = 0;
        this.t.tiltX = 0;
        this.t.tiltY = 0;
      }
    }

    _syntheticDown() {
      this.pressed = true;
      this.pressStart = performance.now();
      this.pressure = 0.6;
      this._actuated = false;
      this._applyTargets({ x: 0.5, y: 0.5, area: 0.5 });
      this._spawnRipple(0.5, 0.5, 0.6, 0.5);
      this._haptic('down');
      if (this.opts.sound) softClick('press');
      this.el.classList.add('is-pressed');
      // Emit the same events as a pointer press, for a consistent API.
      this._emit('realtouch:press', { pressure: this.pressure, x: 0.5, y: 0.5, area: 0.5 });
      this._start();
    }

    _syntheticUp() {
      const held = performance.now() - this.pressStart;
      this.pressed = false;
      this.pressure = 0;
      this._relax();
      this._haptic('up');
      if (this.opts.sound) softClick('release');
      this.el.classList.remove('is-pressed');
      // Mirror the pointer release: release first, then activate.
      this._emit('realtouch:release', { held });
      this._emit('realtouch:activate', { held });
    }

    /* Map current pressure + geometry into visual targets. Key travel itself
     * is handled by the physical dome model in _step; here we only aim the
     * tilt and the (matte, understated) highlight at the contact point. */
    _applyTargets(g) {
      const o = this.opts;
      // Tilt the face toward the contact point, as a soft pad would dip.
      this.t.tiltX = (0.5 - g.y) * o.maxTilt;
      this.t.tiltY = (g.x - 0.5) * o.maxTilt;
      this.t.hlx = g.x * 100;
      this.t.hly = g.y * 100;
      // Rubber is matte, not glossy — keep the specular restrained.
      this.t.glow = 0.24 + this.pressure * 0.32;
      this.t.area = g.area;
    }

    _relax() {
      this.t.tiltX = 0;
      this.t.tiltY = 0;
      this.t.glow = 0;
    }

    _spawnRipple(nx, ny, pressure, area) {
      const dot = document.createElement('span');
      dot.className = 'realtouch__ripple';
      dot.style.left = nx * 100 + '%';
      dot.style.top = ny * 100 + '%';
      // A softer/broader contact spreads a wider, gentler ripple.
      const scale = 1 + pressure * 1.4 + area * 0.8;
      dot.style.setProperty('--rt-ripple-scale', scale.toFixed(2));
      this.rippleLayer.appendChild(dot);
      dot.addEventListener('animationend', () => dot.remove());
    }

    _haptic(kind) {
      if (!this.opts.haptics || !SUPPORTS_VIBRATE) return;
      // Gentle, short pulses — a soft tick, never a buzz.
      if (kind === 'down') navigator.vibrate(clamp(4 + this.pressure * 8, 3, 14));
      // The actuation "give" — the crisp little moment the key engages.
      else if (kind === 'actuate') navigator.vibrate(clamp(4 + this.pressure * 8, 3, 12));
      else if (kind === 'up') navigator.vibrate(3);
      else if (kind === 'step') navigator.vibrate(2);
    }

    /* While holding harder, emit faint stepped ticks as the material yields. */
    _maybeHapticStep() {
      const step = Math.floor(this.pressure * 4);
      if (step > this.lastHapticStep) {
        this.lastHapticStep = step;
        this._haptic('step');
      }
    }

    _emit(name, detail) {
      this.el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }

    _start() {
      if (this._running) return;
      this._running = true;
      this._last = performance.now();
      const tick = (now) => {
        const dt = clamp((now - this._last) / 1000, 0, 0.05);
        this._last = now;
        this._step(dt);
        // Keep animating while pressed or while still settling toward rest.
        if (this.pressed || this._isMoving()) {
          this.raf = requestAnimationFrame(tick);
        } else {
          this._running = false;
          this._render(); // final rest frame
        }
      };
      this.raf = requestAnimationFrame(tick);
    }

    _isMoving() {
      const s = this.s, t = this.t;
      const near = (a, b, e) => Math.abs(a - b) < e;
      // The key is at rest, and tilt/glow have settled to their targets.
      const keyStill = this.y < 0.002 && Math.abs(this.vy) < 0.02;
      const still =
        keyStill &&
        near(s.tiltX, t.tiltX, 0.05) &&
        near(s.tiltY, t.tiltY, 0.05) &&
        near(s.glow, t.glow, 0.01);
      return !still;
    }

    _step(dt) {
      const s = this.s, v = this.v, o = this.opts;

      // ---- Rubber-dome key travel: the tactile "give" ---------------------
      // Drive = how hard the key is pushed right now. Pressure sets the
      // baseline; holding adds a slow creep so a long press keeps yielding.
      let drive = 0;
      if (this.pressed) {
        const held = performance.now() - this.pressStart;
        const holdT = clamp(held / o.holdTime, 0, 1);
        const eased = 1 - Math.pow(1 - holdT, 3);
        drive = this.pressure + eased * o.holdGive;
      }
      const give = clamp(o.give, 0, 1);
      const Fpush = DOME.PUSH * drive;
      // Integrate the mass-on-nonlinear-spring in fixed ~1ms substeps, so the
      // stiff bottom-out stays stable no matter the frame rate.
      const nsub = Math.max(1, Math.ceil(dt / 0.001));
      const h = dt / nsub;
      for (let i = 0; i < nsub; i++) {
        const a = (Fpush - domeRestoring(this.y, give)) / DOME.MASS - DOME.DAMP * this.vy;
        this.vy += a * h;
        this.y += this.vy * h;
        if (this.y < 0) {
          this.y = 0;
          if (this.vy < 0) this.vy = 0;
        }
      }
      // The moment travel crosses the actuation point on the way down: fire a
      // soft tick + event, once per press — the analog "it engaged" feeling.
      if (this.pressed && !this._actuated && this.y >= DOME.YC && this.vy > 0) {
        this._actuated = true;
        this._haptic('actuate');
        this._emit('realtouch:actuate', { pressure: this.pressure });
      }
      if (!this.pressed && this.y < DOME.YC * 0.6) this._actuated = false;
      s.depth = this.y * o.maxDepth;

      // ---- Tilt / light track the finger quickly --------------------------
      [s.tiltX, v.tiltX] = spring(s.tiltX, v.tiltX, this.t.tiltX, 180, 0.7, dt);
      [s.tiltY, v.tiltY] = spring(s.tiltY, v.tiltY, this.t.tiltY, 180, 0.7, dt);
      [s.glow, v.glow] = spring(s.glow, v.glow, this.t.glow, 160, 0.8, dt);
      s.hlx = lerp(s.hlx, this.t.hlx, clamp(dt * 14, 0, 1));
      s.hly = lerp(s.hly, this.t.hly, clamp(dt * 14, 0, 1));
      s.area = lerp(s.area, this.t.area, clamp(dt * 8, 0, 1));

      this._render();
    }

    _render() {
      const s = this.s;
      const el = this.el;
      // The face sinks (translateZ) and tips toward the finger, and scales
      // down a hair as it compresses — the geometry of pressing something soft.
      const scale = 1 - clamp(s.depth / this.opts.maxDepth, 0, 1) * 0.035;
      el.style.setProperty('--rt-depth', s.depth.toFixed(2) + 'px');
      el.style.setProperty('--rt-tiltx', s.tiltX.toFixed(2) + 'deg');
      el.style.setProperty('--rt-tilty', s.tiltY.toFixed(2) + 'deg');
      el.style.setProperty('--rt-scale', scale.toFixed(3));
      el.style.setProperty('--rt-glow', s.glow.toFixed(3));
      el.style.setProperty('--rt-hlx', s.hlx.toFixed(2) + '%');
      el.style.setProperty('--rt-hly', s.hly.toFixed(2) + '%');
      // Softer/broader contact → a larger, more diffuse specular highlight.
      el.style.setProperty('--rt-hl-size', (60 + s.area * 90).toFixed(1) + '%');
      // Normalized key travel (0..1) and how firmly it's into the cushioned
      // bottom-out — CSS uses these for the matte "give" and the firm floor.
      el.style.setProperty('--rt-press', clamp(this.y, 0, 1).toFixed(3));
      el.style.setProperty('--rt-cushion', clamp((this.y - 0.55) / 0.35, 0, 1).toFixed(3));
    }

    destroy() {
      if (this.raf) cancelAnimationFrame(this.raf);
      const el = this.el;
      el.removeEventListener('pointerdown', this._onDown);
      el.removeEventListener('pointermove', this._onMove);
      el.removeEventListener('pointerup', this._onUp);
      el.removeEventListener('pointercancel', this._onCancel);
      el.removeEventListener('pointerleave', this._onLeaveH);
      el.removeEventListener('keydown', this._onKeyDown);
      el.removeEventListener('keyup', this._onKeyUp);
      if (el.__realtouch === this) delete el.__realtouch;
    }
  }

  const BOOL = (v) => v === '' || v === 'true' || v === '1';

  /* Read per-element options from data-rt-* attributes so frameworks and
   * plain markup can configure a button without writing any JavaScript:
   *   <button data-realtouch data-rt-sound data-rt-max-depth="20"> */
  function optionsFromDataset(el) {
    const d = el.dataset || {};
    const o = {};
    if ('rtSound' in d) o.sound = BOOL(d.rtSound);
    if ('rtHaptics' in d) o.haptics = BOOL(d.rtHaptics);
    if ('rtMaxDepth' in d) o.maxDepth = parseFloat(d.rtMaxDepth);
    if ('rtMaxTilt' in d) o.maxTilt = parseFloat(d.rtMaxTilt);
    if ('rtHoldGive' in d) o.holdGive = parseFloat(d.rtHoldGive);
    if ('rtHoldTime' in d) o.holdTime = parseFloat(d.rtHoldTime);
    if ('rtGive' in d) o.give = parseFloat(d.rtGive);
    return o;
  }

  function enhance(target, options) {
    if (target == null) {
      throw new TypeError(
        'RealTouch.enhance(target): target is required — pass a selector string, ' +
          'an Element, or an iterable of Elements.'
      );
    }
    const els =
      typeof target === 'string'
        ? document.querySelectorAll(target)
        : target instanceof Element
        ? [target]
        : target;
    return Array.from(els).map((el) => {
      // Already enhanced? Return the existing instance instead of doubling up.
      if (el.__realtouch) return el.__realtouch;
      // Per-element data-* options are the base; an explicit options object wins.
      return new RealTouchButton(el, Object.assign(optionsFromDataset(el), options));
    });
  }

  /* Enhance every [data-realtouch] under `root` that isn't enhanced yet.
   * Framework adapters and the opt-in auto-init below both use this. */
  function auto(root) {
    return enhance((root || document).querySelectorAll('[data-realtouch]'));
  }

  const RealTouch = { Button: RealTouchButton, enhance, auto, defaults: DEFAULTS };

  // Opt-in zero-JS init: <script src="realtouch.js" data-auto></script>
  if (typeof document !== 'undefined') {
    const self = document.currentScript;
    if (self && self.hasAttribute('data-auto')) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => auto());
      } else {
        auto();
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = RealTouch;
  global.RealTouch = RealTouch;
})(typeof window !== 'undefined' ? window : this);
