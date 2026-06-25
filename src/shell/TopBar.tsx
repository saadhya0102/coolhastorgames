import { useState } from "react";
import { useAuth } from "./useAuth";
import { setName } from "@/services/identity";

export function TopBar({
  search,
  onSearch,
  showSearch = true,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  showSearch?: boolean;
}) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="topbar">
      <a href="/" className="brand" onClick={(e) => { e.preventDefault(); window.location.assign("/"); }}>
        <img className="logo" src="/favicon.svg" alt="" />
        <span className="grad full">CoolHastorGames</span>
      </a>
      {showSearch && (
        <div className="search">
          <span>🔍</span>
          <input
            placeholder="Search games..."
            value={search ?? ""}
            onChange={(e) => onSearch?.(e.target.value)}
          />
        </div>
      )}
      <div className="spacer" />
      <button className="icon-btn" onClick={() => setOpen(true)}>
        <span>👤</span>
        <span className="full">{auth.displayName}</span>
      </button>
      {open && <ProfileModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [name, setNameInput] = useState(auth.displayName);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Your Profile</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Pick a name - it shows up on the global leaderboards and in multiplayer rooms.
        </p>
        <div className="col">
          <label className="muted" style={{ fontSize: 13 }}>Display name</label>
          <input
            className="input"
            value={name}
            maxLength={20}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setName(name);
                onClose();
                window.location.reload();
              }
            }}
          />
          <button
            className="btn"
            onClick={() => {
              setName(name);
              onClose();
              window.location.reload();
            }}
          >
            Save name
          </button>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
