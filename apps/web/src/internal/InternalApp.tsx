import { Suspense, useEffect, useState } from "react";
import { ApiManagementContent } from "./api-management/ApiManagementContent.js";
import { NewApiKeyContent } from "./api-management/NewApiKeyContent.js";
import { InviteUser, OnboardingSuccess } from "./admin/AdminRoutes.js";
import SaveUserManagement from "./admin/SaveUserManagement.js";
import { InternalUsersContent } from "./admin/UserManagement.js";
import { InternalAccessInitialization, InternalOperationGateway } from "./auth/InternalAuthRoutes.js";
import { BusinessClientReview } from "./business-clients/BusinessClientReview.js";
import { InternalShell } from "./InternalShell.js";
import { InternalCommandCenterContent } from "./operations/InternalCommandCenterContent.js";
import type { AppUser, RoleCode, UserStatus } from "../identity.js";
import { isTreasuryWorksRoute, TreasuryWorksContent } from "./treasury-works/TreasuryWorksApp.js";

type AdminUsersLoadStatus = "idle" | "loading" | "ready" | "error";
type InvitationEmailDelivery = {
  sent: boolean;
  provider: string;
  status: string;
  detail?: string;
  initializationUrl?: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";
const internalAccessBaseUrl = `${window.location.origin}/internal/access/init`;

export const isInternalRoute = (path: string): boolean => path === "/internal" || path.startsWith("/internal/");

export const InternalApp = ({
  navigate,
  path
}: {
  navigate: (path: string) => void;
  path: string;
}) => {
  const [currentInternalUser, setCurrentInternalUser] = useState<AppUser | undefined>(() => {
    const raw = window.sessionStorage.getItem("gtt.internalUser");
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as AppUser;
    } catch {
      window.sessionStorage.removeItem("gtt.internalUser");
      return undefined;
    }
  });
  const [adminUsers, setAdminUsers] = useState<AppUser[]>([]);
  const [adminUsersStatus, setAdminUsersStatus] = useState<AdminUsersLoadStatus>("idle");
  const [adminUsersError, setAdminUsersError] = useState("");
  const [adminUsersNotice, setAdminUsersNotice] = useState("");
  const [resendingUserId, setResendingUserId] = useState<string | undefined>();
  const [savingUserId, setSavingUserId] = useState<string | undefined>();

  const rememberInternalUser = (user: AppUser) => {
    setCurrentInternalUser(user);
    window.sessionStorage.setItem("gtt.internalUser", JSON.stringify(user));
  };

  const logoutInternalUser = () => {
    setCurrentInternalUser(undefined);
    window.sessionStorage.removeItem("gtt.internalUser");
    navigate("/internal/login");
  };

  useEffect(() => {
    if (!path.startsWith("/internal/operations/admin/users") || path.includes("/invite") || !currentInternalUser) return;

    const controller = new AbortController();
    setAdminUsersStatus("loading");
    setAdminUsersError("");

    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/admin/users`, {
      headers: {
        authorization: `Bearer ${gttApiKey}`
      },
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = await response.json() as { users?: AppUser[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? `admin_users_fetch_failed:${response.status}`);
        setAdminUsers((payload.users ?? []).filter((user) => user.userType === "internal_user"));
        setAdminUsersStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAdminUsers([]);
        setAdminUsersStatus("error");
        setAdminUsersError(error instanceof Error ? error.message : "admin_users_fetch_failed");
      });

    return () => controller.abort();
  }, [currentInternalUser, path]);

  const saveInternalUser = async (input: {
    userId: string;
    displayName: string;
    email: string;
    roles: Exclude<RoleCode, "business_user">[];
    status: UserStatus;
  }): Promise<void> => {
    setSavingUserId(input.userId);
    setAdminUsersError("");
    setAdminUsersNotice("");
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/admin/users/${encodeURIComponent(input.userId)}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${gttApiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          displayName: input.displayName,
          email: input.email,
          roles: input.roles,
          status: input.status
        })
      });
      const payload = await response.json() as { error?: string; user?: AppUser };
      if (!response.ok) throw new Error(payload.error ?? `internal_user_update_failed:${response.status}`);
      const updatedUser = payload.user;
      if (updatedUser) {
        setAdminUsers((users) => users.map((user) => user.id === updatedUser.id ? updatedUser : user));
        setAdminUsersNotice(`User profile saved for ${updatedUser.email}.`);
      }
    } catch (error) {
      setAdminUsersError(error instanceof Error ? error.message : "internal_user_update_failed");
    } finally {
      setSavingUserId(undefined);
    }
  };

  const resendInternalInvitation = async (user: AppUser): Promise<void> => {
    setResendingUserId(user.id);
    setAdminUsersError("");
    setAdminUsersNotice("");
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/admin/users/${encodeURIComponent(user.id)}/invitation/resend`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${gttApiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          internalAccessBaseUrl
        })
      });
      const payload = await response.json() as {
        emailDelivery?: InvitationEmailDelivery;
        error?: string;
        user?: AppUser;
      };
      if (!response.ok) throw new Error(payload.error ?? `internal_invitation_resend_failed:${response.status}`);
      const updatedUser = payload.user;
      if (updatedUser) {
        setAdminUsers((users) => users.map((item) => item.id === updatedUser.id ? updatedUser : item));
      }
      const deliveryStatus = payload.emailDelivery?.status ?? "not_configured";
      setAdminUsersNotice(
        payload.emailDelivery?.sent
          ? `Invitation email resent to ${user.email}.`
          : `Invitation link regenerated for ${user.email}; email not sent (${deliveryStatus}).`
      );
    } catch (error) {
      setAdminUsersError(error instanceof Error ? error.message : "internal_invitation_resend_failed");
    } finally {
      setResendingUserId(undefined);
    }
  };

  if (path === "/internal" || path === "/internal/" || path === "/internal/login" || path === "/internal/gateway") {
    return <InternalOperationGateway onLogin={(redirectTo, user) => {
      rememberInternalUser(user);
      navigate(redirectTo);
    }} />;
  }

  if (path === "/internal/access/init") {
    return <InternalAccessInitialization navigate={navigate} onInitialized={rememberInternalUser} />;
  }

  if (!currentInternalUser) {
    return <InternalOperationGateway onLogin={(redirectTo, user) => {
      rememberInternalUser(user);
      navigate(redirectTo);
    }} />;
  }

  if (path === "/internal/operations" || path === "/internal/operations/" || path === "/internal/operations/commandcentre") {
    return (
      <InternalShell activePath="/internal/operations/commandcentre" currentUser={currentInternalUser} navigate={navigate} onLogout={logoutInternalUser}>
        <InternalCommandCenterContent />
      </InternalShell>
    );
  }

  if (path.startsWith("/internal/operations/admin/users")) {
    return (
      <InternalShell activePath={path} currentUser={currentInternalUser} navigate={navigate} onLogout={logoutInternalUser}>
        <Suspense fallback={<div>Loading...</div>}>
        {path === "/internal/operations/admin/users" && (
          <div className="internal-users-main">
            <InternalUsersContent
              error={adminUsersError}
              loading={adminUsersStatus === "loading" || adminUsersStatus === "idle"}
              navigate={navigate}
              notice={adminUsersNotice}
              onResendInvitation={resendInternalInvitation}
              resendingUserId={resendingUserId}
              users={adminUsers}
            />
          </div>
        )}
        {path === "/internal/operations/admin/users/invite" && (
          <InviteUser
            onNavigate={navigate}
            onInvite={async (input) => {
              const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/admin/users/invitations`, {
                method: "POST",
                headers: {
                  authorization: `Bearer ${gttApiKey}`,
                  "content-type": "application/json"
                },
                body: JSON.stringify({
                  ...input,
                  internalAccessBaseUrl
                })
              });
              const payload = await response.json() as {
                duplicate?: boolean;
                setupToken?: string;
                initializationUrl?: string;
                emailDelivery?: {
                  sent: boolean;
                  provider: string;
                  status: string;
                  detail?: string;
                  initializationUrl?: string;
                };
                detail?: string;
                error?: string;
              };
              if (!response.ok) {
                throw new Error([payload.error ?? `internal_invitation_failed:${response.status}`, payload.detail].filter(Boolean).join(": "));
              }
              return {
                duplicate: Boolean(payload.duplicate),
                initializationUrl: payload.initializationUrl,
                setupToken: payload.setupToken,
                emailDelivery: payload.emailDelivery
              };
            }}
          />
        )}
        {path === "/internal/operations/admin/users/invite/success" && (
          <OnboardingSuccess onNavigate={navigate} />
        )}
        {/^\/internal\/operations\/admin\/users\/[^/]+$/.test(path) && !path.endsWith("/invite") && (
          <SaveUserManagement
            error={adminUsersError}
            loading={adminUsersStatus === "loading" || adminUsersStatus === "idle"}
            notice={adminUsersNotice}
            onNavigate={navigate}
            onResendInvitation={resendInternalInvitation}
            onSave={saveInternalUser}
            resending={resendingUserId === decodeURIComponent(path.split("/").pop() ?? "")}
            saving={savingUserId === decodeURIComponent(path.split("/").pop() ?? "")}
            user={adminUsers.find((user) => user.id === decodeURIComponent(path.split("/").pop() ?? ""))}
            users={adminUsers}
          />
        )}
        </Suspense>
      </InternalShell>
    );
  }

  if (path === "/internal/operations/api-keys/new") {
    return (
      <InternalShell activePath="/internal/operations/api-keys" currentUser={currentInternalUser} navigate={navigate} onLogout={logoutInternalUser}>
        <NewApiKeyContent navigate={navigate} />
      </InternalShell>
    );
  }

  if (path === "/internal/operations/api-keys") {
    return (
      <InternalShell activePath={path} currentUser={currentInternalUser} navigate={navigate} onLogout={logoutInternalUser}>
        <ApiManagementContent navigate={navigate} />
      </InternalShell>
    );
  }

  if (path === "/internal/operations/business-clients" || path.startsWith("/internal/operations/business-clients/")) {
    return (
      <InternalShell activePath={path} currentUser={currentInternalUser} navigate={navigate} onLogout={logoutInternalUser}>
        <BusinessClientReview currentUser={currentInternalUser} navigate={navigate} path={path} />
      </InternalShell>
    );
  }

  if (isTreasuryWorksRoute(path)) {
    return (
      <InternalShell activePath={path} currentUser={currentInternalUser} navigate={navigate} onLogout={logoutInternalUser}>
        <TreasuryWorksContent navigate={navigate} path={path} />
      </InternalShell>
    );
  }

  return (
    <InternalShell activePath={path} currentUser={currentInternalUser} navigate={navigate} onLogout={logoutInternalUser}>
      <InternalCommandCenterContent />
    </InternalShell>
  );
};
