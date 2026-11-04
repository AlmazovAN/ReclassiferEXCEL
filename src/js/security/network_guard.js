(() => {
  'use strict';

  const blockedMessage = 'Сетевые обращения отключены политикой Reclassifier runtime.';

  function blockedNetworkCall() {
    throw new Error(blockedMessage);
  }

  const blockedConstructors = ['XMLHttpRequest', 'WebSocket', 'EventSource'];
  for (const name of blockedConstructors) {
    if (!(name in globalThis)) continue;
    try {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: false,
        value: class {
          constructor() {
            throw new Error(blockedMessage);
          }
        }
      });
    } catch (_) {
      // CSP still blocks network access if a browser prevents overriding the API.
    }
  }

  if ('fetch' in globalThis) {
    try {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: false,
        value: blockedNetworkCall
      });
    } catch (_) {
      // CSP remains the enforcement layer.
    }
  }

  if (globalThis.navigator && typeof globalThis.navigator.sendBeacon === 'function') {
    try {
      Object.defineProperty(globalThis.navigator, 'sendBeacon', {
        configurable: true,
        writable: false,
        value: blockedNetworkCall
      });
    } catch (_) {
      // CSP remains the enforcement layer.
    }
  }

  globalThis.RECLASSIFIER_NETWORK_POLICY = Object.freeze({
    mode: 'offline-only',
    connectSrc: 'none'
  });
})();
