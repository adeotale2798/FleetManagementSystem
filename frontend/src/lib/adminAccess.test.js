import { firstAdminRoute, hasAdminAccess } from "./adminAccess";

const owner = (admin_access, features = {}) => ({
  role: "owner",
  admin_access,
  features,
});

test("legacy owners without a saved access record keep existing access", () => {
  expect(hasAdminAccess(owner(null), "booking")).toBe(true);
  expect(hasAdminAccess(owner(undefined), "industrial_finance")).toBe(true);
});

test("explicit access records deny missing and disabled grants", () => {
  expect(hasAdminAccess(owner({ booking: true }), "booking")).toBe(true);
  expect(hasAdminAccess(owner({ booking: true }), "booking_finance")).toBe(false);
  expect(hasAdminAccess(owner({ booking: false }), "booking")).toBe(false);
});

test("an admin grant cannot exceed the tenant subscription", () => {
  expect(hasAdminAccess(
    owner({ industrial_trips: true }, { trips: false }),
    "industrial_trips",
  )).toBe(false);
  expect(hasAdminAccess(
    { ...owner({ booking: true }), tenant_access: { booking: false } },
    "booking",
  )).toBe(false);
});

test("site managers require Booking to be included in the customer subscription", () => {
  expect(hasAdminAccess({ role: "site_manager", tenant_access: { booking: true } }, "booking"))
    .toBe(true);
  expect(hasAdminAccess({ role: "site_manager", tenant_access: { booking: false } }, "booking"))
    .toBe(false);
});

test("the landing route is the first enabled section", () => {
  expect(firstAdminRoute(owner({
    booking: false,
    industrial_dashboard: false,
    industrial_trips: true,
  }))).toBe("/trips?tab=trips");
  expect(firstAdminRoute(owner({ booking: false }))).toBe("/access-required");
});
