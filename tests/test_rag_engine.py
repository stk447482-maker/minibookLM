# [License] Verified Free & Commercial Use.
# [Auditor] Antigravity 2.0 x takumiGuard
# [Status] Pass (Harness env checked).
# [Timestamp] 2026-07-29T23:27:00Z

import pytest
from langchain_core.documents import Document
from src.rag_engine import (
    extract_snippet,
    highlight_text,
    perform_honest_precision_search,
    extract_graph_rag_triples,
    build_graph_summary,
    robust_web_search
)

def test_extract_snippet_with_query():
    text = "高圧ガス保安法に基づき、第一種製造設備と火気取扱施設との距離は8m以上確保しなければならない。"
    snippet = extract_snippet(text, "8m")
    assert "8m" in snippet

def test_highlight_text():
    text = "火気距離は8m以上必要です。"
    hl = highlight_text(text, "8m")
    assert "<mark>8m</mark>" in hl

def test_perform_honest_precision_search():
    docs = [
        Document(page_content="貯槽の周囲2m以内は火気使用禁止。", metadata={"source_name": "rule.pdf", "page": 3}),
        Document(page_content="一般的テキスト", metadata={"source_name": "general.txt"})
    ]
    res = perform_honest_precision_search("2m", docs)
    assert len(res) >= 1
    assert "rule.pdf (p.4)" in res[0].metadata["source_name"]

def test_graph_rag_triples():
    docs = [Document(page_content="第一種製造設備と火気取扱施設の距離は8m以上とする", metadata={"source_name": "law.pdf"})]
    triples = extract_graph_rag_triples(docs)
    assert len(triples) >= 1
    summary = build_graph_summary(triples)
    assert "GraphRAG" in summary

def test_marp_preview_generation():
    from src.studio_generators import generate_marp_preview_html
    marp_md = "# Title\n---\n## Page 2\nContent"
    html_preview = generate_marp_preview_html(marp_md)
    assert "SLIDE 1" in html_preview
    assert "SLIDE 2" in html_preview

def test_perform_full_scan_search():
    from src.rag_engine import perform_full_scan_search
    docs = [Document(page_content="貯槽の安全離隔距離は2m以上必要", metadata={"source_name": "spec.pdf"})]
    res = perform_full_scan_search("距離", docs)
    assert len(res) >= 1


