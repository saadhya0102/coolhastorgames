import { useEffect, useRef, useState } from "react";
import type { CanvasGameModule, GameContext, GameDef, GameInstance, TouchControl } from "@/engine";
import { InputManager, audio, makeStorage } from "@/engine";
import { Leaderboard } from "./Leaderboard";

interface Props {
  def: GameDef;
  module: CanvasGameModule;
  onExit: () => void;
}

export function GameHost({ def, module, onExit }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("");
  const [liveScore, setLiveScore] = useState<number | null>(null);
  const [controls, setControls] = useState<TouchControl[]>([]);
  const [over, setOver] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [showLb, setShowLb] = useState(false);
  const [restartKey, setRestartKey] = useState(0);

  const inputRef = useRef<InputManager | null>(null);
  const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const ascending = !!def.scoreAscending;

  useEffect(() => {
    const stage = stageRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const aspect = def.aspect ?? 4 / 3;

    let logicalW = 0;
    let logicalH = 0;
    let instance: GameInstance | null = null;
    let raf = 0;
    let last = performance.now();
    let stopped = false;

    const toLogical = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((clientX - r.left) / r.width) * logicalW,
        y: ((clientY - r.top) / r.height) * logicalH,
      };
    };

    const input = new InputManager(stage, toLogical);
    inputRef.current = input;

    const layout = () => {
      const containerW = stage.parentElement!.clientWidth - 4;
      const topbar = 120;
      const availH = Math.max(260, window.innerHeight - topbar - 40);
      let w = Math.min(containerW, 940);
      let h = w / aspect;
      if (h > availH) {
        h = availH;
        w = h * aspect;
      }
      w = Math.floor(w);
      h = Math.floor(h);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      stage.style.width = w + "px";
      stage.style.height = h + "px";
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      logicalW = w;
      logicalH = h;
      instance?.resize?.(w, h);
    };

    const gameCtx: GameContext = {
      canvas,
      ctx,
      get width() {
        return logicalW;
      },
      get height() {
        return logicalH;
      },
      input,
      audio,
      storage: makeStorage(def.id),
      isTouch,
      reportScore: (s) => setLiveScore(Math.floor(s)),
      gameOver: (fs) => {
        if (stopped) return;
        stopped = true;
        const storage = makeStorage(def.id);
        let nb = false;
        if (typeof fs === "number") {
          nb = storage.submitScore(Math.floor(fs), ascending);
          setFinalScore(Math.floor(fs));
        }
        setBest(storage.get<number | null>("__best", null));
        setIsNewBest(nb);
        setOver(true);
      },
      setStatus: (t) => setStatus(t),
      requestControls: (c) => setControls(c),
    };

    layout();
    instance = module.create(gameCtx);

    const loop = (now: number) => {
      if (stopped) {
        // keep rendering a static frame underneath the overlay
        raf = requestAnimationFrame(loop);
        input.endFrame();
        return;
      }
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switches)
      instance!.update(dt);
      instance!.render();
      input.endFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => layout());
    ro.observe(stage.parentElement!);
    window.addEventListener("resize", layout);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", layout);
      instance?.destroy?.();
      input.destroy();
      inputRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id, restartKey]);

  const playAgain = () => {
    setOver(false);
    setShowLb(false);
    setFinalScore(null);
    setLiveScore(null);
    setStatus("");
    setControls([]);
    setRestartKey((k) => k + 1);
  };

  const fmt = (n: number) => (ascending ? n : n.toLocaleString());

  return (
    <div className="game-page">
      <div className="game-top">
        <button className="icon-btn" onClick={onExit}>
          &larr; Back
        </button>
        <h2 style={{ color: def.color }}>{def.title}</h2>
        <div className="spacer" />
        {liveScore !== null && (
          <div className="status">
            {def.scoreLabel ?? "Score"}: <b>{fmt(liveScore)}</b>
          </div>
        )}
        <MuteButton />
      </div>

      <div className="stage-wrap">
        {status && <div className="status">{status}</div>}
        <div className="stage" ref={stageRef}>
          <canvas ref={canvasRef} />
          {isTouch && controls.length > 0 && (
            <TouchControls controls={controls} input={inputRef} />
          )}
        </div>
        {def.instructions && (
          <div className="muted" style={{ maxWidth: 700, textAlign: "center", fontSize: 13 }}>
            {def.instructions.join("  -  ")}
          </div>
        )}
      </div>

      {over && (
        <div className="overlay">
          <div className="modal center">
            <h3>{isNewBest ? "New Best!" : "Game Over"}</h3>
            {finalScore !== null && (
              <p style={{ fontSize: 30, fontWeight: 800, margin: "6px 0" }}>
                {def.scoreLabel ?? "Score"}: {fmt(finalScore)}
              </p>
            )}
            {best !== null && (
              <p className="muted">Best: {fmt(best)}</p>
            )}
            {showLb ? (
              <div style={{ margin: "12px 0", maxHeight: 280, overflow: "auto" }}>
                <Leaderboard
                  gameId={def.id}
                  ascending={ascending}
                  scoreLabel={def.scoreLabel}
                  isTime={def.scoreLabel === "Best Time" || def.scoreLabel === "Time"}
                />
              </div>
            ) : null}
            <div className="row" style={{ justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn" onClick={playAgain}>
                Play Again
              </button>
              {def.leaderboard && (
                <button className="btn secondary" onClick={() => setShowLb((s) => !s)}>
                  {showLb ? "Hide" : "Leaderboard"}
                </button>
              )}
              <button className="btn ghost" onClick={onExit}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MuteButton() {
  const [muted, setMuted] = useState(audio.muted);
  return (
    <button
      className="icon-btn"
      title={muted ? "Unmute" : "Mute"}
      onClick={() => {
        const m = !muted;
        audio.setMuted(m);
        setMuted(m);
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

function TouchControls({
  controls,
  input,
}: {
  controls: TouchControl[];
  input: React.MutableRefObject<InputManager | null>;
}) {
  const press = (key: string, down: boolean) => input.current?.setVirtual(key, down);

  const renderDpad = () => (
    <div className="group" style={{ display: "grid", gridTemplateColumns: "repeat(3,60px)", gridTemplateRows: "repeat(3,60px)", gap: 4 }}>
      <span />
      <Btn label="▲" k="ArrowUp" press={press} />
      <span />
      <Btn label="◀" k="ArrowLeft" press={press} />
      <span />
      <Btn label="▶" k="ArrowRight" press={press} />
      <span />
      <Btn label="▼" k="ArrowDown" press={press} />
      <span />
    </div>
  );

  return (
    <div className="touch-controls">
      <div className="group">
        {controls.filter((c) => c.type === "dpad").map((_, i) => (
          <div key={"d" + i}>{renderDpad()}</div>
        ))}
      </div>
      <div className="group">
        {controls
          .filter((c): c is Extract<TouchControl, { type: "button" }> => c.type === "button")
          .map((c) => (
            <Btn key={c.id} label={c.label} k={c.key} press={press} />
          ))}
      </div>
    </div>
  );
}

function Btn({
  label,
  k,
  press,
}: {
  label: string;
  k: string;
  press: (key: string, down: boolean) => void;
}) {
  return (
    <button
      className="tc-btn"
      onPointerDown={(e) => {
        e.preventDefault();
        press(k, true);
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        press(k, false);
      }}
      onPointerLeave={() => press(k, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}
