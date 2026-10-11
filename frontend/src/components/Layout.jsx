import React, { memo, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle, BarChart3, Banknote, FileText, Fuel, Gauge, LogOut, Menu, Plus, Receipt,
  Search, Settings as Cog, ShieldCheck, Truck, User, Users, UsersRound, Wallet, X, ArrowRight, Building2,
} from "lucide-react";
import { api, errMsg } from "../lib/api";
import { dmyDateTime } from "../lib/format";
import { hasAdminAccess } from "../lib/adminAccess";
import EntryModal from "./QuickForms";
import { Badge, toast } from "./ui";

const APP_LOGO = "/app-icon.png";

function BrandLogo({ src, name, className }) {
  const [failedSource, setFailedSource] = useState("");
  const [fallbackFailed, setFallbackFailed] = useState(false);
  useEffect(() => {
    setFailedSource("");
    setFallbackFailed(false);
  }, [src]);

  const imageSrc = failedSource ? APP_LOGO : (src || APP_LOGO);
  if (fallbackFailed) {
    return <span role="img" aria-label={`${name || "Business"} logo unavailable`}
      className={`${className} grid place-items-center bg-white text-lg font-bold text-brand-700`}>
      {(name || "B").trim().charAt(0).toUpperCase()}
    </span>;
  }

  return <img src={imageSrc} alt={`${name || "Business"} logo`}
    data-testid="brand-logo" className={className}
    onError={() => {
      if (imageSrc === APP_LOGO) setFallbackFailed(true);
      else setFailedSource(imageSrc);
    }} />;
}

const NAV = [
  { to: "/dashboard", label: "Industrial Dashboard", icon: Building2, accessKey: "industrial_dashboard",
    activeWhen: (location) => location.pathname === "/dashboard" },
  { to: "/trips?tab=trips", label: "Industrial Trips", icon: Truck, key: "trips", accessKey: "industrial_trips",
    activeWhen: (location) => location.pathname === "/trips" && new URLSearchParams(location.search).get("tab") !== "lrs" },
  { to: "/trips?tab=lrs", label: "Industrial LRs", icon: FileText, key: "trips", accessKey: "industrial_lrs",
    activeWhen: (location) => location.pathname === "/trips" && new URLSearchParams(location.search).get("tab") === "lrs" },
  { to: "/vehicles", label: "Vehicles", icon: Gauge, key: "vehicles", accessKey: "industrial_vehicles" },
  { to: "/parties", label: "Parties", icon: Users, key: "parties", accessKey: "industrial_parties" },
  { to: "/team", label: "Team", icon: UsersRound, key: "team", accessKey: "industrial_team" },
  { to: "/finance", label: "Industrial Finance", icon: Wallet, key: "finance", accessKey: "industrial_finance" },
  { to: "/reports", label: "Industrial Reports", icon: BarChart3, key: "reports", accessKey: "industrial_reports" },
  { to: "/settings", label: "Office Settings", icon: Cog, key: "settings", accessKey: "industrial_settings" },
];

const PLATFORM_NAV = [
  { to: "/platform", label: "Clients", icon: Building2,
    activeWhen: (location) => location.pathname === "/platform" },
  { to: "/platform/plans", label: "Plans & pricing", icon: ShieldCheck,
    activeWhen: (location) => location.pathname === "/platform/plans" },
  { to: "/platform/errors", label: "Error logs", icon: AlertTriangle,
    activeWhen: (location) => location.pathname === "/platform/errors" },
  { to: "/settings", label: "Platform settings", icon: Cog },
];

const SITE_NAV = { to: "/booking/dashboard", label: "Dashboard", icon: Building2 };
const BOOKING_NAV = [
  { to: "/booking/receipts", label: "Receipts", icon: FileText },
  { to: "/booking/ledger", label: "Ledger", icon: Banknote },
];
const OWNER_BOOKING_NAV = [
  { to: "/booking-setup", label: "Booking settings", icon: Cog, accessKey: "booking_settings" },
  { to: "/booking/finance", label: "Booking Finance", icon: Wallet, accessKey: "booking_finance" },
  { to: "/booking/audit", label: "Booking Audit", icon: ShieldCheck, accessKey: "booking_audit" },
];
const BOOKING_HEADER_NAV = [
  SITE_NAV,
  ...BOOKING_NAV,
  { to: "/booking/finance", label: "Finance", icon: Wallet },
  { to: "/booking/audit", label: "Audit", icon: ShieldCheck },
  { to: "/booking-setup", label: "Settings", icon: Cog },
];

