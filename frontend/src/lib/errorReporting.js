const BASE = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
const recentReports = new Map();

export function reportClientError(error, eventType = "react_error") {
  const token = sessionStorage.getItem("fms_support_token") || localStorage.getItem("fms_token");
  if (!token) return;

  const name = String(error?.name || "Error").slice(0, 120);
  const message = String(error?.message || error || "Unknown browser error").slice(0, 1000);
  const stack = String(error?.stack || "").slice(0, 8000);
  const page = window.location.pathname.slice(0, 300);
  const fingerprint = `${name}:${message}:${page}`;
  const now = Date.now();
  if (now - (recentReports.get(fingerprint) || 0) < 30000) return;
  recentReports.set(fingerprint, now);
  for (const [key, timestamp] of recentReports) {
    if (now - timestamp >= 30000) recentReports.delete(key);
  }

  fetch(`${BASE}/api/client-errors`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, message, stack, page, event_type: eventType }),
    keepalive: true,
  }).catch(() => {});
}

export function installClientErrorReporting() {
  const onError = (event) => {
    reportClientError(event.error || {
      name: "Error",
      message: event.message || "Browser reported an uncaught error",
      stack: `${event.filename || ""}:${event.lineno || ""}:${event.colno || ""}`,
    }, "window_error");
  };
  const onUnhandledRejection = (event) => {
    reportClientError(event.reason, "unhandled_rejection");
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
