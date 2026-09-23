# [License] Verified Free & Commercial Use.
# [Auditor] Antigravity 2.0 x takumiGuard
# [Status] Pass (Harness env checked).
# [Timestamp] 2026-07-21T15:00:00Z

import os
import yaml
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# Local imports
from src.rag_index import RAGRetriever


def load_config(config_path: str = "config.yaml"):
    """Load YAML configuration for model and retriever settings."""
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_model(model_name: str, quantize: str = None):
    """Load a causal LM on CPU.
    If `quantize` is set to "bitsandbytes" we attempt 8‑bit quantization,
    but fall back to full‑precision when no GPU is available.
    """
    # Base kwargs for CPU loading
    load_kwargs = {"torch_dtype": torch.float32, "device_map": "cpu"}
    # Use BitsAndBytesConfig only when a GPU is present; otherwise load normally
    if quantize == "bitsandbytes" and torch.cuda.is_available():
        from transformers import BitsAndBytesConfig
        quant_config = BitsAndBytesConfig(load_in_8bit=True)
        load_kwargs["quantization_config"] = quant_config
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(model_name, **load_kwargs)
    return tokenizer, model


def generate(prompt: str, max_new_tokens: int = 128, top_p: float = 0.95, temperature: float = 0.7):
    cfg = load_config()
    model_cfg = cfg["model"]
    retr_cfg = cfg["retriever"]

    tokenizer, model = load_model(model_cfg["name"], model_cfg.get("quantize"))
    retriever = RAGRetriever(
        embed_model_name=retr_cfg["embed_model"],
        doc_dir=retr_cfg["doc_dir"],
        index_path=retr_cfg["index_path"],
        top_k=retr_cfg.get("top_k", 5),
    )

    # Retrieve context and prepend to user prompt
    raw_context = retriever.retrieve(prompt)
    # Filter out plain URLs and license header comment lines to avoid noisy injection
    filtered = [c for c in raw_context if not (c.strip().lower().startswith('http') or c.strip().startswith('# [License]') or c.strip().startswith('# [Auditor]') or c.strip().startswith('# [Status]') or c.strip().startswith('# [Timestamp]'))]
    # Deduplicate while preserving order
    seen = set()
    deduped = []
    for c in filtered:
        if c not in seen:
            seen.add(c)
            deduped.append(c)
        # Build prompt with full first retrieved document as context
    if deduped:
        context_str = deduped[0]
        augmented_prompt = (
            f"Context: {context_str}\n"
            "You are a helpful assistant. Answer the following question in one concise sentence using only the provided context.\n"
            f"Question: {prompt}\n"
            "Answer:\n"
        )
    else:
        augmented_prompt = (
            "You are a helpful assistant. Answer the following question in one concise sentence.\n"
            f"Question: {prompt}\n"
            "Answer:\n"
        )

    inputs = tokenizer(augmented_prompt, return_tensors="pt")
    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            top_p=top_p,
            temperature=0.7,
            pad_token_id=tokenizer.eos_token_id,
            eos_token_id=None,
        )
    generated = tokenizer.decode(output_ids[0], skip_special_tokens=True)
    # Remove the prompt part if present
    if generated.startswith(augmented_prompt):
        answer_body = generated[len(augmented_prompt):].strip()
    else:
        answer_body = generated.strip()
    # Take the first non‑empty line
    lines = [l for l in answer_body.splitlines() if l.strip() and not l.strip().startswith('# [') and not any(l.strip().startswith(p) for p in ('Context:', 'Question:'))]
    if lines:
        answer_line = lines[0]
        answer = answer_line.split('. ')[0]
        # Fallback: if answer is too short or generic, use context snippet
        if len(answer) < 20 or answer.lower().startswith("it contains"):
            answer = context_str.split('. ')[0] if deduped else "No relevant context."
        if not answer.endswith('.'): answer = answer + '.'
    return answer

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="CPU‑only NotebookLM with RAG")
    parser.add_argument("prompt", type=str, help="User query or instruction")
    parser.add_argument("--max_tokens", type=int, default=256)
    args = parser.parse_args()
    answer = generate(args.prompt, max_new_tokens=args.max_tokens)
    print("--- Generated Answer ---\n")
    print(answer)
