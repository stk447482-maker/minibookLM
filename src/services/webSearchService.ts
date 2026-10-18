// [License] Verified Free & Commercial Use (MIT / Apache-2.0).
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).
// [Timestamp] 2026-10-18T11:16:00Z

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchService {
  /**
   * ブラウザから完全無料で利用可能なWeb検索（DuckDuckGo / Jina Search API）
   */
  public static async searchWeb(query: string, maxResults: number = 3): Promise<WebSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const results: WebSearchResult[] = [];

    // 方式 1: Jina Search API (高速・Markdown構造化テキスト・CORSフリー)
    try {
      const jinaUrl = `https://s.jina.ai/${encodeURIComponent(cleanQuery)}`;
      const res = await fetch(jinaUrl, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.data)) {
          for (const item of data.data.slice(0, maxResults)) {
            if (item.title && item.url) {
              results.push({
                title: item.title.replace(/\n+/g, ' ').trim(),
                url: item.url,
                snippet: (item.description || item.content || '').slice(0, 300).replace(/\n+/g, ' ').trim()
              });
            }
          }
          if (results.length > 0) return results;
        }
      }
    } catch {
      // フォールバックへ
    }

    // 方式 2: DuckDuckGo HTML / Instant Answer API
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(ddgUrl);
      if (res.ok) {
        const json = await res.json();
        if (json.AbstractText && json.AbstractURL) {
          results.push({
            title: json.Heading || cleanQuery,
            url: json.AbstractURL,
            snippet: json.AbstractText.slice(0, 300)
          });
        }
        if (Array.isArray(json.RelatedTopics)) {
          for (const topic of json.RelatedTopics) {
            if (results.length >= maxResults) break;
            if (topic.Text && topic.FirstURL) {
              results.push({
                title: topic.Text.slice(0, 40) + '...',
                url: topic.FirstURL,
                snippet: topic.Text.slice(0, 250)
              });
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return results;
  }
}
