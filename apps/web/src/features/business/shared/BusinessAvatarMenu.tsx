import { LogOut, User } from "lucide-react";
import { useState } from "react";

export function BusinessAvatarMenu({
  direction = "down",
  email,
  onLogout
}: {
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
          <button onClick={logout} role="menuitem" type="button">
            <LogOut size={14} />
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}
