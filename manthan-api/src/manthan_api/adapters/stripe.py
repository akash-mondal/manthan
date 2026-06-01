"""Stripe adapter - refunds, dispute responses."""

from __future__ import annotations

import os
from typing import Any

import stripe

from . import AdapterError, ExecutionResult


def _client() -> None:
    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        raise AdapterError("STRIPE_API_KEY missing")
    stripe.api_key = key


def refund(payload: dict[str, Any], idempotency_key: str) -> ExecutionResult:
    """Issue a Stripe refund.

    Required payload keys:
      charge: ch_xxx  OR  payment_intent: pi_xxx
      amount_minor (optional, defaults to full)
      reason (optional: requested_by_customer | duplicate | fraudulent)
      metadata (optional dict)
    """
    _client()
    charge = payload.get("charge")
    pi = payload.get("payment_intent")
    if not charge and not pi:
        raise AdapterError("refund payload must contain charge or payment_intent")

    args: dict[str, Any] = {
        "reason": payload.get("reason", "requested_by_customer"),
        "metadata": payload.get("metadata") or {},
    }
    if charge:
        args["charge"] = charge
    if pi:
        args["payment_intent"] = pi
    if payload.get("amount_minor"):
        args["amount"] = int(payload["amount_minor"])

    args["metadata"]["manthan_idempotency_key"] = idempotency_key

    try:
        r = stripe.Refund.create(idempotency_key=idempotency_key, **args)
    except stripe.error.StripeError as e:  # type: ignore[attr-defined]
        # The action is recorded as failed with the real Stripe error
        # message. If the charge has an active dispute the operator sees
        # `charge_disputed` here and the partial-credit remedy lands via
        # the parallel stripe_dispute_response action; we never fabricate
        # a refund ref on top of a real rejection.
        msg = (e.user_message or str(e)) or ""
        raise AdapterError(f"stripe refund failed: {msg}")

    return ExecutionResult(
        external_ref=r.id,
        summary=f"Refund {r.id} for {r.amount / 100:.2f} {r.currency.upper()}, status={r.status}",
        raw={"id": r.id, "amount": r.amount, "currency": r.currency, "status": r.status},
    )


def dispute_response(payload: dict[str, Any], idempotency_key: str) -> ExecutionResult:
    """Submit evidence on a Stripe dispute (chargeback)."""
    _client()
    dispute_id = payload.get("dispute")
    if not dispute_id:
        raise AdapterError("dispute_response payload must contain dispute id")

    evidence = payload.get("evidence") or {}
    submit = bool(payload.get("submit", True))

    try:
        r = stripe.Dispute.modify(
            dispute_id,
            evidence=evidence,
            submit=submit,
            idempotency_key=idempotency_key,
        )
    except stripe.error.StripeError as e:  # type: ignore[attr-defined]
        raise AdapterError(f"stripe dispute_response failed: {e.user_message or str(e)}")

    return ExecutionResult(
        external_ref=r.id,
        summary=f"Dispute {r.id} evidence submitted, status={r.status}",
        raw={"id": r.id, "status": r.status},
    )


def verify_refund(external_ref: str) -> bool:
    """Write-then-verify - re-read the refund and check it succeeded."""
    _client()
    try:
        r = stripe.Refund.retrieve(external_ref)
    except stripe.error.StripeError:  # type: ignore[attr-defined]
        return False
    return r.status in ("succeeded", "pending")
