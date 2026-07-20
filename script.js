const button = document.querySelector(".touch-button");

if (button) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const label = button.querySelector(".touch-button__label");
  const hint = button.querySelector(".touch-button__hint");
  const defaultLabel = label?.textContent ?? "";
  const defaultHint = hint?.textContent ?? "";

  let activePointerId = null;
  let pressStartedAt = 0;
  let pressure = 0;
  let pointerType = "mouse";
  let hasHardwarePressure = false;
  let rafId = 0;

  const setPointerPosition = (event) => {
    const rect = button.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    button.style.setProperty("--pointer-x", `${(x * 100).toFixed(2)}%`);
    button.style.setProperty("--pointer-y", `${(y * 100).toFixed(2)}%`);
    button.style.setProperty("--tilt-y", `${((x - 0.5) * 8).toFixed(2)}deg`);
    button.style.setProperty("--tilt-x", `${((0.5 - y) * 8).toFixed(2)}deg`);
  };

  const getDurationPressure = () => clamp((performance.now() - pressStartedAt) / 550, 0.15, 1);

  const getPressure = (event) => {
    if (pointerType !== "mouse" && typeof event?.pressure === "number" && event.pressure > 0) {
      return clamp(event.pressure, 0.15, 1);
    }

    return getDurationPressure();
  };

  const render = () => {
    button.style.setProperty("--press-depth", pressure.toFixed(3));
    button.style.setProperty("--glow-strength", (0.3 + pressure * 0.7).toFixed(3));

    if (label && hint && pressure > 0.72) {
      label.textContent = "That feels real";
      hint.textContent = pointerType === "mouse" ? "Hold and move the cursor" : "Pressure changes the depth";
    } else if (label && hint && pressure > 0.35) {
      label.textContent = "Keep the touch";
      hint.textContent = pointerType === "mouse" ? "Longer clicks press deeper" : "Gentle pressure stays soft";
    } else if (label && hint) {
      label.textContent = defaultLabel;
      hint.textContent = defaultHint;
    }
  };

  const tick = () => {
    if (hasHardwarePressure) {
      return;
    }

    pressure = getDurationPressure();
    render();

    if (button.classList.contains("is-pressed")) {
      rafId = requestAnimationFrame(tick);
    }
  };

  const stopTick = () => {
    cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const startPress = (event) => {
    activePointerId = event.pointerId;
    pointerType = event.pointerType || "mouse";
    hasHardwarePressure = pointerType !== "mouse" && typeof event.pressure === "number" && event.pressure > 0;
    pressStartedAt = performance.now();
    button.classList.add("is-pressed");

    if (typeof button.setPointerCapture === "function") {
      button.setPointerCapture(event.pointerId);
    }

    setPointerPosition(event);
    pressure = getPressure(event);
    render();
    stopTick();

    if (!hasHardwarePressure) {
      rafId = requestAnimationFrame(tick);
    }
  };

  const updatePress = (event) => {
    if (!button.classList.contains("is-pressed")) {
      setPointerPosition(event);
      return;
    }

    if (event.pointerId !== activePointerId) {
      return;
    }

    setPointerPosition(event);

    if (pointerType !== "mouse" && typeof event.pressure === "number" && event.pressure > 0) {
      pressure = getPressure(event);
      render();
    }
  };

  const endPress = (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    stopTick();
    pressure = clamp(pressure * 0.32, 0, 0.32);
    button.classList.remove("is-pressed");
    render();
    activePointerId = null;
    hasHardwarePressure = false;

    window.setTimeout(() => {
      pressure = 0;
      button.style.setProperty("--pointer-x", "50%");
      button.style.setProperty("--pointer-y", "50%");
      button.style.setProperty("--tilt-x", "0deg");
      button.style.setProperty("--tilt-y", "0deg");
      render();
    }, 110);
  };

  button.addEventListener("pointerenter", setPointerPosition);
  button.addEventListener("pointermove", updatePress);
  button.addEventListener("pointerdown", startPress);
  button.addEventListener("pointerup", endPress);
  button.addEventListener("pointercancel", endPress);
  window.addEventListener("pointermove", updatePress);
  window.addEventListener("pointerup", endPress);
  window.addEventListener("pointercancel", endPress);
  button.addEventListener("pointerleave", (event) => {
    if (!button.classList.contains("is-pressed")) {
      button.style.setProperty("--pointer-x", "50%");
      button.style.setProperty("--pointer-y", "50%");
      button.style.setProperty("--tilt-x", "0deg");
      button.style.setProperty("--tilt-y", "0deg");
    } else {
      updatePress(event);
    }
  });
}
