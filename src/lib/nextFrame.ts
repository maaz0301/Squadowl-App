/**
 * Waits until React Native has had a chance to paint the pending render.
 *
 * Building an XLSX/PDF is a long block of *synchronous* JS (pdf-lib, xlsx), so
 * a `setState(loading)` immediately followed by that work never reaches the
 * screen — the button looks dead for the whole export. Awaiting this first lets
 * the spinner show up before the thread is tied up.
 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
