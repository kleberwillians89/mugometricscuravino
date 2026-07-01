from __future__ import annotations

import html
from io import BytesIO
from typing import Any, Dict, Iterable, List
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
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
SOFT_BLUE = colors.HexColor("#edf5f8")
SOFT_GOLD = colors.HexColor("#fbf5e8")


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
            fontSize=20,
            leading=25,
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
        "kicker": ParagraphStyle(
            "kicker",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.4,
            leading=9,
            textColor=MUGO_GOLD,
            uppercase=True,
            spaceAfter=3,
        ),
        "callout_title": ParagraphStyle(
            "callout_title",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=13,
            textColor=MUGO_BLUE_DARK,
            spaceAfter=4,
        ),
        "callout_body": ParagraphStyle(
            "callout_body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.7,
            leading=12.5,
            textColor=INK,
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
            fontSize=16,
            leading=19,
            textColor=MUGO_BLUE_DARK,
        ),
        "center_muted": ParagraphStyle(
            "center_muted",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.2,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
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
    canvas.setFillColor(MUGO_BLUE_DARK)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(MUGO_BLUE)
    canvas.rect(0, 0, width, height * 0.28, fill=1, stroke=0)
    canvas.setStrokeColor(colors.Color(1, 1, 1, alpha=0.08))
    for offset in range(-120, 520, 42):
        canvas.line(offset, 0, offset + 260, height)
    canvas.setFillColor(MUGO_GOLD)
    canvas.rect(24 * mm, 54 * mm, 74 * mm, 2.2 * mm, fill=1, stroke=0)
    canvas.circle(width - 38 * mm, height - 68 * mm, 28 * mm, fill=0, stroke=1)
    canvas.setStrokeColor(MUGO_GOLD)
    canvas.circle(width - 38 * mm, height - 68 * mm, 18 * mm, fill=0, stroke=1)
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
    canvas.drawString(18 * mm, 9 * mm, "Mugo Metrics · Relatorio de Performance")
    canvas.drawRightString(width - 18 * mm, 9 * mm, f"pagina {doc.page}")
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
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.5, STROKE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e8edf1")),
        ("LINEABOVE", (0, 0), (-1, 0), 2.0, MUGO_GOLD),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
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
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafb")]),
                ("BOX", (0, 0), (-1, -1), 0.5, STROKE),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#edf0f2")),
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
    return [_p("MUGO METRICS", styles["kicker"]), _p(title, styles["h1"]), _p(subtitle, styles["muted"]), Spacer(1, 5 * mm)]


def _callout(title: str, body: str, *, tone: str = "blue") -> Table:
    styles = _styles()
    bg = SOFT_GOLD if tone == "gold" else SOFT_BLUE
    table = Table(
        [[_p(title, styles["callout_title"])], [_p(body, styles["callout_body"])]],
        colWidths=[165 * mm],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#d8e2e8")),
                ("LINEBEFORE", (0, 0), (0, -1), 3, MUGO_GOLD if tone == "gold" else MUGO_BLUE),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


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
    previous_commerce = report.get("previous_commerce") if isinstance(report.get("previous_commerce"), dict) else {}
    source_label = _safe_str(commerce.get("source_label"), "fonte oficial")
    official_revenue = _safe_float(commerce.get("revenue"))
    ga4_revenue = _safe_float(traffic.get("revenue"))
    revenue_gap = ga4_revenue - official_revenue

    story: List[Any] = [
        Spacer(1, 70 * mm),
        _p(client_name, styles["cover_client"]),
        _p("Relatorio de Performance", styles["cover_title"]),
        _p(period_label, styles["cover_meta"]),
        Spacer(1, 88 * mm),
        _p("Performance, atribuicao e proximos passos", styles["cover_meta"]),
        _p("Mugo Metrics", ParagraphStyle("signature", parent=styles["cover_meta"], fontName="Helvetica-Bold", fontSize=12)),
        PageBreak(),
    ]

    story.extend(_section_intro("Sumario executivo", "Leitura consolidada dos principais sinais de performance no periodo selecionado."))
    story.append(
        _callout(
            "Leitura principal",
            f"A receita oficial do periodo vem de {source_label}. As tabelas de aquisicao usam GA4 como leitura de atribuicao, nao como fonte fiscal de faturamento.",
            tone="gold",
        )
    )
    story.append(Spacer(1, 6 * mm))
    story.append(
        _metric_table(
            [
                ("Receita oficial", _fmt_money(commerce.get("revenue")), f"{source_label} · {_fmt_number(commerce.get('orders'))} pedidos"),
                ("Ticket medio", _fmt_money(commerce.get("average_ticket")), f"{_fmt_money(commerce.get('refunds'))} em reembolsos"),
                ("Sessoes GA4", _fmt_number(traffic.get("sessions")), f"{_fmt_number(traffic.get('purchases'))} compras"),
                ("Investimento Meta", _fmt_money(paid.get("spend")), f"ROAS {_fmt_decimal(paid.get('roas'))}"),
                ("Alcance pago", _fmt_number(paid.get("reach")), f"CTR {_fmt_decimal(paid.get('ctr'))}%"),
                ("Instagram", _fmt_number(instagram.get("followers_growth")), "crescimento de seguidores"),
            ]
        )
    )
    story.append(Spacer(1, 8 * mm))

    story.extend(_section_intro("Performance comercial oficial", f"Receita e pedidos oficiais capturados pela fonte comercial ativa: {source_label}."))
    if _has_any(commerce, ("revenue", "orders", "average_ticket")):
        story.append(
            _metric_table(
                [
                    ("Receita", _fmt_money(commerce.get("revenue")), "vendas registradas"),
                    ("Pedidos", _fmt_number(commerce.get("orders")), "pedidos validos"),
                    ("Produtos vendidos", _fmt_number(commerce.get("products_sold")), "itens oficiais"),
                ]
            )
        )
        story.append(Spacer(1, 5 * mm))
        if _safe_float(previous_commerce.get("revenue")) > 0:
            delta = ((_safe_float(commerce.get("revenue")) - _safe_float(previous_commerce.get("revenue"))) / _safe_float(previous_commerce.get("revenue"))) * 100
            story.append(_callout("Comparativo", f"Receita oficial variou {delta:.1f}% em relacao ao periodo anterior equivalente.", tone="blue"))
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

    story.extend(_section_intro("Trafego e aquisicao", "Origem e qualidade das sessoes registradas pelo Google Analytics."))
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
    if official_revenue > 0 and ga4_revenue > 0:
        story.append(
            _callout(
                "Receita oficial x receita atribuida",
                f"{source_label}: {_fmt_money(official_revenue)} oficiais. GA4: {_fmt_money(ga4_revenue)} atribuidos. Diferenca: {_fmt_money(abs(revenue_gap))} {'acima no GA4' if revenue_gap >= 0 else 'abaixo no GA4'}.",
                tone="gold",
            )
        )
        story.append(Spacer(1, 5 * mm))
    top_channels = [
        item for item in (traffic.get("channels") or [])[:5]
        if isinstance(item, dict)
    ]
    if top_channels:
        for item in top_channels:
            story.append(_p(f"{_safe_str(item.get('source_medium'), 'Canal nao identificado')}: {_fmt_number(item.get('purchases'))} compras, {_fmt_money(item.get('revenue'))} em receita atribuida.", styles["body"]))
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
    story.extend(_section_intro("Diagnostico executivo", "Pontos de atencao para orientar decisoes do proximo ciclo."))
    if insights:
        for index, insight in enumerate(insights[:6], start=1):
            story.append(_p(f"{index}. {_safe_str(insight)}", styles["body"]))
    else:
        story.append(_p("Dados indisponiveis para o periodo selecionado.", styles["muted"]))
    story.append(Spacer(1, 7 * mm))
    story.extend(_section_intro("Proximos passos", "Acoes recomendadas para transformar a leitura em melhoria operacional."))
    next_steps = [
        "Validar diariamente a sincronizacao FBits para manter receita oficial e pedidos atualizados.",
        "Usar GA4 para priorizar canais de aquisicao, mantendo FBits como fonte oficial de faturamento.",
        "Revisar o funil entre carrinho, checkout e compra antes de ampliar investimento.",
        "Escalar campanhas com melhor ROAS e reduzir verba em origens sem retorno atribuido.",
    ]
    for index, step in enumerate(next_steps, start=1):
        story.append(_p(f"{index}. {step}", styles["body"]))

    doc.build(
        story,
        onFirstPage=lambda canvas, doc: _cover_canvas(canvas, doc, client_name, period_label),
        onLaterPages=_page_canvas,
    )
    return buffer.getvalue()
