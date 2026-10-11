import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Check, ChevronDown, Inbox, Loader2, Search, X, AlertTriangle,
} from "lucide-react";
import { money, dmy } from "../lib/format";

/* ------------------------------------------------------------ toast */
let pushToast = () => {};
let pendingMutationSuccesses = [];
let expectedApiErrors = new Map();

export const toast = (msg, tone = "ok", options = {}) => {
  const text = String(msg ?? "");
  if (tone === "err" && options.apiError) {
    const entry = expectedApiErrors.get(text) || { count: 0, timer: null };
    entry.count += 1;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => expectedApiErrors.delete(text), 1200);
    expectedApiErrors.set(text, entry);
  } else if (tone === "err") {
    const entry = expectedApiErrors.get(text);
    if (entry?.count) {
      entry.count -= 1;
      if (!entry.count) {
        clearTimeout(entry.timer);
        expectedApiErrors.delete(text);
      }
      return;
    }
  } else if (!options.mutationFallback && pendingMutationSuccesses.length) {
    const pending = pendingMutationSuccesses.shift();
    clearTimeout(pending.timer);
  }
  pushToast(text, tone);
};

export const scheduleMutationSuccess = (msg = "Changes saved successfully.") => {
  const pending = {
    timer: setTimeout(() => {
      pendingMutationSuccesses = pendingMutationSuccesses.filter((entry) => entry !== pending);
      toast(msg, "ok", { mutationFallback: true });
    }, 700),
  };
  pendingMutationSuccesses.push(pending);
};

