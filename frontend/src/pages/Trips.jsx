import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download, FileText, Filter, Plus, Truck } from "lucide-react";
import { useFetch, useMaster, opts } from "../lib/hooks";
import { money, money0, dmy } from "../lib/format";
import { exportCSV, exportExcel, exportPDF } from "../lib/export";
import { hasAdminAccess } from "../lib/adminAccess";
import {
  Badge, Btn, Card, DataTable, EmptyState, ErrorState, Loader, PageHead, SearchBox, Select, Stat, Tabs,
} from "../components/ui";

const STATUS = ["New", "Assigned", "Started", "In Transit", "Delivered", "Completed", "Cancelled"];

export default function Trips({ user }) {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || "trips";
  const canTrips = hasAdminAccess(user, "industrial_trips");
  const canLrs = hasAdminAccess(user, "industrial_lrs");
  const canFinance = hasAdminAccess(user, "industrial_finance");
  const nav = useNavigate();
  const [showF, setShowF] = useState(false);
  const [f, setF] = useState({ q: "", status: sp.get("status") || "", vehicle_id: "", driver_id: "", route_id: "", mode: "", trip_type: "", frm: "", to: "" });
  const [lf, setLf] = useState({ q: "", payment_status: "", frm: "", to: "" });

  const vehicles = useMaster(tab === "trips" ? "vehicles" : null);
  const drivers = useMaster(tab === "trips" ? "drivers" : null);
  const settings = useFetch(tab === "trips" ? "/settings" : null);
  const trips = useFetch(tab === "trips" ? "/trips" : null, f);
  const lrs = useFetch(tab === "lrs" ? "/lrs" : null, lf);
  const lrStats = useFetch(tab === "lrs" ? "/lr-stats" : null, { days: 30 });

  const setTab = (v) => setSp({ tab: v });

  const tripCols = [
    { key: "trip_no", label: "Trip No", strong: true },
    { key: "start_date", label: "Date", type: "date" },
    { key: "mode", label: "Type", render: (r) => <span className="capitalize">{r.mode}</span> },
    { key: "from_name", label: "From" },
    { key: "to_name", label: "To" },
    { key: "vehicle_no", label: "Vehicle" },
    { key: "driver_name", label: "Driver" },
    ...(canFinance ? [{ key: "trip_amount", label: "Amount", type: "money", right: true },
      { key: "trip_cost", label: "Cost", type: "money", right: true },
      { key: "profit", label: "Profit", right: true,
      render: (r) => <span className={`num font-semibold ${r.profit < 0 ? "text-red-600" : "text-brand-600"}`}>{money(r.profit)}</span> },
    ] : []),
    ...(canLrs ? [{ key: "lr_count", label: "LR", right: true }] : []),
    { key: "status", label: "Status", type: "badge" },
  ];

  const lrCols = [
    { key: "lr_no", label: "LR No", strong: true },
    { key: "date", label: "Date", type: "date" },
    { key: "sender", label: "Sender", render: (r) => r.sender?.name || "—" },
    { key: "receiver", label: "Receiver", render: (r) => r.receiver?.name || "—" },
    { key: "from_name", label: "From" },
    { key: "to_name", label: "To" },
    { key: "vehicle_no", label: "Vehicle" },
    ...(canFinance ? [
      { key: "freight", label: "Freight", type: "money", right: true },
      { key: "outstanding", label: "Pending", type: "money", right: true },
      { key: "payment_status", label: "Status", type: "badge" },
    ] : []),
  ];

  const rows = tab === "trips" ? trips.data : lrs.data;
  const cur = tab === "trips" ? trips : lrs;

  const flat = (rs) => (rs || []).map((r) => ({
    ...r, sender: r.sender?.name, receiver: r.receiver?.name,
    start_date: dmy(r.start_date), date: dmy(r.date),
  }));

  return (
    <div>
      <PageHead title="Industrial Trips & LRs" subtitle="Industrial shipments and their lorry receipts"
        actions={
          <>
            <Btn variant="s" icon={Download} data-testid="export-btn"
              onClick={() => exportCSV(tab === "trips" ? "trips" : "lrs", tab === "trips" ? tripCols : lrCols, flat(rows))}>
              CSV
            </Btn>
            <Btn variant="s" icon={FileText} onClick={() => exportPDF(tab === "trips" ? "Trip Report" : "LR Report",
              tab === "trips" ? tripCols : lrCols, flat(rows), `${(rows || []).length} records`)}>PDF</Btn>
            {canLrs && <Btn icon={Plus} data-testid="new-lr-btn" variant="s" onClick={() => nav("/lrs/new")}>New LR</Btn>}
            {canTrips && <Btn icon={Truck} data-testid="new-trip-btn" onClick={() => nav("/trips/new")}>New Trip</Btn>}
          </>
        } />

      <Tabs value={tab} onChange={setTab}
        tabs={[
          ...(canTrips ? [{ value: "trips", label: "Trips" }] : []),
          ...(canLrs ? [{ value: "lrs", label: "Lorry Receipts" }] : []),
        ]} />

      {tab === "lrs" && canFinance && lrStats.data && <LRInsights s={lrStats.data} />}

      <Card className="mb-4 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          {tab === "trips" ? (
            <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder="Trip no, vehicle, driver, party…" />
          ) : (
            <SearchBox value={lf.q} onChange={(v) => setLf({ ...lf, q: v })} placeholder="LR no, sender, vehicle, goods…" />
          )}
          <Btn variant="s" icon={Filter} onClick={() => setShowF((s) => !s)} data-testid="filter-btn">Filters</Btn>
        </div>
        {showF && (
          <div className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-4">
            {tab === "trips" ? (
              <>
                <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={STATUS} placeholder="All status" data-testid="filter-status" />
                <Select label="Trip Kind" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}
                  options={[{ value: "indoor", label: "Indoor" }, { value: "outdoor", label: "Outdoor" }]} placeholder="All" />
                <Select label="One Way / Round" value={f.trip_type} onChange={(e) => setF({ ...f, trip_type: e.target.value })}
                  options={["One Way", "Round Trip"]} placeholder="All" />
                <Select label="Route" value={f.route_id} onChange={(e) => setF({ ...f, route_id: e.target.value })}
                  options={(settings.data?.routes || []).map((r) => ({ value: r.id, label: r.name }))} placeholder="All routes" />
                <Select label="Vehicle" value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })}
                  options={opts(vehicles.data, "vehicle_no")} placeholder="All vehicles" />
                <Select label="Driver" value={f.driver_id} onChange={(e) => setF({ ...f, driver_id: e.target.value })}
                  options={opts(drivers.data)} placeholder="All drivers" />
                <label className="block"><span className="lbl">From Date</span>
                  <input type="date" className="fld" value={f.frm} onChange={(e) => setF({ ...f, frm: e.target.value })} /></label>
                <label className="block"><span className="lbl">To Date</span>
                  <input type="date" className="fld" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
              </>
            ) : (
              <>
                <Select label="Payment" value={lf.payment_status} onChange={(e) => setLf({ ...lf, payment_status: e.target.value })}
                  options={["Pending", "Partial", "Paid"]} placeholder="All" />
                <label className="block"><span className="lbl">From Date</span>
                  <input type="date" className="fld" value={lf.frm} onChange={(e) => setLf({ ...lf, frm: e.target.value })} /></label>
                <label className="block"><span className="lbl">To Date</span>
                  <input type="date" className="fld" value={lf.to} onChange={(e) => setLf({ ...lf, to: e.target.value })} /></label>
              </>
            )}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        {cur.loading && !rows ? <Loader /> : cur.error ? <ErrorState text={cur.error} onRetry={cur.reload} /> : (
          <DataTable
            testid={tab === "trips" ? "trips-table" : "lrs-table"}
            columns={tab === "trips" ? tripCols : lrCols} rows={rows || []}
            onRowClick={(r) => nav(tab === "trips" ? `/trips/${r.id}` : `/lrs/${r.id}`)}
            empty={<EmptyState title={tab === "trips" ? "No trips found" : "No LR found"}
              text={tab === "trips" ? "Create your first trip — it takes a few seconds." : "LRs are usually created from a trip."}
              action={<Btn onClick={() => nav(tab === "trips" ? "/trips/new" : "/lrs/new")}>
                {tab === "trips" ? "Create Trip" : "Create LR"}</Btn>} />}
            mobile={tab === "trips" ? (r) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-head font-bold">{r.trip_no}</span>
                  <Badge>{r.status}</Badge>
                </div>
                <p className="mt-1.5 text-[14px] font-medium">{r.from_name} → {r.to_name}</p>
                <p className="mt-1 text-[13px] text-muted">{dmy(r.start_date)} · {r.vehicle_no} · {r.driver_name || "No driver"}</p>
                <div className="mt-1.5 flex items-center gap-3 text-[13px]">
                  <span className="num font-semibold">{money(r.trip_amount)}</span>
                  <span className="text-muted capitalize">{r.mode}</span>
                  {r.lr_count > 0 && <span className="text-brand-600">{r.lr_count} LR</span>}
                </div>
              </div>
            ) : (r) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-head font-bold">{r.lr_no}</span>
                  <Badge>{r.payment_status}</Badge>
                </div>
                <p className="mt-1.5 text-[14px] font-medium">{r.sender?.name} → {r.receiver?.name || "—"}</p>
                <p className="mt-1 text-[13px] text-muted">{dmy(r.date)} · {r.from_name} → {r.to_name} · {r.vehicle_no}</p>
                <p className="mt-1.5 text-[13px]"><span className="num font-semibold">{money(r.freight)}</span>
                  {r.outstanding > 0 && <span className="text-amber-600"> · {money(r.outstanding)} pending</span>}</p>
              </div>
            )} />
        )}
      </Card>
      <div className="mt-3 flex justify-end">
        <Btn variant="s" onClick={() => exportExcel(tab, tab === "trips" ? tripCols : lrCols, flat(rows))}>Export Excel</Btn>
      </div>
    </div>
  );
}

