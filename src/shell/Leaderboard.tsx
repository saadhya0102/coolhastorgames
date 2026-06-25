import { useEffect, useState } from "react";
import { getTopScores, type ScoreEntry } from "@/services/leaderboards";
import { useAuth } from "./useAuth";
import { formatTime } from "@/engine";

interface Props {
  gameId: string;
  ascending?: boolean;
  scoreLabel?: string;
  isTime?: boolean;
}

export function Leaderboard({ gameId, ascending = false, scoreLabel = "Score", isTime = false }: Props) {
  const { uid } = useAuth();
  const [rows, setRows] = useState<ScoreEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    setRows(null);
    getTopScores(gameId, ascending, 25).then((r) => {
      if (active) setRows(r);
    });
    return () => {
      active = false;
    };
  }, [gameId, ascending]);

  if (rows === null) {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="muted center">No scores yet. Be the first!</p>;
  }

  return (
    <table className="lb">
      <thead>
        <tr>
          <th className="rank">#</th>
          <th>Player</th>
          <th style={{ textAlign: "right" }}>{scoreLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.uid} className={r.uid === uid ? "me" : ""}>
            <td className="rank">{i + 1}</td>
            <td>{r.name}</td>
            <td style={{ textAlign: "right" }}>
              {isTime ? formatTime(r.score) : r.score.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
