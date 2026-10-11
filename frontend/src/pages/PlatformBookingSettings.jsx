import React, { useCallback, useEffect, useState } from "react";
import { Copy, Plus, Save, ShieldCheck, Users } from "lucide-react";
import { api, assetUrl, errMsg } from "../lib/api";
import { Badge, Btn, Card, EmptyState, Input, Loader, Select, toast } from "../components/ui";

const PERMISSION_GROUPS = [
  { label: "Dashboard", permissions: [["dashboard:read", "View dashboard"]] },
  { label: "Trips", permissions: [
    ["trips:read", "View trips"], ["trips:create", "Create trips"], ["trips:update", "Edit trips"],
  ] },
  { label: "Receipts and LRs", permissions: [
    ["lrs:read", "View LRs"], ["lrs:create", "Create LRs"], ["lrs:update", "Edit LRs"],
  ] },
  { label: "Ledger", permissions: [["ledger:export", "Download daily ledger"]] },
  { label: "Finance", permissions: [
    ["finance:read", "View finance"], ["finance:update", "Update finance"],
    ["payments:read", "View payments"], ["payments:create", "Record payments"],
  ] },
];
const DEFAULT_MANAGER_PERMISSIONS = [
  "dashboard:read", "trips:read", "trips:create", "trips:update",
  "lrs:read", "lrs:create", "lrs:update", "ledger:export",
];
const blankSite = { name: "", code: "", location: "", city: "", timezone: "Asia/Kolkata" };
const defaultGlobalReceiptControls = {
  sender_address_enabled: true, receiver_address_enabled: true, receiver_phone_enabled: true,
};
const defaultReceiptControls = {
  hindi_conversion_enabled: true, receipt_language: "hindi", receipt_print_size: "default",
  receipt_fee: "2.00", overdue_after_days: "30",
};
const defaultBranding = {
  company_name: "", address: "", legal_line: "", logo_url: "", contacts: [],
  terms: "", footer: "",
};
const sitePath = (tenantId, tail = "") =>
  `/platform/tenants/${encodeURIComponent(tenantId)}/booking${tail}`;

const siteDraftFrom = (site) => ({
  ...blankSite,
  name: site.name || "",
  code: site.code || "",
  location: site.location || "",
  city: site.city || "",
  timezone: site.timezone || "Asia/Kolkata",
  status: site.status || "Active",
  config: {
    ...(site.config || {}),
    goods_suggestions: Array.isArray(site.config?.goods_suggestions)
      ? site.config.goods_suggestions : [],
    receipt_controls: { ...defaultReceiptControls, ...(site.config?.receipt_controls || {}) },
    receipt_branding: { ...defaultBranding, ...(site.config?.receipt_branding || {}) },
  },
});