const PIE = ["#E0A33E", "#2C8474", "#0B5C4E", "#C1424E"];

const LRInsights = ({ s }) => (
  <div className="mb-4" data-testid="lr-insights">
    <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat testid="lr-stat-total" label="LRs (30 days)" value={s.total} icon={FileText} />
      <Stat testid="lr-stat-freight" label="Freight Billed" value={money0(s.freight)} icon={FileText} tone="text-brand-600" />
      <Stat testid="lr-stat-received" label="Received" value={money0(s.received)} icon={FileText} />
      <Stat testid="lr-stat-pending" label="Pending" value={money0(s.outstanding)} icon={FileText} tone="text-amber-600" />
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-4 lg:col-span-2">
        <h3 className="mb-3 font-head text-[15.5px] font-bold">LRs Created — last 30 days</h3>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={s.trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EB" vertical={false} />
            <XAxis dataKey="date" fontSize={10} stroke="#69747F" interval={4} />
            <YAxis fontSize={11} stroke="#69747F" allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="lrs" name="LRs" fill="#0B5C4E" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card className="p-4">
        <h3 className="mb-3 font-head text-[15.5px] font-bold">Payment Status</h3>
        {s.status.length ? (
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie data={s.status} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2}>
                {s.status.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
              </Pie>
              <Tooltip />
              <Legend iconSize={9} />
            </PieChart>
          </ResponsiveContainer>
        ) : <p className="text-[13px] text-muted">No LRs in this period.</p>}
      </Card>
      <Card className="p-4 lg:col-span-3">
        <h3 className="mb-3 font-head text-[15.5px] font-bold">Top Senders by Freight</h3>
        {s.top_senders.length ? (
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={s.top_senders} layout="vertical" margin={{ left: 10, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EB" horizontal={false} />
              <XAxis type="number" fontSize={11} stroke="#69747F" />
              <YAxis type="category" dataKey="name" width={130} fontSize={11} stroke="#69747F" />
              <Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="freight" name="Freight" fill="#2C8474" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="text-[13px] text-muted">No sender data yet.</p>}
      </Card>
    </div>
  </div>
);