export function ToastHost() {
  const [items, setItems] = useState([]);
  const [mutationFailures, setMutationFailures] = useState([]);
  useEffect(() => {
    pushToast = (msg, tone) => {
      const id = Math.random();
      setItems((s) => [...s, { id, msg, tone }]);
      setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 3600);
    };
    const onMutationStatus = (event) => {
      const status = event.detail;
      if (!status?.key) return;
      if (status.state === "saved") {
        setMutationFailures((current) => current.filter((failure) => failure.key !== status.key));
      } else if (status.state === "failed") {
        setMutationFailures((current) => [
          { key: status.key, title: status.title, reason: status.reason },
          ...current.filter((failure) => failure.key !== status.key),
        ].slice(0, 5));
      }
    };
    window.addEventListener("fms:mutation-status", onMutationStatus);
    return () => window.removeEventListener("fms:mutation-status", onMutationStatus);
  }, []);
  return (
    <div className="fixed right-4 top-4 z-[100] flex w-[min(92vw,420px)] flex-col gap-2 md:right-6 md:top-6">
      {mutationFailures.map((failure) => (
        <div key={failure.key} role="alert" data-testid="persistent-save-error"
          className="row-anim flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-900 shadow-lg">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red-700" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">{failure.title}</p>
            <p className="mt-1 break-words text-sm">{failure.reason}</p>
          </div>
          <button type="button" aria-label="Dismiss save error"
            className="shrink-0 rounded p-1 text-red-800 hover:bg-red-100"
            onClick={() => setMutationFailures((current) => current.filter((item) => item.key !== failure.key))}>
            <X size={17} />
          </button>
        </div>
      ))}
      {items.map((i) => (
        <div
          key={i.id}
          data-testid="toast"
          className={`row-anim flex items-start gap-2.5 rounded-xl px-4 py-3 text-[14px] font-medium text-white shadow-lg ${
            i.tone === "err" ? "bg-red-600" : "bg-ink"
          }`}
        >
          {i.tone === "err" ? (
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          ) : (
            <Check size={17} className="mt-0.5 shrink-0" />
          )}
          <span>{i.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ basics */
export const Btn = ({ variant = "p", icon: Icon, children, className = "", ...p }) => (
  <button className={`btn-${variant} ${className}`} {...p}>
    {Icon && <Icon size={17} />}
    {children}
  </button>
);

export const Card = ({ className = "", children, ...p }) => (
  <div className={`card ${className}`} {...p}>{children}</div>
);

export const Loader = ({ label = "Loading…" }) => (
  <div className="flex items-center justify-center gap-2.5 py-16 text-muted" data-testid="loading">
    <Loader2 className="animate-spin" size={19} /> <span className="text-sm font-medium">{label}</span>
  </div>
);

export const EmptyState = ({ title = "Nothing here yet", text, action }) => (
  <div className="flex flex-col items-center justify-center px-6 py-14 text-center" data-testid="empty-state">
    <div className="mb-3 rounded-2xl bg-canvas p-4 text-muted"><Inbox size={26} /></div>
    <p className="font-head text-[17px] font-semibold text-ink">{title}</p>
    {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const ErrorState = ({ text, onRetry }) => (
  <div className="flex flex-col items-center py-12 text-center" data-testid="error-state">
    <AlertTriangle className="mb-2 text-red-500" size={26} />
    <p className="text-sm font-medium text-ink">{text || "Could not load data"}</p>
    {onRetry && <Btn variant="s" className="mt-4" onClick={onRetry}>Try again</Btn>}
  </div>
);

const TONES = {
  Available: "bg-brand-50 text-brand-600", Active: "bg-brand-50 text-brand-600",
  Completed: "bg-brand-50 text-brand-600", Paid: "bg-brand-50 text-brand-600",
  Valid: "bg-brand-50 text-brand-600", ok: "bg-brand-50 text-brand-600",
  "On Trip": "bg-blue-50 text-blue-700", Started: "bg-blue-50 text-blue-700",
  "In Transit": "bg-blue-50 text-blue-700", Delivered: "bg-indigo-50 text-indigo-700",
  Assigned: "bg-amber-50 text-amber-600", New: "bg-slate-100 text-slate-600",
  Pending: "bg-amber-50 text-amber-600", Partial: "bg-amber-50 text-amber-600",
  "Expiring Soon": "bg-amber-50 text-amber-600", Maintenance: "bg-amber-50 text-amber-600",
  Cancelled: "bg-red-50 text-red-600", Overdue: "bg-red-50 text-red-600",
  Expired: "bg-red-50 text-red-600", Inactive: "bg-slate-100 text-slate-500",
};
export const Badge = ({ children, tone }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wide ${
    TONES[tone || children] || "bg-slate-100 text-slate-600"}`}>
    {children}
  </span>
);

/* ------------------------------------------------------------ form fields */
export const Field = ({ label, hint, required, children, className = "" }) => (
  <label className={`block ${className}`}>
    {label && <span className="lbl">{label}{required && <span className="text-red-500"> *</span>}</span>}
    {children}
    {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
  </label>
);

export const Input = ({ label, hint, required, className = "", ...p }) => (
  <Field label={label} hint={hint} required={required} className={className}>
    <input className="fld" {...p} />
  </Field>
);

export const Money = ({ label, hint, className = "", ...p }) => (
  <Field label={label} hint={hint} className={className}>
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
      <input type="number" step="0.01" min="0" className="fld pl-7 num" {...p} />
    </div>
  </Field>
);

export const Select = ({ label, hint, required, options = [], placeholder = "Select", className = "", ...p }) => (
  <Field label={label} hint={hint} required={required} className={className}>
    <div className="relative">
      <select className="fld appearance-none pr-9" {...p}>
        <option value="">{placeholder}</option>
        {options.map((o) =>
          typeof o === "string" ? <option key={o} value={o}>{o}</option>
            : <option key={o.value} value={o.value}>{o.label}</option>
        )}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  </Field>
);

export const TextArea = ({ label, className = "", ...p }) => (
  <Field label={label} className={className}>
    <textarea rows={2} className="fld resize-y" {...p} />
  </Field>
);

export const SearchBox = ({ value, onChange, placeholder = "Search…", testid = "search-input" }) => (
  <div className="relative flex-1">
    <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
    <input data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} className="fld pl-9" />
  </div>
);

/* ------------------------------------------------------------ modal */
export function Modal({ open, onClose, title, subtitle, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", h); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal((
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-sm fadein md:items-center md:p-6"
      data-testid="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} data-testid="modal"
        className={`app-modal-panel row-anim flex min-h-0 max-h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl md:rounded-2xl ${
          wide ? "md:max-w-4xl" : "md:max-w-xl"}`}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h3 className="font-head text-[18px] font-bold text-ink">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close dialog" data-testid="modal-close" className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink">
            <X size={20} />
          </button>
        </div>
        <div data-testid="modal-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="flex gap-2 border-t border-line bg-canvas/60 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  ), document.body);
}

/* ------------------------------------------------------------ page head */
export function PageHead({ title, subtitle, actions, back }) {
  const nav = useNavigate();
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {back && (
          <button onClick={() => nav(back === true ? -1 : back)} data-testid="back-btn"
            className="mt-1 rounded-lg border border-line bg-white p-2 text-muted hover:text-ink">
            <ArrowLeft size={17} />
          </button>
        )}
        <div>
          <h1 className="font-head text-[23px] font-bold leading-tight text-ink md:text-[27px]">{title}</h1>
          {subtitle && <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="mb-5 -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
    {tabs.map((t) => {
      const v = t.value ?? t;
      const label = t.label ?? t;
      const on = v === value;
      return (
        <button key={v} data-testid={`tab-${v}`} onClick={() => onChange(v)}
          className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-[14px] font-semibold transition-colors ${
            on ? "bg-brand-500 text-white" : "text-muted hover:bg-white hover:text-ink"}`}>
          {label}{t.count !== undefined && <span className="ml-1.5 opacity-70">{t.count}</span>}
        </button>
      );
    })}
  </div>
);

export const Stat = ({ label, value, sub, icon: Icon, tone = "", onClick, testid }) => {
  const content = (
    <span className="flex items-start justify-between gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {Icon && <Icon size={16} className={tone || "text-brand-400"} />}
    </span>
  );
  const details = (
    <>
      {content}
      <span className={`num mt-2 block font-head text-[21px] font-bold leading-none ${tone || "text-ink"}`}>{value}</span>
      {sub && <span className="mt-1.5 block text-[12.5px] text-muted">{sub}</span>}
    </>
  );
  const className = `card dashboard-kpi row-anim p-4 ${onClick ? "stat-button cursor-pointer" : ""}`;
  return onClick ? (
    <button type="button" data-testid={testid} onClick={onClick} className={className}>
      {details}
    </button>
  ) : (
    <div data-testid={testid} className={className}>{details}</div>
  );
};

/* ------------------------------------------------------------ data table + mobile cards */
export function DataTable({ columns, rows, onRowClick, mobile, empty, rightAlignLast, testid = "data-table" }) {
  if (!rows?.length) return empty || <EmptyState />;
  const cellVal = (c, r) => {
    if (c.render) return c.render(r);
    const v = r[c.key];
    if (c.type === "money") return <span className="num">{money(v)}</span>;
    if (c.type === "date") return dmy(v);
    if (c.type === "badge") return v ? <Badge>{v}</Badge> : "—";
    return v === 0 ? "0" : v || "—";
  };
  return (
    <>
      <div className="hidden overflow-x-auto md:block" data-testid={testid}>
        <table className="w-full min-w-full">
          <thead className="border-b border-line bg-canvas/70">
            <tr>{columns.map((c) => <th key={c.key} className={`th ${c.right ? "text-right" : ""}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={r.id || i} onClick={() => onRowClick?.(r)}
                data-testid={`row-${r.id || i}`}
                className={`${onRowClick ? "cursor-pointer" : ""} transition-colors hover:bg-brand-50/40`}>
                {columns.map((c) => (
                  <td key={c.key} className={`td ${c.right ? "text-right" : ""} ${c.strong ? "font-semibold" : ""}`}>
                    {cellVal(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-line md:hidden">
        {rows.map((r, i) => (
          <div key={r.id || i} onClick={() => onRowClick?.(r)} data-testid={`card-${r.id || i}`}
            className="px-4 py-3.5 active:bg-canvas">
            {mobile ? mobile(r) : (
              <div className="space-y-1">
                {columns.slice(0, 4).map((c) => (
                  <div key={c.key} className="flex justify-between gap-3 text-[13.5px]">
                    <span className="text-muted">{c.label}</span>
                    <span className="text-right font-medium">{cellVal(c, r)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------ autocomplete (party etc.) */
export function Autocomplete({
  label, value, onChange, onPick, fetcher, placeholder = "Type to search…",
  renderItem, required, hint, testid = "autocomplete", allowNew = true,
}) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const type = (v) => {
    onChange(v);
    clearTimeout(timer.current);
    if (!v || v.length < 1) { setItems([]); setOpen(false); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      try { setItems(await fetcher(v)); setOpen(true); } finally { setBusy(false); }
    }, 220);
  };

  return (
    <div className="relative" ref={box}>
      <Field label={label} required={required} hint={hint}>
        <div className="relative">
          <input data-testid={testid} className="fld" value={value || ""} placeholder={placeholder}
            onChange={(e) => type(e.target.value)} onFocus={() => items.length && setOpen(true)} autoComplete="off" />
          {busy && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted" />}
        </div>
      </Field>
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-xl">
          {items.length === 0 && (
            <p className="px-3 py-3 text-[13px] text-muted">
              {allowNew ? "No match — it will be saved as a new entry." : "No match found"}
            </p>
          )}
          {items.map((it) => (
            <button type="button" key={it.id} data-testid={`ac-option-${it.id}`}
              onClick={() => { onPick(it); setOpen(false); }}
              className="block w-full px-3 py-2.5 text-left hover:bg-brand-50">
              {renderItem ? renderItem(it) : <span>{it.name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
