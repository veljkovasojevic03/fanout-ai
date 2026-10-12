import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field } from "./field";
import { Input } from "./input";

describe("Field", () => {
  it("associates the label and hint with the control", () => {
    render(
      <Field label="Topic" hint="Max 300 characters">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Topic");
    expect(input).toHaveAccessibleDescription("Max 300 characters");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("marks the control invalid and describes it by the error instead of the hint", () => {
    render(
      <Field label="Topic" hint="Max 300 characters" error="A topic is required.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Topic");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("A topic is required.");
    expect(screen.getByRole("alert")).toHaveTextContent("A topic is required.");
    expect(screen.queryByText("Max 300 characters")).not.toBeInTheDocument();
  });

  it("lets explicit props on the control win over the field defaults", () => {
    render(
      <Field label="Topic">
        <Input id="custom-id" aria-invalid />
      </Field>,
    );
    expect(document.getElementById("custom-id")).toHaveAttribute("aria-invalid", "true");
  });

  it("leaves a standalone control untouched", () => {
    render(<Input aria-label="Search" />);
    const input = screen.getByRole("textbox", { name: "Search" });
    expect(input).not.toHaveAttribute("id");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});
