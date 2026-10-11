import axios from "axios";
import { scheduleMutationSuccess, toast } from "../components/ui";
import { publishDataChange } from "./realtime";
import { assetUrl } from "./assetUrl";

const BASE = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
export const api = axios.create({ baseURL: `${BASE}/api`, timeout: 60000 });
export { assetUrl };

const isWriteRequest = (config) => {
  const method = String(config?.method || "").toLowerCase();
  const url = String(config?.url || "");
  const isSupportSessionControl = /\/platform\/(?:tenants\/[^/]+\/support-session|support-session\/end)(?:[?#]|$)/i.test(url);
  return ["post", "put", "patch", "delete"].includes(method)
    && !/\/auth\/login(?:[?#]|$)/i.test(url)
    && !isSupportSessionControl;
};

const mutationSuccessLabel = (config) => {
  const method = String(config?.method || "").toLowerCase();
  const segments = String(config?.url || "").split(/[?#]/, 1)[0].split("/").filter(Boolean);
  const route = segments.filter((segment) => !/^\d+$/.test(segment));
  const last = route[route.length - 1]?.toLowerCase();
  const resource = ({
    trips: "Trip",
    lrs: "LR",
    expenses: "Expense",
    sites: "Site",
    "ledger-imports": "Ledger import",
    "ledger-import": "Ledger import",
    settings: "Settings",
    upload: "File",
  })[last] || ({
    trips: "Trip",
    lrs: "LR",
    expenses: "Expense",
    sites: "Site",
    "ledger-imports": "Ledger import",
    "ledger-import": "Ledger import",
  })[[...route].reverse().find((segment) => (
    ["trips", "lrs", "expenses", "sites", "ledger-imports", "ledger-import"].includes(segment.toLowerCase())
  ))?.toLowerCase()] || "";

  if (!resource) return "Changes saved successfully.";
  if (last === "settlement") return "Payment status updated";
  if (last === "close") return `${resource} closed`;
  if (last === "reopen") return `${resource} reopened`;
  const action = method === "post" ? (last === "trips" || last === "lrs" || last === "sites" ? "created" : "saved")
    : method === "delete" ? "deleted" : "updated";
  return `${resource} ${action}`;
};

const mutationKey = (config) => [
  String(config?.method || "").toLowerCase(),
  String(config?.url || "").split(/[?#]/, 1)[0],
].join(":");

const publishMutationStatus = (detail) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fms:mutation-status", { detail }));
  }
};

api.interceptors.request.use((cfg) => {
  const t = sessionStorage.getItem("fms_support_token") || localStorage.getItem("fms_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => {
    if (isWriteRequest(r.config)) {
      publishMutationStatus({ state: "saved", key: mutationKey(r.config) });
      scheduleMutationSuccess(mutationSuccessLabel(r.config));
      publishDataChange(r.headers?.["x-data-revision"], { notifySelf: false });
      if (r.headers?.["x-support-audit-status"] === "unavailable") {
        toast("Change saved, but the platform support audit could not be recorded. Contact platform support.", "err");
      }
      if (r.headers?.["x-data-sync-status"] === "unavailable") {
        toast("Saved, but live updates are temporarily unavailable; other devices may need to reload.", "err");
      }
    }
    return r;
  },
  (err) => {
    if (err?.response?.status === 401 && !String(err.config?.url).includes("/auth/login")) {
      if (sessionStorage.getItem("fms_support_token")) {
        sessionStorage.removeItem("fms_support_token");
        if (!window.location.pathname.startsWith("/platform")) window.location.href = "/platform";
      } else {
        localStorage.removeItem("fms_token");
        if (window.location.pathname !== "/login") window.location.href = "/login";
      }
    }
    if (isWriteRequest(err?.config)) {
      const reason = errMsg(err);
      publishMutationStatus({
        state: "failed",
        key: mutationKey(err.config),
        title: `Save failed · ${mutationSuccessLabel(err.config)}`,
        reason,
      });
      toast(reason, "err", { apiError: true });
    }
    return Promise.reject(err);
  }
);

const validationMessage = (detail) => {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return typeof detail.message === "string" ? detail.message : "";
  }
  if (Array.isArray(detail)) {
    return detail.map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const location = Array.isArray(item.loc)
        ? item.loc
          .filter((part) => part !== "body" && part !== "query" && part !== "path")
          .map(String)
          .join(".")
        : "";
      return [location, item.msg].filter(Boolean).map(String).join(": ");
    }).filter(Boolean).join("; ");
  }
  return "";
};

export const errMsg = (e) => {
  const status = e?.response?.status;
  if (e?.code === "ECONNABORTED") {
    return "The connection is taking too long. Your changes are kept; please try again.";
  }
  if (!e?.response && e?.message === "Network Error") {
    return "The server cannot be reached. Check your connection and try again.";
  }
  if (status >= 500) {
    const reference = e?.response?.data?.reference_id || e?.response?.headers?.["x-reference-id"];
    return `The server couldn't complete this request. Please try again.${reference ? ` Reference: ${reference}` : ""}`;
  }
  const detail = validationMessage(e?.response?.data?.detail);
  return detail || (e?.response
    ? `Request failed (HTTP ${status || "unknown"}). The server did not include an explanation; please try again or contact support.`
    : e?.message || "Something went wrong. Please try again.");
};

export const uploadFile = async (file, kind = "misc") => {
  const fd = new FormData();
  fd.append("file", file);
  const r = await api.post(`/upload?kind=${encodeURIComponent(kind)}`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return assetUrl(r.data.url);
};
