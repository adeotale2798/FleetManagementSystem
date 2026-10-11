jest.mock("../components/ui", () => ({
  scheduleMutationSuccess: jest.fn(),
  toast: jest.fn(),
}));
jest.mock("./realtime", () => ({ publishDataChange: jest.fn() }));
jest.mock("axios", () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({
      interceptors: {
        request: {
          handlers: [],
          use(handler) { this.handlers.push(handler); },
        },
        response: {
          handlers: [],
          use(fulfilled, rejected) {
            this.handlers.push({ fulfilled, rejected });
          },
        },
      },
    })),
  },
}));

import { api, errMsg } from "./api";
import { scheduleMutationSuccess, toast } from "../components/ui";
import { publishDataChange } from "./realtime";

describe("API mutation notices", () => {
  const requestInterceptor = api.interceptors.request.handlers[0];
  const responseInterceptor = api.interceptors.response.handlers[0];

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.removeItem("fms_token");
    sessionStorage.removeItem("fms_support_token");
  });

  it("uses the tab-scoped support token without replacing the platform login", () => {
    localStorage.setItem("fms_token", "platform-token");
    sessionStorage.setItem("fms_support_token", "support-token");
    const config = { headers: {} };
    requestInterceptor(config);

    expect(config.headers.Authorization).toBe("Bearer support-token");
    expect(localStorage.getItem("fms_token")).toBe("platform-token");
  });

  it("schedules one shared success fallback for writes, but not reads or login", () => {
    responseInterceptor.fulfilled({ config: { method: "post", url: "/trips" } });
    responseInterceptor.fulfilled({ config: { method: "get", url: "/trips" } });
    responseInterceptor.fulfilled({ config: { method: "post", url: "/auth/login" } });

    expect(scheduleMutationSuccess).toHaveBeenCalledTimes(1);
    expect(scheduleMutationSuccess).toHaveBeenCalledWith("Trip created");
    expect(toast).not.toHaveBeenCalled();
    expect(publishDataChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/platform/tenants/tenant-1/support-session", "post"],
    ["/platform/support-session/end", "post"],
  ])("does not announce support-session control route %s as a business-data write", (url, method) => {
    responseInterceptor.fulfilled({ config: { method, url } });

    expect(scheduleMutationSuccess).not.toHaveBeenCalled();
    expect(publishDataChange).not.toHaveBeenCalled();
  });

  it("broadcasts successful tenant revisions without treating them as local refreshes", () => {
    responseInterceptor.fulfilled({
      config: { method: "patch", url: "/sites/site-1/trips/trip-1/lrs/lr-1" },
      headers: { "x-data-revision": "17" },
    });

    expect(publishDataChange).toHaveBeenCalledWith("17", { notifySelf: false });
  });

  it.each([
    ["post", "/sites/site-1/trips/trip-1/lrs", "LR created"],
    ["post", "/sites/site-1/trips/trip-1/lrs/lr-1/settlement", "Payment status updated"],
    ["post", "/sites/site-1/trips/trip-1/expenses", "Expense saved"],
    ["patch", "/sites/site-1/trips/trip-1?source=console", "Trip updated"],
    ["patch", "/sites/site-1", "Site updated"],
    ["post", "/custom/action", "Changes saved successfully."],
  ])("derives a success label for %s %s", (method, url, label) => {
    responseInterceptor.fulfilled({ config: { method, url } });

    expect(scheduleMutationSuccess).toHaveBeenCalledWith(label);
  });

  it("shows a global error toast for each failed write", async () => {
    const statusListener = jest.fn();
    window.addEventListener("fms:mutation-status", statusListener);
    const error = {
      config: { method: "put", url: "/trips/1" },
      response: { status: 400, data: { detail: "Trip date is required" } },
    };
    await expect(responseInterceptor.rejected(error)).rejects.toBe(error);
    expect(toast).toHaveBeenCalledWith("Trip date is required", "err", { apiError: true });
    expect(statusListener.mock.calls[0][0].detail).toEqual({
      state: "failed",
      key: "put:/trips/1",
      title: "Save failed · Trip updated",
      reason: "Trip date is required",
    });
    window.removeEventListener("fms:mutation-status", statusListener);
  });

  it("clears a persistent write failure after that same endpoint saves", () => {
    const statusListener = jest.fn();
    window.addEventListener("fms:mutation-status", statusListener);
    responseInterceptor.fulfilled({ config: { method: "put", url: "/trips/1" } });

    expect(statusListener.mock.calls[0][0].detail).toEqual({
      state: "saved",
      key: "put:/trips/1",
    });
    window.removeEventListener("fms:mutation-status", statusListener);
  });

  it("keeps validation messages useful and makes 5xx text safe and referenceable", () => {
    expect(errMsg({
      response: {
        status: 422,
        data: { detail: [{ loc: ["body", "owner", "name"], msg: "Field required", input: "private" }] },
      },
    })).toBe("owner.name: Field required");
    expect(errMsg({
      response: { status: 500, data: { detail: "database secret", reference_id: "abc123" } },
    })).toBe("The server couldn't complete this request. Please try again. Reference: abc123");
    expect(errMsg({
      response: {
        status: 409,
        data: { detail: {
          code: "receiver_match_confirmation_required",
          message: "A receiver with a similar name already exists.",
          matches: [{ id: "receiver-1", label: "Suresh" }],
        } },
      },
    })).toBe("A receiver with a similar name already exists.");
    expect(errMsg({ response: { status: 409, data: {} } })).toContain("HTTP 409");
  });
});
