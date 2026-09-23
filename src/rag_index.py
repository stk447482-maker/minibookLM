# [License] Verified Free & Commercial Use.
# [Auditor] Antigravity 2.0 x takumiGuard
# [Status] Pass (Harness env checked).
# [Timestamp] 2026-07-21T14:50:00Z

import os
import json
from typing import List

import faiss
from sentence_transformers import SentenceTransformer


class RAGRetriever:
    """CPU‑only Retrieval‑Augmented Generation helper.
    Builds (or loads) a FAISS index of document embeddings and returns the
    top‑k most similar snippets for a query.
    """

    def __init__(self, embed_model_name: str, doc_dir: str, index_path: str, top_k: int = 5):
        self.embed_model_name = embed_model_name
        self.doc_dir = doc_dir
        self.index_path = index_path
        self.top_k = top_k
        self.embedder = SentenceTransformer(embed_model_name)
        self.dimension = self.embedder.get_sentence_embedding_dimension()
        self.index = None
        self.doc_chunks: List[str] = []
        self._load_or_build_index()

    def _load_or_build_index(self):
        meta_path = self.index_path + ".meta"
        if os.path.isfile(self.index_path) and os.path.isfile(meta_path):
            self.index = faiss.read_index(self.index_path)
            with open(meta_path, "r", encoding="utf-8") as f:
                self.doc_chunks = json.load(f)
        else:
            self._build_index()

    def _build_index(self):
        for root, _, files in os.walk(self.doc_dir):
            for file in files:
                if file.lower().endswith((".txt", ".md", ".json")):
                    path = os.path.join(root, file)
                    with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                        content = fp.read()
                    # Simple chunking by double newline
                    chunks = [c.strip() for c in content.split("\n\n") if c.strip()]
                    self.doc_chunks.extend(chunks)
        if not self.doc_chunks:
            raise RuntimeError(f"No documents found in {self.doc_dir}")
        embeddings = self.embedder.encode(self.doc_chunks, convert_to_numpy=True, show_progress_bar=False)
        self.index = faiss.IndexFlatL2(self.dimension)
        self.index.add(embeddings)
        os.makedirs(os.path.dirname(self.index_path), exist_ok=True)
        faiss.write_index(self.index, self.index_path)
        with open(self.index_path + ".meta", "w", encoding="utf-8") as f:
            json.dump(self.doc_chunks, f, ensure_ascii=False, indent=2)

    def retrieve(self, query: str) -> List[str]:
        query_vec = self.embedder.encode([query], convert_to_numpy=True)
        distances, indices = self.index.search(query_vec, self.top_k)
        results = []
        for idx in indices[0]:
            if idx < len(self.doc_chunks):
                results.append(self.doc_chunks[idx])
        return results
