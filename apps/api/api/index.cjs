let handleRequestPromise;

function getHandleRequest() {
  if (!handleRequestPromise) {
    handleRequestPromise = import("../dist/server.js").then((mod) => {
      if (typeof mod.createApiRequestHandler !== "function") {
        throw new Error("api_handler_factory_not_found");
      }
      return mod.createApiRequestHandler();
    });
  }
  return handleRequestPromise;
}

module.exports = async function handler(request, response) {
  try {
    const handleRequest = await getHandleRequest();
    await handleRequest(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "serverless_handler_failed";
    console.error("api/index.cjs bootstrap failure", error);

    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "function_bootstrap_failed", message }));
      return;
    }

    throw error;
  }
};
