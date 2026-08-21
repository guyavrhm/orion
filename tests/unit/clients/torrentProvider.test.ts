import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TorrentProviderClient,
  torrentProviderClient,
  base32ToHex,
  normalizeInfoHash
} from '../../../src/main/clients/torrentProvider.js';
import { BadGatewayError, ServiceUnavailableError } from '../../../src/main/utils/errors.js';
import { ErrorCode } from '../../../src/main/types/index.js';
import { metadataRepo } from '../../../src/main/db/metadata.js';
import { cinemetaClient } from '../../../src/main/clients/cinemeta.js';

describe('TorrentProviderClient & Utilities', () => {
  let client: TorrentProviderClient;
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    client = new TorrentProviderClient();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('base32ToHex', () => {
    it('should convert a 32-character RFC 4648 Base32 hash to 40-character hex', () => {
      // "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" -> 160 bits of 0s -> 40 zeros
      expect(base32ToHex('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe('0000000000000000000000000000000000000000');
      // Mixed base32 test
      const b32 = 'JBSWY3DPEBLW64TMMQQQ222222222222';
      const hex = base32ToHex(b32);
      expect(hex).toHaveLength(40);
      expect(/^[0-9a-f]{40}$/.test(hex)).toBe(true);
    });

    it('should handle lowercase base32 input and trailing padding', () => {
      const b32 = 'jbswy3dpeblw64tmmqqq222222222222====';
      const hex = base32ToHex(b32);
      expect(hex).toHaveLength(40);
    });

    it('should return empty string for invalid lengths or invalid characters', () => {
      expect(base32ToHex('TOOSHORT')).toBe('');
      expect(base32ToHex('INVALID_CHARS_189018901890189018')).toBe(''); // 1, 8, 9, 0 are not in RFC 4648 standard base32
    });
  });

  describe('normalizeInfoHash', () => {
    const validHex = '4b227777d4dd1fc61c6f884f48641d02b4d12345';

    it('should return lowercase 40-character hex hash directly', () => {
      expect(normalizeInfoHash(validHex)).toBe(validHex);
      expect(normalizeInfoHash(validHex.toUpperCase())).toBe(validHex);
      expect(normalizeInfoHash(`  ${validHex}  `)).toBe(validHex);
    });

    it('should convert 32-character base32 infoHash to 40-character hex', () => {
      const b32 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      expect(normalizeInfoHash(b32)).toBe('0000000000000000000000000000000000000000');
    });

    it('should extract infoHash from magnet URIs (both hex and base32 format)', () => {
      const magnetHex = `magnet:?xt=urn:btih:${validHex}&dn=Ubuntu+ISO&tr=udp%3A%2F%2Ftracker.example.com`;
      expect(normalizeInfoHash(magnetHex)).toBe(validHex);

      const magnetB32 = `magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&dn=Zeroes`;
      expect(normalizeInfoHash(magnetB32)).toBe('0000000000000000000000000000000000000000');
    });

    it('should return null for null, undefined, non-strings, or invalid formats', () => {
      expect(normalizeInfoHash(null)).toBeNull();
      expect(normalizeInfoHash(undefined)).toBeNull();
      expect(normalizeInfoHash(12345)).toBeNull();
      expect(normalizeInfoHash('')).toBeNull();
      expect(normalizeInfoHash('not-a-valid-hash')).toBeNull();
      expect(normalizeInfoHash('magnet:?dn=MissingBTIH')).toBeNull();
    });
  });

  describe('constructMagnetUrl', () => {
    it('should build a valid magnet link with dn and default trackers', () => {
      const hash = '4b227777d4dd1fc61c6f884f48641d02b4d12345';
      const title = 'Night of the Living Dead (1968) [1080p]';
      const magnet = client.constructMagnetUrl(hash, title);

      expect(magnet).toContain(`magnet:?xt=urn:btih:${hash}`);
      expect(magnet).toContain(`&dn=Night%20of%20the%20Living%20Dead%20(1968)%20%5B1080p%5D`);
      expect(magnet).toContain('&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce');
    });
  });

  describe('parseSizeToGB', () => {
    it('should parse raw bytes into GB and formatted size string', () => {
      // 2 GB in bytes = 2147483648
      const res = client.parseSizeToGB(2147483648);
      expect(res.sizeGB).toBeCloseTo(2.0, 2);
      expect(res.sizeStr).toBe('2.00 GB');

      // 500 MB in bytes = 524288000
      const mbRes = client.parseSizeToGB(524288000);
      expect(mbRes.sizeGB).toBeCloseTo(0.488, 2);
      expect(mbRes.sizeStr).toBe('500.0 MB');
    });

    it('should recognize numeric values <= 1000 as already in GB', () => {
      const res = client.parseSizeToGB(4.5);
      expect(res.sizeGB).toBe(4.5);
      expect(res.sizeStr).toBe('4.50 GB');
    });

    it('should parse formatted strings with various units (GB, MB, GiB, TB, KB, B)', () => {
      expect(client.parseSizeToGB('1.45 GB').sizeGB).toBeCloseTo(1.45, 2);
      expect(client.parseSizeToGB('700 MB').sizeGB).toBeCloseTo(700 / 1024, 2);
      expect(client.parseSizeToGB('2.5 TB').sizeGB).toBeCloseTo(2560, 1);
      expect(client.parseSizeToGB('1.2 GiB').sizeGB).toBeCloseTo(1.2, 2);
      expect(client.parseSizeToGB('1048576 B').sizeGB).toBeCloseTo(1 / 1024, 3);
    });

    it('should parse size from text fallback if sizeVal is empty', () => {
      const res = client.parseSizeToGB(undefined, 'Movie Title (2022) 1080p BluRay 💾 3.25 GB [x264]');
      expect(res.sizeGB).toBeCloseTo(3.25, 2);
      expect(res.sizeStr).toBe('3.25 GB');
    });

    it('should return zeros for unparseable or empty values', () => {
      expect(client.parseSizeToGB(null)).toEqual({ sizeGB: 0, sizeStr: '' });
      expect(client.parseSizeToGB('unknown')).toEqual({ sizeGB: 0, sizeStr: '' });
    });
  });

  describe('parsePeers', () => {
    it('should extract peers from known object properties', () => {
      expect(client.parsePeers({ seeders: 120 })).toBe(120);
      expect(client.parsePeers({ seeds: '45' })).toBe(45);
      expect(client.parsePeers({ num_seeders: 88 })).toBe(88);
      expect(client.parsePeers({ numPeers: 30 })).toBe(30);
      expect(client.parsePeers({ s: 15 })).toBe(15);
    });

    it('should extract peers from text patterns (emoji, Seeds: N, [S/L], suffix)', () => {
      expect(client.parsePeers({}, 'Nosferatu 👤 240 peers')).toBe(240);
      expect(client.parsePeers({}, 'Release Title Seeds: 150 Leechers: 20')).toBe(150);
      expect(client.parsePeers({}, 'Show S01E01 [85/12]')).toBe(85);
      expect(client.parsePeers({}, 'Movie 1080p (95|10)')).toBe(95);
      expect(client.parsePeers({}, 'Night of the Living Dead 350 seeders')).toBe(350);
      expect(client.parsePeers({}, 'Night of the Living Dead 50 seeds')).toBe(50);
    });

    it('should return 0 when no peer information is found', () => {
      expect(client.parsePeers({})).toBe(0);
      expect(client.parsePeers({ title: 'Just a title without seed counts' })).toBe(0);
    });
  });

  describe('parseQuality', () => {
    it('should detect 4K / 2160p resolutions', () => {
      expect(client.parseQuality({ quality: '4k' })).toBe('2160p');
      expect(client.parseQuality({ resolution: '2160p' })).toBe('2160p');
      expect(client.parseQuality({}, 'Plan 9 from Outer Space UHD 3840x2160')).toBe('2160p');
      expect(client.parseQuality({ title: 'Movie 2160i Ultra HD' })).toBe('2160p');
      expect(client.parseQuality({ quality: '2160' })).toBe('2160p');
    });

    it('should detect 1080p / FHD resolutions', () => {
      expect(client.parseQuality({ quality: '1080p' })).toBe('1080p');
      expect(client.parseQuality({ res: '1080' })).toBe('1080p');
      expect(client.parseQuality({}, 'Metropolis Full HD 1920x1080')).toBe('1080p');
      expect(client.parseQuality({ title: 'The Beverly Hillbillies 1080i HDTV' })).toBe('1080p');
    });

    it('should detect 720p / HD resolutions', () => {
      expect(client.parseQuality({ videoquality: '720p' })).toBe('720p');
      expect(client.parseQuality({ resolution: '720' })).toBe('720p');
      expect(client.parseQuality({}, 'Flash Gordon Conquers the Universe 1280x720 HD')).toBe('720p');
    });

    it('should detect 480p / SD resolutions', () => {
      expect(client.parseQuality({ quality: '480p' })).toBe('480p');
      expect(client.parseQuality({ definition: 'SD' })).toBe('480p');
      expect(client.parseQuality({}, 'Classic 1970 DVDRip 848x480')).toBe('480p');
      expect(client.parseQuality({ title: 'Early Screener CAM TS' })).toBe('480p');
    });

    it('should return "unknown" when quality cannot be detected', () => {
      expect(client.parseQuality({})).toBe('unknown');
      expect(client.parseQuality({ title: 'Just A Random Name' })).toBe('unknown');
    });
  });

  describe('parseCodec', () => {
    it('should detect AV1 codec', () => {
      expect(client.parseCodec({ codec: 'av1' })).toBe('av1');
      expect(client.parseCodec({}, 'Movie (2023) 1080p AV01 Opus')).toBe('av1');
    });

    it('should detect HEVC / H265 codec', () => {
      expect(client.parseCodec({ videocodec: 'x265' })).toBe('hevc');
      expect(client.parseCodec({ format: 'HEVC' })).toBe('hevc');
      expect(client.parseCodec({}, 'Movie 2160p 10-bit H.265 DDP5.1')).toBe('hevc');
      expect(client.parseCodec({ title: 'Show S01E01 720p Hi10P' })).toBe('hevc');
    });

    it('should detect H264 codec', () => {
      expect(client.parseCodec({ codec: 'h264' })).toBe('h264');
      expect(client.parseCodec({ title: 'Movie 1080p x264 AAC' })).toBe('h264');
      expect(client.parseCodec({}, 'Show 720p AVC1.640028')).toBe('h264');
      expect(client.parseCodec({ title: 'Movie H.264 Bluray' })).toBe('h264');
    });

    it('should return "other" for unrecognized codecs', () => {
      expect(client.parseCodec({})).toBe('other');
      expect(client.parseCodec({ codec: 'mpeg2' })).toBe('other');
    });
  });

  describe('extractStreamsFromResponse', () => {
    const validHash = '1234567890abcdef1234567890abcdef12345678';

    it('should extract streams from JSON API response array', () => {
      const jsonResponse = [
        {
          infoHash: validHash,
          title: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264',
          size: '2.5 GB',
          seeders: 50,
          fileIdx: 0
        },
        {
          hash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
          title: 'Night.of.the.Living.Dead.1968.720p.HDTV.x264',
          size: '1.1 GB',
          peers: 20
        }
      ];

      const streams = client.extractStreamsFromResponse(jsonResponse);
      expect(streams).toHaveLength(2);
      expect(streams[0].hash).toBe(validHash);
      expect(streams[0].quality).toBe('1080p');
      expect(streams[0].codec).toBe('h264');
      expect(streams[0].sizeGB).toBeCloseTo(2.5, 1);
      expect(streams[0].peers).toBe(50);
      expect(streams[0].fileIdx).toBe(0);

      expect(streams[1].quality).toBe('720p');
      expect(streams[1].peers).toBe(20);
    });

    it('should extract streams from JSON string with magnet URLs', () => {
      const jsonString = JSON.stringify({
        results: [
          {
            name: 'Plan.9.from.Outer.Space.1957.2160p.UHD.HEVC',
            magnetUrl: `magnet:?xt=urn:btih:${validHash}&dn=Plan9`,
            size: '15000000000',
            seeds: 80
          }
        ]
      });

      const streams = client.extractStreamsFromResponse(jsonString);
      expect(streams).toHaveLength(1);
      expect(streams[0].hash).toBe(validHash);
      expect(streams[0].quality).toBe('2160p');
      expect(streams[0].codec).toBe('hevc');
      expect(streams[0].peers).toBe(80);
    });

    it('should extract streams from Torznab / RSS XML feed', () => {
      const torznabXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
        <channel>
          <title>Mock Torznab Indexer</title>
          <item>
            <title>The.Dark.Knight.2008.1080p.BluRay.x264</title>
            <guid>item-1</guid>
            <link>https://indexer.example/download/item1.torrent</link>
            <enclosure url="https://indexer.example/download/item1.torrent" length="2147483648" type="application/x-bittorrent"/>
            <torznab:attr name="infohash" value="${validHash}"/>
            <torznab:attr name="seeders" value="125"/>
            <torznab:attr name="peers" value="150"/>
            <torznab:attr name="size" value="2147483648"/>
          </item>
        </channel>
      </rss>`;

      const streams = client.extractStreamsFromResponse(torznabXml);
      expect(streams).toHaveLength(1);
      expect(streams[0].hash).toBe(validHash);
      expect(streams[0].title).toBe('The.Dark.Knight.2008.1080p.BluRay.x264');
      expect(streams[0].quality).toBe('1080p');
      expect(streams[0].peers).toBe(125);
      expect(streams[0].sizeGB).toBeCloseTo(2.0, 1);
    });

    it('should throw BadGatewayError when Torznab XML contains <error> element', () => {
      const errorXml = `<?xml version="1.0" encoding="UTF-8"?>
      <error code="100" description="Incorrect user credentials or API key" />`;

      expect(() => client.extractStreamsFromResponse(errorXml)).toThrow(BadGatewayError);
    });

    it('should extract plain text stream containing magnet links', () => {
      const plainText = `
        magnet:?xt=urn:btih:${validHash}&dn=Test.Movie.1080p
        magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98&dn=Other.Show.720p
      `;

      const streams = client.extractStreamsFromResponse(plainText);
      expect(streams).toHaveLength(2);
      expect(streams[0].hash).toBe(validHash);
      expect(streams[0].title).toBe('Test.Movie.1080p');
      expect(streams[1].hash).toBe('fedcba9876543210fedcba9876543210fedcba98');
      expect(streams[1].title).toBe('Other.Show.720p');
    });

    it('should filter streams by season and episode when specified', () => {
      const seriesResponse = [
        {
          hash: '1111111111111111111111111111111111111111',
          title: 'Show.S01E01.1080p',
          season: 1,
          episode: 1
        },
        {
          hash: '2222222222222222222222222222222222222222',
          title: 'Show.S01E02.1080p',
          season: 1,
          episode: 2
        }
      ];

      const s1e1 = client.extractStreamsFromResponse(seriesResponse, 1, 1);
      expect(s1e1).toHaveLength(1);
      expect(s1e1[0].hash).toBe('1111111111111111111111111111111111111111');

      const s1e2 = client.extractStreamsFromResponse(seriesResponse, 1, 2);
      expect(s1e2).toHaveLength(1);
      expect(s1e2[0].hash).toBe('2222222222222222222222222222222222222222');
    });

    it('should deduplicate streams with identical infoHashes', () => {
      const duplicateData = [
        { hash: validHash, title: 'Item 1', quality: '1080p' },
        { hash: validHash, title: 'Item 1 Duplicate', quality: '1080p' }
      ];

      const streams = client.extractStreamsFromResponse(duplicateData);
      expect(streams).toHaveLength(1);
    });
  });

  describe('buildProviderUrl', () => {
    it('should replace all placeholders properly for movie templates', () => {
      const template = 'https://provider.org/api?id={imdbId}&num={imdbNumericId}&q={title}&page={page}&type={type}&key={apiKey}';
      const url = client.buildProviderUrl(template, 'tt0056923', 'movie', undefined, undefined, 'Charade', 2, 'secret123');

      expect(url).toBe('https://provider.org/api?id=tt0056923&num=0056923&q=Charade&page=2&type=movie&key=secret123');
    });

    it('should replace season, seasonPad, episode, episodePad placeholders for series templates', () => {
      const template = 'https://provider.org/show?id={imdbId}&s={season}&sp={seasonPad}&e={episode}&ep={episodePad}';
      const url = client.buildProviderUrl(template, 'tt0055662', 'series', 3, 7);

      expect(url).toBe('https://provider.org/show?id=tt0055662&s=3&sp=03&e=7&ep=07');
    });
  });

  describe('getProviderTemplates and getProviderApiKey', () => {
    it('should return templates splitting on http/https URL boundaries', () => {
      process.env.TORRENT_MOVIE_PROVIDERS = 'https://api1.org/search?q={imdbId}, https://api2.org/torrents/{imdbId}';
      const templates = client.getProviderTemplates('movie');
      expect(templates).toEqual([
        'https://api1.org/search?q={imdbId}',
        'https://api2.org/torrents/{imdbId}'
      ]);
    });

    it('should support singular TORRENT_MOVIE_PROVIDER or TORRENT_SHOW_PROVIDER', () => {
      delete process.env.TORRENT_MOVIE_PROVIDERS;
      process.env.TORRENT_MOVIE_PROVIDER = 'https://single.org/movies';
      expect(client.getProviderTemplates('movie')).toEqual(['https://single.org/movies']);

      delete process.env.TORRENT_SHOW_PROVIDERS;
      process.env.TORRENT_SHOW_PROVIDER = 'https://single.org/shows';
      expect(client.getProviderTemplates('series')).toEqual(['https://single.org/shows']);
    });

    it('should retrieve matching positional API keys or return empty string for none/null', () => {
      process.env.TORRENT_MOVIE_PROVIDER_API_KEYS = 'key1, none, key3';
      expect(client.getProviderApiKey('movie', 0)).toBe('key1');
      expect(client.getProviderApiKey('movie', 1)).toBe('');
      expect(client.getProviderApiKey('movie', 2)).toBe('key3');
    });
  });

  describe('filterAndRankTorrents', () => {
    it('should filter streams within size limits and rank 1080p above 720p', () => {
      const streams = [
        { hash: '1', title: 'Movie 720p', quality: '720p', size: '1.5 GB', sizeGB: 1.5, peers: 20, codec: 'h264' as const },
        { hash: '2', title: 'Movie 1080p', quality: '1080p', size: '4.0 GB', sizeGB: 4.0, peers: 15, codec: 'h264' as const },
        { hash: '3', title: 'Movie 1080p Huge', quality: '1080p', size: '25.0 GB', sizeGB: 25.0, peers: 50, codec: 'h264' as const } // Exceeds 12GB movie limit
      ];

      const ranked = client.filterAndRankTorrents(streams, 'movie', 3);
      expect(ranked).toHaveLength(2);
      expect(ranked[0].hash).toBe('2'); // 1080p ranked first
      expect(ranked[1].hash).toBe('1'); // 720p ranked second
    });

    it('should prioritize healthy H264 (>= 5 peers) over other codecs', () => {
      const streams = [
        { hash: 'hevc', title: 'Movie 1080p HEVC', quality: '1080p', size: '2 GB', sizeGB: 2.0, peers: 10, codec: 'hevc' as const },
        { hash: 'h264', title: 'Movie 1080p H264', quality: '1080p', size: '2 GB', sizeGB: 2.0, peers: 8, codec: 'h264' as const }
      ];

      const ranked = client.filterAndRankTorrents(streams, 'movie', 3);
      expect(ranked[0].hash).toBe('h264');
      expect(ranked[1].hash).toBe('hevc');
    });

    it('should fallback to higher seeded 720p if 1080p has low seeders (< 5)', () => {
      const streams = [
        { hash: 'low1080', title: 'Movie 1080p', quality: '1080p', size: '3 GB', sizeGB: 3.0, peers: 2, codec: 'h264' as const },
        { hash: 'high720', title: 'Movie 720p', quality: '720p', size: '1.5 GB', sizeGB: 1.5, peers: 30, codec: 'h264' as const }
      ];

      const ranked = client.filterAndRankTorrents(streams, 'movie', 3);
      expect(ranked[0].hash).toBe('high720');
      expect(ranked[1].hash).toBe('low1080');
    });

    it('should fallback to SD streams if no HD (1080p / 720p) streams are available', () => {
      const streams = [
        { hash: 'dvd', title: 'Vintage Movie 480p DVDRip', quality: '480p', size: '800 MB', sizeGB: 0.8, peers: 12, codec: 'h264' as const }
      ];

      const ranked = client.filterAndRankTorrents(streams, 'movie', 3);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].hash).toBe('dvd');
    });
  });

  describe('getTorrentStreams & getTopTorrents end-to-end', () => {
    it('should throw ServiceUnavailableError when no provider is configured in environment', async () => {
      delete process.env.TORRENT_MOVIE_PROVIDERS;
      delete process.env.TORRENT_MOVIE_PROVIDER;

      await expect(client.getTorrentStreams('tt0056923', 'movie')).rejects.toThrow(ServiceUnavailableError);
    });

    it('should query configured provider, extract streams, and cache results', async () => {
      process.env.TORRENT_MOVIE_PROVIDERS = 'https://api.mocktorrents.org/movie/{imdbId}';

      const mockResponse = [
        {
          hash: '1111111111111111111111111111111111111111',
          title: 'Metropolis.1927.1080p.BluRay.x264',
          size: '2.5 GB',
          seeders: 100
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse
      });

      const streams = await client.getTorrentStreams('tt0017136', 'movie');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(streams).toHaveLength(1);
      expect(streams[0].hash).toBe('1111111111111111111111111111111111111111');

      // Second call should HIT the cache and not invoke fetch again
      const cachedStreams = await client.getTorrentStreams('tt0017136', 'movie');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(cachedStreams).toEqual(streams);
    });

    it('should query show torrents with season & episode and return top ranked streams', async () => {
      process.env.TORRENT_SHOW_PROVIDERS = 'https://api.mockshows.org/show/{imdbId}/s{season}e{episode}';

      const mockShowTorrents = [
        {
          hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          title: 'The.Beverly.Hillbillies.S01E01.720p.HDTV.x264',
          size: '800 MB',
          seeders: 45
        },
        {
          hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          title: 'The.Beverly.Hillbillies.S01E01.1080p.BluRay.x264',
          size: '1.8 GB',
          seeders: 50
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockShowTorrents
      });

      const top = await client.getTopTorrents('tt0055662', 'series', 1, 1, 2);
      expect(top).toHaveLength(2);
      expect(top[0].quality).toBe('1080p');
      expect(top[1].quality).toBe('720p');
    });

    it('should throw BadGatewayError when all configured stream providers fail', async () => {
      process.env.TORRENT_MOVIE_PROVIDERS = 'https://api.failing1.org/torrents, https://api.failing2.org/torrents';

      mockFetch.mockRejectedValueOnce(new Error('Network error 1'));
      mockFetch.mockRejectedValueOnce(new Error('Network error 2'));

      await expect(client.getTorrentStreams('tt1234567', 'movie')).rejects.toThrow(BadGatewayError);
    });
  });

  describe('resolveTitle helper', () => {
    it('should resolve title from metadataRepo cache if present', async () => {
      vi.spyOn(metadataRepo, 'getCachedMetadata').mockReturnValueOnce({
        id: 'tt0056923',
        type: 'movie',
        metadata: { title: 'Cached Charade' } as any,
        created_at: Date.now()
      });

      const title = await client.resolveTitle('tt0056923', 'movie');
      expect(title).toBe('Cached Charade');
    });

    it('should fallback to cinemetaClient.fetchMetadataDetails if not in DB cache', async () => {
      vi.spyOn(metadataRepo, 'getCachedMetadata').mockReturnValueOnce(null);
      vi.spyOn(cinemetaClient, 'fetchMetadataDetails').mockResolvedValueOnce({
        id: 'tt0056923',
        type: 'movie',
        name: 'Cinemeta Charade'
      });

      const title = await client.resolveTitle('tt0056923', 'movie');
      expect(title).toBe('Cinemeta Charade');
    });
  });

  describe('singleton export', () => {
    it('torrentProviderClient should be an instance of TorrentProviderClient', () => {
      expect(torrentProviderClient).toBeInstanceOf(TorrentProviderClient);
    });
  });
});
