import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./apiClient.js";

const BUSINESS_AUTH_STORAGE_KEY = "gtt_business_auth_session";

export type BusinessJwtSession = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
  refresh_token?: string;
  user: {
    id: string;
    email?: string;
  };
};

const readStoredSession = (): BusinessJwtSession | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(BUSINESS_AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BusinessJwtSession;
    if (!parsed?.access_token || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeStoredSession = (session: BusinessJwtSession | null): void => {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(BUSINESS_AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(BUSINESS_AUTH_STORAGE_KEY, JSON.stringify(session));
};

export function useBusinessAuthSession() {
  const [session, setSessionState] = useState<BusinessJwtSession | null>(() => readStoredSession());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(Boolean(readStoredSession()));
  }, []);

  const clearSession = useCallback(() => {
    setSessionState(null);
    writeStoredSession(null);
  }, []);

  const setSession = useCallback((nextSession: BusinessJwtSession) => {
    setSessionState(nextSession);
    writeStoredSession(nextSession);
  }, []);

  const accessToken = session?.access_token;

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    const expectedToken = accessToken;
    apiRequest<{ user: { authUserId: string; email: string } }>("/business/auth/me", {
      token: expectedToken
    })
      .then((result) => {
        if (!active) return;
        setSessionState((current) => {
          if (!current || current.access_token !== expectedToken) return current;
          const nextEmail = result.user.email;
          const nextUserId = result.user.authUserId;
          const currentEmail = current.user.email;
          const currentUserId = current.user.id;
          if (currentUserId === nextUserId && currentEmail === nextEmail) {
            return current;
          }
          const hydrated: BusinessJwtSession = {
            ...current,
            user: {
              id: nextUserId,
              email: nextEmail
            }
          };
          writeStoredSession(hydrated);
          return hydrated;
        });
      })
      .catch(() => {
        if (!active) return;
        clearSession();
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accessToken, clearSession]);

  return useMemo(() => ({
    loading,
    session,
    setSession,
    clearSession
  }), [clearSession, loading, session, setSession]);
}
