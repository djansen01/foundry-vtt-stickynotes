// Permanent loader. Keeps the manifest stable while core.js is reloaded fresh every boot,
// which avoids the browser-cache trap when iterating on a live server.
const bust = Date.now();
await import(`./core.js?v=${bust}`);
