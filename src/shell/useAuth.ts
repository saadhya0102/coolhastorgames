import { createContext, useContext } from "react";

export interface AuthState {
  uid: string;
  displayName: string;
  ready: boolean;
}

export const AuthContext = createContext<AuthState>({
  uid: "",
  displayName: "Player",
  ready: false,
});

export const useAuth = () => useContext(AuthContext);
