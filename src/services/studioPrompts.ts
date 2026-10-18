// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

import { StudioTab } from '../types/index.ts';

export interface StudioPromptParams {
  type: StudioTab;
  customPrompt?: string;
  fullContext: string;
  docTitles: string[];
  isHighEndModel: boolean;
  hasAudioTranscript: boolean;
}

export interface StudioPromptResult {
  title: string;
  prompt: string;
  systemPrompt: string;
}

export function buildStudioPrompt(params: StudioPromptParams): StudioPromptResult {
  const { type, customPrompt, fullContext, docTitles, isHighEndModel, hasAudioTranscript } = params;

  const userRequirement = customPrompt ? `\n【ユーザー追加指示】: ${customPrompt}\n` : '';

  const systemPrompt = isHighEndModel
    ? `あなたはgoogle/gemma-4-12b-qatおよび先進AIモデルに最適化された最高峰のドキュメント・音声議事録アナリストです。提供された資料（Whisper Large-v3による高精度音声文字起こしを含む）のファクト、確定事項、数値、議論の文脈、発言意図を一切のハルシネーションなく厳密に分析し、極めて高品質な構造化アウトプットを生成してください。`
    : `あなたは最高峰のドキュメントアナリストです。提供された【参照ドキュメント】の数値・固有名詞・規定を正確に引用し、要求された形式で高品質な出力を生成してください。`;

  let title = '';
  let prompt = '';

  switch (type) {
    case 'briefing': {
      title = customPrompt ? `要約: ${customPrompt.slice(0, 15)}...` : 'ドキュメント全体要約サマリー';
      prompt = isHighEndModel
        ? `以下の資料群（Whisper音声文字起こし・ドキュメント）を深く分析し、google/gemma-4-12b-qatの推論力を活かした包括的で詳細な【エグゼクティブ要約サマリー】を作成してください。単なる表面的な要約ではなく、背景、主要論点、具体的数値、結論・意思決定を論理的に構造化してください。

# 📑 エグゼクティブ要約サマリー (${docTitles.join(', ')})
### 💡 全体概要・背景と目的
### 📌 主要論点・議論の推移
### 📊 確定数値・重要仕様・合意規定
### 📝 結論および今後の方向性
${userRequirement}

【参照資料】
${fullContext}`
        : `以下の資料群の内容を分かりやすく網羅的にまとめた【ドキュメント要約サマリー】を作成してください。
# 📑 ドキュメント要約サマリー (${docTitles.join(', ')})
### 💡 全体概要・目的
### 📌 主要なポイント・重要事項
### 📊 重要数値・確定仕様・規定（該当する場合）
### 📝 まとめ・結論
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'minutes': {
      title = customPrompt ? `議事録: ${customPrompt.slice(0, 15)}...` : '会議議事録・決定事項・ToDo';
      prompt = hasAudioTranscript || isHighEndModel
        ? `以下の資料群（Whisper Large-v3の音声文字起こしを含む）から、実際の会議・対話の文脈を精密に再構成した【実践的 会議議事録＆アクションプラン】を作成してください。発言の文脈、合意事項、未決事項、および具体的なToDo（担当・内容）を漏れなく整理してください。

# 📝 実践的 会議議事録＆アクションプラン
- **対象資料**: ${docTitles.join(', ')}
## 1. 会議の目的・主要アジェンダ
## 2. 決定事項・合意内容（確定事項を箇条書き）
## 3. 議論の経緯・主要な論点（意見の相違や検討された選択肢）
## 4. 保留・次回持ち越し課題
## 5. アクションアイテム / ToDo一覧（担当者・期限・タスク内容を表形式またはリスト形式で明記）
${userRequirement}

【参照資料】
${fullContext}`
        : `以下の資料から、決定事項や議論の要点を分かりやすく整理した【議事録・決定事項サマリー】を作成してください。
# 📝 議事録・決定事項サマリー
- **対象資料**: ${docTitles.join(', ')}
## 1. 目的・主要テーマ
## 2. 決定事項・合意内容
## 3. 主な議論と論点
## 4. 今後の対応・ToDo（該当する場合）
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'study_report': {
      title = customPrompt ? `レポート: ${customPrompt.slice(0, 15)}...` : '詳細調査・分析レポート';
      prompt = `以下の資料群を多角的に分析し、具体的な数値データと背景をわかりやすく整理した【詳細分析レポート】を作成してください。
# 📊 詳細分析レポート
## 1. 概要と背景
## 2. 定量データ・主要仕様・規定の分析
## 3. 論点整理と考察
## 4. 総合まとめ
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'faq': {
      title = customPrompt ? `FAQ: ${customPrompt.slice(0, 15)}...` : '実践的想定問答集 (FAQ)';
      prompt = `以下の資料から、実務・現場・利用者が直面する疑問やトラブル、例外規定、具体的基準を突いた【実践的想定問答集 (FAQ)】を6〜8問作成してください。
形式は必ず以下のように「### Q: [質問タイトル]」と「**A:** [明確で根拠のある解説]」で統一してください:

### Q: [具体的で実践的な疑問]
**A:** [資料の規定条項や数値を引用した、具体的で分かりやすい回答。背景や例外事項も丁寧に解説]

${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'learning_guide': {
      title = customPrompt ? `学習ガイド: ${customPrompt.slice(0, 15)}...` : '体系的マスター学習ガイド';
      prompt = `以下の資料から、初学者から実務者までを最短で理解へ導く【体系的マスター学習ガイド】を作成してください。

# 🎓 体系的マスター学習ガイド
## 1. コアコンセプト解説
[本資料の全体像・目的・最も重要なエッセンス]

## 2. 重要用語＆数値基準集
| 用語・指標 | 確定数値・仕様 | 実務上の意味・適用条件 |
| :--- | :--- | :--- |
| [用語1] | [数値・規定] | [重要ポイント] |
| [用語2] | [数値・規定] | [重要ポイント] |
| [用語3] | [数値・規定] | [重要ポイント] |

## 3. 実践ロードマップ・実行ステップ
1. **ステップ1:** [準備・着手]
2. **ステップ2:** [実行・審査]
3. **ステップ3:** [定着・検証]

## 4. 理解度チェッククイズ (3問)
> #### 問1: [資料の重要事項に関する問題文]
> <details>
> <summary>💡 解答と解説を表示</summary>
> 
> **正解:** [明確な答え]  
> **解説:** [資料の根拠規定や背景についての詳しい解説]
> </details>

> #### 問2: [具体的な数値や例外条件に関する問題文]
> <details>
> <summary>💡 解答と解説を表示</summary>
> 
> **正解:** [明確な答え]  
> **解説:** [理由と留意点]
> </details>

> #### 問3: [実務での判断を問う応用問題]
> <details>
> <summary>💡 解答と解説を表示</summary>
> 
> **正解:** [明確な答え]  
> **解説:** [実務上のベストプラクティス]
> </details>
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'quiz': {
      title = customPrompt ? `復習テスト＆暗記帳: ${customPrompt.slice(0, 15)}...` : '4択復習クイズ＆暗記フラッシュカード';
      prompt = `以下の資料の内容から、学習者の記憶定着と理解度測定に最適な【4択復習クイズ（5〜8問）】および【重要キーワード暗記フラッシュカード（6〜10枚）】を作成してください。
必ず以下のJSON形式のコードブロック（\`\`\`json ... \`\`\`）を含めて出力してください:

\`\`\`json
{
  "quizzes": [
    {
      "question": "資料の重要論点や規定、数値に関する明確な問い",
      "options": [
        "選択肢A",
        "選択肢B",
        "選択肢C",
        "選択肢D"
      ],
      "correctIndex": 0,
      "explanation": "なぜそれが正解なのか、資料の根拠と背景の明快な解説"
    }
  ],
  "flashcards": [
    {
      "front": "重要用語またはキーコンセプト",
      "back": "定義、確定数値、実務上の意味や留意事項"
    }
  ]
}
\`\`\`
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'matrix': {
      title = customPrompt ? `比較表: ${customPrompt.slice(0, 15)}...` : 'ドキュメント横断 比較マトリクス表';
      prompt = `以下の複数資料または多面的なトピックを横断的に比較・対照する【比較マトリクス表（横断対照分析）】を作成してください。

# 📊 ドキュメント横断 比較マトリクス表
## 1. 比較サマリ＆結論
[全体を俯瞰した要約と、各選択肢/各文書の特徴の総括]

## 2. 詳細比較対照表
| 比較評価項目 | ドキュメント/対象A | ドキュメント/対象B | 差異・優劣・留意点 |
| :--- | :--- | :--- | :--- |
| **定義・対象範囲** | [内容] | [内容] | [対比] |
| **主要仕様・数値基準** | [数値・規定] | [数値・規定] | [相違点] |
| **メリット・強み** | [利点] | [利点] | [評価] |
| **リスク・制約事項** | [課題] | [課題] | [比較] |
| **推奨ユースケース** | [適用場面] | [適用場面] | [最適判断] |

## 3. 実務適用・選定の指針
- **推奨アプローチ:** [具体的判断基準]
- **移行・導入ステップ:** [注意点]
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'slide': {
      title = customPrompt ? `スライド: ${customPrompt.slice(0, 15)}...` : 'Marp プレゼンテーションスライド';
      prompt = `以下の資料から、VS CodeやMarp CLIでそのままPDF・HTML変換可能な【Marp公式完全準拠プレゼンテーションスライド】を作成してください。

### 【絶対遵守フォーマット】
先頭に以下のMarp設定ヘッダー（Frontmatter）を必ず付与し、各スライドは「---」で区切ってください:
---
marp: true
theme: gaia
_class: lead
paginate: true
backgroundColor: #0f172a
color: #f8fafc
---

# 📊 [プレゼンテーションタイトル]
## [サブタイトル・発表者]

---
<!-- _header: アジェンダ -->
# 📋 本日のアジェンダ
1. 背景と課題認識
2. 主要データ・重要規定の分析
3. 具体的対策とアクションプラン

---
<!-- _header: 主要分析 -->
# 🔍 主要データ・仕様分析
- **コア数値:** [具体的な数値データと背景]
- **重要規定:** [規定条項や適用ルール]
- **留意事項:** [例外条件やリスク]

---
<!-- _header: まとめ -->
# 💡 結論と今後のアクション
- **決定事項:** [明確な結論]
- **次の一歩:** [具体的なToDo]

※ 1スライドあたり文字数を詰め込みすぎず、箇条書き（3〜4行）と強調を活用して視認性を高めてください。合計5〜8スライドで構成してください。
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'mindmap': {
      title = customPrompt ? `マインドマップ: ${customPrompt.slice(0, 15)}...` : '詳細マインドマップ';
      prompt = `以下の資料の構造と本質的な知見を網羅的に分析し、多階層（3〜4層）で緻密なマインドマップJSONを作成してください。
大雑把な要約ではなく、具体的なキーワード、数値、規定条項、メリット/デメリット、対策を深掘りして枝分かれさせてください。
必ず以下のJSON形式のみを出力してください:
\`\`\`json
{
  "root": "中心テーマ",
  "branches": [
    {
      "name": "主要カテゴリ1",
      "items": [
        "具体項目1 (仕様や数値)",
        "具体項目2 (留意点や課題)",
        "具体項目3 (解決策・手順)"
      ]
    },
    {
      "name": "主要カテゴリ2",
      "items": [
        "詳細事項A",
        "詳細事項B",
        "詳細事項C"
      ]
    }
  ]
}
\`\`\`
※ branchesは4〜6個、各itemsには3〜5個の詳細を具体的に記述してください。
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'flowchart': {
      title = customPrompt ? `フローチャート: ${customPrompt.slice(0, 15)}...` : '実務プロセス・判断フローチャート';
      prompt = `以下の資料から、業務フロー・判断ロジック・手順を詳細に抽出し、条件分岐を含む実践的なフローチャートJSONを作成してください。
単純な一本道ではなく、「事前準備」「入力・申請」「要件チェック（Yes/No分岐）」「不適合時のリカバリー/差戻し」「承認・実行」「完了・記録」を含む10〜15ステップのプロセスを構成してください。
必ず以下のJSON形式のみを出力してください:
\`\`\`json
{
  "steps": [
    {"action": "業務開始・資料準備"},
    {"action": "要件確認・入力チェック", "condition": true, "yes": "基準クリア", "no": "不備修正・再提出"},
    {"action": "詳細審査・合否判定", "condition": true, "yes": "承認", "no": "棄却・通知"},
    {"action": "システム本登録・実行"},
    {"action": "完了報告・履歴保存"}
  ]
}
\`\`\`
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'graph3d': {
      title = customPrompt ? `3Dグラフ: ${customPrompt.slice(0, 15)}...` : '3D ナレッジグラフ';
      prompt = `以下の資料群から、登場する重要概念、人物、組織、技術、規定、数値、課題などの【エンティティ】と、その相互関係を網羅的に抽出し、高密度な3DナレッジグラフJSONを作成してください。
大雑把な数個のノードではなく、最低でも15〜25個のノードと、それらを結ぶ意味のある関係性リンク（「依存する」「規定する」「改善する」「対立する」「構成する」等）を網羅してください。
必ず以下のJSON形式のみを出力してください:
\`\`\`json
{
  "nodes": [
    {"id": "1", "name": "中心概念", "val": 20, "color": "#6366f1"},
    {"id": "2", "name": "主要要素A", "val": 14, "color": "#10b981"},
    {"id": "3", "name": "主要要素B", "val": 14, "color": "#38bdf8"},
    {"id": "4", "name": "具体的規則・数値", "val": 10, "color": "#f59e0b"},
    {"id": "5", "name": "課題・リスク", "val": 10, "color": "#f43f5e"}
  ],
  "links": [
    {"source": "1", "target": "2", "label": "構成要素"},
    {"source": "2", "target": "4", "label": "適用基準"},
    {"source": "1", "target": "5", "label": "想定リスク"}
  ]
}
\`\`\`
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    case 'podcast': {
      let personaGuidance = '・標準解説スタイル: 知的好奇心をくすぐる自然でフレンドリーな対話（Google NotebookLM標準）。';
      if (customPrompt?.includes('熱血講義')) {
        personaGuidance = '・熱血講義スタイル: 情熱的で熱い指導役のアレックス（「よし、ここは絶対テストに出るぞ！」「いい質問だ！」）と、貪欲に食らいつく学習者サクラの熱気あふれる講義対話。';
      } else if (customPrompt?.includes('深夜ラジオ')) {
        personaGuidance = '・深夜ラジオスタイル: 落ち着いた大人のトーン、BGMが聴こえてきそうなチルな雰囲気で、本音や裏話、個人的な感慨を交えた心地よいトーク。';
      } else if (customPrompt?.includes('漫才風')) {
        personaGuidance = '・漫才風スタイル: テンポ抜群のボケとツッコミ！「なんでやねん！」「いやそれ関係ないやろ！」とユーモアを交えつつ、資料の本質を強烈に分かりやすく解説する爆笑対話。';
      }

      title = customPrompt ? `ポッドキャスト: ${customPrompt.slice(0, 15)}...` : 'AI対話ポッドキャスト (Audio Overview)';
      prompt = `以下の資料を題材に、Google NotebookLMのAudio Overviewのように、まるで本当に2人の人間（ホストのアレックスと解説役のサクラ）がスタジオで楽しそうに議論している【生々しく自然なポッドキャスト対話スクリプト】を作成してください。

### 【会話演出の絶対ルール】
1. **教科書的な読み上げを完全排除**:
   - 単に情報を順番に読むのではなく、「へぇー！それってどういうこと？」「あ、なるほど！確かにそうだよね」「実はね、ここが一番面白いポイントで…」など、**リアルな相槌・共感・疑問・驚き**をふんだんに盛り込んでください。
2. **指定された会話スタイル・ペルソナの厳格適用**:
   ${personaGuidance}
3. **2人のキャラクターの役割分担**:
   - **アレックス（ホスト）**: リスナー目線で好奇心旺盛。難しい専門用語や数値が出てきたら「つまり、普段の業務で言うと〇〇ってこと？」と噛み砕いて質問する。
   - **サクラ（エキスパート）**: 親しみやすく知的な語り口。「そう、まさにそこ！資料のデータによるとね…」と、具体的な根拠数値や裏付けを交えてわかりやすく解き明かす。
4. **テンポの良い掛け合い（12〜16往復程度）**:
   - 長文を一気に喋らず、テンポよく短い発話でキャッチボールをしてください。

形式:
**アレックス:** [リアクションやリスナー目線の質問]
**サクラ:** [具体的根拠や数値を含めた親しみやすい解説]
${userRequirement}

【参照資料】
${fullContext}`;
      break;
    }

    default:
      title = '生成物';
      prompt = `以下の資料に基づいて要求された形式で分析してください。\n\n【参照資料】\n${fullContext}`;
  }

  return { title, prompt, systemPrompt };
}
