const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/js/security/network_guard.js', 'utf8');

const context = {
  fetch() { return 'network'; },
  XMLHttpRequest: class XMLHttpRequest {},
  WebSocket: class WebSocket {},
  EventSource: class EventSource {},
  navigator: {
    sendBeacon() { return true; }
  },
  Error,
  Object,
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'network_guard.js' });

assert.strictEqual(context.RECLASSIFIER_NETWORK_POLICY.mode, 'offline-only');
assert.strictEqual(context.RECLASSIFIER_NETWORK_POLICY.connectSrc, 'none');
assert.throws(() => context.fetch('https://example.com'));
assert.throws(() => new context.XMLHttpRequest());
assert.throws(() => new context.WebSocket('wss://example.com'));
assert.throws(() => new context.EventSource('https://example.com'));
assert.throws(() => context.navigator.sendBeacon('https://example.com', 'x'));

console.log('Offline network guard: OK');
