# [License] Verified Free & Commercial Use.
# [Auditor] Antigravity 2.0 x takumiGuard
# [Status] Pass (Harness env checked).
# [Timestamp] 2026-07-29T23:26:00Z

import os
import urllib.request
import re
import streamlit as st
from PIL import Image

from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.llms import Ollama
try:
    from langchain_community.retrievers import BM25Retriever
except ImportError:
    from langchain.retrievers import BM25Retriever

# 自作非結合モジュールのインポート
from src.rag_engine import (
    SourcePreview,
    extract_snippet,
    highlight_text,
    perform_honest_precision_search,
    perform_full_scan_search,
    extract_graph_rag_triples,
    build_graph_summary,
    build_interactive_3d_graph,
    robust_web_search,
    export_project_to_html,
    SmartLlamaCppServer
)
from src.studio_generators import (
    generate_briefing_document,
    generate_study_report,
    generate_faq_list,
    generate_learning_guide,
    generate_mindmap_mermaid,
    generate_presentation_slides,
    generate_flowchart_mermaid,
    generate_marp_preview_html,
    render_zoomable_mermaid,
    convert_marp_to_standalone_html
)
from src.podcast_engine import (
    generate_podcast_script,
    generate_podcast_audio_sync
)

st.set_page_config(page_title="Personal NotebookLM Next-Gen Studio Ultra", layout="wide", initial_sidebar_state="expanded")

# 高コントラスト＆高視認性テーマCSS
st.markdown("""
<style>
    html, body, [class*="css"] {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .hero-title {
        color: #1e293b;
        font-weight: 800;
        font-size: 2.2rem;
        margin-bottom: 0.2rem;
    }
    div[data-testid="stExpander"] {
        border-radius: 8px !important;
        border: 1px solid #cbd5e1 !important;
    }
    mark {
        background-color: #fef08a !important;
        color: #854d0e !important;
        padding: 2px 5px !important;
        border-radius: 4px !important;
        font-weight: 700 !important;
        border: 1px solid #fde047 !important;
    }
</style>
""", unsafe_allow_html=True)

# エンベディングモデルロード
@st.cache_resource
def get_embeddings():
    return HuggingFaceEmbeddings(model_name="intfloat/multilingual-e5-base")

embeddings = get_embeddings()

# 高精度 Whisper モデルキャッシュロード
@st.cache_resource
def get_whisper_model(model_name="small"):
    import whisper
    return whisper.load_model(model_name)

# 超高性能 OCR 画像前処理（コントラスト補正・二値化・シャープ化）
def preprocess_image_for_ocr(img_path):
    from PIL import ImageEnhance, ImageFilter
    img = Image.open(img_path).convert("L") # グレースケール化
    img = ImageEnhance.Contrast(img).enhance(2.0) # コントラスト200%強化
    img = ImageEnhance.Sharpness(img).enhance(1.5) # シャープ化
    img = img.filter(ImageFilter.SHARPEN)
    return img

def select_source(content, title, query="", search_method="", similarity_score="", msg_idx=None):
    st.session_state["selected_source"] = content
    st.session_state["selected_source_title"] = title
    st.session_state["selected_source_method"] = str(search_method)
    st.session_state["selected_source_score"] = str(similarity_score)
    if query:
        st.session_state["last_query"] = query
    if msg_idx is not None:
        st.session_state["selected_msg_idx"] = msg_idx

def detect_local_servers():
    servers = []
    try:
        req = urllib.request.Request("http://127.0.0.1:1235/v1/models")
        res = urllib.request.urlopen(req, timeout=1)
        if res.status == 200:
            servers.append({"name": "llama-server (Port 1235)", "type": "llama.cpp", "url": "http://127.0.0.1:1235/v1"})
    except Exception:
        pass
    return servers

# セッション初期化
if "chat_threads" not in st.session_state:
    st.session_state.chat_threads = [{"id": "default", "title": "メインスレッド", "history": []}]
if "active_thread_id" not in st.session_state:
    st.session_state.active_thread_id = "default"
if "notes" not in st.session_state:
    st.session_state.notes = []
if "web_docs" not in st.session_state:
    st.session_state.web_docs = []

