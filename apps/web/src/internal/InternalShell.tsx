import { Building2, ChevronDown, Code, LogOut, Settings, User } from "lucide-react";
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
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [expandedNavGroups, setExpandedNavGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      internalShellNavItems
        .filter((item) => item.children?.length && isActiveRouteOrChild(activePath, item))
        .map((item) => [item.path, true])
    )
  );

  const toggleNavGroup = (path: string) => {
    setExpandedNavGroups((current) => ({ ...current, [path]: !current[path] }));
  };

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
            <div className="command-center-system-menu">
              <button
                aria-expanded={systemMenuOpen}
                aria-haspopup="menu"
                className={isSystemRoute(activePath) ? "icon-button active" : "icon-button"}
                onClick={() => {
                  setSystemMenuOpen((open) => !open);
                  setProfileMenuOpen(false);
                }}
                title="System settings"
                type="button"
              >
                <Settings size={18} />
              </button>
              {systemMenuOpen && (
                <div className="command-center-system-popover" role="menu">
                  <div>
                    <span>System Settings</span>
                    <small>Tenant and platform controls</small>
                  </div>
                  <button
                    className={isActive(activePath, "/internal/operations/admin/tenant-activation") ? "active" : ""}
                    onClick={() => {
                      setSystemMenuOpen(false);
                      navigate("/internal/operations/admin/tenant-activation");
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Building2 size={16} />
                    <span>Tenant Activation</span>
                  </button>
                  <button
                    className={isActive(activePath, "/internal/operations/api-keys") ? "active" : ""}
                    onClick={() => {
                      setSystemMenuOpen(false);
                      navigate("/internal/operations/api-keys");
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Code size={16} />
                    <span>API Management</span>
                  </button>
                </div>
              )}
            </div>
            <div className="command-center-profile-menu">
              <button
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                className="icon-button"
                onClick={() => {
                  setProfileMenuOpen((open) => !open);
                  setSystemMenuOpen(false);
                }}
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
                const children = (item.children ?? []).filter((child) => child.showInShellNav !== false);
                const hasChildren = children.length > 0;
                const expanded = hasChildren && expandedNavGroups[item.path] !== false;
                return (
                  <div className={`command-center-nav-group ${hasChildren ? "has-children" : ""}`} key={item.path}>
                    <button
                      aria-expanded={hasChildren ? expanded : undefined}
                      className={isActiveRouteOrChild(activePath, item) ? "active" : ""}
                      onClick={() => hasChildren ? toggleNavGroup(item.path) : navigate(navTarget(item.path))}
                      type="button"
                    >
                      <Icon size={20} />
                      <span>{item.label}</span>
                      {hasChildren ? <ChevronDown className="command-center-nav-chevron" size={15} /> : null}
                    </button>
                    {hasChildren && expanded ? (
                      <div className="command-center-sidepanel-subnav">
                        {children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <button className={isActive(activePath, child.path) ? "active" : ""} key={child.path} onClick={() => navigate(navTarget(child.path))} type="button">
                              <ChildIcon size={16} />
                              <span>{child.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
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

const isSystemRoute = (activePath: string): boolean =>
  isActive(activePath, "/internal/operations/admin/tenant-activation") || isActive(activePath, "/internal/operations/api-keys");

const isActiveRouteOrChild = (activePath: string, item: (typeof internalShellNavItems)[number]): boolean =>
  isActive(activePath, item.path) || Boolean(item.children?.some((child) => isActive(activePath, child.path)));

const navTarget = (path: string): string =>
  flattenNavItems(internalShellNavItems).find((item) => item.path === path)?.navTarget ?? path;

const flattenNavItems = (items: typeof internalShellNavItems): typeof internalShellNavItems =>
  items.flatMap((item) => [item, ...(item.children ? flattenNavItems(item.children) : [])]);
