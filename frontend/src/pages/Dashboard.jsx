import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, Banknote, CalendarClock, Fuel, IdCard, Receipt, Truck, Users,
  Wallet, ArrowUpRight, ArrowDownRight, HandCoins, FileText,
} from "lucide-react";
import { useFetch } from "../lib/hooks";
import { money, money0, dmy } from "../lib/format";
import { hasAdminAccess } from "../lib/adminAccess";
import { Badge, Btn, Card, DataTable, EmptyState, ErrorState, Loader, PageHead, Stat } from "../components/ui";

export default function Dashboard({ user }) {
  const { data: d, loading, error, reload } = useFetch("/dashboard");
  const mon = useFetch("/dashboard/monthly", { months: 6 });
  const nav = useNavigate();

  if (loading && !d) return <Loader label="Loading your business…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const m = d.money || {}, a = d.alerts, c = d.collections;
  const canTrips = hasAdminAccess(user, "industrial_trips");
  const canLrs = hasAdminAccess(user, "industrial_lrs");
  const canVehicles = hasAdminAccess(user, "industrial_vehicles");
  const canTeam = hasAdminAccess(user, "industrial_team");
  const canFinance = hasAdminAccess(user, "industrial_finance");
  const alerts = [
    ...(canFinance ? [
      { n: a.pending_payments, label: "Pending Payments", to: "/finance?tab=receivables", icon: Receipt, bad: false },
      { n: a.overdue, label: "Overdue Payments", to: "/finance?tab=receivables", icon: AlertTriangle, bad: true },
      { n: money0(a.driver_advances), label: "Driver Advances Outstanding", to: "/team", icon: HandCoins, bad: false },
      { n: money0(a.employee_advances), label: "Team Advances Outstanding", to: "/team?tab=team", icon: HandCoins, bad: false },
    ] : []),
    ...(canVehicles ? [{ n: a.vehicle_docs, label: "Vehicle Documents Expiring", to: "/vehicles?tab=documents", icon: FileText, bad: true }] : []),
    ...(canTeam ? [{ n: a.driver_licence, label: "Driver Licence Expiring", to: "/team", icon: IdCard, bad: true }] : []),
  ];

  return (
    <div>
      <PageHead title="Business Dashboard"
        subtitle={`Today · ${dmy(new Date().toISOString())} — everything below is calculated from your entries`} />

      {(canTrips || canVehicles) && <Section title="Trips today">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {canTrips && <><Stat testid="stat-trips-today" label="Today's Trips" value={d.trips.today} icon={CalendarClock} onClick={() => nav("/trips")} />
            <Stat testid="stat-active-trips" label="Active Trips" value={d.trips.active} icon={Truck} onClick={() => nav("/trips?status=In Transit")} />
            <Stat testid="stat-completed" label="Completed Today" value={d.trips.completed_today} icon={Truck} onClick={() => nav("/trips?status=Completed")} /></>}
          {canVehicles && <><Stat testid="stat-veh-available" label="Available Vehicles" value={d.vehicles.available} icon={Truck} onClick={() => nav("/vehicles")} />
            <Stat testid="stat-veh-ontrip" label="Vehicles on Trip" value={d.vehicles.on_trip} icon={Truck} onClick={() => nav("/vehicles")} /></>}
        </div>
      </Section>}

      {canFinance && <Section title="Money">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat testid="stat-to-receive" label="Money to Receive" value={money0(m.to_receive)} icon={ArrowDownRight}
            tone="text-brand-600" onClick={() => nav("/finance?tab=receivables")} sub="Tap to see parties" />
          <Stat testid="stat-received-today" label="Received Today" value={money0(m.received_today)} icon={Banknote}
            onClick={() => nav("/finance?tab=collections")} />
          <Stat testid="stat-to-pay" label="Money to Pay" value={money0(m.to_pay)} icon={ArrowUpRight}
            tone="text-red-600" onClick={() => nav("/finance?tab=payables")} />
          <Stat testid="stat-paid-today" label="Paid Today" value={money0(m.paid_today)} icon={Wallet}
            onClick={() => nav("/finance?tab=payments")} />
          <Stat testid="stat-expenses-today" label="Today's Expenses" value={money0(m.expenses_today)} icon={Receipt}
            onClick={() => nav("/finance?tab=expenses")} />
        </div>
      </Section>}

      {canFinance && <Section title="Collections & cash">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat testid="stat-collection-today" label="Today's Collection" value={money0(c.today)} icon={Banknote}
            onClick={() => nav("/finance?tab=collections")} />
          <Stat label="Deewanji Collection" value={money0(c.deewanji_today)} icon={Users}
            onClick={() => nav("/finance?tab=deewanji")} />
          <Stat testid="stat-deewanji-cash" label="Cash With Deewanji" value={money0(c.cash_with_deewanji)} icon={HandCoins}
            tone="text-amber-600" onClick={() => nav("/finance?tab=deewanji")} />
          <Stat label="Cash in Hand" value={money0(m.cash)} icon={Wallet} tone={m.cash < 0 ? "text-red-600" : ""} onClick={() => nav("/finance?tab=cash")} />
          <Stat label="Bank Balance" value={money0(m.bank)} icon={Wallet} tone={m.bank < 0 ? "text-red-600" : ""} onClick={() => nav("/finance?tab=cash")} />
        </div>
      </Section>}

      {(canTeam || canLrs || canFinance) && <Section title="People & LR">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {canTeam && <><Stat label="Total Drivers" value={d.people.drivers} icon={Users} onClick={() => nav("/team")} />
            <Stat label="Team Members" value={d.people.team} icon={Users} onClick={() => nav("/team?tab=team")} /></>}
          {canLrs && <><Stat label="Total LRs" value={d.total_lrs} icon={FileText} onClick={() => nav("/trips?tab=lrs")} />
            <Stat label="Unpaid LRs" value={d.pending_lrs} icon={FileText} onClick={() => nav("/trips?tab=lrs")} /></>}
          {canFinance && <Stat label="Diesel Today" value={money0(m.fuel_today)} icon={Fuel} onClick={() => nav("/finance?tab=fuel")} />}
        </div>
      </Section>}

      {alerts.length > 0 && <Section title="Needs your attention">
        <div className="grid gap-3 md:grid-cols-3">
          {alerts.map((al) => (
            <button key={al.label} onClick={() => nav(al.to)} data-testid={`alert-${al.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              className="card flex items-center gap-3 p-4 text-left transition-transform hover:-translate-y-0.5 hover:border-brand-400">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${al.bad ? "bg-red-50 text-red-600" : "bg-brand-50 text-brand-600"}`}>
                <al.icon size={18} />
              </span>
              <div className="min-w-0">
                <p className="num font-head text-[18px] font-bold leading-none">{al.n}</p>
                <p className="mt-1 truncate text-[12.5px] text-muted">{al.label}</p>
              </div>
            </button>
          ))}
        </div>
      </Section>}

      {mon.data && (canFinance || canTrips || canLrs) && <MonthlyCharts m={mon.data} nav={nav}
        canFinance={canFinance} canTrips={canTrips} canLrs={canLrs} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {canTrips && <Panel title="Today's Trips" action={() => nav("/trips")}>
          <DataTable testid="dash-trips"
            columns={[
              { key: "trip_no", label: "Trip", strong: true },
              { key: "route", label: "Route", render: (r) => `${r.from_name} → ${r.to_name}` },
              { key: "vehicle_no", label: "Vehicle" },
              { key: "driver_name", label: "Driver" },
              ...(canFinance ? [{ key: "trip_amount", label: "Amount", type: "money", right: true }] : []),
              { key: "status", label: "Status", type: "badge" },
            ]}
            rows={d.lists.trips_today} onRowClick={(r) => nav(`/trips/${r.id}`)}
            empty={<EmptyState title="No trips today" text="Create a trip to get started." />}
            mobile={(r) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.trip_no}</span><Badge>{r.status}</Badge>
                </div>
                <p className="mt-1 text-[13.5px] text-muted">{r.from_name} → {r.to_name}</p>
                <p className="mt-1 text-[13px] text-muted">{r.vehicle_no} · {r.driver_name || "No driver"}
                  {canFinance && <> · <span className="num">{money(r.trip_amount)}</span></>}</p>
              </div>
            )} />
        </Panel>}

        {canFinance && <Panel title="Pending Receivables" action={() => nav("/finance?tab=receivables")}>
          <DataTable testid="dash-receivables"
            columns={[
              { key: "party", label: "Party", strong: true },
              { key: "mobile", label: "Mobile" },
              { key: "outstanding", label: "Outstanding", type: "money", right: true },
              { key: "status", label: "Status", type: "badge" },
            ]}
            rows={d.lists.pending_receivables} onRowClick={(r) => nav(`/parties/${r.party_id}`)}
            empty={<EmptyState title="Nothing pending" text="All party payments are settled." />}
            mobile={(r) => (
              <div className="flex items-center justify-between gap-3">
                <div><p className="font-semibold">{r.party}</p><p className="text-[12.5px] text-muted">{r.mobile || "—"}</p></div>
                <div className="text-right"><p className="num font-semibold">{money(r.outstanding)}</p><Badge>{r.status}</Badge></div>
              </div>
            )} />
        </Panel>}

        {canFinance && <Panel title="Recent Collections" action={() => nav("/finance?tab=collections")}>
          <DataTable testid="dash-collections"
            columns={[
              { key: "date", label: "Date", type: "date" },
              { key: "party_name", label: "Party", strong: true },
              { key: "mode", label: "Mode" },
              { key: "amount", label: "Amount", type: "money", right: true },
            ]}
            rows={d.lists.recent_collections}
            empty={<EmptyState title="No collections yet" text="Record a collection from Quick Actions." />} />
        </Panel>}

        {canFinance && <Panel title="Recent Expenses & Payments" action={() => nav("/finance?tab=expenses")}>
          <DataTable testid="dash-expenses"
            columns={[
              { key: "date", label: "Date", type: "date" },
              { key: "label", label: "Detail", strong: true, render: (r) => r.category || `Paid to ${r.entity_name || "-"}` },
              { key: "mode", label: "Mode" },
              { key: "amount", label: "Amount", type: "money", right: true },
            ]}
            rows={[...d.lists.recent_expenses, ...d.lists.recent_payments].slice(0, 8)}
            empty={<EmptyState title="No expenses yet" text="Record an expense from Quick Actions." />} />
        </Panel>}
      </div>
    </div>
  );
}