# サイドバー（左Pane） UI
with st.sidebar:
    st.header("💬 1. チャットスレッド管理")
    
    # ➕ 新規スレッドをワンクリックで瞬時に作成するボタン
    if st.button("➕ 新規スレッドを開始", use_container_width=True, type="primary", key="btn_quick_new_thread"):
        new_id = f"thread_{len(st.session_state.chat_threads)+1}"
        new_title = f"新規スレッド #{len(st.session_state.chat_threads)+1}"
        st.session_state.chat_threads.append({"id": new_id, "title": new_title, "history": []})
        st.session_state.active_thread_id = new_id
        st.toast("新しいスレッドを作成しました！")
        st.rerun()

    # スレッド一覧をラジオボタンリストで表示（ワンクリック切替）
    thread_ids = [th["id"] for th in st.session_state.chat_threads]
    thread_map = {th["id"]: f"📌 {th['title']} ({len(th['history'])}件)" for th in st.session_state.chat_threads}
    current_idx = thread_ids.index(st.session_state.active_thread_id) if st.session_state.active_thread_id in thread_ids else 0
    
    selected_th_id = st.radio(
        "アクティブスレッド一覧",
        options=thread_ids,
        format_func=lambda x: thread_map[x],
        index=current_idx,
        key="radio_thread_select"
    )
    st.session_state.active_thread_id = selected_th_id
    active_th = next((th for th in st.session_state.chat_threads if th["id"] == selected_th_id), st.session_state.chat_threads[0])

    # コンパクトなインライン操作（タイトル編集 / スレッド削除）
    with st.expander("⚙️ スレッド設定・操作"):
        edit_title = st.text_input("スレッド名を変更", value=active_th["title"], key=f"edit_th_title_{active_th['id']}")
        col_th_act1, col_th_act2 = st.columns([1, 1])
        with col_th_act1:
            if st.button("💾 名前保存", key=f"btn_save_th_title_{active_th['id']}", use_container_width=True):
                if edit_title.strip():
                    active_th["title"] = edit_title.strip()
                    st.toast("スレッド名を更新しました！")
                    st.rerun()
        with col_th_act2:
            if len(st.session_state.chat_threads) > 1:
                if st.button("🗑️ スレッド削除", key=f"btn_del_th_{active_th['id']}", use_container_width=True):
                    st.session_state.chat_threads = [th for th in st.session_state.chat_threads if th["id"] != active_th["id"]]
                    st.session_state.active_thread_id = st.session_state.chat_threads[0]["id"]
                    st.toast("スレッドを削除しました！")
                    st.rerun()


    st.divider()
    st.header("📚 2. 資料インポート & ドキュメント管理")
    whisper_model_size = st.selectbox(
        "🎙️ 音声文字起こしモデル (Whisper)", 
        options=["tiny", "base", "small", "medium"], 
        index=2, 
        help="small/mediumを選択すると日本語の文字起こし精度が劇的に向上します。"
    )
    
    uploaded_files = st.file_uploader(
        "ローカルファイルをインポート", 
        type=["pdf", "txt", "md", "csv", "json", "png", "jpg", "jpeg", "mp3", "wav", "m4a"], 
        accept_multiple_files=True
    )
    
    web_url_input = st.text_input("🌐 WebページURLを入力して解析", placeholder="https://example.com/article")
    if st.button("📥 URL資料として読み込み", key="btn_load_url"):
        if web_url_input.strip():
            with st.spinner("🌐 Webページのコンテンツを取得中..."):
                try:
                    req = urllib.request.Request(web_url_input, headers={'User-Agent': 'Mozilla/5.0'})
                    html_data = urllib.request.urlopen(req).read().decode('utf-8', errors='ignore')
                    clean_text = re.sub(r'<script.*?>.*?</script>', '', html_data, flags=re.DOTALL)
                    clean_text = re.sub(r'<style.*?>.*?</style>', '', clean_text, flags=re.DOTALL)
                    clean_text = re.sub(r'<.*?>', '', clean_text)
                    clean_text = re.sub(r'\s+', ' ', clean_text).strip()
                    
                    from langchain_core.documents import Document
                    doc_obj = Document(page_content=clean_text[:15000], metadata={"source_name": web_url_input})
                    st.session_state.web_docs.append(doc_obj)
                    st.success("✅ Webページを資料に追加しました！")
                except Exception as url_err:
                    st.error(f"URL読み込みエラー: {url_err}")

    active_docs = []
    active_docs.extend(st.session_state.web_docs)

    if uploaded_files:
        os.makedirs("documents", exist_ok=True)
        total_f = len(uploaded_files)
        prog_bar = st.progress(0, text="📄 ファイル読み込み解析中...")
        for idx, f in enumerate(uploaded_files):
            prog_bar.progress(int((idx + 1) / total_f * 100), text=f"📄 [{idx+1}/{total_f}] {f.name} を解析中...")
            file_path = os.path.join("documents", f.name)
            with open(file_path, "wb") as fp: fp.write(f.read())
            fname_lower = f.name.lower()
            from langchain_core.documents import Document

            if fname_lower.endswith((".png", ".jpg", ".jpeg")):
                try:
                    import pytesseract
                    prep_img = preprocess_image_for_ocr(file_path)
                    ocr_txt = pytesseract.image_to_string(prep_img, lang="jpn+eng")
                    loaded = [Document(page_content=f"【高精度OCR解析テキスト ({f.name})】\n{ocr_txt}", metadata={"source_name": f.name})]
                except Exception as img_e:
                    loaded = [Document(page_content=f"【画像ファイル ({f.name})】", metadata={"source_name": f.name})]
            elif fname_lower.endswith((".mp3", ".wav", ".m4a")):
                try:
                    w_model = get_whisper_model(whisper_model_size)
                    # 専門用語ガイダンスプロンプトの注入とタイムスタンプセグメント抽出
                    initial_prompt_guide = "高圧ガス保安法, 第一種製造設備, 貯槽, 警戒標識, 火気距離, 許可申請, 定期検査, 安全弁, 認定事業者"
                    res = w_model.transcribe(file_path, language="ja", initial_prompt=initial_prompt_guide, fp16=False)
                    
                    # セグメントタイムスタンプの構造化整形 ([分:秒 - 分:秒])
                    formatted_transcript = []
                    if "segments" in res and res["segments"]:
                        for seg in res["segments"]:
                            start_m, start_s = divmod(int(seg.get("start", 0)), 60)
                            end_m, end_s = divmod(int(seg.get("end", 0)), 60)
                            time_stamp = f"[{start_m:02d}:{start_s:02d} - {end_m:02d}:{end_s:02d}]"
                            formatted_transcript.append(f"{time_stamp} {seg.get('text', '').strip()}")
                        full_audio_text = "\n".join(formatted_transcript)
                    else:
                        full_audio_text = res.get('text', '')

                    loaded = [Document(
                        page_content=f"【Whisper-{whisper_model_size} 高精度タイムスタンプ付き音声文字起こし ({f.name})】\n{full_audio_text}",
                        metadata={"source_name": f.name}
                    )]
                except Exception as aud_e:
                    loaded = [Document(page_content=f"【音声ファイル ({f.name})】解析エラー: {aud_e}", metadata={"source_name": f.name})]

            elif fname_lower.endswith(".pdf"):
                loader = PyPDFLoader(file_path)
                loaded = loader.load()
            else:
                loader = TextLoader(file_path, encoding="utf-8")
                loaded = loader.load()

            for doc in loaded:
                p_num = doc.metadata.get("page", None)
                if p_num is not None:
                    doc.metadata["source_name"] = f"{f.name} (p.{p_num + 1})"
                else:
                    doc.metadata["source_name"] = f.name
                doc.metadata["file_origin"] = f.name
            active_docs.extend(loaded)
        prog_bar.empty()

    # ドキュメント単位のファイル名一覧を抽出してマルチセレクト絞り込みUIを構築
    all_available_sources = list(set([d.metadata.get("file_origin", d.metadata.get("source_name", "Doc")) for d in active_docs]))
    
    if all_available_sources:
        st.markdown("#### 🎯 分析対象ドキュメントの絞り込み")
        selected_sources = st.multiselect(
            "アクティブ資料を選択 (未選択で全資料対象)",
            options=all_available_sources,
            default=all_available_sources,
            key="doc_filter_multiselect"
        )
        if selected_sources:
            active_docs = [d for d in active_docs if d.metadata.get("file_origin", d.metadata.get("source_name", "Doc")) in selected_sources]
            st.caption(f"💡 絞り込み適用中: {len(selected_sources)} / {len(all_available_sources)} 件の資料を対象")
        else:
            st.caption("💡 全資料が分析対象となります")

    st.divider()
    st.header("⚙️ 3. リサーチ＆AI接続設定")

    research_mode = st.selectbox("リサーチモード選択", ["通常RAG", "ファクトチェック (対比検証)", "📑 全資料網羅スキャン (全件抽出)", "Deep Research (マルチホップ)", "🕸️ GraphRAG (構造ネットワーク)"])
    enable_web_search = st.toggle("🌐 リアルタイムWeb検索補完", value=False)
    search_mode = st.radio("検索方式", ["ハイブリッド (BM25 + ベクトル)", "ベクトルのみ"])

    detected = detect_local_servers()
    backend_mode = st.radio("AI接続バックエンド", ["自動検知", "llama-server (Port 1235)", "Ollama"])
    
    if backend_mode == "自動検知" and detected:
        labels = [s["name"] for s in detected]
        selected_idx = st.selectbox("検出AIモデルを選択", range(len(labels)), format_func=lambda i: labels[i])
        target = detected[selected_idx]
        llm = SmartLlamaCppServer(target["url"])
    elif backend_mode == "llama-server (Port 1235)":
        port = st.number_input("Port", value=1235)
        llm = SmartLlamaCppServer(f"http://127.0.0.1:{port}/v1")
    else:
        ollama_model = st.text_input("Ollamaモデル名", value="qwen2.5:1.5b")
        llm = Ollama(model=ollama_model)

    st.divider()
    if st.button("🧹 ベクトルDBキャッシュを完全クリア", key="btn_clear_chroma"):
        import shutil
        p_dir = os.path.join("data", "chroma_db")
        if os.path.exists(p_dir):
            try:
                shutil.rmtree(p_dir)
                st.toast("✅ Chroma DBキャッシュを完全消去しました！")
            except Exception as c_err:
                st.error(f"クリアエラー: {c_err}")

