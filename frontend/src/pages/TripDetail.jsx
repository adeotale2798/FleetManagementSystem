import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Ban, FileText, Fuel, Pencil, Plus, Receipt } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useFetch, useMaster, opts } from "../lib/hooks";
import { money, dmy } from "../lib/format";
import { hasAdminAccess } from "../lib/adminAccess";
import EntryModal from "../components/QuickForms";
import {
  Badge, Btn, Card, DataTable, EmptyState, ErrorState, Input, Loader, Modal, Money, PageHead, Select, toast,
} from "../components/ui";

const FLOW = ["New", "Assigned", "Started", "In Transit", "Delivered", "Completed"];

export default function TripDetail({ user }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: t, loading, error, reload } = useFetch(`/trips/${id}`);
  const canLrs = hasAdminAccess(user, "industrial_lrs");
  const canFinance = hasAdminAccess(user, "industrial_finance");
  const [entry, setEntry] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const vehicles = useMaster("vehicles");
  const drivers = useMaster("drivers");

  if (loading && !t) return <Loader />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const openEdit = () => setEdit({
    vehicle_id: t.vehicle_id || "", vehicle_no: t.vehicle_no || "", driver_id: t.driver_id || "",
    from_name: t.from_name || "", to_name: t.to_name || "", from_address: t.from_address || "",
    to_address: t.to_address || "", trip_amount: t.trip_amount || 0,
    expected_collection: t.expected_collection || 0, start_date: t.start_date || "",
    start_time: t.start_time || "", remarks: t.remarks || "",
  });

  const saveEdit = async () => {
    setBusy(true);
    try {
      const payload = { ...edit, trip_amount: Number(edit.trip_amount) || 0, expected_collection: Number(edit.expected_collection) || 0 };
      if (!canFinance) {
        delete payload.trip_amount;
        delete payload.expected_collection;
      }
      if (payload.vehicle_id) {
        const v = (vehicles.data || []).find((x) => x.id === payload.vehicle_id);
        if (v) payload.vehicle_no = v.vehicle_no;
      }
      await api.put(`/trips/${id}`, payload);
      toast("Trip updated"); setEdit(null); reload();
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  };

  const setStatus = async (status) => {
    setBusy(true);
    try { await api.put(`/trips/${id}`, { status }); toast(`Trip marked ${status}`); reload(); }
    catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!window.confirm("Cancel this trip? Linked amounts will be reversed, nothing is deleted.")) return;
    try { await api.post(`/trips/${id}/cancel`); toast("Trip cancelled"); reload(); }
    catch (e) { toast(errMsg(e), "err"); }
  };

  const next = FLOW[FLOW.indexOf(t.status) + 1];
  const currentStep = FLOW.indexOf(t.status);

  return (
    <div>
      <PageHead title={`Trip ${t.trip_no}`} back="/trips"
        subtitle={`${t.from_name} → ${t.to_name} · ${t.trip_type} · ${t.mode === "indoor" ? "Indoor" : "Outdoor"}`}
        actions={
          <>
            {t.status !== "Cancelled" && next && (
              <Btn data-testid="advance-status" disabled={busy} onClick={() => setStatus(next)}>Mark {next}</Btn>
            )}
            {canLrs && <Btn variant="s" icon={FileText} data-testid="create-lr-from-trip" onClick={() => nav(`/lrs/new?trip=${id}`)}>Create LR</Btn>}
            {t.status !== "Cancelled" && <Btn variant="s" icon={Pencil} data-testid="edit-trip" onClick={openEdit}>Edit Trip</Btn>}
            {canFinance && t.status !== "Cancelled" && <Btn variant="d" icon={Ban} onClick={cancel} data-testid="cancel-trip">Cancel Trip</Btn>}
          </>
        } />

      <Card className="mb-4 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-head text-[16px] font-bold">Trip progress</h2>
            <p className="text-[13px] text-muted">Current operating status</p>
          </div>
          <Badge>{t.status}</Badge>
        </div>
        {t.status === "Cancelled" ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="status">
            This trip was cancelled; its financial history is retained.
          </p>
        ) : (
          <ol aria-label="Trip status progress" className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {FLOW.map((step, index) => (
              <li key={step} aria-current={index === currentStep ? "step" : undefined}
                className="flex items-center gap-2 text-[12px] font-medium text-muted">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${
                  index < currentStep ? "border-brand-500 bg-brand-500 text-white"
                    : index === currentStep ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-line bg-white text-muted"}`}>
                  {index + 1}
                </span>
                <span className={index === currentStep ? "font-semibold text-brand-700" : ""}>{step}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-head text-[16px] font-bold">Trip Details</h3>
            <Badge>{t.status}</Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px] md:grid-cols-3">
            {[
              ["Start", `${dmy(t.start_date)} ${t.start_time || ""}`],
              ...(t.trip_type === "Round Trip" ? [["Return", `${dmy(t.return_date)} ${t.return_time || ""}`]] : []),
              ["Vehicle", t.vehicle_no + (t.temp_vehicle?.vehicle_no ? " (temporary)" : "")],
              ["Driver", t.driver_name || "Not assigned"],
              ["Party", t.party_name || "—"],
              ...(canFinance ? [["Trip Amount", money(t.trip_amount)],
                ["Expected Collection", money(t.expected_collection)]] : []),
              ["From Address", t.from_address || t.from_name],
              ["To Address", t.to_address || t.to_name],
              ["Remarks", t.remarks || "—"],
            ].map(([k, v]) => (
              <div key={k}><dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
                <dd className="mt-0.5 font-medium">{v}</dd></div>
            ))}
          </dl>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 font-head text-[16px] font-bold">Change Status</h3>
          <Select value={t.status} data-testid="trip-status-select" onChange={(e) => setStatus(e.target.value)}
            options={[...FLOW, "Cancelled"]} placeholder={t.status} />
          {canFinance && <div className="mt-4 space-y-2">
            <Btn variant="s" icon={Receipt} className="w-full" data-testid="add-trip-expense" onClick={() => setEntry("expense")}>Add Expense</Btn>
            <Btn variant="s" icon={Fuel} className="w-full" onClick={() => setEntry("fuel")}>Add Diesel</Btn>
          </div>}
          {canFinance && <div className="mt-4 rounded-lg bg-canvas p-3 text-[13px]" data-testid="trip-profit">
            <p className="flex justify-between"><span className="text-muted">Trip Earning</span>
              <b className="num">{money(t.profit?.earning)}</b></p>
            <p className="mt-1 flex justify-between"><span className="text-muted">Trip Expenses</span>
              <b className="num">− {money(t.profit?.expenses)}</b></p>
            <p className="mt-1 flex justify-between"><span className="text-muted">Diesel</span>
              <b className="num">− {money(t.profit?.diesel)}</b></p>
            <p className="mt-2 flex justify-between border-t border-line pt-2 text-[14px]">
              <span className="font-semibold">Profit</span>
              <b className={`num ${t.profit?.profit < 0 ? "text-red-600" : "text-brand-600"}`}>{money(t.profit?.profit)}</b></p>
          </div>}
        </Card>
      </div>

      {canLrs && <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="font-head text-[15.5px] font-bold">Lorry Receipts ({(t.lrs || []).length})</h3>
          <Btn variant="s" icon={Plus} onClick={() => nav(`/lrs/new?trip=${id}`)}>Add LR</Btn>
        </div>
        <DataTable testid="trip-lrs"
          columns={[
            { key: "lr_no", label: "LR No", strong: true },
            { key: "date", label: "Date", type: "date" },
            { key: "sender", label: "Sender", render: (r) => r.sender?.name },
            { key: "receiver", label: "Receiver", render: (r) => r.receiver?.name || "—" },
            ...(canFinance ? [
              { key: "freight", label: "Freight", type: "money", right: true },
              { key: "payment_status", label: "Status", type: "badge" },
            ] : []),
          ]}
          rows={t.lrs || []} onRowClick={(r) => nav(`/lrs/${r.id}`)}
          empty={<EmptyState title="No LR for this trip" text="Create an LR — trip details fill in automatically."
            action={<Btn onClick={() => nav(`/lrs/new?trip=${id}`)}>Create LR</Btn>} />} />
      </Card>}

      {canFinance && ((t.expenses || []).length > 0 || (t.fuel || []).length > 0) && (
        <Card className="mt-4 overflow-hidden">
          <div className="border-b border-line px-4 py-3"><h3 className="font-head text-[15.5px] font-bold">Expenses & Diesel</h3></div>
          <DataTable
            columns={[
              { key: "date", label: "Date", type: "date" },
              { key: "category", label: "Detail", render: (r) => r.category || `Diesel ${r.quantity || ""}L` },
              { key: "mode", label: "Mode" },
              { key: "amount", label: "Amount", type: "money", right: true },
            ]}
            rows={[...(t.expenses || []), ...(t.fuel || [])]} />
        </Card>
      )}

      {canFinance && <EntryModal kind={entry || "expense"} open={!!entry} onClose={() => setEntry(null)} onDone={reload}
        preset={{ trip_id: id, trip_no: t.trip_no, vehicle_id: t.vehicle_id, vehicle_no: t.vehicle_no, driver_id: t.driver_id }} />
      }

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit Trip ${t.trip_no}`}
        subtitle="Correct vehicle, driver, route or amount — nothing is deleted"
        footer={<><Btn variant="s" onClick={() => setEdit(null)}>Cancel</Btn>
          <Btn disabled={busy} data-testid="save-trip-edit" onClick={saveEdit}>Save Changes</Btn></>}>
        {edit && (
          <div className="grid gap-3 md:grid-cols-2">
            <Select label="Vehicle" value={edit.vehicle_id} data-testid="edit-vehicle"
              onChange={(e) => setEdit({ ...edit, vehicle_id: e.target.value })}
              options={opts(vehicles.data, "vehicle_no")} placeholder={t.vehicle_no || "Select vehicle"} />
            <Select label="Driver" value={edit.driver_id} data-testid="edit-driver"
              onChange={(e) => setEdit({ ...edit, driver_id: e.target.value })}
              options={opts(drivers.data)} placeholder="Select driver" />
            <Input label="From" value={edit.from_name} data-testid="edit-from" onChange={(e) => setEdit({ ...edit, from_name: e.target.value })} />
            <Input label="To" value={edit.to_name} data-testid="edit-to" onChange={(e) => setEdit({ ...edit, to_name: e.target.value })} />
            {canFinance && <>
              <Money label="Trip Amount" value={edit.trip_amount} data-testid="edit-amount" onChange={(e) => setEdit({ ...edit, trip_amount: e.target.value })} />
              <Money label="Expected Collection" value={edit.expected_collection} onChange={(e) => setEdit({ ...edit, expected_collection: e.target.value })} />
            </>}
            <label className="block"><span className="lbl">Start Date</span>
              <input type="date" className="fld" value={edit.start_date} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></label>
            <Input label="Remarks" value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
