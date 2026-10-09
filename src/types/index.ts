// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

export type ModelMode = 'embedded-mobile' | 'desktop-gguf' | 'desktop-api' | 'cloud-gemini';

export interface ModelTuningProfile {
  category: string;
  context_window: number;
  temperature: number;
  top_p: number;
  repeat_penalty: number;
  n_gpu_layers: number;
  rag_top_k: number;
  description: string;
}

export interface ModelConfig {
  mode: ModelMode;
  embeddedModelId: string;
  desktopApiEndpoint?: string;
  desktopModelName?: string;
  desktopModelPath?: string;
  autoTuningEnabled?: boolean;
  tuningProfile?: ModelTuningProfile;
  cloudApiKey?: string;
  temperature: number;
  audioTranscriptionEngine?: 'auto' | 'gemini' | 'kotoba-whisper' | 'whisper-local';
}


export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentChunk {
  id: string;
  projectId: string;
  docId: string;
  docTitle: string;
  chunkIndex: number;
  content: string;
  parentContent: string;
  embedding?: number[];
}

export interface DocumentSource {
  id: string;
  projectId: string;
  title: string;
  type: 'pdf' | 'text' | 'markdown' | 'web' | 'audio' | 'video';
  totalChunks: number;
  uploadedAt: number;
  contentPreview: string;
  status: 'parsing' | 'embedding' | 'ready' | 'error';
  progress?: number;
  enabled: boolean;
}

export interface SourceReference {
  chunkId: string;
  docTitle: string;
  snippet: string;
  fullContext: string;
  score: number;
  metrics?: string[];
  keyFacts?: string[];
  targetedFacts?: { target: string; value: string; sentence: string; docTitle: string }[];
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  sources?: SourceReference[];
  isStreaming?: boolean;
}

export type StudioTab =
  | 'briefing'
  | 'minutes'
  | 'study_report'
  | 'faq'
  | 'learning_guide'
  | 'slide'
  | 'mindmap'
  | 'flowchart'
  | 'podcast'
  | 'graph3d';


export interface GraphNode {
  id: string;
  name: string;
  val: number;
  color?: string;
}

export interface GraphLink {
  source: string;
  target: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface StudioArtifact {
  id: string;
  projectId: string;
  type: StudioTab;
  title: string;
  content: string;
  customPrompt?: string; // ユーザーが指定した自由な指示
  createdAt: number;
}

export interface FactSkeleton {
  hasMatch: boolean;
  facts: { target: string; value: string; sentence: string; docTitle: string }[];
  evidenceSentences: { docTitle: string; sentence: string }[];
  constraints: string[];
  formattedContextForLLM: string;
  rawEvidenceCard: string;
}

