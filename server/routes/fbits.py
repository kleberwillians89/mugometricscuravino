from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse, Response

from api_support import (
    _log_endpoint_call,
    _log_endpoint_done,
    _log_endpoint_error,
    _runtime_error_status,
    _started,
    _structured_error_response,
)
from services.fbits_client import check_fbits_health
from services.ig_supabase import sb_select
from services.fbits_reporting import (
    backfill_fbits_orders,
    build_fbits_orders_debug,
    build_fbits_orders_report,
    build_fbits_reconciliation_debug,
    build_fbits_summary,
    get_official_commerce_summary,
    resolve_fbits_period,
    sync_fbits_orders,
)
from services.tenant import resolve_client_id

router = APIRouter(tags=["fbits"])

NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
}


def _no_cache_json(payload):
    if isinstance(payload, Response):
        payload.headers.update(NO_CACHE_HEADERS)
        return payload
    return JSONResponse(content=payload, headers=NO_CACHE_HEADERS)


def _safe_float(value) -> float:
    try:
        if value is None or value == "":
            return 0.0
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip().replace("R$", "").replace(" ", "")
        if "," in text and "." in text and text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        elif "," in text:
            text = text.replace(",", ".")
        return float("".join(char for char in text if char.isdigit() or char in {".", "-"}) or 0)
    except Exception:
        return 0.0


def _safe_error(exc: Exception) -> str:
    response = getattr(exc, "response", None)
    status_code = getattr(response, "status_code", None)
    body = str(getattr(response, "text", "") or "").replace("\n", " ").replace("\r", " ").strip()
    if len(body) > 300:
        body = f"{body[:300]}..."
    if status_code:
        return f"{exc.__class__.__name__}: status={status_code} body={body or '-'}"
    return f"{exc.__class__.__name__}: {str(exc)[:300]}"


def _end_exclusive(value: str) -> str:
    try:
        parsed = date.fromisoformat(str(value or "")[:10])
    except ValueError:
        parsed = date.today()
    return (parsed + timedelta(days=1)).isoformat()


def _field_audit(field: str, rows: list[dict]) -> dict:
    dates = sorted(str(row.get(field) or "") for row in rows if str(row.get(field) or "").strip())
    status_counts: dict[str, int] = {}
    for row in rows:
        status = str(row.get("status_id") or row.get("status_name") or "-")
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "field": field,
        "rows": len(rows),
        "first_order_date": dates[0] if dates else None,
        "last_order_date": dates[-1] if dates else None,
        "total_revenue": round(sum(_safe_float(row.get("total_value")) for row in rows), 2),
        "status_counts": dict(sorted(status_counts.items(), key=lambda item: item[0])),
    }


async def _fbits_context(
    *,
    client_id: str | None,
    x_client_id: str | None,
    authorization: str | None,
) -> str:
    requested = (client_id or "").strip() or (x_client_id or "").strip() or None
    return await resolve_client_id(requested, authorization)


async def _run_fbits_endpoint(
    *,
    endpoint: str,
    client_id: str | None,
    x_client_id: str | None,
    authorization: str | None,
    start: str | None,
    end: str | None,
    days: int,
    operation: str,
):
    started = _started()
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=x_client_id,
        client_id=client_id,
        days=days,
        start=start,
        end=end,
    )
    try:
        cid = await _fbits_context(
            client_id=client_id,
            x_client_id=x_client_id,
            authorization=authorization,
        )
        period = resolve_fbits_period(start=start, end=end, days=days)
        if operation == "summary":
            payload = await get_official_commerce_summary(client_id=cid, start=period.start, end=period.end)
        elif operation == "orders":
            payload = await build_fbits_orders_report(client_id=cid, period=period)
        elif operation == "sync":
            payload = await sync_fbits_orders(client_id=cid, period=period)
        elif operation == "backfill":
            payload = await backfill_fbits_orders(client_id=cid, period=period)
        elif operation == "debug":
            payload = await build_fbits_orders_debug(client_id=cid, period=period)
        else:
            payload = await build_fbits_reconciliation_debug(client_id=cid, period=period)
        _log_endpoint_done(
            endpoint=endpoint,
            started=started,
            user_id=user_for_log,
            x_client_id=x_client_id,
            client_id=cid,
            days=days,
            start=period.start,
            end=period.end,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(endpoint=endpoint, exc=exc, user_id=user_for_log, x_client_id=x_client_id, client_id=client_id)
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=exc.status_code,
            code="fbits_http_error",
        )
    except RuntimeError as exc:
        _log_endpoint_error(endpoint=endpoint, exc=exc, user_id=user_for_log, x_client_id=x_client_id, client_id=client_id)
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=_runtime_error_status(exc),
            code="fbits_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(endpoint=endpoint, exc=exc, user_id=user_for_log, x_client_id=x_client_id, client_id=client_id)
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=500,
            code="fbits_unexpected_error",
        )


