/*
 * RealTouch — a button that feels like a soft, gentle, physical touch.
 *
 * It listens to the raw signals a real finger (or cursor) produces and
 * translates them into the micro-interactions of pressing something soft:
 *
 *   • pressure  — PointerEvent.pressure / Touch.force → how deep it gives
 *   • position  — where the contact lands → the surface tilts toward it
 *   • area      — Touch.radiusX/Y → a broad, soft finger vs. a sharp tap
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

  class RealTouchButton {
    constructor(el, options = {}) {
      this.el = el;
      this.opts = Object.assign(
        {
          maxDepth: 14, // px the surface can sink under full pressure
          maxTilt: 9, // deg the surface tilts toward the contact point
          holdGive: 0.55, // extra sink accumulated by simply holding
          holdTime: 900, // ms to reach full hold-give
          haptics: true,
          sound: true,
        },
        options
      );

      // Animated state (what the eye sees) + velocities for the springs.
      this.s = { depth: 0, tiltX: 0, tiltY: 0, glow: 0, hlx: 50, hly: 50, area: 0.5 };
      this.v = { depth: 0, tiltX: 0, tiltY: 0, glow: 0, hlx: 0, hly: 0, area: 0 };

      // Live targets, updated from raw pointer signals.
      this.t = { depth: 0, tiltX: 0, tiltY: 0, glow: 0, hlx: 50, hly: 50, area: 0.5 };

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
      this._onDown = this._down.bind(this);
      this._onMove = this._move.bind(this);
      this._onUp = this._up.bind(this);

      el.addEventListener('pointerdown', this._onDown);
      el.addEventListener('pointermove', this._onMove);
      el.addEventListener('pointerup', this._onUp);
      el.addEventListener('pointercancel', this._onUp);
      el.addEventListener('pointerleave', this._onLeave.bind(this));

      // Keyboard accessibility: Space/Enter give a synthetic soft press.
      el.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !this.pressed) {
          e.preventDefault();
          this._syntheticDown();
        }
      });
      el.addEventListener('keyup', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && this.pressed) {
          e.preventDefault();
          this._syntheticUp();
        }
      });
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    }

    /* Convert a pointer event into normalized contact geometry. */
    _geometry(e) {
      const r = this.el.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1);
      const y = clamp((e.clientY - r.top) / r.height, 0, 1);
      // Contact area: a fat, soft finger produces a wider radius than a stylus
      // or a mouse. Normalize against button size to a 0..1 "softness".
      let area = 0.5;
      if (e.width && e.height) {
        area = clamp((e.width + e.height) / (r.width + r.height), 0, 1);
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
      this.el.setPointerCapture && this.el.setPointerCapture(e.pointerId);
      this.pressed = true;
      this.pressStart = performance.now();
      this.lastHapticStep = 0;
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
      // Give the release a small overshoot so it springs back softly.
      this.v.depth = -Math.max(this.s.depth, 6) * 3.2;
      this._relax();
      this._haptic('up');
      if (this.opts.sound) softClick('release');
      this.el.classList.remove('is-pressed');
      this._emit('realtouch:release', { held });
      // A real "click" only fires on a genuine, deliberate press.
      this._emit('realtouch:activate', { held });
    }

    _onLeave() {
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
      this._applyTargets({ x: 0.5, y: 0.5, area: 0.5 });
      this._spawnRipple(0.5, 0.5, 0.6, 0.5);
      this._haptic('down');
      if (this.opts.sound) softClick('press');
      this.el.classList.add('is-pressed');
      this._start();
    }

    _syntheticUp() {
      const held = performance.now() - this.pressStart;
      this.pressed = false;
      this.pressure = 0;
      this.v.depth = -Math.max(this.s.depth, 6) * 3.2;
      this._relax();
      this._haptic('up');
      if (this.opts.sound) softClick('release');
      this.el.classList.remove('is-pressed');
      this._emit('realtouch:activate', { held });
    }

    /* Map current pressure + geometry into visual targets. */
    _applyTargets(g) {
      const o = this.opts;
      this.t.depth = this.pressure * o.maxDepth;
      // Tilt the face toward the contact point, as a soft pad would dip.
      this.t.tiltX = (0.5 - g.y) * o.maxTilt;
      this.t.tiltY = (g.x - 0.5) * o.maxTilt;
      this.t.hlx = g.x * 100;
      this.t.hly = g.y * 100;
      this.t.glow = 0.35 + this.pressure * 0.5;
      this.t.area = g.area;
    }

    _relax() {
      this.t.depth = 0;
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
      if (kind === 'down') navigator.vibrate(clamp(6 + this.pressure * 14, 4, 24));
      else if (kind === 'up') navigator.vibrate(4);
      else if (kind === 'step') navigator.vibrate(3);
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
      const s = this.s, t = this.t, v = this.v;
      const near = (a, b, e) => Math.abs(a - b) < e;
      const still =
        near(s.depth, t.depth, 0.05) &&
        near(s.tiltX, t.tiltX, 0.05) &&
        near(s.tiltY, t.tiltY, 0.05) &&
        near(s.glow, t.glow, 0.01) &&
        Math.abs(v.depth) < 0.05;
      return !still;
    }

    _step(dt) {
      const s = this.s, v = this.v;
      let target = this.t.depth;

      // Duration effect: the longer you hold, the more the soft material
      // keeps giving, easing toward an extra sink. This is what makes a long,
      // deliberate press feel different from a quick tap.
      if (this.pressed) {
        const held = performance.now() - this.pressStart;
        const holdT = clamp(held / this.opts.holdTime, 0, 1);
        const eased = 1 - Math.pow(1 - holdT, 3);
        target += eased * this.opts.holdGive * this.opts.maxDepth;
      }

      // Springs: depth is soft & slightly bouncy; tilt & light track quickly.
      [s.depth, v.depth] = spring(s.depth, v.depth, target, 220, 0.72, dt);
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
    }

    destroy() {
      if (this.raf) cancelAnimationFrame(this.raf);
      const el = this.el;
      el.removeEventListener('pointerdown', this._onDown);
      el.removeEventListener('pointermove', this._onMove);
      el.removeEventListener('pointerup', this._onUp);
      el.removeEventListener('pointercancel', this._onUp);
    }
  }

  function enhance(target, options) {
    const els =
      typeof target === 'string'
        ? document.querySelectorAll(target)
        : target instanceof Element
        ? [target]
        : target;
    return Array.from(els).map((el) => new RealTouchButton(el, options));
  }

  const RealTouch = { Button: RealTouchButton, enhance };

  if (typeof module !== 'undefined' && module.exports) module.exports = RealTouch;
  global.RealTouch = RealTouch;
})(typeof window !== 'undefined' ? window : this);
