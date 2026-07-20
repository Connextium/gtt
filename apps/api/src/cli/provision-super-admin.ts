import { config as loadEnv } from "dotenv";

loadEnv({ path: "../../.env.local", quiet: true });
loadEnv({ path: "../../.env", quiet: true });
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
loadEnv({ quiet: true });

interface CliArgs {
  email?: string;
  displayName?: string;
  apiUrl: string;
  internalAccessBaseUrl?: string;
}

const args = process.argv.slice(2);

const readArg = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const parsed: CliArgs = {
  email: readArg("--email") ?? process.env.GTT_SUPER_ADMIN_EMAIL,
  displayName: readArg("--display-name") ?? process.env.GTT_SUPER_ADMIN_DISPLAY_NAME,
  apiUrl: readArg("--api-url") ?? process.env.GTT_API_BASE_URL ?? "http://localhost:4000",
  internalAccessBaseUrl: readArg("--internal-access-url") ?? process.env.INTERNAL_OPERATION_BASE_URL
};

const token = readArg("--bootstrap-token") ?? process.env.GTT_BOOTSTRAP_TOKEN;

if (!token) {
  console.error("GTT_BOOTSTRAP_TOKEN is required.");
  process.exit(1);
}

if (!parsed.email) {
  console.error("Provide --email or GTT_SUPER_ADMIN_EMAIL.");
  process.exit(1);
}

let response: Response;
try {
  response = await fetch(`${parsed.apiUrl.replace(/\/$/, "")}/admin/bootstrap/super-admin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bootstrap-token": token
    },
    body: JSON.stringify({
      email: parsed.email,
      displayName: parsed.displayName ?? "Super Admin",
      internalAccessBaseUrl: parsed.internalAccessBaseUrl
    })
  });
} catch (error) {
  console.error(`Could not reach API at ${parsed.apiUrl}. Start it with: npm run api:dev`);
  if (error instanceof Error) console.error(error.message);
  process.exit(1);
}

const body = await response.json().catch(() => ({ error: "invalid_api_response" })) as unknown;

if (!response.ok) {
  if (typeof body === "object" && body && "error" in body && body.error === "api_key_required") {
    console.error("Bootstrap endpoint returned api_key_required. Restart the API server so it serves the public /admin/bootstrap/super-admin route.");
    console.error("Run: npm run api:dev");
  }
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(body, null, 2));
