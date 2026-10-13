import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import PartyNameManager from "./PartyNameManager";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), patch: jest.fn() },
  errMsg: (error) => error?.response?.data?.detail || "Request failed",
}));

describe("owner party suggestion management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
  });

  it("corrects a saved receiver and retires it while preserving audit reasons", async () => {
    let receiver = { name: "Ramesh Transport", phone: "1111111111" };
    api.get.mockImplementation(() => Promise.resolve({
      data: {
        senders: [],
        receivers: receiver ? [receiver] : [],
        has_more: { senders: false, receivers: false },
      },
    }));
    api.patch.mockImplementation((_path, body) => {
      receiver = body.retired ? null : { name: body.name, phone: body.phone };
      return Promise.resolve({ data: { updated: true } });
    });
    render(<PartyNameManager siteId="site-1" />);

    fireEvent.change(screen.getByLabelText("Search saved party names"), {
      target: { value: "ram" },
    });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      "/sites/site-1/party-names", { params: { q: "ram" } },
    ));
    await waitFor(() => expect(screen.getByLabelText("Correct receiver Ramesh Transport")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Correct receiver Ramesh Transport"), {
      target: { value: "Ramesh Transport Co" },
    });
    fireEvent.change(screen.getByLabelText("Phone for Ramesh Transport"), {
      target: { value: "2222222222" },
    });
    fireEvent.change(screen.getByLabelText("Suggestion change reason"), {
      target: { value: "Corrected spelling and phone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      "/sites/site-1/party-names",
      expect.objectContaining({
        role: "receiver", original_name: "Ramesh Transport",
        name: "Ramesh Transport Co", phone: "2222222222",
        reason: "Corrected spelling and phone",
      }),
    ));
    await waitFor(() => expect(screen.getByLabelText("Correct receiver Ramesh Transport Co")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith(
      "/sites/site-1/party-names",
      expect.objectContaining({
        role: "receiver", original_name: "Ramesh Transport Co",
        retired: true, reason: "Corrected spelling and phone",
      }),
    ));
    expect(window.confirm).toHaveBeenCalled();
  });
});
