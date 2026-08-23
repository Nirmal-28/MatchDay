import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getSession, onAuthStateChange, getMyCapabilities, claimMyInvites } from "./repository";

// One account, many roles.
//
// There is a single auth identity per person. What they can DO is a set of
// capabilities accumulated across tournaments — competing (players.user_id),
// owning (tournaments.organizer_id) and staffing (tournament_members.role) —
// never a second account and never a global "user type". Navigation reads
// this; RLS enforces it.
const AuthContext = createContext({ session: null, loading: true, caps: null });

const EMPTY_CAPS = { signedIn: false, player: null, organizes: 0, officiates: 0, memberships: [], canOrganize: true };

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [caps, setCaps] = useState(EMPTY_CAPS);

  const refreshCaps = useCallback(async () => {
    try { setCaps(await getMyCapabilities()); }
    catch { setCaps(EMPTY_CAPS); }
  }, []);

  useEffect(() => {
    getSession().then(async (s) => {
      setSession(s);
      if (s) {
        // Any pending staff invite addressed to this verified email becomes a
        // real role here, so a referee who was invited before signing up
        // arrives with the tournament already in their list.
        await claimMyInvites();
        await refreshCaps();
      }
      setLoading(false);
    });
    return onAuthStateChange(async (s) => {
      setSession(s);
      if (s) await refreshCaps(); else setCaps(EMPTY_CAPS);
    });
  }, [refreshCaps]);

  return (
    <AuthContext.Provider value={{ session, loading, caps, refreshCaps }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
