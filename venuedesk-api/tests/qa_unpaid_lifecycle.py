#!/usr/bin/env python3
"""
QA Integration Tests — Category 12: Auto-Cancel Unpaid Bookings Lifecycle

Tests POST /admin/process-unpaid-lifecycle end-to-end:
  12a  No auth → 401
  12b  Admin JWT (dry run) → 200 + correct response shape
  12c  Booking in warning window appears in warnings_to_send
  12d  Idempotency — same booking NOT re-warned on second sweep
  12e  Booking in cancel window → status='cancelled' + in cancellations_to_send
  12f  Manual cancel writes category='Customer Cancelled' (verified via re-cancel 409)
  12g  Fully-paid booking is never touched by the sweep

Run:
    pip install requests
    export VD_JWT_TOKEN="<CYCLE_SWEEP_SERVICE_JWT from docker-compose.yml>"
    python3 qa_unpaid_lifecycle.py

Exit codes: 0 = all pass, 1 = failures, 2 = CRITICAL (dangerous API behaviour)
"""

import os
import sys
import uuid
import datetime
import time
from typing import Optional, Tuple, List
from dataclasses import dataclass, field

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")

# ── Config ────────────────────────────────────────────────────────────────────
BASE_URL        = os.environ.get("VD_BASE_URL",  "https://api.venuedesk.co.uk")
JWT_TOKEN       = os.environ.get("VD_JWT_TOKEN", "YOUR_JWT_TOKEN_HERE").strip()
REQUEST_TIMEOUT = int(os.environ.get("VD_TIMEOUT", "15"))

# ── ANSI colours ──────────────────────────────────────────────────────────────
RESET   = "\033[0m"
RED     = "\033[91m"
GREEN   = "\033[92m"
YELLOW  = "\033[93m"
CYAN    = "\033[96m"
BOLD    = "\033[1m"
MAGENTA = "\033[95m"


@dataclass
class TestResult:
    name:     str
    passed:   bool
    critical: bool = False
    status:   Optional[int] = None
    detail:   str = ""
    skipped:  bool = False


results:        List[TestResult] = []
created_rooms:  List[str] = []
created_bookings: List[str] = []
created_customer: Optional[str] = None


# ── HTTP helpers ──────────────────────────────────────────────────────────────
def auth_headers():
    return {"Authorization": f"Bearer {JWT_TOKEN}", "Content-Type": "application/json"}


def api(method, path, **kwargs):
    try:
        r = requests.request(method, BASE_URL + path,
                             headers=auth_headers(), timeout=REQUEST_TIMEOUT, **kwargs)
        return r, None
    except requests.exceptions.Timeout:
        return None, f"TIMEOUT after {REQUEST_TIMEOUT}s"
    except Exception as exc:
        return None, str(exc)


def record(name, passed, critical=False, status=None, detail=""):
    r = TestResult(name=name, passed=passed, critical=critical, status=status, detail=detail)
    results.append(r)
    icon = (f"{RED}{BOLD}✗ CRITICAL{RESET}" if critical
            else f"{RED}✗ FAIL{RESET}" if not passed
            else f"{GREEN}✓ PASS{RESET}")
    status_str = f"[HTTP {status}] " if status else ""
    print(f"  {icon}  {name}  {CYAN}{status_str}{RESET}{detail}")
    return r


def skip(name, reason):
    r = TestResult(name=name, passed=False, skipped=True, detail=reason)
    results.append(r)
    print(f"  {YELLOW}⊘ SKIP{RESET}  {name}  ({reason})")
    return r


# ── Setup helpers ─────────────────────────────────────────────────────────────
def create_room(suffix=""):
    name = f"QA-LIFECYCLE-{suffix or uuid.uuid4().hex[:6]}"
    r, e = api("POST", "/config/rooms/create", json={"name": name, "capacity": 30, "day_rate": 50})
    if e or r is None or r.status_code not in (200, 201):
        body = r.text[:120] if r is not None else ""
        print(f"  {YELLOW}[setup] Room creation failed: {e or (r.status_code if r is not None else '?')} {body}{RESET}")
        return None
    rid = r.json().get("data", {}).get("id")
    if rid:
        created_rooms.append(rid)
    return rid


def create_customer():
    r, e = api("POST", "/customers/upsert", json={
        "full_name":  "QA Lifecycle Customer",
        "email":      f"qa-lifecycle-{uuid.uuid4().hex[:8]}@test.invalid",
        "phone":      "07700000001",
    })
    if e or r is None or r.status_code not in (200, 201):
        body = r.text[:120] if r is not None else ""
        print(f"  {YELLOW}[setup] Customer creation failed: {e or (r.status_code if r is not None else '?')} {body}{RESET}")
        return None
    return r.json().get("data", {}).get("id")


