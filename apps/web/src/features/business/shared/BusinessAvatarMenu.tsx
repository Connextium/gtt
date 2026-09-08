import { LogOut, User } from "lucide-react";
import { useState } from "react";

type BusinessAvatarMenuAction = {
  label: string;
  onSelect: () => void;
};

export function BusinessAvatarMenu({
  actions,
  direction = "down",
  email,
  onLogout
}: {
  actions?: BusinessAvatarMenuAction[];
  direction?: "down" | "up";
  email?: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const displayEmail = email ?? "Authenticated business user";

  function logout() {
    setOpen(false);
    onLogout();
  }

  function selectAction(action: BusinessAvatarMenuAction) {
    setOpen(false);
    action.onSelect();
  }

  return (
    <div className={`gtt-business-avatar-menu-shell ${direction === "up" ? "upward" : ""}`}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Business user profile"
        className="gtt-business-avatar-button"
        onClick={() => setOpen((current) => !current)}
        title="Business user profile"
        type="button"
      >
        <User size={17} />
      </button>
      {open ? (
        <div className="gtt-business-avatar-popover" role="menu">
          <div>
            <span>Business User</span>
            <small>{displayEmail}</small>
          </div>
          {actions?.length ? (
            <section className="gtt-business-avatar-actions-group" aria-label="Configuration">
              <p>Configuration</p>
              {actions.map((action) => (
                <button key={action.label} onClick={() => selectAction(action)} role="menuitem" type="button">
                  {action.label}
                </button>
              ))}
            </section>
          ) : null}
          <button onClick={logout} role="menuitem" type="button">
            <LogOut size={14} />
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}
