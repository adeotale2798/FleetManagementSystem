import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Clock3, Search } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { Card, EmptyState, Loader } from "../components/ui";
import { dmy, money, todayISO } from "../lib/format";
import { exportCSV } from "../lib/export";

const field = "fld w-full";
const PAGE_SIZE = 25;
const CHARGE_COLORS = ["#0b5c4e", "#65a99a", "#e0a33e"];
const requestKey = () => window.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const amount = (value) => Number(value) || 0;
const rupeeTick = (value) => `₹${Number(value).toLocaleString("en-IN")}`;
const csvSafeText = (value) => {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

export default function BookingFinance({ user, initialFilter = "all" }) {
  const navigate = useNavigate();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState(localStorage.getItem("booking_site_id") || "");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [followupOpen, setFollowupOpen] = useState({});
  const [saveStatus, setSaveStatus] = useState({});
  const [settlementStatus, setSettlementStatus] = useState({});
  const [search, setSearch] = useState("");
  const [rowFilter, setRowFilter] = useState(() =>
    ["overdue-promise", "unpriced"].includes(initialFilter) ? initialFilter : "all");
  const [rowPage, setRowPage] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    api.get("/sites").then((response) => {
      if (!active) return;
      const available = response.data || [];
      setSites(available);
      const selected = available.some((site) => site.id === siteId)
        ? siteId : available[0]?.id || "";
      setSiteId(selected);
    }).catch((requestError) => {
      if (active) { setError(errMsg(requestError)); setBusy(false); }
    });
    return () => { active = false; };
  }, [reloadVersion]); // Sites are loaded on entry and explicit retry.

  useEffect(() => {
    if (!siteId) { setData(null); setBusy(false); return undefined; }
    let active = true;
    setBusy(true);
    setError("");
    localStorage.setItem("booking_site_id", siteId);
    api.get(`/sites/${siteId}/booking-finance`).then((response) => {
      if (active) { setData(response.data); setDrafts({}); setSaveStatus({}); }
    }).catch((requestError) => {
      if (active) setError(errMsg(requestError));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [siteId, reloadVersion]);

  const currentDate = todayISO();
  const totals = data?.totals || {};
  const overdueAfterDays = Math.max(1, Number(data?.overdue_after_days) || 30);
  const loadedForSite = data?.site?.id === siteId;
  const rows = useMemo(() => (data?.rows || []).filter((row) => {
    const term = search.trim().toLowerCase();
    return !term || [row.lr_ref, row.trip_ref, row.sender_name, row.receiver_name, row.goods]
      .some((value) => String(value || "").toLowerCase().includes(term));
  }).filter((row) => {
    if (rowFilter === "outstanding") return amount(row.outstanding) > 0;
    if (rowFilter === "order-check") return !row.reconciled;
    if (rowFilter === "promised") return Boolean(
      row.promised_date || row.followup_note || row.next_contact_date || row.followup_outcome,
    );
    if (rowFilter === "unfollowed") return amount(row.outstanding) > 0
      && !row.promised_date && !row.followup_note && !row.next_contact_date && !row.followup_outcome;
    if (rowFilter === "unpriced") return row.rent == null;
    if (rowFilter === "overdue-promise") return amount(row.outstanding) > 0
      && Boolean(row.promised_date && row.promised_date < currentDate);
    if (rowFilter === "overdue") return amount(row.outstanding) > 0
      && (amount(row.age_days) >= overdueAfterDays
        || (row.promised_date && row.promised_date < currentDate));
    return true;
  }).sort((left, right) =>
    amount(right.outstanding) - amount(left.outstanding)
    || amount(right.age_days) - amount(left.age_days)
    || String(left.lr_ref).localeCompare(String(right.lr_ref))),
  [data, search, rowFilter, currentDate, overdueAfterDays]);
  const chargeBreakdown = useMemo(() => [
    { name: "Bhada", value: amount(totals.recorded_bhada) },
    { name: "Hamali", value: amount(totals.recorded_hamali) },
    { name: "Receipt fees", value: amount(totals.recorded_receipt_fees) },
  ].filter((item) => item.value > 0), [totals]);
  const agingBreakdown = useMemo(() => {
    const buckets = [
      { name: "0–7 days", min: 0, max: 7, amount: 0, receipts: 0 },
      { name: "8–30 days", min: 8, max: 30, amount: 0, receipts: 0 },
      { name: "31–60 days", min: 31, max: 60, amount: 0, receipts: 0 },
      { name: "61+ days", min: 61, max: Infinity, amount: 0, receipts: 0 },
    ];
    (data?.rows || []).forEach((row) => {
      const outstanding = amount(row.outstanding);
      if (outstanding <= 0) return;
      const age = Math.max(0, amount(row.age_days));
      const bucket = buckets.find((item) => age >= item.min && age <= item.max);
      if (bucket) {
        bucket.amount += outstanding;
        bucket.receipts += 1;
      }
    });
    return buckets;
  }, [data]);
  const receiverChart = useMemo(() => (data?.receiver_balances || [])
    .filter((receiver) => amount(receiver.outstanding) > 0)
    .slice(0, 6)
    .map((receiver) => ({
      name: receiver.receiver_label || receiver.receiver_name || "Receiver",
      collected: amount(receiver.collected),
      outstanding: amount(receiver.outstanding),
      receipts: receiver.receipt_count,
    })), [data]);
  const collectionBase = amount(totals.collected_bhada) + amount(totals.outstanding_bhada);
  const collectionRate = collectionBase > 0
    ? Math.min(100, amount(totals.collected_bhada) / collectionBase * 100) : 0;
  const unpricedCount = amount(totals.unpriced_receipts);
  const pendingOrderCount = amount(totals.pending_orders);
  const overduePaymentCount = (data?.rows || []).filter((row) =>
    amount(row.outstanding) > 0 && amount(row.age_days) >= overdueAfterDays).length;
  const overduePromiseCount = (data?.rows || []).filter((row) =>
    amount(row.outstanding) > 0 && row.promised_date && row.promised_date < currentDate).length;
  const unpromisedDueCount = (data?.rows || []).filter((row) =>
    amount(row.outstanding) > 0 && !row.promised_date && !row.followup_note
      && !row.next_contact_date && !row.followup_outcome).length;
  const queueItems = [
    ...(data?.rows || []).filter((row) => amount(row.outstanding) > 0
      && row.promised_date && row.promised_date < currentDate)
      .map((row) => ({ row, kind: "overdue-promise" })),
    ...(data?.rows || []).filter((row) => row.rent == null)
      .map((row) => ({ row, kind: "unpriced" })),
  ].slice(0, 8);
  const pageCount = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice(rowPage * PAGE_SIZE, (rowPage + 1) * PAGE_SIZE);
  useEffect(() => {
    setRowPage((page) => Math.min(page, Math.max(pageCount - 1, 0)));
  }, [pageCount]);
  const updateDraft = (row, key, value) => setDrafts((current) => ({
    ...current, [row.id]: { ...(current[row.id] || {}), [key]: value },
  }));
  const openQueueFollowup = (row) => {
    setRowFilter("overdue-promise");
    setSearch(row.lr_ref || "");
    setRowPage(0);
    setFollowupOpen((current) => ({ ...current, [row.id]: true }));
    window.setTimeout(() => document.getElementById("finance-follow-up-list")
      ?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0);
  };
  const openUnpricedReceipt = (row) => {
    navigate("/booking/receipts", {
      state: {
        bookingAttentionReceipt: {
          siteId: row.site_id, tripId: row.trip_id, receiptId: row.id,
        },
      },
    });
  };
  const saveFollowup = async (row) => {
    const changes = drafts[row.id] || {};
    setSaveStatus((current) => ({ ...current, [row.id]: "Saving…" }));
    try {
      const response = await api.patch(
        `/sites/${row.site_id}/trips/${row.trip_id}/lrs/${row.id}/followup`,
        {
          promised_date: changes.promised_date ?? row.promised_date ?? "",
          note: changes.note ?? row.followup_note ?? "",
          next_contact_date: changes.next_contact_date ?? row.next_contact_date ?? "",
          outcome: changes.outcome ?? row.followup_outcome ?? "",
        },
      );
      setData((current) => ({
        ...current,
        rows: current.rows.map((item) => item.id === row.id
        ? {
          ...item, promised_date: response.data.promised_date, followup_note: response.data.note,
          next_contact_date: response.data.next_contact_date,
          followup_outcome: response.data.outcome,
        }
        : item),
      }));
      setDrafts((current) => ({ ...current, [row.id]: {} }));
      setSaveStatus((current) => ({ ...current, [row.id]: "Saved" }));
    } catch (requestError) {
      setSaveStatus((current) => ({ ...current, [row.id]: `Failed: ${errMsg(requestError)}` }));
    }
  };
  const settleReceipt = async (row) => {
    setSettlementStatus((current) => ({ ...current, [row.id]: "Recording payment…" }));
    try {
      await api.post(`/sites/${row.site_id}/trips/${row.trip_id}/lrs/${row.id}/settlement`, {
        received: true, idempotency_key: requestKey(),
      });
      setSettlementStatus((current) => ({ ...current, [row.id]: "Payment recorded" }));
      try {
        const response = await api.get(`/sites/${siteId}/booking-finance`);
        setData(response.data);
      } catch (refreshError) {
        setSettlementStatus((current) => ({
          ...current, [row.id]: `Payment recorded; refresh to reload totals: ${errMsg(refreshError)}`,
        }));
      }
    } catch (requestError) {
      setSettlementStatus((current) => ({ ...current, [row.id]: `Failed: ${errMsg(requestError)}` }));
    }
  };
  const exportCurrentSite = () => {
    if (!data || !loadedForSite) return;
    const summary = [
      { metric: "Site", value: csvSafeText(data.site?.name || "") },
      { metric: "Receipts", value: totals.receipt_count || 0 },
      { metric: "Total charges (Bhada + Hamali + fees)", value: totals.grand_total || 0 },
      { metric: "Collected (posted payments)", value: totals.collected_bhada || 0 },
      { metric: "Outstanding (Bhada + receipt fees)", value: totals.outstanding_bhada || 0 },
      { metric: "Collectible now (reconciled receipts only)", value: totals.collectible_outstanding_bhada || 0 },
      { metric: "Pending order checks (excluded from collectible now)", value: totals.pending_orders || 0 },
    ];
    exportCSV(`booking-finance-${data.site?.code || siteId}-summary`,
      [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }], summary);
  };
  const exportFilteredReceipts = () => {
    const columns = [
      ["lr_ref", "LR"], ["receipt_date", "Receipt date"], ["trip_ref", "Trip"],
      ["sender_name", "Sender"], ["receiver_name", "Receiver"], ["goods", "Goods"],
      ["rent", "Bhada"], ["hamali", "Hamali"], ["receipt_fee", "Receipt fee"],
      ["total", "Total charges"], ["paid", "Collected"], ["outstanding", "Outstanding"],
      ["reconciled", "Order reconciled"], ["promised_date", "Promised date"],
      ["next_contact_date", "Next contact date"], ["followup_outcome", "Follow-up outcome"],
      ["followup_note", "Follow-up note"],
    ];
    exportCSV(`booking-finance-${data?.site?.code || siteId}-receipts`,
      columns.map(([key, label]) => ({ key, label })),
      rows.map((row) => Object.fromEntries(columns.map(([key]) => [key, csvSafeText(
        key === "reconciled" ? (row[key] ? "Yes" : "No") : row[key],
      )]))));
  };

  if (user?.role !== "owner") return <Card className="p-6">Booking Finance is available to the business owner only.</Card>;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div><p className="text-sm font-semibold text-brand-700">BOOKING</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Booking Finance</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">A clear view of charges, collections and what still needs attention for this site.</p></div>
        <label className="w-full sm:max-w-xs"><span className="lbl">Site / garage</span>
          <select className={field} value={siteId} disabled={sites.length < 2}
            aria-label="Site / garage"
            onChange={(event) => { setSiteId(event.target.value); setRowPage(0); }}>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
      </header>
      {error && <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
        <span>{error}</span><button type="button" className="btn-s self-start" onClick={() => setReloadVersion((value) => value + 1)}>Try again</button>
      </div>}
      {busy && !loadedForSite ? <Loader label="Loading booking finance…" /> : null}
      {!busy && !loadedForSite && !error && <Card className="p-6">
        <EmptyState title={sites.length ? "No finance data yet" : "No booking sites available"}
          text={sites.length ? "Create receipts at this site to see charges and collections here." : "A booking site must be assigned before finance data can appear."} />
      </Card>}
      {loadedForSite && <>
        <Card role="region" aria-label="Owner action queue" className="border border-amber-300 bg-amber-50/70 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-extrabold">Next actions</h2>
              <p className="text-sm text-muted">
                Review overdue promises or add missing Bhada. Nothing is changed until you save an action.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-sm font-bold">
              {queueItems.length} shown
            </span>
          </div>
          {queueItems.length ? <ol className="grid gap-2 sm:grid-cols-2">
            {queueItems.map(({ row, kind }) => <li key={`${kind}:${row.id}`}
              className="flex min-w-0 flex-col justify-between gap-2 rounded-lg border border-line bg-white p-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <strong className="block truncate">{row.lr_ref} · {row.receiver_name || "Receiver missing"}</strong>
                <span className="block text-xs text-muted">
                  {kind === "overdue-promise"
                    ? `Promised ${dmy(row.promised_date)} · ${money(row.outstanding)} due`
                    : `${row.trip_ref || "Trip"} · Bhada not entered`}
                </span>
              </div>
              {kind === "overdue-promise"
                ? <button type="button" className="btn-s min-h-10 shrink-0"
                  onClick={() => openQueueFollowup(row)}>Review follow-up</button>
                : <button type="button" className="btn-s min-h-10 shrink-0"
                  onClick={() => openUnpricedReceipt(row)}>Open receipt to price</button>}
            </li>)}
          </ol> : <p className="rounded-lg bg-white p-3 text-sm font-medium text-muted">
            No overdue promises or unpriced receipts need review.
          </p>}
        </Card>
        <section aria-label="Finance overview" className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.8fr)]">
          <Card className="relative overflow-hidden border-brand-200 bg-gradient-to-br from-white via-white to-brand-50 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-muted">Outstanding to collect</p>
                <p className="num mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                  {money(totals.outstanding_bhada)}
                </p>
                <p className="mt-2 text-sm text-muted">Bhada + receipt fees · {totals.unpaid_receipts || 0} receipts unpaid</p>
                <p className="mt-1 text-xs text-muted">Outstanding includes all priced receipts; collectible now includes reconciled receipts only.</p>
              </div>
              <span className="rounded-full bg-brand-100 px-3 py-1.5 text-sm font-bold text-brand-800">
                {collectionRate.toFixed(0)}% collected
              </span>
            </div>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-amber-100" role="img"
              aria-label={`${collectionRate.toFixed(0)} percent of priced Bhada and receipt fees collected`}>
              <div className="h-full rounded-full bg-brand-600 transition-[width]"
                style={{ width: `${collectionRate}%` }} />
            </div>
            <div className="mt-2 flex justify-between gap-3 text-xs text-muted">
              <span>Collected {money(totals.collected_bhada)}</span>
              <span>Collectible now {money(totals.collectible_outstanding_bhada)}</span>
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Total charges</p>
              <p className="num mt-2 text-xl font-bold">{money(totals.grand_total)}</p>
              <p className="mt-1 text-xs text-muted">Bhada + Hamali + fees</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Receipts</p>
              <p className="num mt-2 text-xl font-bold">{totals.receipt_count || 0}</p>
              <p className="mt-1 text-xs text-muted">{totals.unpaid_receipts || 0} still unpaid</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Order checks</p>
              <p className="num mt-2 text-xl font-bold">{pendingOrderCount}</p>
              <p className="mt-1 text-xs text-muted">Awaiting reconciliation</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Unpriced</p>
              <p className="num mt-2 text-xl font-bold">{unpricedCount}</p>
              <p className="mt-1 text-xs text-muted">Need Bhada entered</p>
            </Card>
          </div>
        </section>
        <p className="text-xs leading-relaxed text-muted">{data.basis}</p>
        <div className="grid gap-3 rounded-xl border border-line bg-white p-4 text-xs text-muted sm:grid-cols-3">
          <p><strong className="text-ink">Collected:</strong> payments posted against Bhada and receipt fees.</p>
          <p><strong className="text-ink">Outstanding:</strong> unpaid Bhada and receipt fees, including receipts awaiting order checks.</p>
          <p><strong className="text-ink">Collectible now:</strong> outstanding on reconciled receipts only; pending order checks are not confirmed receivables.</p>
        </div>

        <section className="grid gap-4 xl:grid-cols-3" aria-label="Finance charts">
          <Card className="min-w-0 p-4 sm:p-5">
            <div className="mb-2"><h2 className="text-base font-bold">Charge composition</h2>
              <p className="text-xs text-muted">Where recorded receipt charges come from</p></div>
            {chargeBreakdown.length ? <div role="img" aria-label="Donut chart of Bhada, Hamali, and receipt fee totals">
              <div className="h-44 sm:h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chargeBreakdown} dataKey="value" nameKey="name" innerRadius={58}
                    outerRadius={82} paddingAngle={3} stroke="none">
                    {chargeBreakdown.map((entry, index) =>
                      <Cell key={entry.name} fill={CHARGE_COLORS[index % CHARGE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => money(value)} />
                  <Legend verticalAlign="bottom" height={32} />
                </PieChart>
              </ResponsiveContainer>
              </div>
              <p className="text-center text-sm font-semibold">Total {money(totals.grand_total)}</p>
            </div> : <EmptyState title="No charges to chart" text="Recorded charges will appear here." />}
          </Card>
          <Card className="min-w-0 p-4 sm:p-5">
            <div className="mb-2"><h2 className="text-base font-bold">Outstanding by age</h2>
              <p className="text-xs text-muted">Prioritize older amounts first · Bhada + receipt fees</p></div>
            {agingBreakdown.some((bucket) => bucket.amount > 0) ? <div role="img"
              aria-label="Bar chart of outstanding amounts grouped by receipt age">
              <div className="h-44 sm:h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingBreakdown} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke="var(--line)" horizontal={false} />
                  <XAxis type="number" tickFormatter={rupeeTick} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value, _name, item) =>
                    [`${money(value)} · ${item.payload.receipts} receipts`, "Outstanding"]} />
                  <Bar dataKey="amount" name="Outstanding" fill="#0b5c4e" radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div> : <EmptyState title="All caught up" text="There are no outstanding amounts to age." />}
          </Card>
          <Card className="min-w-0 p-4 sm:p-5">
            <div className="mb-2"><h2 className="text-base font-bold">Largest receiver balances</h2>
              <p className="text-xs text-muted">Top unpaid receiver accounts · paid vs due</p></div>
            {receiverChart.length ? <div role="img" aria-label="Stacked bar chart of paid and outstanding amounts for the top six receivers">
              <div className="h-44 sm:h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={receiverChart} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke="var(--line)" horizontal={false} />
                  <XAxis type="number" tickFormatter={rupeeTick} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={86} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(value) => money(value)} />
                  <Legend verticalAlign="bottom" height={30} />
                  <Bar dataKey="collected" name="Collected" stackId="balance" fill="#65a99a" />
                  <Bar dataKey="outstanding" name="Outstanding" stackId="balance" fill="#e0a33e"
                    radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div> : <EmptyState title="No receiver balances yet" text="Receiver balances appear after receipts are recorded." />}
          </Card>
        </section>

        <section aria-label="Finance attention items" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className={`flex items-start gap-3 p-4 ${unpromisedDueCount ? "border-amber-200 bg-amber-50/60" : ""}`}>
            <Clock3 size={19} className={unpromisedDueCount ? "text-amber-700" : "text-brand-700"} />
            <div><p className="text-sm font-semibold">Follow-up needed</p>
              <p className="mt-1 text-xs text-muted">{unpromisedDueCount} unpaid receipt(s) have no saved follow-up.</p>
              <a href="#finance-follow-up-list" onClick={() => { setRowFilter("unfollowed"); setRowPage(0); }}
                className="mt-2 inline-block text-xs font-semibold text-brand-700 underline">Review receipts</a></div>
          </Card>
          <Card className={`flex items-start gap-3 p-4 ${pendingOrderCount ? "border-amber-200 bg-amber-50/60" : ""}`}>
            {pendingOrderCount ? <AlertTriangle size={19} className="text-amber-700" />
              : <CheckCircle2 size={19} className="text-brand-700" />}
            <div><p className="text-sm font-semibold">Order reconciliation</p>
              <p className="mt-1 text-xs text-muted">{pendingOrderCount} receipt(s) need their order details checked.</p>
              <a href="#finance-follow-up-list" onClick={() => { setRowFilter("order-check"); setRowPage(0); }}
                className="mt-2 inline-block text-xs font-semibold text-brand-700 underline">Review receipts</a></div>
          </Card>
          <Card className={`flex items-start gap-3 p-4 ${unpricedCount ? "border-amber-200 bg-amber-50/60" : ""}`}>
            <AlertTriangle size={19} className={unpricedCount ? "text-amber-700" : "text-brand-700"} />
            <div><p className="text-sm font-semibold">Bhada pricing</p>
              <p className="mt-1 text-xs text-muted">{unpricedCount} receipt(s) are missing a Bhada price.</p>
              <a href="#finance-follow-up-list" onClick={() => { setRowFilter("unpriced"); setRowPage(0); }}
                className="mt-2 inline-block text-xs font-semibold text-brand-700 underline">Review receipts</a></div>
          </Card>
          <Card className={`flex items-start gap-3 p-4 ${overduePaymentCount || overduePromiseCount ? "border-red-200 bg-red-50/60" : ""}`}>
            <AlertTriangle size={19} className={overduePaymentCount || overduePromiseCount ? "text-red-700" : "text-brand-700"} />
            <div><p className="text-sm font-semibold">Overdue payments</p>
              <p className="mt-1 text-xs text-muted">
                {overduePaymentCount} unpaid receipt(s) are {overdueAfterDays}+ days old;
                {" "}{overduePromiseCount} have passed their promised date.
              </p>
              <button type="button" onClick={() => { setRowFilter("overdue"); setRowPage(0); }}
                className="mt-2 text-xs font-semibold text-brand-700 underline">Review overdue receipts</button></div>
          </Card>
        </section>
        <section id="finance-follow-up-list" className="space-y-4 scroll-mt-24">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="text-xl font-bold">Receipts and follow-up</h2>
              <p className="text-sm text-muted">Prioritized by amount due and age · {rows.length
                ? `${rowPage * PAGE_SIZE + 1}–${Math.min((rowPage + 1) * PAGE_SIZE, rows.length)} of ${rows.length}`
                : "0"} receipts shown.</p></div>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3 sm:flex-row sm:items-end sm:p-4">
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(14rem,1fr)_12rem]">
            <label><span className="lbl">Search receipts</span>
              <span className="relative block"><Search size={16} aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input className={`${field} pl-9`} value={search}
                  onChange={(event) => { setSearch(event.target.value); setRowPage(0); }}
                  placeholder="LR, receiver, sender or goods" /></span></label>
            <label><span className="lbl">Show</span>
              <select className={field} value={rowFilter} aria-label="Filter finance receipts"
                onChange={(event) => { setRowFilter(event.target.value); setRowPage(0); }}>
                <option value="all">All receipts</option>
                <option value="outstanding">Outstanding only</option>
                <option value="overdue-promise">Overdue promised date</option>
                <option value="overdue">Overdue by age or promise</option>
                <option value="unfollowed">Needs follow-up</option>
                <option value="unpriced">Bhada not entered</option>
                <option value="order-check">Order check pending</option>
                <option value="promised">Has follow-up note/date</option>
              </select></label>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
              <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-muted sm:hidden">Exports</span>
              <button type="button" className="btn-s text-xs" onClick={exportCurrentSite}>Site summary CSV</button>
              <button type="button" className="btn-s text-xs" onClick={exportFilteredReceipts}>
                Filtered receipts CSV ({rows.length})
              </button>
            </div>
          </div>
        </section>
        {(overduePaymentCount > 0 || overduePromiseCount > 0) && <p role="status" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {overduePaymentCount} unpaid receipt(s) meet the {overdueAfterDays}-day overdue setting;
          {" "}{overduePromiseCount} are past their promised payment date.
          <button type="button" className="ml-2 underline" onClick={() => { setRowFilter("overdue"); setRowPage(0); }}>
            Review overdue
          </button>
        </p>}
        <div className="grid gap-3 xl:grid-cols-2">
          {pageRows.map((row) => <Card key={row.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><strong>{row.lr_ref}</strong>
              {amount(row.outstanding) > 0 && amount(row.age_days) >= overdueAfterDays
                && <span className="mt-1 block w-fit rounded bg-red-100 px-2 py-1 text-xs font-bold text-red-800">Payment overdue</span>}
              {amount(row.outstanding) > 0 && row.promised_date && row.promised_date < currentDate
                && <span className="mt-1 block w-fit rounded bg-red-100 px-2 py-1 text-xs font-bold text-red-800">Promise overdue</span>}
                <p className="mt-1 truncate text-sm font-medium">{row.receiver_name || "Receiver missing"}</p>
                <p className="text-xs text-muted">{row.trip_ref} · {dmy(row.receipt_date)}</p>
              </div>
              <div className="shrink-0 text-right">
                <strong className="block text-lg">{money(row.outstanding)}</strong>
                <span className="block text-xs text-muted">amount due</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-1 font-semibold ${row.payment_status === "paid"
                ? "bg-brand-50 text-brand-800" : "bg-amber-50 text-amber-800"}`}>
                {row.payment_status || "Unpaid"}
              </span>
              {!row.reconciled && <span className="rounded-full border border-amber-300 px-2 py-1 font-medium text-amber-800">
                Order check pending
              </span>}
              <span className="text-muted">{row.age_days} days old</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <div className="min-w-0 text-xs text-muted">
                {row.next_contact_date || row.followup_outcome
                  ? <><span className="font-medium text-ink">Follow-up:</span>
                    {row.next_contact_date && <span> Next contact {dmy(row.next_contact_date)}</span>}
                    {row.followup_outcome && <span> · {row.followup_outcome}</span>}</>
                  : <span>No follow-up saved</span>}
              </div>
              <button type="button" className="btn-s shrink-0"
                aria-expanded={Boolean(followupOpen[row.id])}
                onClick={() => setFollowupOpen((current) => ({ ...current, [row.id]: !current[row.id] }))}>
                {followupOpen[row.id] ? "Close follow-up" : "Update follow-up"}
              </button>
            </div>
            {followupOpen[row.id] && <div className="grid gap-3 rounded-lg bg-canvas p-3 sm:grid-cols-2">
              <label><span className="lbl">Promised payment date</span>
                <input className={field} type="date" aria-label={`${row.lr_ref} promised date`}
                  value={drafts[row.id]?.promised_date ?? row.promised_date ?? ""}
                  onChange={(event) => updateDraft(row, "promised_date", event.target.value)} /></label>
              <label><span className="lbl">Next contact date</span>
                <input className={field} type="date" aria-label={`${row.lr_ref} next contact date`}
                  value={drafts[row.id]?.next_contact_date ?? row.next_contact_date ?? ""}
                  onChange={(event) => updateDraft(row, "next_contact_date", event.target.value)} /></label>
              <label><span className="lbl">Outcome</span>
                <input className={field} aria-label={`${row.lr_ref} follow-up outcome`}
                  placeholder="No answer, part payment…"
                  value={drafts[row.id]?.outcome ?? row.followup_outcome ?? ""}
                  onChange={(event) => updateDraft(row, "outcome", event.target.value)} /></label>
              <label><span className="lbl">Note</span>
                <input className={field} aria-label={`${row.lr_ref} follow-up note`}
                  placeholder="Asked for a few days?"
                  value={drafts[row.id]?.note ?? row.followup_note ?? ""}
                  onChange={(event) => updateDraft(row, "note", event.target.value)} /></label>
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <span className="text-xs text-muted">{saveStatus[row.id] || ""}</span>
                <button type="button" className="btn-p" onClick={() => saveFollowup(row)}>Save follow-up</button>
              </div>
            </div>}
            <details className="border-t border-line pt-2">
              <summary className="cursor-pointer text-xs font-semibold text-brand-700">Receipt details</summary>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <p>Goods <span className="block text-xs text-muted">{row.goods || "—"}</span></p>
                <p>Promised date <span className="block text-xs text-muted">{dmy(row.promised_date)}</span></p>
                <p>Bhada <span className="block text-xs text-muted">{money(row.rent)}</span></p>
                <p>Hamali <span className="block text-xs text-muted">{money(row.hamali)}</span></p>
                <p>Receipt fee <span className="block text-xs text-muted">{money(row.receipt_fee)}</span></p>
                <p>Total charges <span className="block text-xs text-muted">{money(row.total)}</span></p>
                <p>Collected <span className="block text-xs text-muted">{money(row.paid)}</span></p>
                {row.followup_note && <p className="col-span-2">Latest note
                  <span className="block text-xs text-muted">{row.followup_note}</span></p>}
              </div>
            </details>
            <button className="btn-p min-h-11 w-full"
              disabled={amount(row.outstanding) <= 0 || settlementStatus[row.id] === "Recording payment…"}
              onClick={() => settleReceipt(row)}>Settle full pending amount</button>
            <p className="text-xs text-muted">{settlementStatus[row.id] || ""}</p>
          </Card>)}
          {!rows.length && <Card className="p-8 text-center text-muted">No receipts match this search and filter.</Card>}
        </div>
        {pageCount > 1 && <nav aria-label="Finance receipt pages"
          className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-3">
          <span className="text-sm text-muted">Page {rowPage + 1} of {pageCount}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-s" disabled={rowPage === 0}
              onClick={() => setRowPage((page) => Math.max(page - 1, 0))}>Previous</button>
            <button type="button" className="btn-s" disabled={rowPage >= pageCount - 1}
              onClick={() => setRowPage((page) => Math.min(page + 1, pageCount - 1))}>Next</button>
          </div>
        </nav>}
      </>}
    </div>
  );
}
