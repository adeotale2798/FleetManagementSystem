export const ADMIN_ACCESS_DEFAULTS = {
  booking: true,
  booking_finance: true,
  booking_audit: true,
  booking_settings: true,
  industrial_dashboard: true,
  industrial_trips: true,
  industrial_lrs: true,
  industrial_vehicles: true,
  industrial_parties: true,
  industrial_team: true,
  industrial_finance: true,
  industrial_reports: true,
  industrial_tracking: true,
  industrial_settings: true,
};

const SUBSCRIPTION_FEATURES = {
  industrial_trips: "trips",
  industrial_lrs: "trips",
  industrial_vehicles: "vehicles",
  industrial_parties: "parties",
  industrial_team: "team",
  industrial_finance: "finance",
  industrial_reports: "reports",
  industrial_tracking: "tracking",
};

export function hasAdminAccess(user, accessKey) {
  if (user?.role === "site_manager") {
    return accessKey === "booking"
      && (!user.tenant_access || user.tenant_access.booking === true);
  }
  if (user?.role !== "owner") return true;
  if (user.admin_access && user.admin_access[accessKey] !== true) return false;
  if (user.tenant_access && user.tenant_access[accessKey] !== true) return false;
  const feature = SUBSCRIPTION_FEATURES[accessKey];
  return !feature || user.features?.[feature] !== false;
}

export function firstAdminRoute(user) {
  if (hasAdminAccess(user, "booking")) return "/booking/dashboard";
  const routes = [
    ["industrial_dashboard", "/dashboard"],
    ["industrial_trips", "/trips?tab=trips"],
    ["industrial_lrs", "/trips?tab=lrs"],
    ["industrial_vehicles", "/vehicles"],
    ["industrial_parties", "/parties"],
    ["industrial_team", "/team"],
    ["industrial_finance", "/finance"],
    ["industrial_reports", "/reports"],
    ["industrial_tracking", "/dashboard"],
    ["industrial_settings", "/settings"],
    ["booking_finance", "/booking/finance"],
    ["booking_audit", "/booking/audit"],
    ["booking_settings", "/booking-setup"],
  ];
  return routes.find(([key]) => hasAdminAccess(user, key))?.[1] || "/access-required";
}
