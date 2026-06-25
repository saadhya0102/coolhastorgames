import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getGame } from "@/registry/manifest";
import type { CanvasGameModule, GameDef, ReactGameModule } from "@/engine";
import { GameHost } from "./GameHost";

export function GamePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const def = id ? getGame(id) : undefined;
  const [mod, setMod] = useState<CanvasGameModule | ReactGameModule | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!def) return;
    let active = true;
    setMod(null);
    setError(false);
    def
      .load()
      .then((m) => {
        if (active) setMod(m);
      })
      .catch((e) => {
        console.error("Failed to load game", e);
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [def]);

  const onExit = () => nav("/");

  if (!def) {
    return (
      <div className="loading">
        <div>
          <p>Game not found.</p>
          <button className="btn" onClick={onExit}>
            Back to games
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading">
        <div className="center">
          <p>Couldn't load this game.</p>
          <button className="btn" onClick={onExit}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (!mod) {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    );
  }

  if (def.kind === "react") {
    const Comp = (mod as ReactGameModule).Component;
    return <Comp meta={def} onExit={onExit} />;
  }

  return <GameHost def={def as GameDef} module={mod as CanvasGameModule} onExit={onExit} />;
}
