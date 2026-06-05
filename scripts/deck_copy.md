# Manthan pitch deck assembly guide

Five hero images live at `manthan-ui/public/deck/`. Each one has the
upper-right ~30% of the frame reserved as clean negative space for
slide title + supporting copy to overlay. Build the slides in Figma /
Keynote / PowerPoint by placing the image full-bleed at 16:9, then
typing copy into the cleared region.

Recommended typography: Spectral italic (titles), Geist (body, mono
for eyebrows). Same as the rest of manthan.quest. Keep title weight at
44-56px, body at 18-22px, eyebrow at 11px uppercase mono with 0.18em
tracking.

──────────────────────────────────────────────
SLIDE 1 — Cover. Image: 01-hero.webp
──────────────────────────────────────────────

EYEBROW (top-right, mono, uppercase):
  MANTHAN · JUNE 2026 · ANTLER INDIA AI RESIDENCY

TITLE (italic Spectral, large):
  The operations layer for revenue disputes.

SUBTITLE (Spectral roman, smaller):
  Autonomous agents that investigate, resolve, and explain. Built on
  Coral. Live at manthan.quest.

FOOT (mono, small, bottom-right):
  Hitakshi · hitakshi220@gmail.com · github.com/hitakshiA/Manthan

──────────────────────────────────────────────
SLIDE 2 — The problem. Image: 02-problem.webp
──────────────────────────────────────────────

EYEBROW:
  THE PROBLEM

TITLE:
  47 tickets a day. One of them is the refund.

BODY (3 short lines):
  Every B2B SaaS company faces chargebacks, refund requests, and
  failed renewals. Each one currently costs an analyst 5 to 18 hours
  joining evidence across 6 to 8 systems by hand. Often more than the
  dispute itself.

PROOF (mono, smaller):
  $30B in annual chargeback losses · 40% of agentic AI projects
  cancelled by 2027 for cost reasons · "Token tsunamis" is now an
  industry term

──────────────────────────────────────────────
SLIDE 3 — What we built. Image: 03-solution.webp
──────────────────────────────────────────────

EYEBROW:
  THE SOLUTION

TITLE:
  One inbox. One agent. End to end.

BODY:
  Manthan reads every dispute that lands in your support inbox,
  Slack, or webhook surface. It queries Stripe, HubSpot, Notion,
  Slack, Datadog, Intercom, PostHog, and Zendesk as one unified
  data layer. Files a cited brief. Either auto-resolves or queues
  the action for one-click approval.

PROOF:
  Three trigger surfaces shipped · Stripe webhook + email inbound +
  Slack @-mention · Cited brief with click-through to every source

──────────────────────────────────────────────
SLIDE 4 — Why we will win. Image: 04-moat.webp
──────────────────────────────────────────────

EYEBROW:
  THE MOAT

TITLE:
  Tokens are the new salary.

BODY:
  The naive agent build of this category racks up 472,000 input
  tokens per 10-step investigation — quadratic cost growth as
  context replays. We collapsed that to ~40K through one Coral
  session per case, structural citations, and a deterministic HITL
  gate.

NUMBERS (right side, big mono):
  Naive: $1.42 / case (Sonnet 4.6)
  Manthan: $0.40 / case
  3.5x cost spread. Architectural, not modelable.

──────────────────────────────────────────────
SLIDE 5 — The bet. Image: 05-vision.webp
──────────────────────────────────────────────

EYEBROW:
  THE VISION

TITLE:
  A hundred Manthans.

BODY:
  Insurance claims investigation. Tax filing review. Vendor
  onboarding. KYC. Healthcare prior authorization. Audit packet
  assembly. Compliance attestation. The economics will look
  identical to ours.

CTA (mono, bottom):
  manthan.quest · Read the engineering postmortem at
  manthan.quest/blog/tokens-are-the-new-salary

──────────────────────────────────────────────
Production notes
──────────────────────────────────────────────

  - Export each slide at 1920x1080 PNG for Antler upload.
  - If Antler wants a PDF, export all 5 as a single multi-page PDF
    at 1920x1080 page size.
  - The deck reads in 90 seconds. Plan a 5-7 minute talk track
    that adds verbal context the slides do not carry.
  - Open the talk by showing the live product (manthan.quest).
    Let the deck appear after the demo lands.
  - Close on Slide 5 and pause. The "hundred Manthans" line is
    the bet. Do not say it twice.