@router.get("/api/fbits/dashboard")
async def fbits_dashboard(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    payload = await _run_fbits_endpoint(
        endpoint="/api/fbits/dashboard",
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
        start=start,
        end=end,
        days=days,
        operation="summary",
    )
    return _no_cache_json(payload)


@router.get("/api/fbits/health")
async def fbits_health(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    cid = await _fbits_context(
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
    )
    today = date.today().isoformat()
    payload = await check_fbits_health(start=start or today, end=end or start or today)
    payload["client_id"] = cid
    return _no_cache_json(payload)


@router.get("/api/fbits/debug-data")
async def fbits_debug_data(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    cid = await _fbits_context(
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
    )
    today = date.today().isoformat()
    start_value = (start or today)[:10]
    end_value = (end or start or today)[:10]
    end_exclusive = _end_exclusive(end_value)
    payload = {
        "ok": True,
        "client_id": cid,
        "period": {
            "start": start_value,
            "end": end_value,
            "start_inclusive": f"{start_value}T00:00:00",
            "end_exclusive": f"{end_exclusive}T00:00:00",
        },
        "supabase": {
            "can_query": False,
            "error": None,
        },
        "fbits_orders": {
            "rows": 0,
            "revenue": 0.0,
        },
        "fbits_order_daily_stats": {
            "rows": 0,
            "revenue": 0.0,
        },
        "date_filter": {
            "gte": f"{start_value}T00:00:00",
            "lt": f"{end_exclusive}T00:00:00",
            "timezone_note": "Comparação feita no valor armazenado no Supabase; sem conversão adicional no backend.",
        },
        "date_field_used": None,
        "date_field_audit": {},
        "debug_version": "fbits-supabase-debug-v1",
    }
    try:
        audit: dict[str, dict] = {}
        rows_by_field: dict[str, list[dict]] = {}
        for field in ("order_date", "approved_at", "created_at", "payment_date", "created_at_fbits"):
            try:
                rows = await sb_select(
                    "fbits_orders",
                    select=f"order_id,total_value,status_id,status_name,{field}",
                    filters={
                        "client_id": f"eq.{cid}",
                        "and": f"({field}.gte.{start_value}T00:00:00,{field}.lt.{end_exclusive}T00:00:00)",
                    },
                    order=f"{field}.asc",
                    limit=20000,
                )
                rows_by_field[field] = rows
                audit[field] = _field_audit(field, rows)
                print(
                    "[fbits][debug_data][date_field] "
                    f"client_id={cid} field={field} rows={audit[field]['rows']} "
                    f"revenue={audit[field]['total_revenue']} first={audit[field]['first_order_date']} "
                    f"last={audit[field]['last_order_date']}"
                )
            except Exception as field_exc:
                audit[field] = {
                    "field": field,
                    "rows": 0,
                    "first_order_date": None,
                    "last_order_date": None,
                    "total_revenue": 0.0,
                    "error": _safe_error(field_exc),
                }
                rows_by_field[field] = []
                print(
                    "[fbits][debug_data][date_field_error] "
                    f"client_id={cid} field={field} error={audit[field]['error']}"
                )

        date_field_used = "order_date" if rows_by_field.get("order_date") else "approved_at"
        order_rows = rows_by_field.get(date_field_used) or []
        if not order_rows and rows_by_field.get("created_at"):
            date_field_used = "created_at"
            order_rows = rows_by_field["created_at"]
        if not order_rows and rows_by_field.get("payment_date"):
            date_field_used = "payment_date"
            order_rows = rows_by_field["payment_date"]
        if not order_rows and rows_by_field.get("created_at_fbits"):
            date_field_used = "created_at_fbits"
            order_rows = rows_by_field["created_at_fbits"]

        daily_rows = await sb_select(
            "fbits_order_daily_stats",
            select="stat_date,receita_oficial,pedidos",
            filters={
                "client_id": f"eq.{cid}",
                "and": f"(stat_date.gte.{start_value},stat_date.lte.{end_value})",
            },
            limit=500,
        )
        payload["supabase"]["can_query"] = True
        payload["date_field_used"] = date_field_used
        payload["date_field_audit"] = audit
        payload["fbits_orders"] = {
            **_field_audit(date_field_used, order_rows),
            "date_field_used": date_field_used,
        }
        payload["fbits_order_daily_stats"] = {
            "rows": len(daily_rows),
            "revenue": round(sum(_safe_float(row.get("receita_oficial")) for row in daily_rows), 2),
        }
    except Exception as exc:
        payload["ok"] = False
        payload["supabase"]["error"] = _safe_error(exc)
    return JSONResponse(content=payload, headers=NO_CACHE_HEADERS)


# Compatibilidade com a rota criada durante a primeira leitura FBits.
@router.get("/api/fbits/orders/summary")
async def fbits_orders_summary(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    return await _run_fbits_endpoint(
        endpoint="/api/fbits/orders/summary",
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
        start=start,
        end=end,
        days=days,
        operation="summary",
    )


@router.get("/api/fbits/orders")
async def fbits_orders(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    return await _run_fbits_endpoint(
        endpoint="/api/fbits/orders",
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
        start=start,
        end=end,
        days=days,
        operation="orders",
    )


@router.post("/api/fbits/sync")
async def fbits_sync(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    return await _run_fbits_endpoint(
        endpoint="/api/fbits/sync",
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
        start=start,
        end=end,
        days=days,
        operation="sync",
    )


@router.post("/api/fbits/backfill-orders")
async def fbits_backfill_orders(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    payload = await _run_fbits_endpoint(
        endpoint="/api/fbits/backfill-orders",
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
        start=start,
        end=end,
        days=days,
        operation="backfill",
    )
    return JSONResponse(content=payload, headers=NO_CACHE_HEADERS)


@router.get("/api/fbits/debug/orders")
async def fbits_debug_orders(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    return await _run_fbits_endpoint(
        endpoint="/api/fbits/debug/orders",
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
        start=start,
        end=end,
        days=days,
        operation="debug",
    )


@router.get("/api/fbits/debug/reconciliation")
async def fbits_debug_reconciliation(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    return await _run_fbits_endpoint(
        endpoint="/api/fbits/debug/reconciliation",
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
        start=start,
        end=end,
        days=days,
        operation="reconciliation",
    )
