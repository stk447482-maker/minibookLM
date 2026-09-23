# [License] Verified Free & Commercial Use.
# [Auditor] Antigravity 2.0 x takumiGuard
# [Status] Pass (Harness env checked).
# [Timestamp] 2026-07-29T23:26:00Z

# アーティファクトドキュメント生成専用モジュール

def generate_briefing_document(llm, active_docs):
    if not active_docs:
        return "資料が選択されていません。"
    sample_text = "\n\n".join([d.page_content for d in active_docs[:10]])[:8000]
    brief_prompt = f"以下の資料内容から、重要な要点、概要、決定事項、背景を整理した要約ブリーフィング文書を作成してください:\n\n{sample_text}"
    res = llm.invoke(brief_prompt)
    return res.content if hasattr(res, 'content') else str(res)

def generate_study_report(llm, active_docs):
    if not active_docs:
        return "資料が選択されていません。"
    sample_text = "\n\n".join([d.page_content for d in active_docs[:10]])[:8000]
    report_prompt = f"以下の資料群を多角的に分析し、1. 概要・背景, 2. 主要な発見・要点分析, 3. 課題と解決策, 4. 総合結論 を含む詳細な研究・調査レポート(Markdown形式)を作成してください:\n\n{sample_text}"
    res = llm.invoke(report_prompt)
    return res.content if hasattr(res, 'content') else str(res)

def generate_faq_list(llm, active_docs):
    if not active_docs:
        return "資料が選択されていません。"
    sample_text = "\n\n".join([d.page_content for d in active_docs[:10]])[:8000]
    faq_prompt = f"以下の資料内容から、ユーザーや関係者が最も疑問に抱く重要質問5つと、それに対する正確な回答ペア(FAQ)を作成してください:\n\n{sample_text}"
    res = llm.invoke(faq_prompt)
    return res.content if hasattr(res, 'content') else str(res)

def generate_learning_guide(llm, active_docs):
    if not active_docs:
        return "資料が選択されていません。"
    sample_text = "\n\n".join([d.page_content for d in active_docs[:10]])[:8000]
    guide_prompt = f"以下の資料内容から、初心者向けに重要概念を分かりやすく解説した学習ガイドと、理解度を測る確認テスト問題3問(解答・解説付き)を作成してください:\n\n{sample_text}"
    res = llm.invoke(guide_prompt)
    return res.content if hasattr(res, 'content') else str(res)

def generate_mindmap_mermaid(llm, active_docs):
    if not active_docs:
        return "資料が選択されていません。"
    sample_text = "\n\n".join([d.page_content for d in active_docs[:10]])[:8000]
    mindmap_prompt = f"以下の資料の概念構造を、必ずMermaid記法の `mindmap` フォーマットのみでコードブロック形式で出力してください:\n\n{sample_text}"
    res = llm.invoke(mindmap_prompt)
    return res.content if hasattr(res, 'content') else str(res)

def generate_presentation_slides(llm, active_docs):
    if not active_docs:
        return "資料が選択されていません。"
    sample_text = "\n\n".join([d.page_content for d in active_docs[:10]])[:8000]
    slide_prompt = f"""以下の資料内容を分析し、プレゼンテーション用スライド（Marp Markdown形式）を作成してください。
ルール:
- スライドの区切りは `---` を使用してください。
- 1枚目: 表題・副題・発表日
- 2枚目: アジェンダ・目次
- 3〜6枚目: 本論（要点、図解用箇条書き、数値データ、結論）
- デザインテーマヘッダー `<!-- theme: default -->` を冒頭に付与してください。

資料内容:
{sample_text}"""
    res = llm.invoke(slide_prompt)
    return res.content if hasattr(res, 'content') else str(res)

def generate_flowchart_mermaid(llm, active_docs):
    if not active_docs:
        return "資料が選択されていません。"
    sample_text = "\n\n".join([d.page_content for d in active_docs[:10]])[:8000]
    flow_prompt = f"以下の資料から業務プロセス、法令の条件分岐、または概念処理フローを抽出し、必ずMermaid記法の `graph TD` または `flowchart TD` フォーマットのみでコードブロック形式で出力してください:\n\n{sample_text}"
    res = llm.invoke(flow_prompt)
    return res.content if hasattr(res, 'content') else str(res)

def generate_marp_preview_html(marp_markdown: str) -> str:
    """
    Marp Markdown をカード式リアルタイムプレビューに変換し、HTML 文字列を返す。
    スライドは <div class="slide-card"> で包み、CSS のプロジェクターカード効果を付与。
    """
    import html
    slides = [s.strip() for s in marp_markdown.split('---') if s.strip()]
    slide_divs = ""
    for idx, slide in enumerate(slides, 1):
        slide_divs += f'''
        <div style="background:#1e293b; border:2px solid #38bdf8; border-radius:12px; padding:20px; margin-bottom:15px; box-shadow:0 4px 12px rgba(0,0,0,0.3);">
          <div style="color:#38bdf8; font-weight:bold; font-size:0.95rem; margin-bottom:8px; border-bottom:1px solid #334155; padding-bottom:4px;">📊 SLIDE {idx}</div>
          <div style="color:#f8fafc; font-size:1.05rem; line-height:1.7;">{html.escape(slide).replace('\n', '<br>')}</div>
        </div>
        '''
    return slide_divs

