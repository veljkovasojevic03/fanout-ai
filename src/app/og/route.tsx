import { ImageResponse } from "next/og";

import { isAppLocale } from "@/i18n/config";
import { OG_SIZE, ogText } from "@/lib/og";

/*
 * GET /og?lang=en|sr — the share image (1200×630), one per language
 * (spec Phase 7.3). Referenced from the landing page's metadata.
 */

export function GET(request: Request) {
  const lang = new URL(request.url).searchParams.get("lang");
  const text = ogText(isAppLocale(lang) ? lang : "en");

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#0a0a0b",
        backgroundImage:
          "radial-gradient(circle at 50% -10%, rgba(182,255,59,0.28), rgba(10,10,11,0) 55%), linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)",
        backgroundSize: "100% 100%, 56px 56px, 56px 56px",
        color: "#ededef",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "#b6ff3b",
            display: "flex",
          }}
        />
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Fanout</div>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            fontWeight: 700,
            color: "#b6ff3b",
            border: "2px solid rgba(182,255,59,0.5)",
            borderRadius: 8,
            padding: "2px 10px",
          }}
        >
          AI
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", fontSize: 104, lineHeight: 1.02 }}>
        <div style={{ display: "flex", fontWeight: 700, letterSpacing: -4 }}>{text.lead}</div>
        <div style={{ display: "flex", fontWeight: 700, letterSpacing: -4, color: "#b6ff3b" }}>
          {text.accent}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        {text.formats.map((format) => (
          <div
            key={format}
            style={{
              display: "flex",
              fontSize: 26,
              color: "#8b8b94",
              border: "2px solid rgba(255,255,255,0.12)",
              background: "#111113",
              borderRadius: 10,
              padding: "8px 18px",
            }}
          >
            {format}
          </div>
        ))}
      </div>
    </div>,
    {
      ...OG_SIZE,
      headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
    },
  );
}
