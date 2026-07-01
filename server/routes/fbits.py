from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse

from api_support import (
    _log_endpoint_call,
    _log_endpoint_done,
    _log_endpoint_error,
    _runtime_error_status,
    _started,
    _structured_error_response,
)
from services.fbits_client import check_fbits_health
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
    return JSONResponse(content=payload, headers=NO_CACHE_HEADERS)


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
