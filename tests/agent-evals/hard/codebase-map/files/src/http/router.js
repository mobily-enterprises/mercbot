// A tiny router: app.use(path?, handler), app.get/post(path, handler), app.listen(port).
const http = require("node:http");

function createRouter() {
  const layers = [];
  const add = (method, path, handler) => layers.push({ method, path, handler });
  const router = {
    layers,
    use(path, handler) {
      if (typeof path === "function") return add(null, "", path);
      if (handler && handler.layers) for (const layer of handler.layers) add(layer.method, path + layer.path, layer.handler);
      else add(null, path, handler);
    },
    get: (path, handler) => add("GET", path, handler),
    post: (path, handler) => add("POST", path, handler),
    patch: (path, handler) => add("PATCH", path, handler),
    listen(port, done) {
      return http.createServer((req, res) => dispatch(layers, req, res)).listen(port, done);
    }
  };
  return router;
}

function dispatch(layers, req, res) {
  let index = 0;
  const next = (error) => {
    const layer = layers[index++];
    if (!layer) return;
    const matches = (!layer.method || layer.method === req.method) && req.url.startsWith(layer.path.replace(/:\w+.*/, ""));
    if (!matches) return next(error);
    if (error) return layer.handler.length === 4 ? layer.handler(error, req, res, next) : next(error);
    if (layer.handler.length === 4) return next();
    Promise.resolve(layer.handler(req, res, next)).catch(next);
  };
  next();
}

module.exports = { createRouter };
