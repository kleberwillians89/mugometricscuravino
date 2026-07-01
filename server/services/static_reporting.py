from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

from .fbits_reporting import get_official_commerce_summary
from .ig_supabase import sb_select


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _safe_float(value: Any) -> float:
    try:
        if value is None or value == "":
            return 0.0
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip()
        if not text:
            return 0.0
        text = (
            text.replace("R$", "")
            .replace("\xa0", "")
            .replace(" ", "")
            .replace("%", "")
            .strip()
        )
        if "," in text and "." in text:
            if text.rfind(",") > text.rfind("."):
                text = text.replace(".", "").replace(",", ".")
            else:
                text = text.replace(",", "")
        elif "," in text:
            text = text.replace(",", ".")
        cleaned = "".join(char for char in text if char.isdigit() or char in {".", "-"})
        return float(cleaned or 0)
    except Exception:
        return 0.0


def _safe_int(value: Any) -> int:
    try:
        if value is None or value == "":
            return 0
        return int(float(value))
    except Exception:
        return 0


def _round_money(value: Any) -> float:
    return round(_safe_float(value), 2)


def _format_brl(value: Any) -> str:
    return f"{_round_money(value):.2f}".replace(".", ",")


def _parse_date(value: Optional[str]) -> Optional[date]:
    text = _safe_str(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except Exception:
        return None


def resolve_report_period(start: Optional[str], end: Optional[str]) -> tuple[date, date]:
    start_date = _parse_date(start)
    end_date = _parse_date(end)
    today = datetime.now(timezone.utc).date()
    if not start_date:
        start_date = today - timedelta(days=29)
    if not end_date:
        end_date = today
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    return start_date, end_date


def _iso_start_of_day(day: date) -> str:
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc).isoformat()


def _iso_end_of_day(day: date) -> str:
    return datetime(day.year, day.month, day.day, 23, 59, 59, 999999, tzinfo=timezone.utc).isoformat()


def _is_schema_error(exc: httpx.HTTPStatusError, table: str) -> bool:
    if exc.response is None or exc.response.status_code not in {400, 404}:
        return False
    body = str(exc.response.text or "").lower()
    table_name = table.lower()
    return (
        table_name in body
        or "relation" in body
        or "does not exist" in body
        or "schema cache" in body
        or "column" in body
    )


async def _safe_select(
    table: str,
    *,
    filters: Dict[str, str],
    order: Optional[str] = None,
    limit: int = 10000,
) -> List[Dict[str, Any]]:
    try:
        return await sb_select(table, select="*", filters=filters, order=order, limit=limit)
    except httpx.HTTPStatusError as exc:
        if _is_schema_error(exc, table):
            print(f"[static_report][fallback] table={table} reason=schema_unavailable")
            return []
        raise


def _blank_commerce() -> Dict[str, Any]:
    return {
        "source": "none",
        "source_label": "Indisponivel",
        "revenue": 0.0,
        "orders": 0,
        "average_ticket": 0.0,
        "discounts": 0.0,
        "shipping": 0.0,
        "refunds": 0.0,
        "customers": 0,
        "products_sold": 0,
        "top_products": [],
    }


def _blank_traffic() -> Dict[str, Any]:
    return {
        "sessions": 0,
        "active_users": 0,
        "total_users": 0,
        "event_count": 0,
        "add_to_cart": 0,
        "begin_checkout": 0,
        "purchases": 0,
        "revenue": 0.0,
        "channels": [],
    }


def _blank_paid_media() -> Dict[str, Any]:
    return {
        "spend": 0.0,
        "impressions": 0,
        "reach": 0,
        "clicks": 0,
        "cpm": 0.0,
        "cpc": 0.0,
        "ctr": 0.0,
        "conversions": 0.0,
        "revenue": 0.0,
        "roas": 0.0,
        "campaigns": [],
    }


