import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Platform, {
  buildAdminAccessPreset, buildAdminAccessProfile, describeHistoryChanges, PlatformSettings,
} from "./Platform";
import { ADMIN_ACCESS_DEFAULTS } from "../lib/adminAccess";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";

jest.mock("../lib/hooks", () => ({ useFetch: jest.fn() }));
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  errMsg: () => "Request failed",
}));
jest.mock("recharts", () => ({
  Bar: () => null,
  BarChart: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const tenant = (id, name, licenseStatus = "Active", admins = [], licenseExpiry = "2099-12-31") => ({
  id,
  name,
  owner_name: `${name} owner`,
  owner_username: `${name.toLowerCase()}-owner`,
  email: "",
  city: "Pune",
  state: "Maharashtra",
  plan: "Business",
  plan_id: "business-plan",
  license_expiry: licenseExpiry,
  license_status: licenseStatus,
  admin_count: admins.length,
  admins,
  features: { trips: true, vehicles: true, parties: true, team: true, finance: true },
  stats: { trips: 2, lrs: 3, vehicles: 4, revenue: 500, last_activity: null },
});

const admin = {
  username: "fleet-admin",
  name: "Fleet Admin",
  active: true,
  admin_access: { ...ADMIN_ACCESS_DEFAULTS, booking_finance: false },
};

const summary = {
  plans: [
    {
      id: "booking-starter",
      name: "Booking Starter",
      description: "Booking operations",
      monthly_price: 1200,
      annual_price: 12000,
      access: {
        ...Object.fromEntries(Object.keys(ADMIN_ACCESS_DEFAULTS).map((key) => [key, false])),
        booking: true,
      },
      active: true,
    },
  ],
  totals: {
    licenses: 3, active: 2, suspended: 1, admins: 1, active_admins: 1, expiring: 0,
    revenue: 500,
  },
  tenants: [
    tenant("fleet-1", "Fleet One", "Active", [admin]),
    tenant("fleet-2", "Fleet Two", "Suspended"),
    tenant("fleet-3", "Fleet Three", "Active", [], "2020-01-01"),
  ],
};

const selectCustomer = (id) => {
  fireEvent.click(screen.getByTestId("tenant-filter-all"));
  fireEvent.click(screen.getByTestId(`manage-tenant-${id}`));
};

describe("platform client and access management", () => {
  beforeEach(() => {
    sessionStorage.removeItem("fms_support_token");
    api.post.mockReset();
    api.get.mockReset();
    api.put.mockReset();
    api.delete.mockReset();
    useFetch.mockReturnValue({
      data: summary,
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });
  });

  it("keeps the all-included access preset within the customer's saved subscription", () => {
    const access = buildAdminAccessPreset("all_included", summary.tenants[0].features, {
      booking: true,
      industrial_trips: true,
    });
    expect(access.booking).toBe(true);
    expect(access.industrial_trips).toBe(true);
    expect(access.booking_finance).toBe(false);
    expect(access.industrial_lrs).toBe(false);
  });

  it("reports requested profile permissions that the customer plan does not include", () => {
    const profile = buildAdminAccessProfile("finance_only", summary.tenants[0].features, {
      booking_finance: true,
      industrial_finance: false,
    });
    expect(profile.access.booking_finance).toBe(true);
    expect(profile.access.industrial_finance).toBe(false);
    expect(profile.notIncluded).toEqual([{
      key: "industrial_finance",
      label: "Industrial Finance",
      reason: "not included in this plan",
    }]);
  });

  it("shows excluded plan permissions when applying an access profile", () => {
    const restrictedTenant = {
      ...summary.tenants[0],
      subscription_access: {
        ...Object.fromEntries(Object.keys(ADMIN_ACCESS_DEFAULTS).map((key) => [key, false])),
        booking_finance: true,
      },
    };
    useFetch.mockReturnValue({
      data: { ...summary, tenants: [restrictedTenant, ...summary.tenants.slice(1)] },
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });

    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-users"));
    fireEvent.click(screen.getByTestId("access-profile-finance_only"));

    expect(screen.getByTestId("admin-access-booking_finance").checked).toBe(true);
    expect(screen.getByTestId("admin-access-industrial_finance").checked).toBe(false);
    expect(screen.getByTestId("access-profile-result").textContent)
      .toContain("Industrial Finance is not included in this plan");
  });

  it("filters the client directory by search and licence status", () => {
    render(<MemoryRouter><Platform /></MemoryRouter>);
    expect(screen.getByTestId("tenant-filter-attention").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("tenant-filter-all"));
    expect(screen.queryByTestId("manage-tenant-fleet-1")).not.toBeNull();
    expect(screen.queryByTestId("manage-tenant-fleet-2")).not.toBeNull();
    expect(screen.queryByTestId("manage-tenant-fleet-3")).not.toBeNull();

    fireEvent.change(screen.getByTestId("tenant-search"), { target: { value: "FLEET ONE-OWNER" } });
    expect(screen.queryByTestId("manage-tenant-fleet-1")).not.toBeNull();
    expect(screen.queryByTestId("manage-tenant-fleet-2")).toBeNull();

    fireEvent.change(screen.getByTestId("tenant-search"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("tenant-filter-suspended"));
    expect(screen.queryByTestId("manage-tenant-fleet-1")).toBeNull();
    expect(screen.queryByTestId("manage-tenant-fleet-2")).not.toBeNull();
    expect(screen.queryByTestId("manage-tenant-fleet-3")).toBeNull();

    fireEvent.click(screen.getByTestId("tenant-filter-expired"));
    expect(screen.queryByTestId("manage-tenant-fleet-2")).toBeNull();
    expect(screen.queryByTestId("manage-tenant-fleet-3")).not.toBeNull();
  });

  it("creates a licence with an optional contact email", async () => {
    const reload = jest.fn().mockResolvedValue(undefined);
    useFetch.mockReturnValue({
      data: summary,
      loading: false,
      error: null,
      reload,
    });
    api.post.mockResolvedValue({ data: { ok: true } });

    render(<MemoryRouter><Platform /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("new-tenant-btn"));

    fireEvent.change(screen.getByTestId("tenant-name"), { target: { value: "New Fleet" } });
    fireEvent.change(screen.getByTestId("tenant-owner"), { target: { value: "Fleet Owner" } });
    fireEvent.change(screen.getByTestId("tenant-username"), { target: { value: "fleet-owner" } });
    fireEvent.change(screen.getByTestId("tenant-password"), { target: { value: "secret123" } });
    expect(screen.getByTestId("tenant-email").required).toBe(false);
    fireEvent.change(screen.getByTestId("tenant-email"), { target: { value: "owner@example.com" } });
    fireEvent.click(screen.getByTestId("save-tenant"));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/platform/tenants",
      expect.objectContaining({
        name: "New Fleet",
        owner_name: "Fleet Owner",
        email: "owner@example.com",
      }),
    ));
  });

  it("lists attention cases and opens a selected customer workspace", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const expiring = tenant("fleet-expiring", "Fleet Expiring", "Active", [admin], soon.toISOString().slice(0, 10));
    const noPlan = {
      ...tenant("fleet-no-plan", "Fleet No Plan"), plan_id: "", subscription_access: null,
    };
    const noAdmin = tenant("fleet-no-admin", "Fleet No Admin");
    useFetch.mockReturnValue({
      data: { ...summary, tenants: [...summary.tenants, expiring, noPlan, noAdmin] },
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });

    render(<MemoryRouter><Platform /></MemoryRouter>);
    expect(screen.queryByTestId("manage-tenant-fleet-1")).toBeNull();
    expect(screen.getByTestId("manage-tenant-fleet-2")).not.toBeNull();
    expect(screen.getByTestId("manage-tenant-fleet-3")).not.toBeNull();
    expect(screen.getByTestId("manage-tenant-fleet-expiring")).not.toBeNull();
    expect(screen.getByTestId("manage-tenant-fleet-no-plan")).not.toBeNull();
    expect(screen.getByTestId("manage-tenant-fleet-no-admin")).not.toBeNull();
    expect(screen.getByTestId("manage-tenant-fleet-expiring").textContent).toContain("Expires in");
    expect(screen.getByTestId("manage-tenant-fleet-no-plan").textContent).toContain("No plan");
    expect(screen.getByTestId("manage-tenant-fleet-no-admin").textContent).toContain("No active admin");
    expect(screen.getByTestId("manage-tenant-fleet-2").textContent).toContain("Reactivate licence");
    expect(screen.getByTestId("manage-tenant-fleet-expiring").textContent).toContain("Review renewal");
    expect(screen.getByTestId("manage-tenant-fleet-no-plan").textContent).toContain("Assign a plan");
    fireEvent.click(screen.getByTestId("manage-tenant-fleet-no-plan"));
    expect(screen.getByTestId("customer-workspace")).not.toBeNull();
  });

  it("provides a focused renewal queue and opens the selected customer's renewal editor directly", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 12);
    const expiring = tenant("fleet-expiring", "Fleet Expiring", "Active", [admin], soon.toISOString().slice(0, 10));
    const expired = tenant("fleet-expired", "Fleet Expired", "Suspended", [admin], "2020-01-01");
    useFetch.mockReturnValue({
      data: { ...summary, tenants: [...summary.tenants, expiring, expired] },
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });

    render(<MemoryRouter><Platform /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("tenant-filter-renewal"));

    expect(screen.queryByTestId("manage-tenant-fleet-1")).toBeNull();
    expect(screen.getByTestId("renew-tenant-fleet-expiring").textContent).toContain("Review renewal");
    expect(screen.getByTestId("renew-tenant-fleet-expired").textContent).toContain("Renew expired licence");
    expect(screen.getByTestId("renew-tenant-fleet-expired").parentElement.textContent).toContain("Suspended licence");

    fireEvent.click(screen.getByTestId("renew-tenant-fleet-expiring"));
    expect(screen.getByTestId("customer-workspace").textContent).toContain("Fleet Expiring");
    expect(screen.getByRole("dialog", { name: "Edit subscription — Fleet Expiring" })).not.toBeNull();
  });

  it("opens the existing subscription date editor from the renewal action", async () => {
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("workspace-renew-fleet-1"));
    expect(screen.getByRole("dialog", { name: "Edit subscription — Fleet One" })).not.toBeNull();
    expect(screen.getByText("Plan and renewal")).not.toBeNull();
    expect(screen.getByText("What this subscription includes")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save subscription" })).not.toBeNull();
    fireEvent.change(screen.getByTestId("cust-expiry"), { target: { value: "2030-01-15" } });
    fireEvent.click(screen.getByTestId("save-customise"));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      "/platform/tenants/fleet-1/subscription",
      expect.objectContaining({ license_expiry: "2030-01-15" }),
    ));
  });

  it("shows the customer's licence lifecycle in the workspace", () => {
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    expect(screen.getByLabelText("Licence lifecycle").textContent).toContain("Active");
    expect(screen.getByLabelText("Licence lifecycle").textContent).toContain("Expiring soon");
    expect(screen.getByLabelText("Licence lifecycle").textContent).toContain("Expired");
  });

  it("keeps platform Booking setup available alongside customer admin access", async () => {
    const supportView = render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-booking-settings"));

    expect(await screen.findByTestId("platform-booking-settings")).not.toBeNull();
    expect(screen.getByText(/Platform support stays available alongside the customer's own access/)).not.toBeNull();

    useFetch.mockReturnValue({
      data: { ...summary, tenants: [summary.tenants[0], ...summary.tenants.slice(1)] },
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });
    supportView.rerender(<MemoryRouter><Platform /></MemoryRouter>);
    expect(screen.queryByTestId("customer-tab-booking-settings")).not.toBeNull();
    expect(screen.queryByTestId("platform-booking-settings")).not.toBeNull();
  });

  it("starts an explicit full-access support session for the selected customer", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
    api.post.mockResolvedValue({ data: { token: "support-token" } });
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("workspace-open-client-app"));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/platform/tenants/fleet-1/support-session",
    ));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("full platform support mode"));
    expect(sessionStorage.getItem("fms_support_token")).toBe("support-token");
    sessionStorage.removeItem("fms_support_token");
    confirm.mockRestore();
  });

  it("saves platform-managed business-wide receipt visibility", async () => {
    const supportTenant = {
      ...summary.tenants[0],
      admins: [{
        ...admin,
        admin_access: { ...ADMIN_ACCESS_DEFAULTS, booking_settings: false },
      }],
    };
    useFetch.mockReturnValue({
      data: { ...summary, tenants: [supportTenant, ...summary.tenants.slice(1)] },
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });
    api.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/receipt-controls")
        ? { sender_address_enabled: true, receiver_address_enabled: true, receiver_phone_enabled: true }
        : [],
    }));

    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-booking-settings"));
    const senderAddress = await screen.findByLabelText("Show sender address");
    fireEvent.click(senderAddress);
    fireEvent.click(screen.getByRole("button", { name: "Save visibility" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      "/platform/tenants/fleet-1/booking/receipt-controls",
      expect.objectContaining({ sender_address_enabled: false }),
    ));
  });

  it("creates a site manager and displays the one-time temporary credential", async () => {
    const supportTenant = {
      ...summary.tenants[0],
      admins: [{
        ...admin,
        admin_access: { ...ADMIN_ACCESS_DEFAULTS, booking_settings: false },
      }],
    };
    useFetch.mockReturnValue({
      data: { ...summary, tenants: [supportTenant, ...summary.tenants.slice(1)] },
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });
    api.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/sites") ? [{
        id: "site-1", name: "North Depot", code: "NORTH", status: "Active",
      }] : url.endsWith("/receipt-controls") ? {} : [],
    }));
    api.post.mockResolvedValue({
      data: { username: "site-lead", temporary_password: "one-time-secret" },
    });

    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-booking-settings"));
    fireEvent.change(await screen.findByLabelText(/Manager name/), {
      target: { value: "Site Lead" },
    });
    fireEvent.change(screen.getByLabelText(/Manager login ID/), {
      target: { value: "site-lead" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save manager access" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/platform/tenants/fleet-1/booking/sites/site-1/manager",
      expect.objectContaining({ name: "Site Lead", username: "site-lead" }),
    ));
    expect(await screen.findByText("one-time-secret")).not.toBeNull();
  });

  it("requires confirmation before suspending a customer", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("workspace-toggle-fleet-1"));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Suspend Fleet One"));
    expect(api.put).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("loads the selected client's admin and saves that admin's isolated access draft", async () => {
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-users"));

    expect(screen.queryByTestId("selected-admin-access")).not.toBeNull();
    expect(screen.getByTestId("select-admin-fleet-admin").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("admin-access-booking").checked).toBe(true);
    expect(screen.getByTestId("admin-access-industrial_trips").checked).toBe(true);

    fireEvent.click(screen.getByTestId("preset-all-included"));
    expect(screen.getByTestId("admin-access-booking").checked).toBe(true);
    expect(screen.getByTestId("admin-access-booking_finance").checked).toBe(true);
    expect(screen.getByTestId("admin-access-industrial_trips").checked).toBe(true);
    expect(screen.getByTestId("access-profile-booking_operator").getAttribute("aria-label"))
      .toContain("Booking dashboard, trips, receipts and ledger");

    fireEvent.click(screen.getByTestId("preset-industrial-trips-only"));
    expect(screen.getByTestId("admin-access-booking").checked).toBe(false);
    expect(screen.getByTestId("admin-access-industrial_trips").checked).toBe(true);
    expect(screen.getByTestId("admin-access-industrial_lrs").checked).toBe(false);
    api.put.mockResolvedValueOnce({
      data: { admin_access: buildAdminAccessPreset("industrial_trips_only", summary.tenants[0].features) },
    });
    fireEvent.click(screen.getByTestId("save-admin-access"));

    expect(api.put).toHaveBeenCalledWith(
      "/platform/tenants/fleet-1/admins/fleet-admin/access",
      { admin_access: buildAdminAccessPreset("industrial_trips_only", summary.tenants[0].features) },
    );
  });

  it("disables user grants that the customer subscription does not include", () => {
    const subscriptionAccess = Object.fromEntries(
      Object.keys(ADMIN_ACCESS_DEFAULTS).map((key) => [key, key === "booking"]),
    );
    const restrictedTenant = {
      ...summary.tenants[0],
      subscription_access: subscriptionAccess,
      admins: [{
        ...admin,
        admin_access: { ...ADMIN_ACCESS_DEFAULTS },
      }],
    };
    useFetch.mockReturnValue({
      data: { ...summary, tenants: [restrictedTenant, ...summary.tenants.slice(1)] },
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });

    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-users"));

    expect(screen.getByTestId("admin-access-booking").disabled).toBe(false);
    expect(screen.getByTestId("admin-access-industrial_trips").disabled).toBe(true);
    expect(screen.getByTestId("admin-access-industrial_trips").checked).toBe(false);
  });

  it("starts on an active admin and counts only effective grants", () => {
    const inactiveAdmin = {
      ...admin,
      username: "inactive-admin",
      active: false,
      admin_access: { ...ADMIN_ACCESS_DEFAULTS },
    };
    const restrictedTenant = {
      ...summary.tenants[0],
      features: { ...summary.tenants[0].features, trips: false },
      subscription_access: { ...ADMIN_ACCESS_DEFAULTS },
      admins: [inactiveAdmin, { ...admin, admin_access: { ...ADMIN_ACCESS_DEFAULTS } }],
    };
    useFetch.mockReturnValue({
      data: { ...summary, tenants: [restrictedTenant, ...summary.tenants.slice(1)] },
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });

    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-users"));

    expect(screen.getByTestId("select-admin-fleet-admin").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("select-admin-inactive-admin").textContent).toContain("12 enabled sections");
    expect(screen.getByTestId("admin-access-industrial_trips").disabled).toBe(true);
  });

  it("creates a plan template with reference prices and section entitlements", async () => {
    render(<MemoryRouter><Platform initialView="plans" /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("new-plan-btn"));
    fireEvent.change(screen.getByTestId("plan-name"), { target: { value: "Booking Plus" } });
    fireEvent.change(screen.getByTestId("plan-monthly-price"), { target: { value: "1500" } });
    fireEvent.click(screen.getByTestId("plan-access-booking"));
    fireEvent.click(screen.getByTestId("plan-access-booking_finance"));
    fireEvent.click(screen.getByTestId("save-plan"));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/platform/plans", expect.objectContaining({
      name: "Booking Plus",
      monthly_price: 1500,
      annual_price: null,
      access: expect.objectContaining({ booking: true, booking_finance: true }),
    })));
  });

  it("applies the selected plan as a customer-specific subscription snapshot", async () => {
    const setData = jest.fn();
    useFetch.mockReturnValue({
      data: summary,
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
      setData,
    });
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-subscription"));
    fireEvent.click(screen.getByTestId("edit-customer-subscription"));
    fireEvent.change(screen.getByLabelText("Subscription plan"), {
      target: { value: "booking-starter" },
    });
    api.put.mockResolvedValueOnce({
      data: {
        id: "fleet-1", subscription_access: summary.plans[0].access,
        features: { trips: false, vehicles: false, parties: false, team: false, finance: false },
      },
    });
    fireEvent.click(screen.getByTestId("save-customise"));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        "/platform/tenants/fleet-1/subscription",
        expect.objectContaining({
          plan_id: "booking-starter",
          plan: "Booking Starter",
          monthly_price: 1200,
          annual_price: 12000,
          access: summary.plans[0].access,
        }),
      );
      expect(setData).toHaveBeenCalledTimes(1);
    });
    const updatedSummary = setData.mock.calls[0][0](summary);
    expect(updatedSummary.tenants[0].subscription_access).toEqual(summary.plans[0].access);
    expect(updatedSummary.tenants[0].admins[0].admin_access).toEqual({
      ...Object.fromEntries(Object.keys(ADMIN_ACCESS_DEFAULTS).map((key) => [key, false])),
      booking: true,
    });
  });

  it("clears all entitlements when switching a customer to Custom", async () => {
    const assignedTenant = {
      ...summary.tenants[0],
      plan_id: "booking-starter",
      subscription_access: summary.plans[0].access,
    };
    useFetch.mockReturnValue({
      data: { ...summary, tenants: [assignedTenant, ...summary.tenants.slice(1)] },
      loading: false,
      error: null,
      reload: jest.fn().mockResolvedValue(undefined),
    });
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-subscription"));
    fireEvent.click(screen.getByTestId("edit-customer-subscription"));
    fireEvent.change(screen.getByLabelText("Subscription plan"), {
      target: { value: "" },
    });

    expect(screen.getByTestId("subscription-access-booking").checked).toBe(false);
    expect(screen.getByTestId("subscription-access-industrial_trips").checked).toBe(false);
    expect(screen.getByTestId("subscription-access-empty").textContent)
      .toContain("No sections included");

    api.put.mockResolvedValueOnce({
      data: {
        id: "fleet-1",
        subscription_access: Object.fromEntries(Object.keys(ADMIN_ACCESS_DEFAULTS).map((key) => [key, false])),
      },
    });
    fireEvent.click(screen.getByTestId("save-customise"));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      "/platform/tenants/fleet-1/subscription",
      expect.objectContaining({
        plan_id: null,
        plan: "Custom",
        access: Object.fromEntries(Object.keys(ADMIN_ACCESS_DEFAULTS).map((key) => [key, false])),
      }),
    ));
  });

  it("clears all entitlements for an already-custom customer", async () => {
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-subscription"));
    fireEvent.click(screen.getByTestId("edit-customer-subscription"));
    fireEvent.click(screen.getByTestId("clear-subscription-access"));

    expect(screen.getByTestId("subscription-access-booking").checked).toBe(false);
    expect(screen.getByTestId("subscription-access-industrial_trips").checked).toBe(false);
  });

  it("shows only the selected customer's saved change history", async () => {
    api.get.mockResolvedValue({ data: [{
      id: "event-1",
      summary: "Updated access for @fleet-admin.",
      actor: "platform-owner",
      created_at: "2026-10-10T01:00:00Z",
      details: { changed_sections: ["booking"] },
    }] });
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-history"));
    expect(await screen.findByText("Updated access for @fleet-admin.")).not.toBeNull();
    expect(api.get).toHaveBeenCalledWith("/platform/tenants/fleet-1/history");
  });

  it("explains subscription changes and the number of affected admins in plain language", async () => {
    api.get.mockResolvedValue({ data: [{
      id: "subscription-event",
      action: "subscription.updated",
      summary: "Updated subscription to Booking Starter.",
      actor: "platform-owner",
      created_at: "2026-10-10T01:00:00Z",
      details: {
        before: { access: { ...ADMIN_ACCESS_DEFAULTS, industrial_finance: true } },
        after: { access: { ...ADMIN_ACCESS_DEFAULTS, industrial_finance: false } },
        changed_sections: ["industrial_finance"],
        admins_clamped: 2,
      },
    }] });
    render(<MemoryRouter><Platform /></MemoryRouter>);
    selectCustomer("fleet-1");
    fireEvent.click(screen.getByTestId("customer-tab-history"));

    expect(await screen.findByText(/Removed from plan: Industrial Finance/)).not.toBeNull();
    expect(screen.getByText(/Access reduced for 2 admins/)).not.toBeNull();
  });
});

