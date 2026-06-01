// DemoV2Wizard - the center-modal guided tour for the autonomous-email demo.
//
// Mounted at AppShell level so it overlays any page during the demo.
// Drives the whole flow: policy seeding -> email instruction ->
// inbound poll -> auto-execute watch -> outro.
//
// Self-contained: holds its own state (synced to localStorage so a
// tab close mid-flow leaves a resumable session), polls the demo-v2
// endpoints directly, and navigates between routes via react-router.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import {
  CANCELLABLE_STEPS,
  NAV_LOCKED_STEPS,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  STEP_ORDER,
  type DemoV2State,
  type DemoV2Template,
  type StepId,
  checkInbound,
  checkPolicyReady,
  clearState,
  fetchTemplate,
  freshState,
  loadState,
  resetPolicies,
  saveState,
  seedPolicy,
} from "@/lib/demo-v2";

interface DemoV2WizardProps {
  /** The user's logged-in email (the address we'll verify inbound from). */
  loggedInEmail: string;
  /** Called when the wizard is dismissed or completed. */
  onClose: () => void;
}

export function DemoV2Wizard({ loggedInEmail, onClose }: DemoV2WizardProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const [state, setState] = useState<DemoV2State>(() => {
    return loadState() ?? freshState(loggedInEmail);
  });
  const [template, setTemplate] = useState<DemoV2Template | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Persist every state change.
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Fetch the canonical template once.
  useEffect(() => {
    let cancelled = false;
    fetchTemplate()
      .then((t) => {
        if (!cancelled) setTemplate(t);
      })
      .catch((e) => {
        if (!cancelled) setErrorMsg(`Couldn't load demo template: ${String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Step transitions ────────────────────────────────────────────────

  const setStep = useCallback((step: StepId) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const cancellable = CANCELLABLE_STEPS.has(state.step);

  const handleCancel = useCallback(() => {
    if (!cancellable) return;
    clearState();
    onClose();
  }, [cancellable, onClose]);

  // ── Step 2 (policy-wipe) auto-effects ───────────────────────────────
  // When we enter policy-wipe, navigate to /app/policy so the user
  // sees the policies list change live.
  useEffect(() => {
    if (state.step === "policy-wipe" && !location.pathname.startsWith("/app/policy")) {
      navigate("/app/policy");
    }
  }, [state.step, location.pathname, navigate]);

  // ── Step 5 (waiting-for-email) polling ──────────────────────────────
  const pollerRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.step !== "waiting-for-email") {
      if (pollerRef.current) {
        window.clearInterval(pollerRef.current);
        pollerRef.current = null;
      }
      return;
    }
    if (!state.senderEmail || !state.waitingStartedAt) return;
    let aborted = false;
    const tick = async () => {
      if (aborted) return;
      try {
        const r = await checkInbound(state.senderEmail!, state.waitingStartedAt!);
        if (aborted) return;
        if (r.matched && r.case_id) {
          setState((prev) => ({
            ...prev,
            step: "case-opened",
            caseId: r.case_id,
            shortId: r.short_id,
          }));
        }
      } catch {
        // transient - try again next tick
      }
    };
    // Fire immediately so the user sees a check happen right away.
    void tick();
    pollerRef.current = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      aborted = true;
      if (pollerRef.current) {
        window.clearInterval(pollerRef.current);
        pollerRef.current = null;
      }
    };
  }, [state.step, state.senderEmail, state.waitingStartedAt]);

  // ── Step 6 (case-opened) navigation + watching ──────────────────────
  // Once we have a case id, push the operator into the workspace and
  // listen for the case to reach acting/resolved before advancing.
  useEffect(() => {
    if (state.step !== "case-opened") return;
    if (!state.caseId) return;
    const target = `/app/case/${state.caseId}`;
    if (!location.pathname.startsWith(target)) {
      navigate(target);
    }
  }, [state.step, state.caseId, location.pathname, navigate]);

  // While in case-opened, poll the case until it's resolved/acting.
  // Reusing checkInbound (it returns latest status by sender) keeps
  // this off the SSE plumbing - one fewer thing to debug late at night.
  useEffect(() => {
    if (state.step !== "case-opened") return;
    if (!state.senderEmail || !state.waitingStartedAt) return;
    let aborted = false;
    const tick = async () => {
      if (aborted) return;
      try {
        const r = await checkInbound(state.senderEmail!, state.waitingStartedAt!);
        if (aborted) return;
        if (r.matched && (r.status === "resolved" || r.status === "errored")) {
          setState((prev) => ({ ...prev, step: "case-resolved" }));
        }
      } catch {
        /* transient */
      }
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      aborted = true;
      window.clearInterval(id);
    };
  }, [state.step, state.senderEmail, state.waitingStartedAt]);

  // ── Nav lock (sidebar guard + beforeunload) ─────────────────────────
  useEffect(() => {
    if (!NAV_LOCKED_STEPS.has(state.step)) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "The agent is mid-investigation. Leave anyway?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    document.body.setAttribute("data-demo-v2-locked", "true");
    return () => {
      window.removeEventListener("beforeunload", handler);
      document.body.removeAttribute("data-demo-v2-locked");
    };
  }, [state.step]);

  // ── Action handlers (per-step buttons) ──────────────────────────────

  const handleSeedPolicy = useCallback(async () => {
    setBusy("Setting up the policy…");
    setErrorMsg(null);
    try {
      await resetPolicies();
      const r = await seedPolicy();
      if (!r.ready) throw new Error("policy seed did not report ready");
      setStep("policy-seeded");
    } catch (e) {
      setErrorMsg(`Couldn't set up the policy: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [setStep]);

  const handleConfirmPolicySeeded = useCallback(async () => {
    // Re-verify so we don't proceed if something blew the rule away
    // between the seed and the user clicking next.
    setBusy("Checking policy…");
    try {
      const r = await checkPolicyReady();
      if (!r.ready) {
        setErrorMsg(
          "The policy isn't in place anymore - re-seed before continuing.",
        );
        setStep("policy-wipe");
        return;
      }
      setStep("send-email");
    } catch (e) {
      setErrorMsg(`Couldn't verify the policy: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [setStep]);

  const handleSentEmail = useCallback(() => {
    setState((prev) => ({
      ...prev,
      step: "waiting-for-email",
      waitingStartedAt: Date.now(),
    }));
  }, []);

  const handleFinish = useCallback(() => {
    clearState();
    onClose();
    navigate("/app");
  }, [navigate, onClose]);

  // ── Render ──────────────────────────────────────────────────────────

  const progressIdx = STEP_ORDER.indexOf(state.step);
  const progressTotal = STEP_ORDER.length - 1; // don't count "done"

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manthan demo"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(8,10,8,0.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          background: "#15171a",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: "16px",
          padding: "28px 28px 22px",
          color: "#efece4",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
        }}
      >
        <DemoHeader
          step={state.step}
          progressIdx={progressIdx}
          progressTotal={progressTotal}
          cancellable={cancellable}
          onCancel={handleCancel}
        />

        {errorMsg && (
          <div
            style={{
              background: "rgba(220,80,80,0.10)",
              border: "1px solid rgba(220,80,80,0.32)",
              color: "#ffb3b3",
              padding: "10px 12px",
              borderRadius: "10px",
              fontSize: "13px",
              marginBottom: "14px",
            }}
          >
            {errorMsg}
          </div>
        )}

        <StepBody
          state={state}
          template={template}
          busy={busy}
          onStartNow={() => setStep("policy-wipe")}
          onSeedPolicy={handleSeedPolicy}
          onConfirmPolicySeeded={handleConfirmPolicySeeded}
          onSentEmail={handleSentEmail}
          onAbortWaiting={() => {
            // Allowed escape hatch from the wait if it times out.
            setStep("send-email");
            setState((prev) => ({ ...prev, waitingStartedAt: null }));
          }}
          onFinish={handleFinish}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Subcomponents (kept in this file so the wizard is self-contained)
// ──────────────────────────────────────────────────────────────────────

function DemoHeader({
  step,
  progressIdx,
  progressTotal,
  cancellable,
  onCancel,
}: {
  step: StepId;
  progressIdx: number;
  progressTotal: number;
  cancellable: boolean;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "18px",
      }}
    >
      <div>
        <div
          style={{
            fontSize: "10px",
            letterSpacing: "0.16em",
            color: "rgba(239,236,228,0.45)",
            textTransform: "uppercase",
          }}
        >
          Manthan · guided demo · step {Math.max(0, progressIdx) + 1} of{" "}
          {progressTotal}
        </div>
        <div style={{ fontSize: "11px", color: "rgba(239,236,228,0.55)" }}>
          {SHORT_LABELS[step]}
        </div>
      </div>
      {cancellable && (
        <button
          onClick={onCancel}
          style={{
            background: "transparent",
            color: "rgba(239,236,228,0.55)",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: "8px",
            padding: "6px 10px",
            fontSize: "11px",
            cursor: "pointer",
          }}
        >
          Cancel demo
        </button>
      )}
    </div>
  );
}

const SHORT_LABELS: Record<StepId, string> = {
  intro: "What you're about to see",
  "policy-wipe": "Set the auto-execute policy",
  "policy-seeded": "Policy is live",
  "send-email": "Send a test email",
  "waiting-for-email": "Waiting for your email",
  "case-opened": "Watching the agent",
  "case-resolved": "Resolution",
  done: "Done",
};

function StepBody(props: {
  state: DemoV2State;
  template: DemoV2Template | null;
  busy: string | null;
  onStartNow: () => void;
  onSeedPolicy: () => void;
  onConfirmPolicySeeded: () => void;
  onSentEmail: () => void;
  onAbortWaiting: () => void;
  onFinish: () => void;
}) {
  const { state, template, busy } = props;

  switch (state.step) {
    case "intro":
      return (
        <>
          <H2>Set up an autonomous billing agent on your inbox</H2>
          <P>
            Manthan reads customer emails, investigates across every
            connected system, and resolves the case — refunds, replies,
            CRM updates — all on its own when a policy says it can.
          </P>
          <P>
            In the next few steps you'll set one policy ("auto-refund
            small first-time requests"), then send a real email to
            Manthan from your own inbox. You'll watch it work end to
            end, including the reply it sends back to you.
          </P>
          <ActionRow>
            <PrimaryButton onClick={props.onStartNow}>Start</PrimaryButton>
          </ActionRow>
        </>
      );

    case "policy-wipe":
      return (
        <>
          <H2>One policy. Auto-refund small new-customer requests.</H2>
          <P>
            We've taken you to the Policies page. Policies are the
            single switch that decides whether Manthan acts on its own
            or asks you first.
          </P>
          <P>
            Click the button below and we'll seed the policy
            that pairs with the email you're about to send.{" "}
            <span style={{ color: "rgba(239,236,228,0.6)" }}>
              You can read, edit, or remove it after the demo.
            </span>
          </P>
          {template && (
            <PolicyCard
              name={template.policy_name}
              description={template.policy_description}
            />
          )}
          <ActionRow>
            <PrimaryButton
              disabled={!!busy}
              onClick={props.onSeedPolicy}
            >
              {busy ?? "Seed the policy"}
            </PrimaryButton>
          </ActionRow>
        </>
      );

    case "policy-seeded":
      return (
        <>
          <H2>Policy is live.</H2>
          <P>
            Manthan will now auto-refund refund-request emails from
            new customers, then email them back. No human review.
          </P>
          <P style={{ color: "rgba(239,236,228,0.7)" }}>
            Next we'll test it — send a real email from your inbox.
          </P>
          <ActionRow>
            <PrimaryButton
              disabled={!!busy}
              onClick={props.onConfirmPolicySeeded}
            >
              {busy ?? "Continue"}
            </PrimaryButton>
          </ActionRow>
        </>
      );

    case "send-email":
      return (
        <SendEmailStep
          template={template}
          loggedInEmail={state.senderEmail ?? ""}
          onSentEmail={props.onSentEmail}
        />
      );

    case "waiting-for-email":
      return (
        <WaitingStep
          startedAt={state.waitingStartedAt ?? Date.now()}
          loggedInEmail={state.senderEmail ?? ""}
          onAbort={props.onAbortWaiting}
        />
      );

    case "case-opened":
      return (
        <>
          <H2>Manthan picked it up. Watch it work.</H2>
          <P>
            The agent is querying our connected sources — billing
            records, customer history, support tickets, the relevant
            policy doc — and recording each finding. The case is
            set to auto-execute, so when the brief is ready Manthan
            will fire the refund and reply automatically.
          </P>
          <P style={{ color: "rgba(239,236,228,0.6)", fontSize: "13px" }}>
            Case {state.shortId ?? ""} · Behind this modal you can
            see the investigation streaming live.
          </P>
          <ActionRow>
            <P style={{ color: "rgba(239,236,228,0.55)", margin: 0, fontSize: "12px" }}>
              Waiting for resolution… this usually takes 30–90 seconds.
            </P>
          </ActionRow>
        </>
      );

    case "case-resolved":
      return (
        <>
          <H2>Resolved. End-to-end.</H2>
          <P>
            Manthan investigated the case, decided per the policy you
            set, refunded the charge, and emailed your customer back.
          </P>
          <P style={{ color: "rgba(239,236,228,0.75)" }}>
            <strong>Check your inbox</strong> — there's a reply waiting
            for you ("Re: {(template?.subject ?? "your refund")}").
            That's the actual email Manthan sent your customer,
            delivered to you because you sent the demo from your own
            address.
          </P>
          <ActionRow>
            <PrimaryButton onClick={props.onFinish}>Finish</PrimaryButton>
          </ActionRow>
        </>
      );

    case "done":
      return null;
  }
}

function SendEmailStep({
  template,
  loggedInEmail,
  onSentEmail,
}: {
  template: DemoV2Template | null;
  loggedInEmail: string;
  onSentEmail: () => void;
}) {
  if (!template) {
    return <P>Loading template…</P>;
  }
  const mailto =
    `mailto:${encodeURIComponent(template.to)}` +
    `?subject=${encodeURIComponent(template.subject)}` +
    `&body=${encodeURIComponent(template.body)}`;
  return (
    <>
      <H2>Send this email — from your inbox, to Manthan.</H2>
      <P>
        Send the message below from <strong>{loggedInEmail}</strong> so
        Manthan can verify the round-trip against your account.
      </P>
      <CopyRow label="To" value={template.to} />
      <CopyRow label="Subject" value={template.subject} />
      <CopyRow label="Body" value={template.body} multiline />
      <ActionRow style={{ marginTop: "18px", gap: "8px" }}>
        <SecondaryButton onClick={() => window.open(mailto, "_blank")}>
          Compose in mail client
        </SecondaryButton>
        <PrimaryButton onClick={onSentEmail}>I've sent it</PrimaryButton>
      </ActionRow>
      <P
        style={{
          color: "rgba(239,236,228,0.55)",
          fontSize: "11.5px",
          marginTop: "12px",
        }}
      >
        Last cancel point — once you confirm the send we'll watch the
        case end-to-end.
      </P>
    </>
  );
}

function WaitingStep({
  startedAt,
  loggedInEmail,
  onAbort,
}: {
  startedAt: number;
  loggedInEmail: string;
  onAbort: () => void;
}) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  useEffect(() => {
    const id = window.setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => window.clearInterval(id);
  }, [startedAt]);
  const remaining = Math.max(0, POLL_TIMEOUT_MS - elapsed);
  const expired = remaining === 0;
  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1_000);
  const pct = Math.min(100, (elapsed / POLL_TIMEOUT_MS) * 100);

  return (
    <>
      <H2>Listening for your email…</H2>
      <P>
        We're polling for an inbound email from{" "}
        <strong>{loggedInEmail}</strong>. As soon as it lands, we'll
        jump you to the case Manthan opens.
      </P>
      <div
        style={{
          background: "rgba(255,255,255,0.06)",
          borderRadius: "999px",
          height: "6px",
          overflow: "hidden",
          margin: "10px 0 6px",
        }}
      >
        <div
          style={{
            background: expired
              ? "rgba(220,140,120,0.7)"
              : "rgba(22,208,94,0.7)",
            height: "100%",
            width: `${pct}%`,
            transition: "width 0.5s linear",
          }}
        />
      </div>
      <P
        style={{
          color: expired ? "#ffb3a3" : "rgba(239,236,228,0.6)",
          fontSize: "12px",
          margin: 0,
        }}
      >
        {expired
          ? "Didn't arrive within 5 minutes."
          : `Waiting · ${mins}:${String(secs).padStart(2, "0")} left`}
      </P>
      {expired && (
        <>
          <P style={{ marginTop: "12px", fontSize: "13.5px" }}>
            Common causes: sent from a different address, hit spam, or
            your mail client hadn't released the message yet. You can
            try again from the previous step.
          </P>
          <ActionRow style={{ gap: "8px" }}>
            <SecondaryButton onClick={onAbort}>
              Back to the send step
            </SecondaryButton>
          </ActionRow>
        </>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Visual primitives
// ──────────────────────────────────────────────────────────────────────

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: '"Spectral", Georgia, serif',
        fontWeight: 500,
        fontStyle: "italic",
        fontSize: "26px",
        lineHeight: 1.18,
        margin: "0 0 14px 0",
        color: "#efece4",
      }}
    >
      {children}
    </h2>
  );
}

function P({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <p
      style={{
        margin: "0 0 12px 0",
        fontSize: "14.5px",
        lineHeight: 1.55,
        color: "rgba(239,236,228,0.85)",
        ...style,
      }}
    >
      {children}
    </p>
  );
}

function ActionRow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: "10px",
        marginTop: "20px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "rgba(22,208,94,0.35)" : "#16d05e",
        color: "#0a0c0a",
        border: "0",
        borderRadius: "10px",
        padding: "10px 16px",
        fontSize: "13.5px",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: "0.01em",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        color: "#efece4",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: "10px",
        padding: "10px 14px",
        fontSize: "13.5px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function PolicyCard({
  name,
  description,
}: {
  name: string;
  description: string;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        padding: "12px 14px",
        margin: "8px 0 14px",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
        {name}
      </div>
      <div
        style={{
          fontSize: "12.5px",
          lineHeight: 1.5,
          color: "rgba(239,236,228,0.7)",
        }}
      >
        {description}
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }, [value]);
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        padding: "10px 12px",
        marginBottom: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: multiline ? "6px" : "0",
          gap: "10px",
        }}
      >
        <div
          style={{
            fontSize: "10.5px",
            letterSpacing: "0.14em",
            color: "rgba(239,236,228,0.5)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        <button
          onClick={handleCopy}
          style={{
            background: copied ? "rgba(22,208,94,0.18)" : "transparent",
            color: copied ? "#16d05e" : "rgba(239,236,228,0.75)",
            border: `1px solid ${copied ? "rgba(22,208,94,0.36)" : "rgba(255,255,255,0.14)"}`,
            borderRadius: "6px",
            padding: "3px 8px",
            fontSize: "11px",
            cursor: "pointer",
            transition: "all 120ms",
          }}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div
        style={{
          fontFamily:
            multiline
              ? 'ui-sans-serif, system-ui, -apple-system, sans-serif'
              : 'ui-monospace, "SF Mono", Menlo, monospace',
          fontSize: multiline ? "13px" : "12.5px",
          color: "rgba(239,236,228,0.92)",
          whiteSpace: multiline ? "pre-wrap" : "nowrap",
          overflow: multiline ? "visible" : "hidden",
          textOverflow: multiline ? "clip" : "ellipsis",
          lineHeight: multiline ? 1.5 : 1.3,
        }}
      >
        {value}
      </div>
    </div>
  );
}
