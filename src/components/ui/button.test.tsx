import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Generate</Button>);
    expect(screen.getByRole("button", { name: "Generate" })).toHaveAttribute("type", "button");
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Generate</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("blocks interaction and announces busy while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Generating
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Generating" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders its child element when asChild is set", () => {
    render(
      <Button asChild variant="secondary">
        <a href="/design">Design</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Design" });
    expect(link).toHaveAttribute("href", "/design");
    expect(link.className).toContain("bg-elevated");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
