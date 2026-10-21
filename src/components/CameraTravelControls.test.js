import { fireEvent, render, screen } from "@testing-library/react";
import CameraTravelControls from "./CameraTravelControls";
import { cameraTravelSettings, DEFAULT_CAMERA_TRAVEL_SETTINGS, setCameraTravelSettings } from "./Viewport/cameraTravelSettings";

beforeEach(() => setCameraTravelSettings(DEFAULT_CAMERA_TRAVEL_SETTINGS));
afterEach(() => setCameraTravelSettings(DEFAULT_CAMERA_TRAVEL_SETTINGS));

test("travel tuning switches curves, saves slider changes, and resets", () => {
  render(<CameraTravelControls />);
  fireEvent.click(screen.getByText("Node travel"));
  fireEvent.change(screen.getByRole("combobox", { name: "Distance timing" }), { target: { value: "power" } });
  fireEvent.change(screen.getByRole("slider", { name: /Distance exponent/ }), { target: { value: "0.3" } });
  expect(cameraTravelSettings.exponent).toBe(0.3);
  expect(JSON.parse(localStorage.getItem("parsegraph-node-travel")).curve).toBe("power");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "constant" } });
  expect(screen.queryByRole("slider", { name: /Distance exponent/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reset travel" }));
  expect(cameraTravelSettings).toEqual(DEFAULT_CAMERA_TRAVEL_SETTINGS);
});
