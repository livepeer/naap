/**
 * LivepeerMediaClient
 *
 * Typed client for go-livepeer's Media API (HTTP push ingest, HLS, recordings).
 */

export class LivepeerMediaClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8935') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // --- Health ---
  async healthz(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // --- HTTP Push Ingest ---
  async pushSegment(
    manifestID: string,
    seq: number,
    segment: ArrayBuffer,
    opts?: { profiles?: string; duration?: number }
  ): Promise<ArrayBuffer> {
    const headers: Record<string, string> = {
      'Content-Type': 'video/mp2t',
    };
    if (opts?.profiles) headers['Livepeer-Profiles'] = opts.profiles;
    if (opts?.duration) headers['Content-Duration'] = String(opts.duration);

    const res = await fetch(
      `${this.baseUrl}/live/${manifestID}/${seq}.ts`,
      { method: 'POST', headers, body: segment }
    );

    if (!res.ok) {
      throw new Error(`Push segment failed: ${res.status}`);
    }

    return res.arrayBuffer();
  }

  // --- Recording Access ---
  async getRecordingMasterPlaylist(manifestID: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/stream/${manifestID}/record.m3u8`);
    if (!res.ok) throw new Error(`Failed to get recording playlist: ${res.status}`);
    return res.text();
  }

  async getRecordingMediaPlaylist(manifestID: string, track: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/stream/${manifestID}/record/${track}.m3u8`);
    if (!res.ok) throw new Error(`Failed to get media playlist: ${res.status}`);
    return res.text();
  }

  // --- HLS Stream Access ---
  async getStreamPlaylist(manifestID: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/stream/${manifestID}.m3u8`);
    if (!res.ok) throw new Error(`Failed to get stream playlist: ${res.status}`);
    return res.text();
  }
}
