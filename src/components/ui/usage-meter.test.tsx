import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UsageMeter, usageLevel } from "./usage-meter";

describe("usageLevel", () => {
  it.each([
    [0, 5, "ok"],
    [3, 5, "ok"],
    [4, 5, "low"],
    [5, 5, "exhausted"],
    [9, 5, "exhausted"],
    [0, 0, "exhausted"],
    [79, 100, "ok"],
    [80, 100, "low"],
  ] as const)("%i of %i is %s", (used, limit, expected) => {
    expect(usageLevel(used, limit)).toBe(expected);
  });
});

describe("UsageMeter", () => {
  it("exposes the quota as an accessible progressbar", () => {
    render(<UsageMeter used={2} limit={5} label="2 of 5 generations used" />);
    const bar = screen.getByRole("progressbar", { name: "2 of 5 generations used" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
  });

  it("clamps the bar when usage exceeds the limit but still shows the real count", () => {
    const { container } = render(<UsageMeter used={7} limit={5} label="over" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
    expect(container).toHaveTextContent("7/5");
    expect(container.querySelector("[data-level]")).toHaveAttribute("data-level", "exhausted");
  });

  it("can hide the counter", () => {
    const { container } = render(<UsageMeter used={1} limit={3} label="x" hideCount />);
    expect(container).not.toHaveTextContent("1/3");
  });
});
