import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthContext, type AuthState } from "./shell/useAuth";
import { Hub } from "./shell/Hub";
import { GamePage } from "./shell/GamePage";
import { getName, getUid } from "./services/identity";
import { initLeaderboards } from "./services/leaderboards";

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ uid: "", displayName: "Player", ready: false });

  useEffect(() => {
    try {
      initLeaderboards();
    } catch (e) {
      console.warn("Leaderboards unavailable", e);
    }
    setAuth({ uid: getUid(), displayName: getName(), ready: true });
  }, []);

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Hub />} />
          <Route path="/minigames" element={<Hub collection="minigames" />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="*" element={<Hub />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
