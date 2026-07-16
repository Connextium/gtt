import { createApiServer } from "../dist/server.js";

const server = createApiServer();

export default function handler(request, response) {
  server.emit("request", request, response);
}
