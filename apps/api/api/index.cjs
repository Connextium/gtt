let handleRequestPromise;

function getHandleRequest() {
  if (!handleRequestPromise) {
    handleRequestPromise = import("../dist/server.js").then((mod) => mod.createApiRequestHandler());
  }
  return handleRequestPromise;
}

module.exports = async function handler(request, response) {
  const handleRequest = await getHandleRequest();
  await handleRequest(request, response);
};