const Section = ({ title, children }) => (
  <div className="mb-6">
    <p className="mb-2.5 text-[12px] font-bold uppercase tracking-wider text-muted">{title}</p>
    {children}
  </div>
);

const kfmt = (v) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(1)}L`
  : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`);

const MonthlyCharts = ({ m, nav, canFinance, canTrips, canLrs }) => {
  const t = m.totals;
  return (
    <Section title="Monthly business overview — last 6 months">
      {canFinance && <>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat testid="stat-rev-6m" label="Revenue (6 months)" value={money0(t.revenue)} icon={ArrowDownRight}
          tone="text-brand-600" onClick={() => nav("/reports")} />
        <Stat testid="stat-exp-6m" label="Expenses (6 months)" value={money0(t.expenses)} icon={ArrowUpRight}
          tone="text-red-600" onClick={() => nav("/finance?tab=expenses")} />
        <Stat testid="stat-coll-6m" label="Collected (6 months)" value={money0(t.collections)} icon={Banknote}
          onClick={() => nav("/finance?tab=collections")} />
        <Stat testid="stat-profit-6m" label="Net (Revenue − Expenses)" value={money0(t.profit)} icon={Wallet}
          tone={t.profit < 0 ? "text-red-600" : "text-brand-600"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue vs Expenses" sub="Month by month" testid="chart-rev-exp">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={m.series} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EB" vertical={false} />
              <XAxis dataKey="month" fontSize={11} stroke="#69747F" />
              <YAxis fontSize={11} stroke="#69747F" tickFormatter={kfmt} />
              <Tooltip formatter={(v) => money(v)} />
              <Legend iconSize={9} />
              <Bar dataKey="revenue" name="Revenue" fill="#0B5C4E" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#E0A33E" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Collections Trend" sub="Money actually received each month" testid="chart-collections">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={m.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EB" vertical={false} />
              <XAxis dataKey="month" fontSize={11} stroke="#69747F" />
              <YAxis fontSize={11} stroke="#69747F" tickFormatter={kfmt} />
              <Tooltip formatter={(v) => money(v)} />
              <Line type="monotone" dataKey="collections" name="Collected" stroke="#0B5C4E" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top Parties by Outstanding" sub="Who owes you the most" testid="chart-top-parties">
          {m.top_parties.length ? (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={m.top_parties} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EB" horizontal={false} />
                <XAxis type="number" fontSize={11} stroke="#69747F" tickFormatter={kfmt} />
                <YAxis type="category" dataKey="name" width={110} fontSize={11} stroke="#69747F" />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="outstanding" name="Outstanding" fill="#C1862A" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="Nothing outstanding" text="All party payments are settled." />}
        </ChartCard>
      </div>
      </>}
      {(canTrips || canLrs) && <ChartCard title="Trips & LRs per Month" sub="Business volume" testid="chart-volume">
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={m.series} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EB" vertical={false} />
            <XAxis dataKey="month" fontSize={11} stroke="#69747F" />
            <YAxis fontSize={11} stroke="#69747F" allowDecimals={false} />
            <Tooltip />
            <Legend iconSize={9} />
            {canTrips && <Bar dataKey="trips" name="Trips" fill="#1B242F" radius={[3, 3, 0, 0]} />}
            {canLrs && <Bar dataKey="lrs" name="LRs" fill="#2C8474" radius={[3, 3, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>}
    </Section>
  );
};

const ChartCard = ({ title, sub, testid, children }) => (
  <Card className="p-4" data-testid={testid}>
    <div className="mb-3">
      <h3 className="font-head text-[15.5px] font-bold text-ink">{title}</h3>
      {sub && <p className="text-[12.5px] text-muted">{sub}</p>}
    </div>
    {children}
  </Card>
);

const Panel = ({ title, action, children }) => (
  <Card className="overflow-hidden">
    <div className="flex items-center justify-between border-b border-line px-4 py-3">
      <h3 className="font-head text-[15.5px] font-bold text-ink">{title}</h3>
      {action && <Btn variant="s" className="py-1.5 text-[13px]" onClick={action}>View all</Btn>}
    </div>
    {children}
  </Card>
);
