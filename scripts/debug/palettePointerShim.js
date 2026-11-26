/**
 * Debug shim for driving the in-scene menu from a browser where pointer lock is unavailable (headless or embedded preview browsers).
 * The desktop menu cursor moves only from pointer-lock mouse deltas, so this fakes the lock on the canvas and exposes helpers on `window`:
 *   __mv(dx, dy)  move the menu cursor by mouse pixels      __click()  a left click (down, up, click)   __rightClick()  a right click
 *   __down() / __up()  hold and release the left button     __wheel(dy)  turn the mouse wheel (positive scrolls down)
 *   __sleep(ms)   wait, for use between steps
 * Use from the dev server page, in the page context: `await import("/scripts/debug/palettePointerShim.js")`. Debugging only; never imported by the app.
 */
const canvas = document.querySelector("canvas");
if (!canvas) throw new Error("palettePointerShim: no canvas on the page yet");

Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get: () => canvas });
canvas.requestPointerLock = () => {
  document.dispatchEvent(new Event("pointerlockchange"));
  return Promise.resolve();
};
document.exitPointerLock = () => {};
document.dispatchEvent(new Event("pointerlockchange"));

const up = () => {
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
};
window.__mv = (dx, dy) => canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: dx, movementY: dy }));
window.__down = () => canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
window.__up = up;
window.__click = () => {
  window.__down();
  setTimeout(() => {
    up();
    canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  }, 80);
};
// A right click: opens the menu of the aimed object, or goes back a page while the menu is open.
window.__rightClick = () => {
  canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2 }));
  canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
  canvas.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 2 }));
};
window.__wheel = (dy) => canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: dy }));
window.__sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The pause card asks for a click to lock the pointer; with the lock faked it only covers the menu.
const pauseCard = document.querySelector(".pause-card-overlay");
if (pauseCard) pauseCard.style.display = "none";
