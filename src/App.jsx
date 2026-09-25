import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { BrandLoader } from "./components/ui/motion";
import NavOverlay from "./components/ui/NavOverlay";
import Cursor from "./components/ui/Cursor";
// Purely decorative. It is now static SVG rather than the GSAP timelines it
// used to run, so the chunk is small — but it is still off the critical path
// between a shared tournament link and the score someone opened it to see,
// and nothing depends on it being present.
const SportsBackground = lazy(() => import("./components/ui/SportsBackground"));
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
import { paymentsAreLive } from "./lib/payments";
import { cx } from "./lib/engines";
import { Compass, CalendarDays, Trophy, Gavel, User, Moon, Sun, HelpCircle, X } from "lucide-react";

const THEME_STORAGE_KEY = "matchday-theme-v2";

function initialTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // A blocked localStorage should never prevent the app from rendering.
  }
  return "dark";
}

function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme);
  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content", isDark ? "#111817" : "#e8f0ed"
    );
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* no-op */ }
  }, [theme, isDark]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="md-theme-toggle flex items-center justify-between rounded-full border px-3.5 font-semibold transition-colors"
    >
      <Sun size={18} aria-hidden="true" className="md-theme-sun shrink-0" />
      <span className="text-base leading-none">{isDark ? "Dark" : "Light"}</span>
      <span className="md-theme-track relative shrink-0 rounded-full" aria-hidden="true">
        <span className={cx("md-theme-knob absolute rounded-full transition-transform duration-200", isDark ? "md-theme-knob-dark" : "md-theme-knob-light")} />
      </span>
      <Moon size={18} aria-hidden="true" className="md-theme-moon shrink-0" />
    </button>
  );
}

function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <BrandLoader />;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

// ═══════════════════════════════════════════════════════════════════════
// NAVIGATION — capability-driven, one account
// ═══════════════════════════════════════════════════════════════════════
//
// MatchDay is one account that can simultaneously play, organize and
// officiate, so navigation is a list of the surfaces this person actually
// has, not an account type chosen at signup. Discover is always present;
// Play and Organize appear once signed in (creating a tournament is how you
// become an organizer, not a separate registration); Officiate appears only
// once someone has been assigned a refereeing or scoring role.
//
// The switcher is rendered as underlined display-type tabs rather than the
// segmented pill it used to be. A pill reads as a settings toggle — three
// equal options, pick one. These are destinations, and the condensed caps
// treatment matches the headline type used across the product.

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
  if (pathname.startsWith("/leaderboard")) return "rankings";
  return "public";
}

function Wordmark({ className = "" }) {
  return (
    <span className={cx("wordmark uppercase leading-none", className)}>
      Match<span className="wordmark-accent">day</span>
    </span>
  );
}

const GUIDE_SECTIONS = [
  {
    icon: User,
    title: "Player journey",
    intro: "Find an event, register, prepare, and follow every point.",
    steps: [
      "Browse tournaments from Discover, then use search, sport, status, and filters to find the right event.",
      "Open a tournament to read its categories, fees, venue, dates, participants, draw, schedule, courts, and live matches.",
      "Choose a category and register. Complete your details, partner details for doubles, and any organizer questions.",
      "Use your player dashboard to see payment status, check-in instructions, upcoming matches, results, and ranking history.",
      "Open a match to follow live scores. Your profile collects completed results and tournament history."
    ]
  },
  {
    icon: Trophy,
    title: "Organizer journey",
    intro: "Set up the competition, run the day, and publish the result.",
    steps: [
      "Create a tournament with its name, venue, dates, sport, registration rules, categories, fees, and courts.",
      "Review entries in Participants. Approve or manage registration status, check players in, and assign seeds where needed.",
      "Create the draw using the category format. The draw determines rounds, pairings, and progression.",
      "Schedule matches across available courts. Resolve conflicts, move matches, and keep players informed.",
      "Monitor Live Scoring, results, disputes, staff, and tournament health from the control center.",
      "Publish the tournament link so players and viewers can follow the public draw, schedule, courts, results, and live matches."
    ]
  },
  {
    icon: Gavel,
    title: "Match keeper / scorer journey",
    intro: "Keep one court accurate, clear, and up to date.",
    steps: [
      "Open the assigned match or scorer link and confirm the court and two sides before starting.",
      "Start the match when both players or pairs are ready. The scorer records each rally using the score controls.",
      "The current game, server, game history, and match total remain visible throughout play.",
      "Pause or correct only when necessary. If a completed score needs correction, use the organizer dispute workflow.",
      "Finish the match only after the final game is correct. The result then flows to the draw, schedule, player history, and public page."
    ]
  },
  {
    icon: Compass,
    title: "Viewer journey",
    intro: "Follow a tournament without an account.",
    steps: [
      "Open the public tournament link shared by the organizer.",
      "Use Participants, Draw, Schedule, Courts, Results, and Live to find the information you need.",
      "Open a live match for the latest score and court status. Completed matches show their game-by-game result.",
      "Share the tournament or match link with family, teammates, and supporters. No sign-in is needed for public information."
    ]
  }
];

