import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "../lib/api";
import { Card } from "../components/ui";

const normalizeName = (value) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

export default function PartyNameManager({ siteId }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState({ senders: false, receivers: false });
  const [drafts, setDrafts] = useState({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const term = query.trim();
  const requestId = useRef(0);

  const load = useCallback(async (search = term) => {
    if (!siteId || !search) {
      setRows([]);
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/sites/${siteId}/party-names`, {
        params: { q: search },
      });
      const data = response.data || {};
      const items = [
        ...(data.senders || []).map((item) => ({ ...item, role: "sender" })),
        ...(data.receivers || []).map((item) => ({ ...item, role: "receiver" })),
      ];
      if (currentRequest !== requestId.current) return;
      setRows(items);
      setHasMore(data.has_more || { senders: false, receivers: false });
      setDrafts(Object.fromEntries(items.map((item) => [
        `${item.role}:${normalizeName(item.name)}`,
        { name: item.name, phone: item.phone || "" },
      ])));
    } catch (requestError) {
      if (currentRequest === requestId.current) setError(errMsg(requestError));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [siteId, term]);

  useEffect(() => {
    if (!term) {
      requestId.current += 1;
      setRows([]);
      setError("");
      setLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(() => load(term), 180);
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [load, term]);

  const updateDraft = (key, patch) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  const save = async (item) => {
    const key = `${item.role}:${normalizeName(item.name)}`;
    const draft = drafts[key] || {};
    setSaving(key);
    setError("");
    setMessage("");
    try {
      await api.patch(`/sites/${siteId}/party-names`, {
        role: item.role,
        original_name: item.name,
        name: draft.name,
        ...(item.role === "receiver" ? { phone: draft.phone } : {}),
        reason,
      });
      setMessage(`${item.role === "sender" ? "Sender" : "Receiver"} suggestion updated.`);
      await load();
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setSaving("");
    }
  };

  const retire = async (item) => {
    if (!window.confirm(`Retire ${item.role} suggestion "${item.name}"? Existing receipts will not be changed.`)) return;
    const key = `${item.role}:${normalizeName(item.name)}`;
    setSaving(key);
    setError("");
    setMessage("");
    try {
      await api.patch(`/sites/${siteId}/party-names`, {
        role: item.role, original_name: item.name, retired: true, reason,
      });
      setMessage(`${item.role === "sender" ? "Sender" : "Receiver"} suggestion retired.`);
      await load();
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setSaving("");
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="font-semibold">Saved sender and receiver suggestions</h2>
        <p className="mt-1 text-sm text-muted">
          Search by the beginning of a name to correct its spelling or receiver phone, or retire a bad suggestion.
          Existing receipts remain unchanged. Actions are recorded in the site audit history.
        </p>
      </div>
      {!siteId && <p className="text-sm text-muted">Select a site to manage its suggestions.</p>}
      <label className="block max-w-lg text-sm">Search name prefix
        <input className="fld w-full" aria-label="Search saved party names" maxLength={80}
          value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="block max-w-lg text-sm">Audit reason (optional)
        <input className="fld w-full" aria-label="Suggestion change reason" maxLength={500}
          value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-brand-700">{message}</p>}
      {loading && <p role="status" className="text-sm text-muted">Loading suggestions…</p>}
      {!loading && term && rows.length === 0 && !error
        && <p className="text-sm text-muted">No active suggestions match this prefix.</p>}
      {rows.length > 0 && <div className="space-y-2">
        {rows.map((item) => {
          const key = `${item.role}:${normalizeName(item.name)}`;
          const draft = drafts[key] || { name: item.name, phone: item.phone || "" };
          const busy = saving === key;
          return <div key={key} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-end">
            <label className="text-xs text-muted">{item.role === "sender" ? "Sender" : "Receiver"} name
              <input className="fld w-full" aria-label={`Correct ${item.role} ${item.name}`}
                maxLength={160} value={draft.name}
                onChange={(event) => updateDraft(key, { name: event.target.value })} />
            </label>
            {item.role === "receiver" ? <label className="text-xs text-muted">Phone
              <input className="fld w-full" aria-label={`Phone for ${item.name}`}
                inputMode="numeric" maxLength={30} value={draft.phone}
                onChange={(event) => updateDraft(key, {
                  phone: event.target.value.replace(/\D/g, "").slice(0, 10),
                })} />
            </label> : <span className="text-xs text-muted">Sender suggestions do not store a phone.</span>}
            <button type="button" className="btn-s" disabled={busy || !draft.name.trim()}
              onClick={() => save(item)}>{busy ? "Saving…" : "Save correction"}</button>
            <button type="button" className="btn-s" disabled={busy}
              onClick={() => retire(item)}>Retire</button>
          </div>;
        })}
        {(hasMore.senders || hasMore.receivers) && <p className="text-xs text-muted">
          Showing up to 50 matches per role. Type more letters to narrow the search.
        </p>}
      </div>}
    </Card>
  );
}
