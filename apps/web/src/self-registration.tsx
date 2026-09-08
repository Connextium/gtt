import { resolveSelfRegistrationRoute, selfRegistrationRoutes, type Navigate } from "./features/business/selfRegistrationRouteConfig.js";
import { apiRequest } from "./features/business/shared/apiClient.js";
import { useBusinessAuthSession } from "./features/business/shared/useSupabaseSession.js";

export { selfRegistrationRoutes };

async function logoutBusinessUser(navigate: Navigate, clearSession: () => void) {
  try {
    await apiRequest("/business/auth/sign-out", { method: "POST" });
  } catch {
    // Sign-out is stateless server-side; clear local session even if this request fails.
  }
  clearSession();
  navigate("/sign-in");
}

export function SelfRegistrationRouter({ path, navigate }: { path: string; navigate: Navigate }) {
  const { loading, session, setSession, clearSession } = useBusinessAuthSession();

  return resolveSelfRegistrationRoute({
    loading,
    navigate,
    onAuthenticated: setSession,
    onLogout: () => logoutBusinessUser(navigate, clearSession),
    path,
    session
  });
}

