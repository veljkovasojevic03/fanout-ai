import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublishOptions } from "@/lib/publish/actions";
import type { JobView } from "@/lib/publish/schema";
import { dayKey, monthGrid } from "@/lib/publish/time";

import en from "../../../messages/en.json";

import { CalendarView, type CalendarJob } from "./calendar-view";
import { DestinationsSection } from "./destinations-section";
import { PublishButton } from "./publish-dialog";

const actions = vi.hoisted(() => ({
  getPublishOptionsAction: vi.fn(),
  createPublishJobAction: vi.fn(),
  updatePublishJobAction: vi.fn(),
  cancelPublishJobAction: vi.fn(),
  retryPublishJobAction: vi.fn(),
  addDiscordDestinationAction: vi.fn(),
  removeDestinationAction: vi.fn(),
  testDestinationAction: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock("@/lib/publish/actions", () => actions);
vi.mock("@/components/ui/toast", () => ({ toast: toasts }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const ZONE = "Europe/Belgrade";
const NOW = new Date("2027-06-10T10:00:00Z");
const CONTENT = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";
const DISCORD = "0b9d7c1e-2a34-4c56-8d7e-9f0a1b2c3d4e";

const ui = (children: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone={ZONE} now={NOW}>
      {children}
    </NextIntlClientProvider>,
  );

const options = (overrides: Partial<PublishOptions> = {}): PublishOptions => ({
  email: "me@example.com",
  emailVerified: true,
  destinations: [
    { id: DISCORD, kind: "discord", label: "Team", hint: "discord.com/…/5678/••••1234" },
  ],
  mode: "simulated",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  actions.getPublishOptionsAction.mockResolvedValue({ ok: true, options: options() });
});

describe("PublishButton", () => {
  const open = async (props: Partial<React.ComponentProps<typeof PublishButton>> = {}) => {
    ui(<PublishButton contentId={CONTENT} title="My post" guest={false} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    return screen.findByRole("dialog");
  };

  it("shows guests the upgrade state and never asks the server for anything", async () => {
    const dialog = await open({ guest: true });

    expect(within(dialog).getByText("Upgrade to publish")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Create a free account/ })).toHaveAttribute(
      "href",
      "/app/upgrade",
    );
    expect(within(dialog).queryByRole("button", { name: "Publish now" })).toBeNull();
    expect(actions.getPublishOptionsAction).not.toHaveBeenCalled();
  });

  it("publishes now to the account's email by default, and says when it was simulated", async () => {
    actions.createPublishJobAction.mockResolvedValue({
      ok: true,
      jobId: "job",
      status: "published",
      simulated: true,
      error: null,
    });
    const dialog = await open();

    // The simulated mode is announced before anything is sent.
    expect(await within(dialog).findByText(/publishing is simulated/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish now" }));

    await waitFor(() =>
      expect(actions.createPublishJobAction).toHaveBeenCalledWith({
        contentId: CONTENT,
        destination: "email",
        scheduledAt: null,
      }),
    );
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith(
        "Published (simulated — nothing was actually sent)",
        expect.anything(),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("schedules in the user's time zone and sends the instant in UTC", async () => {
    actions.createPublishJobAction.mockResolvedValue({
      ok: true,
      jobId: "job",
      status: "scheduled",
      simulated: false,
      error: null,
    });
    const dialog = await open();

    fireEvent.click(await within(dialog).findByRole("radio", { name: "Schedule" }));
    const input = within(dialog).getByLabelText("Date and time") as HTMLInputElement;
    // Default: an hour from now, in Belgrade time (UTC+2 in June).
    expect(input.value).toBe("2027-06-10T13:00");
    expect(within(dialog).getByText(`In your time zone (${ZONE}).`)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "2027-06-12T09:30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Schedule" }));

    await waitFor(() =>
      expect(actions.createPublishJobAction).toHaveBeenCalledWith({
        contentId: CONTENT,
        destination: "email",
        scheduledAt: "2027-06-12T07:30:00.000Z",
      }),
    );
  });

  it("refuses a time in the past without calling the server", async () => {
    const dialog = await open();

    fireEvent.click(await within(dialog).findByRole("radio", { name: "Schedule" }));
    fireEvent.change(within(dialog).getByLabelText("Date and time"), {
      target: { value: "2027-06-10T11:00" },
    });

    expect(within(dialog).getByText("Pick a time in the future.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Schedule" })).toBeDisabled();
    expect(actions.createPublishJobAction).not.toHaveBeenCalled();
  });

  it("saves first, and does not publish when the save fails", async () => {
    const beforeSubmit = vi.fn().mockResolvedValue(false);
    const dialog = await open({ beforeSubmit });

    fireEvent.click(await within(dialog).findByRole("button", { name: "Publish now" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Save your changes first");
    expect(beforeSubmit).toHaveBeenCalledOnce();
    expect(actions.createPublishJobAction).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    actions.createPublishJobAction.mockResolvedValue({ ok: false, code: "rate_limited" });
    const dialog = await open();

    fireEvent.click(await within(dialog).findByRole("button", { name: "Publish now" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("going a bit fast");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("reports a failed delivery with its reason", async () => {
    actions.createPublishJobAction.mockResolvedValue({
      ok: true,
      jobId: "job",
      status: "failed",
      simulated: false,
      error: "n8n_rejected:404",
    });
    const dialog = await open();

    fireEvent.click(await within(dialog).findByRole("button", { name: "Publish now" }));

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "Publishing failed: The delivery service refused the request. (HTTP 404)",
        expect.anything(),
      ),
    );
  });

  it("shows why the destinations could not be loaded", async () => {
    actions.getPublishOptionsAction.mockResolvedValue({ ok: false, code: "unauthenticated" });
    const dialog = await open();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("session has ended");
    expect(within(dialog).queryByRole("button", { name: "Publish now" })).toBeNull();
  });

  it("falls back to a Discord channel when the email address is not verified", async () => {
    actions.getPublishOptionsAction.mockResolvedValue({
      ok: true,
      options: options({ emailVerified: false }),
    });
    actions.createPublishJobAction.mockResolvedValue({
      ok: true,
      jobId: "job",
      status: "processing",
      simulated: false,
      error: null,
    });
    const dialog = await open();

    expect(await within(dialog).findByText(/needs a verified account address/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish now" }));

    await waitFor(() =>
      expect(actions.createPublishJobAction).toHaveBeenCalledWith(
        expect.objectContaining({ destination: DISCORD }),
      ),
    );
  });

  it("has nothing to publish to with an unverified address and no channels", async () => {
    actions.getPublishOptionsAction.mockResolvedValue({
      ok: true,
      options: options({ emailVerified: false, destinations: [] }),
    });
    const dialog = await open();

    expect(await within(dialog).findByText(/nowhere to publish to yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Publish now" })).toBeDisabled();
  });

  it("names the piece in an icon-only button", () => {
    ui(<PublishButton contentId={CONTENT} title="My post" guest={false} iconOnly />);
    expect(screen.getByRole("button", { name: "Publish “My post”" })).toBeInTheDocument();
  });
});

describe("CalendarView", () => {
  const MONTH = { year: 2027, month: 6 };
  const DAYS = monthGrid(MONTH, 0);

  const job = (overrides: Partial<JobView> = {}): JobView => ({
    id: "00000000-0000-4000-8000-000000000001",
    status: "scheduled",
    scheduledAt: "2027-06-15T07:30:00Z",
    publishedAt: null,
    attempts: 0,
    lastError: null,
    simulated: false,
    content: { id: CONTENT, title: "Launch post", type: "linkedin" },
    destination: { id: "email-id", kind: "email", label: "Email" },
    attemptsLog: [],
    ...overrides,
  });

  const placed = (value: JobView): CalendarJob => ({
    ...value,
    day: dayKey(new Date(value.scheduledAt), ZONE),
  });

  const view = (jobs: JobView[], props: Partial<React.ComponentProps<typeof CalendarView>> = {}) =>
    ui(
      <CalendarView
        month={MONTH}
        days={DAYS}
        today="2027-06-10"
        jobs={jobs.map(placed)}
        failed={jobs.filter((item) => item.status === "failed")}
        destinations={[]}
        email="me@example.com"
        emailVerified
        mode="n8n"
        {...props}
      />,
    );

  it("puts a job on the day it falls on in the user's zone", () => {
    // 22:30 UTC on the 15th is 00:30 on the 16th in Belgrade.
    view([job({ scheduledAt: "2027-06-15T22:30:00Z" })]);
    const grid = screen.getByRole("list", { name: "Days of June 2027" });

    expect(
      within(grid).getByRole("button", { name: "Wednesday, June 16, 1 item" }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole("button", { name: "Tuesday, June 15, nothing scheduled" }),
    ).toBeInTheDocument();
  });

  it("names the status in every chip, not only by colour", () => {
    view([
      job(),
      job({ id: "00000000-0000-4000-8000-000000000002", status: "published", simulated: true }),
    ]);
    const grid = screen.getByRole("list", { name: "Days of June 2027" });

    expect(
      within(grid).getByRole("button", { name: /Launch post — Scheduled/ }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole("button", { name: /Launch post — Published/ }),
    ).toBeInTheDocument();
  });

  it("lists the selected day's jobs, and says so when a day is empty", () => {
    view([job()]);

    // Today (the 10th) is selected to begin with, and has nothing.
    expect(screen.getByText("Nothing is scheduled on this day.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tuesday, June 15, 1 item" }));
    const panel = screen.getByRole("region", { name: "Tuesday, June 15" });
    expect(within(panel).getByText("Launch post")).toBeInTheDocument();
    expect(within(panel).getByText(/to Email/)).toBeInTheDocument();
  });

  it("opens a scheduled job with its time in the user's zone, and reschedules in UTC", async () => {
    actions.updatePublishJobAction.mockResolvedValue({ ok: true });
    view([job()]);

    fireEvent.click(
      within(screen.getByRole("list", { name: "Days of June 2027" })).getByRole("button", {
        name: /Launch post — Scheduled/,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Date and time") as HTMLInputElement;
    expect(input.value).toBe("2027-06-15T09:30");
    // Nothing changed yet: nothing to save.
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "2027-06-20T18:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(actions.updatePublishJobAction).toHaveBeenCalledWith({
        jobId: job().id,
        scheduledAt: "2027-06-20T16:00:00.000Z",
        destination: null,
      }),
    );
  });

  it("cancels a scheduled job", async () => {
    actions.cancelPublishJobAction.mockResolvedValue({ ok: true });
    view([job()]);

    fireEvent.click(
      within(screen.getByRole("list", { name: "Days of June 2027" })).getByRole("button", {
        name: /Launch post — Scheduled/,
      }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel job" }),
    );

    await waitFor(() =>
      expect(actions.cancelPublishJobAction).toHaveBeenCalledWith({ jobId: job().id }),
    );
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Job cancelled"));
  });

  it("surfaces failed jobs with the reason, the attempt log and Retry", async () => {
    actions.retryPublishJobAction.mockResolvedValue({
      ok: true,
      jobId: "job",
      status: "published",
      simulated: false,
      error: null,
    });
    const failed = job({
      status: "failed",
      attempts: 1,
      lastError: "delivery_failed:429",
      attemptsLog: [
        {
          id: "a1",
          startedAt: "2027-06-15T07:30:01Z",
          finishedAt: "2027-06-15T07:30:03Z",
          ok: false,
          detail: "delivery_failed:429",
        },
      ],
    });
    view([failed]);

    const attention = screen.getByRole("region", { name: "Needs attention" });
    fireEvent.click(within(attention).getByRole("button", { name: /Launch post — Failed/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "The destination did not accept the message. (HTTP 429)",
    );
    expect(within(dialog).getByText("Attempt 1")).toBeInTheDocument();
    // A failed job cannot be rescheduled; it can be retried.
    expect(within(dialog).queryByLabelText("Date and time")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Retry now" }));
    await waitFor(() =>
      expect(actions.retryPublishJobAction).toHaveBeenCalledWith({ jobId: failed.id }),
    );
  });

  it("offers no retry once every attempt is used", async () => {
    const spent = job({ status: "failed", attempts: 5, lastError: "timeout" });
    view([spent]);

    fireEvent.click(
      within(screen.getByRole("region", { name: "Needs attention" })).getByRole("button", {
        name: /Launch post — Failed/,
      }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("button", { name: "Retry now" })).toBeNull();
    expect(within(dialog).getByText(/used all 5 attempts/)).toBeInTheDocument();

    // It can still be taken off the "Needs attention" list.
    actions.cancelPublishJobAction.mockResolvedValue({ ok: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(actions.cancelPublishJobAction).toHaveBeenCalledWith({ jobId: spent.id }),
    );
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Job dismissed"));
  });

  it("labels a simulated deployment and simulated jobs", () => {
    view([job({ status: "published", simulated: true })], { mode: "simulated" });

    expect(screen.getByText(/publishing is simulated/)).toBeInTheDocument();
    // Radix tabs switch on mouse down, like native tabs.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "List" }), { button: 0 });
    const list = screen.getByRole("tabpanel", { name: "List" });
    expect(within(list).getByText("Everything in June 2027")).toBeInTheDocument();
    expect(within(list).getByText("Simulated")).toBeInTheDocument();
  });

  it("shows an empty state with a way forward when nothing was ever scheduled", () => {
    view([]);

    expect(screen.getByText("Nothing scheduled yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to library/ })).toHaveAttribute(
      "href",
      "/app/library",
    );
  });

  it("links to the neighbouring months", () => {
    view([]);

    expect(screen.getByRole("link", { name: "Previous month" })).toHaveAttribute(
      "href",
      "/app/calendar?month=2027-05",
    );
    expect(screen.getByRole("link", { name: "Next month" })).toHaveAttribute(
      "href",
      "/app/calendar?month=2027-07",
    );
  });
});

describe("DestinationsSection", () => {
  const section = (props: Partial<React.ComponentProps<typeof DestinationsSection>> = {}) =>
    ui(
      <DestinationsSection
        guest={false}
        email="me@example.com"
        emailVerified
        destinations={options().destinations}
        mode="n8n"
        {...props}
      />,
    );

  it("shows the account's address read-only and the channels masked", () => {
    section();

    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("discord.com/…/5678/••••1234")).toBeInTheDocument();
    // The address is text, not a field: there is nothing to edit.
    expect(screen.queryByDisplayValue("me@example.com")).toBeNull();
  });

  it("tells guests to create an account and offers no form", () => {
    section({ guest: true, email: null, emailVerified: false, destinations: [] });

    expect(screen.getByText("Upgrade to publish")).toBeInTheDocument();
    expect(screen.queryByLabelText("Webhook URL")).toBeNull();
  });

  it("validates the webhook URL before asking the server", async () => {
    section({ destinations: [] });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Team" } });
    fireEvent.change(screen.getByLabelText("Webhook URL"), {
      target: { value: "https://evil.example/api/webhooks/1/abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Discord channel" }));

    expect(await screen.findByText(/That is not a Discord webhook URL/)).toBeInTheDocument();
    expect(actions.addDiscordDestinationAction).not.toHaveBeenCalled();
  });

  it("connects a channel and clears the URL from the page", async () => {
    actions.addDiscordDestinationAction.mockResolvedValue({ ok: true });
    section({ destinations: [] });
    const url =
      "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCD-1234";

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Team " } });
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: url } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Discord channel" }));

    await waitFor(() =>
      expect(actions.addDiscordDestinationAction).toHaveBeenCalledWith({
        label: "Team",
        webhookUrl: url,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText("Webhook URL")).toHaveValue(""));
  });

  it("says plainly when a test message was only simulated", async () => {
    actions.testDestinationAction.mockResolvedValue({ ok: true, simulated: true });
    section({ mode: "simulated" });

    fireEvent.click(screen.getByRole("button", { name: "Send a test message to Team" }));

    await waitFor(() =>
      expect(toasts.info).toHaveBeenCalledWith(expect.stringContaining("nothing was posted")),
    );
  });

  it("asks before removing a destination", async () => {
    actions.removeDestinationAction.mockResolvedValue({ ok: true });
    section();

    fireEvent.click(screen.getByRole("button", { name: "Remove Team" }));
    const dialog = await screen.findByRole("dialog");
    expect(actions.removeDestinationAction).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/everything scheduled for it/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove destination" }));
    await waitFor(() =>
      expect(actions.removeDestinationAction).toHaveBeenCalledWith({ id: DISCORD }),
    );
  });

  it("shows an error instead of an empty list when loading failed", () => {
    section({ destinations: null });

    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("No Discord channels connected yet.")).toBeNull();
  });

  it("stops offering the form at the channel limit", () => {
    section({
      destinations: Array.from({ length: 5 }, (_, index) => ({
        id: `00000000-0000-4000-8000-00000000000${index}`,
        kind: "discord" as const,
        label: `Channel ${index}`,
        hint: null,
      })),
    });

    expect(screen.getByText(/up to 5 Discord channels/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Webhook URL")).toBeNull();
  });
});
