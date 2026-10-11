import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Truck } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useFetch, useMaster, opts } from "../lib/hooks";
import { money, todayISO, nowTime } from "../lib/format";
import { hasAdminAccess } from "../lib/adminAccess";
import LocationPicker from "../components/LocationPicker";
import {
  Autocomplete, Badge, Btn, Card, Input, Money, PageHead, Select, TextArea, toast,
} from "../components/ui";

export default function TripForm({ user }) {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [f, setF] = useState({
    mode: sp.get("mode") || "indoor",
    trip_type: "One Way",
    start_date: todayISO(),
    start_time: nowTime(),
    route_id: "", vehicle_id: "", driver_id: "",
    from_name: "", to_name: "", trip_amount: "", expected_collection: "", remarks: "",
  });
  const [temp, setTemp] = useState(null);
  const [tempDrv, setTempDrv] = useState(null);
  const [partyText, setPartyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const canFinance = hasAdminAccess(user, "industrial_finance");
  const canVehicles = hasAdminAccess(user, "industrial_vehicles");
  const canTeam = hasAdminAccess(user, "industrial_team");
  const canParties = hasAdminAccess(user, "industrial_parties");

  const settings = useFetch("/settings");
  const vehicles = useMaster("vehicles");
  const drivers = useMaster("drivers");

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const routes = (settings.data?.routes || []).filter((r) => r.active !== false);
  const route = routes.find((r) => r.id === f.route_id);
  const locs = settings.data?.base_locations || [];
  const locName = (id) => locs.find((l) => l.id === id)?.name || "";

  const vehicle = (vehicles.data || []).find((v) => v.id === f.vehicle_id);
  const driver = (drivers.data || []).find((d) => d.id === f.driver_id);

  const canSave = useMemo(() => {
    if (f.mode === "indoor" && !f.route_id) return false;
    if (f.mode === "outdoor" && (!f.from_name || !f.to_name)) return false;
    if (!f.vehicle_id && !temp?.vehicle_no) return false;
    return true;
  }, [f, temp]);

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const body = { ...f, trip_amount: Number(f.trip_amount || 0), expected_collection: Number(f.expected_collection || 0) };
      if (!canFinance) {
        delete body.trip_amount;
        delete body.expected_collection;
        if (body.temp_vehicle) {
          delete body.temp_vehicle.hire_amount;
          delete body.temp_vehicle.paid;
        }
        if (body.temp_driver) {
          delete body.temp_driver.hire_amount;
          delete body.temp_driver.paid;
        }
      }
      if (temp?.vehicle_no) { body.temp_vehicle = temp; body.save_vehicle = !!temp.save; body.vehicle_id = null; }
      if (tempDrv?.name) { body.temp_driver = tempDrv; body.save_driver = !!tempDrv.save; body.driver_id = null; }
      const r = await api.post("/trips", body);
      toast(`Trip ${r.data.trip_no} created`);
      nav(`/trips/${r.data.id}`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Create Trip" subtitle="Set the route and vehicle, then add any optional party or financial details." back="/trips" />

      <Card className="mb-4 p-4">
        <div className="mb-3">
          <h2 className="font-head text-[16px] font-bold">Trip kind</h2>
          <p className="text-[13px] text-muted">Choose a saved route or enter a custom source and destination.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[["indoor", "Indoor Trip", "Regular route from Settings"], ["outdoor", "Outdoor Trip", "Any custom source & destination"]].map(([v, t, s]) => (
            <button key={v} data-testid={`mode-${v}`} onClick={() => setF({ ...f, mode: v })}
              className={`rounded-xl border p-3.5 text-left transition-all ${
                f.mode === v ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/20" : "border-line hover:border-brand-400"}`}>
              <div className="flex items-center justify-between">
                <span className="font-head text-[15px] font-bold">{t}</span>
                {f.mode === v && <Check size={17} className="text-brand-600" />}
              </div>
              <p className="mt-1 text-[12.5px] text-muted">{s}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card className="mb-4 space-y-4 p-4">
        <div className="border-b border-line pb-3">
          <h2 className="font-head text-[16px] font-bold">Route &amp; schedule</h2>
          <p className="text-[13px] text-muted">Choose the route, trip type and operating dates.</p>
        </div>
        {f.mode === "indoor" ? (
          <>
            <Select label="Select Route" required value={f.route_id} data-testid="trip-route"
              onChange={(e) => {
                const r = routes.find((x) => x.id === e.target.value);
                setF((s) => ({ ...s, route_id: e.target.value, trip_amount: r?.default_amount || s.trip_amount }));
              }}
              options={routes.map((r) => ({ value: r.id, label: r.name }))}
              placeholder="Choose a route" hint="Routes and base locations come from Settings" />
            {route && (
              <div className="grid gap-3 rounded-lg bg-canvas p-3 text-[13.5px] md:grid-cols-2">
                <div><span className="text-muted">From: </span><b>{locName(route.from_id)}</b>
                  <p className="text-[12.5px] text-muted">{locs.find((l) => l.id === route.from_id)?.address}</p></div>
                <div><span className="text-muted">To: </span><b>{locName(route.to_id)}</b>
                  <p className="text-[12.5px] text-muted">{locs.find((l) => l.id === route.to_id)?.address}</p></div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <LocationPicker label="Source" value={f.from_name} onChange={(v) => setF((s) => ({ ...s, from_name: v }))}
              latlng={f.from_latlng} onLatLng={(ll) => setF((s) => ({ ...s, from_latlng: ll }))} />
            <LocationPicker label="Destination" value={f.to_name} onChange={(v) => setF((s) => ({ ...s, to_name: v }))}
              latlng={f.to_latlng} onLatLng={(ll) => setF((s) => ({ ...s, to_latlng: ll }))} />
          </div>
        )}

        <div>
          <p className="lbl">Trip Type</p>
          <div className="flex gap-2">
            {["One Way", "Round Trip"].map((t) => (
              <button key={t} data-testid={`triptype-${t.replace(" ", "-").toLowerCase()}`} onClick={() => setF({ ...f, trip_type: t })}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-[14px] font-semibold transition-colors ${
                  f.trip_type === t ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-white text-ink"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Input label="Start Date" type="date" value={f.start_date} onChange={set("start_date")} data-testid="trip-start-date" />
          <Input label="Start Time" type="time" value={f.start_time} onChange={set("start_time")} />
          {f.trip_type === "Round Trip" && (
            <>
              <Input label="Return Date" type="date" value={f.return_date || ""} onChange={set("return_date")} data-testid="trip-return-date" />
              <Input label="Return Time" type="time" value={f.return_time || ""} onChange={set("return_time")} />
            </>
          )}
        </div>
      </Card>

      <Card className="mb-4 space-y-4 p-4">
        <div className="border-b border-line pb-3">
          <h2 className="font-head text-[16px] font-bold">Vehicle assignment</h2>
          <p className="text-[13px] text-muted">Select a fleet vehicle or add a trip-only vehicle.</p>
        </div>
        {!temp ? (
          <>
            <Select label="Select Vehicle" required value={f.vehicle_id} onChange={set("vehicle_id")}
              data-testid="trip-vehicle"
              options={(vehicles.data || []).map((v) => ({
                value: v.id, label: `${v.vehicle_no} · ${v.status}${v.current_trip ? ` (on ${v.current_trip.trip_no})` : ""}` }))} />
            {vehicle?.current_trip && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-600">
                This vehicle is already on trip {vehicle.current_trip.trip_no}.
              </p>
            )}
            <button onClick={() => setTemp({ vehicle_no: "", vehicle_type: "", save: false, hire_amount: "", payment_date: f.start_date, pay_mode: "Cash", paid: false, payment_cycle: "this_trip" })}
              data-testid="add-temp-vehicle" className="text-left text-[13.5px] font-semibold text-brand-600 hover:underline">
              + Add temporary (only for this trip) or permanent vehicle if it is not added previously
            </button>
          </>
        ) : (
          <div className="space-y-3 rounded-xl border border-dashed border-brand-400 bg-brand-50/40 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-head text-[14.5px] font-bold">New vehicle</span>
              <button onClick={() => setTemp(null)} className="text-[13px] font-semibold text-muted hover:text-ink">Use saved vehicle</button>
            </div>
            <p className="text-[12.5px] text-muted">Temporary = this trip only. Tick permanent to keep it in your fleet from the trip start date.</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Vehicle Number" required value={temp.vehicle_no} data-testid="temp-vehicle-no"
                onChange={(e) => setTemp({ ...temp, vehicle_no: e.target.value.toUpperCase() })} placeholder="MH 34 AB 1234" />
              <Input label="Vehicle Type" value={temp.vehicle_type} onChange={(e) => setTemp({ ...temp, vehicle_type: e.target.value })} placeholder="Truck / Tempo" />
              <Input label="Owner (optional)" value={temp.owner_name || ""} onChange={(e) => setTemp({ ...temp, owner_name: e.target.value })} />
              <Input label="Make & Model (optional)" value={temp.make || ""} onChange={(e) => setTemp({ ...temp, make: e.target.value })} />
              <Input label="On fleet / hire from" type="date" value={temp.payment_date || f.start_date}
                onChange={(e) => setTemp({ ...temp, payment_date: e.target.value })} />
              {canFinance && <Money label="This-trip hire (₹) if hired" value={temp.hire_amount || ""} onChange={(e) => setTemp({ ...temp, hire_amount: e.target.value })} />}
            </div>
            {canVehicles && <label className="flex items-center gap-2.5 text-[13.5px] font-medium">
              <input type="checkbox" data-testid="temp-save-permanent" checked={!!temp.save}
                onChange={(e) => setTemp({ ...temp, save: e.target.checked, payment_cycle: e.target.checked ? "Owned" : "this_trip" })} className="h-4 w-4 accent-[#0B5C4E]" />
              Save as a permanent fleet vehicle
            </label>}
            {canFinance && Number(temp.hire_amount) > 0 && (
              <label className="flex items-center gap-2.5 text-[13.5px] font-medium">
                <input type="checkbox" checked={!!temp.paid} onChange={(e) => setTemp({ ...temp, paid: e.target.checked })} className="h-4 w-4 accent-[#0B5C4E]" />
                Hire paid now ({temp.pay_mode || "Cash"})
              </label>
            )}
          </div>
        )}
      </Card>

      <Card className="mb-4 space-y-4 p-4">
        <div className="border-b border-line pb-3">
          <h2 className="font-head text-[16px] font-bold">Driver assignment</h2>
          <p className="text-[13px] text-muted">Assign a saved driver or enter a trip-only driver.</p>
        </div>
        {!tempDrv ? (
          <>
            <Select label="Select Driver" value={f.driver_id} onChange={set("driver_id")} data-testid="trip-driver"
              options={(drivers.data || []).map((d) => ({
                value: d.id, label: `${d.name} · ${d.current_trip ? `On trip ${d.current_trip.trip_no}` : "Available"}` }))} />
            {driver && (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <Badge>{driver.current_trip ? "On Trip" : "Available"}</Badge>
                <span className="text-muted">{driver.mobile}</span>
                {driver.balance > 0 && (
                  <Btn variant="s" className="py-1.5 text-[13px]" onClick={() => nav(`/drivers/${driver.id}`)}>
                    Advance {money(driver.balance)}
                  </Btn>
                )}
              </div>
            )}
            <button onClick={() => setTempDrv({ name: "", mobile: "", licence_no: "", save: false, hire_amount: "", payment_date: f.start_date, pay_mode: "Cash", paid: false, payment_cycle: "this_trip" })}
              data-testid="add-temp-driver" className="text-left text-[13.5px] font-semibold text-brand-600 hover:underline">
              + Add temporary (only for this trip) or permanent driver if they are not added previously
            </button>
          </>
        ) : (
          <div className="space-y-3 rounded-xl border border-dashed border-brand-400 bg-brand-50/40 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-head text-[14.5px] font-bold">New driver</span>
              <button onClick={() => setTempDrv(null)} className="text-[13px] font-semibold text-muted hover:text-ink">Use saved driver</button>
            </div>
            <p className="text-[12.5px] text-muted">Temporary = this trip only. Tick permanent to add them to Team from the trip start date, with monthly salary cycle.</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Driver Name" required value={tempDrv.name} data-testid="temp-driver-name"
                onChange={(e) => setTempDrv({ ...tempDrv, name: e.target.value })} />
              <Input label="Mobile" value={tempDrv.mobile || ""} onChange={(e) => setTempDrv({ ...tempDrv, mobile: e.target.value })} />
              <Input label="Licence no. (optional)" value={tempDrv.licence_no || ""} onChange={(e) => setTempDrv({ ...tempDrv, licence_no: e.target.value })} />
              <Input label="Join / trip date" type="date" value={tempDrv.payment_date || f.start_date}
                onChange={(e) => setTempDrv({ ...tempDrv, payment_date: e.target.value })} />
              {canFinance && <Money label="This-trip hire / wage (₹)" value={tempDrv.hire_amount || ""} onChange={(e) => setTempDrv({ ...tempDrv, hire_amount: e.target.value })} />}
              {canFinance && <Select label="Pay mode" value={tempDrv.pay_mode || "Cash"} onChange={(e) => setTempDrv({ ...tempDrv, pay_mode: e.target.value })}
                options={["Cash", "UPI", "Bank"]} />
              }
            </div>
            {canTeam && <label className="flex items-center gap-2.5 text-[13.5px] font-medium">
              <input type="checkbox" data-testid="temp-save-driver" checked={!!tempDrv.save}
                onChange={(e) => setTempDrv({ ...tempDrv, save: e.target.checked, payment_cycle: e.target.checked ? "Monthly" : "this_trip" })} className="h-4 w-4 accent-[#0B5C4E]" />
              Save as a permanent driver (monthly payment cycle)
            </label>}
            {canFinance && Number(tempDrv.hire_amount) > 0 && (
              <label className="flex items-center gap-2.5 text-[13.5px] font-medium">
                <input type="checkbox" checked={!!tempDrv.paid} onChange={(e) => setTempDrv({ ...tempDrv, paid: e.target.checked })} className="h-4 w-4 accent-[#0B5C4E]" />
                Wage paid now
              </label>
            )}
          </div>
        )}
      </Card>

      <Card className="mb-4 space-y-4 p-4">
        <div className="border-b border-line pb-3">
          <h2 className="font-head text-[16px] font-bold">{canFinance ? "Party & trip amounts" : "Party"}</h2>
          <p className="text-[13px] text-muted">Optional values can be updated later from trip details.</p>
        </div>
        {canParties && <Autocomplete label="Party / Customer" value={partyText} testid="trip-party"
          onChange={(v) => { setPartyText(v); setF((s) => ({ ...s, party_id: null, party_name: v })); }}
          onPick={(p) => { setPartyText(p.name); setF((s) => ({ ...s, party_id: p.id, party_name: p.name })); }}
          fetcher={async (q) => (await api.get("/parties/suggest", { params: { q } })).data}
          hint="New name will be saved to your party list"
          renderItem={(p) => (
            <div className="flex justify-between gap-3">
              <div><p className="text-[14.5px] font-semibold">{p.name}</p>
                <p className="text-[12.5px] text-muted">{p.mobile || "no mobile"} · {p.city || "—"}</p></div>
              <span className="num text-[13px] text-amber-600">{money(p.balance)}</span>
            </div>
          )} />}
        {canFinance && <div className="grid gap-3 md:grid-cols-2">
          <Money label="Trip Amount" value={f.trip_amount} onChange={set("trip_amount")} data-testid="trip-amount" />
          <Money label="Expected Collection" value={f.expected_collection} onChange={set("expected_collection")} />
        </div>}
        <TextArea label="Remarks" value={f.remarks} onChange={set("remarks")} />
      </Card>

      {err && <p data-testid="trip-error" className="mb-3 rounded-lg bg-red-50 px-3 py-2.5 text-[13.5px] font-medium text-red-600">{err}</p>}

      <div className="sticky bottom-20 z-20 flex gap-2 md:bottom-4">
        <Btn variant="s" className="flex-1" onClick={() => nav("/trips")}>Cancel</Btn>
        <Btn icon={Truck} className="flex-[2]" data-testid="save-trip" disabled={!canSave || busy} onClick={save}>
          {busy ? "Saving…" : "Create Trip"}
        </Btn>
      </div>
    </div>
  );
}
