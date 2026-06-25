import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { APPS, MINIGAMES, SECTION_BLURB, SECTION_LABELS } from "@/registry/manifest";
import type { GameDef, GameSection } from "@/engine";
import { TopBar } from "./TopBar";

const CATEGORIES: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "arcade", label: "Arcade" },
  { id: "puzzle", label: "Puzzle" },
  { id: "classic", label: "Classic" },
  { id: "driving", label: "Driving" },
  { id: "rpg", label: "RPG / Idle" },
];

const APP_SECTION_ORDER: GameSection[] = ["featured", "online", "party"];

export function Hub({ collection }: { collection?: string }) {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const nav = useNavigate();

  const q = search.trim().toLowerCase();
  const apps = useMemo(
    () =>
      APPS.filter((g) => {
        if (!q) return true;
        return g.title.toLowerCase().includes(q) || g.description.toLowerCase().includes(q);
      }),
    [q],
  );
  const minigamesMatch = useMemo(
    () => (!q ? [] : MINIGAMES.filter((g) => g.title.toLowerCase().includes(q) || g.description.toLowerCase().includes(q))),
    [q],
  );

  // -------- Collection sub-hub (e.g. /minigames) --------
  if (collection === "minigames") {
    const list = MINIGAMES.filter((g) => {
      if (cat !== "all" && g.category !== cat) return false;
      if (!q) return true;
      return g.title.toLowerCase().includes(q) || g.description.toLowerCase().includes(q);
    });
    return (
      <div className="app">
        <TopBar search={search} onSearch={setSearch} />
        <div className="container">
          <button className="icon-btn" style={{ marginBottom: 14 }} onClick={() => nav("/")}>
            &larr; All apps
          </button>
          <div className="hero">
            <h1>🎮 Minigames</h1>
            <p>{MINIGAMES.length} bite-size classics. Pick one and play instantly.</p>
          </div>
          <div className="filters">
            {CATEGORIES.map((cg) => (
              <button key={cg.id} className={"pill" + (cat === cg.id ? " active" : "")} onClick={() => setCat(cg.id)}>
                {cg.label}
              </button>
            ))}
          </div>
          <div className="grid">
            {list.map((g) => (
              <GameCard key={g.id} g={g} onClick={() => nav(`/game/${g.id}`)} />
            ))}
          </div>
          {list.length === 0 && <p className="muted center" style={{ padding: 50 }}>No games match "{search}".</p>}
        </div>
        <Footer />
      </div>
    );
  }

  // -------- Main hub (apps) --------
  const bySection: Record<string, GameDef[]> = { featured: [], online: [], party: [] };
  for (const g of apps) bySection[g.section]?.push(g);

  return (
    <div className="app">
      <TopBar search={search} onSearch={setSearch} />
      <div className="container">
        <div className="hero">
          <h1>
            Welcome to <span className="grad">CoolHastorGames</span>
          </h1>
          <p>Full-size games, party nights with friends, and a whole arcade of classics.</p>
        </div>

        {/* Minigames collection tile */}
        {!q && (
          <div
            className="card"
            onClick={() => nav("/minigames")}
            style={{
              marginBottom: 22,
              flexDirection: "row",
              alignItems: "center",
              gap: 18,
              padding: 18,
              background: "linear-gradient(120deg, #1b2342, #18203a)",
            }}
          >
            <div style={{ fontSize: 56 }}>🎮</div>
            <div style={{ flex: 1 }}>
              <p className="card-title" style={{ fontSize: 22 }}>Minigames</p>
              <div className="meta">{MINIGAMES.length} arcade, puzzle & classic games in one place</div>
            </div>
            <div className="btn" style={{ pointerEvents: "none" }}>Open</div>
          </div>
        )}

        {APP_SECTION_ORDER.map((sec) =>
          bySection[sec] && bySection[sec].length > 0 ? (
            <section key={sec}>
              <h2 className="section-title">
                {SECTION_LABELS[sec]}
                <span className="count">{bySection[sec].length}</span>
              </h2>
              <p className="muted" style={{ margin: "-6px 0 12px" }}>{SECTION_BLURB[sec]}</p>
              <div className="grid">
                {bySection[sec].map((g) => (
                  <GameCard key={g.id} g={g} onClick={() => nav(`/game/${g.id}`)} />
                ))}
              </div>
            </section>
          ) : null,
        )}

        {q && minigamesMatch.length > 0 && (
          <section>
            <h2 className="section-title">
              Minigames<span className="count">{minigamesMatch.length}</span>
            </h2>
            <div className="grid">
              {minigamesMatch.map((g) => (
                <GameCard key={g.id} g={g} onClick={() => nav(`/game/${g.id}`)} />
              ))}
            </div>
          </section>
        )}

        {q && apps.length === 0 && minigamesMatch.length === 0 && (
          <p className="muted center" style={{ padding: 50 }}>No games match "{search}".</p>
        )}
      </div>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <div className="footer">
      Made with care - original takes on classic games. Have fun!
    </div>
  );
}

function GameCard({ g, onClick }: { g: GameDef; onClick: () => void }) {
  const badge =
    g.section === "online" ? "Online" : g.section === "party" ? "Party" : g.section === "featured" ? "Full Game" : g.leaderboard ? "Ranked" : null;
  return (
    <div className="card" onClick={onClick}>
      <div className="thumb" style={{ background: `radial-gradient(120% 120% at 30% 20%, ${g.color}40, #0c1019 70%)` }}>
        <span>{g.icon}</span>
        {badge && <span className="badge">{badge}</span>}
      </div>
      <div className="body">
        <p className="card-title">{g.title}</p>
        <div className="meta">
          <span>{g.players}</span>
          <span>-</span>
          <span style={{ color: g.color }}>{g.category}</span>
        </div>
      </div>
    </div>
  );
}
