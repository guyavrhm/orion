import type {
  MovieMetadata,
  ShowMetadata,
  Progress,
  Stream,
  UserActiveMediaState,
} from '../../main/types/index.js';

export type NavigationTab = 'explore';

export interface PlayingMediaInfo {
  fileId: string;
  mediaId: string;
  title: string;
  subtitle?: string;
  season?: number;
  episode?: number;
  type: 'movie' | 'show';
  poster?: string | null;
  background?: string | null;
}

export interface MediaCatalogState {
  movies: MovieMetadata[];
  shows: ShowMetadata[];
  continueWatching: (MovieMetadata | ShowMetadata)[];
  progressMap: Record<string, Progress>;
  readyMap: Record<string, Stream>;
  activeRequests: Record<string, UserActiveMediaState>;
  loading: boolean;
  error: string | null;
}
