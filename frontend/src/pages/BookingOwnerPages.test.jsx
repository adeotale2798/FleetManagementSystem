import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { api } from "../lib/api";
import { exportCSV } from "../lib/export";
import BookingAudit from "./BookingAudit";
import BookingFinance from "./BookingFinance";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalResizeObserver = globalThis.ResizeObserver;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  errMsg: () => "Request failed",
}));
jest.mock("../lib/export", () => ({ exportCSV: jest.fn() }));

const site = { id: "site-1", name: "Mama Garage" };
const finance = {
  site,
  totals: {
    grand_total: "112.00", recorded_bhada: "100.00", recorded_hamali: "10.00",
    recorded_receipt_fees: "2.00", collected_bhada: "25.00", outstanding_bhada: "77.00",
    collectible_outstanding_bhada: "77.00", receipt_count: 1,
    unpaid_receipts: 1, pending_orders: 0, unpriced_receipts: 0,
  },
  basis: "Grand total includes Bhada, Hamali and receipt fees. Payments include posted payments and reversals.",
  receiver_balances: [{
    receiver_label: "Suresh", receiver_name: "Suresh", receipt_count: 1,
    charges: "102.00", collected: "25.00", outstanding: "77.00",
  }],
  rows: [{
    id: "lr-1", site_id: site.id, trip_id: "trip-1", lr_ref: "NGP-LR-01",
    trip_ref: "NGP29092026-01", receipt_date: "2026-09-29",
    receiver_name: "Suresh", goods: "Cement", rent: "100.00", receipt_fee: "2.00",
    hamali: "10.00", total: "112.00", paid: "25.00", outstanding: "77.00",
    age_days: 45, payment_status: "partial", reconciled: true, promised_date: "", followup_note: "",
    next_contact_date: "", followup_outcome: "",
  }],
};

