// @ts-check
/** A navigation owns all success, error and cleanup effects until replaced. */
(function installRequestContext() {
  function createRequestContext() {
    let generation = 0;
    /** @type {AbortController | null} */
    let active = null;
    function cancel() {
      generation += 1;
      active?.abort();
      active = null;
    }
    function start() {
      cancel();
      const version = generation;
      const controller = new AbortController();
      active = controller;
      return {
        controller,
        version,
        isCurrent: () => generation === version && !controller.signal.aborted,
        finish: () => { if (generation === version) active = null; },
      };
    }
    return { start, cancel };
  }
  Object.assign(globalThis, { CodexWebRequestContext: { createRequestContext } });
}());
