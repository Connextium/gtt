import { createClient } from "@supabase/supabase-js";
import { resolveSelfRegistrationRoute, selfRegistrationRoutes, type Navigate } from "./features/business/selfRegistrationRouteConfig.js";
import { useSupabaseSession } from "./features/business/shared/useSupabaseSession.js";

export { selfRegistrationRoutes };

const supabase = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return undefined;
  return createClient(url, anonKey);
})();

async function logoutBusinessUser(navigate: Navigate) {
  await supabase?.auth.signOut();
  navigate("/sign-in");
}

export function SelfRegistrationRouter({ path, navigate }: { path: string; navigate: Navigate }) {
  const { loading, session } = useSupabaseSession(supabase);

  return resolveSelfRegistrationRoute({
    loading,
    navigate,
    onLogout: () => logoutBusinessUser(navigate),
    path,
    session,
    supabase
  });
}