const QUICK = [
  { kind: "trip", label: "Create Trip", icon: Truck },
  { kind: "lr", label: "Create LR", icon: FileText },
  { kind: "collection", label: "Collection", icon: Banknote },
  { kind: "payment", label: "Payment", icon: Wallet },
  { kind: "expense", label: "Expense", icon: Receipt },
  { kind: "fuel", label: "Diesel", icon: Fuel },
];

const CurrentTime = memo(function CurrentTime() {
  const [clockNow, setClockNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time className="ml-auto shrink-0 text-right text-xs font-semibold text-muted sm:text-sm"
      aria-label="Current India Standard Time">
      {dmyDateTime(clockNow, true)}
    </time>
  );
});

const navIsActive = (item, location) => {
  if (item.activeWhen) return item.activeWhen(location);
  return item.to === "/booking/dashboard"
    ? location.pathname === "/booking" || location.pathname === "/booking/dashboard"
    : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
};

export default function Layout({ user, children, syncStatus = "checking" }) {
  const [menu, setMenu] = useState(false);
  const [isOnline, setIsOnline] = useState(() => window.navigator.onLine);
  const [sheet, setSheet] = useState(false);
  const [entry, setEntry] = useState(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(window.navigator.onLine);
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => { setMenu(false); setSheet(false); }, [loc.pathname, loc.search]);

  useEffect(() => {
    let active = true;
    const query = q.trim();
    if (query.length < 2) {
      setRes([]);
      setSearchBusy(false);
      setSearchError("");
      return () => { active = false; };
    }
    setSearchBusy(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      api.get("/search", { params: { q: query } })
        .then((response) => {
          if (active) setRes(response.data || []);
        })
        .catch(() => {
          if (active) setSearchError("Search is temporarily unavailable. Try again in a moment.");
        })
        .finally(() => {
          if (active) setSearchBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q]);

  const exitSupport = async () => {
    try {
      await api.post("/platform/support-session/end");
      sessionStorage.removeItem("fms_support_token");
      window.dispatchEvent(new Event("fms:auth-changed"));
      nav("/platform");
    } catch (error) {
      toast(errMsg(error), "err");
    }
  };

  const logout = () => {
    if (user?.platform_support) return exitSupport();
    sessionStorage.removeItem("fms_support_token");
    localStorage.removeItem("fms_token");
    window.location.href = "/login";
  };

  const quick = (kind) => {
    setSheet(false);
    if (kind === "trip") return nav("/trips/new");
    if (kind === "lr") return nav("/lrs/new");
    setEntry(kind);
  };

  const bizLogo = user?.role === "superadmin" ? APP_LOGO : user?.branding?.logo;
  const bizName = user?.role === "superadmin" ? "ProFleet" : (user?.tenant_name || user?.branding?.name || "ProFleet");
  const photo = user?.photo;
  const isSiteBookingRoute = loc.pathname === "/booking" || loc.pathname.startsWith("/booking/")
    || loc.pathname === "/sites" || loc.pathname.startsWith("/sites/")
    || loc.pathname === "/booking-finance" || loc.pathname === "/booking-reports"
    || loc.pathname === "/booking-setup";
  const allowedIndustrialNav = NAV.filter((item) =>
    hasAdminAccess(user, item.accessKey) && (!item.key || user?.features?.[item.key] !== false));
  const allowedOwnerBookingNav = OWNER_BOOKING_NAV.filter((item) => hasAdminAccess(user, item.accessKey));
  const showIndustrialTools = user?.role === "owner" && !isSiteBookingRoute && allowedIndustrialNav.length > 0;
  const quickActions = QUICK.filter(({ kind }) => {
    if (kind === "trip") return hasAdminAccess(user, "industrial_trips");
    if (kind === "lr") return hasAdminAccess(user, "industrial_lrs");
    return hasAdminAccess(user, "industrial_finance");
  });
  const showQuickActions = showIndustrialTools && quickActions.length > 0;
  const navItems = user?.role === "superadmin" ? PLATFORM_NAV
    : user?.role === "site_manager"
      ? (hasAdminAccess(user, "booking") ? [SITE_NAV, ...BOOKING_NAV] : [])
      : [
        ...(hasAdminAccess(user, "booking") ? [SITE_NAV, ...BOOKING_NAV, ...allowedOwnerBookingNav] : []),
        ...allowedIndustrialNav,
      ];
  const mobileNav = user?.role === "superadmin" ? PLATFORM_NAV
    : user?.role === "site_manager"
      ? (hasAdminAccess(user, "booking") ? [SITE_NAV, ...BOOKING_NAV] : [])
      : showIndustrialTools
        ? [NAV[0], NAV[1], NAV[3], NAV[6], NAV[7]].filter((item) =>
          hasAdminAccess(user, item.accessKey) && (!item.key || user?.features?.[item.key] !== false))
        : [
          ...(hasAdminAccess(user, "booking") ? [SITE_NAV, ...BOOKING_NAV] : []),
          ...allowedOwnerBookingNav,
        ].slice(0, 4);
  const navGroups = user?.role === "owner" ? [
    ...(hasAdminAccess(user, "booking") || allowedOwnerBookingNav.length ? [{
      label: "Site booking",
      items: [
        ...(hasAdminAccess(user, "booking") ? [SITE_NAV, ...BOOKING_NAV] : []),
        ...allowedOwnerBookingNav,
      ],
    }] : []),
    ...(allowedIndustrialNav.length ? [{ label: "Industrial operations", items: allowedIndustrialNav }] : []),
  ] : [{ label: user?.role === "superadmin" ? "Administration" : "Workspace", items: navItems }];

  const Side = (
    <>
      <div className="flex items-center gap-3 px-5 py-5">
        <BrandLogo src={bizLogo} name={bizName}
          className="app-brand-mark h-14 w-14 shrink-0 rounded-xl bg-white object-contain ring-1 ring-white/10" />
        <div className="min-w-0">
          <p className="truncate font-head text-[15.5px] font-bold leading-none text-white">{bizName}</p>
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-white/45">
            {user?.platform_support ? "Platform support"
              : user?.role === "superadmin" ? "Platform control"
                : user?.role === "site_manager" ? "Site operations" : "Fleet operations"}
          </p>
        </div>
      </div>
      <nav aria-label="Main navigation" className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {navGroups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-white/35">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((n) => (
                <Link key={n.to} to={n.to} aria-current={navIsActive(n, loc) ? "page" : undefined}
                  data-testid={`nav-${n.label.toLowerCase().replace(/[^a-z]/g, "-")}`}
                  className={`app-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-colors ${
                    navIsActive(n, loc) ? "is-active text-white" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
                  <n.icon size={18} strokeWidth={1.8} /> {n.label}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </nav>
      <div className="border-t border-white/10 px-3 py-3">
        <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[.045] px-2 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {photo
              ? <img src={photo} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white/20" />
              : <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white">
                  <User size={16} />
                </div>}
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-white">{user?.name || "Owner"}</p>
              <p className="text-[11.5px] text-white/40">Signed in</p>
            </div>
          </div>
          <button onClick={logout} data-testid="logout-btn" className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white">
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <aside className="app-sidebar fixed inset-y-0 left-0 z-40 hidden w-60 flex-col md:flex">{Side}</aside>

      {menu && (
        <div className="fixed inset-0 z-50 md:hidden" data-testid="mobile-navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-ink/55 backdrop-blur-[2px]"
            onClick={() => setMenu(false)} />
          <aside className="app-sidebar absolute inset-y-0 left-0 flex w-[min(84vw,300px)] flex-col row-anim">{Side}</aside>
        </div>
      )}

      <div className="md:pl-60 print:!pl-0">
        <header className="app-header sticky top-0 z-30 border-b border-line">
          <div className="flex items-center gap-2 px-4 py-3 md:px-7">
            <button onClick={() => setMenu(true)} data-testid="menu-btn" aria-label="Open navigation"
              aria-expanded={menu} className="rounded-lg p-2 text-ink hover:bg-brand-50 md:hidden">
              <Menu size={21} />
            </button>
            <BrandLogo src={bizLogo} name={bizName}
              className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain md:hidden" />
            {showIndustrialTools && (
            <div className="relative flex-1 md:max-w-md">
              <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input data-testid="global-search" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search vehicle, driver, party, trip, LR…"
                aria-label="Search vehicles, drivers, parties, trips, and lorry receipts"
                aria-expanded={q.trim().length > 1}
                aria-controls="global-search-results"
                className="fld py-2 pl-9 text-[14px]" />
              {q.trim().length > 1 && (
                <div id="global-search-results" role="region" aria-label="Search results"
                  className="absolute z-40 mt-1.5 max-h-[60vh] w-full overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-xl">
                  {searchBusy && <p role="status" className="px-3 py-3 text-[13px] text-muted">Searching…</p>}
                  {!searchBusy && searchError &&
                    <p role="alert" className="px-3 py-3 text-[13px] text-red-700">{searchError}</p>}
                  {!searchBusy && !searchError && res.length === 0 &&
                    <p className="px-3 py-3 text-[13px] text-muted">No match found</p>}
                  {!searchBusy && !searchError && res.map((r, i) => (
                    <button key={i} data-testid={`search-result-${i}`}
                      onClick={() => { nav(r.link); setQ(""); }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-brand-50">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-ink">{r.title}</p>
                        <p className="truncate text-[12.5px] text-muted">{r.subtitle}</p>
                      </div>
                      <Badge>{r.type}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
            {user?.platform_support && (
              <div className="flex min-w-0 items-center justify-end gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-950 sm:flex-initial sm:px-3">
                <span className="max-w-48 truncate text-[10px] font-semibold sm:text-xs">
                  <span className="sm:hidden">Support mode</span>
                  <span className="hidden sm:inline">Support mode · {user.tenant_name}</span>
                </span>
                <button type="button" data-testid="exit-platform-support"
                  onClick={exitSupport}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-bold hover:bg-amber-100">
                  Exit client
                </button>
              </div>
            )}
            {user?.role === "superadmin" && <div className="flex-1" />}
            <span role="status" aria-live="polite" data-testid="sync-status"
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-1 text-[10px] font-semibold sm:gap-1.5 sm:px-2 sm:text-xs ${
                !isOnline ? "bg-red-50 text-red-800"
                  : syncStatus === "connected" ? "bg-green-50 text-green-800"
                    : syncStatus === "reconnecting" ? "bg-amber-50 text-amber-900"
                      : "bg-gray-100 text-gray-700"
              }`}>
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${
                !isOnline ? "bg-red-600"
                  : syncStatus === "connected" ? "bg-green-600"
                    : syncStatus === "reconnecting" ? "bg-amber-500" : "bg-gray-500"
              }`} />
              <span className="sm:hidden">{!isOnline ? "Offline"
                : syncStatus === "connected" ? "Live"
                  : syncStatus === "reconnecting" ? "Retrying"
                    : "Checking"}</span>
              <span className="hidden sm:inline">{!isOnline ? "Offline · not synced"
                : syncStatus === "connected" ? "Live updates on"
                  : syncStatus === "reconnecting" ? "Reconnecting…"
                    : "Checking connection…"}</span>
            </span>
              {showQuickActions && (
              <button onClick={() => setSheet(true)} data-testid="quick-action-btn"
                className="btn-p hidden py-2 md:inline-flex"><Plus size={17} /> New Entry</button>
            )}
            <CurrentTime />
          </div>
          {isSiteBookingRoute && user?.role !== "superadmin" && <nav aria-label="Booking sections"
            className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 md:justify-end md:px-7">
            {(user?.role === "owner"
              ? BOOKING_HEADER_NAV.filter((item) => item === SITE_NAV || item === BOOKING_NAV[0] || item === BOOKING_NAV[1]
                ? hasAdminAccess(user, "booking")
                : hasAdminAccess(user, item.accessKey))
              : [SITE_NAV, ...BOOKING_NAV]).map((item) => {
              const active = navIsActive(item, loc);
              return <Link key={item.to} to={item.to}
                aria-current={active ? "page" : undefined}
                data-testid={`booking-section-${item.label.toLowerCase().replace(/[^a-z]/g, "-")}`}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${
                  active ? "bg-brand-50 text-brand-800" : "text-muted hover:bg-canvas hover:text-ink"}`}>
                <item.icon size={16} aria-hidden="true" />
                {item.label}
              </Link>;
            })}
          </nav>}
        </header>

        <main className="app-main page-enter px-4 pb-28 pt-6 md:px-7 md:pb-10">{children}</main>
      </div>

      {/* mobile bottom bar */}
      <nav aria-label="Primary mobile navigation"
        className="app-header fixed bottom-0 left-0 right-0 z-30 border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${
          user?.role === "superadmin" ? 2
            : user?.role === "site_manager" ? 3
              : mobileNav.length + (showQuickActions ? 1 : 0)
        }, minmax(0, 1fr))` }}>
          {user?.role === "superadmin" || user?.role === "site_manager" ? mobileNav.map((n) => <BottomLink key={n.to} n={n} />) : (
            showQuickActions ? <>
              {mobileNav.slice(0, 2).map((n) => <BottomLink key={n.to} n={n} />)}
              <button onClick={() => setSheet(true)} data-testid="mobile-quick-btn" className="flex flex-col items-center py-2">
                <span className="grid h-11 w-11 -mt-4 place-items-center rounded-full bg-brand-500 text-white shadow-lg"><Plus size={22} /></span>
                <span className="mt-0.5 text-[10.5px] font-semibold text-brand-600">New</span>
              </button>
              {mobileNav.slice(2).map((n) => <BottomLink key={n.to} n={n} />)}
            </> : mobileNav.map((n) => <BottomLink key={n.to} n={n} />)
          )}
        </div>
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/50 backdrop-blur-sm md:items-center md:justify-center"
          onMouseDown={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="row-anim w-full rounded-t-2xl bg-white p-5 md:max-w-md md:rounded-2xl" data-testid="quick-sheet">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-head text-[18px] font-bold">Quick Actions</h3>
              <button onClick={() => setSheet(false)} className="rounded-lg p-1.5 text-muted hover:bg-canvas"><X size={19} /></button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {quickActions.map((a) => (
                <button key={a.kind} onClick={() => quick(a.kind)} data-testid={`quick-${a.kind}`}
                  className="flex flex-col items-center gap-2 rounded-xl border border-line p-3.5 text-center transition-colors hover:border-brand-400 hover:bg-brand-50">
                  <a.icon size={20} className="text-brand-500" />
                  <span className="text-[12.5px] font-semibold leading-tight text-ink">{a.label}</span>
                </button>
              ))}
            </div>
            {hasAdminAccess(user, "industrial_finance") && <Link to="/finance" onClick={() => setSheet(false)}
              className="mt-4 flex items-center justify-between rounded-xl bg-canvas px-4 py-3 text-[14px] font-semibold text-ink">
              Open Industrial Finance <ArrowRight size={17} />
            </Link>}
          </div>
        </div>
      )}

      <EntryModal kind={entry || "collection"} open={!!entry} onClose={() => setEntry(null)}
        onDone={() => window.dispatchEvent(new Event("fms:refresh"))} />
    </div>
  );
}

const BottomLink = ({ n }) => {
  const location = useLocation();
  return (
    <Link to={n.to} aria-current={navIsActive(n, location) ? "page" : undefined}
      data-testid={`mnav-${n.label.toLowerCase().replace(/[^a-z]/g, "-")}`}
      className={`flex flex-col items-center justify-center gap-1 py-1.5 text-[10px] font-semibold ${
        navIsActive(n, location) ? "text-brand-600" : "text-muted"}`}>
      <n.icon size={19} strokeWidth={1.9} /> {n.label}
    </Link>
  );
};
