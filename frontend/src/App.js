import React, { Component, lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./lib/api";
import { ToastHost, Loader, toast } from "./components/ui";
import { startDataSync } from "./lib/realtime";
import { firstAdminRoute, hasAdminAccess } from "./lib/adminAccess";
import { installClientErrorReporting, reportClientError } from "./lib/errorReporting";
import Layout from "./components/Layout";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Trips = lazy(() => import("./pages/Trips"));
const TripForm = lazy(() => import("./pages/TripForm"));
const TripDetail = lazy(() => import("./pages/TripDetail"));
const LRForm = lazy(() => import("./pages/LRForm"));
const LRView = lazy(() => import("./pages/LRView"));
const Vehicles = lazy(() => import("./pages/Vehicles"));
const VehicleDetail = lazy(() => import("./pages/VehicleDetail"));
const Parties = lazy(() => import("./pages/Parties"));
const PartyDetail = lazy(() => import("./pages/PartyDetail"));
const Team = lazy(() => import("./pages/Team"));
const PersonDetail = lazy(() => import("./pages/PersonDetail"));
const Finance = lazy(() => import("./pages/Finance"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const Platform = lazy(() => import("./pages/Platform"));
const PlatformSettings = lazy(() => import("./pages/Platform").then((module) => ({
  default: module.PlatformSettings,
})));
const PlatformErrors = lazy(() => import("./pages/Platform").then((module) => ({
  default: module.PlatformErrors,
})));
const SiteConsole = lazy(() => import("./pages/SiteConsole"));
const Booking = lazy(() => import("./pages/Booking"));

class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    reportClientError(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section role="alert" className="mx-auto my-10 max-w-xl rounded-xl border border-red-300 bg-red-50 p-6 text-center text-red-900">
          <h1 className="font-head text-xl font-bold">This page encountered an error</h1>
          <p className="mt-2 text-sm">The error has been reported. Reload the app to try again.</p>
          <button type="button" className="btn-s mt-4" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}

function AdminAccessRoute({ user, accessKey, children }) {
  return hasAdminAccess(user, accessKey)
    ? children : <Navigate to={firstAdminRoute(user)} replace />;
}

function BookingAccessRoute({ user }) {
  const location = useLocation();
  const section = location.pathname.split("/").filter(Boolean).pop();
  const accessKey = section === "finance" ? "booking_finance"
    : section === "audit" ? "booking_audit"
      : "booking";
  return <AdminAccessRoute user={user} accessKey={accessKey}><Booking user={user} /></AdminAccessRoute>;
}

function IndustrialTripsAccessRoute({ user }) {
  const location = useLocation();
  const tab = new URLSearchParams(location.search).get("tab") || "trips";
  const accessKey = tab === "lrs" ? "industrial_lrs" : "industrial_trips";
  if (!hasAdminAccess(user, accessKey)) {
    const alternateKey = tab === "lrs" ? "industrial_trips" : "industrial_lrs";
    if (hasAdminAccess(user, alternateKey)) {
      return <Navigate to={`/trips?tab=${alternateKey === "industrial_lrs" ? "lrs" : "trips"}`} replace />;
    }
  }
  return <AdminAccessRoute user={user} accessKey={accessKey}><Trips user={user} /></AdminAccessRoute>;
}

function NoAdminSectionsEnabled() {
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-line bg-white p-6 text-center">
      <h1 className="font-head text-xl font-bold text-ink">No business sections enabled</h1>
      <p className="mt-2 text-sm text-muted">
        Ask your platform owner to grant access to the sections you need.
      </p>
    </section>
  );
}

export default function App() {
  const [state, setState] = useState("checking");
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState("checking");

  const applyMe = (r) => {
    setUser({ ...r.data.user, features: r.data.features, tenant: r.data.tenant, branding: r.data.branding });
    setState("in");
  };

  useEffect(() => {
    const supportToken = sessionStorage.getItem("fms_support_token");
    if (!supportToken && !localStorage.getItem("fms_token")) return setState("out");
    api.get("/me").then(applyMe).catch(() => {
      if (!supportToken) return setState("out");
      sessionStorage.removeItem("fms_support_token");
      api.get("/me").then(applyMe).catch(() => setState("out"));
    });
    const onSessionChange = () => api.get("/me").then(applyMe).catch(() => setState("out"));
    const onBrand = () => api.get("/me").then(applyMe).catch(() => {});
    window.addEventListener("fms:auth-changed", onSessionChange);
    window.addEventListener("fms:branding", onBrand);
    return () => {
      window.removeEventListener("fms:auth-changed", onSessionChange);
      window.removeEventListener("fms:branding", onBrand);
    };
  }, []);

  const onLogin = () => {
    sessionStorage.removeItem("fms_support_token");
    api.get("/me").then(applyMe).catch(() => setState("out"));
  };

  useEffect(() => {
    if (state !== "in" || !user) return undefined;
    let unavailable = false;
    return startDataSync(
      user.tenant_id,
      async () => (await api.get("/sync/revision")).data.revision,
      (error) => {
        setSyncStatus(error ? "reconnecting" : "connected");
        if (error) {
          unavailable = true;
          toast("Live updates are temporarily unavailable; retrying automatically.", "err");
        } else if (unavailable) {
          unavailable = false;
          toast("Live updates restored.", "ok");
        }
      },
    );
  }, [state, user]);

  useEffect(() => {
    if (state !== "in" || !user) return undefined;
    return installClientErrorReporting();
  }, [state, user]);

  if (state === "checking") return <div className="grid h-screen place-items-center"><Loader label="Starting…" /></div>;

  return (
    <BrowserRouter>
      <ToastHost />
      {state !== "in" ? (
        <Suspense fallback={<div className="grid h-screen place-items-center"><Loader label="Loading…" /></div>}>
          <Routes>
            <Route path="/login" element={<Login onLogin={onLogin} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      ) : (
        <Layout user={user} syncStatus={syncStatus}>
          <Suspense fallback={<div className="grid min-h-[40vh] place-items-center"><Loader label="Loading…" /></div>}>
            <AppErrorBoundary>
            <Routes>
              {user?.role === "superadmin" ? (
                <>
                  <Route path="/platform" element={<Platform />} />
                  <Route path="/platform/plans" element={<Platform initialView="plans" />} />
                  <Route path="/platform/errors" element={<PlatformErrors />} />
                  <Route path="/settings" element={<PlatformSettings />} />
                  <Route path="*" element={<Navigate to="/platform" replace />} />
                </>
              ) : user?.role === "site_manager" ? (
                <>
                  <Route path="/" element={<Navigate to={
                    hasAdminAccess(user, "booking") ? "/booking/dashboard" : "/access-required"
                  } replace />} />
                  <Route path="/access-required" element={<NoAdminSectionsEnabled />} />
                  <Route path="/booking" element={<Navigate to={
                    hasAdminAccess(user, "booking") ? "/booking/dashboard" : "/access-required"
                  } replace />} />
                  <Route path="/booking/:section" element={hasAdminAccess(user, "booking")
                    ? <Booking user={user} /> : <NoAdminSectionsEnabled />} />
                  <Route path="/sites" element={<Navigate to={
                    hasAdminAccess(user, "booking") ? "/booking/dashboard" : "/access-required"
                  } replace />} />
                  <Route path="/sites/:siteId/trips/:tripId/*" element={<Navigate to={
                    hasAdminAccess(user, "booking") ? "/booking/receipts" : "/access-required"
                  } replace />} />
                  <Route path="/booking-setup" element={<Navigate to={
                    hasAdminAccess(user, "booking") ? "/booking/dashboard" : "/access-required"
                  } replace />} />
                  <Route path="*" element={<Navigate to={
                    hasAdminAccess(user, "booking") ? "/booking/dashboard" : "/access-required"
                  } replace />} />
                </>
              ) : (
                <>
            <Route path="/" element={<Navigate to={firstAdminRoute(user)} replace />} />
            <Route path="/access-required" element={<NoAdminSectionsEnabled />} />
            <Route path="/booking" element={<Navigate to="/booking/dashboard" replace />} />
            <Route path="/booking/:section" element={<BookingAccessRoute user={user} />} />
            <Route path="/sites" element={<Navigate to="/booking/dashboard" replace />} />
            <Route path="/sites/:siteId/trips/:tripId/*" element={<Navigate to="/booking/receipts" replace />} />
            <Route path="/booking-setup" element={<AdminAccessRoute user={user} accessKey="booking_settings"><SiteConsole user={user} adminOnly /></AdminAccessRoute>} />
            <Route path="/booking-finance" element={<Navigate to="/booking/finance" replace />} />
            <Route path="/booking-reports" element={<Navigate to="/booking/ledger" replace />} />
            <Route path="/dashboard" element={<AdminAccessRoute user={user} accessKey="industrial_dashboard"><Dashboard user={user} /></AdminAccessRoute>} />
            <Route path="/trips" element={<IndustrialTripsAccessRoute user={user} />} />
            <Route path="/trips/new" element={<AdminAccessRoute user={user} accessKey="industrial_trips"><TripForm user={user} /></AdminAccessRoute>} />
            <Route path="/trips/:id" element={<AdminAccessRoute user={user} accessKey="industrial_trips"><TripDetail user={user} /></AdminAccessRoute>} />
            <Route path="/lrs/new" element={<AdminAccessRoute user={user} accessKey="industrial_lrs"><LRForm /></AdminAccessRoute>} />
            <Route path="/lrs/:id" element={<AdminAccessRoute user={user} accessKey="industrial_lrs"><LRView user={user} /></AdminAccessRoute>} />
            <Route path="/vehicles" element={<AdminAccessRoute user={user} accessKey="industrial_vehicles"><Vehicles /></AdminAccessRoute>} />
            <Route path="/vehicles/:id" element={<AdminAccessRoute user={user} accessKey="industrial_vehicles"><VehicleDetail /></AdminAccessRoute>} />
            <Route path="/parties" element={<AdminAccessRoute user={user} accessKey="industrial_parties"><Parties /></AdminAccessRoute>} />
            <Route path="/parties/:id" element={<AdminAccessRoute user={user} accessKey="industrial_parties"><PartyDetail /></AdminAccessRoute>} />
            <Route path="/team" element={<AdminAccessRoute user={user} accessKey="industrial_team"><Team /></AdminAccessRoute>} />
            <Route path="/drivers/:id" element={<AdminAccessRoute user={user} accessKey="industrial_team"><PersonDetail kind="driver" /></AdminAccessRoute>} />
            <Route path="/team/:id" element={<AdminAccessRoute user={user} accessKey="industrial_team"><PersonDetail kind="employee" /></AdminAccessRoute>} />
            <Route path="/finance" element={<AdminAccessRoute user={user} accessKey="industrial_finance"><Finance /></AdminAccessRoute>} />
            <Route path="/reports" element={<AdminAccessRoute user={user} accessKey="industrial_reports"><Reports /></AdminAccessRoute>} />
            <Route path="/settings" element={<AdminAccessRoute user={user} accessKey="industrial_settings"><Settings /></AdminAccessRoute>} />
            <Route path="/login" element={<Navigate to={firstAdminRoute(user)} replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
                </>
              )}
            </Routes>
            </AppErrorBoundary>
          </Suspense>
        </Layout>
      )}
    </BrowserRouter>
  );
}