def _blank_instagram() -> Dict[str, Any]:
    return {
        "followers_start": 0,
        "followers_end": 0,
        "followers_growth": 0,
        "reach": 0,
        "impressions": 0,
        "profile_views": 0,
        "website_clicks": 0,
        "engagements": 0,
        "top_posts": [],
    }


def _rate(numerator: float, denominator: float, multiplier: float = 1.0) -> float:
    return round((numerator / denominator) * multiplier, 4) if denominator > 0 else 0.0


def _sort_by_number(rows: List[Dict[str, Any]], key: str, limit: int) -> List[Dict[str, Any]]:
    return sorted(rows, key=lambda row: _safe_float(row.get(key)), reverse=True)[:limit]


def _previous_period(start: date, end: date) -> tuple[date, date]:
    days = max(1, (end - start).days + 1)
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)
    return prev_start, prev_end


async def build_commerce_block(client_id: str, start: date, end: date) -> Dict[str, Any]:
    fbits_block = await _build_fbits_commerce_block(client_id, start, end)
    if _safe_float(fbits_block.get("revenue")) > 0 or _safe_int(fbits_block.get("orders")) > 0:
        _log_commerce_decision(client_id=client_id, start=start, end=end, block=fbits_block, fallback_used=False)
        return fbits_block

    shopify_block = await _build_shopify_commerce_block(client_id, start, end)
    if _safe_float(shopify_block.get("revenue")) > 0 or _safe_int(shopify_block.get("orders")) > 0:
        _log_commerce_decision(client_id=client_id, start=start, end=end, block=shopify_block, fallback_used=True)
        return shopify_block

    if fbits_block.get("source") == "fbits":
        _log_commerce_decision(client_id=client_id, start=start, end=end, block=fbits_block, fallback_used=False)
        return fbits_block
    _log_commerce_decision(client_id=client_id, start=start, end=end, block=shopify_block, fallback_used=True)
    return shopify_block


def _log_commerce_decision(
    *,
    client_id: str,
    start: date,
    end: date,
    block: Dict[str, Any],
    fallback_used: bool,
) -> None:
    debug = block.get("debug") if isinstance(block.get("debug"), dict) else {}
    print(
        "[static_report][commerce_decision] "
        f"client_id={client_id} start={start.isoformat()} end={end.isoformat()} "
        f"official_revenue_from_fbits_api={_safe_float(debug.get('official_api_revenue')):.2f} "
        f"final_commerce_revenue_returned={_safe_float(block.get('revenue')):.2f} "
        f"local_revenue={_safe_float(debug.get('local_revenue')):.2f} "
        f"source={block.get('source')} fallback_used={str(fallback_used).lower()}"
    )


