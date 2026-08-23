import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { BrandLoader } from "./components/ui/motion";
// Purely decorative, and it pulls in GSAP — the single largest dependency in
// the app. Loading it lazily keeps ~100KB of animation library off the path
// between a shared tournament link and the score someone opened it to see.
// It fades in a moment later; nothing depends on it being present.
const SportsBackground = lazy(() => import("./components/ui/SportsBackground"));
import logo from "./assets/logo.png";
import { signOut } from "./lib/repository";
import PublicDiscovery from "./pages/PublicDiscovery";
import PublicTournamentPage from "./pages/PublicTournamentPage";
import PlayerProfile from "./pages/PlayerProfile";
import PlayerDashboard from "./pages/PlayerDashboard";
import MatchDetail from "./pages/MatchDetail";
import Officiate from "./pages/Officiate";
import SeriesPage from "./pages/SeriesPage";
import NotificationCenter from "./components/NotificationCenter";
import Leaderboard from "./pages/Leaderboard";
import HostLanding from "./pages/HostLanding";

// Split out of the initial bundle. These are the heaviest screens in the app
// and none of them is on the path a first-time visitor takes: someone landing
// on a shared tournament link should not download the whole organizer control
// center, the scheduling grid and the scorer before the page renders.
const OrganizerDashboard = lazy(() => import("./pages/OrganizerDashboard"));
const TournamentControlCenter = lazy(() => import("./pages/TournamentControlCenter"));
const ScorerMode = lazy(() => import("./pages/ScorerMode"));
const VenueDisplay = lazy(() => import("./pages/VenueDisplay"));
const PlayerSettings = lazy(() => import("./pages/PlayerSettings"));
import SignIn from "./pages/auth/SignIn";
import SignUp from "./pages/auth/SignUp";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import NotFound from "./pages/NotFound";
import ErrorBoundary from "./components/ErrorBoundary";
import { trackPageView } from "./lib/productAnalytics";
import { cx } from "./lib/engines";
import { Compass, CalendarDays, Trophy, Gavel } from "lucide-react";

function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <BrandLoader />;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

// One account, many roles — so the header shows the capabilities this user
// actually has rather than a fixed set of "account modes". Discover and Play
// are always there; Organize appears for everyone (creating a tournament is
// how you become an organizer, not a separate signup); Officiate appears only
// once someone has actually been assigned a refereeing or scoring role.
function surfacesFor(caps) {
  const list = [
    { key: "public", label: "Discover", to: "/", icon: Compass },
  ];
  if (caps?.signedIn) {
    list.push({ key: "player", label: "Play", to: "/me", icon: CalendarDays });
    list.push({ key: "organizer", label: "Organize", to: "/organizer", icon: Trophy });
    if (caps.officiates > 0) list.push({ key: "officiate", label: "Officiate", to: "/officiate", icon: Gavel });
  }
  return list;
}

function surfaceOf(pathname) {
  if (pathname.startsWith("/organizer")) return "organizer";
  if (pathname.startsWith("/officiate")) return "officiate";
  if (pathname.startsWith("/me")) return "player";
  return "public";
}