def render_zoomable_mermaid(mermaid_code: str, container_id: str = "mermaid-container") -> str:
    """
    Mermaidコードをズーム＆パン（拡大・縮小・移動）可能なHTMLコンテナとしてレンダリングする。
    """
    import html
    clean_code = mermaid_code.strip()
    if clean_code.startswith("```mermaid"):
        clean_code = clean_code[10:]
    if clean_code.startswith("```"):
        clean_code = clean_code[3:]
    if clean_code.endswith("```"):
        clean_code = clean_code[:-3]
    clean_code = clean_code.strip()

    escaped_code = html.escape(clean_code)

    return f"""
    <div id="{container_id}-wrapper" style="width:100%; border:2px solid #38bdf8; border-radius:12px; background:#0f172a; overflow:hidden; position:relative; margin-top:10px; margin-bottom:20px;">
        <div style="position:absolute; top:10px; right:10px; z-index:100; display:flex; gap:6px; background:rgba(15,23,42,0.85); padding:6px 10px; border-radius:8px; border:1px solid #334155;">
            <button onclick="zoomMermaid('{container_id}', 1.2)" style="background:#1e293b; color:#38bdf8; border:1px solid #38bdf8; border-radius:4px; padding:4px 10px; cursor:pointer; font-weight:bold;">🔍 拡大 (+)</button>
            <button onclick="zoomMermaid('{container_id}', 0.8)" style="background:#1e293b; color:#38bdf8; border:1px solid #38bdf8; border-radius:4px; padding:4px 10px; cursor:pointer; font-weight:bold;">🔍 縮小 (-)</button>
            <button onclick="resetMermaid('{container_id}')" style="background:#1e293b; color:#f8fafc; border:1px solid #64748b; border-radius:4px; padding:4px 10px; cursor:pointer;">↺ リセット</button>
        </div>
        <div id="{container_id}-viewport" style="width:100%; height:500px; overflow:auto; cursor:grab; padding:20px; box-sizing:border-box;">
            <div id="{container_id}-canvas" style="transform-origin: 0 0; transition: transform 0.1s ease-out; display:inline-block; min-width:100%;">
                <pre class="mermaid" style="background:transparent; margin:0;">
{escaped_code}
                </pre>
            </div>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.min.js"></script>
        <script>
            if (typeof mermaid !== 'undefined') {{
                mermaid.initialize({{ startOnLoad: true, theme: 'dark' }});
            }}
            if (!window.mermaidScales) window.mermaidScales = {{}};
            window.mermaidScales['{container_id}'] = 1.0;

            function zoomMermaid(id, factor) {{
                let currentScale = window.mermaidScales[id] || 1.0;
                currentScale *= factor;
                if (currentScale < 0.3) currentScale = 0.3;
                if (currentScale > 5.0) currentScale = 5.0;
                window.mermaidScales[id] = currentScale;
                const canvas = document.getElementById(id + '-canvas');
                if (canvas) {{
                    canvas.style.transform = 'scale(' + currentScale + ')';
                }}
            }}

            function resetMermaid(id) {{
                window.mermaidScales[id] = 1.0;
                const canvas = document.getElementById(id + '-canvas');
                if (canvas) {{
                    canvas.style.transform = 'scale(1.0)';
                }}
            }}
        </script>
    </div>
    """

def convert_marp_to_standalone_html(marp_markdown):

    import html
    slides = marp_markdown.split('---')
    slides_html = ""
    for idx, slide in enumerate(slides):
        slide_clean = slide.strip()
        if not slide_clean: continue
        slides_html += f"""
        <div class="slide-card">
            <div class="slide-header">SLIDE {idx+1}</div>
            <div class="slide-body">{html.escape(slide_clean).replace('\n', '<br>')}</div>
        </div>"""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Marp Presentation Slides</title>
<style>
body {{ font-family: sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px; }}
.slide-card {{ background: #1e293b; border: 2px solid #38bdf8; border-radius: 12px; padding: 30px; margin-bottom: 30px; box-shadow: 0 8px 20px rgba(0,0,0,0.3); }}
.slide-header {{ color: #38bdf8; font-weight: bold; font-size: 0.9rem; letter-spacing: 1px; margin-bottom: 15px; border-bottom: 1px solid #334155; padding-bottom: 8px; }}
.slide-body {{ font-size: 1.1rem; line-height: 1.8; }}
</style></head><body>
<h1 style="color:#38bdf8; text-align:center;">📊 Marp Interactive Slide Deck</h1>
{slides_html}
</body></html>"""