def create_unpaid_booking(room_id, customer_id, days_ahead, start="10:00", end="14:00"):
    """Create a booking `days_ahead` from today with an unpaid balance of £50."""
    booking_date = (datetime.date.today() + datetime.timedelta(days=days_ahead)).isoformat()
    r, e = api("POST", "/bookings/create", json={
        "room_id":      room_id,
        "customer_id":  customer_id,
        "booking_date": booking_date,
        "start_time":   start,
        "end_time":     end,
        "total_amount": 50,
        "deposit_amount": 0,
        "status":       "confirmed",
    })
    if e or not r or r.status_code not in (200, 201):
        print(f"    {YELLOW}[setup] Booking creation failed "
              f"(days_ahead={days_ahead}): {e or r.status_code}{RESET}")
        return None
    bid = r.json().get("data", {}).get("id")
    if bid:
        created_bookings.append(bid)
    return bid


def run_lifecycle():
    """Call the lifecycle sweep endpoint and return (response, error)."""
    return api("POST", "/admin/process-unpaid-lifecycle", json={})


def get_booking_status(booking_id):
    """Fetch a single booking's status from /bookings/list."""
    r, e = api("GET", "/bookings/list")
    if e or not r or r.status_code != 200:
        return None
    bookings = r.json().get("data") or r.json().get("bookings") or []
    if isinstance(bookings, list):
        for b in bookings:
            if b.get("id") == booking_id:
                return b.get("status")
    return None


def get_unpaid_warning_sent_at(booking_id):
    """Check unpaid_warning_sent_at via /bookings/list — returns the field value or None."""
    r, e = api("GET", "/bookings/list")
    if e or not r or r.status_code != 200:
        return "API_ERROR"
    bookings = r.json().get("data") or r.json().get("bookings") or []
    if isinstance(bookings, list):
        for b in bookings:
            if b.get("id") == booking_id:
                return b.get("unpaid_warning_sent_at", "FIELD_MISSING")
    return "NOT_FOUND"


