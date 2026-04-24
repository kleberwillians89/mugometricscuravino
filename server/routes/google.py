from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query

from api_support import (
    _elapsed_ms,
    _log_endpoint_call,
    _log_endpoint_done,
    _log_endpoint_error,
    _started,
    _structured_error_response,
)
from services.ga4_reporting import (
    build_ga4_campaigns_report,
    build_ga4_channels_report,
    build_ga4_events_report,
    build_ga4_report,
    resolve_ga4_report_period,
)
from services.ga4_sync import sync_ga4_for_period
from services.single_tenant import get_roove_client_id, get_roove_ga4_property_id
from services.tenant import require_user_id

router = APIRouter(tags=["google"])

GOOGLE_ENDPOINTS = [
    "POST /api/google/ga4/sync",
    "GET /api/google/ga4/report",
    "GET /api/google/ga4/channels",
    "GET /api/google/ga4/campaigns",
    "GET /api/google/ga4/events",
]


def _ga4_fixed_context() -> tuple[str, str]:
    return get_roove_client_id(), get_roove_ga4_property_id()


@router.post("/api/google/ga4/sync")
async def ga4_sync(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/sync"
    client_id, property_id = _ga4_fixed_context()
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=None,
        client_id=client_id,
        days=days,
        start=start,
        end=end,
    )
    try:
        await require_user_id(authorization)
        payload = await sync_ga4_for_period(
            client_id=client_id,
            property_id=property_id,
            since=start,
            until=end,
            days=days,
            job_name="ga4_sync_manual",
            trigger_source="manual_api",
            record_job_run=True,
        )
        _log_endpoint_done(
            endpoint=endpoint,
            started=started,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=exc.status_code,
            code="ga4_sync_http_error",
        )
    except RuntimeError as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=400,
            code="ga4_sync_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=500,
            code="ga4_sync_unexpected_error",
        )


@router.get("/api/google/ga4/report")
async def ga4_report(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/report"
    client_id, property_id = _ga4_fixed_context()
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=None,
        client_id=client_id,
        days=days,
        start=start,
        end=end,
    )
    try:
        await require_user_id(authorization)
        period = resolve_ga4_report_period(start=start, end=end, days=days)
        payload = await build_ga4_report(
            client_id=client_id,
            property_id=property_id,
            period=period,
        )
        _log_endpoint_done(
            endpoint=endpoint,
            started=started,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=exc.status_code,
            code="ga4_report_http_error",
        )
    except RuntimeError as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=400,
            code="ga4_report_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=500,
            code="ga4_report_unexpected_error",
        )


@router.get("/api/google/ga4/channels")
async def ga4_channels(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/channels"
    client_id, property_id = _ga4_fixed_context()
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=None,
        client_id=client_id,
        days=days,
        start=start,
        end=end,
    )
    try:
        await require_user_id(authorization)
        period = resolve_ga4_report_period(start=start, end=end, days=days)
        payload = await build_ga4_channels_report(
            client_id=client_id,
            property_id=property_id,
            period=period,
        )
        _log_endpoint_done(
            endpoint=endpoint,
            started=started,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=exc.status_code,
            code="ga4_channels_http_error",
        )
    except RuntimeError as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=400,
            code="ga4_channels_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=500,
            code="ga4_channels_unexpected_error",
        )


@router.get("/api/google/ga4/campaigns")
async def ga4_campaigns(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/campaigns"
    client_id, property_id = _ga4_fixed_context()
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=None,
        client_id=client_id,
        days=days,
        start=start,
        end=end,
    )
    try:
        await require_user_id(authorization)
        period = resolve_ga4_report_period(start=start, end=end, days=days)
        payload = await build_ga4_campaigns_report(
            client_id=client_id,
            property_id=property_id,
            period=period,
        )
        _log_endpoint_done(
            endpoint=endpoint,
            started=started,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=exc.status_code,
            code="ga4_campaigns_http_error",
        )
    except RuntimeError as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=400,
            code="ga4_campaigns_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=500,
            code="ga4_campaigns_unexpected_error",
        )


@router.get("/api/google/ga4/events")
async def ga4_events(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/events"
    client_id, property_id = _ga4_fixed_context()
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=None,
        client_id=client_id,
        days=days,
        start=start,
        end=end,
    )
    try:
        await require_user_id(authorization)
        period = resolve_ga4_report_period(start=start, end=end, days=days)
        payload = await build_ga4_events_report(
            client_id=client_id,
            property_id=property_id,
            period=period,
        )
        _log_endpoint_done(
            endpoint=endpoint,
            started=started,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=exc.status_code,
            code="ga4_events_http_error",
        )
    except RuntimeError as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=400,
            code="ga4_events_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=None,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=500,
            code="ga4_events_unexpected_error",
        )