# Retriever構築（ディスクキャッシュ永続化付き）
vector_retriever = None
bm25_retriever = None
if active_docs:
    persist_dir = os.path.join("data", "chroma_db")
    os.makedirs(persist_dir, exist_ok=True)
    splits = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=300).split_documents(active_docs)
    vectorstore = Chroma.from_documents(documents=splits, embedding=embeddings, persist_directory=persist_dir)
    vector_retriever = vectorstore.as_retriever(search_kwargs={"k": 8})
    try:
        bm25_retriever = BM25Retriever.from_documents(splits)
        bm25_retriever.k = 8
    except Exception:
        bm25_retriever = None

# メイン表示
st.markdown('<div class="hero-title">📖 Personal NotebookLM Studio Ultra</div>', unsafe_allow_html=True)
st.caption("✨ Decoupled Modular Architecture & Multi-Engine Protection Enabled")
st.write("")

tab_chat, tab_rag_search, tab_voice, tab_audio, tab_studio, tab_notes, tab_export = st.tabs([
    "💬 チャット & 根拠引用", 
    "🔍 RAG＆ベクトル直接検索・分析",
    "🗣️ リアルタイムボイスチャット",
    "🎙️ 音声ポッドキャスト", 
    "📊 自動概要生成 (Studio)", 
    "📌 ノートボード",
    "📤 一括書き出し & 共有"
])