async def _build_fbits_commerce_block(client_id: str, start: date, end: date) -> Dict[str, Any]:
    try:
        summary_payload = await get_official_commerce_summary(
            client_id=client_id,
            start=start.isoformat(),
            end=end.isoformat(),
        )
    except Exception as exc:
        print(f"[static_report][fbits_fallback] client_id={client_id} error={exc.__class__.__name__}")
        return _blank_commerce()

    connected = bool(summary_payload.get("connected"))
    summary = summary_payload.get("summary") if isinstance(summary_payload.get("summary"), dict) else {}
    top_products_raw = summary_payload.get("top_products") if isinstance(summary_payload.get("top_products"), list) else []
    revenue = _round_money(summary.get("receita_oficial"))
    orders = _safe_int(summary.get("pedidos"))
    products_sold = _safe_int(summary.get("produtos_vendidos"))
    raw_debug = summary_payload.get("debug") if isinstance(summary_payload.get("debug"), dict) else {}
    fbits_api_debug = raw_debug.get("fbits_api") if isinstance(raw_debug.get("fbits_api"), dict) else {}
    local_debug = raw_debug.get("local") if isinstance(raw_debug.get("local"), dict) else {}
    official_api_revenue = _round_money(fbits_api_debug.get("dashboard_revenue"))
    official_api_orders = _safe_int(fbits_api_debug.get("dashboard_orders"))
    official_api_ticket = _round_money(fbits_api_debug.get("dashboard_ticket"))
    source_used = _safe_str(summary_payload.get("source")) or _safe_str(raw_debug.get("source"))
    api_has_official_values = official_api_revenue > 0 and official_api_orders > 0
    if api_has_official_values:
        revenue = official_api_revenue
        orders = official_api_orders
    top_products = []
    for item in top_products_raw[:10]:
        if not isinstance(item, dict):
            continue
        top_products.append(
            {
                "product_id": _safe_str(item.get("product_id")) or None,
                "sku": _safe_str(item.get("sku")) or None,
                "title": _safe_str(item.get("produto")) or "Produto FBits",
                "quantity": _safe_int(item.get("quantidade")),
                "revenue": _round_money(item.get("receita")),
                "image_url": _safe_str(item.get("imagem")) or None,
            }
        )

    return {
        "source": "fbits" if connected else "none",
        "source_label": "FBits",
        "revenue": revenue,
        "orders": orders,
        "average_ticket": _round_money(
            official_api_ticket if api_has_official_values else (summary.get("ticket_medio") or (revenue / orders if orders else 0.0))
        ),
        "discounts": 0.0,
        "shipping": 0.0,
        "refunds": 0.0,
        "customers": _safe_int(summary.get("clientes")),
        "products_sold": products_sold,
        "top_products": top_products,
        "message": summary_payload.get("message"),
        "debug": {
            **raw_debug,
            "official_api_revenue": official_api_revenue,
            "official_api_orders": official_api_orders,
            "official_api_average_ticket": official_api_ticket,
            "final_revenue": revenue,
            "final_orders": orders,
            "final_average_ticket": _round_money(
                official_api_ticket if api_has_official_values else (summary.get("ticket_medio") or (revenue / orders if orders else 0.0))
            ),
            "local_revenue": _round_money(
                local_debug.get("daily_revenue") or local_debug.get("orders_revenue")
            ),
            "source_used": source_used,
            "fallback_used": source_used != "fbits_dashboard_api",
        },
    }


async def _build_shopify_commerce_block(client_id: str, start: date, end: date) -> Dict[str, Any]:
    orders = await _safe_select(
        "shopify_orders",
        filters={
            "client_id": f"eq.{client_id}",
            "and": f"(created_at_shopify.gte.{_iso_start_of_day(start)},created_at_shopify.lte.{_iso_end_of_day(end)})",
        },
        order="created_at_shopify.desc",
        limit=10000,
    )
    if not orders:
        return _blank_commerce()

    active_orders = [
        order
        for order in orders
        if not _safe_str(order.get("cancelled_at")) and not _safe_str(order.get("cancel_reason"))
    ]
    order_ids = [
        _safe_str(order.get("shopify_order_id"))
        for order in active_orders
        if _safe_str(order.get("shopify_order_id"))
    ]
    items: List[Dict[str, Any]] = []
    if order_ids:
        quoted_ids = ",".join(json.dumps(item) for item in order_ids[:5000])
        items = await _safe_select(
            "shopify_order_items",
            filters={"client_id": f"eq.{client_id}", "shopify_order_id": f"in.({quoted_ids})"},
            order="updated_at.desc",
            limit=10000,
        )

    refunds = await _safe_select(
        "shopify_refunds",
        filters={
            "client_id": f"eq.{client_id}",
            "and": f"(created_at_shopify.gte.{_iso_start_of_day(start)},created_at_shopify.lte.{_iso_end_of_day(end)})",
        },
        order="created_at_shopify.desc",
        limit=5000,
    )

    revenue = sum(_safe_float(order.get("total_price")) for order in active_orders)
    orders_count = len(active_orders)
    discounts = sum(_safe_float(order.get("total_discounts")) for order in active_orders)
    shipping = sum(_safe_float(order.get("total_shipping_price")) for order in active_orders)
    refunds_total = sum(_safe_float(refund.get("total_refunded")) for refund in refunds)

    products: Dict[str, Dict[str, Any]] = {}
    for item in items:
        title = _safe_str(item.get("title")) or "Produto sem titulo"
        product_id = _safe_str(item.get("product_id"))
        variant_id = _safe_str(item.get("variant_id"))
        key = product_id or variant_id or title
        bucket = products.setdefault(
            key,
            {
                "product_id": product_id or None,
                "variant_id": variant_id or None,
                "title": title,
                "quantity": 0,
                "revenue": 0.0,
            },
        )
        quantity = _safe_int(item.get("quantity"))
        price = _safe_float(item.get("price"))
        bucket["quantity"] += quantity
        bucket["revenue"] += max(0.0, price * quantity - _safe_float(item.get("total_discount")))

    top_products = [
        {**row, "revenue": _round_money(row.get("revenue"))}
        for row in _sort_by_number(list(products.values()), "revenue", 10)
    ]

    return {
        "source": "shopify",
        "source_label": "Shopify",
        "revenue": _round_money(revenue),
        "orders": orders_count,
        "average_ticket": _round_money(revenue / orders_count) if orders_count else 0.0,
        "discounts": _round_money(discounts),
        "shipping": _round_money(shipping),
        "refunds": _round_money(refunds_total),
        "customers": len({_safe_str(order.get("customer_id") or order.get("email")) for order in active_orders if _safe_str(order.get("customer_id") or order.get("email"))}),
        "products_sold": sum(_safe_int(item.get("quantity")) for item in items),
        "top_products": top_products,
    }


