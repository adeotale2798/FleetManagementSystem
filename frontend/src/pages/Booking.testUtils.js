import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../lib/api";
import Booking from "./Booking";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export const site = { id: "site-1", name: "Mama Garage", code: "NGP" };
export const trip = {
  id: "trip-1", site_id: site.id, trip_ref: "NGP29092026-01",
  operating_date: "2026-09-29", truck_no: "", driver_name: "", status: "open",
};

export const flushMicrotasks = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

export const createLedgerRow = (overrides = {}) => ({
  id: "lr-1", site_id: site.id, trip_id: trip.id, trip_ref: trip.trip_ref,
  trip_status: "open", lr_ref: "NGP-LR-01", receipt_date: trip.operating_date,
  sender_name: "Sender", receiver_name: "Receiver", rent: "100.00",
  hamali: "0.00", total_rent: "100.00", goods_rows: [], updated_at: "version-1",
  ...overrides,
});

export function registerBookingTestHarness() {
  const container = document.createElement("div");
  let root;

  const getByLabelText = (label, scope = container) => {
    return scope === container
      ? screen.getByLabelText(label)
      : within(scope).getByLabelText(label);
  };

  const getByRole = (role, name, scope = container) => {
    const matcher = typeof name === "string"
      ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : name;
    return scope === container
      ? screen.getByRole(role, { name: matcher })
      : within(scope).getByRole(role, { name: matcher });
  };

  const clickButton = async (name, scope = container) => {
    const user = userEvent.setup();
    await user.click(getByRole("button", name, scope));
    await flushMicrotasks();
  };

  const mockBookingApi = ({
    sites = [site], trips = [], ledgerRows = [], receipts = [], tripData = trip,
  } = {}) => {
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: sites });
      if (path === `/sites/${site.id}/trips`) {
        return Promise.resolve({ data: { rows: trips, total: trips.length } });
      }
      if (path === `/sites/${site.id}/ledger/entries`) {
        return Promise.resolve({ data: { rows: ledgerRows, total: ledgerRows.length } });
      }
      if (path === `/sites/${site.id}/party-suggestions`) {
        return Promise.resolve({ data: { senders: [], receivers: [] } });
      }
      if (path === `/sites/${site.id}/trips/${trip.id}/lrs`) {
        return Promise.resolve({ data: { rows: receipts, total: receipts.length } });
      }
      return Promise.resolve({ data: tripData });
    });
  };

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    mockBookingApi();
    api.post.mockResolvedValue({ data: trip });
    api.delete.mockResolvedValue({ data: { deleted: true, id: trip.id } });
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    jest.useRealTimers();
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  const renderBooking = async (section = "dashboard", role = "site_manager") => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[`/booking/${section}`]}>
        <Routes><Route path="/booking/:section" element={<Booking user={{
          role, name: role === "owner" ? "Owner Name" : "Manager Name",
          site_permissions: {
            [site.id]: ["trips:read", "trips:create", "trips:update", "lrs:read", "lrs:create", "lrs:update"],
          },
        }} />} /></Routes>
      </MemoryRouter>);
      await flushMicrotasks();
    });
  };

  const clearBooking = async () => {
    await act(async () => root.render(null));
  };

  const setInput = (labelOrSelector, value, occurrence = 0) => {
    const label = labelOrSelector.match(/^\[aria-label="(.+)"\]$/)?.[1] || labelOrSelector;
    const matches = Array.from(container.querySelectorAll("[aria-label]"))
      .filter((element) => element.getAttribute("aria-label") === label);
    const input = occurrence === 0 ? getByLabelText(label) : matches[occurrence];
    if (!input) throw new Error(`Unable to find an input with the accessible label "${label}".`);
    fireEvent.change(input, { target: { value } });
  };

  return {
    get container() { return container; },
    site,
    trip,
    flushMicrotasks,
    getByLabelText,
    getByRole,
    clickButton,
    createLedgerRow,
    mockBookingApi,
    renderBooking,
    clearBooking,
    setInput,
  };
}
