import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const docsFile = path.join(apiRoot, "docs", "business-client-api-docs.html");
const specsModule = path.join(apiRoot, "dist", "openapi", "specs.js");

const redocStatePrefix = "const __redoc_state = ";
const redocStateSuffix = ";\n\n    var container = document.getElementById('redoc');";

const fail = (message) => {
  console.error(`[sync-business-client-docs] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(specsModule)) {
  fail(`Compiled OpenAPI spec not found: ${specsModule}. Run build first.`);
}

if (!fs.existsSync(docsFile)) {
  fail(`Docs file not found: ${docsFile}`);
}

const { businessClientOpenApiSpec } = await import(pathToFileUrl(specsModule));
if (!businessClientOpenApiSpec || typeof businessClientOpenApiSpec !== "object") {
  fail("businessClientOpenApiSpec export missing from compiled specs module.");
}

const html = fs.readFileSync(docsFile, "utf8");
const start = html.indexOf(redocStatePrefix);
if (start < 0) {
  fail("Could not find embedded Redoc state prefix in docs HTML.");
}

const stateStart = start + redocStatePrefix.length;
const end = html.indexOf(redocStateSuffix, stateStart);
if (end < 0) {
  fail("Could not find embedded Redoc state suffix in docs HTML.");
}

let state;
try {
  state = JSON.parse(html.slice(stateStart, end));
} catch (error) {
  fail(`Failed to parse existing Redoc state JSON: ${error instanceof Error ? error.message : String(error)}`);
}

state.spec = state.spec ?? {};
state.spec.data = businessClientOpenApiSpec;

const updatedHtml = `${html.slice(0, start)}${redocStatePrefix}${JSON.stringify(state)}${html.slice(end)}`;
fs.writeFileSync(docsFile, updatedHtml, "utf8");
console.log("[sync-business-client-docs] synced docs/business-client-api-docs.html");

function pathToFileUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return `file://${normalized}`;
}
