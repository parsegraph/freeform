import { fireEvent, render, screen } from "@testing-library/react";
import MousePanControls from "./MousePanControls";
import ViewportPan from "./Viewport/ViewportPan";
import {
  DEFAULT_MOUSE_PAN_SETTINGS,
  LIGHTER_MOUSE_PAN_SETTINGS,
  mousePanSettings,
  setMousePanSettings,
} from "./Viewport/mousePanSettings";

beforeEach(() => setMousePanSettings(DEFAULT_MOUSE_PAN_SETTINGS));
afterEach(() => setMousePanSettings(DEFAULT_MOUSE_PAN_SETTINGS));

test("a slider tunes the active drag controller and saves the value", () => {
  const adjustOrigin = jest.fn();
  const pan = new ViewportPan({
    camera: () => ({ scale: () => 1, adjustOrigin }),
    refresh: jest.fn(),
  });
  render(<MousePanControls />);
  fireEvent.click(screen.getByText("Mouse feel"));
  fireEvent.change(screen.getByRole("slider", { name: /Drag speed/ }), { target: { value: "2.2" } });
  pan.beginDrag();
  pan.dragBy(10, 5);
  expect(adjustOrigin).toHaveBeenCalledWith(22, 11);
  expect(JSON.parse(localStorage.getItem("parsegraph-mouse-feel")).dragSpeed).toBe(2.2);
  pan.stop();
});

test("Lighter and Reset update every control", () => {
  render(<MousePanControls />);
  fireEvent.click(screen.getByText("Mouse feel"));
  fireEvent.click(screen.getByRole("button", { name: "Lighter" }));
  expect(mousePanSettings).toEqual(LIGHTER_MOUSE_PAN_SETTINGS);
  expect(screen.getByRole("slider", { name: /Friction/ })).toHaveValue("4.5");
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(mousePanSettings).toEqual(DEFAULT_MOUSE_PAN_SETTINGS);
  expect(screen.getByRole("slider", { name: /Friction/ })).toHaveValue("8");
});