// The desktop header hides its surface switcher below `sm`, which left a
// phone user with no way to move between playing, organizing and officiating
// at all. This is that switcher, as the bottom bar the pattern calls for on a
// phone — same capability list, same single account.
function MobileSurfaceNav() {
  const { caps } = useAuth();
  const location = useLocation();
  const surfaces = surfacesFor(caps);
  const current = surfaceOf(location.pathname);

  // Nothing to switch between when signed out — one entry is not navigation.
  if (surfaces.length < 2) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      aria-label="Switch experience"
    >
      <div className="flex">
        {surfaces.map((s) => {
          const on = current === s.key;
          return (
            <Link
              key={s.key} to={s.to}
              aria-current={on ? "page" : undefined}
              className={cx(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                on ? "text-accent-teal" : "text-ink-3"
              )}
            >
              <s.icon size={18} />
              {s.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Header() {
  const { session, caps } = useAuth();
  const location = useLocation();
  const surfaces = surfacesFor(caps);
  const surface = surfaceOf(location.pathname);
  const rawIndex = surfaces.findIndex((s) => s.key === surface);
  const surfaceIndex = rawIndex < 0 ? 0 : rawIndex;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
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
          <Link to="/leaderboard" className={cx("hidden text-xs font-medium sm:inline", location.pathname === "/leaderboard" ? "text-accent-teal" : "text-ink-2 hover:text-ink")}>Leaderboard</Link>
          <div className="relative hidden items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 sm:flex">
            <motion.div
              className="absolute inset-y-0.5 left-0.5 rounded bg-surface-3"
              style={{ width: `calc(${100 / surfaces.length}% - 2px)` }}
              animate={{ x: `${surfaceIndex * 100}%` }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
            {surfaces.map((s) => (
              <Link key={s.key} to={s.to}
                className={cx("relative z-10 rounded px-3 py-1.5 text-xs font-medium", surface === s.key ? "text-ink" : "text-ink-3")}>
                {s.label}
              </Link>
            ))}
          </div>
          {session ? (
            <>
              <NotificationCenter userId={session.user.id} />
              <button className="text-xs font-medium text-ink-2 hover:text-ink" onClick={() => signOut()}>Sign out</button>
            </>
          ) : (
            <>
              {/* The one thing a signed-out visitor cannot otherwise discover:
                  that they can run their own tournament here, not just browse
                  other people's. Hidden on /host, where it would point at the
                  page already being read. */}
              {location.pathname !== "/host" && (
                <Link
                  to="/host"
                  className="hidden rounded-md bg-accent-teal px-2.5 py-1.5 text-xs font-semibold text-navy-950 hover:brightness-110 sm:inline-block"
                >
                  Host a tournament
                </Link>
              )}
              <Link to="/login" className="text-xs font-medium text-ink-2 hover:text-ink">Sign in</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  // Product analytics: which screens people actually reach. Ids are stripped
  // from the path inside trackPageView, so this records "/t/:id", never which
  // tournament a particular person looked at.
  useEffect(() => { trackPageView(location.pathname); }, [location.pathname]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {/* Keyed to the path so navigating away from a crashed page clears
            the error — otherwise one broken tournament would leave the
            boundary stuck open across every later route. */}
        <ErrorBoundary key={location.pathname} name="route" source="route">
        {/* Lazy routes need a fallback while their chunk downloads. BrandLoader
            is the same loader used everywhere else, so a split route is
            indistinguishable from a slow fetch. */}
        <Suspense fallback={<BrandLoader />}>
        <Routes location={location}>
          <Route path="/" element={<PublicDiscovery />} />
          <Route path="/t/:slug" element={<PublicTournamentPage />} />
          <Route path="/p/:id" element={<PlayerProfile />} />
          {/* Match detail is public — a spectator with the link sees the same
              page, minus the officials RLS keeps private. */}
          <Route path="/m/:id" element={<MatchDetail />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          {/* Organizer acquisition. Deliberately a real route, not a modal or a
              marketing site on another domain, so it can be linked, shared and
              indexed like any other page. */}
          <Route path="/host" element={<HostLanding />} />
          <Route path="/login" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          {/* The address Supabase mails the recovery link to. It is public by
              necessity — the one-time token in the URL is what authorises it. */}
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/me" element={<RequireAuth><PlayerDashboard /></RequireAuth>} />
          <Route path="/me/profile" element={<RequireAuth><PlayerSettings /></RequireAuth>} />
          <Route path="/officiate" element={<RequireAuth><Officiate /></RequireAuth>} />
          {/* Series standings are public, like any published result; the
              management controls inside only render for the series owner. */}
          <Route path="/series/:id" element={<SeriesPage />} />
          <Route path="/organizer" element={<RequireAuth><OrganizerDashboard /></RequireAuth>} />
          <Route path="/organizer/:id" element={<RequireAuth><TournamentControlCenter /></RequireAuth>} />
          {/* Anything else. Previously these rendered an empty page, which
              reads as a broken app rather than a wrong address. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}

function Shell() {
  return (
    <div className="relative min-h-screen text-ink">
      {/* Keyboard users land on the header links on every page load; without
          this they have to tab past the whole nav to reach the content. It is
          invisible until focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent-teal focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy-950"
      >
        Skip to content
      </a>
      {/* No fallback: the background is decoration, and a placeholder for it
          would be more distracting than its brief absence. */}
      <Suspense fallback={null}><SportsBackground /></Suspense>
      <Header />
      {/* Bottom padding clears the mobile nav bar so the last card is never
          trapped underneath it. */}
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:pb-6">
        <AnimatedRoutes />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-24 pt-4 text-center text-[11px] text-ink-3 sm:pb-8">
        Payments shown in this build are simulated — no real charge is made.
      </footer>
      <MobileSurfaceNav />
    </div>
  );
}

// Scorer Mode and the Venue Display live outside the normal Shell chrome —
// full-bleed, no header/footer, since both are meant to run standalone on a
// courtside phone or a venue TV rather than inside the site's frame.
function BareRoutes() {
  return (
    // Both of these are lazy, and both run unattended (a venue TV, a scorer's
    // phone), so a crash needs a visible boundary rather than a blank screen
    // nobody is watching closely enough to report.
    <ErrorBoundary name="bare" source="bare-route">
      <Suspense fallback={<BrandLoader />}>
        <Routes>
          <Route path="/t/:slug/display" element={<VenueDisplay />} />
          <Route path="/organizer/:id/score" element={<RequireAuth><ScorerMode /></RequireAuth>} />
          <Route path="/*" element={<Shell />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    // The outermost boundary is the last resort: it catches failures in the
    // shell itself (auth, routing, the background) that the per-route
    // boundary sits inside of and therefore cannot see.
    <ErrorBoundary name="app" source="app-root">
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <AuthProvider>
            <BareRoutes />
          </AuthProvider>
        </BrowserRouter>
      </MotionConfig>
    </ErrorBoundary>
  );
}
