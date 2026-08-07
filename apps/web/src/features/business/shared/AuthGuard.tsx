import { useEffect, type ReactNode } from "react";

export function AuthGuard({
  children,
  isAuthenticated,
  isLoading,
  onUnauthenticated
}: {
  children: ReactNode;
  isAuthenticated: boolean;
  isLoading: boolean;
  onUnauthenticated: () => void;
}) {
  useEffect(() => {
    if (!isLoading && !isAuthenticated) onUnauthenticated();
  }, [isAuthenticated, isLoading, onUnauthenticated]);

  if (isLoading) {
    return (
      <main className="center-shell">
        <div className="status-card">
          <span className="eyebrow">Checking Session</span>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) return null;
  return <>{children}</>;
}
