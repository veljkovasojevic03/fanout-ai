"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";

const TOPIC_MAX = 300;

export function LoadingButtonDemo() {
  const [loading, setLoading] = useState(false);

  function run() {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1600);
  }

  return (
    <Button loading={loading} onClick={run}>
      {loading ? "Generating…" : "Click to load"}
    </Button>
  );
}

export function FormDemo() {
  const [topic, setTopic] = useState("");
  const [touched, setTouched] = useState(false);

  const tooLong = topic.length > TOPIC_MAX;
  const error = tooLong
    ? `Keep the topic under ${TOPIC_MAX} characters.`
    : touched && topic.trim() === ""
      ? "A topic is required."
      : undefined;

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field
        label="Topic"
        hint="Live validation: leave it empty and blur, or exceed the limit."
        error={error}
        aside={`${topic.length}/${TOPIC_MAX}`}
        className="sm:col-span-2"
      >
        <Textarea
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. Why small teams should ship weekly"
          rows={3}
        />
      </Field>

      <Field label="Display name" hint="Shown in your workspace.">
        <Input placeholder="Ada Lovelace" autoComplete="off" />
      </Field>

      <Field label="Email" error="This email is already in use.">
        <Input type="email" defaultValue="ada@example.com" autoComplete="off" />
      </Field>

      <Field label="Disabled" hint="Not editable on this plan.">
        <Input disabled defaultValue="Locked value" />
      </Field>

      <Field label="Tone">
        <Select defaultValue="professional">
          <SelectTrigger>
            <SelectValue placeholder="Pick a tone" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Tone</SelectLabel>
              <SelectItem value="professional">Professional</SelectItem>
              <SelectItem value="casual">Casual</SelectItem>
              <SelectItem value="funny">Funny</SelectItem>
              <SelectItem value="inspirational">Inspirational</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectItem value="custom" disabled>
              Custom (unavailable)
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Destination" hint="Placeholder state — nothing selected yet.">
        <Select>
          <SelectTrigger>
            <SelectValue placeholder="Choose a destination" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="discord">Discord</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Length" error="Long is available on the Pro plan.">
        <Select defaultValue="long">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="short">Short</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="long">Long</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

export function DialogDemo() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Open dialog</Button>
        </DialogTrigger>
        <DialogContent closeLabel="Close">
          <DialogHeader>
            <DialogTitle>Schedule this post</DialogTitle>
            <DialogDescription>
              Pick when it goes out. Times are shown in your timezone and stored in UTC.
            </DialogDescription>
          </DialogHeader>
          <Field label="Send at" hint="Focus is trapped inside; Esc closes.">
            <Input type="datetime-local" />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button>Schedule</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="danger">Destructive confirm</Button>
        </DialogTrigger>
        <DialogContent closeLabel="Close">
          <DialogHeader>
            <DialogTitle>Delete this piece?</DialogTitle>
            <DialogDescription>
              It will be removed from your library. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setOpen(false);
                toast.success("Deleted", { description: "The piece was removed." });
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => toast("Copied to clipboard")}>
        Default
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.success("Saved to library", { description: "LinkedIn post · 184 words" })
        }
      >
        Success
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.error("Could not publish", {
            description: "Discord rejected the webhook.",
            action: { label: "Retry", onClick: () => toast("Retrying…") },
          })
        }
      >
        Error + action
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.warning("2 generations left", { description: "Your limit resets next month." })
        }
      >
        Warning
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.promise(new Promise((resolve) => window.setTimeout(resolve, 1500)), {
            loading: "Exporting .docx…",
            success: "Export ready",
            error: "Export failed",
          })
        }
      >
        Promise
      </Button>
    </div>
  );
}
