from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse

from api_support import (
    _elapsed_ms,
    _log_endpoint_call,
    _log_endpoint_done,
    _log_endpoint_error,
    _runtime_error_status,
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
from services.single_tenant import resolve_ga4_context_for_client
from services.tenant import require_user_id

router = APIRouter(tags=["google"])

GOOGLE_ENDPOINTS = [
    "POST /api/google/ga4/sync",
    "GET /api/google/ga4/sync",
    "GET /api/google/ga4/report",
    "GET /api/google/ga4/channels",
    "GET /api/google/ga4/campaigns",
    "GET /api/google/ga4/events",
]


def _pick_ga4_client_id(client_id: str | None, x_client_id: str | None) -> str | None:
    return (client_id or "").strip() or (x_client_id or "").strip() or None


def _ga4_request_context(client_id: str | None, x_client_id: str | None) -> tuple[str, str]:
    requested = _pick_ga4_client_id(client_id, x_client_id)
    resolved_client_id, property_id = resolve_ga4_context_for_client(requested)
    print(
        "[google][ga4_context] "
        f"requested_client_id={requested or '-'} x_client_id={(x_client_id or '').strip() or '-'} "
        f"resolved_client_id={resolved_client_id} property_id={property_id}"
    )
    return resolved_client_id, property_id


def _env_present(name: str) -> bool:
    return bool((os.getenv(name) or "").strip())


def _ga4_diagnostics(
    *,
    requested_client_id: str | None,
    resolved_client_id: str | None = None,
    property_id: str | None = None,
) -> dict:
    return {
        "requested_client_id": (requested_client_id or "").strip() or None,
        "resolved_client_id": (resolved_client_id or "").strip() or None,
        "property_id": (property_id or "").strip() or None,
        "env": {
            "curavino_client_id": _env_present("CURAVINO_CLIENT_ID"),
            "curavino_ga4_property_id": _env_present("CURAVINO_GA4_PROPERTY_ID"),
            "ga4_property_id": _env_present("GA4_PROPERTY_ID"),
            "ga4_service_account_json_base64": _env_present("GA4_SERVICE_ACCOUNT_JSON_BASE64"),
            "ga4_service_account_json": _env_present("GA4_SERVICE_ACCOUNT_JSON"),
            "ga4_credentials_path": _env_present("GA4_CREDENTIALS_PATH"),
            "google_application_credentials": _env_present("GOOGLE_APPLICATION_CREDENTIALS"),
            "render": (os.getenv("RENDER") or "").strip().lower() == "true",
        },
    }


def _ga4_error_response(
    *,
    endpoint: str,
    exc: Exception,
    status_code: int,
    code: str,
    requested_client_id: str | None,
    resolved_client_id: str | None = None,
    property_id: str | None = None,
) -> JSONResponse:
    detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
    message = str(detail or "Erro na API").strip()
    return JSONResponse(
        status_code=status_code,
        content={
            "ok": False,
            "error": {
                "code": code,
                "message": message[:500],
                "type": exc.__class__.__name__,
                "endpoint": endpoint,
                "diagnostics": _ga4_diagnostics(
                    requested_client_id=requested_client_id,
                    resolved_client_id=resolved_client_id,
                    property_id=property_id,
                ),
            },
        },
    )


async def _run_ga4_sync(
    *,
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    client_id: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/sync"
    requested_client_id = client_id
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=x_client_id,
        client_id=requested_client_id or client_id,
        days=days,
        start=start,
        end=end,
    )
    resolved_client_id: str | None = None
    property_id: str | None = None
    try:
        resolved_client_id, property_id = _ga4_request_context(client_id, x_client_id)
        await require_user_id(authorization)
        payload = await sync_ga4_for_period(
            client_id=resolved_client_id,
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
            x_client_id=x_client_id,
            client_id=resolved_client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
            client_id=resolved_client_id or client_id,
        )
        return _ga4_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=exc.status_code,
            code="ga4_sync_http_error",
            requested_client_id=requested_client_id,
            resolved_client_id=resolved_client_id,
            property_id=property_id,
        )
    except RuntimeError as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
            client_id=resolved_client_id or client_id,
        )
        return _ga4_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=_runtime_error_status(exc),
            code="ga4_sync_runtime_error",
            requested_client_id=requested_client_id,
            resolved_client_id=resolved_client_id,
            property_id=property_id,
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
            client_id=resolved_client_id or client_id,
        )
        return _ga4_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=500,
            code="ga4_sync_unexpected_error",
            requested_client_id=requested_client_id,
            resolved_client_id=resolved_client_id,
            property_id=property_id,
        )


@router.api_route("/api/google/ga4/sync", methods=["GET", "POST"])
async def ga4_sync(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    client_id: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    return await _run_ga4_sync(
        start=start,
        end=end,
        days=days,
        client_id=client_id,
        x_client_id=x_client_id,
        authorization=authorization,
    )


@router.get("/api/google/ga4/report")
async def ga4_report(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=366),
    client_id: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/report"
    requested_client_id = client_id
    client_id, property_id = _ga4_request_context(client_id, x_client_id)
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=x_client_id,
        client_id=requested_client_id or client_id,
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
            x_client_id=x_client_id,
            client_id=client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
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
            x_client_id=x_client_id,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=_runtime_error_status(exc),
            code="ga4_report_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
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
    client_id: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/channels"
    requested_client_id = client_id
    client_id, property_id = _ga4_request_context(client_id, x_client_id)
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=x_client_id,
        client_id=requested_client_id or client_id,
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
            x_client_id=x_client_id,
            client_id=client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
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
            x_client_id=x_client_id,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=_runtime_error_status(exc),
            code="ga4_channels_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
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
    client_id: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/campaigns"
    requested_client_id = client_id
    client_id, property_id = _ga4_request_context(client_id, x_client_id)
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=x_client_id,
        client_id=requested_client_id or client_id,
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
            x_client_id=x_client_id,
            client_id=client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
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
            x_client_id=x_client_id,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=_runtime_error_status(exc),
            code="ga4_campaigns_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
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
    client_id: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    started = _started()
    endpoint = "/api/google/ga4/events"
    requested_client_id = client_id
    client_id, property_id = _ga4_request_context(client_id, x_client_id)
    user_for_log = await _log_endpoint_call(
        endpoint=endpoint,
        authorization=authorization,
        x_client_id=x_client_id,
        client_id=requested_client_id or client_id,
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
            x_client_id=x_client_id,
            client_id=client_id,
        )
        return payload
    except HTTPException as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
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
            x_client_id=x_client_id,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=_runtime_error_status(exc),
            code="ga4_events_runtime_error",
        )
    except Exception as exc:
        _log_endpoint_error(
            endpoint=endpoint,
            exc=exc,
            user_id=user_for_log,
            x_client_id=x_client_id,
            client_id=client_id,
        )
        return _structured_error_response(
            endpoint=endpoint,
            exc=exc,
            status_code=500,
            code="ga4_events_unexpected_error",
        )