function HelpGuide({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-navy-950/75 p-3 backdrop-blur-sm sm:p-8" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-ink shadow-2xl sm:max-h-[calc(100dvh-4rem)] sm:p-8" role="dialog" aria-modal="true" aria-labelledby="matchday-guide-title">
        <div className="flex items-start justify-between gap-4 border-b border-line-soft pb-5">
          <div>
            <div className="md-eyebrow text-accent-teal">Getting started</div>
            <h2 id="matchday-guide-title" className="md-display mt-1 text-3xl text-ink sm:text-4xl">How MatchDay works</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">A simple guide for every person who enters a tournament—from first discovery to the final result.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close help guide" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:border-accent-teal hover:text-ink"><X size={18} /></button>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {GUIDE_SECTIONS.map(({ icon: Icon, title, intro, steps }) => (
            <article key={title} className="rounded-xl border border-line bg-surface-2 p-4 sm:p-5">
              <div className="flex items-center gap-2 text-accent-teal"><Icon size={18} /><h3 className="font-semibold text-ink">{title}</h3></div>
              <p className="mt-2 text-sm text-ink-2">{intro}</p>
              <ol className="mt-3 space-y-2.5 pl-5 text-sm leading-relaxed text-ink-2">
                {steps.map((step) => <li key={step} className="pl-1 marker:font-bold marker:text-accent-teal">{step}</li>)}
              </ol>
            </article>
          ))}
        </div>
        <p className="mt-6 rounded-lg border border-accent-teal/25 bg-accent-teal/10 p-3 text-sm text-ink-2"><strong className="text-ink">Tip:</strong> If you are unsure where to go, start with Discover. A public tournament page is always the best place to see what is happening, while an account unlocks player and organizer actions.</p>
      </section>
    </div>
  );
}

