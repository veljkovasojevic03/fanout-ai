import { ArrowRight, Hash, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { FormAlert } from "@/components/auth/form-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DESTINATION_LIMITS, type DestinationView } from "@/lib/publish/destinations";
import type { PublishMode } from "@/lib/publish/dispatcher";

import { AddDiscordForm, DestinationActions } from "./destination-controls";
import { SimulatedBadge } from "./job-status";

type DestinationsSectionProps = {
  guest: boolean;
  /** The account's address; null for a guest. */
  email: string | null;
  emailVerified: boolean;
  /** null = the destinations failed to load. */
  destinations: readonly DestinationView[] | null;
  mode: PublishMode;
  /** Anchor for links such as /app/settings#destinations. */
  id?: string;
};

function Tile({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3.5">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-muted [&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

/**
 * Settings → Publish destinations (spec Phase 6.1): the account's own email
 * address (read-only) and the Discord channels the user has connected. Plain
 * data in, so `/design` can render every state.
 */
export function DestinationsSection({
  guest,
  email,
  emailVerified,
  destinations,
  mode,
  id = "destinations",
}: DestinationsSectionProps) {
  const t = useTranslations("publish");
  const discord = destinations?.filter((destination) => destination.kind === "discord") ?? [];

  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("destinations.title")}</CardTitle>
          {mode === "simulated" && !guest ? <SimulatedBadge /> : null}
        </div>
        <CardDescription>{t("destinations.description")}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {guest ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-accent-ring bg-accent-soft p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold">{t("destinations.guestTitle")}</p>
              <p className="text-[13px] leading-snug text-muted">{t("destinations.guestBody")}</p>
            </div>
            <Button asChild size="sm">
              <Link href="/app/upgrade">
                {t("destinations.guestAction")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        ) : (
          <>
            {mode === "simulated" ? (
              <p className="text-[13px] leading-snug text-muted">{t("simulatedHint")}</p>
            ) : null}

            <section aria-labelledby={`${id}-email`} className="flex flex-col gap-3">
              <h4 id={`${id}-email`} className="text-sm font-semibold">
                {t("destinations.emailTitle")}
              </h4>
              <Tile icon={<Mail />}>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-[13px] break-all">{email ?? "—"}</span>
                  <Badge variant={emailVerified ? "success" : "warn"}>
                    {t(
                      emailVerified ? "destinations.emailVerified" : "destinations.emailUnverified",
                    )}
                  </Badge>
                </p>
                <p className="text-[13px] leading-snug text-muted">
                  {t(emailVerified ? "destinations.emailBody" : "destinations.emailUnverifiedHint")}
                </p>
              </Tile>
            </section>

            <section
              aria-labelledby={`${id}-discord`}
              className="flex flex-col gap-4 border-t border-border pt-6"
            >
              <h4 id={`${id}-discord`} className="text-sm font-semibold">
                {t("destinations.discordTitle")}
              </h4>

              {destinations === null ? (
                <FormAlert tone="error">{t("destinations.loadError")}</FormAlert>
              ) : (
                <>
                  {discord.length === 0 ? (
                    <p className="text-[13px] leading-snug text-muted">
                      {t("destinations.discordEmpty")}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-4">
                      {discord.map((destination) => (
                        <li
                          key={destination.id}
                          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <Tile icon={<Hash />}>
                            <p className="truncate text-sm font-medium">{destination.label}</p>
                            {destination.hint ? (
                              <p className="font-mono text-xs break-all text-muted">
                                {destination.hint}
                              </p>
                            ) : null}
                          </Tile>
                          <DestinationActions id={destination.id} label={destination.label} />
                        </li>
                      ))}
                    </ul>
                  )}

                  {discord.length >= DESTINATION_LIMITS.maxDiscord ? (
                    <p className="text-[13px] leading-snug text-muted">
                      {t("destinations.discordLimit", { max: DESTINATION_LIMITS.maxDiscord })}
                    </p>
                  ) : (
                    <AddDiscordForm />
                  )}
                </>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