describe("business admin access presets", () => {
  it("uses clear labels for per-user section changes", () => {
    expect(describeHistoryChanges({
      action: "admin.access",
      details: {
        before: { booking: true, industrial_finance: true },
        after: { booking: false, industrial_finance: true },
        changed_sections: ["booking"],
      },
    })).toBe("Removed from this user: Booking Dashboard, Trips, Receipts & Ledger");
  });

  it("grants all Booking sections without enabling Industrial sections", () => {
    const result = buildAdminAccessPreset("full_booking");
    expect(Object.entries(result).filter(([key]) => key.startsWith("booking"))
      .every(([, enabled]) => enabled)).toBe(true);
    expect(Object.entries(result).filter(([key]) => key.startsWith("industrial"))
      .every(([, enabled]) => !enabled)).toBe(true);
  });

  describe("platform-wide settings", () => {
    it("separates customer and plan management from operating rules and platform activity", () => {
      useFetch.mockReturnValue({
        data: summary,
        loading: false,
        error: null,
        reload: jest.fn(),
      });
      render(<MemoryRouter><PlatformSettings /></MemoryRouter>);
      expect(screen.getByTestId("platform-settings-page")).not.toBeNull();
      expect(screen.getByTestId("platform-operating-rules")).not.toBeNull();
      expect(screen.getByTestId("platform-activity")).not.toBeNull();
      expect(screen.getByText(/Expiry dates and Active\/Suspended status are managed manually/)).not.toBeNull();
    });
  });

  it("grants only Industrial Trips and respects disabled licence modules", () => {
    const result = buildAdminAccessPreset("industrial_trips_only", { trips: false });
    expect(Object.entries(result).filter(([, enabled]) => enabled)).toEqual([]);
  });

  it("caps suggested access by a customer subscription", () => {
    const subscriptionAccess = Object.fromEntries(
      Object.keys(ADMIN_ACCESS_DEFAULTS).map((key) => [key, key === "booking"]),
    );
    const result = buildAdminAccessPreset("full_booking", {}, subscriptionAccess);
    expect(result.booking).toBe(true);
    expect(result.booking_finance).toBe(false);
  });

  it("clears all supported grants", () => {
    expect(Object.values(buildAdminAccessPreset("clear")).every((enabled) => !enabled)).toBe(true);
  });
});
