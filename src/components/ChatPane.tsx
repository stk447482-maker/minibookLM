import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, ChevronDown, ChevronUp, FileText, Zap, PlusCircle, Trash2, RotateCcw, Mic, MicOff, Volume2, ExternalLink, X, Lightbulb } from 'lucide-react';
import { MarkdownViewer } from './MarkdownViewer.tsx';
import { ChatMessage, SourceReference } from '../types/index.ts';

interface ChatPaneProps {
  messages: ChatMessage[];
  onSendMessage: (query: string, isDirectRAG?: boolean) => void;
  onClearMessages: () => void;
  onDeleteMessage: (id: string) => void;
  onAddToSource: (title: string, content: string) => void;
  onViewDocByName?: (docTitle: string) => void;
  isGenerating: boolean;
  statusMessage?: string;
}

export const ChatPane: React.FC<ChatPaneProps> = ({
  messages,
  onSendMessage,
  onClearMessages,
  onDeleteMessage,
  onAddToSource,
  onViewDocByName,
  isGenerating,
  statusMessage
}) => {
  const [input, setInput] = useState('');
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [isListening, setIsListening] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [activeReference, setActiveReference] = useState<{ src: SourceReference; index: number } | null>(null);
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating, statusMessage]);

  // 音声入力 (STT: Web Speech Recognition API)
  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert('お使いのブラウザは音声入力 (Web Speech API) に対応していません。Chrome / Edge / Safari等をお試しください。');
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.lang = 'ja-JP';
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (e: any) => {
        const transcript = Array.from(e.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setInput(prev => (prev ? prev + ' ' : '') + transcript);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  // 音声読み上げ (TTS: SpeechSynthesis)
  const handleSpeak = (msgId: string, text: string) => {
    if (!('speechSynthesis' in window)) return;

    if (speakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }

    window.speechSynthesis.cancel();
    // マークダウン記法等を除去
    const cleanText = text.replace(/#|\*|`|\[.*?\]\(.*?\)|<.*?>/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'ja-JP';
    utterance.rate = 1.05;

    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);

    setSpeakingMsgId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  const handleSubmit = (e: React.FormEvent, isDirectRAG: boolean = false) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
    onSendMessage(input.trim(), isDirectRAG);
    setInput('');
  };

  const toggleSource = (msgId: string) => {
    setExpandedSources(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  return (
    <div className="flex flex-col h-full w-full min-w-0 overflow-hidden bg-slate-950">
      {/* チャットヘッダーバー */}
      <div className="h-10 border-b border-slate-800/80 px-4 flex items-center justify-between bg-slate-900/40 shrink-0">
        <span className="text-xs font-semibold text-slate-400">
          チャット対話 ({messages.length} 件)
        </span>
        {messages.length > 0 && (
          <button
            onClick={() => {
              if (confirm('チャット履歴をすべてクリアしますか？')) {
                onClearMessages();
              }
            }}
            className="flex items-center space-x-1 text-[11px] text-slate-400 hover:text-rose-400 transition-colors px-2 py-0.5 rounded hover:bg-slate-800"
            title="チャット履歴をクリア"
          >
            <RotateCcw className="w-3 h-3" />
            <span>履歴クリア</span>
          </button>
        )}
      </div>

      {/* メッセージ履歴 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 space-y-6 min-w-0">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-indigo-400" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="text-base font-semibold text-slate-200">
                MiniBookLM チャット
              </h3>
              <p className="text-xs text-slate-400">
                左側でドキュメントにチェックを入れて質問してください。「🤖 AI回答」または「🎯 厳密RAG抽出」を選択できます。
              </p>
            </div>

            {/* 🌟 スターター質問サジェスト */}
            <div className="pt-2 w-full max-w-sm space-y-2">
              <span className="text-[11px] font-bold text-slate-400 flex items-center justify-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-400" />
                <span>よくあるおすすめの質問:</span>
              </span>
              <div className="flex flex-col space-y-1.5 text-left">
                {[
                  '選択したドキュメント全体の要点を3行でまとめて',
                  '資料内の重要な確定数値や期限・ルールを教えて',
                  '注意すべき制約事項や例外条件は何ですか？'
                ].map((starter, sIdx) => (
                  <button
                    key={sIdx}
                    type="button"
                    onClick={() => onSendMessage(starter, false)}
                    className="p-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 text-xs text-slate-300 hover:text-indigo-200 transition-all flex items-center space-x-2 group shadow-sm active:scale-95"
                  >
                    <span className="w-5 h-5 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0 text-[10px] group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                      {sIdx + 1}
                    </span>
                    <span className="truncate">{starter}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start space-x-3 group min-w-0 ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {msg.role !== 'user' && (
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-indigo-400" />
                </div>
              )}

              <div
                className={`max-w-[88%] md:max-w-[82%] min-w-0 overflow-hidden rounded-2xl p-4 shadow-sm text-sm relative ${
                  msg.role === 'user'
                    ? 'user-message-bubble bg-indigo-600 text-white rounded-br-none'
                    : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none'
                }`}
              >
                {/* 根拠ソースバッジ (アシスタント時) */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mb-3 border-b border-slate-800 pb-2">
                    <button
                      onClick={() => toggleSource(msg.id)}
                      className="flex items-center space-x-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{msg.sources.length} 件の参照ソース</span>
                      {expandedSources[msg.id] ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {expandedSources[msg.id] && (
                      <div className="mt-2 space-y-2 max-h-56 overflow-y-auto">
                        {msg.sources.map((src, i) => (
                          <div
                            key={i}
                            className="text-[11px] p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-slate-400 space-y-1"
                          >
                            <div className="flex items-center justify-between text-indigo-300 font-semibold">
                              <span>📄 {src.docTitle}</span>
                              <span className="text-[10px] bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 text-indigo-400">
                                適合度: {(src.score * 100).toFixed(0)}%
                              </span>
                            </div>
                            <p className="text-slate-300 text-[11px] bg-slate-900/80 p-1.5 rounded border border-slate-800/80 font-mono">
                              🔍 抽出: {src.snippet}
                            </p>
                            <p className="text-slate-400 text-[10px] leading-relaxed line-clamp-3">
                              {src.fullContext}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 本文 (Markdown対応 & インライン引用バッジ対応) */}
                <MarkdownViewer
                  content={msg.content}
                  sources={msg.sources}
                  isUser={msg.role === 'user'}
                  onSelectReference={(ref) => {
                    setActiveReference(ref);
                  }}
                />

                {/* 💡 次の深掘り質問サジェストチップ */}
                {msg.role === 'assistant' && !msg.isStreaming && msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-800/60 space-y-1.5">
                    <span className="text-[10px] font-bold text-indigo-400 flex items-center gap-1">
                      <Lightbulb className="w-3 h-3 text-amber-400 fill-amber-400/20" />
                      <span>次に深掘りできるおすすめの問い:</span>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.suggestedQuestions.map((q, qIdx) => (
                        <button
                          key={qIdx}
                          type="button"
                          onClick={() => onSendMessage(q, false)}
                          className="text-left text-[11px] px-2.5 py-1 rounded-lg bg-indigo-950/50 hover:bg-indigo-900/60 text-indigo-200 border border-indigo-500/30 hover:border-indigo-400/50 transition-all flex items-center space-x-1 shadow-sm active:scale-95"
                          title="クリックしてこの質問をそのまま送信"
                        >
                          <span>👉</span>
                          <span className="line-clamp-1">{q}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* アクションフッター (ソース追加・削除) */}
                {msg.role === 'assistant' && !msg.isStreaming && (
                  <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => onAddToSource(`回答メモ_${new Date().toLocaleTimeString()}`, msg.content)}
                        className="flex items-center space-x-1 hover:text-indigo-400 transition-colors"
                        title="この回答内容を新しいソース（ドキュメント）として保存・登録します"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>ソースに追加</span>
                      </button>

                      <button
                        onClick={() => handleSpeak(msg.id, msg.content)}
                        className={`flex items-center space-x-1 transition-colors ${
                          speakingMsgId === msg.id
                            ? 'text-purple-400 font-bold animate-pulse'
                            : 'hover:text-purple-300'
                        }`}
                        title="音声で回答を読み上げます"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>{speakingMsgId === msg.id ? '停止' : '読み上げ'}</span>
                      </button>
                    </div>

                    <button
                      onClick={() => onDeleteMessage(msg.id)}
                      className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 transition-all"
                      title="このメッセージを削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-slate-300" />
                </div>
              )}
            </div>
          ))
        )}

        {isGenerating && statusMessage && (
          <div className="flex items-center space-x-2 text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-2 rounded-lg w-fit">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
            <span>{statusMessage}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 入力フォーム */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/60 backdrop-blur">
        <form onSubmit={(e) => handleSubmit(e, false)} className="flex items-center space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isListening ? "🎙️ 音声を聴き取っています... 話してください" : "選択したドキュメントについて質問する..."}
            disabled={isGenerating}
            className={`flex-1 bg-slate-800/90 border rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 transition-all disabled:opacity-50 ${
              isListening
                ? 'border-rose-500 ring-rose-500/50 bg-rose-950/20 text-rose-200 placeholder-rose-400'
                : 'border-slate-700/80 focus:border-indigo-500 focus:ring-indigo-500'
            }`}
          />

          <button
            type="button"
            onClick={toggleListening}
            disabled={isGenerating}
            className={`p-3 rounded-xl border transition-all shrink-0 flex items-center justify-center ${
              isListening
                ? 'bg-rose-600 text-white border-rose-500 animate-pulse shadow-lg shadow-rose-600/30'
                : 'bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-slate-200 border-slate-700'
            }`}
            title={isListening ? "音声入力を終了" : "音声で話しかける (ハンズフリー音声チャット)"}
          >
            {isListening ? <MicOff className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={(e) => handleSubmit(e, true)}
            disabled={!input.trim() || isGenerating}
            className="px-3.5 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-emerald-400 hover:text-emerald-300 border border-slate-700 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center space-x-1"
            title="LLM推論を介さず、ドキュメントから該当箇所を直接抽出して返答します"
          >
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">厳密RAG抽出</span>
          </button>

          <button
            type="submit"
            disabled={!input.trim() || isGenerating}
            className="p-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white disabled:text-slate-500 rounded-xl transition-all shadow-md shadow-indigo-600/20 disabled:shadow-none shrink-0"
            title="AI回答を生成"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* 🔍 Click-to-Context: 根拠ソース詳細モーダル */}
      {activeReference && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700/90 rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-3.5">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center text-xs font-bold font-mono">
                  [{activeReference.index}]
                </span>
                <h3 className="text-sm font-bold text-slate-100 truncate max-w-[260px] sm:max-w-xs">
                  {activeReference.src.docTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveReference(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="text-[11px] font-semibold text-indigo-400">
                  🎯 RAG 抽出ハイライト
                </span>
                <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded">
                  適合度: {(activeReference.src.score * 100).toFixed(0)}%
                </span>
              </div>

              {/* 核心抜粋 */}
              <div className="p-3 rounded-xl bg-slate-950/80 border border-indigo-500/30 text-xs text-indigo-200 font-medium leading-relaxed">
                {activeReference.src.snippet}
              </div>

              {/* 前後の全体文脈 */}
              <div>
                <span className="text-[10px] font-semibold text-slate-500 block mb-1">
                  📄 ドキュメント前後の文脈 (Full Context):
                </span>
                <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800 text-[11px] text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed font-mono">
                  {activeReference.src.fullContext}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              {onViewDocByName ? (
                <button
                  type="button"
                  onClick={() => {
                    const title = activeReference.src.docTitle;
                    setActiveReference(null);
                    onViewDocByName(title);
                  }}
                  className="flex items-center space-x-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>ドキュメント全体を開く</span>
                </button>
              ) : <div />}

              <button
                type="button"
                onClick={() => setActiveReference(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
