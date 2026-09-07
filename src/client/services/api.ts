import type {
  MovieMetadata,
  ShowMetadata,
  MediaResponse,
  Progress,
  Stream,
  QueueStateResponse,
  UserMediaRequestResponse,
} from '../../main/types/index.js';

export interface StreamInfoResponse {
  success: boolean;
  url: string;
  subtitles: { lang: string; url: string }[];
}

export class ApiClient {
  private static async fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!res.ok) {
      let errorBody: { error?: string } = {};
      try {
        errorBody = await res.json();
      } catch {
        // Fallback to text
      }
      throw new Error(errorBody.error || `HTTP error ${res.status}: ${res.statusText}`);
    }

    return res.json();
  }

  // 1. Catalogs
  static async getMovies(limit = 20): Promise<MediaResponse<MovieMetadata[]>> {
    return this.fetchJson<MediaResponse<MovieMetadata[]>>(`/api/movies?limit=${limit}`);
  }

  static async getShows(limit = 20): Promise<MediaResponse<ShowMetadata[]>> {
    return this.fetchJson<MediaResponse<ShowMetadata[]>>(`/api/shows?limit=${limit}`);
  }

  static async getContinueWatching(limit = 10, type?: 'movie' | 'show' | 'all'): Promise<MediaResponse<(MovieMetadata | ShowMetadata)[]>> {
    const query = type && type !== 'all' ? `limit=${limit}&type=${type}` : `limit=${limit}`;
    return this.fetchJson<MediaResponse<(MovieMetadata | ShowMetadata)[]>>(`/api/continue-watching?${query}`);
  }

  // 2. Details
  static async getMovieDetails(id: string): Promise<MediaResponse<MovieMetadata>> {
    return this.fetchJson<MediaResponse<MovieMetadata>>(`/api/movies/${id}`);
  }

  static async getShowDetails(id: string): Promise<MediaResponse<ShowMetadata>> {
    return this.fetchJson<MediaResponse<ShowMetadata>>(`/api/shows/${id}`);
  }

  // 3. Search
  static async search(query: string): Promise<MediaResponse<(MovieMetadata | ShowMetadata)[]>> {
    return this.fetchJson<MediaResponse<(MovieMetadata | ShowMetadata)[]>>(`/api/search?q=${encodeURIComponent(query)}`);
  }

  // 4. Queue State
  static async getQueue(): Promise<QueueStateResponse> {
    return this.fetchJson<QueueStateResponse>('/api/queue');
  }

  // 5. Media Request (Stream preparation trigger)
  static async requestMedia(fileId: string): Promise<UserMediaRequestResponse> {
    return this.fetchJson<UserMediaRequestResponse>(`/api/media/${encodeURIComponent(fileId)}/request`, {
      method: 'POST',
    });
  }

  // 6. Stream Info
  static async getStreamInfo(fileId: string): Promise<StreamInfoResponse> {
    return this.fetchJson<StreamInfoResponse>(`/api/media/${encodeURIComponent(fileId)}/stream`);
  }

  // 7. Watch Progress update
  static async saveProgress(fileId: string, timestamp: number, runtime: number): Promise<{ success: boolean }> {
    return this.fetchJson<{ success: boolean }>(`/api/media/${encodeURIComponent(fileId)}/progress`, {
      method: 'POST',
      body: JSON.stringify({ timestamp, runtime }),
    });
  }

  // 8. Subtitle Preference
  static async getSubtitlePreference(mediaId: string): Promise<{ subtitle_lang: string | null }> {
    return this.fetchJson<{ subtitle_lang: string | null }>(`/api/media/${encodeURIComponent(mediaId)}/subtitles/preference`);
  }

  static async saveSubtitlePreference(mediaId: string, lang: string | null): Promise<{ success: boolean }> {
    return this.fetchJson<{ success: boolean }>(`/api/media/${encodeURIComponent(mediaId)}/subtitles/preference`, {
      method: 'POST',
      body: JSON.stringify({ subtitle_lang: lang }),
    });
  }
}