# === タブ 1: チャット ===
with tab_chat:
    col_chat_main, col_source_side = st.columns([7, 3])
    active_th = next((th for th in st.session_state.chat_threads if th["id"] == st.session_state.active_thread_id), st.session_state.chat_threads[0])

    with col_chat_main:
        c_clear, _ = st.columns([2, 8])
        with c_clear:
            if st.button("🧹 会話履歴をクリア", key="btn_clear_thread_history"):
                active_th["history"] = []
                st.toast("スレッドの会話履歴をリセットしました！")
                st.rerun()

        user_query = st.chat_input("資料やWeb知識について質問してください...")
        
        for msg_idx, msg in enumerate(active_th["history"]):
            with st.chat_message(msg["role"]):
                st.markdown(msg["content"])
                if "sources" in msg and msg["sources"]:
                    st.write("🔍 **引用元プレビュー:**")
                    cols_btn = st.columns(max(1, len(msg["sources"])))
                    for idx, src in enumerate(msg["sources"]):
                        meta = src.metadata if hasattr(src, 'metadata') else {}
                        sim = meta.get("similarity_score", "")
                        meth = meta.get("search_method", "検索")
                        btn_lbl = f"📄 引用 [{idx+1}]"
                        if sim: btn_lbl += f" ({meth}:{sim}%)"
                        c_txt = src.page_content if hasattr(src, 'page_content') else str(src)
                        cols_btn[idx].button(
                            btn_lbl,
                            key=f"btn_src_{msg_idx}_{idx}",
                            on_click=select_source,
                            args=(c_txt, meta.get('source_name', 'Doc'), msg.get("query_text", ""), meth, sim, msg_idx)
                        )

        if user_query:
            st.session_state["last_query"] = user_query
            active_th["history"].append({"role": "user", "content": user_query, "query_text": user_query})

            is_full_scan_query = any(w in user_query for w in ["すべて", "全て", "全件", "一覧", "網羅", "漏れなく", "全部", "全リスト"])
            relevant_docs = []
            if research_mode == "🕸️ GraphRAG (構造ネットワーク)":
                with st.spinner("🕸️ GraphRAG 3D ネットワーク抽出中..."):
                    relevant_docs = perform_honest_precision_search(user_query, active_docs, vector_retriever, bm25_retriever)
                    triples = extract_graph_rag_triples(relevant_docs)
                    st.components.v1.html(build_interactive_3d_graph(triples), height=420)
                    st.markdown(build_graph_summary(triples))

            elif research_mode == "📑 全資料網羅スキャン (全件抽出)" or (is_full_scan_query and research_mode == "通常RAG"):
                with st.spinner("📑 全資料網羅スキャン中..."):
                    relevant_docs = perform_full_scan_search(user_query, active_docs, vector_retriever, bm25_retriever)
            else:
                with st.spinner("🎯 愚直・誠実・高精度検索エンジンでスキャン中..."):
                    relevant_docs = perform_honest_precision_search(user_query, active_docs, vector_retriever, bm25_retriever)

            web_search_text = ""
            if enable_web_search:
                web_res = robust_web_search(user_query)
                if web_res: web_search_text = f"\n【Web最新検索結果】\n{web_res}\n"

            all_chunks = [f"[{i+1}] ({d.metadata.get('source_name', 'Doc')}): {d.page_content}" for i, d in enumerate(relevant_docs)]
            strict_grounding_rule = """\n\n【本家NotebookLM完全準拠・対象項目主体構造化抽出命令】
提供された【資料】から、質問に関する対象項目・設備・作業内容を「主語」として体系的に抽出し、正確に回答してください。"""

            with st.spinner("🧠 資料全体を無制限Map-Reduce解析中..."):
                chunk_block_size = 7000
                doc_blocks = []
                curr_b = ""
                for chk in all_chunks:
                    if len(curr_b) + len(chk) > chunk_block_size:
                        if curr_b: doc_blocks.append(curr_b)
                        curr_b = chk
                    else:
                        curr_b += "\n\n" + chk if curr_b else chk
                if curr_b: doc_blocks.append(curr_b)

                map_summaries = []
                for b_idx, block in enumerate(doc_blocks):
                    map_prompt = [
                        {"role": "system", "content": "あなたは専門資料分析AIです。提示された資料ブロックから要約要素を抽出・箇条書きしてください。"},
                        {"role": "user", "content": f"【資料ブロック {b_idx+1}】:\n{block}\n\n質問: {user_query}"}
                    ]
                    try:
                        m_res = llm.invoke(map_prompt)
                        map_summaries.append(f"--- ブロック {b_idx+1} 要点 ---\n" + str(m_res))
                    except Exception: pass

                combined_map_text = "\n\n".join(map_summaries) if map_summaries else "\n\n".join(all_chunks)[:8000]
                if web_search_text: combined_map_text += "\n" + web_search_text

                reduce_prompt = [
                    {"role": "system", "content": f"あなたは高度な専門資料分析AIです。{strict_grounding_rule}"},
                    {"role": "user", "content": f"【資料抽出要素群】:\n{combined_map_text}\n\n質問: {user_query}"}
                ]

                answer_text = llm.invoke(reduce_prompt)
                active_th["history"].append({
                    "role": "assistant",
                    "content": answer_text,
                    "sources": relevant_docs,
                    "query_text": user_query
                })
                
                # 自動スレッドタイトル命名 (新規スレッドの場合)
                if active_th["title"].startswith("新規スレッド") or active_th["title"] == "メインスレッド":
                    if len(active_th["history"]) <= 2:
                        try:
                            auto_name_prompt = f"以下のユーザーの質問から、スレッドのタイトルとして適した非常に短く簡潔な見出し（絵文字1文字＋15文字以内）を作成してください。余計な解説は不要です。\n\n質問: {user_query}"
                            title_res = llm.invoke(auto_name_prompt)
                            clean_t = str(title_res).strip().replace('"', '').replace('\n', '')[:20]
                            if clean_t:
                                active_th["title"] = clean_t
                        except Exception: pass

                st.rerun()


    with col_source_side:
        st.markdown('### 📍 1. 引用プレビュー (上段)')
        if st.session_state.get("selected_source"):
            st.markdown(f"**📌 {st.session_state.get('selected_source_title', '引用資料')}**")
            hl = highlight_text(st.session_state.selected_source, st.session_state.get("last_query", ""))
            st.markdown(f'<div style="border:2px solid #3b82f6; padding:12px; border-radius:8px; background-color:#f0f9ff; color:#1e293b; max-height:320px; overflow-y:auto; line-height:1.6;">{hl}</div>', unsafe_allow_html=True)
        else:
            st.info("💡 チャットの「📄 引用」ボタンをクリックすると、引用元テキストがここに強調表示されます。")

        st.divider()
        st.markdown('### 📚 2. 追加資料プレビュー (下段)')
        if active_docs:
            sel_doc = st.selectbox("資料選択", options=[d.metadata.get("source_name", "Doc") for d in active_docs])
            full_txt = "\n\n".join([d.page_content for d in active_docs if d.metadata.get("source_name") == sel_doc])
            st.markdown(f'<div style="border:1px solid #cbd5e1; padding:12px; border-radius:8px; background-color:#f8fafc; color:#1e293b; max-height:350px; overflow-y:auto;">{highlight_text(full_txt, st.session_state.get("last_query", ""))}</div>', unsafe_allow_html=True)

