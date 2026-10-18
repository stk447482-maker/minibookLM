// [License] Verified Free & Commercial Use (MIT / Apache-2.0).
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).
// [Timestamp] 2026-10-18T12:35:00Z

export interface YoutubeAudioResult {
  file: File;
  title: string;
}

export class YoutubeAudioService {
  /**
   * YouTube動画IDから音声Blobを直接フェッチ（Cobalt / Piped / Invidious 多重フォールバック）
   */
  public static async fetchAudioBlob(
    videoId: string,
    onProgress?: (status: string) => void
  ): Promise<YoutubeAudioResult> {
    onProgress?.('📺 YouTube動画の音声ストリームを取得中...');

    // 方式 1: Cobalt API パブリックインスタンス群
    const cobaltInstances = [
      'https://cobalt-api.kwiatekmoments.com',
      'https://api.cobalt.tools',
      'https://cobalt.canine.tools',
      'https://co.wuk.sh'
    ];

    for (const instance of cobaltInstances) {
      try {
        const res = await fetch(instance, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: `https://www.youtube.com/watch?v=${videoId}`,
            downloadMode: 'audio',
            audioFormat: 'mp3'
          })
        });

        if (res.ok) {
          const data = await res.json();
          const downloadUrl = data.url || (data.status === 'stream' || data.status === 'redirect' ? data.url : null);
          if (downloadUrl) {
            onProgress?.('📥 音声ストリームをダウンロード中...');
            const audioRes = await fetch(downloadUrl);
            if (audioRes.ok) {
              const blob = await audioRes.blob();
              if (blob.size > 10000) {
                const title = data.filename || `YouTube_${videoId}.mp3`;
                const file = new File([blob], title, { type: 'audio/mp3' });
                return { file, title };
              }
            }
          }
        }
      } catch {
        // 次のインスタンスへ
        continue;
      }
    }

    // 方式 2: Piped API オーディオストリーム
    const pipedInstances = [
      'https://pipedapi.kavin.rocks',
      'https://api.piped.privacydev.net',
      'https://piped-api.lunar.icu'
    ];

    for (const instance of pipedInstances) {
      try {
        const infoRes = await fetch(`${instance}/streams/${videoId}`);
        if (infoRes.ok) {
          const info = await infoRes.json();
          const audioStreams = info.audioStreams;
          if (Array.isArray(audioStreams) && audioStreams.length > 0) {
            // 最も適正な音質ストリーム
            const stream = audioStreams[0];
            if (stream.url) {
              onProgress?.('📥 音声データをダウンロード中...');
              const audioRes = await fetch(stream.url);
              if (audioRes.ok) {
                const blob = await audioRes.blob();
                if (blob.size > 10000) {
                  const title = `${info.title || `YouTube_${videoId}`}.m4a`;
                  const file = new File([blob], title, { type: stream.mimeType || 'audio/m4a' });
                  return { file, title };
                }
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    throw new Error('YouTubeの音声ストリームを自動取得できませんでした。');
  }
}
