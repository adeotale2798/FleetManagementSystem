import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Building2, Check, History, Plus, Search, ShieldCheck, Users,
} from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { money, money0, dmy, dmyDateTime } from "../lib/format";
import { ADMIN_ACCESS_DEFAULTS } from "../lib/adminAccess";
import {
  Badge, Btn, Card, DataTable, EmptyState, ErrorState, Input, Loader, Modal, PageHead, Select, Stat, TextArea, toast,
} from "../components/ui";
import PlatformBookingSettings from "./PlatformBookingSettings";

const DEFAULT_FEATURES = {
  trips: true, vehicles: true, parties: true, team: true, finance: true,
  reports: true, tracking: true, lr_charts: true, dashboard_charts: true,
};

const ACCESS_FEATURES = {
  industrial_trips: "trips", industrial_lrs: "trips",
  industrial_vehicles: "vehicles", industrial_parties: "parties",
  industrial_team: "team", industrial_finance: "finance",
  industrial_reports: "reports", industrial_tracking: "tracking",
};

const ACCESS_GROUPS = [
  {
    title: "Booking operations",
    description: "One grant covers Booking Dashboard, Trips, Receipts and Ledger.",
    items: [{ key: "booking", label: "Booking Dashboard, Trips, Receipts & Ledger" }],
  },
  {
    title: "Booking owner sections",
    description: "Grant Finance, Audit and Booking settings independently.",
    items: [
      { key: "booking_finance", label: "Booking Finance" },
      { key: "booking_audit", label: "Booking Audit" },
      { key: "booking_settings", label: "Booking settings and access management" },
    ],
  },
  {
    title: "Industrial modules",
    description: "Each module is separately controlled and remains limited by the business licence.",
    items: [
      { key: "industrial_dashboard", label: "Industrial Dashboard" },
      { key: "industrial_trips", label: "Industrial Trips" },
      { key: "industrial_lrs", label: "Industrial LRs" },
      { key: "industrial_vehicles", label: "Vehicles" },
      { key: "industrial_parties", label: "Parties" },
      { key: "industrial_team", label: "Team and payroll" },
      { key: "industrial_finance", label: "Industrial Finance" },
      { key: "industrial_reports", label: "Industrial Reports" },
      { key: "industrial_tracking", label: "GPS Live Tracking" },
      { key: "industrial_settings", label: "Office Settings" },
    ],
  },
];

const ACCESS_PROFILES = [
  {
    id: "booking_operator",
    label: "Booking operator",
    description: "Booking dashboard, trips, receipts and ledger",
    access: ["booking"],
  },
  {
    id: "finance_only",
    label: "Finance only",
    description: "Booking Finance and Industrial Finance",
    access: ["booking_finance", "industrial_finance"],
  },
];

const ACCESS_LABELS = Object.fromEntries(
  ACCESS_GROUPS.flatMap((group) => group.items.map(({ key, label }) => [key, label])),
);

export function describeHistoryChanges(event) {
  const details = event?.details || {};
  const before = details.before?.access || details.before || {};
  const after = details.after?.access || details.after || {};
  const changedSections = details.changed_sections || [];
  const added = changedSections.filter((key) => before[key] !== true && after[key] === true);
  const removed = changedSections.filter((key) => before[key] === true && after[key] !== true);
  const messages = [];

  if (event?.action === "subscription.updated") {
    if (added.length) messages.push(`Added to plan: ${added.map((key) => ACCESS_LABELS[key] || key).join(", ")}`);
    if (removed.length) messages.push(`Removed from plan: ${removed.map((key) => ACCESS_LABELS[key] || key).join(", ")}`);
    if (Number.isInteger(details.admins_clamped) && details.admins_clamped > 0) {
      messages.push(`Access reduced for ${details.admins_clamped} admin${details.admins_clamped === 1 ? "" : "s"}`);
    }
  } else if (event?.action === "admin.access") {
    if (added.length) messages.push(`Enabled for this user: ${added.map((key) => ACCESS_LABELS[key] || key).join(", ")}`);
    if (removed.length) messages.push(`Removed from this user: ${removed.map((key) => ACCESS_LABELS[key] || key).join(", ")}`);
  }
  return messages.join(" · ");
}

const isSectionIncluded = (key, features = {}, subscriptionAccess = null) => (
  (!subscriptionAccess || subscriptionAccess[key] === true)
  && (!ACCESS_FEATURES[key] || features[ACCESS_FEATURES[key]] !== false)
);

export const buildAdminAccessPreset = (preset, features = {}, subscriptionAccess = null) => {
  const access = { ...ADMIN_ACCESS_DEFAULTS };
  if (preset === "all_included") {
    Object.keys(access).forEach((key) => { access[key] = true; });
  } else if (preset === "full_booking") {
    Object.keys(access).forEach((key) => { access[key] = key.startsWith("booking"); });
  } else if (preset === "industrial_trips_only") {
    Object.keys(access).forEach((key) => { access[key] = key === "industrial_trips"; });
  } else if (preset === "clear") {
    Object.keys(access).forEach((key) => { access[key] = false; });
  }
  Object.keys(access).forEach((key) => {
    if (!isSectionIncluded(key, features, subscriptionAccess)) access[key] = false;
  });
  return access;
};

export const buildAdminAccessProfile = (profileId, features = {}, subscriptionAccess = null) => {
  const profile = ACCESS_PROFILES.find(({ id }) => id === profileId);
  if (!profile) throw new Error(`Unknown admin access profile: ${profileId}`);
  const access = emptyAccess();
  const notIncluded = [];
  profile.access.forEach((key) => {
    if (isSectionIncluded(key, features, subscriptionAccess)) access[key] = true;
    else notIncluded.push({
      key,
      label: ACCESS_LABELS[key],
      reason: subscriptionAccess && subscriptionAccess[key] !== true
        ? "not included in this plan" : "not included in this licence",
    });
  });
  return { access, notIncluded };
};

const emptyAccess = () => Object.fromEntries(
  Object.keys(ADMIN_ACCESS_DEFAULTS).map((key) => [key, false]),
);

const tenantSubscriptionAccess = (tenant) => {
  if (tenant?.subscription_access) return { ...tenant.subscription_access };
  const legacyFeatures = { ...DEFAULT_FEATURES, ...(tenant?.features || {}) };
  return Object.fromEntries(Object.keys(ADMIN_ACCESS_DEFAULTS).map((key) => {
    const feature = ACCESS_FEATURES[key];
    const enabled = !feature || legacyFeatures[feature] !== false;
    return [key, enabled];
  }));
};

const blank = {
  name: "", owner_name: "", owner_username: "", owner_password: "",
  email: "", mobile: "", city: "", state: "", plan: "Custom", plan_id: "", license_days: 365,
};

