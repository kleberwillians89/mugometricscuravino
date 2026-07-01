from __future__ import annotations

from fastapi import APIRouter, Header, Query
from fastapi.responses import Response

from api_support import _pick_client_id
from services.ig_supabase import sb_select
from services.static_report_pdf import build_static_report_filename, build_static_report_pdf
from services.static_reporting import build_static_report
from services.tenant import resolve_client_id

router = APIRouter()


@router.get("/api/reports/static")
async def api_static_report(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    cid = await resolve_client_id(_pick_client_id(client_id, x_client_id), authorization)
    return await build_static_report(client_id=cid, start=start, end=end)


async def _resolve_client_name(client_id: str) -> str:
    try:
        rows = await sb_select("clients", select="name,slug", filters={"id": f"eq.{client_id}"}, limit=1)
    except Exception as exc:
        print(f"[static_report_pdf][client_name_fallback] client_id={client_id} error={exc.__class__.__name__}")
        rows = []
    if rows:
        row = rows[0]
        return str(row.get("name") or row.get("slug") or "Cliente").strip() or "Cliente"
    return "Cliente"


@router.get("/api/reports/static/pdf")
async def api_static_report_pdf(
    client_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
):
    cid = await resolve_client_id(_pick_client_id(client_id, x_client_id), authorization)
    report = await build_static_report(client_id=cid, start=start, end=end)
    client_name = await _resolve_client_name(cid)
    pdf = build_static_report_pdf(report, client_name=client_name)
    filename = build_static_report_filename(client_name, report)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