// The bottom bar a phone gets in place of the header's switcher. Sized for
// thumbs: 56px of height plus the safe-area inset, and the whole cell is the
// tap target rather than just the label.
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
              key={s.key}
              to={s.to}
              aria-current={on ? "page" : undefined}
              className={cx(
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                on ? "text-accent-teal" : "text-ink-3"
              )}
            >
              {/* The active court line sits on top of the bar, echoing the
                  same marker used by tabs and section headers. */}
              {on && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent-teal" />}
              <s.icon size={19} strokeWidth={on ? 2.4 : 2} />
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // The header stays legible over whatever is behind it, but only earns its
  // border and blur once the page has actually moved — at the very top of a
  // hero it should feel like part of the composition, not a bar bolted on.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    // Passive: this listener must never be able to delay a scroll frame.
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A route change closes the menu. Without this, following a link inside
  // the overlay navigates behind a panel that stays open.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  return (
    <header
      className={cx(
        "sticky top-0 z-30 transition-colors duration-300",
        scrolled ? "border-b border-line bg-canvas/85 backdrop-blur-xl" : "border-b border-transparent"
      )}
    >
      <div className="md-header-inner mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link to="/" className="md-group flex shrink-0 items-center gap-2" aria-label="MatchDay home">
          {/* The mark tilts a few degrees toward the wordmark on hover and
              settles back — a single, short, physical acknowledgement rather
              than a looping logo animation. */}
          <Wordmark className="text-xl sm:text-3xl" />
        </Link>

        {/* Desktop switcher. Hidden below `sm`, where MobileSurfaceNav takes
            over at the bottom of the screen. */}
        <nav className="hidden items-center gap-5 sm:flex" aria-label="Experience">
          {surfaces.map((s) => {
            const on = surface === s.key;
            return (
              <Link
                key={s.key}
                to={s.to}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "relative py-4 text-[13px] font-semibold uppercase tracking-wider transition-colors",
                  on ? "text-ink" : "text-ink-3 hover:text-ink-2"
                )}
              >
                {s.label}
                {on && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent-teal" />}
              </Link>
            );
          })}
          <Link
            to="/leaderboard"
            aria-current={surface === "rankings" ? "page" : undefined}
            className={cx(
              "relative py-4 text-[13px] font-semibold uppercase tracking-wider transition-colors",
              surface === "rankings" ? "text-ink" : "text-ink-3 hover:text-ink-2"
            )}
          >
            Rankings
            {surface === "rankings" && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent-teal" />}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="Open MatchDay guide"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-2 transition-colors hover:border-accent-teal hover:text-ink"
          >
            <HelpCircle size={17} />
          </button>
          {session ? (
            <>
              <span className="md-mobile-hide-notification"><NotificationCenter userId={session.user.id} /></span>
              {/* The account entry point. An avatar-shaped target rather than
                  a text link: it is the one control whose position should be
                  identical on every screen in the product. */}
              <Link
                to="/me/profile"
                aria-label="Your profile and settings"
                className="md-profile-trigger flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-2 transition-colors hover:border-accent-teal hover:text-ink"
              >
                <User size={15} />
              </Link>
              <button
                className="hidden text-xs font-medium text-ink-3 transition-colors hover:text-ink sm:block"
                onClick={() => signOut()}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              {/* The one thing a signed-out visitor cannot otherwise discover:
                  that they can run their own tournament here, not just browse
                  other people's. Hidden on /host, where it would point at the
                  page already being read. Visible at every width — a mobile
                  visitor is not less likely to want to organize. */}
              {location.pathname !== "/host" && (
                <Link
                  to="/host"
                  className="hidden rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-accent-teal hover:text-accent-teal sm:inline-block"
                >
                  Host a tournament
                </Link>
              )}
              <Link
                to="/login"
                className="hidden rounded-md bg-accent-teal px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-navy-950 transition-[filter] hover:brightness-110 sm:inline-block"
              >
                Sign in
              </Link>
            </>
          )}

          {/* The menu trigger. Present at every width — on a phone it is the
              only route to Rankings and the account links, and on desktop it
              reaches the full destination list without crowding the header
              with every link the product has. */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            className="md-menu-trigger md-group flex h-9 items-center gap-2 rounded-full border border-line px-3 text-xs font-bold uppercase tracking-wider text-ink-2 transition-colors hover:border-accent-teal hover:text-ink"
          >
            <span className="flex flex-col gap-[3px]" aria-hidden="true">
              <span className="block h-px w-4 bg-current transition-transform duration-300 group-hover:translate-x-0.5" />
              <span className="block h-px w-4 bg-current" />
              <span className="block h-px w-4 bg-current transition-transform duration-300 group-hover:-translate-x-0.5" />
            </span>
            <span className="max-sm:hidden">Menu</span>
          </button>
        </div>
      </div>

      <NavOverlay
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        surfaces={surfaces}
        currentSurface={surface}
        session={session}
        onSignOut={() => signOut()}
      />
      <HelpGuide open={helpOpen} onClose={() => setHelpOpen(false)} />
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
    // `mode="wait"` so the outgoing page finishes leaving before the next
    // one arrives — the two never overlap, which is what stops a route change
    // from reading as a flicker. Timings are deliberately short (180/260ms):
    // a page transition is connective tissue, and anything longer puts a
    // delay between a tap and the content on every single navigation.
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
    // `overflow-x: clip` (NOT hidden) absorbs the few pixels a `100vw`
    // full-bleed section overhangs by when a vertical scrollbar is present,
    // so the page can never scroll sideways. `clip` is deliberate: `hidden`
    // would make this a scroll container and break the sticky header.
    <div className="relative flex min-h-screen flex-col [overflow-x:clip] text-ink">
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
      {/* Site chrome only. Scorer Mode and the Venue Display render outside
          the Shell — a courtside phone and an unattended TV have no pointer
          worth decorating. It also self-disables on touch and reduced motion. */}
      <Cursor />
      <Header />
      {/* Bottom padding clears the mobile nav bar so the last card is never
          trapped underneath it. */}
      {/* flex-1 so a short page (an empty leaderboard, a 404) still pushes
          the footer to the bottom of the viewport. Without it the footer
          floated in the middle of the screen with dead space beneath, which
          reads as a broken page rather than an empty one. */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:pb-6">
        <AnimatedRoutes />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-24 pt-4 text-center text-[11px] text-ink-3 sm:pb-8">
        {/* Only shown while the mock provider is active. The moment a real
            Razorpay key is configured this disappears, because claiming a real
            charge is simulated is as dishonest as the reverse. */}
        {!paymentsAreLive() && "Payments shown in this build are simulated — no real charge is made."}
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