describe("owner-only booking pages", () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/booking-finance`) return Promise.resolve({ data: finance });
      if (path === `/sites/${site.id}/audit`) return Promise.resolve({ data: { rows: [{
        id: "event-1", action: "lr.unvoided", target_type: "lr",
        actor_name: "Business Owner", actor_role: "owner",
        created_at: "2026-09-29T12:00:00Z", reason: "Restored by mistake",
        old_values: { voided: true }, new_values: { voided: false },
      }] } });
      return Promise.resolve({ data: {} });
    });
    api.post.mockResolvedValue({ data: { status: "paid" } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
    else delete globalThis.ResizeObserver;
  });

  const render = async (Page, role = "owner") => {
    await act(async () => {
      root.render(<MemoryRouter><Page user={{ role }} /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it("visualizes finance and settles a receipt's pending Bhada", async () => {
    await render(BookingFinance);
    expect(container.textContent).toContain("Largest receiver balances");
    expect(container.textContent).toContain("Suresh");
    expect(container.textContent).toContain("₹77");
    expect(container.textContent).toContain("25% collected");
    expect(container.querySelector('[aria-label="Finance charts"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Bar chart of outstanding amounts grouped by receipt age"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Finance attention items"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Filter finance receipts"]')).not.toBeNull();
    expect(container.querySelectorAll("select")).toHaveLength(2);
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Settle full pending amount")).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.post).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/trip-1/lrs/lr-1/settlement`,
      expect.objectContaining({ received: true, idempotency_key: expect.any(String) }),
    );
    expect(container.textContent).toContain("Payment recorded");
  });

  it("filters the prioritized follow-up list to order checks", async () => {
    const responseWithPendingOrder = {
      ...finance,
      rows: [...finance.rows, {
        ...finance.rows[0], id: "lr-2", lr_ref: "NGP-LR-02", reconciled: false,
        outstanding: "30.00", age_days: 12, promised_date: "",
      }],
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/booking-finance`) {
        return Promise.resolve({ data: responseWithPendingOrder });
      }
      return Promise.resolve({ data: {} });
    });

    await render(BookingFinance);
    const filter = container.querySelector('[aria-label="Filter finance receipts"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")
        .set.call(filter, "order-check");
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("NGP-LR-02");
    expect(container.textContent).not.toContain("NGP-LR-01");
  });

  it("marks overdue unpaid promises and explains collectible balances", async () => {
    const overdue = {
      ...finance,
      rows: [{ ...finance.rows[0], promised_date: "2000-01-01" }],
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/booking-finance`) return Promise.resolve({ data: overdue });
      return Promise.resolve({ data: {} });
    });
    await render(BookingFinance);

    expect(container.textContent).toContain("Overdue payments");
    expect(container.textContent).toContain("Promise overdue");
    expect(container.textContent).toContain("pending order checks are not confirmed receivables");
    expect(container.textContent).toContain("Outstanding includes all priced receipts");
  });

  it("uses the configured day threshold for booking payment overdue status", async () => {
    const thresholdFinance = {
      ...finance,
      overdue_after_days: 5,
      rows: [4, 5, 6].map((age, index) => ({
        ...finance.rows[0], id: `lr-${index + 1}`, lr_ref: `NGP-LR-0${index + 1}`,
        age_days: age, promised_date: "",
      })),
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/booking-finance`) return Promise.resolve({ data: thresholdFinance });
      return Promise.resolve({ data: {} });
    });

    await render(BookingFinance);
    expect(container.textContent).toContain("2 unpaid receipt(s) are 5+ days old");
    expect(Array.from(container.querySelectorAll("span"))
      .filter((span) => span.textContent === "Payment overdue")).toHaveLength(2);

    const filter = container.querySelector('[aria-label="Filter finance receipts"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")
        .set.call(filter, "overdue");
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("NGP-LR-02");
    expect(container.textContent).toContain("NGP-LR-03");
    expect(container.textContent).not.toContain("NGP-LR-01");
  });

  it("saves next contact and outcome and exports the current summary and filtered rows", async () => {
    api.patch.mockResolvedValue({ data: {
      promised_date: "", note: "", next_contact_date: "2026-10-04", outcome: "No answer",
    } });
    await render(BookingFinance);
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Update follow-up").click();
    });
    const nextContact = container.querySelector('[aria-label="NGP-LR-01 next contact date"]');
    const outcome = container.querySelector('[aria-label="NGP-LR-01 follow-up outcome"]');
    const setInput = (input, value) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setInput(nextContact, "2026-10-04");
      setInput(outcome, "No answer");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Save follow-up").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.patch).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/trip-1/lrs/lr-1/followup`,
      expect.objectContaining({ next_contact_date: "2026-10-04", outcome: "No answer" }),
    );

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Site summary CSV")).click();
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Filtered receipts CSV")).click();
    });
    expect(exportCSV).toHaveBeenCalledTimes(2);
    expect(exportCSV.mock.calls[0][0]).toContain("summary");
    expect(exportCSV.mock.calls[0][2]).toContainEqual(
      expect.objectContaining({ metric: expect.stringContaining("Collectible now") }),
    );
    expect(exportCSV.mock.calls[1][2]).toHaveLength(1);
    expect(exportCSV.mock.calls[1][2][0]).toEqual(expect.objectContaining({
      lr_ref: "NGP-LR-01", reconciled: "Yes",
    }));
    expect(container.textContent).toContain("Next contact 04-10-2026");
    expect(container.textContent).toContain("No answer");
  });

  it("keeps receipt details collapsed until requested and groups exports with receipt filters", async () => {
    await render(BookingFinance);
    expect(container.querySelector("details").open).toBe(false);
    expect(container.textContent).toContain("amount due");
    expect(container.textContent).toContain("Update follow-up");
    expect(container.querySelector('[aria-label="Filter finance receipts"]')).not.toBeNull();
    expect(container.textContent).toContain("Site summary CSV");
    expect(container.textContent).toContain("Filtered receipts CSV");
    expect(container.querySelectorAll('[aria-label="Finance charts"] .h-44')).toHaveLength(3);
  });

  it("shows concise restore audit history and requests only recent events", async () => {
    await render(BookingAudit);
    expect(container.textContent).toContain("Booking Audit");
    expect(container.textContent).toContain("Receipt restored");
    expect(container.textContent).toContain("Business Owner");
    expect(container.textContent).toContain("Restored by mistake");
    expect(api.get).toHaveBeenCalledWith(`/sites/${site.id}/audit`, {
      params: { limit: 25, offset: 0 },
    });
  });

  it("does not render owner finance or audit data for managers", async () => {
    await render(BookingFinance, "site_manager");
    expect(container.textContent).toContain("Booking Finance is available to the business owner only.");
    expect(container.textContent).not.toContain("Bhada by receiver");

    await act(async () => {
      root.render(<MemoryRouter><BookingAudit user={{ role: "site_manager" }} /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Booking Audit is available to the business owner only.");
    expect(container.textContent).not.toContain("Recent activity");
  });
});
