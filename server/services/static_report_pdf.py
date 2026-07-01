from __future__ import annotations

import html
from io import BytesIO
from typing import Any, Dict, Iterable, List
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


MUGO_BLUE = colors.HexColor("#0c4160")
MUGO_BLUE_DARK = colors.HexColor("#0a2f45")
MUGO_GOLD = colors.HexColor("#c79830")
INK = colors.HexColor("#16191d")
MUTED = colors.HexColor("#66707a")
PAPER = colors.HexColor("#f6f4f0")
CARD = colors.HexColor("#ffffff")
STROKE = colors.HexColor("#d9dee3")


def _safe_str(value: Any, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def _safe_float(value: Any) -> float:
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def _safe_int(value: Any) -> int:
    try:
        if value is None or value == "":
            return 0
        return int(float(value))
    except Exception:
        return 0


def _fmt_number(value: Any) -> str:
    return f"{_safe_int(value):,}".replace(",", ".")


def _fmt_money(value: Any) -> str:
    raw = f"{_safe_float(value):,.2f}"
    return f"R$ {raw}".replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_decimal(value: Any, digits: int = 2) -> str:
    return f"{_safe_float(value):.{digits}f}".replace(".", ",")


def _fmt_date(value: Any) -> str:
    text = _safe_str(value)
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    year, month, day = text.split("-")
    return f"{day}/{month}/{year}"


def _period_label(report: Dict[str, Any]) -> str:
    period = report.get("period") if isinstance(report.get("period"), dict) else {}
    return f"{_fmt_date(period.get('start'))} a {_fmt_date(period.get('end'))}"


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return cleaned or "cliente"


def build_static_report_filename(client_name: str, report: Dict[str, Any]) -> str:
    period = report.get("period") if isinstance(report.get("period"), dict) else {}
    start = _safe_str(period.get("start"))
    month = start[:7] if len(start) >= 7 else "periodo"
    return f"relatorio-performance-{_slugify(client_name)}-{month}.pdf"


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=34,
            leading=38,
            textColor=colors.white,
            alignment=TA_LEFT,
            spaceAfter=12,
        ),
        "cover_client": ParagraphStyle(
            "cover_client",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=21,
            textColor=MUGO_GOLD,
            spaceAfter=8,
        ),
        "cover_meta": ParagraphStyle(
            "cover_meta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=colors.HexColor("#dbe4ea"),
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=19,
            leading=24,
            textColor=MUGO_BLUE_DARK,
            spaceBefore=4,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=17,
            textColor=INK,
            spaceBefore=8,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=INK,
            spaceAfter=6,
        ),
        "muted": ParagraphStyle(
            "muted",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=12,
            textColor=MUTED,
            spaceAfter=4,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.8,
            leading=10,
            textColor=MUTED,
        ),
        "table_cell": ParagraphStyle(
            "table_cell",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=INK,
        ),
        "table_head": ParagraphStyle(
            "table_head",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.5,
            leading=9,
            textColor=colors.white,
            alignment=TA_LEFT,
        ),
        "metric_label": ParagraphStyle(
            "metric_label",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.5,
            leading=9,
            textColor=MUTED,
        ),
        "metric_value": ParagraphStyle(
            "metric_value",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=18,
            textColor=MUGO_BLUE_DARK,
        ),
        "right": ParagraphStyle(
            "right",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=INK,
            alignment=TA_RIGHT,
        ),
    }


def _p(text: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(_safe_str(text)), style)


def _cover_canvas(canvas, doc, client_name: str, period_label: str) -> None:
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(MUGO_BLUE_DARK)
    canvas.rect(0, height * 0.38, width, height * 0.62, fill=1, stroke=0)
    canvas.setFillColor(MUGO_BLUE)
    canvas.rect(0, height * 0.38, width, 18 * mm, fill=1, stroke=0)
    canvas.setFillColor(MUGO_GOLD)
    canvas.rect(24 * mm, height * 0.38 - 1.2 * mm, 54 * mm, 2.4 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(24 * mm, height - 25 * mm, "MUGO METRICS")
    canvas.setFillColor(MUGO_GOLD)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(width - 24 * mm, height - 25 * mm, period_label)
    canvas.restoreState()


def _page_canvas(canvas, doc) -> None:
    width, _height = A4
    canvas.saveState()
    canvas.setStrokeColor(STROKE)
    canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(18 * mm, 9 * mm, "Mugo Metrics")
    canvas.drawRightString(width - 18 * mm, 9 * mm, str(doc.page))
    canvas.restoreState()


def _metric_table(metrics: Iterable[tuple[str, str, str]]) -> Table:
    styles = _styles()
    cells = []
    for label, value, hint in metrics:
        cells.append([_p(label, styles["metric_label"]), _p(value, styles["metric_value"]), _p(hint, styles["small"])])
    rows = []
    for index in range(0, len(cells), 3):
        rows.append(cells[index:index + 3])
    for row in rows:
        while len(row) < 3:
            row.append(["", "", ""])
    table = Table(rows, colWidths=[55 * mm, 55 * mm, 55 * mm], hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, -1), CARD),
        ("BOX", (0, 0), (-1, -1), 0.5, STROKE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, STROKE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]
    table.setStyle(TableStyle(commands))
    return table