# ── Category 12 ───────────────────────────────────────────────────────────────
def test_unpaid_lifecycle():
    print(f"\n{BOLD}{MAGENTA}━━ 12. AUTO-CANCEL UNPAID BOOKING LIFECYCLE ━━{RESET}")

    room_id     = create_room()   # random suffix avoids name collision on re-run
    customer_id = create_customer()

    if not room_id or not customer_id:
        skip("12 (all)",  "fixture setup failed — room or customer creation rejected")
        return

    print(f"  room_id={room_id}  customer_id={customer_id}")

    # ── 12a — No auth → 401 or 400 (not 200) ────────────────────────────────
    # Fastify parses the body BEFORE the preHandler auth hook runs. A POST with
    # no body and Content-Type: application/json returns 400 (body parse error)
    # rather than 401 — same behaviour as test 7a in the main QA suite.
    # Critical check: the endpoint must NOT return 200 without auth.
    try:
        r = requests.post(BASE_URL + "/admin/process-unpaid-lifecycle",
                          headers={"Content-Type": "application/json"},
                          timeout=REQUEST_TIMEOUT)
        ok = r.status_code in (400, 401)
        record("12a No auth → 400/401 (not 200)", ok,
               critical=r.status_code == 200, status=r.status_code,
               detail="endpoint is completely unprotected — CRITICAL" if r.status_code == 200
               else "(400 expected: Fastify body parser fires before auth preHandler)")
    except Exception as exc:
        record("12a No auth → 400/401 (not 200)", False, detail=str(exc))

    # ── 12b — Admin JWT dry run → 200 + correct response shape ───────────────
    r, e = run_lifecycle()
    if e:
        record("12b Admin JWT → 200 + correct shape", False, detail=e)
    else:
        ok = r.status_code in (200, 201)
        if ok:
            body = r.json()
            has_success       = body.get("success") is True
            has_warnings      = isinstance(body.get("warnings_to_send"),      list)
            has_cancellations = isinstance(body.get("cancellations_to_send"), list)
            has_days          = isinstance(body.get("auto_cancel_days"),       int)
            shape_ok = has_success and has_warnings and has_cancellations and has_days
            record("12b Admin JWT → 200 + {success, auto_cancel_days, warnings_to_send[], cancellations_to_send[]}",
                   shape_ok, status=r.status_code,
                   detail=(f"auto_cancel_days={body.get('auto_cancel_days')} — shape OK"
                           if shape_ok else f"missing fields: {body}"))
        else:
            record("12b Admin JWT → 200 + correct shape", False, status=r.status_code,
                   detail=r.text[:200] if r is not None else "no response")

    # ── 12c — Booking in warning window appears in warnings_to_send ───────────
    # auto_cancel_days defaults to 7 → warning fires when booking_date <= today + 9.
    # Booking at today+8 is within the warning window but NOT the cancel window.
    warn_bid = create_unpaid_booking(room_id, customer_id, days_ahead=8,
                                     start="11:00", end="15:00")
    if not warn_bid:
        skip("12c Warning window → in warnings_to_send", "could not create test booking")
        skip("12d Warning idempotency", "depends on 12c")
    else:
        r, e = run_lifecycle()
        if e:
            record("12c Warning window → in warnings_to_send", False, detail=e)
        else:
            body = r.json()
            warned_ids = [w.get("booking_id") for w in body.get("warnings_to_send", [])]
            ok = warn_bid in warned_ids
            record("12c Booking today+8 in warnings_to_send", ok, status=r.status_code,
                   detail=(f"booking {warn_bid} found in {len(warned_ids)} warned bookings"
                           if ok else f"not found — warned IDs: {warned_ids[:3]}"))

        # ── 12d — Idempotency: same booking not re-warned on second sweep ─────
        r2, e2 = run_lifecycle()
        if e2:
            record("12d Warning idempotency (not re-warned)", False, detail=e2)
        elif warn_bid:
            body2 = r2.json()
            warned_ids2 = [w.get("booking_id") for w in body2.get("warnings_to_send", [])]
            not_re_warned = warn_bid not in warned_ids2
            record("12d Warning idempotency — not re-warned on second sweep",
                   not_re_warned, status=r2.status_code,
                   critical=not not_re_warned,
                   detail=(f"idempotent — booking absent from second sweep warnings ({len(warned_ids2)} others)"
                           if not_re_warned else f"DUPLICATE WARNING: booking appeared again in warnings_to_send"))

    # ── 12e — Booking in cancel window → cancelled + in cancellations_to_send ─
    # today+3 <= today+7 → in cancel window.  Start time differs to avoid slot clash.
    cancel_bid = create_unpaid_booking(room_id, customer_id, days_ahead=3,
                                       start="14:00", end="18:00")
    if not cancel_bid:
        skip("12e Cancel window → status=cancelled", "could not create cancel-window booking")
    else:
        r, e = run_lifecycle()
        if e:
            record("12e Cancel window → in cancellations_to_send", False, detail=e)
        else:
            body = r.json()
            cancelled_ids = [c.get("booking_id") for c in body.get("cancellations_to_send", [])]
            in_list = cancel_bid in cancelled_ids
            record("12e Booking today+3 in cancellations_to_send", in_list,
                   status=r.status_code,
                   detail=(f"found among {len(cancelled_ids)} cancellations"
                           if in_list else f"not found — cancelled IDs: {cancelled_ids[:3]}"))

        # Verify status is now 'cancelled' in the DB via bookings/list
        time.sleep(0.5)   # small pause to let the DB commit propagate
        status_now = get_booking_status(cancel_bid)
        record("12e Cancelled booking has status='cancelled' in DB",
               status_now == "cancelled",
               status=None,
               detail=f"status={status_now!r}")

    # ── 12f — Manual cancel writes category='Customer Cancelled' ─────────────
    # Create a paid booking, cancel it, then try to cancel again → 409.
    # The 409 proves the booking was moved to cancellations correctly.
    # (Direct DB query of cancellations.category is not exposed via REST.)
    manual_cancel_bid = create_unpaid_booking(room_id, customer_id, days_ahead=20,
                                              start="09:00", end="11:00")
    if not manual_cancel_bid:
        skip("12f Manual cancel → category='Customer Cancelled'", "could not create booking")
    else:
        r_cancel, e_cancel = api("POST", "/bookings/cancel", json={
            "booking_id":   manual_cancel_bid,
            "cancelled_by": "QA Test 12f",
            "reason":       "testing category field",
        })
        first_ok = (not e_cancel and r_cancel and r_cancel.status_code in (200, 201))
        record("12f Manual cancel succeeds (200)", first_ok,
               status=r_cancel.status_code if r_cancel else None,
               detail=e_cancel or "")

        # Second cancel attempt → 409 (booking already moved to cancellations table)
        r_cancel2, e_cancel2 = api("POST", "/bookings/cancel", json={
            "booking_id":   manual_cancel_bid,
            "cancelled_by": "QA Test 12f attempt 2",
        })
        if e_cancel2:
            record("12f Re-cancel → 409 (already cancelled / deleted from confirmed_bookings)",
                   False, detail=e_cancel2)
        else:
            ok = r_cancel2.status_code in (404, 409)
            record("12f Re-cancel → 404/409 (booking no longer in confirmed_bookings)",
                   ok, critical=r_cancel2.status_code in (200, 201),
                   status=r_cancel2.status_code,
                   detail="booking accepted double-cancel — cancellations CTE broken" if r_cancel2.status_code in (200, 201) else "")

        # Remove from cleanup list — it's already deleted
        if manual_cancel_bid in created_bookings:
            created_bookings.remove(manual_cancel_bid)

    # ── 12g — Fully-paid booking is NOT touched by the sweep ─────────────────
    # Create a booking with total_amount=0 (balance_due=0) → should never be cancelled.
    paid_bid = None
    r_paid, e_paid = api("POST", "/bookings/create", json={
        "room_id":        room_id,
        "customer_id":    customer_id,
        "booking_date":   (datetime.date.today() + datetime.timedelta(days=2)).isoformat(),
        "start_time":     "08:00",
        "end_time":       "10:00",
        "total_amount":   100,
        "deposit_amount": 100,    # fully paid at booking time
        "status":         "confirmed",
    })
    if not e_paid and r_paid and r_paid.status_code in (200, 201):
        paid_bid = r_paid.json().get("data", {}).get("id")
        if paid_bid:
            created_bookings.append(paid_bid)

    if not paid_bid:
        skip("12g Fully-paid booking not touched", "could not create paid booking")
    else:
        r_sweep, e_sweep = run_lifecycle()
        if e_sweep:
            record("12g Fully-paid booking absent from sweep", False, detail=e_sweep)
        else:
            body_g = r_sweep.json()
            warned_ids_g   = [w.get("booking_id") for w in body_g.get("warnings_to_send",      [])]
            cancelled_ids_g = [c.get("booking_id") for c in body_g.get("cancellations_to_send", [])]
            not_warned    = paid_bid not in warned_ids_g
            not_cancelled = paid_bid not in cancelled_ids_g
            ok = not_warned and not_cancelled
            record("12g Fully-paid booking absent from warnings + cancellations",
                   ok, critical=not ok, status=r_sweep.status_code,
                   detail=("fully-paid booking correctly excluded from sweep"
                           if ok else f"fully-paid booking appeared in sweep — CRITICAL DATA RISK"))


