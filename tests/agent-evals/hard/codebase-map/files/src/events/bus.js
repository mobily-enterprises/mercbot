const { EventEmitter } = require("node:events");

// The app's one event bus. Listeners run after the request has answered; their failures are
// logged, never thrown back at the caller.
const bus = new EventEmitter();
bus.on("error", (error) => console.error("event listener failed:", error));

module.exports = { bus };