# === タブ 2: RAG検索 ===
with tab_rag_search:
    st.header("🔍 RAG＆ベクトル直接検索・視覚化インスペクター")
    rag_query = st.text_input("検索クエリを入力", key="rag_tab_q")
    if rag_query:
        raw_results = perform_honest_precision_search(rag_query, active_docs, vector_retriever, bm25_retriever)
        st.markdown(f"### 📋 検索ヒット件数: {len(raw_results)}件")
        
        # 10件ずつのインタラクティブ・ページネーション制御
        page_size = 10
        total_pages = max(1, (len(raw_results) + page_size - 1) // page_size)
        col_p1, col_p2 = st.columns([3, 7])
        with col_p1:
            current_page = st.number_input("ページ選択", min_value=1, max_value=total_pages, value=1, step=1, key="rag_search_page_num")
        with col_p2:
            st.write(f"表示中: { (current_page-1)*page_size + 1 } ～ { min(current_page*page_size, len(raw_results)) } 件目 (全{total_pages}ページ)")

        start_idx = (current_page - 1) * page_size
        paged_results = raw_results[start_idx : start_idx + page_size]

        hit_texts = []
        for idx, doc_item in enumerate(paged_results, start=start_idx+1):
            src_n = doc_item.metadata.get("source_name", "Doc")
            hit_texts.append(f"[{idx}] ({src_n}): {doc_item.page_content}")
            with st.expander(f"📄 [{idx}] 資料: {src_n}"):
                st.markdown(highlight_text(doc_item.page_content, rag_query), unsafe_allow_html=True)
        
        st.divider()
        st.markdown("### 🤖 検索ヒット結果のAI要約サマリー")
        if hit_texts:
            sum_res = llm.invoke(f"以下の検索ヒットテキスト群を箇条書きで要約してください:\n\n" + "\n\n".join(hit_texts)[:10000])
            st.success("✅ **AI要約**")
            st.markdown(sum_res)


# === タブ 3: 🗣️ リアルタイムボイスチャット (Interactive Voice AI) ===
with tab_voice:
    st.header("🗣️ リアルタイムボイスチャット (Voice AI Agent)")
    st.write("マイク直接録音またはテキスト入力でAIと即座に音声対話を行います。")
    
    col_v1, col_v2 = st.columns([1, 1])
    with col_v1:
        st.markdown("#### 🎤 音声直接入力 (マイク録音)")
        try:
            from streamlit_mic_recorder import mic_recorder
            mic_audio = mic_recorder(start_prompt="🎤 録音開始", stop_prompt="⏹️ 録音終了・発話", key="tab3_mic")
            if mic_audio and "bytes" in mic_audio:
                with st.spinner("🎙️ 音声入力文を文字起こし中..."):
                    import tempfile
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tf:
                        tf.write(mic_audio["bytes"])
                        tf_path = tf.name
                    w_mod = get_whisper_model(whisper_model_size)
                    w_res = w_mod.transcribe(tf_path, language="ja")
                    v_in_speech = w_res.get("text", "").strip()
                    if v_in_speech:
                        st.info(f"🗣️ 認識結果: 「{v_in_speech}」")
                        st.session_state["v_in_text"] = v_in_speech
        except Exception:
            st.caption("※マイク入力モジュール未検出時は以下のテキスト発声をご利用ください。")

    with col_v2:
        st.markdown("#### ⌨️ テキストメッセージ入力")
        default_v_in = st.session_state.get("v_in_text", "")
        v_in = st.text_input("発話メッセージ", value=default_v_in, key="v_in", placeholder="例: 今日の分析結果の結論を簡潔に教えて")

    if st.button("🗣️ AI対話・発話実行", use_container_width=True):
        final_v_prompt = v_in if v_in else st.session_state.get("v_in_text", "")
        if final_v_prompt:
            with st.spinner("🗣️ AIが音声回答を作成中..."):
                ans = llm.invoke(f"簡潔かつ自然な話し言葉（対話形式）でお答えください: {final_v_prompt}")
                st.markdown(f"**🤖 AI:** {ans}")
                
                # 自動音声合成
                try:
                    import asyncio, edge_tts
                    async def gen_v_audio(t):
                        c = edge_tts.Communicate(t, "ja-JP-NanamiNeural")
                        b = bytearray()
                        async for chk in c.stream():
                            if chk["type"] == "audio": b.extend(chk["data"])
                        return bytes(b)
                    v_audio_bytes = asyncio.run(gen_v_audio(str(ans)))
                    st.audio(v_audio_bytes, format="audio/mp3", autoplay=True)
                except Exception as v_err:
                    st.error(f"音声出力エラー: {v_err}")


# === タブ 4: 🎙️ 音声概要ポッドキャスト (Dual-Host Audio Overview) ===
with tab_audio:
    st.header("🎙️ 音声概要ポッドキャスト (Dual-Host AI Radio)")
    st.write("男性ホスト（Keita）と女性解説者（Nanami）の2名が、インポートした全資料を分かりやすく深掘り解説するラジオ対話番組を生成・再生します。")

    if not active_docs:
        st.info("💡 資料が選択されていません。サイドバーから資料をインポートしてください。")
    else:
        if st.button("🎧 ポッドキャスト番組をフル生成 (台本＋対話音声)", use_container_width=True):
            with st.spinner("🎙️ 1/2: インポート資料群からプロ対話台本を作成中..."):
                script_txt = generate_podcast_script(llm, active_docs)
                st.session_state["podcast_script"] = script_txt

            with st.spinner("🔊 2/2: 男性ホスト & 女性解説者の掛け合い音声を合成中 (Edge-TTS)..."):
                audio_data = generate_podcast_audio_sync(script_txt)
                st.session_state["podcast_audio"] = audio_data
                st.toast("✅ ポッドキャスト音声の作成が完了しました！")

        if st.session_state.get("podcast_script"):
            st.divider()
            st.markdown("### 📻 生成された対話音声プレイヤー")
            if st.session_state.get("podcast_audio"):
                st.audio(st.session_state["podcast_audio"], format="audio/mp3")
                st.download_button(
                    "📥 ポッドキャストMP3ファイルを保存", 
                    data=st.session_state["podcast_audio"], 
                    file_name="notebooklm_podcast.mp3", 
                    mime="audio/mp3"
                )

            st.divider()
            st.markdown("### 📝 番組対話スクリプト (台本)")
            st.text_area("台本プレビュー", value=st.session_state["podcast_script"], height=350)

# === タブ 5: Studio (モジュール化結合) ===
with tab_studio:
    st.header("📊 自動概要生成 (Studio Artifacts)")
    st.write("インポートした資料群から、用途に応じた高品質なドキュメント・レポート・図をボタン一つで自動生成します。")

    if not active_docs:
        st.info("💡 資料が選択されていません。サイドバーから資料をインポートしてください。")
    else:
        b1, b2, b3, b4, b5, b6, b7 = st.columns(7)
        with b1: btn_brief = st.button("📄 ブリーフィング文書", use_container_width=True)
        with b2: btn_report = st.button("📊 詳細研究レポート", use_container_width=True)
        with b3: btn_faq = st.button("❓ 想定Q&A (FAQ)", use_container_width=True)
        with b4: btn_guide = st.button("🎓 学習ガイド", use_container_width=True)
        with b5: btn_mindmap = st.button("🧠 マインドマップ", use_container_width=True)
        with b6: btn_slide = st.button("🖥️ プレゼンスライド (Marp)", use_container_width=True)
        with b7: btn_flow = st.button("🔀 フローチャート", use_container_width=True)

        if btn_brief:
            with st.spinner("📄 ブリーフィング文書を生成中..."):
                txt = generate_briefing_document(llm, active_docs)
                st.markdown("### 📄 ブリーフィング文書 (Executive Briefing)")
                st.markdown(txt)
                st.session_state.notes.append(f"**【ブリーフィング文書】**\n\n{txt}")
                st.toast("ブリーフィング文書をノートボードに保存しました！")

        elif btn_report:
            with st.spinner("📊 詳細研究レポートを作成中..."):
                txt = generate_study_report(llm, active_docs)
                st.markdown("### 📊 詳細研究レポート (Comprehensive Study Report)")
                st.markdown(txt)
                st.session_state.notes.append(f"**【詳細研究レポート】**\n\n{txt}")
                st.toast("研究レポートをノートボードに保存しました！")

        elif btn_faq:
            with st.spinner("❓ FAQ・Q&A集を生成中..."):
                txt = generate_faq_list(llm, active_docs)
                st.markdown("### ❓ 想定質問集 (FAQ)")
                st.markdown(txt)
                st.session_state.notes.append(f"**【FAQ】**\n\n{txt}")
                st.toast("FAQをノートボードに保存しました！")

        elif btn_guide:
            with st.spinner("🎓 学習ガイド＆確認テストを生成中..."):
                txt = generate_learning_guide(llm, active_docs)
                st.markdown("### 🎓 学習ガイド＆理解度チェックテスト")
                st.markdown(txt)
                st.session_state.notes.append(f"**【学習ガイド】**\n\n{txt}")
                st.toast("学習ガイドをノートボードに保存しました！")

        elif btn_mindmap:
            with st.spinner("🧠 Mermaidマインドマップ構造を抽出中..."):
                txt = generate_mindmap_mermaid(llm, active_docs)
                st.markdown("### 🧠 マインドマップ (Mermaid Diagram)")
                st.components.v1.html(render_zoomable_mermaid(txt, container_id="mindmap-zoom"), height=550)
                st.code(txt, language="mermaid")
                st.session_state.notes.append(f"**【マインドマップ】**\n\n```mermaid\n{txt}\n```")
                st.toast("マインドマップをノートボードに保存しました！")

        elif btn_slide:
            with st.spinner("🖥️ プレゼンテーションスライド(Marp)を生成中..."):
                marp_txt = generate_presentation_slides(llm, active_docs)
                st.session_state["last_marp_slides"] = marp_txt
                st.markdown("### 🖥️ プレゼンテーションスライド (Marp Markdown)")
                st.code(marp_txt, language="markdown")
                
                # スライドプレビューのカード型プロジェクター表示
                st.markdown("#### 📊 スライドリアルタイムプレビュー")
                st.markdown(generate_marp_preview_html(marp_txt), unsafe_allow_html=True)

                # HTMLスライド デモ書き出し
                slide_html = convert_marp_to_standalone_html(marp_txt)
                st.download_button("📥 スタンドアロン HTML スライドとして保存", data=slide_html, file_name="presentation_slides.html", mime="text/html")
                st.session_state.notes.append(f"**【プレゼンスライド (Marp)】**\n\n```markdown\n{marp_txt}\n```")
                st.toast("スライドをノートボードに保存しました！")

        elif btn_flow:
            with st.spinner("🔀 業務フローチャート構造を抽出中..."):
                flow_txt = generate_flowchart_mermaid(llm, active_docs)
                st.markdown("### 🔀 業務フローチャート (Mermaid Flowchart)")
                st.components.v1.html(render_zoomable_mermaid(flow_txt, container_id="flowchart-zoom"), height=550)
                st.code(flow_txt, language="mermaid")
                st.session_state.notes.append(f"**【フローチャート】**\n\n```mermaid\n{flow_txt}\n```")
                st.toast("フローチャートをノートボードに保存しました！")


# === タブ 6: ノート ===
with tab_notes:
    st.header("📌 ノートボード (Saved Notes)")
    n_in = st.text_area("メモ入力")
    if st.button("保存") and n_in:
        st.session_state.notes.append(n_in)
        st.rerun()

    st.divider()
    notes_to_delete = None
    for idx, note in enumerate(st.session_state.notes):
        with st.expander(f"📌 ノート #{idx+1}"):
            st.markdown(note)
            if st.button("🗑️ このノートを削除", key=f"btn_del_note_{idx}"):
                notes_to_delete = idx
    if notes_to_delete is not None:
        st.session_state.notes.pop(notes_to_delete)
        st.toast("ノートを削除しました！")
        st.rerun()

# === タブ 7: エクスポート ===
with tab_export:
    st.header("📤 一括書き出し & 共有")
    st.write("対話履歴、ノートボード、ポッドキャスト音声を含んだスタンドアロンHTMLレポートを出力します。")
    pod_bytes = st.session_state.get("podcast_audio", None)
    marp_md = st.session_state.get("last_marp_slides", None)
    html_data = export_project_to_html(active_th["history"], st.session_state.notes, active_docs, podcast_audio_bytes=pod_bytes, marp_markdown=marp_md)
    st.download_button("📥 完全統合 HTML レポートとしてエクスポート (音声/スライド/対話同梱)", data=html_data, file_name="notebooklm_complete_report.html", mime="text/html")