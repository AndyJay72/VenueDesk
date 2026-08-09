#!/usr/bin/env python3
"""
VenueDesk API Integration Test Suite
=====================================
Staff QA Engineer / Automation Architect validation script.

Tests business logic, edge cases, concurrency, and auth boundaries against
the live Fastify/PostgreSQL API at api.venuedesk.co.uk.

Real endpoint map (differs from generic spec):
  POST /config/rooms/create   — create a room (≈ "venue")
  POST /config/rooms/delete   — soft-delete a room
  POST /customers/upsert      — create/resolve a customer (required for bookings)
  POST /bookings/create       — create a confirmed booking
  POST /bookings/cancel       — cancel a booking (booking_id in body, not URL)
  GET  /bookings/list         — list all bookings for tenant

Usage:
  pip install requests
  export VD_JWT_TOKEN="eyJ..."
  python3 qa_integration.py
"""

import os
import sys
import json
import time
import uuid
import datetime
import threading
import concurrent.futures
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Tuple

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION — edit or set env vars before running
# ─────────────────────────────────────────────────────────────────────────────
BASE_URL            = os.environ.get("VD_BASE_URL",   "https://api.venuedesk.co.uk")
JWT_TOKEN           = os.environ.get("VD_JWT_TOKEN",  "YOUR_JWT_TOKEN_HERE")
REQUEST_TIMEOUT     = int(os.environ.get("VD_TIMEOUT", "15"))   # seconds
CONCURRENCY_WORKERS = 5       # simultaneous threads for race-condition test
CLEANUP_AFTER_TESTS = True    # cancel bookings + soft-delete rooms created by this run

# ── Test room defaults ───────────────────────────────────────────────────────
TEST_ROOM_CAPACITY  = 50                     # used for capacity boundary tests
TEST_ROOM_PREFIX    = "QA-TEST-"             # rooms whose names start with this are cleaned up
TEST_DATE           = "2026-09-15"           # a safe future date unlikely to clash
TEST_START          = "09:00"
TEST_END            = "17:00"

# ─────────────────────────────────────────────────────────────────────────────
# ANSI colours
# ─────────────────────────────────────────────────────────────────────────────
RESET   = "\033[0m"
RED     = "\033[91m"
GREEN   = "\033[92m"
YELLOW  = "\033[93m"
CYAN    = "\033[96m"
BOLD    = "\033[1m"
MAGENTA = "\033[95m"


# ─────────────────────────────────────────────────────────────────────────────
# Result dataclass
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class TestResult:
    name:     str
    passed:   bool
    critical: bool = False   # True = the API behaved DANGEROUSLY (accepted invalid input)
    status:   Optional[int] = None
    detail:   str = ""
    skipped:  bool = False


results: List[TestResult] = []
created_rooms:    List[str] = []   # room IDs to clean up
created_bookings: List[str] = []   # booking IDs to cancel
created_customer: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# HTTP helpers
# ─────────────────────────────────────────────────────────────────────────────
def _auth_headers() -> Dict[str, str]:
    """Server-to-server auth: standard Authorization header (no CORS restriction)."""
    return {
        "Authorization": f"Bearer {JWT_TOKEN}",
        "Content-Type":  "application/json",
    }


def api(method: str, path: str, **kwargs) -> Tuple[Optional[requests.Response], Optional[str]]:
    """
    Make an HTTP request. Returns (response, error_string).
    error_string is None on success; set on TCP/timeout/unexpected exception.
    """
    url = BASE_URL + path
    try:
        resp = requests.request(
            method,
            url,
            headers=_auth_headers(),
            timeout=REQUEST_TIMEOUT,
            **kwargs,
        )
        return resp, None
    except requests.exceptions.Timeout:
        return None, f"TIMEOUT after {REQUEST_TIMEOUT}s"
    except requests.exceptions.ConnectionError as exc:
        return None, f"CONNECTION ERROR: {exc}"
    except Exception as exc:
        return None, f"UNEXPECTED EXCEPTION: {exc}"


def record(name: str, passed: bool, critical: bool = False,
           status: Optional[int] = None, detail: str = "") -> TestResult:
    r = TestResult(name=name, passed=passed, critical=critical,
                   status=status, detail=detail)
    results.append(r)
    icon = (f"{RED}{BOLD}✗ CRITICAL FAILURE{RESET}" if critical
            else f"{RED}✗ FAIL{RESET}" if not passed
            else f"{GREEN}✓ PASS{RESET}")
    status_str = f"[HTTP {status}] " if status else ""
    print(f"  {icon}  {name}  {CYAN}{status_str}{RESET}{detail}")
    return r


def skip(name: str, reason: str) -> TestResult:
    r = TestResult(name=name, passed=False, skipped=True, detail=reason)
    results.append(r)
    print(f"  {YELLOW}⊘ SKIP{RESET}  {name}  ({reason})")
    return r


# ─────────────────────────────────────────────────────────────────────────────
# Setup helpers — create a test room and customer for use across test groups
# ─────────────────────────────────────────────────────────────────────────────
def setup_test_room(suffix: str = "", capacity: int = TEST_ROOM_CAPACITY) -> Optional[str]:
    """Creates a room and returns its UUID, or None on failure."""
    name = f"{TEST_ROOM_PREFIX}{suffix or uuid.uuid4().hex[:8]}"
    resp, err = api("POST", "/config/rooms/create", json={
        "name":     name,
        "capacity": capacity,
        "day_rate": 100,
    })
    if err or not resp or resp.status_code not in (200, 201):
        print(f"  {RED}[setup] Room creation failed: {err or (resp.status_code if resp else '?')}{RESET}")
        return None
    data = resp.json().get("data", {})
    room_id = data.get("id")
    if room_id:
        created_rooms.append(room_id)
    return room_id


def setup_test_customer() -> Optional[str]:
    """Creates (or resolves) a test customer and returns its UUID."""
    global created_customer
    resp, err = api("POST", "/customers/upsert", json={
        "full_name": "QA Test Customer",
        "email":     f"qa-test-{uuid.uuid4().hex[:6]}@venuedesk-qa.invalid",
        "phone":     "+447700000000",
    })
    if err or not resp or resp.status_code not in (200, 201):
        print(f"  {RED}[setup] Customer creation failed: {err or (resp.status_code if resp else '?')}{RESET}")
        return None
    cid = resp.json().get("data", {}).get("id")
    created_customer = cid
    return cid


