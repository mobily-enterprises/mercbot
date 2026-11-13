class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The last handler: any error becomes a JSON answer.
function handleErrors(error, req, res, next) {
  res.statusCode = error.status || 500;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: error.status ? error.message : "Something went wrong" }));
}

module.exports = { HttpError, handleErrors };
