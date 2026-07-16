import { createApiRequestHandler } from "../dist/server.js";

const handleRequest = createApiRequestHandler();

export default async function handler(request, response) {
  await handleRequest(request, response);
}