function PlatformNavigation({ active }) {
  const tabs = [
    { id: "clients", to: "/platform", label: "Clients", icon: Building2, testId: "platform-tab-clients" },
    { id: "plans", to: "/platform/plans", label: "Plans & pricing", icon: ShieldCheck, testId: "platform-tab-plans" },
    { id: "settings", to: "/settings", label: "Platform settings", icon: History, testId: "platform-tab-settings" },
    { id: "errors", to: "/platform/errors", label: "Error logs", icon: AlertTriangle, testId: "platform-tab-errors" },
  ];
  return (
    <nav aria-label="Platform management" className="mb-5 flex flex-wrap gap-2 rounded-xl border border-line bg-white p-1.5">
      {tabs.map(({ id, to, label, icon: Icon, testId }) => (
        <Link key={id} to={to} data-testid={testId} aria-current={active === id ? "page" : undefined}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${active === id ? "bg-brand-700 text-white" : "text-muted hover:bg-canvas"}`}>
          <span className="inline-flex items-center gap-2"><Icon size={16} /> {label}</span>
        </Link>
      ))}
    </nav>
  );
}

const daysUntil = (dateValue) => {
  if (typeof dateValue !== "string" || !dateValue) return Number.POSITIVE_INFINITY;
  const expiry = new Date(`${dateValue.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) return Number.POSITIVE_INFINITY;
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((expiry.getTime() - todayUtc) / 86400000);
};

export default function Platform({ initialView = "clients" }) {
  const navigate = useNavigate();
  const { data, loading, error, reload, setData } = useFetch("/platform/summary");
  const [form, setForm] = useState(null);
  const [pwFor, setPwFor] = useState(null);
  const [pw, setPw] = useState("");
  const [cust, setCust] = useState(null);
  const [accessSelection, setAccessSelection] = useState("");
  const [accessDraft, setAccessDraft] = useState(null);
  const [accessProfileNotice, setAccessProfileNotice] = useState(null);
  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantStatusFilter, setTenantStatusFilter] = useState("attention");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [planForm, setPlanForm] = useState(null);
  const [editingPlanId, setEditingPlanId] = useState("");
  const [activeView, setActiveView] = useState(initialView);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState("overview");
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRefresh, setHistoryRefresh] = useState(0);

  useEffect(() => setActiveView(initialView), [initialView]);

  useEffect(() => {
    if (!workspaceOpen || workspaceTab !== "history" || !selectedTenantId) return undefined;
    let active = true;
    setHistoryLoading(true);
    setHistoryError("");
    api.get(`/platform/tenants/${selectedTenantId}/history`)
      .then((response) => {
        if (active) setHistoryEvents(response.data || []);
      })
      .catch((requestError) => {
        if (active) setHistoryError(errMsg(requestError));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [workspaceOpen, workspaceTab, selectedTenantId, historyRefresh]);

  const selectedTenant = data?.tenants?.find((tenant) => tenant.id === selectedTenantId) || null;

  if (loading && !data) return <Loader label="Loading platform data…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const t = data.totals;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const adminOptions = (selectedTenant?.admins || []).map((admin) => ({
    ...admin, tenant_id: selectedTenant.id, tenant_name: selectedTenant.name,
    features: { ...DEFAULT_FEATURES, ...(selectedTenant.features || {}) },
    subscription_access: selectedTenant.subscription_access || null,
    key: `${selectedTenant.id}:${admin.username}`,
  }));
  const selectedAdmin = adminOptions.find((admin) => admin.key === accessSelection) || null;
  const savedAccess = selectedAdmin
    ? { ...ADMIN_ACCESS_DEFAULTS, ...(selectedAdmin.admin_access || {}) } : null;
  const accessIsDirty = Boolean(accessDraft && savedAccess
    && JSON.stringify(accessDraft) !== JSON.stringify(savedAccess));
  const normalizedSearch = tenantSearch.trim().toLowerCase();
  const filteredTenants = data.tenants.filter((tenant) => {
    const searchable = [tenant.name, tenant.owner_name, tenant.owner_username, tenant.email, tenant.city,
      tenant.state, tenant.plan, tenant.id].filter(Boolean).join(" ").toLowerCase();
    const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
    const days = daysUntil(tenant.license_expiry);
    const isExpired = tenant.license_status === "Active" && Number.isFinite(days) && days < 0;
    const isExpiring = tenant.license_status === "Active" && Number.isFinite(days) && days >= 0 && days <= 30;
    const activeAdmins = tenant.active_admin_count
      ?? (tenant.admins || []).filter((admin) => admin.active).length;
    const hasPlan = Boolean(tenant.plan_id || tenant.subscription_access);
    const needsAttention = tenant.license_status !== "Active"
      || (Number.isFinite(days) && days <= 30)
      || !hasPlan
      || activeAdmins === 0;
    const matchesStatus = tenantStatusFilter === "all"
      || (tenantStatusFilter === "attention" && needsAttention)
      || (tenantStatusFilter === "renewal" && Number.isFinite(days) && days <= 30)
      || (tenantStatusFilter === "active" && tenant.license_status === "Active" && !isExpiring && !isExpired)
      || (tenantStatusFilter === "expiring" && isExpiring)
      || (tenantStatusFilter === "expired" && isExpired)
      || (tenantStatusFilter === "suspended" && tenant.license_status !== "Active");
    return matchesSearch && matchesStatus;
  });
  const expiringTenantCount = data.tenants.filter((tenant) => {
    const days = daysUntil(tenant.license_expiry);
    return tenant.license_status === "Active" && Number.isFinite(days) && days >= 0 && days <= 30;
  }).length;
  const activeTenantCount = data.tenants.filter((tenant) => {
    const days = daysUntil(tenant.license_expiry);
    return tenant.license_status === "Active" && (!Number.isFinite(days) || days >= 0);
  }).length;
  const attentionTenantCount = data.tenants.filter((tenant) => {
    const days = daysUntil(tenant.license_expiry);
    const activeAdmins = tenant.active_admin_count
      ?? (tenant.admins || []).filter((admin) => admin.active).length;
    const hasPlan = Boolean(tenant.plan_id || tenant.subscription_access);
    return tenant.license_status !== "Active"
      || (Number.isFinite(days) && days <= 30)
      || !hasPlan
      || activeAdmins === 0;
  }).length;

  const selectAdmin = (key) => {
    if (accessIsDirty && !window.confirm("Discard unsaved access changes?")) return;
    const admin = adminOptions.find((option) => option.key === key);
    setAccessSelection(key);
    setAccessProfileNotice(null);
    setAccessDraft(admin ? {
      ...ADMIN_ACCESS_DEFAULTS,
      ...(admin.admin_access || {}),
    } : null);
  };

  const selectTenant = (tenantId) => {
    if (accessIsDirty && !window.confirm("Discard unsaved access changes?")) return;
    const tenant = data.tenants.find((row) => row.id === tenantId);
    const nextAdmin = tenant?.admins?.find((admin) => admin.active) || tenant?.admins?.[0];
    setSelectedTenantId(tenantId);
    setWorkspaceOpen(true);
    setWorkspaceTab("overview");
    setAccessSelection(nextAdmin ? `${tenant.id}:${nextAdmin.username}` : "");
    setAccessProfileNotice(null);
    setAccessDraft(nextAdmin ? {
      ...ADMIN_ACCESS_DEFAULTS,
      ...(nextAdmin.admin_access || {}),
    } : null);
  };

  const openRenewal = (tenant) => {
    if (accessIsDirty && !window.confirm("Discard unsaved access changes?")) return;
    const nextAdmin = tenant.admins?.find((admin) => admin.active) || tenant.admins?.[0];
    setSelectedTenantId(tenant.id);
    setWorkspaceOpen(true);
    setWorkspaceTab("subscription");
    setAccessSelection(nextAdmin ? `${tenant.id}:${nextAdmin.username}` : "");
    setAccessProfileNotice(null);
    setAccessDraft(nextAdmin ? {
      ...ADMIN_ACCESS_DEFAULTS,
      ...(nextAdmin.admin_access || {}),
    } : null);
    openTenantSubscription(tenant);
  };

  const openCustomerApp = async () => {
    if (!selectedTenant || supportBusy) return;
    if (!window.confirm(
      `Open ${selectedTenant.name}'s client app in full platform support mode? You will be able to view and change all client modules.`,
    )) return;
    setSupportBusy(true);
    try {
      const response = await api.post(`/platform/tenants/${selectedTenant.id}/support-session`);
      sessionStorage.setItem("fms_support_token", response.data.token);
      window.dispatchEvent(new Event("fms:auth-changed"));
      navigate("/");
    } catch (requestError) {
      toast(errMsg(requestError), "err");
      setSupportBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const selectedPlan = data.plans.find((plan) => plan.id === form.plan_id);
      await api.post("/platform/tenants", {
        ...form, plan: selectedPlan?.name || "Custom",
        plan_id: form.plan_id || null,
        license_days: Number(form.license_days) || 365,
      });
      toast("Business licence created");
      setForm(null); reload();
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  };

  const toggle = async (row) => {
    const next = row.license_status === "Active" ? "Suspended" : "Active";
    if (next === "Suspended" && !window.confirm(
      `Suspend ${row.name}'s subscription? Their users will lose access, but their data and plan will remain unchanged.`,
    )) return;
    try {
      await api.put(`/platform/tenants/${row.id}`, { license_status: next });
      toast(`Licence ${next.toLowerCase()}`); reload();
    } catch (e) { toast(errMsg(e), "err"); }
  };

  const saveCust = async () => {
    setBusy(true);
    try {
      const response = await api.put(`/platform/tenants/${cust.id}/subscription`, {
        plan_id: cust.plan_id || null, plan: cust.plan || "Custom",
        access: cust.access,
        monthly_price: cust.monthly_price === "" ? null : Number(cust.monthly_price),
        annual_price: cust.annual_price === "" ? null : Number(cust.annual_price),
        custom_requests: cust.custom_requests, license_expiry: cust.license_expiry,
      });
      const savedTenant = response.data;
      setData?.((current) => current && ({
        ...current,
        tenants: current.tenants.map((tenant) => tenant.id !== cust.id ? tenant : ({
          ...tenant,
          ...savedTenant,
          admins: tenant.admins.map((admin) => ({
            ...admin,
            admin_access: Object.fromEntries(Object.entries({
              ...ADMIN_ACCESS_DEFAULTS, ...(admin.admin_access || {}),
            }).map(([key, enabled]) => [
              key, enabled && savedTenant.subscription_access?.[key] === true,
            ])),
          })),
        })),
      }));
      toast("Saved for this business only"); setCust(null);
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  };

  const openTenantSubscription = (tenant) => setCust({
    id: tenant.id, name: tenant.name, plan_id: tenant.plan_id || "",
    plan: tenant.plan || "Custom",
    access: tenantSubscriptionAccess(tenant),
    monthly_price: tenant.subscription_monthly_price ?? "",
    annual_price: tenant.subscription_annual_price ?? "",
    license_expiry: tenant.license_expiry || "",
    custom_requests: tenant.custom_requests || "",
  });

  const chooseTenantPlan = (planId) => {
    if (!planId) {
      setCust((current) => ({
        ...current, plan_id: "", plan: "Custom", access: emptyAccess(),
      }));
      return;
    }
    const plan = data.plans.find((row) => row.id === planId);
    if (plan) setCust((current) => ({
      ...current, plan_id: plan.id, plan: plan.name,
      access: { ...plan.access },
      monthly_price: plan.monthly_price ?? "",
      annual_price: plan.annual_price ?? "",
    }));
  };

  const openPlanEditor = (plan = null) => {
    setEditingPlanId(plan?.id || "");
    setPlanForm(plan ? {
      name: plan.name,
      description: plan.description || "",
      monthly_price: plan.monthly_price ?? "",
      annual_price: plan.annual_price ?? "",
      access: { ...plan.access },
    } : {
      name: "", description: "", monthly_price: "", annual_price: "",
      access: emptyAccess(),
    });
  };

  const savePlan = async () => {
    setBusy(true);
    try {
      const payload = {
        ...planForm,
        monthly_price: planForm.monthly_price === "" ? null : Number(planForm.monthly_price),
        annual_price: planForm.annual_price === "" ? null : Number(planForm.annual_price),
      };
      if (editingPlanId) await api.put(`/platform/plans/${editingPlanId}`, payload);
      else await api.post("/platform/plans", payload);
      toast(editingPlanId ? "Plan template updated" : "Plan template created");
      setPlanForm(null);
      await reload();
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  };

  const deletePlan = async (plan) => {
    if (!window.confirm(`Delete the "${plan.name}" plan template? Existing customer subscriptions are not changed.`)) return;
    try {
      await api.delete(`/platform/plans/${plan.id}`);
      toast("Plan template deleted");
      await reload();
    } catch (e) { toast(errMsg(e), "err"); }
  };

  const resetPw = async () => {
    setBusy(true);
    try {
      await api.post(`/platform/tenants/${pwFor.id}/reset-password`, { password: pw });
      toast("Owner password updated"); setPwFor(null); setPw("");
      await reload();
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  };

  const saveAdminAccess = async () => {
    if (!selectedAdmin || !accessDraft) return;
    setBusy(true);
    try {
      const adminAccess = Object.fromEntries(Object.entries(accessDraft).map(([key, enabled]) => [
        key,
        enabled === true
          && (!ACCESS_FEATURES[key] || selectedAdmin.features[ACCESS_FEATURES[key]] !== false)
          && (!selectedAdmin.subscription_access || selectedAdmin.subscription_access[key] === true),
      ]));
      const response = await api.put(
        `/platform/tenants/${selectedAdmin.tenant_id}/admins/${encodeURIComponent(selectedAdmin.username)}/access`,
        { admin_access: adminAccess },
      );
      toast(`Access saved for ${selectedAdmin.name || selectedAdmin.username}`);
      const savedAccess = response.data.admin_access;
      setAccessDraft(savedAccess);
      setAccessProfileNotice(null);
      setData?.((current) => current && ({
        ...current,
        tenants: current.tenants.map((tenant) => tenant.id !== selectedAdmin.tenant_id ? tenant : ({
          ...tenant,
          admins: tenant.admins.map((admin) => admin.username === selectedAdmin.username
            ? { ...admin, admin_access: savedAccess } : admin),
        })),
      }));
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  };

  const changeAdminGrant = (key, enabled) => {
    setAccessProfileNotice(null);
    setAccessDraft((current) => ({ ...current, [key]: enabled }));
  };

  return (
    <div data-testid="platform-page">
      <PageHead
        title={workspaceOpen ? selectedTenant?.name || "Customer workspace"
          : activeView === "plans" ? "Plans & pricing" : "Client management"}
        subtitle={workspaceOpen
          ? `${selectedTenant?.owner_name || ""} · @${selectedTenant?.owner_username || ""}`
          : activeView === "plans"
            ? "Keep subscription options clear and consistent. Customer licences keep their own saved plan."
            : "Manage each customer’s subscription and users from one focused workspace."}
        actions={workspaceOpen ? (
          <button type="button" onClick={() => setWorkspaceOpen(false)}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold hover:border-brand-400">
            <ArrowLeft size={16} aria-hidden="true" /> All clients
          </button>
        ) : activeView === "clients" ? (
          <Btn icon={Plus} data-testid="new-tenant-btn" onClick={() => {
            const firstPlan = data.plans.find((plan) => plan.active !== false);
            setForm({ ...blank, plan: firstPlan?.name || "Custom", plan_id: firstPlan?.id || "" });
          }}>Add client</Btn>
        ) : (
          <Btn icon={Plus} data-testid="new-plan-btn" onClick={() => openPlanEditor()}>Create a plan</Btn>
        )} />

      {!workspaceOpen && <PlatformNavigation active={activeView} />}

      {!workspaceOpen && activeView === "plans" && <Card className="mb-5 p-4 sm:p-5" data-testid="subscription-plan-manager">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-head text-[16px] font-bold text-ink">Subscription plans</h3>
            <p className="mt-1 max-w-3xl text-sm text-muted">
              Plans are reusable entitlement templates. Prices are for your sales reference only; no payments are collected here.
              Editing a plan never changes customers already assigned to it.
            </p>
          </div>
          <span className="text-xs text-muted">Prices are reference only · payments are not processed here</span>
        </div>
        {data.plans.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {data.plans.map((plan) => (
              <article key={plan.id} data-testid={`plan-card-${plan.id}`}
                className="rounded-xl border border-line bg-white p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-semibold text-ink">{plan.name}</h4>
                    <p className="mt-1 text-xs text-muted">{plan.description || "No description"}</p>
                  </div>
                  <Badge>{Object.values(plan.access || {}).filter(Boolean).length} sections</Badge>
                </div>
                <p className="mt-3 text-xs font-semibold text-muted">
                  Monthly: {plan.monthly_price == null ? "Not set" : money0(plan.monthly_price)}
                  {" · Annual: "}{plan.annual_price == null ? "Not set" : money0(plan.annual_price)}
                </p>
                <div className="mt-3 flex gap-2 border-t border-line pt-3">
                  <button type="button" data-testid={`edit-plan-${plan.id}`}
                    onClick={() => openPlanEditor(plan)}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold hover:border-brand-400">
                    Edit plan
                  </button>
                  <button type="button" data-testid={`delete-plan-${plan.id}`}
                    onClick={() => deletePlan(plan)}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:border-red-300">
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No subscription plans" text="Create a plan template before issuing a customer licence." />
        )}
      </Card>}

      {!workspaceOpen && activeView === "clients" && <section className="platform-shell mb-5" data-testid="client-license-manager">
        <header className="platform-hero">
          <div>
            <p className="platform-eyebrow">YOUR CUSTOMER DIRECTORY</p>
            <h2>{tenantStatusFilter === "attention" ? "Your next actions, in one place." : "All your clients, one place."}</h2>
            <p>{tenantStatusFilter === "attention"
              ? "Start with customers who need a quick review. Select a row to take action."
              : "Open a client to manage their plan, people and access."}</p>
          </div>
          <div className="platform-hero-metrics" aria-label="Customer totals">
            <span><strong>{data.tenants.length}</strong> customers</span>
            <span><strong>{activeTenantCount}</strong> active</span>
            <span><strong>{expiringTenantCount}</strong> expiring soon</span>
          </div>
        </header>
        <div className="platform-directory">
          <div className="platform-directory-toolbar">
            <label className="platform-search">
              <span className="sr-only">Search customers</span>
              <Search size={18} aria-hidden="true" />
              <input value={tenantSearch} data-testid="tenant-search"
                onChange={(event) => setTenantSearch(event.target.value)}
                placeholder="Search customers or owner..." />
            </label>
            <span className="text-xs font-medium text-muted">
              Showing {filteredTenants.length} of {data.tenants.length}
            </span>
          </div>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter customers by subscription status">
            {[
              ["attention", `Needs attention (${attentionTenantCount})`],
              ["renewal", `Renewals (${data.tenants.filter((tenant) => {
                const days = daysUntil(tenant.license_expiry);
                return Number.isFinite(days) && days <= 30;
              }).length})`],
              ["all", "All customers"],
              ["active", "Active"],
              ["expiring", "Expiring"],
              ["expired", "Expired"],
              ["suspended", "Suspended"],
            ].map(([value, label]) => (
              <button key={value} type="button" data-testid={`tenant-filter-${value}`}
                aria-pressed={tenantStatusFilter === value}
                onClick={() => setTenantStatusFilter(value)}
                className={`platform-filter-pill ${tenantStatusFilter === value ? "is-active" : ""}`}>
                {label}
              </button>
            ))}
          </div>
          {filteredTenants.length ? (
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
              {filteredTenants.map((tenant) => {
                const days = daysUntil(tenant.license_expiry);
                const hasExpiry = Number.isFinite(days);
                const expired = tenant.license_status === "Active" && hasExpiry && days < 0;
                const expiring = tenant.license_status === "Active" && hasExpiry && days >= 0 && days <= 30;
                const activeAdmins = tenant.active_admin_count
                  ?? (tenant.admins || []).filter((admin) => admin.active).length;
                const attentionReasons = [];
                if (tenant.license_status !== "Active") attentionReasons.push("Suspended");
                if (Number.isFinite(days) && days <= 30) {
                  attentionReasons.push(days < 0 ? "Expired" : `Expires in ${days} days`);
                }
                if (!tenant.plan_id && !tenant.subscription_access) attentionReasons.push("No plan");
                if (activeAdmins === 0) attentionReasons.push("No active admin");
                const nextAction = tenant.license_status !== "Active" ? "Reactivate licence"
                  : Number.isFinite(days) && days <= 30 ? "Review renewal"
                    : !tenant.plan_id && !tenant.subscription_access ? "Assign a plan"
                      : activeAdmins === 0 ? "Review admins" : "Manage customer";
                const lifecycle = tenant.license_status !== "Active" ? "Suspended"
                  : expired ? "Expired"
                    : expiring ? "Expiring soon" : "Active";
                const renewalDue = Number.isFinite(days) && days <= 30;
                return <div key={tenant.id} className="border-b border-line last:border-b-0">
                  <button type="button" data-testid={`manage-tenant-${tenant.id}`}
                    aria-label={`Manage ${tenant.name}`}
                    onClick={() => selectTenant(tenant.id)}
                    className="platform-client-row w-full px-3 py-3.5 text-left sm:px-4">
                    <span className="platform-avatar" aria-hidden="true">{(tenant.name || "C").trim().slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">{tenant.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{tenant.owner_name} · @{tenant.owner_username}</span>
                      {tenant.email && <span className="mt-0.5 block truncate text-xs text-muted">{tenant.email}</span>}
                      {(tenantStatusFilter === "attention" || tenantStatusFilter === "renewal") && <span className="mt-1 block truncate text-[10px] font-semibold text-amber-800">
                        {tenantStatusFilter === "renewal"
                          ? days < 0 ? `${Math.abs(days)} days overdue` : `Expires in ${days} days`
                          : attentionReasons.join(" · ")}
                      </span>}
                    </span>
                    <span className="hidden min-w-32 sm:block">
                      <span className="block text-xs font-semibold text-ink">{tenant.plan || "No plan assigned"}</span>
                      <span className="mt-0.5 block text-[11px] text-muted">{tenant.admin_count || 0} admin{tenant.admin_count === 1 ? "" : "s"}</span>
                    </span>
                    <span className="hidden min-w-28 text-right md:block">
                      <span className="block text-xs font-semibold text-ink">{dmy(tenant.license_expiry)}</span>
                      <span className={`mt-0.5 block text-[11px] ${expiring || expired ? "text-amber-700" : "text-muted"}`}>
                        {expired ? "Expired" : expiring ? `${days} days left` : !hasExpiry ? "No expiry" : `${days} days left`}
                      </span>
                    </span>
                    <span className={`platform-status ${tenant.license_status === "Active" && !expired ? "is-active" : "is-paused"}`}>
                      {lifecycle}
                    </span>
                    {tenantStatusFilter === "attention" && <span className="platform-row-action">
                      {nextAction}<span aria-hidden="true"> →</span>
                    </span>}
                    {tenantStatusFilter !== "renewal" && <ArrowRight size={17} aria-hidden="true" className="shrink-0 text-muted" />}
                  </button>
                  {tenantStatusFilter === "renewal" && <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-50/50 px-4 py-2.5 sm:pl-[4.25rem]">
                    <span className="text-xs text-muted">
                      {tenant.license_status === "Active" ? "Active licence" : "Suspended licence"}
                      {" · Expires "}{dmy(tenant.license_expiry)}
                    </span>
                    <button type="button" data-testid={`renew-tenant-${tenant.id}`}
                      onClick={() => openRenewal(tenant)}
                      className="rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-xs font-bold text-brand-800 hover:bg-brand-50">
                      {days < 0 ? "Renew expired licence" : "Review renewal"}
                    </button>
                  </div>}
                </div>;
              })}
            </div>
          ) : (
            <EmptyState title="No customers found" text="Try a different search or status filter." />
          )}
        </div>
      </section>}

      {workspaceOpen && selectedTenant && <section data-testid="customer-workspace" className="mb-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <Building2 size={21} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-head text-lg font-bold text-ink">{selectedTenant.name}</h2>
              <p className="truncate text-sm text-muted">{selectedTenant.owner_name} · @{selectedTenant.owner_username}</p>
              {selectedTenant.email && <p className="truncate text-xs text-muted">{selectedTenant.email}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{selectedTenant.license_status}</Badge>
            <Badge>{selectedTenant.plan || "Legacy licence"}</Badge>
            <Btn icon={ArrowRight} data-testid="workspace-open-client-app"
              disabled={supportBusy} onClick={openCustomerApp}>
              {supportBusy ? "Opening…" : "Open client app"}
            </Btn>
          </div>
        </div>
        <nav aria-label="Customer management sections" className="flex flex-wrap gap-2 border-b border-line">
          {[
            ["overview", "Overview", Building2],
            ["subscription", "Subscription", ShieldCheck],
            ["users", "Users & access", Users],
            ["booking-settings", "Booking setup", Building2],
            ["history", "Change history", History],
          ].map(([key, label, Icon]) => (
            <button type="button" key={key} data-testid={`customer-tab-${key}`}
              aria-current={workspaceTab === key ? "page" : undefined}
              onClick={() => setWorkspaceTab(key)}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                workspaceTab === key ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink"
              }`}>
              <Icon size={16} aria-hidden="true" /> {label}
            </button>
          ))}
        </nav>

        {workspaceTab === "overview" && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-head text-base font-bold text-ink">Customer at a glance</h3>
                <p className="mt-1 text-sm text-muted">Subscription status, administrators and recent business activity.</p>
              </div>
              <button type="button" data-testid={`workspace-edit-subscription-${selectedTenant.id}`}
                onClick={() => openTenantSubscription(selectedTenant)}
                className="rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:border-brand-400">
                Edit subscription
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Subscription", selectedTenant.plan || "Not assigned"],
                ["Renewal / expiry", `${dmy(selectedTenant.license_expiry)}${
                  Number.isFinite(daysUntil(selectedTenant.license_expiry))
                    ? ` · ${daysUntil(selectedTenant.license_expiry) < 0
                      ? `${Math.abs(daysUntil(selectedTenant.license_expiry))} days overdue`
                      : `${daysUntil(selectedTenant.license_expiry)} days left`}`
                    : ""
                }`],
                ["Admins", `${selectedTenant.active_admin_count ?? selectedTenant.admins.filter((item) => item.active).length} active of ${selectedTenant.admin_count || 0}`],
                ["Last activity", selectedTenant.stats?.last_activity ? dmy(selectedTenant.stats.last_activity) : "No activity yet"],
              ].map(([label, value]) => <div key={label} className="rounded-xl bg-canvas p-3">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
                <span className="mt-1 block text-sm font-semibold text-ink">{value}</span>
              </div>)}
            </div>
            <div className="platform-lifecycle mt-4" aria-label="Licence lifecycle">
              {selectedTenant.license_status !== "Active" ? (
                <span className="platform-lifecycle-paused">Suspended · access paused</span>
              ) : (
                ["Active", "Expiring soon", "Expired"].map((stage, index) => {
                  const days = daysUntil(selectedTenant.license_expiry);
                  const currentStage = Number.isFinite(days) && days < 0 ? 2
                    : Number.isFinite(days) && days <= 30 ? 1 : 0;
                  return <span key={stage}
                    className={`platform-lifecycle-stage ${index <= currentStage ? "is-current" : ""} ${
                      index === currentStage ? "is-selected" : ""
                    }`}>
                    <span className="platform-lifecycle-dot" aria-hidden="true" />
                    {stage}
                  </span>;
                })
              )}
            </div>
            <div className="mt-4 rounded-xl border border-line p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Included in this subscription</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedTenant.subscription_access
                  ? ACCESS_GROUPS.flatMap((group) => group.items)
                    .filter(({ key }) => selectedTenant.subscription_access[key] === true)
                    .map(({ key, label }) => <Badge key={key}>{label}</Badge>)
                  : <span className="text-sm text-muted">Legacy licence; assign a plan to manage subscription access here.</span>}
              </div>
            </div>
          </Card>
          <Card className="p-4 sm:p-5">
            <h3 className="font-head text-base font-bold text-ink">Quick actions</h3>
            <div className="mt-3 grid gap-2">
              <button type="button" data-testid="workspace-open-users"
                onClick={() => setWorkspaceTab("users")}
                className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left text-sm font-semibold hover:border-brand-400">
                <span className="inline-flex items-center gap-2"><Users size={16} /> Manage user access</span>
                <span className="text-muted">→</span>
              </button>
              <button type="button" data-testid={`workspace-renew-${selectedTenant.id}`}
                onClick={() => openTenantSubscription(selectedTenant)}
                className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5 text-left text-sm font-semibold text-brand-900 hover:border-brand-400">
                <span>
                  <span className="block">Renew / change expiry</span>
                  <span className="mt-0.5 block text-xs font-normal text-muted">
                    {selectedTenant.plan || "No plan"} · valid until {dmy(selectedTenant.license_expiry)}
                  </span>
                </span>
                <span aria-hidden="true">→</span>
              </button>
              <button type="button" data-testid={`workspace-toggle-${selectedTenant.id}`}
                onClick={() => toggle(selectedTenant)}
                className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left text-sm font-semibold hover:border-brand-400">
                <span>{selectedTenant.license_status === "Active" ? "Suspend subscription" : "Reactivate subscription"}</span>
                <span className="text-muted">→</span>
              </button>
              <button type="button" data-testid={`workspace-reset-${selectedTenant.id}`}
                onClick={() => { setPwFor(selectedTenant); setPw(""); }}
                className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left text-sm font-semibold hover:border-brand-400">
                <span>Reset owner password</span><span className="text-muted">→</span>
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Suspending blocks tenant logins. It does not remove customer data or modify the selected plan.
            </p>
          </Card>
        </div>}

        {workspaceTab === "subscription" && <Card className="p-4 sm:p-5" data-testid="customer-subscription-panel">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-head text-base font-bold text-ink">Subscription &amp; entitlement</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                The plan is this customer’s maximum access. Individual user grants are managed separately and cannot exceed it.
                Template changes do not change this saved subscription.
              </p>
            </div>
            <Btn icon={ShieldCheck} data-testid="edit-customer-subscription"
              onClick={() => openTenantSubscription(selectedTenant)}>Edit subscription</Btn>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-canvas p-3"><span className="text-xs text-muted">Plan</span>
              <p className="mt-1 font-semibold">{selectedTenant.plan || "Custom"}</p></div>
            <div className="rounded-xl bg-canvas p-3"><span className="text-xs text-muted">Status</span>
              <p className="mt-1 font-semibold">{selectedTenant.license_status}</p></div>
            <div className="rounded-xl bg-canvas p-3"><span className="text-xs text-muted">Valid until</span>
              <p className="mt-1 font-semibold">{dmy(selectedTenant.license_expiry)}</p></div>
            <div className="rounded-xl bg-canvas p-3"><span className="text-xs text-muted">Reference price</span>
              <p className="mt-1 font-semibold">
                {selectedTenant.subscription_monthly_price == null && selectedTenant.subscription_annual_price == null
                  ? "Not set"
                  : `${selectedTenant.subscription_monthly_price == null ? "" : `${money0(selectedTenant.subscription_monthly_price)}/month`}${
                    selectedTenant.subscription_monthly_price != null && selectedTenant.subscription_annual_price != null ? " · " : ""
                  }${selectedTenant.subscription_annual_price == null ? "" : `${money0(selectedTenant.subscription_annual_price)}/year`}`}
              </p></div>
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-sm font-semibold text-ink">Included sections</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedTenant.subscription_access
                ? ACCESS_GROUPS.flatMap((group) => group.items)
                  .filter(({ key }) => selectedTenant.subscription_access[key] === true)
                  .map(({ key, label }) => <Badge key={key}>{label}</Badge>)
                : <span className="text-sm text-muted">No subscription snapshot yet.</span>}
            </div>
          </div>
        </Card>}

        {workspaceTab === "history" && <Card className="p-4 sm:p-5" data-testid="customer-history-panel">
          <div className="mb-4">
            <h3 className="font-head text-base font-bold text-ink">Customer change history</h3>
            <p className="mt-1 text-sm text-muted">Subscription, account status and user-access changes are recorded for audit.</p>
          </div>
          {historyLoading ? <Loader label="Loading customer history…" />
            : historyError ? <ErrorState text={historyError} onRetry={() => setHistoryRefresh((value) => value + 1)} />
              : historyEvents.length ? <ol className="space-y-3">
                {historyEvents.map((event) => (
                  <li key={event.id} data-testid={`history-event-${event.id}`}
                    className="relative border-l-2 border-brand-200 pb-1 pl-4">
                    <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-brand-600" />
                    <p className="text-sm font-semibold text-ink">{event.summary}</p>
                    {describeHistoryChanges(event) && <p className="mt-1 text-sm text-ink/80">
                      {describeHistoryChanges(event)}
                    </p>}
                    <p className="mt-1 text-xs text-muted">
                      {event.actor} · {dmyDateTime(event.created_at)}
                      {event.details?.changed_sections?.length
                        ? ` · ${event.details.changed_sections.length} section(s) changed` : ""}
                    </p>
                  </li>
                ))}
              </ol> : <EmptyState title="No changes recorded yet" text="Subscription and access changes will appear here." />}
        </Card>}

        {workspaceTab === "booking-settings" && selectedTenant
          && <PlatformBookingSettings tenant={selectedTenant} />}
      </section>}

      {workspaceOpen && workspaceTab === "users" && selectedTenant && <Card className="mb-5 p-4 sm:p-5" data-testid="admin-access-manager">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-head text-[16px] font-bold text-ink">Access for selected client</h3>
            <p className="mt-1 max-w-3xl text-sm text-muted">
              Choose a client above, then select its business login. Every saved permission belongs only to that login and cannot exceed the client’s licensed modules.
            </p>
          </div>
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
            {t.active_admins ?? 0} active · {t.admins ?? 0} total
          </span>
        </div>
        {selectedTenant && <div className="mb-4 grid gap-3 rounded-lg bg-canvas p-3 text-sm sm:grid-cols-3">
          <p><span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">Selected business</span>
            <b>{selectedTenant.name}</b></p>
          <p><span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">Tenant database</span>
            <span className="num text-xs">{selectedTenant.db_name || `fleet_db_${selectedTenant.id}`}</span></p>
          <p><span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">Subscription sections</span>
            <span>{selectedTenant.subscription_access
              ? ACCESS_GROUPS.flatMap((group) => group.items)
                .filter(({ key }) => selectedTenant.subscription_access[key] === true)
                .map(({ label }) => label)
                .join(", ") || "No sections included"
              : "Legacy licence — no plan snapshot"}</span></p>
        </div>}
        {adminOptions.length > 0 && <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
          aria-label="Business user accounts">
          {adminOptions.map((admin) => {
            const active = admin.key === accessSelection;
            const grants = { ...ADMIN_ACCESS_DEFAULTS, ...(admin.admin_access || {}) };
            const grantCount = Object.entries(grants)
              .filter(([key, enabled]) => enabled
                && isSectionIncluded(key, admin.features, admin.subscription_access)).length;
            return <button type="button" key={admin.key} data-testid={`select-admin-${admin.username}`}
              aria-pressed={active} onClick={() => selectAdmin(admin.key)}
              className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${
                active ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500/20" : "border-line hover:border-brand-300"
              }`}>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-canvas text-muted">
                  <Users size={17} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{admin.name || admin.username}</span>
                  <span className="block truncate text-xs text-muted">@{admin.username}</span>
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs font-semibold">{grantCount} enabled sections</span>
                <span className="text-[10px] text-muted">{admin.active ? "Active login" : "Inactive"}</span>
              </span>
            </button>;
          })}
        </div>}
        {selectedTenant && !adminOptions.length && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          No business owner login is associated with this licence.
        </p>}
        {!selectedTenant && <p className="rounded-lg bg-canvas p-3 text-sm text-muted">
          Select a client in the directory above to load that business’s saved admin and licence configuration.
        </p>}
        {selectedAdmin && accessDraft && <div className="space-y-4" data-testid="selected-admin-access">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-canvas px-3 py-2.5 text-sm">
            <div>
              <strong>{selectedAdmin.name || selectedAdmin.username}</strong>
              <span className="ml-2 text-muted">@{selectedAdmin.username}</span>
              <p className="mt-1 text-xs text-muted">
                {selectedAdmin.tenant_name} · {selectedTenant?.plan || "No plan"}
                {" · Licence valid till "}{dmy(selectedTenant?.license_expiry)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{selectedAdmin.active ? "Active login" : "Inactive login"}</Badge>
              <Badge>{selectedTenant?.license_status || "Unknown licence"}</Badge>
            </div>
          </div>
          <section aria-label="Suggested access presets" className="rounded-xl border border-line bg-canvas p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold text-ink">Start with a preset</h4>
                <p className="mt-1 text-xs text-muted">
                  Choose a starting point, then fine-tune below. Changes apply only after saving.
                </p>
              </div>
              <span className="text-[11px] font-medium text-muted">Only sections in this client’s plan can be enabled.</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ACCESS_PROFILES.map((profile) => <button type="button" key={profile.id}
                data-testid={`access-profile-${profile.id}`}
                onClick={() => {
                  const result = buildAdminAccessProfile(
                    profile.id, selectedAdmin.features, selectedAdmin.subscription_access,
                  );
                  setAccessDraft(result.access);
                  setAccessProfileNotice({ label: profile.label, notIncluded: result.notIncluded });
                }}
                aria-label={`${profile.label}: ${profile.description}. Apply profile`}
                className="platform-profile-option rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-left text-xs font-semibold text-brand-900 hover:border-brand-400 hover:bg-brand-50">
                <span className="block">{profile.label}</span>
                <span className="mt-1 block font-normal leading-snug text-muted">{profile.description}</span>
                <span className="mt-1.5 block text-[10px] font-medium text-brand-800">
                  {profile.access.map((key) => ACCESS_LABELS[key]).join(" · ")}
                </span>
              </button>)}
              <button type="button" data-testid="preset-all-included"
                onClick={() => {
                  setAccessProfileNotice(null);
                  setAccessDraft(buildAdminAccessPreset(
                    "all_included", selectedAdmin.features, selectedAdmin.subscription_access,
                  ));
                }}
                className="rounded-lg border border-brand-300 bg-white px-3 py-2 text-xs font-semibold text-brand-800 hover:bg-brand-50">
                All included access
              </button>
              <button type="button" data-testid="preset-full-booking"
                onClick={() => {
                  setAccessProfileNotice(null);
                  setAccessDraft(buildAdminAccessPreset(
                    "full_booking", selectedAdmin.features, selectedAdmin.subscription_access,
                  ));
                }}
                className="rounded-lg border border-brand-300 bg-white px-3 py-2 text-xs font-semibold text-brand-800 hover:bg-brand-50">
                Full Booking
              </button>
              <button type="button" data-testid="preset-industrial-trips-only"
                onClick={() => {
                  setAccessProfileNotice(null);
                  setAccessDraft(buildAdminAccessPreset(
                    "industrial_trips_only", selectedAdmin.features, selectedAdmin.subscription_access,
                  ));
                }}
                className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-brand-400">
                Industrial Trips only
              </button>
              <button type="button" data-testid="preset-clear"
                onClick={() => {
                  setAccessProfileNotice(null);
                  setAccessDraft(buildAdminAccessPreset(
                    "clear", selectedAdmin.features, selectedAdmin.subscription_access,
                  ));
                }}
                className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-brand-400">
                No access
              </button>
            </div>
            {accessProfileNotice && <p role="status" data-testid="access-profile-result"
              className={`mt-3 text-xs leading-relaxed ${
                accessProfileNotice.notIncluded.length ? "text-amber-800" : "text-brand-800"
              }`}>
              {accessProfileNotice.notIncluded.length
                ? `${accessProfileNotice.label}: not enabled because ${accessProfileNotice.notIncluded
                  .map(({ label, reason }) => `${label} is ${reason}`).join(", ")}.`
                : `${accessProfileNotice.label} is ready to save.`}
            </p>}
          </section>
          <div className="space-y-3">
            {ACCESS_GROUPS.map((group) => {
              const itemsAvailable = group.items.filter(({ key }) => (
                isSectionIncluded(key, selectedAdmin.features, selectedAdmin.subscription_access)
              ));
              const itemsEnabled = itemsAvailable.filter(({ key }) => accessDraft[key] === true).length;
              return <details key={group.title} className="platform-access-group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block text-sm font-semibold text-ink">{group.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">{group.description}</span>
                </span>
                <span aria-label={`${itemsEnabled} enabled; ${itemsAvailable.length} included in subscription`}
                  className="shrink-0 rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold text-muted">
                  {itemsEnabled} enabled / {itemsAvailable.length} in plan
                </span>
              </summary>
              <div className="grid gap-2 border-t border-line px-3 py-3 sm:grid-cols-2">
                {group.items.map(({ key, label }) => {
                  const inSubscription = !selectedAdmin.subscription_access
                    || selectedAdmin.subscription_access[key] === true;
                  const licensed = isSectionIncluded(
                    key, selectedAdmin.features, selectedAdmin.subscription_access,
                  );
                  const checked = licensed && accessDraft[key] === true;
                  return <label key={key} className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${
                    licensed ? "border-line" : "border-dashed border-line bg-canvas text-muted"
                  }`}>
                    <input type="checkbox" checked={checked} disabled={!licensed}
                      aria-label={label} data-testid={`admin-access-${key}`}
                      onChange={(event) => changeAdminGrant(key, event.target.checked)} />
                    <span className="min-w-0 flex-1 font-medium">{label}</span>
                    {!licensed && <span className="shrink-0 text-[11px]">
                      {!inSubscription ? "Not in plan" : "Not in licence"}
                    </span>}
                    {checked && licensed && <Check size={15} aria-hidden="true" className="shrink-0 text-brand-700" />}
                  </label>;
                })}
              </div>
            </details>;
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <p className={`text-xs font-medium ${accessIsDirty ? "text-amber-700" : "text-brand-700"}`}
              role="status" data-testid="admin-access-save-state">
              {accessIsDirty
                ? "Unsaved access changes — save to store this configuration for this admin."
                : "Access configuration saved. Backend checks enforce these grants on each request."}
            </p>
            <Btn disabled={busy || !accessIsDirty} data-testid="save-admin-access" onClick={saveAdminAccess}>
              {busy ? "Saving access…" : accessIsDirty ? "Save admin access" : "Access saved"}
            </Btn>
          </div>
        </div>}
      </Card>}

      <Modal open={!!form} onClose={() => setForm(null)} title="Issue a New Business Licence"
        subtitle="A separate database is created for this business — their data never mixes with anyone else's"
        footer={<><Btn variant="s" onClick={() => setForm(null)}>Cancel</Btn>
          <Btn disabled={busy || !form?.name?.trim() || !form?.owner_name?.trim()
            || !form?.owner_username?.trim() || !form?.owner_password}
            data-testid="save-tenant" onClick={save}>Create Licence</Btn></>}>
        {form && (
          <div className="grid gap-3 md:grid-cols-2">
          <Input label="Business Name" required value={form.name} data-testid="tenant-name" onChange={(e) => set("name", e.target.value)} />
          <Input label="Owner Name" required value={form.owner_name} data-testid="tenant-owner" onChange={(e) => set("owner_name", e.target.value)} />
          <Input label="Owner Login Username" required value={form.owner_username} data-testid="tenant-username"
            onChange={(e) => set("owner_username", e.target.value.toLowerCase().trim())} />
          <Input label="Owner Password" required value={form.owner_password} data-testid="tenant-password" onChange={(e) => set("owner_password", e.target.value)} />
          <Input label="Contact Email (optional)" type="email" value={form.email} data-testid="tenant-email"
            hint="Saved as a contact address. Email sending is not enabled."
            onChange={(e) => set("email", e.target.value)} />
          <Input label="Mobile" value={form.mobile} onChange={(e) => set("mobile", e.target.value)} />
            <Input label="City" value={form.city} onChange={(e) => set("city", e.target.value)} />
            <Input label="State" value={form.state} onChange={(e) => set("state", e.target.value)} />
            <Select label="Subscription plan" value={form.plan_id || ""}
              onChange={(e) => {
                const plan = data.plans.find((row) => row.id === e.target.value);
                setForm((current) => ({
                  ...current, plan_id: e.target.value, plan: plan?.name || "Custom",
                }));
              }}
              options={[
                { value: "", label: "Custom (configure after creation)" },
                ...data.plans.filter((plan) => plan.active !== false)
                  .map((plan) => ({ value: plan.id, label: plan.name })),
              ]} />
            <Input label="Licence Validity (days)" type="number" value={form.license_days} onChange={(e) => set("license_days", e.target.value)} />
          </div>
        )}
      </Modal>

      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title={`Reset password — ${pwFor?.owner_name || ""}`}
        footer={<><Btn variant="s" onClick={() => setPwFor(null)}>Cancel</Btn>
          <Btn disabled={busy || pw.length < 6} data-testid="save-password" onClick={resetPw}>Update Password</Btn></>}>
        <Input label="New Password" value={pw} data-testid="new-password" hint="Minimum 6 characters" onChange={(e) => setPw(e.target.value)} />
      </Modal>
      <Modal open={!!cust} onClose={() => setCust(null)} title={`Edit subscription — ${cust?.name || ""}`}
        subtitle="Choose this customer's plan, expiry date and maximum included sections. Changes apply only to this customer."
        footer={<><Btn variant="s" onClick={() => setCust(null)}>Cancel</Btn>
          <Btn disabled={busy} data-testid="save-customise" onClick={saveCust}>Save subscription</Btn></>}
        wide>
        {cust && (
          <div className="space-y-4">
            <section className="rounded-xl border border-line bg-canvas/60 p-3.5">
              <h4 className="text-sm font-bold text-ink">Plan and renewal</h4>
              <p className="mb-3 mt-1 text-xs text-muted">
                The plan limits access for every user in this business. Set the next expiry date manually.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Select label="Subscription plan" value={cust.plan_id || ""}
                  onChange={(e) => chooseTenantPlan(e.target.value)}
                  options={[
                    { value: "", label: "Custom entitlements" },
                    ...data.plans.map((plan) => ({ value: plan.id, label: plan.name })),
                  ]} />
                <label className="block"><span className="lbl">Licence expiry / renewal date</span>
                  <input type="date" className="fld" value={cust.license_expiry || ""}
                    data-testid="cust-expiry" onChange={(e) => setCust({ ...cust, license_expiry: e.target.value })} /></label>
                <Input label="Monthly reference price (INR)" type="number" min="0" step="0.01"
                  value={cust.monthly_price} data-testid="cust-monthly-price"
                  onChange={(e) => setCust({ ...cust, monthly_price: e.target.value })} />
                <Input label="Annual reference price (INR)" type="number" min="0" step="0.01"
                  value={cust.annual_price} data-testid="cust-annual-price"
                  onChange={(e) => setCust({ ...cust, annual_price: e.target.value })} />
              </div>
              <p className="mt-2 text-xs text-muted">Reference prices are for your records only. No payment is collected here.</p>
            </section>
            <section>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-ink">What this subscription includes</h4>
                  <p className="mt-1 text-xs text-muted">
                    These are the maximum sections you can grant to any admin in this business.
                  </p>
                </div>
                <button type="button" data-testid="clear-subscription-access"
                  onClick={() => setCust((current) => ({ ...current, access: emptyAccess() }))}
                  className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand-400">
                  Clear all sections
                </button>
              </div>
              {!Object.values(cust.access).some(Boolean) && (
                <p role="status" data-testid="subscription-access-empty"
                  className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  No sections included. Users in this business will not have access to these modules.
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {ACCESS_GROUPS.map((group) => <section key={group.title}
                  className={`rounded-xl border border-line bg-white p-3 ${group.title === "Industrial modules" ? "md:col-span-2" : ""}`}
                  aria-label={`Subscription ${group.title}`}>
                  <h5 className="mb-2 text-sm font-semibold text-ink">{group.title}</h5>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.items.map(({ key, label }) => (
                      <label key={key} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                        <input type="checkbox" checked={cust.access[key] === true}
                          data-testid={`subscription-access-${key}`}
                          onChange={(event) => setCust({
                            ...cust, access: { ...cust.access, [key]: event.target.checked },
                          })} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </section>)}
              </div>
            </section>
            <TextArea label="Custom Requirement Notes" value={cust.custom_requests} data-testid="cust-notes"
              onChange={(e) => setCust({ ...cust, custom_requests: e.target.value })}
              hint="Write what this specific business asked for — kept against their licence only" />
          </div>
        )}
      </Modal>

      <Modal open={!!planForm} onClose={() => setPlanForm(null)}
        title={editingPlanId ? "Edit subscription plan" : "Create subscription plan"}
        subtitle="Changes apply to future assignments only. Existing customers keep their saved subscription snapshot."
        footer={<><Btn variant="s" onClick={() => setPlanForm(null)}>Cancel</Btn>
          <Btn disabled={busy || !planForm?.name?.trim()} data-testid="save-plan" onClick={savePlan}>
            {editingPlanId ? "Save plan" : "Create plan"}
          </Btn></>}>
        {planForm && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Plan name" required value={planForm.name} data-testid="plan-name"
                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} />
              <Input label="Monthly reference price (INR)" type="number" min="0" step="0.01"
                value={planForm.monthly_price} data-testid="plan-monthly-price"
                onChange={(e) => setPlanForm({ ...planForm, monthly_price: e.target.value })} />
              <Input label="Annual reference price (INR)" type="number" min="0" step="0.01"
                value={planForm.annual_price} data-testid="plan-annual-price"
                onChange={(e) => setPlanForm({ ...planForm, annual_price: e.target.value })} />
              <TextArea label="Plan description" value={planForm.description} data-testid="plan-description"
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} />
            </div>
            <div>
              <p className="lbl">Included sections</p>
              <p className="mb-2 text-xs text-muted">Select the maximum sections customers on this plan can be granted.</p>
              <div className="space-y-3">
                {ACCESS_GROUPS.map((group) => <section key={group.title}
                  className="rounded-xl border border-line p-3" aria-label={`Plan ${group.title}`}>
                  <h4 className="mb-2 text-sm font-semibold text-ink">{group.title}</h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.items.map(({ key, label }) => (
                      <label key={key} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                        <input type="checkbox" checked={planForm.access[key] === true}
                          data-testid={`plan-access-${key}`}
                          onChange={(event) => setPlanForm({
                            ...planForm, access: { ...planForm.access, [key]: event.target.checked },
                          })} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </section>)}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PlatformErrorLog({ logs }) {
  return (
    <Card className="overflow-hidden" data-testid="platform-error-log">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-head text-[15.5px] font-bold">Application API errors</h2>
        <p className="text-[12.5px] text-muted">
          Server-side API failures and failed write requests from across the app. Stack traces are visible to platform owners only.
        </p>
      </div>
      {logs.error ? <ErrorState text={logs.error} onRetry={logs.reload} />
        : logs.loading && !logs.data?.length ? <Loader label="Loading server errors…" />
          : <DataTable testid="error-log"
            columns={[
              { key: "created_at", label: "When", render: (row) => dmyDateTime(row.created_at) },
              { key: "source", label: "Source", render: (row) => row.source === "client" ? "Browser" : "Server" },
              { key: "method", label: "Method" },
              { key: "path", label: "Path", strong: true },
              { key: "status", label: "Status" },
              { key: "reference_id", label: "Reference" },
              {
                key: "detail",
                label: "Detail",
                render: (row) => (
                  <div>
                    <p>{row.detail}</p>
                    {row.traceback && <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-brand-700">Traceback</summary>
                      <pre className="mt-1 max-w-xl whitespace-pre-wrap text-xs">{row.traceback}</pre>
                    </details>}
                  </div>
                ),
              },
            ]}
            rows={logs.data || []}
            empty={<EmptyState title="No server errors" text="When an API returns an error, it will appear here." />} />}
    </Card>
  );
}

export function PlatformErrors() {
  const pageSize = 25;
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState({
    route: "", status: "", source: "", reference_id: "", from_date: "", to_date: "",
  });
  const [filters, setFilters] = useState(draftFilters);
  const logs = useFetch("/platform/errors", {
    page,
    page_size: pageSize,
    route: filters.route || undefined,
    status: filters.status ? Number(filters.status) : undefined,
    source: filters.source || undefined,
    reference_id: filters.reference_id || undefined,
    from_date: filters.from_date || undefined,
    to_date: filters.to_date || undefined,
  });
  const result = logs.data || { items: [], total: 0, page, page_size: pageSize };
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  const updateDraft = (key) => (event) => {
    setDraftFilters((current) => ({ ...current, [key]: event.target.value }));
  };
  const applyFilters = (event) => {
    event.preventDefault();
    setFilters({ ...draftFilters });
    setPage(1);
  };
  const clearFilters = () => {
    const emptyFilters = {
      route: "", status: "", source: "", reference_id: "", from_date: "", to_date: "",
    };
    setDraftFilters(emptyFilters);
    setFilters(emptyFilters);
    setPage(1);
  };

  return (
    <div data-testid="platform-errors-page">
      <PageHead title="Application error logs"
        subtitle="Review failed API requests across the application and inspect server traces." />
      <PlatformNavigation active="errors" />
      <Card className="mb-4 p-4">
        <form onSubmit={applyFilters} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-medium text-ink">
            Route
            <input className="fld mt-1" value={draftFilters.route} onChange={updateDraft("route")}
              placeholder="/api/platform/summary" aria-label="Filter by route" />
          </label>
          <label className="text-sm font-medium text-ink">
            HTTP status
            <input className="fld mt-1" type="number" min="400" max="599"
              value={draftFilters.status} onChange={updateDraft("status")}
              placeholder="Any status" aria-label="Filter by HTTP status" />
          </label>
          <label className="text-sm font-medium text-ink">
            Error source
            <select className="fld mt-1" value={draftFilters.source} onChange={updateDraft("source")}
              aria-label="Filter by error source">
              <option value="">All sources</option>
              <option value="server">Server/API</option>
              <option value="client">Browser crash</option>
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            Reference ID
            <input className="fld mt-1" value={draftFilters.reference_id}
              onChange={updateDraft("reference_id")} placeholder="Search reference ID"
              aria-label="Filter by reference ID" />
          </label>
          <label className="text-sm font-medium text-ink">
            From
            <input className="fld mt-1" type="date" value={draftFilters.from_date}
              onChange={updateDraft("from_date")} aria-label="Filter from date" />
          </label>
          <label className="text-sm font-medium text-ink">
            To
            <input className="fld mt-1" type="date" value={draftFilters.to_date}
              onChange={updateDraft("to_date")} aria-label="Filter to date" />
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
            <Btn type="submit">Apply filters</Btn>
            <Btn type="button" variant="s" onClick={clearFilters}>Clear</Btn>
          </div>
        </form>
      </Card>
      <PlatformErrorLog logs={{ ...logs, data: result.items }} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span>
          {result.total
            ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, result.total)} of ${result.total} errors`
            : "No matching errors"}
        </span>
        <div className="flex items-center gap-2">
          <Btn type="button" variant="s" disabled={page <= 1 || logs.loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Btn>
          <span>Page {page} of {pageCount}</span>
          <Btn type="button" variant="s" disabled={page >= pageCount || logs.loading}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Btn>
        </div>
      </div>
    </div>
  );
}

export function PlatformSettings() {
  const { data, loading, error, reload } = useFetch("/platform/summary");
  const activity = useFetch("/platform/activity");
  if (loading && !data) return <Loader label="Loading console…" />;
  if (error) return (
    <div data-testid="platform-settings-page">
      <PageHead title="Platform settings & activity"
        subtitle="Your platform-wide controls, operating rules, and recent administrative changes." />
      <PlatformNavigation active="settings" />
      <ErrorState text={error} onRetry={reload} />
    </div>
  );
  const t = data.totals;
  return (
    <div data-testid="platform-settings-page">
      <PageHead title="Platform settings & activity"
        subtitle="Your platform-wide controls, operating rules, and recent administrative changes." />
      <PlatformNavigation active="settings" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Customers" value={t.licenses} />
        <Stat label="Active" value={t.active} tone="text-brand-600" />
        <Stat label="Suspended" value={t.suspended} />
        <Stat label="Plans" value={data.plans.length} />
      </div>
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h3 className="font-head text-base font-bold text-ink">Platform management</h3>
          <p className="mt-1 text-sm text-muted">Common tasks, grouped by what you need to change.</p>
          <div className="mt-4 grid gap-2">
            <Link to="/platform" className="flex items-center justify-between rounded-xl border border-line p-3 hover:border-brand-400">
              <span><b className="block text-sm">Manage a customer</b>
                <small className="text-muted">Subscription, expiry, owner account and individual user access</small></span>
              <Building2 size={18} className="text-brand-700" />
            </Link>
            <Link to="/platform/plans" className="flex items-center justify-between rounded-xl border border-line p-3 hover:border-brand-400">
              <span><b className="block text-sm">Manage plans &amp; reference pricing</b>
                <small className="text-muted">Edit reusable templates; assigned customer snapshots stay unchanged</small></span>
              <ShieldCheck size={18} className="text-brand-700" />
            </Link>
          </div>
        </Card>
        <Card className="p-4 sm:p-5" data-testid="platform-operating-rules">
          <h3 className="font-head text-base font-bold text-ink">Current operating rules</h3>
          <dl className="mt-3 divide-y divide-line text-sm">
            {[
              ["Access", "A user’s access is limited by both their own grants and the customer subscription."],
              ["Subscription changes", "Changes take effect on the next authenticated API request; tighter plans clamp saved admin grants."],
              ["Renewal", "Expiry dates and Active/Suspended status are managed manually. No automatic grace period."],
              ["Payments", "Plan prices are reference values only. Billing and payment collection are not connected."],
              ["Customer data", "Suspending a licence blocks access; it does not delete or move customer data."],
            ].map(([label, description]) => <div key={label} className="py-2.5">
              <dt className="font-semibold text-ink">{label}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted">{description}</dd>
            </div>)}
          </dl>
        </Card>
      </div>
      <Card className="mb-5 overflow-hidden" data-testid="platform-activity">
        <div className="border-b border-line px-4 py-3">
          <h3 className="font-head text-[15.5px] font-bold">Recent platform changes</h3>
          <p className="text-[12.5px] text-muted">Customer subscription, access, account-status and plan-template updates.</p>
        </div>
        {activity.error ? <ErrorState text={activity.error} onRetry={activity.reload} />
          : activity.loading && !activity.data ? <Loader label="Loading platform activity…" />
            : (activity.data || []).length ? <ol className="divide-y divide-line">
              {activity.data.map((event) => <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{event.summary}</p>
                  <p className="mt-1 text-xs text-muted">{event.tenant_name || "Platform"} · by {event.actor}</p>
                </div>
                <time className="text-xs text-muted">{dmyDateTime(event.created_at)}</time>
              </li>)}
            </ol> : <EmptyState title="No platform changes yet" text="Saved plan, subscription and access changes will be recorded here." />}
      </Card>
    </div>
  );
}
