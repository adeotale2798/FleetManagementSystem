import { installClientErrorReporting, reportClientError } from "./errorReporting";

describe("browser error reporting", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    localStorage.removeItem("fms_token");
    sessionStorage.removeItem("fms_support_token");
    window.history.replaceState({}, "", "/dashboard?private=value");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.removeItem("fms_token");
    sessionStorage.removeItem("fms_support_token");
    window.history.replaceState({}, "", "/");
  });

  it("submits authenticated browser errors without collecting query-string data", () => {
    localStorage.setItem("fms_token", "test-token");
    reportClientError(new TypeError("Unexpected value"), "window_error");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/client-errors$/);
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(options.body)).toMatchObject({
      name: "TypeError",
      message: "Unexpected value",
      page: "/dashboard",
      event_type: "window_error",
    });
    expect(options.body).not.toContain("private=value");
  });

  it("does not send duplicate errors repeatedly", () => {
    localStorage.setItem("fms_token", "test-token");
    reportClientError(new Error("Repeated failure"));
    reportClientError(new Error("Repeated failure"));

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("listens for uncaught errors and removes listeners on cleanup", () => {
    localStorage.setItem("fms_token", "test-token");
    const cleanup = installClientErrorReporting();
    window.dispatchEvent(new Event("error"));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    cleanup();
    window.dispatchEvent(new Event("error"));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
