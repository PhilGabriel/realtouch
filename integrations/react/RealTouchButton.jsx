/*
 * RealTouchButton — a thin React wrapper around the RealTouch engine.
 *
 *   import RealTouchButton from './integrations/react/RealTouchButton';
 *   import '../css/realtouch.css';
 *
 *   <RealTouchButton hue={160} hue2={190} onActivate={() => addToCart()}>
 *     Add to cart
 *   </RealTouchButton>
 *
 * The engine is imported for its side effect of defining `window.RealTouch`.
 * Sound is off by default (pass `sound` to enable it); haptics are on.
 */
import React, { useEffect, useRef } from 'react';
import '../../js/realtouch.js';

export default function RealTouchButton({
  hue,
  hue2,
  radius,
  sound = false,
  haptics = true,
  maxDepth,
  maxTilt,
  holdGive,
  holdTime,
  onActivate,
  onPress,
  onRelease,
  onCancel,
  className = '',
  style,
  children,
  ...rest
}) {
  const ref = useRef(null);
  const instRef = useRef(null);
  const cbRef = useRef({});
  cbRef.current = { onActivate, onPress, onRelease, onCancel };

  // Create / tear down the engine once. Options that affect construction are
  // intentionally read fresh so hot-swapping props re-inits cleanly.
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.RealTouch) return;
    const inst = new window.RealTouch.Button(el, {
      sound,
      haptics,
      ...(maxDepth != null && { maxDepth }),
      ...(maxTilt != null && { maxTilt }),
      ...(holdGive != null && { holdGive }),
      ...(holdTime != null && { holdTime }),
    });
    instRef.current = inst;

    const fwd = (key) => (e) => cbRef.current[key] && cbRef.current[key](e.detail, e);
    const onA = fwd('onActivate');
    const onP = fwd('onPress');
    const onR = fwd('onRelease');
    const onC = fwd('onCancel');
    el.addEventListener('realtouch:activate', onA);
    el.addEventListener('realtouch:press', onP);
    el.addEventListener('realtouch:release', onR);
    el.addEventListener('realtouch:cancel', onC);

    return () => {
      el.removeEventListener('realtouch:activate', onA);
      el.removeEventListener('realtouch:press', onP);
      el.removeEventListener('realtouch:release', onR);
      el.removeEventListener('realtouch:cancel', onC);
      inst.destroy();
    };
  }, [sound, haptics, maxDepth, maxTilt, holdGive, holdTime]);

  const cssVars = {
    ...(hue != null && { '--rt-hue-1': String(hue) }),
    ...(hue2 != null && { '--rt-hue-2': String(hue2) }),
    ...(radius != null && { '--rt-radius': radius }),
    ...style,
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`realtouch ${className}`.trim()}
      style={cssVars}
      {...rest}
    >
      {children}
    </button>
  );
}