def _data_table(headers: List[str], rows: List[List[Any]], widths: List[float], empty_text: str) -> Table:
    styles = _styles()
    table_rows: List[List[Any]] = [[_p(header, styles["table_head"]) for header in headers]]
    if rows:
        for row in rows:
            table_rows.append([_p(value, styles["table_cell"]) for value in row])
    else:
        table_rows.append([_p(empty_text, styles["muted"])] + [""] * (len(headers) - 1))

    table = Table(table_rows, colWidths=widths, hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), MUGO_BLUE),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BACKGROUND", (0, 1), (-1, -1), CARD),
                ("BOX", (0, 0), (-1, -1), 0.5, STROKE),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#edf0f2")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("SPAN", (0, 1), (-1, 1)) if not rows else ("LINEBELOW", (0, 0), (-1, 0), 0.4, MUGO_GOLD),
            ]
        )
    )
    return table


def _section_intro(title: str, subtitle: str) -> List[Any]:
    styles = _styles()
    return [_p(title, styles["h1"]), _p(subtitle, styles["muted"]), Spacer(1, 5 * mm)]


def _has_any(data: Dict[str, Any], keys: Iterable[str]) -> bool:
    return any(_safe_float(data.get(key)) > 0 for key in keys)


def build_static_report_pdf(report: Dict[str, Any], *, client_name: str) -> bytes:
    styles = _styles()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="Relatorio de Performance",
        author="Mugo Metrics",
    )
    period_label = _period_label(report)
    commerce = report.get("commerce") if isinstance(report.get("commerce"), dict) else {}
    traffic = report.get("traffic") if isinstance(report.get("traffic"), dict) else {}
    paid = report.get("paid_media") if isinstance(report.get("paid_media"), dict) else {}
    instagram = report.get("instagram") if isinstance(report.get("instagram"), dict) else {}
    insights = report.get("insights") if isinstance(report.get("insights"), list) else []

    story: List[Any] = [
        Spacer(1, 78 * mm),
        _p(client_name, styles["cover_client"]),
        _p("Relatorio de Performance", styles["cover_title"]),
        _p(period_label, styles["cover_meta"]),
        Spacer(1, 80 * mm),
        _p("Mugo Metrics", ParagraphStyle("signature", parent=styles["cover_meta"], fontName="Helvetica-Bold")),
        PageBreak(),
    ]

    story.extend(_section_intro("Resumo executivo", "Leitura consolidada dos principais sinais de performance no periodo selecionado."))
    story.append(
        _metric_table(
            [
                ("Receita commerce", _fmt_money(commerce.get("revenue")), f"{_fmt_number(commerce.get('orders'))} pedidos"),
                ("Ticket medio", _fmt_money(commerce.get("average_ticket")), f"{_fmt_money(commerce.get('refunds'))} em reembolsos"),
                ("Sessoes GA4", _fmt_number(traffic.get("sessions")), f"{_fmt_number(traffic.get('purchases'))} compras"),
                ("Investimento Meta", _fmt_money(paid.get("spend")), f"ROAS {_fmt_decimal(paid.get('roas'))}"),
                ("Alcance pago", _fmt_number(paid.get("reach")), f"CTR {_fmt_decimal(paid.get('ctr'))}%"),
                ("Instagram", _fmt_number(instagram.get("followers_growth")), "crescimento de seguidores"),
            ]
        )
    )
    story.append(Spacer(1, 8 * mm))

    story.extend(_section_intro("Comercial / Shopify", "Performance comercial capturada no periodo."))
    if _has_any(commerce, ("revenue", "orders", "average_ticket")):
        story.append(
            _metric_table(
                [
                    ("Receita", _fmt_money(commerce.get("revenue")), "vendas registradas"),
                    ("Pedidos", _fmt_number(commerce.get("orders")), "pedidos validos"),
                    ("Descontos", _fmt_money(commerce.get("discounts")), "incentivos comerciais"),
                ]
            )
        )
        story.append(Spacer(1, 5 * mm))
    story.append(
        _data_table(
            ["Produto", "Qtd.", "Receita"],
            [
                [item.get("title"), _fmt_number(item.get("quantity")), _fmt_money(item.get("revenue"))]
                for item in (commerce.get("top_products") or [])[:8]
                if isinstance(item, dict)
            ],
            [88 * mm, 25 * mm, 42 * mm],
            "Dados indisponiveis para o periodo selecionado.",
        )
    )
    story.append(PageBreak())

    story.extend(_section_intro("Trafego / GA4", "Origem e qualidade das sessoes registradas pelo Google Analytics."))
    if _has_any(traffic, ("sessions", "active_users", "event_count")):
        story.append(
            _metric_table(
                [
                    ("Sessoes", _fmt_number(traffic.get("sessions")), "volume total"),
                    ("Usuarios ativos", _fmt_number(traffic.get("active_users")), "audiencia qualificada"),
                    ("Eventos", _fmt_number(traffic.get("event_count")), "interacoes medidas"),
                ]
            )
        )
        story.append(Spacer(1, 5 * mm))
    story.append(
        _data_table(
            ["Canal", "Sessoes", "Compras", "Receita"],
            [
                [item.get("source_medium"), _fmt_number(item.get("sessions")), _fmt_number(item.get("purchases")), _fmt_money(item.get("revenue"))]
                for item in (traffic.get("channels") or [])[:10]
                if isinstance(item, dict)
            ],
            [70 * mm, 28 * mm, 28 * mm, 36 * mm],
            "Dados indisponiveis para o periodo selecionado.",
        )
    )
    story.append(Spacer(1, 7 * mm))
    story.extend(_section_intro("Origem das Vendas", "Consolidacao editorial dos canais que mais contribuiram para compras e receita."))
    top_channels = [
        item for item in (traffic.get("channels") or [])[:5]
        if isinstance(item, dict)
    ]
    if top_channels:
        for item in top_channels:
            story.append(_p(f"{_safe_str(item.get('source_medium'), 'Canal nao identificado')}: {_fmt_number(item.get('purchases'))} compras, {_fmt_money(item.get('revenue'))} em receita.", styles["body"]))
    else:
        story.append(_p("Dados indisponiveis para o periodo selecionado.", styles["muted"]))
    story.append(PageBreak())

    story.extend(_section_intro("Midia Paga / Meta Ads", "Leitura de investimento, eficiencia e campanhas de maior peso no periodo."))
    if _has_any(paid, ("spend", "impressions", "clicks")):
        story.append(
            _metric_table(
                [
                    ("Investimento", _fmt_money(paid.get("spend")), "verba aplicada"),
                    ("Cliques", _fmt_number(paid.get("clicks")), f"CPC {_fmt_money(paid.get('cpc'))}"),
                    ("ROAS", _fmt_decimal(paid.get("roas")), "retorno atribuido"),
                ]
            )
        )
        story.append(Spacer(1, 5 * mm))
    story.append(
        _data_table(
            ["Campanha", "Invest.", "Cliques", "ROAS"],
            [
                [item.get("campaign_name"), _fmt_money(item.get("spend")), _fmt_number(item.get("clicks")), _fmt_decimal(item.get("roas"))]
                for item in (paid.get("campaigns") or [])[:10]
                if isinstance(item, dict)
            ],
            [78 * mm, 34 * mm, 25 * mm, 25 * mm],
            "Dados indisponiveis para o periodo selecionado.",
        )
    )
    story.append(PageBreak())

    story.extend(_section_intro("Instagram", "Evolucao organica, alcance e publicacoes de destaque no periodo."))
    if _has_any(instagram, ("reach", "impressions", "engagements", "followers_growth")):
        story.append(
            _metric_table(
                [
                    ("Seguidores", _fmt_number(instagram.get("followers_end")), f"{_fmt_number(instagram.get('followers_growth'))} no periodo"),
                    ("Alcance", _fmt_number(instagram.get("reach")), "contas alcancadas"),
                    ("Engajamentos", _fmt_number(instagram.get("engagements")), "interacoes organicas"),
                ]
            )
        )
        story.append(Spacer(1, 5 * mm))
    story.append(
        _data_table(
            ["Publicacao", "Alcance", "Engaj."],
            [
                [_safe_str(item.get("caption"), item.get("media_id"))[:70], _fmt_number(item.get("reach")), _fmt_number(item.get("engagements"))]
                for item in (instagram.get("top_posts") or [])[:8]
                if isinstance(item, dict)
            ],
            [105 * mm, 30 * mm, 28 * mm],
            "Dados indisponiveis para o periodo selecionado.",
        )
    )
    story.append(Spacer(1, 8 * mm))
    story.extend(_section_intro("Insights e Proximos Passos", "Pontos de atencao para orientar decisoes do proximo ciclo."))
    if insights:
        for index, insight in enumerate(insights[:8], start=1):
            story.append(_p(f"{index}. {_safe_str(insight)}", styles["body"]))
    else:
        story.append(_p("Dados indisponiveis para o periodo selecionado.", styles["muted"]))

    doc.build(
        story,
        onFirstPage=lambda canvas, doc: _cover_canvas(canvas, doc, client_name, period_label),
        onLaterPages=_page_canvas,
    )
    return buffer.getvalue()
