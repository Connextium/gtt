import { LogOut, Settings, User } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import InternalAdminFooter from "./admin/InternalAdminFooter.js";
import { internalShellNavItems } from "./internal-routes.js";
import type { AppUser } from "../identity.js";

export const InternalShell = ({
  activePath,
  children,
  currentUser,
  onLogout,
  navigate
}: {
  activePath: string;
  children: ReactNode;
  currentUser?: AppUser;
  onLogout?: () => void;
  navigate: (path: string) => void;
}) => {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  return (
    <div className="command-center-screen">
      <header className="command-center-header">
        <div className="command-center-header-inner">
          <div className="command-center-brand-row">
            <span className="command-center-brand">Treasury Architect</span>
            <nav className="command-center-header-nav" aria-label="Internal sections">
              <button className={isActive(activePath, "/internal/operations/commandcentre") ? "active" : ""} onClick={() => navigate("/internal/operations/commandcentre")} type="button">Command Center</button>
              <button onClick={() => navigate("/internal/operations/rebalancing")} type="button">Liquidity</button>
              <button onClick={() => navigate("/internal/operations/business-clients")} type="button">Compliance</button>
            </nav>
          </div>
          <div className="command-center-header-actions">
            <button className="icon-button" title="Command settings" type="button"><Settings size={18} /></button>
            <div className="command-center-profile-menu">
              <button
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                className="icon-button"
                onClick={() => setProfileMenuOpen((open) => !open)}
                title="Operator profile"
                type="button"
              >
                <User size={18} />
              </button>
              {profileMenuOpen && (
                <div className="command-center-profile-popover" role="menu">
                  <div>
                    <span>{currentUser?.displayName ?? "Internal User"}</span>
                    <small>{currentUser?.email ?? "Authenticated session"}</small>
                  </div>
                  <button
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onLogout?.();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="command-center-body">
        <aside className="command-center-sidepanel" aria-label="Internal navigation">
          <div>
            <div className="command-center-sidepanel-label">System Operations</div>
            <nav className="command-center-sidepanel-nav">
              {internalShellNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button className={isActive(activePath, item.path) ? "active" : ""} key={item.path} onClick={() => navigate(navTarget(item.path))} type="button">
                    <Icon size={20} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

        </aside>

        <main className="command-center-main">
          {children}
        </main>
      </div>

      <InternalAdminFooter label="Internal operations legal links" />
    </div>
  );
};

const isActive = (activePath: string, itemPath: string): boolean =>
  activePath === itemPath || activePath.startsWith(`${itemPath}/`);

const navTarget = (path: string): string =>
  internalShellNavItems.find((item) => item.path === path)?.navTarget ?? path;