export default function PlatformBookingSettings({ tenant }) {
  const [sites, setSites] = useState([]);
  const [managers, setManagers] = useState([]);
  const [siteId, setSiteId] = useState("");
  const [siteDraft, setSiteDraft] = useState(null);
  const [newSite, setNewSite] = useState(blankSite);
  const [categories, setCategories] = useState({ goods: [], containers: [] });
  const [categoryDraft, setCategoryDraft] = useState({ kind: "goods", name: "" });
  const [globalControls, setGlobalControls] = useState(defaultGlobalReceiptControls);
  const [managerDraft, setManagerDraft] = useState({
    name: "", username: "", permissions: DEFAULT_MANAGER_PERMISSIONS,
  });
  const [selectedManager, setSelectedManager] = useState("");
  const [managerPermissions, setManagerPermissions] = useState(DEFAULT_MANAGER_PERMISSIONS);
  const [resetPassword, setResetPassword] = useState("");
  const [temporaryCredential, setTemporaryCredential] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedSite = sites.find((site) => site.id === siteId) || null;
  const load = useCallback(async (preferredSite = "") => {
    setLoading(true);
    setError("");
    try {
      const [sitesResponse, managersResponse, controlsResponse] = await Promise.all([
        api.get(sitePath(tenant.id, "/sites")),
        api.get(sitePath(tenant.id, "/managers")),
        api.get(sitePath(tenant.id, "/receipt-controls")),
      ]);
      const nextSites = sitesResponse.data || [];
      setSites(nextSites);
      setManagers(managersResponse.data || []);
      setGlobalControls({ ...defaultGlobalReceiptControls, ...(controlsResponse.data || {}) });
      const nextSite = nextSites.find((site) => site.id === preferredSite) || nextSites[0] || null;
      setSiteId(nextSite?.id || "");
      setSiteDraft(nextSite ? siteDraftFrom(nextSite) : null);
      if (nextSite) {
        const categoriesResponse = await api.get(sitePath(
          tenant.id, `/sites/${encodeURIComponent(nextSite.id)}/categories`,
        ));
        setCategories(categoriesResponse.data || { goods: [], containers: [] });
      } else {
        setCategories({ goods: [], containers: [] });
      }
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => { load(""); }, [load]);

  useEffect(() => {
    const manager = managers.find((item) => item.username === selectedManager);
    setManagerPermissions(manager?.site_permissions?.[siteId] || DEFAULT_MANAGER_PERMISSIONS);
  }, [managers, selectedManager, siteId]);

  const selectSite = async (id) => {
    setSiteId(id);
    const site = sites.find((item) => item.id === id);
    setSiteDraft(site ? siteDraftFrom(site) : null);
    setError("");
    if (!id) {
      setCategories({ goods: [], containers: [] });
      return;
    }
    try {
      const response = await api.get(sitePath(
        tenant.id, `/sites/${encodeURIComponent(id)}/categories`,
      ));
      setCategories(response.data || { goods: [], containers: [] });
    } catch (requestError) {
      setError(errMsg(requestError));
    }
  };

  const saveSite = async (event) => {
    event.preventDefault();
    if (!siteId || !siteDraft) return;
    setBusy(true);
    setError("");
    try {
      await api.put(sitePath(
        tenant.id, `/sites/${encodeURIComponent(siteId)}`,
      ), {
        name: siteDraft.name,
        location: siteDraft.location,
        city: siteDraft.city,
        timezone: siteDraft.timezone,
        status: siteDraft.status,
        config: siteDraft.config,
      });
      setNotice("Booking settings saved for this customer.");
      await load(siteId);
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setBusy(false);
    }
  };

  const createSite = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await api.post(sitePath(tenant.id, "/sites"), newSite);
      setNewSite(blankSite);
      setNotice("Site added. Choose it below to configure its receipt settings.");
      await load(response.data.id);
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setBusy(false);
    }
  };

  const saveGlobalControls = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.put(sitePath(tenant.id, "/receipt-controls"), globalControls);
      setNotice("Business-wide receipt visibility saved.");
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async (event) => {
    event.preventDefault();
    if (!siteId || !categoryDraft.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.post(sitePath(
        tenant.id, `/sites/${encodeURIComponent(siteId)}/categories`,
      ), { ...categoryDraft, name: categoryDraft.name.trim() });
      const response = await api.get(sitePath(
        tenant.id, `/sites/${encodeURIComponent(siteId)}/categories`,
      ));
      setCategories(response.data || { goods: [], containers: [] });
      setCategoryDraft((current) => ({ ...current, name: "" }));
      setNotice("Receipt option added.");
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    setError("");
    try {
      const payload = new FormData();
      payload.append("file", file);
      const response = await api.post(sitePath(tenant.id, "/upload?kind=logo"), payload, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSiteDraft((current) => ({
        ...current,
        config: {
          ...current.config,
          receipt_branding: {
            ...current.config.receipt_branding,
            logo_url: assetUrl(response.data.url),
          },
        },
      }));
      setNotice("Logo uploaded. Save this site's Booking settings to apply it.");
    } catch (uploadError) {
      setError(errMsg(uploadError));
    } finally {
      setLogoUploading(false);
      event.target.value = "";
    }
  };

  const assignManager = async (event) => {
    event.preventDefault();
    if (!siteId) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post(sitePath(
        tenant.id, `/sites/${encodeURIComponent(siteId)}/manager`,
      ), managerDraft);
      if (response.data.temporary_password) {
        setTemporaryCredential({
          username: response.data.username,
          password: response.data.temporary_password,
        });
      }
      setManagerDraft({ name: "", username: "", permissions: DEFAULT_MANAGER_PERMISSIONS });
      setNotice("Manager access saved for this site.");
      await load(siteId);
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setBusy(false);
    }
  };

  const saveManagerAccess = async (event) => {
    event.preventDefault();
    if (!selectedManager || !siteId) return;
    setBusy(true);
    setError("");
    try {
      await api.put(sitePath(
        tenant.id, `/managers/${encodeURIComponent(selectedManager)}/access`,
      ), { site_id: siteId, permissions: managerPermissions });
      setNotice("Manager's permissions saved for this site.");
      await load(siteId);
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setBusy(false);
    }
  };

  const resetManagerCredential = async () => {
    if (!selectedManager || !resetPassword) return;
    setBusy(true);
    setError("");
    try {
      await api.post(sitePath(
        tenant.id, `/managers/${encodeURIComponent(selectedManager)}/reset-password`,
      ), { password: resetPassword });
      setTemporaryCredential({ username: selectedManager, password: resetPassword });
      setResetPassword("");
      setNotice("Manager password reset. Copy the temporary credential and share it securely.");
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setBusy(false);
    }
  };

  const deactivateManager = async () => {
    const manager = managers.find((item) => item.username === selectedManager);
    if (!manager || !window.confirm(
      `Deactivate ${manager.name || manager.username} across all assigned sites?`,
    )) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(sitePath(
        tenant.id, `/managers/${encodeURIComponent(selectedManager)}`,
      ));
      setSelectedManager("");
      setNotice("Manager account deactivated and site access removed.");
      await load(siteId);
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setBusy(false);
    }
  };

  const setConfig = (key, value) => setSiteDraft((current) => ({
    ...current, config: { ...current.config, [key]: value },
  }));
  const setReceiptControl = (key, value) => setConfig("receipt_controls", {
    ...siteDraft.config.receipt_controls, [key]: value,
  });
  const setBranding = (key, value) => setConfig("receipt_branding", {
    ...siteDraft.config.receipt_branding, [key]: value,
  });
  const setContact = (index, key, value) => setBranding("contacts",
    (siteDraft.config.receipt_branding.contacts || []).map((contact, i) =>
      i === index ? { ...contact, [key]: value } : contact));
  const addContact = () => {
    const contacts = siteDraft.config.receipt_branding.contacts || [];
    if (contacts.length >= 3) return;
    setBranding("contacts", [...contacts, {
      label: "", phone: "", phone_label: "", alternate_phone: "", alternate_phone_label: "",
    }]);
  };
  const setPermission = (permission, checked, target, setter) => setter((current) => ({
    ...current,
    [target]: checked
      ? [...current[target], permission]
      : current[target].filter((value) => value !== permission),
  }));

  if (loading) return <Loader label="Loading customer Booking settings…" />;
  const Toggle = ({ checked, onChange, label, description }) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white p-3">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={checked}
        onChange={(event) => onChange(event.target.checked)} />
      <span><span className="block text-sm font-semibold text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}</span>
    </label>
  );

  return (
    <div className="space-y-4" data-testid="platform-booking-settings">
      <Card className="border-brand-200 bg-brand-50/60 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-brand-700" />
          <div>
            <h3 className="font-semibold text-ink">Platform-managed Booking setup</h3>
            <p className="mt-1 text-sm text-muted">
              Platform support stays available alongside the customer's own access.
              Changes here apply directly to {tenant.name} and are recorded in the customer change history.
            </p>
          </div>
        </div>
      </Card>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">{notice}</div>}

      <Card className="p-4 sm:p-5">
        <div className="mb-3">
          <h3 className="font-head text-base font-bold text-ink">Business-wide receipt visibility</h3>
          <p className="mt-1 text-sm text-muted">Choose which customer and receiver details can be printed on receipts.</p>
        </div>
        <form onSubmit={saveGlobalControls} className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <Toggle label="Show sender address" checked={globalControls.sender_address_enabled}
              onChange={(value) => setGlobalControls({ ...globalControls, sender_address_enabled: value })} />
            <Toggle label="Show receiver address" checked={globalControls.receiver_address_enabled}
              onChange={(value) => setGlobalControls({ ...globalControls, receiver_address_enabled: value })} />
            <Toggle label="Show receiver phone" checked={globalControls.receiver_phone_enabled}
              onChange={(value) => setGlobalControls({ ...globalControls, receiver_phone_enabled: value })} />
          </div>
          <Btn type="submit" disabled={busy} icon={Save}>Save visibility</Btn>
        </form>
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="font-head text-base font-bold text-ink">Booking sites</h3>
        <p className="mt-1 text-sm text-muted">Configure each site's identity, receipt and category settings.</p>
        {sites.length > 0 && <label className="mt-3 block max-w-xl text-sm font-semibold">
          Choose a site
          <select className="fld mt-1" value={siteId} onChange={(event) => selectSite(event.target.value)}>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.code}</option>)}
          </select>
        </label>}
        <details className="mt-4 rounded-xl border border-line p-3">
          <summary className="min-h-10 cursor-pointer font-semibold text-brand-800">Add a new site</summary>
          <form onSubmit={createSite} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="Site name" required value={newSite.name}
              onChange={(event) => setNewSite({ ...newSite, name: event.target.value })} />
            <Input label="Short code" required value={newSite.code}
              onChange={(event) => setNewSite({ ...newSite, code: event.target.value })} />
            <Input label="Location" value={newSite.location}
              onChange={(event) => setNewSite({ ...newSite, location: event.target.value })} />
            <Input label="City" value={newSite.city}
              onChange={(event) => setNewSite({ ...newSite, city: event.target.value })} />
            <Input label="Time zone" value={newSite.timezone}
              onChange={(event) => setNewSite({ ...newSite, timezone: event.target.value })} />
            <div className="sm:col-span-2"><Btn type="submit" disabled={busy} icon={Plus}>Create site</Btn></div>
          </form>
        </details>

        {siteDraft ? <form className="mt-4 space-y-4" onSubmit={saveSite}>
          <section className="rounded-xl border border-line p-3.5">
            <h4 className="font-semibold text-ink">Site details</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input label="Site name" required value={siteDraft.name}
                onChange={(event) => setSiteDraft({ ...siteDraft, name: event.target.value })} />
              <Input label="Short code" value={siteDraft.code} disabled />
              <Input label="Location" value={siteDraft.location}
                onChange={(event) => setSiteDraft({ ...siteDraft, location: event.target.value })} />
              <Input label="City" value={siteDraft.city}
                onChange={(event) => setSiteDraft({ ...siteDraft, city: event.target.value })} />
              <Input label="Time zone" value={siteDraft.timezone}
                onChange={(event) => setSiteDraft({ ...siteDraft, timezone: event.target.value })} />
              <label className="text-sm font-medium">Site status
                <select className="fld mt-1" value={siteDraft.status}
                  onChange={(event) => setSiteDraft({ ...siteDraft, status: event.target.value })}>
                  <option value="Active">Active</option><option value="Inactive">Inactive</option>
                </select>
              </label>
            </div>
          </section>

          <details className="rounded-xl border border-line p-3.5" open>
            <summary className="min-h-10 cursor-pointer font-semibold text-ink">Receipt format and charges</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Toggle label="Hindi conversion" checked={siteDraft.config.receipt_controls.hindi_conversion_enabled}
                onChange={(value) => setReceiptControl("hindi_conversion_enabled", value)} />
              <Toggle label="Print in Hindi"
                checked={siteDraft.config.receipt_controls.receipt_language === "hindi"}
                onChange={(value) => setReceiptControl("receipt_language", value ? "hindi" : "english")} />
              <label className="text-sm font-medium">Receipt print size
                <select className="fld mt-1" value={siteDraft.config.receipt_controls.receipt_print_size}
                  onChange={(event) => setReceiptControl("receipt_print_size", event.target.value)}>
                  <option value="default">A4 / standard</option><option value="80mm">Thermal · 80 mm</option>
                  <option value="58mm">Thermal · 58 mm</option>
                </select>
              </label>
              <Input label="Default receipt fee (INR)" type="number" min="0" step="0.01"
                value={siteDraft.config.receipt_controls.receipt_fee}
                onChange={(event) => setReceiptControl("receipt_fee", event.target.value)} />
              <Input label="Overdue after (days)" type="number" min="1"
                value={siteDraft.config.receipt_controls.overdue_after_days}
                onChange={(event) => setReceiptControl("overdue_after_days", Number(event.target.value))} />
            </div>
          </details>

          <details className="rounded-xl border border-line p-3.5">
            <summary className="min-h-10 cursor-pointer font-semibold text-ink">Receipt company identity and print details</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input label="Company name on receipt" value={siteDraft.config.receipt_branding.company_name}
                onChange={(event) => setBranding("company_name", event.target.value)} />
              <Input label="Court / jurisdiction line" value={siteDraft.config.receipt_branding.legal_line}
                onChange={(event) => setBranding("legal_line", event.target.value)} />
              <div className="sm:col-span-2">
                <Input label="Printed company address" value={siteDraft.config.receipt_branding.address}
                  onChange={(event) => setBranding("address", event.target.value)} />
              </div>
              <div className="sm:col-span-2 rounded-xl border border-line p-3">
                <p className="text-sm font-semibold">Receipt logo</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {siteDraft.config.receipt_branding.logo_url && <img
                    src={siteDraft.config.receipt_branding.logo_url} alt="Receipt logo preview"
                    className="h-14 max-w-40 object-contain" />}
                  <label className="text-sm">
                    <span className="sr-only">Upload receipt logo</span>
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif" aria-label="Upload receipt logo"
                      disabled={logoUploading} onChange={uploadLogo} />
                  </label>
                  {logoUploading && <span role="status" className="text-xs text-muted">Uploading logo…</span>}
                  {siteDraft.config.receipt_branding.logo_url && <button type="button"
                    className="text-xs font-semibold text-red-700 underline"
                    onClick={() => setBranding("logo_url", "")}>Remove logo</button>}
                </div>
              </div>
              <div className="sm:col-span-2">
                <h5 className="mb-2 text-sm font-semibold">Branch phone lines (up to 3)</h5>
                {(siteDraft.config.receipt_branding.contacts || []).map((contact, index) => (
                  <div key={index} className="mb-2 grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
                    <Input label={`Branch ${index + 1}`} value={contact.label}
                      onChange={(event) => setContact(index, "label", event.target.value)} />
                    <Input label="Phone number" value={contact.phone}
                      onChange={(event) => setContact(index, "phone", event.target.value)} />
                    <Input label="Phone label" value={contact.phone_label}
                      onChange={(event) => setContact(index, "phone_label", event.target.value)} />
                    <Input label="Second phone number" value={contact.alternate_phone}
                      onChange={(event) => setContact(index, "alternate_phone", event.target.value)} />
                  </div>
                ))}
                {(siteDraft.config.receipt_branding.contacts || []).length < 3 && <button type="button"
                  className="mt-1 text-sm font-semibold text-brand-800 underline" onClick={addContact}>
                  Add branch contact
                </button>}
              </div>
              <label className="text-sm font-medium">Terms / conditions
                <textarea className="fld mt-1 min-h-20" value={siteDraft.config.receipt_branding.terms}
                  onChange={(event) => setBranding("terms", event.target.value)} />
              </label>
              <label className="text-sm font-medium">Receipt footer
                <textarea className="fld mt-1 min-h-20" value={siteDraft.config.receipt_branding.footer}
                  onChange={(event) => setBranding("footer", event.target.value)} />
              </label>
            </div>
          </details>

          <section className="rounded-xl border border-line p-3.5">
            <h4 className="font-semibold text-ink">Receipt name options</h4>
            <p className="mt-1 text-xs text-muted">These names appear as choices when staff create a receipt.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(siteDraft.config.goods_suggestions || []).map((name) => <Badge key={name}>{name}</Badge>)}
            </div>
            <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("goods-suggestion");
              const name = input.value.trim();
              if (!name || siteDraft.config.goods_suggestions.some(
                (item) => item.toLowerCase() === name.toLowerCase(),
              )) return;
              setConfig("goods_suggestions", [...siteDraft.config.goods_suggestions, name]);
              input.value = "";
            }}>
              <input name="goods-suggestion" className="fld max-w-sm" placeholder="Add a receipt name" />
              <Btn type="submit" variant="s" icon={Plus}>Add name</Btn>
            </form>
            <div className="mt-4 border-t border-line pt-3">
              <h5 className="text-sm font-semibold text-ink">Saved goods and container categories</h5>
              <form onSubmit={addCategory} className="mt-2 flex flex-wrap gap-2">
                <select className="fld max-w-48" value={categoryDraft.kind}
                  onChange={(event) => setCategoryDraft({ ...categoryDraft, kind: event.target.value })}>
                  <option value="goods">Goods</option><option value="containers">Containers</option>
                </select>
                <input className="fld max-w-sm" aria-label="New receipt category" value={categoryDraft.name}
                  onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })}
                  placeholder="Add a reusable category" />
                <Btn type="submit" variant="s" icon={Plus} disabled={busy || !siteId}>Add category</Btn>
              </form>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...(categories.goods || []).map((name) => `Goods: ${name}`),
                  ...(categories.containers || []).map((name) => `Container: ${name}`)]
                  .map((label) => <Badge key={label}>{label}</Badge>)}
              </div>
            </div>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-xs text-muted">Settings apply to {selectedSite?.name} only.</span>
            <Btn type="submit" disabled={busy} icon={Save}>Save site settings</Btn>
          </div>
        </form> : <EmptyState title="No Booking sites yet" text="Create a site above to configure receipts and manager access." />}
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Users size={19} className="mt-0.5 text-brand-700" />
          <div><h3 className="font-head text-base font-bold text-ink">Site-manager accounts and access</h3>
            <p className="mt-1 text-sm text-muted">Create or assign a manager to the selected site. Permissions are site-specific.</p></div>
        </div>
        {!siteId ? <p className="mt-3 text-sm text-muted">Create or select a site before assigning a manager.</p> : <>
          <form onSubmit={assignManager} className="mt-4 rounded-xl border border-line bg-canvas/50 p-3.5">
            <h4 className="font-semibold text-ink">Assign a manager to {selectedSite?.name}</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input label="Manager name" required value={managerDraft.name}
                onChange={(event) => setManagerDraft({ ...managerDraft, name: event.target.value })} />
              <Input label="Manager login ID" required maxLength={60} value={managerDraft.username}
                onChange={(event) => setManagerDraft({ ...managerDraft, username: event.target.value.toLowerCase() })} />
            </div>
            <p className="mt-2 text-xs text-muted">
              A secure temporary password is generated for a new manager and shown once. Existing manager accounts are reused.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PERMISSION_GROUPS.flatMap((group) => group.permissions).map(([permission, label]) => (
                <label key={permission} className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm">
                  <input type="checkbox" className="accent-brand-700"
                    checked={managerDraft.permissions.includes(permission)}
                    onChange={(event) => setPermission(permission, event.target.checked, "permissions", setManagerDraft)} />
                  {label}
                </label>
              ))}
            </div>
            <Btn className="mt-3" type="submit" disabled={busy}>Save manager access</Btn>
          </form>

          {temporaryCredential && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3" role="status">
            <strong>Temporary manager credential — copy it now</strong>
            <p className="mt-1 text-sm">Login: <code>{temporaryCredential.username}</code></p>
            <p className="break-all text-sm">Password: <code>{temporaryCredential.password}</code></p>
            <button type="button" className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-brand-800"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `Manager ID: ${temporaryCredential.username}\nTemporary password: ${temporaryCredential.password}`,
                  );
                  toast("Temporary credential copied");
                } catch {
                  setError("Could not copy the credential. Select and copy it manually, then share it securely.");
                }
              }}><Copy size={15} /> Copy credential</button>
          </div>}

          <form onSubmit={saveManagerAccess} className="mt-4 border-t border-line pt-4">
            <h4 className="font-semibold text-ink">Update an existing manager's access</h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Select aria-label="Select site manager" value={selectedManager}
                onChange={(event) => setSelectedManager(event.target.value)}
                options={[
                  { value: "", label: "Select a manager" },
                  ...managers.map((item) => ({
                    value: item.username, label: `${item.name || item.username} · ${item.active ? "Active" : "Inactive"}`,
                  })),
                ]} />
              <div className="flex flex-wrap gap-2">
                <Btn type="submit" variant="s" disabled={busy || !selectedManager}>Save site permissions</Btn>
                {selectedManager && <button type="button" className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-700"
                  onClick={deactivateManager}>Deactivate account</button>}
              </div>
            </div>
            {selectedManager && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PERMISSION_GROUPS.flatMap((group) => group.permissions).map(([permission, label]) => (
                <label key={permission} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm">
                  <input type="checkbox" className="accent-brand-700"
                    checked={managerPermissions.includes(permission)}
                    onChange={(event) => setPermission(permission, event.target.checked, "permissions", setManagerPermissions)} />
                  {label}
                </label>
              ))}
            </div>}
          </form>
          {selectedManager && <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <label className="min-w-64 flex-1 text-sm font-medium">Reset selected manager's password
              <input className="fld mt-1" type="password" value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)} />
            </label>
            <Btn variant="s" disabled={busy || !resetPassword} onClick={resetManagerCredential}>Reset password</Btn>
          </div>}
          <div className="mt-4 border-t border-line pt-3">
            <h4 className="text-sm font-semibold text-ink">Manager register</h4>
            {managers.length ? <div className="mt-2 divide-y divide-line">
              {managers.map((manager) => {
                const assignedSites = sites.filter((site) => manager.site_ids?.includes(site.id));
                return <div key={manager.username} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                  <span><strong>{manager.name || manager.username}</strong>
                    <span className="ml-2 text-muted">{manager.active ? "Active" : "Inactive"}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      @{manager.username} · Sites: {assignedSites.map((site) => site.name).join(", ") || "None"}
                    </span></span>
                  <button type="button" className="text-xs font-semibold text-brand-800 underline"
                    onClick={() => setSelectedManager(manager.username)}>Manage account</button>
                </div>;
              })}
            </div> : <p className="mt-2 text-sm text-muted">No manager logins are assigned yet.</p>}
          </div>
        </>}
      </Card>
    </div>
  );
}