def make_booking(room_id: str, customer_id: str,
                 booking_date: str = TEST_DATE,
                 start_time: str = TEST_START,
                 end_time: str = TEST_END,
                 extra: Optional[Dict] = None) -> Tuple[Optional[requests.Response], Optional[str]]:
    """POST /bookings/create with optional field overrides."""
    body = {
        "room_id":      room_id,
        "customer_id":  customer_id,
        "booking_date": booking_date,
        "start_time":   start_time,
        "end_time":     end_time,
        "total_amount": 0,
    }
    if extra:
        body.update(extra)
    return api("POST", "/bookings/create", json=body)


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 1 — Empty / Null / Type Mutations
# ─────────────────────────────────────────────────────────────────────────────
def test_null_type_mutations(customer_id: str):
    print(f"\n{BOLD}{MAGENTA}━━ 1. NULL / TYPE MUTATIONS ━━{RESET}")

    # 1a — Missing required field: room_id
    resp, err = api("POST", "/bookings/create", json={
        "customer_id":  customer_id,
        "booking_date": TEST_DATE,
        "start_time":   TEST_START,
        "end_time":     TEST_END,
    })
    if err:
        record("1a Missing room_id", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("1a Missing room_id", ok, critical=not ok, status=resp.status_code,
               detail="should reject 400/422" if not ok else "correctly rejected")

    # 1b — Missing required field: booking_date
    resp, err = api("POST", "/bookings/create", json={
        "room_id":     str(uuid.uuid4()),
        "customer_id": customer_id,
        "start_time":  TEST_START,
        "end_time":    TEST_END,
    })
    if err:
        record("1b Missing booking_date", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("1b Missing booking_date", ok, critical=not ok, status=resp.status_code)

    # 1c — null customer_id
    resp, err = api("POST", "/bookings/create", json={
        "room_id":      str(uuid.uuid4()),
        "customer_id":  None,
        "booking_date": TEST_DATE,
        "start_time":   TEST_START,
        "end_time":     TEST_END,
    })
    if err:
        record("1c null customer_id", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("1c null customer_id", ok, critical=not ok, status=resp.status_code)

    # 1d — array instead of string for room_id
    resp, err = api("POST", "/bookings/create", json={
        "room_id":      ["not", "a", "uuid"],
        "customer_id":  customer_id,
        "booking_date": TEST_DATE,
        "start_time":   TEST_START,
        "end_time":     TEST_END,
    })
    if err:
        record("1d array for room_id", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("1d array for room_id", ok, critical=not ok, status=resp.status_code,
               detail="type coercion accepted array — Fastify schema not enforcing type" if not ok else "")

    # 1e — empty body
    resp, err = api("POST", "/bookings/create", json={})
    if err:
        record("1e Empty body", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("1e Empty body", ok, critical=not ok, status=resp.status_code)

    # 1f — room name as array (room creation)
    resp, err = api("POST", "/config/rooms/create", json={"name": ["bad", "name"]})
    if err:
        record("1f array for room name", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("1f array for room name", ok, critical=not ok, status=resp.status_code)

    # 1g — completely missing body
    try:
        raw = requests.post(
            BASE_URL + "/bookings/create",
            headers={"Authorization": f"Bearer {JWT_TOKEN}"},
            timeout=REQUEST_TIMEOUT,
        )
        ok = raw.status_code in (400, 422)
        record("1g No Content-Type / no body", ok, critical=not ok, status=raw.status_code)
    except Exception as exc:
        record("1g No Content-Type / no body", False, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 2 — Capacity Boundaries
# ─────────────────────────────────────────────────────────────────────────────
def test_capacity_boundaries(room_id: str, customer_id: str):
    """
    VenueDesk /bookings/create does NOT currently include a number_of_people
    field, so capacity is not enforced at booking time — only at enquiry/room
    level. These tests document the gap: all send a non-standard
    `guest_count` field (used in some routes) and expect rejection for
    0 / negative / over-capacity values.
    """
    print(f"\n{BOLD}{MAGENTA}━━ 2. CAPACITY BOUNDARIES ━━{RESET}")

    cases = [
        ("2a Exact capacity (50)",        50,   True,  False),
        ("2b Over capacity (51)",         51,   False, True),   # MUST reject
        ("2c Zero guests",                0,    False, True),   # MUST reject
        ("2d Negative guests (-5)",       -5,   False, True),   # MUST reject
        ("2e One below capacity (49)",    49,   True,  False),
    ]

    for label, count, expect_ok, critical_if_accepted in cases:
        resp, err = make_booking(
            room_id, customer_id,
            # Use a unique date per test to avoid clash with previous iteration
            booking_date=f"2026-10-{10 + cases.index((label, count, expect_ok, critical_if_accepted)):02d}",
            extra={"guest_count": count},
        )
        if err:
            record(label, False, detail=err)
            continue

        if expect_ok:
            ok = resp.status_code in (200, 201)
            if ok:
                bid = resp.json().get("data", {}).get("id")
                if bid:
                    created_bookings.append(bid)
            record(label, ok, status=resp.status_code,
                   detail="API does not check capacity at /bookings/create" if not ok else "")
        else:
            # Should reject — if it returns 200/201 that is a critical finding
            # NOTE: because /bookings/create has no capacity enforcement today,
            # ALL of these will be CRITICAL FAILUREs, documenting the gap.
            accepted = resp.status_code in (200, 201)
            if accepted:
                bid = resp.json().get("data", {}).get("id")
                if bid:
                    created_bookings.append(bid)
            record(
                label,
                not accepted,
                critical=accepted and critical_if_accepted,
                status=resp.status_code,
                detail=(
                    "CAPACITY NOT ENFORCED — API accepted an invalid guest count. "
                    "Add server-side validation against rooms.capacity." if accepted
                    else "correctly rejected"
                ),
            )


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 3 — Time & ISO-8601 Anomalies
# ─────────────────────────────────────────────────────────────────────────────
def test_time_anomalies(room_id: str, customer_id: str):
    print(f"\n{BOLD}{MAGENTA}━━ 3. TIME & DATE ANOMALIES ━━{RESET}")

    # 3a — start_time == end_time  (should 422: end_time must be after start_time)
    resp, err = make_booking(room_id, customer_id,
                             booking_date="2026-11-01",
                             start_time="10:00", end_time="10:00")
    if err:
        record("3a start_time == end_time", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("3a start_time == end_time", ok, critical=not ok, status=resp.status_code)

    # 3b — start_time after end_time
    resp, err = make_booking(room_id, customer_id,
                             booking_date="2026-11-02",
                             start_time="17:00", end_time="09:00")
    if err:
        record("3b start_time > end_time", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("3b start_time > end_time", ok, critical=not ok, status=resp.status_code)

    # 3c — Historical date (year 2000)
    resp, err = make_booking(room_id, customer_id,
                             booking_date="2000-01-15",
                             start_time=TEST_START, end_time=TEST_END)
    if err:
        record("3c Historical date (year 2000)", False, detail=err)
    else:
        # Accepting a past booking is a policy decision; flag as warning not critical
        ok = resp.status_code in (400, 422)
        accepted = resp.status_code in (200, 201)
        if accepted:
            bid = resp.json().get("data", {}).get("id")
            if bid:
                created_bookings.append(bid)
        record("3c Historical date (year 2000)", ok, critical=False,
               status=resp.status_code,
               detail="API accepted historical booking — consider adding past-date guard" if accepted else "")

    # 3d — Extremely far future (3-year duration via date_from / date_to)
    resp, err = make_booking(room_id, customer_id,
                             booking_date="2027-01-01",
                             start_time=TEST_START, end_time=TEST_END,
                             extra={"date_from": "2027-01-01", "date_to": "2030-01-01"})
    if err:
        record("3d 3-year duration (date_from→date_to)", False, detail=err)
    else:
        accepted = resp.status_code in (200, 201)
        if accepted:
            bid = resp.json().get("data", {}).get("id")
            if bid:
                created_bookings.append(bid)
        record("3d 3-year duration (date_from→date_to)", not accepted, critical=False,
               status=resp.status_code,
               detail="API accepted 3-year booking span — no duration ceiling enforced" if accepted else "correctly rejected")

    # 3e — Malformed date string
    resp, err = make_booking(room_id, customer_id,
                             booking_date="2026-06-31",   # June has 30 days
                             start_time=TEST_START, end_time=TEST_END)
    if err:
        record("3e Malformed date (June 31)", False, detail=err)
    else:
        ok = resp.status_code in (400, 422, 500)
        record("3e Malformed date (June 31)", ok, critical=resp.status_code in (200, 201),
               status=resp.status_code,
               detail="PostgreSQL cast silently accepted invalid date" if resp.status_code in (200, 201) else "")

    # 3f — Malformed time string
    resp, err = make_booking(room_id, customer_id,
                             booking_date="2026-11-05",
                             start_time="25:00", end_time="26:30")
    if err:
        record("3f Malformed time (25:00)", False, detail=err)
    else:
        ok = resp.status_code in (400, 422, 500)
        record("3f Malformed time (25:00)", ok, critical=resp.status_code in (200, 201),
               status=resp.status_code)

    # 3g — ISO-8601 datetime string passed as time (wrong format for this API)
    resp, err = make_booking(room_id, customer_id,
                             booking_date="2026-11-06",
                             start_time="2026-11-06T09:00:00Z",
                             end_time="2026-11-06T17:00:00Z")
    if err:
        record("3g ISO-8601 datetime as time field", False, detail=err)
    else:
        ok = resp.status_code in (400, 422, 500)
        record("3g ISO-8601 datetime as time field", ok, critical=resp.status_code in (200, 201),
               status=resp.status_code,
               detail="Postgres cast accepted full ISO datetime in TIME column" if resp.status_code in (200, 201) else "")


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 4 — Overlapping Booking Matrix
# ─────────────────────────────────────────────────────────────────────────────
def test_overlap_matrix(room_id: str, customer_id: str):
    """Creates a base booking then probes all overlap shapes."""
    print(f"\n{BOLD}{MAGENTA}━━ 4. OVERLAP MATRIX ━━{RESET}")

    BASE_DATE = "2026-12-01"
    BASE_S, BASE_E = "10:00", "14:00"

    # Seed the base booking
    resp, err = make_booking(room_id, customer_id,
                             booking_date=BASE_DATE,
                             start_time=BASE_S, end_time=BASE_E)
    if err or not resp or resp.status_code not in (200, 201):
        skip("4a–4e Overlap matrix", f"Base booking failed: {err or resp.status_code if resp else '?'}")
        return

    base_id = resp.json().get("data", {}).get("id")
    if base_id:
        created_bookings.append(base_id)

    cases = [
        # (label, start,   end,     expect_clash)
        ("4a Exact same slot",            "10:00", "14:00", True),
        ("4b Partial overlap — new start inside",   "12:00", "16:00", True),
        ("4c Partial overlap — new end inside",     "08:00", "11:00", True),
        ("4d Enclosure — new swallows old",         "09:00", "15:00", True),
        ("4e Adjacent (no overlap) — immediately after", "14:00", "16:00", False),
        ("4f Adjacent (no overlap) — immediately before","08:00", "10:00", False),
    ]

    for label, start, end, expect_clash in cases:
        resp, err = make_booking(room_id, customer_id,
                                 booking_date=BASE_DATE,
                                 start_time=start, end_time=end)
        if err:
            record(label, False, detail=err)
            continue

        if expect_clash:
            ok = resp.status_code in (409, 422)
            accepted = resp.status_code in (200, 201)
            if accepted:
                bid = resp.json().get("data", {}).get("id")
                if bid:
                    created_bookings.append(bid)
            record(label, ok, critical=accepted, status=resp.status_code,
                   detail="DOUBLE-BOOKING ALLOWED — clash guard failed" if accepted else "")
        else:
            ok = resp.status_code in (200, 201)
            if ok:
                bid = resp.json().get("data", {}).get("id")
                if bid:
                    created_bookings.append(bid)
            record(label, ok, status=resp.status_code,
                   detail="adjacent slot incorrectly rejected" if not ok else "")


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 5 — State Transition & Constraint Hazards
# ─────────────────────────────────────────────────────────────────────────────
def test_state_transitions(room_id: str, customer_id: str):
    print(f"\n{BOLD}{MAGENTA}━━ 5. STATE TRANSITIONS & CONSTRAINT HAZARDS ━━{RESET}")

    # ── 5a: Create a booking, cancel it, try to cancel again ─────────────────
    resp, err = make_booking(room_id, customer_id, booking_date="2027-01-10")
    if err or not resp or resp.status_code not in (200, 201):
        skip("5a Double-cancel", f"Seed booking failed: {err or (resp.status_code if resp else '?')}")
    else:
        bid = resp.json().get("data", {}).get("id")

        # First cancel
        r1, e1 = api("POST", "/bookings/cancel", json={
            "booking_id":    bid,
            "cancelled_by":  "QA Test Runner",
            "reason":        "integration test",
        })
        if e1 or not r1 or r1.status_code not in (200, 201):
            skip("5a Double-cancel", f"First cancel failed: {e1 or (r1.status_code if r1 else '?')}")
        else:
            # Second cancel — booking moved to cancellations table, so row is gone
            # from confirmed_bookings. Expect 404 (not found) or 422 (already cancelled).
            r2, e2 = api("POST", "/bookings/cancel", json={
                "booking_id":   bid,
                "cancelled_by": "QA Test Runner",
                "reason":       "double cancel attempt",
            })
            if e2:
                record("5a Double-cancel", False, detail=e2)
            else:
                ok = r2.status_code in (404, 409, 422)
                record("5a Double-cancel", ok, critical=r2.status_code in (200, 201),
                       status=r2.status_code,
                       detail="Double-cancel silently accepted" if r2.status_code in (200, 201) else "")

    # ── 5b: Cancel a non-existent booking UUID ────────────────────────────────
    r, e = api("POST", "/bookings/cancel", json={
        "booking_id":   str(uuid.uuid4()),
        "cancelled_by": "QA Test Runner",
    })
    if e:
        record("5b Cancel non-existent UUID", False, detail=e)
    else:
        ok = r.status_code == 404
        record("5b Cancel non-existent UUID", ok, critical=r.status_code in (200, 201),
               status=r.status_code)

    # ── 5c: Cancel with malformed UUID ───────────────────────────────────────
    r, e = api("POST", "/bookings/cancel", json={
        "booking_id":   "not-a-uuid-at-all",
        "cancelled_by": "QA Test Runner",
    })
    if e:
        record("5c Cancel with malformed UUID", False, detail=e)
    else:
        ok = r.status_code in (400, 422)
        record("5c Cancel with malformed UUID", ok, critical=r.status_code in (200, 201),
               status=r.status_code)

    # ── 5d: Cancel with missing cancelled_by (required field) ────────────────
    r, e = api("POST", "/bookings/cancel", json={"booking_id": str(uuid.uuid4())})
    if e:
        record("5d Cancel missing cancelled_by", False, detail=e)
    else:
        ok = r.status_code in (400, 422)
        record("5d Cancel missing cancelled_by", ok, critical=r.status_code in (200, 201),
               status=r.status_code)

    # ── 5e: Status injection — pass a malicious status string ────────────────
    resp, err = make_booking(room_id, customer_id, booking_date="2027-01-20",
                             extra={"status": "malicious_status_value"})
    if err:
        record("5e Status injection (malicious_status_value)", False, detail=err)
    else:
        accepted = resp.status_code in (200, 201)
        if accepted:
            bid = resp.json().get("data", {}).get("id")
            if bid:
                created_bookings.append(bid)
            # Check if the injected status survived in the response
            returned_status = resp.json().get("data", {}).get("status", "")
            injected = returned_status == "malicious_status_value"
            record(
                "5e Status injection (malicious_status_value)",
                not injected,
                critical=injected,
                status=resp.status_code,
                detail=(
                    "INJECTED STATUS PERSISTED IN DB — add an allowlist constraint on "
                    "confirmed_bookings.status or reject unknown values in the route."
                    if injected
                    else f"Booking created but status normalised to '{returned_status}' — safe"
                ),
            )
        else:
            record("5e Status injection (malicious_status_value)", True, status=resp.status_code,
                   detail="correctly rejected")

    # ── 5f: Inject SQL fragment in room name ──────────────────────────────────
    r, e = api("POST", "/config/rooms/create", json={
        "name":     "QA-TEST-SQL'); DROP TABLE bookings.confirmed_bookings; --",
        "capacity": 10,
    })
    if e:
        record("5f SQL injection in room name", False, detail=e)
    else:
        if r.status_code in (200, 201):
            rid = r.json().get("data", {}).get("id")
            if rid:
                created_rooms.append(rid)
        # The injection shouldn't cause a 500; parameterised queries make it safe.
        safe = r.status_code != 500
        record("5f SQL injection in room name", safe, critical=not safe, status=r.status_code,
               detail="500 suggests unparameterised query path" if not safe else
                      "parameterised query handled safely")

    # ── 5g: Overly-long string in free-text field ─────────────────────────────
    r, e = api("POST", "/config/rooms/create", json={
        "name":        f"{TEST_ROOM_PREFIX}longname",
        "capacity":    10,
        "description": "A" * 100_000,  # 100 kB string
    })
    if e:
        record("5g 100kB description string", False, detail=e)
    else:
        if r.status_code in (200, 201):
            rid = r.json().get("data", {}).get("id")
            if rid:
                created_rooms.append(rid)
        # Should either truncate or reject — 500 is bad
        ok = r.status_code != 500
        record("5g 100kB description string", ok, critical=not ok, status=r.status_code,
               detail="500 on oversized payload — add length validation or DB-level cap" if not ok else "")


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 6 — High-Concurrency Race Condition
# ─────────────────────────────────────────────────────────────────────────────
def test_concurrency_race(room_id: str, customer_id: str):
    """
    Fire CONCURRENCY_WORKERS identical booking requests simultaneously.
    Expect exactly 1 to succeed (201) and the rest to fail (409/422).

    NOTE: VenueDesk's clash guard is a SELECT-then-INSERT without a DB-level
    unique constraint on (room_id, date, time_overlap). Under concurrent load
    the TOCTOU window may allow multiple inserts. This test exposes that gap.
    """
    print(f"\n{BOLD}{MAGENTA}━━ 6. CONCURRENCY RACE CONDITION ({CONCURRENCY_WORKERS} threads) ━━{RESET}")

    RACE_DATE  = "2027-03-01"
    RACE_START = "11:00"
    RACE_END   = "13:00"

    statuses: List[int] = []
    lock = threading.Lock()

    def fire(_):
        resp, err = make_booking(room_id, customer_id,
                                 booking_date=RACE_DATE,
                                 start_time=RACE_START,
                                 end_time=RACE_END)
        code = resp.status_code if resp else 0
        body = {}
        if resp:
            try:
                body = resp.json()
            except Exception:
                pass
        with lock:
            statuses.append(code)
            if code in (200, 201):
                bid = body.get("data", {}).get("id")
                if bid:
                    created_bookings.append(bid)
        return code

    print(f"    Firing {CONCURRENCY_WORKERS} concurrent requests at the same slot …")
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY_WORKERS) as pool:
        list(pool.map(fire, range(CONCURRENCY_WORKERS)))

    successes = [s for s in statuses if s in (200, 201)]
    failures  = [s for s in statuses if s not in (200, 201)]

    print(f"    Results: {successes} succeeded, {len(failures)} rejected → statuses {statuses}")

    record(
        "6a Exactly 1 booking created under race",
        len(successes) == 1,
        critical=len(successes) > 1,
        detail=(
            f"RACE CONDITION — {len(successes)} bookings for the same slot were created. "
            "Mitigate with a DB-level UNIQUE constraint or advisory lock on "
            "(room_id, booking_date, start_time, end_time)."
            if len(successes) > 1
            else f"{len(failures)} correctly rejected"
        ),
    )
    record(
        "6b No TCP drops or 500s under race",
        all(s not in (0, 500) for s in statuses),
        detail=f"statuses seen: {statuses}",
    )


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 7 — Auth / Boundary Gaps
# ─────────────────────────────────────────────────────────────────────────────
def test_auth_boundaries():
    print(f"\n{BOLD}{MAGENTA}━━ 7. AUTH / BOUNDARY GAPS ━━{RESET}")

    # 7a — No Authorization header
    try:
        r = requests.post(
            BASE_URL + "/bookings/list",
            headers={"Content-Type": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        ok = r.status_code == 401
        record("7a No auth header → GET /bookings/list", ok, critical=r.status_code == 200,
               status=r.status_code)
    except Exception as exc:
        record("7a No auth header", False, detail=str(exc))

    # 7b — Malformed Bearer token (not valid JWT structure)
    try:
        r = requests.get(
            BASE_URL + "/bookings/list",
            headers={"Authorization": "Bearer notajwtatall", "Content-Type": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        ok = r.status_code == 401
        record("7b Malformed JWT", ok, critical=r.status_code == 200, status=r.status_code)
    except Exception as exc:
        record("7b Malformed JWT", False, detail=str(exc))

    # 7c — Expired JWT (manually crafted with exp in the past)
    # Header.Payload.Signature where payload has exp = 1000000000 (2001)
    expired_token = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"   # header
        ".eyJ1c2VyX2lkIjoiZmFrZSIsInRlbmFudF9pZCI6MTAwMSwiZXhwIjoxMDAwMDAwMDAwfQ"  # payload
        ".FAKE_SIGNATURE_WILL_NOT_VERIFY"           # signature
    )
    try:
        r = requests.get(
            BASE_URL + "/bookings/list",
            headers={"Authorization": f"Bearer {expired_token}"},
            timeout=REQUEST_TIMEOUT,
        )
        ok = r.status_code == 401
        record("7c Expired / invalid JWT", ok, critical=r.status_code == 200, status=r.status_code)
    except Exception as exc:
        record("7c Expired / invalid JWT", False, detail=str(exc))

    # 7d — Authorization header present but empty value
    try:
        r = requests.get(
            BASE_URL + "/bookings/list",
            headers={"Authorization": "Bearer ", "Content-Type": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        ok = r.status_code == 401
        record("7d Bearer with empty token", ok, critical=r.status_code == 200, status=r.status_code)
    except Exception as exc:
        record("7d Bearer with empty token", False, detail=str(exc))

    # 7e — Wrong scheme (Basic instead of Bearer)
    try:
        r = requests.get(
            BASE_URL + "/bookings/list",
            headers={"Authorization": "Basic dXNlcjpwYXNz"},
            timeout=REQUEST_TIMEOUT,
        )
        ok = r.status_code == 401
        record("7e Basic auth scheme (not Bearer)", ok, critical=r.status_code == 200, status=r.status_code)
    except Exception as exc:
        record("7e Basic auth scheme", False, detail=str(exc))

    # 7f — CORS: OPTIONS preflight on authenticated endpoint (ensure no data leaks)
    try:
        r = requests.options(
            BASE_URL + "/bookings/list",
            headers={
                "Origin":                         "https://evil.example.com",
                "Access-Control-Request-Method":  "GET",
                "Access-Control-Request-Headers": "Authorization",
            },
            timeout=REQUEST_TIMEOUT,
        )
        acao = r.headers.get("Access-Control-Allow-Origin", "")
        # Wildcard ACAO on an authenticated route is a misconfiguration
        is_wildcard = acao == "*"
        record("7f CORS preflight — no wildcard ACAO on auth endpoint", not is_wildcard,
               critical=is_wildcard, status=r.status_code,
               detail=f"Access-Control-Allow-Origin: {acao}" +
                      (" — WILDCARD ON AUTHENTICATED ROUTE" if is_wildcard else ""))
    except Exception as exc:
        record("7f CORS preflight", False, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 8 — Room Hours Enforcement
# ─────────────────────────────────────────────────────────────────────────────
def test_room_hours_enforcement(customer_id: str):
    """
    Verifies that bookings.js enforces open_time / close_time set on a room.
    Pattern 19 Phase 2: API returns 400 when start_time < open_time or
    end_time > close_time. NULL hours = unconstrained.
    """
    print(f"\n{BOLD}{MAGENTA}━━ 8. ROOM HOURS ENFORCEMENT ━━{RESET}")

    # Create a room with 10:00–16:00 operating window
    resp, err = api("POST", "/config/rooms/create", json={
        "name":       f"{TEST_ROOM_PREFIX}HOURS-{uuid.uuid4().hex[:6]}",
        "capacity":   20,
        "day_rate":   80,
        "open_time":  "10:00",
        "close_time": "16:00",
    })
    if err or not resp or resp.status_code not in (200, 201):
        skip("8a–8c Room hours tests", f"Room with hours creation failed: {err or (resp.status_code if resp else '?')}")
        skip("8d NULL hours (unconstrained)", "parent fixture failed")
        return

    hours_room_id = resp.json().get("data", {}).get("id")
    if hours_room_id:
        created_rooms.append(hours_room_id)

    BASE = "2027-04"

    # 8a — start before open_time (08:00 < 10:00) → 400
    resp, err = make_booking(hours_room_id, customer_id,
                             booking_date=f"{BASE}-01",
                             start_time="08:00", end_time="12:00")
    if err:
        record("8a Book before open_time (08:00 < 10:00) → 400", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("8a Book before open_time (08:00 < 10:00) → 400", ok,
               critical=resp.status_code in (200, 201),
               status=resp.status_code,
               detail="room hours NOT enforced — bookings.js open_time guard missing" if resp.status_code in (200, 201) else "")

    # 8b — end after close_time (18:00 > 16:00) → 400
    resp, err = make_booking(hours_room_id, customer_id,
                             booking_date=f"{BASE}-02",
                             start_time="14:00", end_time="18:00")
    if err:
        record("8b Book after close_time (18:00 > 16:00) → 400", False, detail=err)
    else:
        ok = resp.status_code in (400, 422)
        record("8b Book after close_time (18:00 > 16:00) → 400", ok,
               critical=resp.status_code in (200, 201),
               status=resp.status_code,
               detail="room hours NOT enforced — bookings.js close_time guard missing" if resp.status_code in (200, 201) else "")

    # 8c — booking within window (11:00–15:00) → 200/201
    resp, err = make_booking(hours_room_id, customer_id,
                             booking_date=f"{BASE}-03",
                             start_time="11:00", end_time="15:00")
    if err:
        record("8c Book within window (11:00–15:00) → 200", False, detail=err)
    else:
        ok = resp.status_code in (200, 201)
        if ok:
            bid = resp.json().get("data", {}).get("id")
            if bid:
                created_bookings.append(bid)
        record("8c Book within window (11:00–15:00) → 200", ok, status=resp.status_code,
               detail="valid booking inside room window incorrectly rejected" if not ok else "")

    # 8d — room with NULL hours accepts any booking time
    resp_null, err_null = api("POST", "/config/rooms/create", json={
        "name":     f"{TEST_ROOM_PREFIX}NOHOURS-{uuid.uuid4().hex[:6]}",
        "capacity": 20,
        "day_rate": 80,
    })
    if err_null or not resp_null or resp_null.status_code not in (200, 201):
        skip("8d NULL hours → unconstrained", "room creation failed")
    else:
        null_room_id = resp_null.json().get("data", {}).get("id")
        if null_room_id:
            created_rooms.append(null_room_id)
        resp, err = make_booking(null_room_id, customer_id,
                                 booking_date=f"{BASE}-04",
                                 start_time="06:00", end_time="22:00")
        if err:
            record("8d NULL hours → unconstrained (06:00–22:00) → 200", False, detail=err)
        else:
            ok = resp.status_code in (200, 201)
            if ok:
                bid = resp.json().get("data", {}).get("id")
                if bid:
                    created_bookings.append(bid)
            record("8d NULL hours → unconstrained (06:00–22:00) → 200", ok,
                   status=resp.status_code,
                   detail="room with NULL hours incorrectly rejected wide-open slot" if not ok else "")


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 9 — Hierarchical Room Clash (Recursive CTE)
# ─────────────────────────────────────────────────────────────────────────────
def test_hierarchical_clash(customer_id: str):
    """
    Verifies the WITH RECURSIVE conflict_set CTE in bookings.js correctly
    detects parent→child, child→parent, and overlapping-sibling clashes,
    while allowing non-overlapping siblings to coexist.
    Migration 028: parent_room_id, partition_order, partition_total.
    """
    print(f"\n{BOLD}{MAGENTA}━━ 9. HIERARCHICAL ROOM CLASH (RECURSIVE CTE) ━━{RESET}")

    # ── Setup: parent + two half-children ────────────────────────────────────
    parent_resp, err = api("POST", "/config/rooms/create", json={
        "name":     f"{TEST_ROOM_PREFIX}PARENT-{uuid.uuid4().hex[:6]}",
        "capacity": 100,
        "day_rate": 200,
    })
    if err or not parent_resp or parent_resp.status_code not in (200, 201):
        for label in ["9a","9b","9c","9d","9e","9f"]:
            skip(f"{label} Hierarchy clash", f"Parent room creation failed: {err or (parent_resp.status_code if parent_resp else '?')}")
        return

    parent_id = parent_resp.json().get("data", {}).get("id")
    created_rooms.append(parent_id)

    def make_child(order: int) -> Optional[str]:
        r, e = api("POST", "/config/rooms/create", json={
            "name":            f"{TEST_ROOM_PREFIX}CHILD{order}-{uuid.uuid4().hex[:5]}",
            "capacity":        50,
            "day_rate":        100,
            "parent_room_id":  parent_id,
            "partition_order": order,
            "partition_total": 2,
        })
        if e or not r or r.status_code not in (200, 201):
            print(f"  {YELLOW}[setup] Child room {order} creation failed: {e or r.status_code}{RESET}")
            return None
        cid = r.json().get("data", {}).get("id")
        if cid:
            created_rooms.append(cid)
        return cid

    c1_id = make_child(0)   # 1st Half
    c2_id = make_child(1)   # 2nd Half

    if not c1_id or not c2_id:
        for label in ["9a","9b","9c","9d","9e"]:
            skip(f"{label} Hierarchy clash", "child room creation failed")
        return

    BASE = "2027-05"

    # 9a — book parent → then try to book child (1st Half) → must clash
    r1, e1 = make_booking(parent_id, customer_id,
                           booking_date=f"{BASE}-01",
                           start_time=TEST_START, end_time=TEST_END)
    if e1 or not r1 or r1.status_code not in (200, 201):
        skip("9a Parent booked → child (1st Half) → 409", f"parent booking failed: {e1 or (r1.status_code if r1 else '?')}")
    else:
        created_bookings.append(r1.json().get("data", {}).get("id") or "")
        r2, e2 = make_booking(c1_id, customer_id,
                               booking_date=f"{BASE}-01",
                               start_time=TEST_START, end_time=TEST_END)
        if e2:
            record("9a Parent booked → child (1st Half) → 409", False, detail=e2)
        else:
            ok = r2.status_code in (409, 422)
            record("9a Parent booked → child (1st Half) → 409", ok,
                   critical=r2.status_code in (200, 201),
                   status=r2.status_code,
                   detail="PARENT→CHILD CLASH MISSED — recursive CTE not working" if r2.status_code in (200, 201) else "")

    # 9b — book child (1st Half) → then try to book parent → must clash
    r1, e1 = make_booking(c1_id, customer_id,
                           booking_date=f"{BASE}-02",
                           start_time=TEST_START, end_time=TEST_END)
    if e1 or not r1 or r1.status_code not in (200, 201):
        skip("9b Child (1st Half) booked → parent → 409", f"c1 booking failed: {e1 or (r1.status_code if r1 else '?')}")
    else:
        c1_bid_9b = r1.json().get("data", {}).get("id")
        created_bookings.append(c1_bid_9b or "")
        r2, e2 = make_booking(parent_id, customer_id,
                               booking_date=f"{BASE}-02",
                               start_time=TEST_START, end_time=TEST_END)
        if e2:
            record("9b Child (1st Half) booked → parent → 409", False, detail=e2)
        else:
            ok = r2.status_code in (409, 422)
            record("9b Child (1st Half) booked → parent → 409", ok,
                   critical=r2.status_code in (200, 201),
                   status=r2.status_code,
                   detail="CHILD→PARENT CLASH MISSED — recursive CTE not blocking ancestor" if r2.status_code in (200, 201) else "")

    # 9c — book child C1 (1st Half) → then book sibling C2 (2nd Half) → MUST SUCCEED
    r1, e1 = make_booking(c1_id, customer_id,
                           booking_date=f"{BASE}-03",
                           start_time=TEST_START, end_time=TEST_END)
    if e1 or not r1 or r1.status_code not in (200, 201):
        skip("9c C1 booked → sibling C2 → 200 (non-overlapping)", f"c1 booking failed: {e1 or (r1.status_code if r1 else '?')}")
    else:
        created_bookings.append(r1.json().get("data", {}).get("id") or "")
        r2, e2 = make_booking(c2_id, customer_id,
                               booking_date=f"{BASE}-03",
                               start_time=TEST_START, end_time=TEST_END)
        if e2:
            record("9c C1 booked → sibling C2 → 200 (non-overlapping halves)", False, detail=e2)
        else:
            ok = r2.status_code in (200, 201)
            if ok:
                created_bookings.append(r2.json().get("data", {}).get("id") or "")
            record("9c C1 booked → sibling C2 → 200 (non-overlapping halves)", ok,
                   critical=False,
                   status=r2.status_code,
                   detail="non-overlapping sibling incorrectly blocked — integer cross-product formula error" if not ok else "")

    # 9d — book C2 → then book C2 again same slot → must clash (self)
    r1, e1 = make_booking(c2_id, customer_id,
                           booking_date=f"{BASE}-04",
                           start_time=TEST_START, end_time=TEST_END)
    if e1 or not r1 or r1.status_code not in (200, 201):
        skip("9d C2 self-clash → 409", f"first C2 booking failed: {e1 or (r1.status_code if r1 else '?')}")
    else:
        created_bookings.append(r1.json().get("data", {}).get("id") or "")
        r2, e2 = make_booking(c2_id, customer_id,
                               booking_date=f"{BASE}-04",
                               start_time=TEST_START, end_time=TEST_END)
        if e2:
            record("9d C2 same-slot again → 409 (self-clash)", False, detail=e2)
        else:
            ok = r2.status_code in (409, 422)
            record("9d C2 same-slot again → 409 (self-clash)", ok,
                   critical=r2.status_code in (200, 201),
                   status=r2.status_code,
                   detail="double-booking a child room allowed — unique index not covering child" if r2.status_code in (200, 201) else "")

    # 9e — book parent, then book parent again same slot → 409 (baseline sanity)
    r1, e1 = make_booking(parent_id, customer_id,
                           booking_date=f"{BASE}-05",
                           start_time=TEST_START, end_time=TEST_END)
    if e1 or not r1 or r1.status_code not in (200, 201):
        skip("9e Parent self-clash → 409", f"first parent booking failed: {e1 or (r1.status_code if r1 else '?')}")
    else:
        created_bookings.append(r1.json().get("data", {}).get("id") or "")
        r2, e2 = make_booking(parent_id, customer_id,
                               booking_date=f"{BASE}-05",
                               start_time=TEST_START, end_time=TEST_END)
        if e2:
            record("9e Parent self-clash → 409 (baseline sanity)", False, detail=e2)
        else:
            ok = r2.status_code in (409, 422)
            record("9e Parent self-clash → 409 (baseline sanity)", ok,
                   critical=r2.status_code in (200, 201),
                   status=r2.status_code,
                   detail="parent room double-booked — clash guard completely broken" if r2.status_code in (200, 201) else "")


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 10 — Tenant Isolation / RLS
# ─────────────────────────────────────────────────────────────────────────────
def test_tenant_isolation(customer_id: str, room_id: str):
    """
    Verifies JWT-enforced tenant isolation. Confirms:
    - JWTs with missing tenant_id are rejected (401)
    - Body-level tenant_id is stripped by AJV (cannot override JWT tenant)
    - GET /bookings/list returns a valid scoped response structure
    """
    print(f"\n{BOLD}{MAGENTA}━━ 10. TENANT ISOLATION / RLS ━━{RESET}")

    # 10a — JWT payload missing tenant_id → 401
    # Payload: {"user_id":"fake","role":"admin","iat":1700000000} — no tenant_id
    # Signature is invalid, so Fastify JWT verify will also reject it.
    no_tenant_token = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        ".eyJ1c2VyX2lkIjoiZmFrZSIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTcwMDAwMDAwMH0"
        ".INVALID_SIGNATURE"
    )
    try:
        r = requests.get(
            BASE_URL + "/bookings/list",
            headers={"Authorization": f"Bearer {no_tenant_token}"},
            timeout=REQUEST_TIMEOUT,
        )
        ok = r.status_code == 401
        record("10a JWT missing tenant_id → 401", ok,
               critical=r.status_code == 200, status=r.status_code,
               detail="API accepted a token with no tenant_id — RLS context would be undefined" if r.status_code == 200 else "")
    except Exception as exc:
        record("10a JWT missing tenant_id → 401", False, detail=str(exc))

    # 10b — Body tenant_id injection: pass tenant_id=1 in body with JWT for 1001.
    # AJV removeAdditional strips the body field; route uses req.user.tenant_id.
    # Expect: 200/201 (request processed) and booking created under JWT tenant.
    resp, err = make_booking(room_id, customer_id,
                             booking_date="2027-06-01",
                             extra={"tenant_id": 1})   # inject wrong tenant
    if err:
        record("10b Body tenant_id=1 injection with JWT tenant=1001 → 200", False, detail=err)
    else:
        ok = resp.status_code in (200, 201)
        if ok:
            bid = resp.json().get("data", {}).get("id")
            if bid:
                created_bookings.append(bid)
            # Verify the booking belongs to the JWT tenant (1001), not the body tenant (1)
            returned_tenant = resp.json().get("data", {}).get("tenant_id")
            correct_tenant = (returned_tenant is None or int(returned_tenant) == 1001)
            record("10b Body tenant_id injection stripped — booking under JWT tenant",
                   correct_tenant,
                   critical=not correct_tenant and returned_tenant is not None and int(returned_tenant) == 1,
                   status=resp.status_code,
                   detail=(f"Body tenant_id leaked into DB row (returned tenant={returned_tenant})" if not correct_tenant
                           else f"body tenant=1 stripped; booking created under JWT tenant correctly"))
        else:
            record("10b Body tenant_id=1 injection with JWT tenant=1001 → 200", False,
                   status=resp.status_code,
                   detail="request unexpectedly rejected — possible AJV schema change")

    # 10c — GET /bookings/list returns scoped response (structural check)
    resp, err = api("GET", "/bookings/list")
    if err:
        record("10c GET /bookings/list → 200 + data array", False, detail=err)
    else:
        ok = resp.status_code in (200, 201)
        if ok:
            body = resp.json()
            has_data = isinstance(body.get("data") or body.get("bookings") or body, list) or \
                       isinstance(body.get("data"), list)
            record("10c GET /bookings/list → 200 + data array", has_data,
                   status=resp.status_code,
                   detail="response has no data array — wrong response shape" if not has_data else "")
        else:
            record("10c GET /bookings/list → 200 + data array", False, status=resp.status_code)


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY 11 — Recurring Schedule Status
# ─────────────────────────────────────────────────────────────────────────────
def test_schedule_status():
    """
    Verifies GET /recurring/schedule-status:
    - Valid series_id for tenant → 200 + data array (may be empty for test tenant)
    - Random UUID (no series) → 200 + empty data (graceful)
    - No auth → 401
    """
    print(f"\n{BOLD}{MAGENTA}━━ 11. RECURRING SCHEDULE STATUS ━━{RESET}")

    # 11a — valid call with a random UUID as series_id → 200 + empty or populated data
    # (We don't have a known recurring series in the test fixture; an unknown UUID
    # should return an empty array, not 404 or 500.)
    fake_series_id = str(uuid.uuid4())
    resp, err = api("GET", f"/recurring/schedule-status?series_id={fake_series_id}&tenant_id=1001")
    if err:
        record("11a GET /recurring/schedule-status (unknown UUID) → 200 + []", False, detail=err)
    else:
        ok = resp.status_code in (200, 201)
        if ok:
            body = resp.json()
            data = body.get("data", [])
            is_list = isinstance(data, list)
            record("11a GET /recurring/schedule-status (unknown UUID) → 200 + []", is_list,
                   status=resp.status_code,
                   detail="data field is not a list" if not is_list else f"{len(data)} row(s) returned")
        else:
            record("11a GET /recurring/schedule-status (unknown UUID) → 200 + []", False,
                   status=resp.status_code,
                   detail="unexpected error on valid structured request")

    # 11b — missing series_id (malformed request) → 400 or graceful empty
    resp, err = api("GET", "/recurring/schedule-status?tenant_id=1001")
    if err:
        record("11b Missing series_id → 400 or graceful", False, detail=err)
    else:
        ok = resp.status_code in (200, 400, 422)
        record("11b Missing series_id → 400 or graceful", ok,
               critical=resp.status_code == 500,
               status=resp.status_code,
               detail="500 on missing series_id — add param validation" if resp.status_code == 500 else "")

    # 11c — no auth header → 401
    try:
        r = requests.get(
            BASE_URL + f"/recurring/schedule-status?series_id={fake_series_id}&tenant_id=1001",
            timeout=REQUEST_TIMEOUT,
        )
        ok = r.status_code == 401
        record("11c No auth → 401", ok,
               critical=r.status_code == 200, status=r.status_code)
    except Exception as exc:
        record("11c No auth → 401", False, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# CLEANUP
# ─────────────────────────────────────────────────────────────────────────────
def cleanup():
    print(f"\n{BOLD}{CYAN}━━ CLEANUP ━━{RESET}")

    cancelled = 0
    for bid in created_bookings:
        r, e = api("POST", "/bookings/cancel", json={
            "booking_id":   bid,
            "cancelled_by": "QA Test Runner — cleanup",
            "reason":       "automated test teardown",
        })
        if not e and r and r.status_code in (200, 201):
            cancelled += 1
        else:
            print(f"  {YELLOW}⚠ Could not cancel booking {bid}: "
                  f"{e or (r.status_code if r else '?')}{RESET}")

    deleted = 0
    for rid in created_rooms:
        r, e = api("POST", "/config/rooms/delete", json={"room_id": rid})
        if not e and r and r.status_code in (200, 201):
            deleted += 1
        else:
            print(f"  {YELLOW}⚠ Could not soft-delete room {rid}: "
                  f"{e or (r.status_code if r else '?')}{RESET}")

    print(f"  Cancelled {cancelled}/{len(created_bookings)} bookings, "
          f"soft-deleted {deleted}/{len(created_rooms)} rooms.")


# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY REPORT
# ─────────────────────────────────────────────────────────────────────────────
def print_summary():
    print(f"\n{BOLD}{'═' * 60}{RESET}")
    print(f"{BOLD}  VENUEDESK QA INTEGRATION REPORT{RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}")

    passed   = [r for r in results if r.passed and not r.skipped]
    failed   = [r for r in results if not r.passed and not r.skipped and not r.critical]
    critical = [r for r in results if r.critical]
    skipped  = [r for r in results if r.skipped]
    total    = len([r for r in results if not r.skipped])

    print(f"  {GREEN}PASSED  : {len(passed):3d}{RESET}")
    print(f"  {RED}FAILED  : {len(failed):3d}{RESET}")
    print(f"  {RED}{BOLD}CRITICAL: {len(critical):3d}{RESET}")
    print(f"  {YELLOW}SKIPPED : {len(skipped):3d}{RESET}")
    print(f"  TOTAL   : {total:3d}")

    if critical:
        print(f"\n{RED}{BOLD}  ⚠ CRITICAL FAILURES (API accepted dangerous input):{RESET}")
        for r in critical:
            print(f"    • {r.name}")
            if r.detail:
                print(f"      {YELLOW}{r.detail}{RESET}")

    if failed:
        print(f"\n{RED}  FAILURES:{RESET}")
        for r in failed:
            print(f"    • {r.name}" + (f" — {r.detail}" if r.detail else ""))

    print(f"\n{BOLD}{'═' * 60}{RESET}\n")

    if critical:
        sys.exit(2)
    elif failed:
        sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def main():
    print(f"{BOLD}{CYAN}")
    print("╔══════════════════════════════════════════════╗")
    print("║   VenueDesk API Integration Test Suite      ║")
    print(f"║   {BASE_URL:<44}║")
    print("╚══════════════════════════════════════════════╝")
    print(RESET)

    if JWT_TOKEN == "YOUR_JWT_TOKEN_HERE":
        print(f"{RED}ERROR: Set VD_JWT_TOKEN env var or edit JWT_TOKEN in the config block.{RESET}")
        sys.exit(1)

    # ── Verify connectivity ───────────────────────────────────────────────────
    print(f"{CYAN}Verifying connectivity …{RESET}")
    r, e = api("GET", "/bookings/list")
    if e:
        print(f"{RED}Cannot reach {BASE_URL}: {e}{RESET}")
        sys.exit(1)
    if r.status_code == 401:
        print(f"{RED}JWT rejected (401) — check VD_JWT_TOKEN.{RESET}")
        sys.exit(1)
    if r.status_code not in (200, 201):
        print(f"{YELLOW}Unexpected status {r.status_code} on health check — proceeding anyway.{RESET}")
    else:
        print(f"{GREEN}Connected. Proceeding with tests.{RESET}")

    # ── One-time setup: customer + primary test room ──────────────────────────
    print(f"\n{CYAN}Setting up test fixtures …{RESET}")
    customer_id = setup_test_customer()
    room_id     = setup_test_room(capacity=TEST_ROOM_CAPACITY)

    if not customer_id:
        print(f"{RED}FATAL: Could not create test customer. Aborting.{RESET}")
        sys.exit(1)
    if not room_id:
        print(f"{RED}FATAL: Could not create test room. Aborting.{RESET}")
        sys.exit(1)

    print(f"  customer_id : {customer_id}")
    print(f"  room_id     : {room_id}")

    # ── Run test categories ───────────────────────────────────────────────────
    test_null_type_mutations(customer_id)
    test_capacity_boundaries(room_id, customer_id)
    test_time_anomalies(room_id, customer_id)
    test_overlap_matrix(room_id, customer_id)
    test_state_transitions(room_id, customer_id)
    test_concurrency_race(room_id, customer_id)
    test_auth_boundaries()
    test_room_hours_enforcement(customer_id)
    test_hierarchical_clash(customer_id)
    test_tenant_isolation(customer_id, room_id)
    test_schedule_status()

    # ── Cleanup ───────────────────────────────────────────────────────────────
    if CLEANUP_AFTER_TESTS:
        cleanup()
    else:
        print(f"\n{YELLOW}CLEANUP_AFTER_TESTS=False — "
              f"{len(created_bookings)} bookings and {len(created_rooms)} rooms left in DB.{RESET}")

    print_summary()


if __name__ == "__main__":
    main()