async def build_traffic_block(client_id: str, start: date, end: date) -> Dict[str, Any]:
    daily_rows = await _safe_select(
        "ga4_daily_stats",
        filters={"client_id": f"eq.{client_id}", "and": f"(stat_date.gte.{start.isoformat()},stat_date.lte.{end.isoformat()})"},
        order="stat_date.asc",
        limit=10000,
    )
    channel_rows = await _safe_select(
        "ga4_channel_stats",
        filters={"client_id": f"eq.{client_id}", "and": f"(stat_date.gte.{start.isoformat()},stat_date.lte.{end.isoformat()})"},
        order="stat_date.asc",
        limit=10000,
    )
    event_rows = await _safe_select(
        "ga4_event_stats",
        filters={"client_id": f"eq.{client_id}", "and": f"(stat_date.gte.{start.isoformat()},stat_date.lte.{end.isoformat()})"},
        order="stat_date.asc",
        limit=10000,
    )

    traffic = _blank_traffic()
    traffic["sessions"] = sum(_safe_int(row.get("sessions")) for row in daily_rows)
    traffic["active_users"] = sum(_safe_int(row.get("active_users")) for row in daily_rows)
    traffic["total_users"] = sum(_safe_int(row.get("total_users")) for row in daily_rows)
    traffic["event_count"] = sum(_safe_int(row.get("event_count")) for row in daily_rows)
    traffic["add_to_cart"] = sum(_safe_int(row.get("add_to_cart_count")) for row in daily_rows)
    traffic["begin_checkout"] = sum(_safe_int(row.get("begin_checkout_count")) for row in daily_rows)
    traffic["purchases"] = sum(
        _safe_int(row.get("purchase_count") or row.get("ecommerce_purchases")) for row in daily_rows
    )
    traffic["revenue"] = _round_money(
        sum(_safe_float(row.get("purchase_revenue") or row.get("total_revenue")) for row in daily_rows)
    )

    event_totals: Dict[str, int] = {}
    for row in event_rows:
        event_name = _safe_str(row.get("event_name")).lower()
        if event_name:
            event_totals[event_name] = event_totals.get(event_name, 0) + _safe_int(row.get("event_count"))
    traffic["add_to_cart"] = traffic["add_to_cart"] or event_totals.get("add_to_cart", 0)
    traffic["begin_checkout"] = traffic["begin_checkout"] or event_totals.get("begin_checkout", 0)
    traffic["purchases"] = traffic["purchases"] or event_totals.get("purchase", 0)

    channels: Dict[str, Dict[str, Any]] = {}
    for row in channel_rows:
        key = _safe_str(row.get("source_medium")) or "Nao identificado"
        source = _safe_str(row.get("source"))
        medium = _safe_str(row.get("medium"))
        bucket = channels.setdefault(
            key,
            {
                "source_medium": key,
                "source": source or None,
                "medium": medium or None,
                "sessions": 0,
                "active_users": 0,
                "total_users": 0,
                "event_count": 0,
                "purchases": 0,
                "revenue": 0.0,
            },
        )
        bucket["sessions"] += _safe_int(row.get("sessions"))
        bucket["active_users"] += _safe_int(row.get("active_users"))
        bucket["total_users"] += _safe_int(row.get("total_users"))
        bucket["event_count"] += _safe_int(row.get("event_count"))
        bucket["purchases"] += _safe_int(row.get("ecommerce_purchases"))
        bucket["revenue"] += _safe_float(row.get("purchase_revenue") or row.get("total_revenue"))

    traffic["channels"] = [
        {**row, "revenue": _round_money(row.get("revenue"))}
        for row in _sort_by_number(list(channels.values()), "sessions", 12)
    ]
    return traffic


