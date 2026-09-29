// Optional views load on first use. They remain in the complete PWA cache.
(function installLazyFeature() {
  function createFeature({ globalName, path, context, getOwner, onError, asyncMethods = [], fallbacks = {}, manualRetry = false }) {
    let renderer, pending, failure, generation = 0, attempt = 0;
    const current = () => renderer ||= globalThis[globalName]?.createRenderer(context);
    async function ensure() {
      if (current()) return renderer;
      pending ||= globalThis.CodexWebNetworkRecovery.bounded(
        () => import(path + (++attempt === 1 ? '' : `&attempt=${attempt}`)), { timeoutMs: 12000 },
      ).catch(error => { pending = null; throw error; });
      await pending;
      if (!current()) throw new Error('Could not load this view. Try again.');
      return renderer;
    }
    return new Proxy({ ensure }, {
      get(target, name) {
        if (name === 'ensure') return target.ensure;
        if (name === 'retry') return () => { failure = null; generation++; };
        return (...args) => {
          const owner = getOwner(), ticket = generation;
          if (manualRetry && failure?.owner === owner) {
            if (asyncMethods.includes(name)) onError(failure.error);
            return fallbacks[name] ?? null;
          }
          if (current()) return renderer[name](...args);
          if (!asyncMethods.includes(name)) return fallbacks[name] ?? '';
          return ensure().then(view => owner === getOwner() && ticket === generation ? view[name](...args) : null)
            .catch(error => {
              if (owner === getOwner() && ticket === generation) {
                if (manualRetry) failure = { owner, error };
                onError(error);
              }
              return null;
            });
        };
      },
    });
  }
  function loadStylesheet(path) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      const finish = error => {
        clearTimeout(timer);
        link.onload = link.onerror = null;
        if (error) { link.remove(); reject(error); } else resolve();
      };
      const timer = setTimeout(() => finish(new Error('Could not load this view. Try again.')), 12000);
      link.rel = 'stylesheet'; link.href = path;
      link.onload = () => finish();
      link.onerror = () => finish(new Error('Could not load this view. Try again.'));
      document.head.appendChild(link);
    });
  }
  globalThis.CodexWebLazyFeature = { createFeature, loadStylesheet };
}());