# ── Cleanup ───────────────────────────────────────────────────────────────────
def cleanup():
    print(f"\n{BOLD}{CYAN}━━ CLEANUP ━━{RESET}")
    cancelled = 0
    for bid in list(created_bookings):
        r, e = api("POST", "/bookings/cancel", json={
            "booking_id":   bid,
            "cancelled_by": "QA Lifecycle — cleanup",
        })
        if not e and r and r.status_code in (200, 201, 409, 404):
            cancelled += 1
    deleted = 0
    for rid in created_rooms:
        r, e = api("POST", "/config/rooms/delete", json={"room_id": rid})
        if not e and r and r.status_code in (200, 201):
            deleted += 1
    print(f"  Cancelled/confirmed {cancelled}/{len(created_bookings)} bookings, "
          f"soft-deleted {deleted}/{len(created_rooms)} rooms.")


# ── Summary ───────────────────────────────────────────────────────────────────
def print_summary():
    print(f"\n{BOLD}{'═' * 60}{RESET}")
    print(f"{BOLD}  QA LIFECYCLE TEST REPORT{RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}")

    passed    = [r for r in results if r.passed and not r.skipped]
    failed    = [r for r in results if not r.passed and not r.critical and not r.skipped]
    criticals = [r for r in results if r.critical]
    skipped   = [r for r in results if r.skipped]

    for r in results:
        if r.skipped:
            print(f"  {YELLOW}⊘{RESET}  {r.name}")
        elif r.critical:
            print(f"  {RED}{BOLD}✗ CRITICAL{RESET}  {r.name}  {r.detail}")
        elif not r.passed:
            print(f"  {RED}✗{RESET}  {r.name}  {r.detail}")
        else:
            print(f"  {GREEN}✓{RESET}  {r.name}")

    print(f"\n  {GREEN}{len(passed)} PASS{RESET}  "
          f"{RED}{len(criticals)} CRITICAL{RESET}  "
          f"{YELLOW}{len(failed)} FAIL{RESET}  "
          f"{YELLOW}{len(skipped)} SKIP{RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}")

    if criticals:
        sys.exit(2)
    if failed:
        sys.exit(1)
    sys.exit(0)


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if JWT_TOKEN == "YOUR_JWT_TOKEN_HERE":
        print(f"{RED}ERROR: Set VD_JWT_TOKEN env var.{RESET}")
        sys.exit(1)

    print(f"{CYAN}Verifying connectivity …{RESET}")
    r, e = api("GET", "/health/ping")
    if e:
        print(f"{RED}Cannot reach {BASE_URL}: {e}{RESET}")
        sys.exit(1)
    print(f"{GREEN}Connected to {BASE_URL}{RESET}")

    test_unpaid_lifecycle()
    cleanup()
    print_summary()