async def build_paid_media_block(client_id: str, start: date, end: date) -> Dict[str, Any]:
    account_rows = await _safe_select(
        "ad_account_daily_stats",
        filters={"client_id": f"eq.{client_id}", "and": f"(stat_date.gte.{start.isoformat()},stat_date.lte.{end.isoformat()})"},
        order="stat_date.asc",
        limit=10000,
    )
    campaign_rows = await _safe_select(
        "campaign_daily_stats",
        filters={"client_id": f"eq.{client_id}", "and": f"(stat_date.gte.{start.isoformat()},stat_date.lte.{end.isoformat()})"},
        order="stat_date.asc",
        limit=10000,
    )
    ad_rows = await _safe_select(
        "ad_daily_stats",
        filters={"client_id": f"eq.{client_id}", "and": f"(stat_date.gte.{start.isoformat()},stat_date.lte.{end.isoformat()})"},
        order="stat_date.asc",
        limit=10000,
    )
    promoted_rows = await _safe_select(
        "promoted_post_daily_stats",
        filters={"client_id": f"eq.{client_id}", "and": f"(stat_date.gte.{start.isoformat()},stat_date.lte.{end.isoformat()})"},
        order="stat_date.asc",
        limit=10000,
    )

    source_rows = account_rows if account_rows else campaign_rows
    if not source_rows:
        source_rows = ad_rows + promoted_rows
    paid = _blank_paid_media()
    paid["spend"] = _round_money(sum(_safe_float(row.get("spend")) for row in source_rows))
    paid["impressions"] = sum(_safe_int(row.get("impressions")) for row in source_rows)
    paid["reach"] = sum(_safe_int(row.get("reach")) for row in source_rows)
    paid["clicks"] = sum(_safe_int(row.get("clicks")) for row in source_rows)
    paid["conversions"] = round(sum(_safe_float(row.get("conversions")) for row in source_rows), 2)
    paid["revenue"] = _round_money(sum(_safe_float(row.get("revenue")) for row in source_rows))
    paid["cpm"] = _round_money(_rate(paid["spend"], paid["impressions"], 1000))
    paid["cpc"] = _round_money(_rate(paid["spend"], paid["clicks"]))
    paid["ctr"] = round(_rate(paid["clicks"], paid["impressions"], 100), 2)
    paid["roas"] = round(_rate(paid["revenue"], paid["spend"]), 2)

    campaigns: Dict[str, Dict[str, Any]] = {}
    campaign_source_rows = campaign_rows if campaign_rows else ad_rows + promoted_rows
    for row in campaign_source_rows:
        campaign_id = _safe_str(row.get("campaign_id"))
        name = _safe_str(row.get("campaign_name")) or campaign_id or "Campanha sem nome"
        key = campaign_id or name
        bucket = campaigns.setdefault(
            key,
            {
                "campaign_id": campaign_id or None,
                "campaign_name": name,
                "spend": 0.0,
                "impressions": 0,
                "reach": 0,
                "clicks": 0,
                "conversions": 0.0,
                "revenue": 0.0,
                "roas": 0.0,
            },
        )
        bucket["spend"] += _safe_float(row.get("spend"))
        bucket["impressions"] += _safe_int(row.get("impressions"))
        bucket["reach"] += _safe_int(row.get("reach"))
        bucket["clicks"] += _safe_int(row.get("clicks"))
        bucket["conversions"] += _safe_float(row.get("conversions"))
        bucket["revenue"] += _safe_float(row.get("revenue"))

    campaign_list = []
    for row in campaigns.values():
        spend = _safe_float(row.get("spend"))
        clicks = _safe_float(row.get("clicks"))
        impressions = _safe_float(row.get("impressions"))
        revenue = _safe_float(row.get("revenue"))
        campaign_list.append(
            {
                **row,
                "spend": _round_money(spend),
                "revenue": _round_money(revenue),
                "cpc": _round_money(_rate(spend, clicks)),
                "cpm": _round_money(_rate(spend, impressions, 1000)),
                "ctr": round(_rate(clicks, impressions, 100), 2),
                "roas": round(_rate(revenue, spend), 2),
            }
        )
    paid["campaigns"] = _sort_by_number(campaign_list, "spend", 12)
    return paid


