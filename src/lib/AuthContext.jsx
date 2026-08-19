import { createContext, useContext, useEffect, useState } from "react";
import { getSession, onAuthStateChange } from "./repository";

const AuthContext = createContext({ session: null, loading: true });

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSession().then((s) => { setSession(s); setLoading(false); });
    return onAuthStateChange((s) => setSession(s));
  }, []);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
