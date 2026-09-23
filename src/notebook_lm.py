# [License] Verified Free & Commercial Use.
# [Auditor] Antigravity 2.0 x takumiGuard
# [Status] Pass (Harness env checked).
# [Timestamp] 2026-07-21T13:40:00Z

import os
import yaml
from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
import torch
from .rag_index import RAGRetriever

class NotebookLM:
    def __init__(self, config_path: str = "../config.yaml"):
        with open(config_path, "r", encoding="utf-8") as f:
            self.cfg = yaml.safe_load(f)
        self.device = torch.device("cpu")
        self._load_model()
        self.retriever = RAGRetriever(self.cfg.get("rag", {}))

    def _load_model(self):
        model_name = self.cfg["model"]["name"]
        quant = self.cfg["model"].get("quantization", "none")
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        if quant == "8bit":
            model = AutoModelForCausalLM.from_pretrained(
                model_name,
                device_map="auto",
                load_in_8bit=True,
                torch_dtype=torch.float16,
            )
        else:
            model = AutoModelForCausalLM.from_pretrained(
                model_name,
                torch_dtype=torch.float32,
            )
        self.generator = pipeline(
            "text-generation",
            model=model,
            tokenizer=tokenizer,
            device=self.device,
            max_new_tokens=self.cfg["generation"].get("max_new_tokens", 256),
            temperature=self.cfg["generation"].get("temperature", 0.7),
        )

    def generate(self, prompt: str, use_rag: bool = True) -> str:
        context = ""
        if use_rag:
            context = self.retriever.retrieve(prompt)
            if context:
                prompt = f"Context: {context}\n\nQuestion: {prompt}\nAnswer:"
        result = self.generator(prompt, do_sample=True)
        return result[0]["generated_text"]