def _extract_insight_metric(row: Dict[str, Any], names: tuple[str, ...]) -> int:
    for name in names:
        if name in row:
            return _safe_int(row.get(name))
    payload = row.get("insights_json")
    if isinstance(payload, dict):
        for name in names:
            value = payload.get(name)
            if isinstance(value, dict) and "value" in value:
                return _safe_int(value.get("value"))
            if value is not None:
                return _safe_int(value)
    return 0


async def build_instagram_block(client_id: str, start: date, end: date) -> Dict[str, Any]:
    snapshots = await _safe_select(
        "ig_profile_snapshots",
        filters={"client_id": f"eq.{client_id}", "and": f"(snapshot_date.gte.{start.isoformat()},snapshot_date.lte.{end.isoformat()})"},
        order="snapshot_date.asc",
        limit=10000,
    )
    media_rows = await _safe_select(
        "ig_media",
        filters={"client_id": f"eq.{client_id}", "and": f"(timestamp.gte.{_iso_start_of_day(start)},timestamp.lte.{_iso_end_of_day(end)})"},
        order="timestamp.desc",
        limit=1000,
    )

    instagram = _blank_instagram()
    if snapshots:
        instagram["followers_start"] = _safe_int(snapshots[0].get("followers_count"))
        instagram["followers_end"] = _safe_int(snapshots[-1].get("followers_count"))
        instagram["followers_growth"] = instagram["followers_end"] - instagram["followers_start"]
        instagram["reach"] = sum(_safe_int(row.get("reach_day")) for row in snapshots)
        instagram["impressions"] = sum(_safe_int(row.get("impressions_day")) for row in snapshots)
        instagram["profile_views"] = sum(_safe_int(row.get("profile_views_day")) for row in snapshots)
        instagram["website_clicks"] = sum(_safe_int(row.get("website_clicks_day")) for row in snapshots)
        instagram["engagements"] = sum(
            _safe_int(row.get("total_interactions_day") or row.get("accounts_engaged_day")) for row in snapshots
        )

    posts = []
    for row in media_rows:
        reach = _extract_insight_metric(row, ("reach", "accounts_reached"))
        impressions = _extract_insight_metric(row, ("impressions",))
        engagements = _extract_insight_metric(row, ("total_interactions", "engagement", "likes", "comments"))
        posts.append(
            {
                "media_id": _safe_str(row.get("media_id")),
                "caption": _safe_str(row.get("caption"))[:180],
                "permalink": _safe_str(row.get("permalink")) or None,
                "media_type": _safe_str(row.get("media_type")) or None,
                "timestamp": _safe_str(row.get("timestamp")) or None,
                "reach": reach,
                "impressions": impressions,
                "engagements": engagements,
            }
        )
    instagram["top_posts"] = _sort_by_number(posts, "engagements", 8)
    return instagram


