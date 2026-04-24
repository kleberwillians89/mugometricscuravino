from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from .connection_resolver import resolve_connection_for_scope
from .ig_meta import (
    download_image,
    fetch_kpis_total_value,
    fetch_media_comments,
    fetch_media_insights,
    fetch_media_list,
    fetch_profile,
)
from .ig_supabase import sb_get_one, sb_insert, sb_select, sb_update, sb_upsert, sb_upload_public
from .meta_tokens import ensure_valid_meta_token


def _utc_date_str() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_meta_ts(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    if len(raw) >= 5 and (raw.endswith("+0000") or raw.endswith("-0000")):
        raw = f"{raw[:-5]}{raw[-5:-2]}:{raw[-2:]}"
    return raw


def _classify_meta_error(exc: Exception) -> str:
    msg = str(exc)
    if "\"code\":10" in msg or "(#10)" in msg:
        return "permission_denied"
    if "\"code\":190" in msg:
        return "token_expired"
    return "error"


def _empty_kpis() -> Dict[str, int]:
    return {
        "impressions": 0,
        "views": 0,
        "reach": 0,
        "profile_views": 0,
        "website_clicks": 0,
        "accounts_engaged": 0,
        "total_interactions": 0,
    }


async def _resolve_connection_by_id(connection_id: str) -> Optional[Dict[str, Any]]:
    rows = await sb_select("meta_connections", filters={"id": f"eq.{connection_id}"}, limit=1)
    return rows[0] if rows else None


async def _mark_connection_success(connection_id: str) -> None:
    await sb_update(
        "meta_connections",
        filters={"id": f"eq.{connection_id}"},
        patch={"last_synced_at": _iso_now(), "last_error": None, "status": "active"},
        returning="minimal",
    )


async def _mark_connection_error(connection_id: str, message: str) -> None:
    await sb_update(
        "meta_connections",
        filters={"id": f"eq.{connection_id}"},
        patch={"last_error": (message or "")[:1000], "status": "error"},
        returning="minimal",
    )


async def _run_sync_for_client_and_ig(
    *,
    client_id: str,
    connection_id: str,
    ig_user_id: str,
    access_token: str,
    limit: int,
) -> Dict[str, Any]:
    warnings: List[str] = []
    block_status: Dict[str, Dict[str, Any]] = {
        "profile": {"ok": False, "status": "pending"},
        "media": {"ok": False, "status": "pending"},
        "comments": {"ok": False, "status": "pending"},
        "insights": {"ok": False, "status": "pending"},
    }

    profile = await fetch_profile(ig_user_id, access_token)
    block_status["profile"] = {"ok": True, "status": "ok"}

    media: List[Dict[str, Any]] = []
    try:
        media = await fetch_media_list(ig_user_id, access_token, limit=limit)
        block_status["media"] = {"ok": True, "status": "ok", "count": len(media)}
    except Exception as exc:
        block_status["media"] = {
            "ok": False,
            "status": _classify_meta_error(exc),
            "detail": str(exc)[:180],
        }
        print(
            "[ig_sync][meta_error] "
            f"block=media client_id={client_id} ig_user_id={ig_user_id} error={str(exc)[:280]}"
        )
        warnings.append("Falha parcial na listagem de mídias.")

    kpis = _empty_kpis()
    try:
        kpis = await fetch_kpis_total_value(ig_user_id, access_token)
        block_status["insights"] = {"ok": True, "status": "ok"}
    except Exception as exc:
        block_status["insights"] = {
            "ok": False,
            "status": _classify_meta_error(exc),
            "detail": str(exc)[:180],
        }
        print(
            "[ig_sync][meta_error] "
            f"block=insights client_id={client_id} ig_user_id={ig_user_id} error={str(exc)[:280]}"
        )
        warnings.append("Falha parcial em insights do perfil.")

    enriched: List[Dict[str, Any]] = []
    media_rows: List[Dict[str, Any]] = []
    comment_rows: List[Dict[str, Any]] = []

    for m in media:
        media_id = str(m.get("id") or "").strip()
        if not media_id:
            continue

        product_type = str(m.get("media_product_type") or "FEED").upper()
        media_type = str(m.get("media_type") or "").upper()

        insights: Dict[str, Any] = {}
        try:
            insights = await fetch_media_insights(media_id, access_token, product_type)
        except Exception:
            insights = {}

        likes_fallback = int(m.get("like_count") or 0)
        comments_fallback = int(m.get("comments_count") or 0)
        if int(insights.get("likes") or 0) == 0 and likes_fallback > 0:
            insights["likes"] = likes_fallback
        if int(insights.get("comments") or 0) == 0 and comments_fallback > 0:
            insights["comments"] = comments_fallback
        if int(insights.get("total_interactions") or 0) == 0:
            fallback_interactions = int(insights.get("likes") or 0) + int(insights.get("comments") or 0)
            if fallback_interactions > 0:
                insights["total_interactions"] = fallback_interactions

        if int(m.get("comments_count") or 0) > 0:
            try:
                comments = await fetch_media_comments(media_id, access_token, limit=200)
                for c in comments:
                    comment_rows.append(
                        {
                            "client_id": client_id,
                            "media_id": media_id,
                            "comment_id": str(c.get("id") or ""),
                            "text": c.get("text") or "",
                            "username": c.get("username") or "",
                            "timestamp": c.get("timestamp"),
                        }
                    )
            except Exception:
                print(
                    "[ig_sync][meta_error] "
                    f"block=comments client_id={client_id} media_id={media_id} error=fetch_comments_failed"
                )

        thumb_url = m.get("thumbnail_url")
        if not thumb_url and media_type in {"IMAGE", "CAROUSEL_ALBUM"}:
            thumb_url = m.get("media_url")

        public_thumb = None
        if thumb_url:
            try:
                content, ctype = await download_image(thumb_url)
                path = f"clients/{client_id}/media/{media_id}/thumb.jpg"
                public_thumb = await sb_upload_public(path, content, ctype)
            except Exception:
                public_thumb = None

        enriched.append(
            {
                "id": media_id,
                "media_type": m.get("media_type"),
                "media_product_type": product_type,
                "caption": m.get("caption"),
                "timestamp": m.get("timestamp"),
                "permalink": m.get("permalink"),
                "insights": insights,
                "thumb_url": public_thumb
                or m.get("thumbnail_url")
                or (m.get("media_url") if media_type in {"IMAGE", "CAROUSEL_ALBUM"} else None),
            }
        )

        media_rows.append(
            {
                "client_id": client_id,
                "connection_id": connection_id,
                "media_id": media_id,
                "media_type": m.get("media_type"),
                "media_product_type": product_type,
                "caption": m.get("caption"),
                "permalink": m.get("permalink"),
                "timestamp": _normalize_meta_ts(m.get("timestamp")),
                "thumb_url": public_thumb
                or m.get("thumbnail_url")
                or (m.get("media_url") if media_type in {"IMAGE", "CAROUSEL_ALBUM"} else None),
                "media_url": m.get("media_url"),
                "thumbnail_url": m.get("thumbnail_url"),
                "insights_json": insights or {},
            }
        )

    if comment_rows:
        rows = [r for r in comment_rows if str(r.get("comment_id") or "").strip()]
        if rows:
            try:
                await sb_upsert("ig_comments", rows, on_conflict="client_id,comment_id")
            except httpx.HTTPStatusError as exc:
                if exc.response is None or exc.response.status_code not in {400, 404, 409}:
                    raise
                warnings.append("Comentários não foram persistidos por incompatibilidade de schema.")

    block_status["comments"] = {"ok": True, "status": "ok", "saved": len(comment_rows)}

    if media_rows:
        try:
            await sb_upsert("ig_media", media_rows, on_conflict="client_id,media_id")
        except httpx.HTTPStatusError as exc:
            if exc.response is None or exc.response.status_code not in {400, 404, 409}:
                raise
            body = str(exc.response.text or "").lower()
            if "connection_id" in body and ("column" in body or "schema cache" in body):
                media_rows_no_conn = []
                for row in media_rows:
                    row_copy = dict(row)
                    row_copy.pop("connection_id", None)
                    media_rows_no_conn.append(row_copy)
                await sb_upsert("ig_media", media_rows_no_conn, on_conflict="client_id,media_id")
                warnings.append("Mídias persistidas sem connection_id (schema legado).")
            else:
                warnings.append("Mídias não foram persistidas por incompatibilidade de schema.")

    impressions_or_views = int(kpis.get("impressions") or kpis.get("views") or 0)

    try:
        print(
            "[ig_sync] snapshot_upsert "
            f"client_id={client_id} connection_id={connection_id} "
            f"snapshot_date={_utc_date_str()} "
            f"reach={int(kpis.get('reach') or 0)} "
            f"profile_views={int(kpis.get('profile_views') or 0)} "
            f"accounts_engaged={int(kpis.get('accounts_engaged') or 0)} "
            f"followers={int(profile.get('followers_count') or 0)}"
        )

        await sb_upsert(
            "ig_profile_snapshots",
            [
                {
                    "client_id": client_id,
                    "snapshot_date": _utc_date_str(),
                    "followers_count": int(profile.get("followers_count") or 0),
                    "media_count": int(profile.get("media_count") or 0),
                    "impressions_day": impressions_or_views,
                    "reach_day": int(kpis.get("reach") or 0),
                    "total_interactions_day": int(kpis.get("total_interactions") or 0),
                    "website_clicks_day": int(kpis.get("website_clicks") or 0),
                    "profile_views_day": int(kpis.get("profile_views") or 0),
                    "accounts_engaged_day": int(kpis.get("accounts_engaged") or 0),
                    "created_at": _iso_now(),
                }
            ],
            on_conflict="client_id,snapshot_date",
        )
    except httpx.HTTPStatusError as exc:
        if exc.response is None or exc.response.status_code not in {400, 404, 409}:
            raise
        warnings.append("Snapshot diário não foi persistido por incompatibilidade de schema.")

    return {
        "ok": True,
        "client_id": client_id,
        "profile": profile,
        "kpis": {
            "impressions": impressions_or_views,
            "reach": int(kpis.get("reach") or 0),
            "total_interactions": int(kpis.get("total_interactions") or 0),
            "website_clicks": int(kpis.get("website_clicks") or 0),
            "profile_views": int(kpis.get("profile_views") or 0),
            "accounts_engaged": int(kpis.get("accounts_engaged") or 0),
        },
        "media": enriched,
        "comments_saved": len(comment_rows),
        "block_status": block_status,
        "warnings": warnings,
    }


async def sync_instagram_connection(connection_id: str, limit: int = 40) -> Dict[str, Any]:
    conn = await _resolve_connection_by_id(connection_id)
    if not conn:
        raise RuntimeError("Conexão Instagram não encontrada.")

    if str(conn.get("platform") or "") != "instagram":
        raise RuntimeError("Conexão informada não é Instagram.")

    client_id = str(conn.get("client_id") or "").strip()
    if not client_id:
        raise RuntimeError("Conexão sem client_id.")

    ig_user_id = str(conn.get("ig_user_id") or "").strip()
    if not ig_user_id:
        client = await sb_get_one("clients", f"id=eq.{client_id}")
        ig_user_id = str((client or {}).get("ig_user_id") or "").strip()
    if not ig_user_id:
        raise RuntimeError("Conexão sem ig_user_id. Reconecte e selecione um Instagram válido.")

    print(
        "[ig_sync] start "
        f"client_id={client_id} connection_id={connection_id} ig_user_id={ig_user_id} limit={limit}"
    )

    try:
        access_token = await ensure_valid_meta_token(
            client_id,
            connection_id=connection_id,
            platform="instagram",
            connection_type="organic",
        )
        res = await _run_sync_for_client_and_ig(
            client_id=client_id,
            connection_id=connection_id,
            ig_user_id=ig_user_id,
            access_token=access_token,
            limit=limit,
        )
        await _mark_connection_success(connection_id)
        print(
            "[ig_sync] success "
            f"client_id={client_id} connection_id={connection_id} media={len(res.get('media') or [])} "
            f"comments_saved={res.get('comments_saved') or 0}"
        )
        return {**res, "connection_id": connection_id}
    except Exception as exc:
        await _mark_connection_error(connection_id, str(exc))
        print(
            "[ig_sync] error "
            f"client_id={client_id} connection_id={connection_id} error={str(exc)[:280]}"
        )
        raise


async def sync_instagram_for_client(
    client_id: str,
    limit: int = 40,
    preferred_connection_id: str | None = None,
) -> Dict[str, Any]:
    preferred_id = str(preferred_connection_id or "").strip()
    resolved = await resolve_connection_for_scope(
        client_id=client_id,
        platform="instagram",
        connection_type="organic",
        requested_connection_id=preferred_id or None,
    )
    connection_id = str(resolved.get("connection_id") or "").strip()
    if not connection_id:
        raise RuntimeError("Cliente sem conexão Instagram utilizável. Reconecte a conta.")
    selected = resolved.get("row") or {}
    source = str(resolved.get("source") or "none").strip() or "none"

    print(
        "[ig_sync] selected_connection "
        f"client_id={client_id} preferred_connection_id={preferred_id or '-'} "
        f"connection_id={connection_id} source={source} status={str(selected.get('status') or '-')}"
    )

    return await sync_instagram_connection(connection_id, limit=limit)
