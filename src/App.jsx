import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { BrandLoader } from "./components/ui/motion";
import logo from "./assets/logo.png";
import { signOut } from "./lib/repository";
import PublicDiscovery from "./pages/PublicDiscovery";
import PublicTournamentPage from "./pages/PublicTournamentPage";
import PlayerProfile from "./pages/PlayerProfile";
import Leaderboard from "./pages/Leaderboard";
import OrganizerDashboard from "./pages/OrganizerDashboard";
import TournamentControlCenter from "./pages/TournamentControlCenter";
import SignIn from "./pages/auth/SignIn";
import SignUp from "./pages/auth/SignUp";
import { cx } from "./lib/engines";

function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <BrandLoader />;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function Header() {
  const { session } = useAuth();
  const location = useLocation();
  const inOrganizer = location.pathname.startsWith("/organizer");

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <motion.img
            src={logo} alt="" className="h-8 w-8 rounded-md"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
          <span className="wordmark text-2xl uppercase leading-none">Matchday</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/leaderboard" className={cx("hidden text-xs font-medium sm:inline", location.pathname === "/leaderboard" ? "text-teal-700" : "text-stone-500 hover:text-stone-800")}>Leaderboard</Link>
          <div className="relative hidden items-center gap-0.5 rounded-md border border-stone-200 bg-stone-100 p-0.5 sm:flex">
            <motion.div
              className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded bg-white shadow-sm"
              animate={{ x: inOrganizer ? "100%" : "0%" }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
            <Link to="/" className={cx("relative z-10 rounded px-3 py-1.5 text-xs font-medium", !inOrganizer ? "text-stone-900" : "text-stone-500")}>Public site</Link>
            <Link to="/organizer" className={cx("relative z-10 rounded px-3 py-1.5 text-xs font-medium", inOrganizer ? "text-stone-900" : "text-stone-500")}>Organizer</Link>
          </div>
          {session ? (
            <button className="text-xs font-medium text-stone-500 hover:text-stone-800" onClick={() => signOut()}>Sign out</button>
          ) : (
            <Link to="/login" className="text-xs font-medium text-stone-500 hover:text-stone-800">Organizer sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <Routes location={location}>
          <Route path="/" element={<PublicDiscovery />} />
          <Route path="/t/:slug" element={<PublicTournamentPage />} />
          <Route path="/p/:id" element={<PlayerProfile />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/login" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/organizer" element={<RequireAuth><OrganizerDashboard /></RequireAuth>} />
          <Route path="/organizer/:id" element={<RequireAuth><TournamentControlCenter /></RequireAuth>} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function Shell() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <AnimatedRoutes />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-center text-[11px] text-stone-400">
        Payments shown in this build are simulated — no real charge is made.
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </BrowserRouter>
    </MotionConfig>
  );
}