def build_insights(
    commerce: Dict[str, Any],
    traffic: Dict[str, Any],
    paid_media: Dict[str, Any],
    instagram: Dict[str, Any],
    previous_commerce: Dict[str, Any] | None = None,
) -> List[str]:
    insights: List[str] = []
    official_revenue = _safe_float(commerce.get("revenue"))
    official_orders = _safe_int(commerce.get("orders"))
    ga4_revenue = _safe_float(traffic.get("revenue"))
    ga4_purchases = _safe_int(traffic.get("purchases"))
    channels = [row for row in (traffic.get("channels") or []) if isinstance(row, dict)]
    top_revenue_channel = channels[0] if channels else None
    if channels:
        top_revenue_channel = max(channels, key=lambda row: _safe_float(row.get("revenue")))
    source_label = _safe_str(commerce.get("source_label")) or "fonte oficial"

    if official_orders > 0:
        insights.append(
            f"{source_label} registrou {official_orders} pedidos e R$ {_format_brl(official_revenue)} de receita oficial, com ticket medio de R$ {_format_brl(commerce.get('average_ticket'))}."
        )

    prev_orders = _safe_int((previous_commerce or {}).get("orders"))
    prev_revenue = _safe_float((previous_commerce or {}).get("revenue"))
    if prev_orders > 0 and official_orders > 0:
        order_delta = ((official_orders - prev_orders) / prev_orders) * 100
        revenue_delta = ((official_revenue - prev_revenue) / prev_revenue) * 100 if prev_revenue else 0.0
        direction = "cresceu" if order_delta >= 0 else "recuou"
        insights.append(
            f"Pedidos {direction} {abs(order_delta):.1f}% versus o periodo anterior; receita variou {revenue_delta:.1f}% na mesma base."
        )

    if top_revenue_channel and _safe_float(top_revenue_channel.get("revenue")) > 0:
        channel_revenue = _safe_float(top_revenue_channel.get("revenue"))
        share = (channel_revenue / ga4_revenue * 100) if ga4_revenue > 0 else 0.0
        insights.append(
            f"Maior canal de receita atribuida no GA4: {_safe_str(top_revenue_channel.get('source_medium'), 'canal nao identificado')}, com R$ {_format_brl(channel_revenue)} e {share:.1f}% da receita mensurada."
        )
        if share >= 65:
            insights.append(
                f"Ha dependencia relevante desse canal: {share:.1f}% da receita GA4 concentrada em uma unica origem."
            )

    if official_revenue > 0 and ga4_revenue > 0:
        gap = ga4_revenue - official_revenue
        gap_pct = (gap / official_revenue) * 100
        insights.append(
            f"Receita GA4 ficou {'acima' if gap >= 0 else 'abaixo'} da receita oficial em R$ {_format_brl(abs(gap))} ({abs(gap_pct):.1f}%). Use FBits como fonte oficial e GA4 como leitura de atribuicao."
        )
    elif ga4_purchases > 0 and official_orders == 0:
        insights.append(
            f"GA4 mostra {ga4_purchases} compras no periodo, mas a fonte oficial de vendas nao retornou pedidos. Prioridade: revisar sincronizacao FBits/commerce para este intervalo."
        )

    sessions = _safe_int(traffic.get("sessions"))
    add_to_cart = _safe_int(traffic.get("add_to_cart"))
    begin_checkout = _safe_int(traffic.get("begin_checkout"))
    if sessions > 0:
        conversion_rate = (ga4_purchases / sessions) * 100 if ga4_purchases else 0.0
        insights.append(f"Taxa compra/sessao no GA4 ficou em {conversion_rate:.2f}%, a partir de {sessions} sessoes.")
    if add_to_cart > 0 and begin_checkout > 0 and ga4_purchases >= 0:
        checkout_drop = ((begin_checkout - ga4_purchases) / begin_checkout) * 100 if begin_checkout else 0.0
        insights.append(
            f"Funil GA4: {add_to_cart} add-to-cart, {begin_checkout} checkouts e {ga4_purchases} compras; queda checkout-compra de {max(0.0, checkout_drop):.1f}%."
        )

    if _safe_float(paid_media.get("spend")) > 0:
        paid_roas = _safe_float(paid_media.get("roas"))
        insights.append(
            f"Midia paga investiu R$ {_format_brl(paid_media.get('spend'))} com ROAS de {round(paid_roas, 2)}."
        )
        if paid_roas <= 1 and _safe_float(paid_media.get("revenue")) <= 0:
            insights.append("Meta Ads precisa de revisao de tracking ou campanha: ha investimento sem receita atribuida suficiente.")
        elif paid_roas >= 3:
            insights.append("Campanhas pagas com ROAS acima de 3 indicam oportunidade de escala controlada nos melhores conjuntos.")
    elif sessions > 0:
        insights.append(
            "Sem investimento de midia paga no periodo, o resultado dependeu principalmente de canais organicos, diretos ou CRM."
        )

    if _safe_int(instagram.get("followers_growth")) != 0:
        insights.append(
            f"Instagram variou {_safe_int(instagram.get('followers_growth'))} seguidores no periodo."
        )
    if not insights:
        insights.append("Nao ha volume suficiente nas fontes conectadas para gerar conclusoes executivas neste periodo.")
    return insights


async def build_static_report(*, client_id: str, start: Optional[str], end: Optional[str]) -> Dict[str, Any]:
    period_start, period_end = resolve_report_period(start, end)
    commerce = await build_commerce_block(client_id, period_start, period_end)
    traffic = await build_traffic_block(client_id, period_start, period_end)
    paid_media = await build_paid_media_block(client_id, period_start, period_end)
    instagram = await build_instagram_block(client_id, period_start, period_end)
    previous_start, previous_end = _previous_period(period_start, period_end)
    previous_commerce = await build_commerce_block(client_id, previous_start, previous_end)
    commerce_debug = commerce.get("debug") if isinstance(commerce.get("debug"), dict) else {}
    print(
        "[static_report][response_debug] "
        f"client_id={client_id} start={period_start.isoformat()} end={period_end.isoformat()} "
        f"official_revenue_from_fbits_api={_safe_float(commerce_debug.get('official_api_revenue')):.2f} "
        f"final_commerce_revenue_returned={_safe_float(commerce.get('revenue')):.2f} "
        f"local_revenue={_safe_float(commerce_debug.get('local_revenue')):.2f} "
        f"source={commerce.get('source')} fallback_used={str(bool(commerce_debug.get('fallback_used'))).lower()}"
    )
    return {
        "period": {
            "start": period_start.isoformat(),
            "end": period_end.isoformat(),
            "previous_start": previous_start.isoformat(),
            "previous_end": previous_end.isoformat(),
        },
        "commerce": commerce,
        "previous_commerce": {
            "revenue": previous_commerce.get("revenue", 0),
            "orders": previous_commerce.get("orders", 0),
            "average_ticket": previous_commerce.get("average_ticket", 0),
            "source": previous_commerce.get("source"),
        },
        "traffic": traffic,
        "paid_media": paid_media,
        "instagram": instagram,
        "insights": build_insights(commerce, traffic, paid_media, instagram, previous_commerce),
    }
