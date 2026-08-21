import { fetchWithTimeout } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { metadataRepo } from '../db/metadata.js';
import { cinemetaClient } from './cinemeta.js';
import { ErrorCode } from '../types/index.js';
import { BadGatewayError, ServiceUnavailableError } from '../utils/errors.js';
import type { StreamInfo, ParsedTorrentCandidate } from '../types/index.js';

const STREAM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const DEFAULT_TRACKERS: readonly string[] = Object.freeze([
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://open.demonii.com:1337/announce',
  'https://tracker.moeblog.cn:443/announce',
  'udp://open.dstud.io:6969/announce',
  'udp://tracker.srv00.com:6969/announce',
  'https://tracker.zhuqiy.com:443/announce',
  'https://tracker.pmman.tech:443/announce'
]);

interface CachedTorrentStreams {
  streams: StreamInfo[];
  timestamp: number;
}

/**
 * Converts RFC 4648 Base32 string (32 characters) to 40-character hexadecimal info hash.
 */
export function base32ToHex(base32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.toUpperCase().replace(/=+$/, '');
  if (clean.length !== 32) return '';

  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) return '';
    bits += val.toString(2).padStart(5, '0');
  }

  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    const chunk = bits.substring(i, i + 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex.toLowerCase();
}

/**
 * Normalizes any infoHash, magnet link, or BTIH string into a canonical 40-char lowercase hex hash.
 */
export function normalizeInfoHash(input: unknown): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // 1. Check if it is already a 40-char hex string
  if (/^[a-fA-F0-9]{40}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  // 2. Check if it is a 32-char Base32 string
  if (/^[a-zA-Z2-7]{32}$/.test(trimmed)) {
    const converted = base32ToHex(trimmed);
    if (converted && converted.length === 40) {
      return converted;
    }
  }

  // 3. Check if it's inside a magnet URI
  const magnetMatch = trimmed.match(/magnet:\?xt=urn:btih:([a-zA-Z0-9]+)/i);
  if (magnetMatch && magnetMatch[1]) {
    const rawBtih = magnetMatch[1];
    if (rawBtih.length === 40 && /^[a-fA-F0-9]{40}$/.test(rawBtih)) {
      return rawBtih.toLowerCase();
    }
    if (rawBtih.length === 32 && /^[a-zA-Z2-7]{32}$/.test(rawBtih)) {
      const converted = base32ToHex(rawBtih);
      if (converted && converted.length === 40) {
        return converted;
      }
    }
  }

  return null;
}

/**
 * Universal Torrent Provider Client.
 * Dynamically resolves provider endpoint templates and robustly extracts torrent streams from any schema.
 */
export class TorrentProviderClient {
  private torrentStreamsCache: Map<string, CachedTorrentStreams>;

  constructor() {
    this.torrentStreamsCache = new Map<string, CachedTorrentStreams>();
    this._startCacheCleaner();
  }

  /**
   * Periodically evicts expired cache entries.
   */
  private _startCacheCleaner(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, cached] of this.torrentStreamsCache.entries()) {
        if (now - cached.timestamp >= STREAM_CACHE_TTL_MS) {
          this.torrentStreamsCache.delete(key);
        }
      }
    }, 5 * 60 * 1000).unref();
  }

  /**
   * Constructs a magnet link string using a torrent hash, title, and tracker list.
   */
  constructMagnetUrl(hash: string, title: string): string {
    const cleanHash = normalizeInfoHash(hash) || hash;
    const trackersString = DEFAULT_TRACKERS.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');
    return `magnet:?xt=urn:btih:${cleanHash}&dn=${encodeURIComponent(title)}${trackersString}`;
  }

  /**
   * Universal size extractor: parses numeric bytes or formatted strings (e.g. '1.45 GB', '750 MB', '💾 2.1 GB') into GB.
   */
  parseSizeToGB(sizeVal: unknown, textFallback?: string): { sizeGB: number; sizeStr: string } {
    // 1. Direct number or numeric string (could be bytes or GB)
    const numericVal =
      typeof sizeVal === 'number'
        ? sizeVal
        : typeof sizeVal === 'string' && /^\d+(\.\d+)?$/.test(sizeVal.trim())
          ? parseFloat(sizeVal.trim())
          : NaN;

    if (!isNaN(numericVal) && numericVal > 0) {
      if (numericVal > 1_000_000) {
        // Raw bytes
        const gb = numericVal / (1024 * 1024 * 1024);
        const str = gb >= 1 ? `${gb.toFixed(2)} GB` : `${(numericVal / (1024 * 1024)).toFixed(1)} MB`;
        return { sizeGB: gb, sizeStr: str };
      }
      if (numericVal <= 1000) {
        // Already in GB
        return { sizeGB: numericVal, sizeStr: `${numericVal.toFixed(2)} GB` };
      }
    }

    // 2. String parsing from sizeVal or textFallback
    const candidates = [
      typeof sizeVal === 'string' ? sizeVal : '',
      textFallback || ''
    ];

    for (const text of candidates) {
      if (!text) continue;

      // Match standard size pattern: 1.45 GB, 700 MB, 1.2 GiB, 450000000 B
      const match = text.match(/\b([\d.]+)\s*(TIB|TB|GIB|GB|MIB|MB|KIB|KB|BYTES|B)\b/i);
      if (match) {
        const val = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        return this._calcUnitToGB(val, unit);
      }
    }

    return { sizeGB: 0, sizeStr: '' };
  }

  private _calcUnitToGB(val: number, unit: string): { sizeGB: number; sizeStr: string } {
    let gb = 0;
    if (unit.startsWith('T')) gb = val * 1024;
    else if (unit.startsWith('G')) gb = val;
    else if (unit.startsWith('M')) gb = val / 1024;
    else if (unit.startsWith('K')) gb = val / (1024 * 1024);
    else if (unit.startsWith('B')) gb = val / (1024 * 1024 * 1024);

    const str = gb >= 1 ? `${gb.toFixed(2)} GB` : `${(gb * 1024).toFixed(1)} MB`;
    return { sizeGB: gb, sizeStr: str };
  }

  /**
   * Universal peer extractor: extracts peer / seeder numbers from properties or text patterns.
   */
  parsePeers(rawObj: Record<string, unknown>, textFallback?: string): number {
    // 1. Case-insensitive normalized key lookup
    const norm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawObj)) {
      norm[k.toLowerCase().replace(/[-_]/g, '')] = v;
    }

    const peerKeys = [
      'seeders', 'seeds', 'seeder', 'seed', 'peers', 'peer',
      'numseeders', 'numpeers', 's'
    ];

    for (const key of peerKeys) {
      const val = norm[key];
      if (typeof val === 'number' && !isNaN(val) && val >= 0) {
        return Math.floor(val);
      }
      if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
        return parseInt(val.trim(), 10);
      }
    }

    // 2. Pattern matching in text
    const candidates = [
      textFallback || '',
      typeof norm.title === 'string' ? (norm.title as string) : '',
      typeof norm.name === 'string' ? (norm.name as string) : '',
      typeof norm.description === 'string' ? (norm.description as string) : ''
    ];

    for (const text of candidates) {
      if (!text) continue;

      // Match emoji style: 👤 150
      const emojiMatch = text.match(/👤\s*(\d+)/);
      if (emojiMatch) return parseInt(emojiMatch[1], 10);

      // Match Seeds: 150 or S: 150
      const seedMatch = text.match(/\b(?:seeds?|seeders?|s):\s*(\d+)\b/i);
      if (seedMatch) return parseInt(seedMatch[1], 10);

      // Match ratio style: [150/20] or (150/20)
      const ratioMatch = text.match(/[[(](\d+)\s*[/|]\s*\d+[\])]/);
      if (ratioMatch) return parseInt(ratioMatch[1], 10);

      // Match "150 seeders" or "150 seeds"
      const suffixMatch = text.match(/\b(\d+)\s*(?:seeds?|seeders?)\b/i);
      if (suffixMatch) return parseInt(suffixMatch[1], 10);
    }

    return 0;
  }

  /**
   * Universal quality extractor: detects resolution and quality from properties, text, dimensions, or standard 'p' tags.
   */
  parseQuality(rawObj: Record<string, unknown>, textFallback?: string): string {
    const norm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawObj)) {
      norm[k.toLowerCase().replace(/[-_]/g, '')] = v;
    }

    const candidates = [
      norm.quality,
      norm.resolution,
      norm.res,
      norm.videoquality,
      norm.definition,
      norm.title,
      norm.name,
      norm.filename,
      norm.releasetitle,
      textFallback,
      norm.description
    ];

    for (const item of candidates) {
      if (item !== undefined && item !== null) {
        const text = String(item).trim();
        if (text) {
          const q = this._normalizeQualityString(text);
          if (q) return q;
        }
      }
    }

    return 'unknown';
  }

  private _normalizeQualityString(text: string): string | null {
    if (!text) return null;
    const clean = text.trim();

    // 1. Standalone resolution number: e.g. 1080, 720, 2160, 480
    if (/^\d{3,4}$/.test(clean)) {
      const num = parseInt(clean, 10);
      if (num >= 2000) return '2160p';
      if (num >= 1000) return '1080p';
      if (num >= 700) return '720p';
      if (num >= 400) return '480p';
      return `${num}p`;
    }

    // 2. 4K / 2160p patterns (e.g. 2160p, 4K, UHD, 3840x2160)
    if (/\b(2160p|2160i|4k|uhd|ultra[ ._-]?hd|3840\s*[x*×]\s*2160)\b/i.test(clean)) {
      return '2160p';
    }

    // 3. 1080p / FHD patterns (e.g. 1080p, 1080i, FHD, 1920x1080)
    if (/\b(1080p|1080i|fhd|full[ ._-]?hd|1920\s*[x*×]\s*1080)\b/i.test(clean)) {
      return '1080p';
    }

    // 4. 720p / HD patterns (e.g. 720p, 720i, 1280x720)
    if (/\b(720p|720i|1280\s*[x*×]\s*720)\b/i.test(clean)) {
      return '720p';
    }

    // 5. Standalone 'HD' tag (excluding 'FHD' or 'UHD')
    if (/\bhd\b/i.test(clean) && !/\bfhd|uhd\b/i.test(clean)) {
      return '720p';
    }

    // 6. Generic pixel height tag match: e.g. "1080p", "720p", "480p", "1080i"
    const pMatch = clean.match(/\b(\d{3,4})[pi]\b/i);
    if (pMatch) {
      const height = parseInt(pMatch[1], 10);
      if (height >= 2000) return '2160p';
      if (height >= 1000) return '1080p';
      if (height >= 700) return '720p';
      if (height >= 400) return '480p';
      return `${height}p`;
    }

    // 7. Generic resolution dimensions match: e.g. "1920x1080", "1280x720", "848x480"
    const dimMatch = clean.match(/\b\d{3,4}\s*[x*×]\s*(\d{3,4})\b/i);
    if (dimMatch) {
      const height = parseInt(dimMatch[1], 10);
      if (height >= 2000) return '2160p';
      if (height >= 1000) return '1080p';
      if (height >= 700) return '720p';
      if (height >= 400) return '480p';
      return `${height}p`;
    }

    // 8. Standard SD / Low Quality release tags
    if (/\b(480p|576p|360p|sd|dvdrip|webrip|bdrip|cam|ts|tc|telesync|screener)\b/i.test(clean)) {
      return '480p';
    }

    return null;
  }

  /**
   * Universal codec extractor: detects video codec from title and properties.
   */
  parseCodec(rawObj: Record<string, unknown>, textFallback?: string): 'h264' | 'hevc' | 'av1' | 'other' {
    const norm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawObj)) {
      norm[k.toLowerCase().replace(/[-_]/g, '')] = v;
    }

    const candidates = [
      norm.codec,
      norm.videocodec,
      norm.format,
      norm.title,
      norm.name,
      norm.filename,
      norm.releasetitle,
      textFallback,
      norm.description
    ];

    const combined = candidates
      .filter((c) => c !== undefined && c !== null)
      .map((c) => String(c))
      .join(' ')
      .toLowerCase();

    if (/\b(av1|av01)\b/i.test(combined)) {
      return 'av1';
    }
    if (/\b(x265|hevc|h265|h\.265|10bit|10-bit|hi10p)\b/i.test(combined)) {
      return 'hevc';
    }
    if (/\b(x264|h264|h\.264|avc|avc1)\b/i.test(combined)) {
      return 'h264';
    }

    return 'other';
  }

  /**
   * Universal stream parser: recursively traverses arbitrary JSON, XML, or plain text
   * to extract all possible StreamInfo torrent candidates.
   */
  extractStreamsFromResponse(
    rawData: unknown,
    season?: number | string,
    episode?: number | string
  ): StreamInfo[] {
    const discovered: StreamInfo[] = [];
    const seenHashes = new Set<string>();

    const tryAddStream = (item: Record<string, unknown>, fallbackTitle?: string) => {
      // Create lowercased normalized key mapping
      const norm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) {
        norm[k.toLowerCase().replace(/[-_]/g, '')] = v;
      }

      // Check season & episode match if specified
      if (season !== undefined && episode !== undefined) {
        const targetSeason = parseInt(String(season), 10);
        const targetEpisode = parseInt(String(episode), 10);

        if (!isNaN(targetSeason) && !isNaN(targetEpisode)) {
          const itemSeason = norm.season !== undefined ? parseInt(String(norm.season), 10) : undefined;
          const itemEpisode = norm.episode !== undefined ? parseInt(String(norm.episode), 10) : undefined;

          if (itemSeason !== undefined && !isNaN(itemSeason) && itemSeason !== targetSeason) {
            return;
          }
          if (itemEpisode !== undefined && !isNaN(itemEpisode) && itemEpisode !== targetEpisode) {
            return;
          }
        }
      }

      // 1. Search for infoHash directly or in magnet links
      let hash =
        normalizeInfoHash(norm.infohash) ||
        normalizeInfoHash(norm.hash) ||
        normalizeInfoHash(norm.torrenthash) ||
        normalizeInfoHash(norm.btih) ||
        normalizeInfoHash(norm.urn);

      // Check magnet / link fields if hash not yet found
      if (!hash) {
        const linkKeys = [
          'magnet', 'magneturl', 'magneturi', 'link', 'url',
          'downloadurl', 'download', 'torrent', 'details'
        ];
        for (const k of linkKeys) {
          const val = norm[k];
          if (typeof val === 'string') {
            hash = normalizeInfoHash(val);
            if (hash) break;
          }
        }
      }

      // If still no hash, check if `id` is a 40-hex or 32-base32 hash
      if (!hash && typeof norm.id === 'string') {
        hash = normalizeInfoHash(norm.id);
      }

      if (!hash || seenHashes.has(hash)) {
        return;
      }

      // 2. Extract Title / Name
      let title =
        (typeof norm.title === 'string' && norm.title.trim()) ||
        (typeof norm.name === 'string' && norm.name.trim()) ||
        (typeof norm.releasetitle === 'string' && norm.releasetitle.trim()) ||
        (typeof norm.filename === 'string' && norm.filename.trim()) ||
        fallbackTitle ||
        '';

      // Check if title can be extracted from dn= in magnet link
      if (!title) {
        const magnetKeys = ['magnet', 'magneturl', 'magneturi', 'link', 'url'];
        for (const mk of magnetKeys) {
          const mVal = norm[mk];
          if (typeof mVal === 'string' && mVal.includes('dn=')) {
            const dnMatch = mVal.match(/dn=([^&]+)/);
            if (dnMatch) {
              try {
                title = decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
                break;
              } catch {
                title = dnMatch[1];
              }
            }
          }
        }
      }

      if (!title) {
        title = hash;
      }

      // 3. Extract Quality
      const quality = this.parseQuality(item, title);

      // 4. Extract Size
      const rawSize =
        norm.size ??
        norm.sizebytes ??
        norm.bytes ??
        norm.length ??
        norm.contentlength ??
        norm.filesize ??
        norm.enclosurelength ??
        norm.enclosuresize;
      const { sizeGB, sizeStr } = this.parseSizeToGB(rawSize, title);

      // 5. Extract Peers
      const peers = this.parsePeers(item, title);

      // 6. Extract File Index
      let fileIdx: number | undefined = undefined;
      const fileIdxVal =
        norm.fileidx ??
        norm.fileindex ??
        norm.index ??
        norm.fileid;
      if (fileIdxVal !== undefined && fileIdxVal !== null) {
        const parsedIdx = parseInt(String(fileIdxVal), 10);
        if (!isNaN(parsedIdx) && parsedIdx >= 0) {
          fileIdx = parsedIdx;
        }
      }

      // 7. Extract Codec
      const codec = this.parseCodec(item, title);

      seenHashes.add(hash);
      discovered.push({
        hash,
        title,
        quality,
        size: sizeStr,
        sizeGB,
        peers,
        fileIdx,
        codec
      });
    };

    const findTitle = (obj: Record<string, unknown>): string | undefined => {
      const norm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        norm[k.toLowerCase().replace(/[-_]/g, '')] = v;
      }
      for (const key of ['title', 'name', 'releasetitle', 'filename', 'movietitle']) {
        if (typeof norm[key] === 'string' && (norm[key] as string).trim()) {
          return (norm[key] as string).trim();
        }
      }
      // Check common nested metadata container objects
      for (const container of ['meta', 'metadata', 'movie', 'show', 'item', 'details', 'media']) {
        if (norm[container] && typeof norm[container] === 'object' && !Array.isArray(norm[container])) {
          const nested = findTitle(norm[container] as Record<string, unknown>);
          if (nested) return nested;
        }
      }
      return undefined;
    };

    // Recursive traversal function
    const traverse = (node: unknown, depth = 0, parentTitle?: string) => {
      if (!node || depth > 8) return;

      // Handle Array
      if (Array.isArray(node)) {
        for (const element of node) {
          if (typeof element === 'string') {
            const h = normalizeInfoHash(element);
            if (h) {
              tryAddStream({ magnet: element }, parentTitle);
            }
          } else if (element && typeof element === 'object') {
            tryAddStream(element as Record<string, unknown>, parentTitle);
            traverse(element, depth + 1, parentTitle);
          }
        }
        return;
      }

      // Handle Object
      if (typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        const currentTitle = findTitle(obj) || parentTitle;

        tryAddStream(obj, currentTitle);

        for (const v of Object.values(obj)) {
          if (v && typeof v === 'object') {
            traverse(v, depth + 1, currentTitle);
          }
        }
      }
    };

    // 1. If rawData is a string, try JSON parse, structured XML parse, or regex fallback
    if (typeof rawData === 'string') {
      const trimmed = rawData.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          traverse(parsed);
          return discovered;
        } catch {
          // Fall through to text/XML parsing
        }
      }

      // Check if rawData is XML / RSS / Torznab feed
      if (
        trimmed.startsWith('<?xml') ||
        trimmed.startsWith('<rss') ||
        trimmed.startsWith('<feed') ||
        trimmed.includes('<channel') ||
        trimmed.includes('<item') ||
        trimmed.includes('<entry')
      ) {
        this._parseXmlFeed(trimmed, tryAddStream);
      } else {
        // Plain text stream (e.g. list of magnet links)
        const magnetMatches = trimmed.matchAll(/magnet:\?xt=urn:btih:([a-zA-Z0-9]+)[^\s"'<>]+/gi);
        for (const m of magnetMatches) {
          const magnetLink = m[0];
          tryAddStream({ magnet: magnetLink });
        }
      }
    } else {
      traverse(rawData);
    }

    return discovered;
  }

  /**
   * Robust XML / RSS / Torznab feed parser.
   * Extracts items, titles, enclosures, infohashes, and torznab attributes (seeders, size, etc.) without external dependencies.
   */
  private _parseXmlFeed(xmlText: string, tryAddStream: (item: Record<string, unknown>, parentTitle?: string) => void): void {
    // 1. Check for XML Error payloads from Torznab/Newznab
    const errorMatch =
      xmlText.match(/<error\b[^>]*\bdescription=["']([^"']+)["'][^>]*>/i) ||
      xmlText.match(/<error\b[^>]*>([\s\S]*?)<\/error>/i);
    if (errorMatch && errorMatch[1]) {
      const errorMsg = errorMatch[1].trim();
      logger.warn(`Provider returned XML error: ${errorMsg}`);
      throw new BadGatewayError(ErrorCode.PROVIDER_UNAVAILABLE);
    }

    // 2. Extract <item> and <entry> blocks
    const itemRegex = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
    let match: RegExpExecArray | null;
    let foundItems = 0;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      foundItems++;
      const itemBlock = match[1];
      const parsedItem: Record<string, unknown> = {};

      // Extract Title
      const titleMatch = itemBlock.match(/<title\b[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        parsedItem.title = titleMatch[1].trim();
      }

      // Extract Link / Guid
      const linkMatch =
        itemBlock.match(/<link\b[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) ||
        itemBlock.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
      if (linkMatch && linkMatch[1]) {
        parsedItem.link = linkMatch[1].trim();
      }

      const guidMatch = itemBlock.match(/<guid\b[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/guid>/i);
      if (guidMatch && guidMatch[1]) {
        parsedItem.guid = guidMatch[1].trim();
      }

      // Extract Enclosure (url, length, type)
      const enclosureMatch = itemBlock.match(/<enclosure\b([^>]+)\/?>/i);
      if (enclosureMatch && enclosureMatch[1]) {
        const encAttrs = enclosureMatch[1];
        const urlMatch = encAttrs.match(/url=["']([^"']+)["']/i);
        const lengthMatch = encAttrs.match(/length=["']([^"']+)["']/i);
        if (urlMatch && urlMatch[1]) parsedItem.enclosureUrl = urlMatch[1].trim();
        if (lengthMatch && lengthMatch[1]) parsedItem.enclosureLength = lengthMatch[1].trim();
      }

      // Extract Size / Length
      const sizeMatch =
        itemBlock.match(/<size\b[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/size>/i) ||
        itemBlock.match(/<length\b[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/length>/i);
      if (sizeMatch && sizeMatch[1]) {
        parsedItem.size = sizeMatch[1].trim();
      }

      // Extract Torznab / Newznab attributes
      const torznabAttrRegex = /<(?:torznab|newznab)?:?attr\b[^>]*\bname=["']([^"']+)["'][^>]*\bvalue=["']([^"']+)["'][^>]*\/?>/gi;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = torznabAttrRegex.exec(itemBlock)) !== null) {
        const attrName = attrMatch[1].toLowerCase().replace(/[-_]/g, '');
        const attrVal = attrMatch[2];
        parsedItem[attrName] = attrVal;
      }

      // Check for Magnet link in item block if link/enclosure didn't contain it
      const magnetInBlock = itemBlock.match(/magnet:\?xt=urn:btih:([a-zA-Z0-9]+)[^\s"'<>]+/i);
      if (magnetInBlock) {
        parsedItem.magnet = magnetInBlock[0];
      }

      // If infohash wasn't in torznab attributes, try link/enclosure/guid
      if (!parsedItem.infohash && !parsedItem.hash) {
        const candidateHash =
          normalizeInfoHash(parsedItem.magnet) ||
          normalizeInfoHash(parsedItem.link) ||
          normalizeInfoHash(parsedItem.enclosureUrl) ||
          normalizeInfoHash(parsedItem.guid);
        if (candidateHash) {
          parsedItem.infohash = candidateHash;
        }
      }

      tryAddStream(parsedItem, parsedItem.title as string | undefined);
    }

    // Fallback: If no standard <item> / <entry> found, match raw magnet links in the document
    if (foundItems === 0) {
      const magnetMatches = xmlText.matchAll(/magnet:\?xt=urn:btih:([a-zA-Z0-9]+)[^\s"'<>]+/gi);
      for (const m of magnetMatches) {
        const magnetLink = m[0];
        tryAddStream({ magnet: magnetLink });
      }
    }
  }

  /**
   * Resolves template variables in the provider URL string.
   */
  buildProviderUrl(
    template: string,
    id: string,
    type: 'movie' | 'series',
    season?: number | string,
    episode?: number | string,
    title?: string,
    page = 1,
    apiKeyOverride?: string
  ): string {
    const imdbId = id;
    const imdbNumericId = id.replace(/^tt/i, '');
    const encodedTitle = title ? encodeURIComponent(title) : '';

    const seasonNum = season !== undefined ? parseInt(String(season), 10) : 1;
    const episodeNum = episode !== undefined ? parseInt(String(episode), 10) : 1;
    const seasonStr = isNaN(seasonNum) ? '1' : String(seasonNum);
    const episodeStr = isNaN(episodeNum) ? '1' : String(episodeNum);
    const seasonPad = seasonStr.padStart(2, '0');
    const episodePad = episodeStr.padStart(2, '0');

    const apiKey = apiKeyOverride !== undefined ? apiKeyOverride : this.getProviderApiKey(type);

    let url = template
      .replace(/\{imdbId\}/gi, imdbId)
      .replace(/\{imdbNumericId\}/gi, imdbNumericId)
      .replace(/\{title\}/gi, encodedTitle)
      .replace(/\{season\}/gi, seasonStr)
      .replace(/\{seasonPad\}/gi, seasonPad)
      .replace(/\{episode\}/gi, episodeStr)
      .replace(/\{episodePad\}/gi, episodePad)
      .replace(/\{page\}/gi, String(page))
      .replace(/\{type\}/gi, type)
      .replace(/\{apiKey\}/gi, encodeURIComponent(apiKey))
      .replace(/\{api_key\}/gi, encodeURIComponent(apiKey));

    return url;
  }

  /**
   * Retrieves provider URL configurations from environment variables.
   * Supports comma-separated URLs (splitting only on URL boundaries: http:// or https://)
   * as well as singular/plural variable names.
   */
  getProviderTemplates(type: 'movie' | 'series'): string[] {
    const envProviders =
      type === 'movie'
        ? process.env.TORRENT_MOVIE_PROVIDERS || process.env.TORRENT_MOVIE_PROVIDER
        : process.env.TORRENT_SHOW_PROVIDERS || process.env.TORRENT_SHOW_PROVIDER;

    if (!envProviders || !envProviders.trim()) {
      return [];
    }

    const trimmed = envProviders.trim();

    // Split on comma only when followed by http:// or https:// to preserve commas inside URLs
    if (/https?:\/\//i.test(trimmed)) {
      return trimmed
        .split(/,\s*(?=https?:\/\/)/i)
        .map(p => p.trim())
        .filter(Boolean);
    }

    return trimmed
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);
  }

  /**
   * Retrieves single provider URL configuration from environment variables (first configured).
   */
  getProviderTemplate(type: 'movie' | 'series'): string | null {
    const templates = this.getProviderTemplates(type);
    return templates.length > 0 ? templates[0] : null;
  }

  /**
   * Retrieves API key for a provider index from environment variables.
   * Supports positional comma-separated keys (preserving empty slots or 'none') as well as a single global key.
   */
  getProviderApiKey(type: 'movie' | 'series', index = 0): string {
    const envKeys =
      (type === 'movie'
        ? process.env.TORRENT_MOVIE_PROVIDER_API_KEYS || process.env.TORRENT_MOVIE_PROVIDER_API_KEY
        : process.env.TORRENT_SHOW_PROVIDER_API_KEYS || process.env.TORRENT_SHOW_PROVIDER_API_KEY) ||
      process.env.TORRENT_PROVIDER_API_KEY ||
      '';

    if (!envKeys.trim()) return '';

    if (envKeys.includes(',')) {
      const keys = envKeys.split(',').map(k => k.trim());
      const selected = keys[index] || '';
      return selected.toLowerCase() === 'none' || selected.toLowerCase() === 'null' ? '' : selected;
    }

    const singleKey = envKeys.trim();
    return singleKey.toLowerCase() === 'none' || singleKey.toLowerCase() === 'null' ? '' : singleKey;
  }

  /**
   * Resolves title from SQLite metadata cache or Cinemeta if needed by the template.
   */
  async resolveTitle(id: string, type: 'movie' | 'series'): Promise<string | undefined> {
    const cached = metadataRepo.getCachedMetadata(id);
    if (cached?.metadata?.title) {
      return cached.metadata.title;
    }

    try {
      const details = await cinemetaClient.fetchMetadataDetails(id, type);
      return details.name || details.title;
    } catch {
      return undefined;
    }
  }

  /**
   * Filters streams (1080p / 720p with fallback to 480p / DVDRip / SD) and ranks them by peer health and quality.
   */
  filterAndRankTorrents(streams: StreamInfo[], type: 'movie' | 'series' = 'movie', count = 3): StreamInfo[] {
    const isMovie = type === 'movie';
    const limit1080 = isMovie ? 12.0 : 3.0;
    const limit720 = isMovie ? 6.0 : 1.5;
    const limitSD = isMovie ? 4.0 : 1.0;

    // 1. First attempt: filter for high definition (1080p / 720p)
    let filtered = streams.filter(s => {
      const qual = (s.quality || '').toLowerCase();
      if (!qual.includes('1080') && !qual.includes('720')) {
        return false;
      }
      if (qual.includes('1080') && s.sizeGB > limit1080) return false;
      if (qual.includes('720') && s.sizeGB > limit720) return false;
      if (s.peers === 0 && streams.some(other => other.peers > 0)) return false;
      return true;
    });

    // 2. Fallback: if no 1080p/720p streams exist (e.g. vintage TV shows or classic movies), accept SD / DVDRip / TVRip / 480p
    if (filtered.length === 0) {
      filtered = streams.filter(s => {
        if (s.sizeGB > limitSD) return false;
        if (s.peers === 0 && streams.some(other => other.peers > 0)) return false;
        return true;
      });
    }

    if (filtered.length === 0) return [];

    const HEALTHY_THRESHOLD = 5;

    const compareSameTier = (a: StreamInfo, b: StreamInfo): number => {
      const aCodec = a.codec || 'other';
      const bCodec = b.codec || 'other';

      // 1. Healthy H.264 Priority: If a stream is H.264 with >= 5 peers, favor it
      const aIsHealthyH264 = aCodec === 'h264' && a.peers >= HEALTHY_THRESHOLD;
      const bIsHealthyH264 = bCodec === 'h264' && b.peers >= HEALTHY_THRESHOLD;

      if (aIsHealthyH264 && !bIsHealthyH264) {
        // Only yield to non-H.264 if non-H.264 has overwhelming peer count (>= 50 peers AND >= 5x)
        if (b.peers >= 50 && b.peers >= a.peers * 5) {
          return b.peers - a.peers;
        }
        return -1;
      }
      if (bIsHealthyH264 && !aIsHealthyH264) {
        if (a.peers >= 50 && a.peers >= b.peers * 5) {
          return b.peers - a.peers;
        }
        return 1;
      }

      // 2. AV1 Penalty: Deprioritize AV1 if the competitor has healthy peers
      if (aCodec === 'av1' && bCodec !== 'av1' && b.peers >= HEALTHY_THRESHOLD) {
        return 1;
      }
      if (bCodec === 'av1' && aCodec !== 'av1' && a.peers >= HEALTHY_THRESHOLD) {
        return -1;
      }

      // 3. Same codec preference tier -> sort by descending peers
      return b.peers - a.peers;
    };

    const ranked = [...filtered].sort((a, b) => {
      const aQual = (a.quality || '').toLowerCase();
      const bQual = (b.quality || '').toLowerCase();
      const aIs1080 = aQual.includes('1080');
      const bIs1080 = bQual.includes('1080');
      const aIs720 = aQual.includes('720');
      const bIs720 = bQual.includes('720');

      // 1080p vs 1080p
      if (aIs1080 && bIs1080) {
        return compareSameTier(a, b);
      }

      if (aIs1080 || bIs1080) {
        const cand1080 = aIs1080 ? a : b;
        const candOther = aIs1080 ? b : a;

        // If 1080p has low seeds, prefer higher seeded 720p
        if (cand1080.peers < HEALTHY_THRESHOLD && candOther.peers >= HEALTHY_THRESHOLD && candOther.peers >= cand1080.peers * 2) {
          return aIs1080 ? 1 : -1;
        }
        return aIs1080 ? -1 : 1;
      }

      // 720p vs SD
      if (aIs720 !== bIs720) {
        return aIs720 ? -1 : 1;
      }

      // Same quality tier (720p vs 720p or SD vs SD)
      return compareSameTier(a, b);
    });

    // Deduplicate by infoHash
    const unique: StreamInfo[] = [];
    const seenHashes = new Set<string>();
    for (const c of ranked) {
      if (c.hash && !seenHashes.has(c.hash)) {
        seenHashes.add(c.hash);
        unique.push(c);
      }
      if (unique.length >= count) break;
    }

    return unique;
  }

  /**
   * Fetches streams from a single provider template across pages.
   */
  private async _fetchStreamsFromSingleProvider(
    template: string,
    id: string,
    type: 'movie' | 'series',
    season?: number | string,
    episode?: number | string,
    resolvedTitle?: string,
    providerIndex = 0
  ): Promise<StreamInfo[]> {
    const apiKey = this.getProviderApiKey(type, providerIndex);

    const headers: Record<string, string> = {
      'User-Agent': 'Orion/1.0 (MediaStreamer)',
      'Accept': 'application/json, text/xml, application/xml, text/plain, */*'
    };

    if (apiKey && !template.includes('{apiKey}') && !template.includes('{api_key}')) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['x-api-key'] = apiKey;
    }

    let currentPage = 1;
    const MAX_PAGES = 5;
    const discovered: StreamInfo[] = [];

    while (currentPage <= MAX_PAGES) {
      let pageUrl = this.buildProviderUrl(template, id, type, season, episode, resolvedTitle, currentPage, apiKey);
      if (currentPage > 1 && !template.includes('{page}')) {
        try {
          const parsedUrl = new URL(pageUrl);
          parsedUrl.searchParams.set('page', String(currentPage));
          pageUrl = parsedUrl.toString();
        } catch {
          break;
        }
      }

      logger.info(`Fetching streams from provider (page ${currentPage}): ${pageUrl}`);
      let resp: Response;
      try {
        resp = await fetchWithTimeout(pageUrl, { headers }, 10000);
      } catch (fetchErr) {
        logger.warn(`Stream search network failure via ${pageUrl}`, fetchErr);
        throw fetchErr;
      }

      if (!resp.ok) {
        logger.warn(`Stream provider returned HTTP status ${resp.status} for ${pageUrl}`);
        break;
      }

      // Support text/json/xml parsing
      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      let rawData: unknown;
      if (contentType.includes('application/json')) {
        rawData = await resp.json();
      } else {
        const text = await resp.text();
        const trimmed = text.trim();

        // Fast fail if response is HTML error / Cloudflare challenge page
        if (
          trimmed.startsWith('<!DOCTYPE html') ||
          (trimmed.startsWith('<html') && !trimmed.includes('<rss') && !trimmed.includes('<channel'))
        ) {
          logger.warn(`Stream provider returned unexpected HTML page for ${pageUrl}`);
          break;
        }

        try {
          rawData = JSON.parse(trimmed);
        } catch {
          rawData = text;
        }
      }

      const streams = this.extractStreamsFromResponse(rawData, season, episode);
      if (streams.length > 0) {
        discovered.push(...streams);
        // Found matching streams for this episode; no need to continue paginating
        break;
      }

      // Check if response indicates there are more pages
      if (!this._hasMorePages(rawData, currentPage)) {
        break;
      }

      currentPage++;
    }

    return discovered;
  }

  /**
   * Scrapes stream options from all configured stream providers, extracts & caches them, and returns formatted streams.
   */
  async getTorrentStreams(
    id: string,
    type: 'movie' | 'series',
    season?: number | string,
    episode?: number | string,
    title?: string
  ): Promise<StreamInfo[]> {
    const cacheKey = type === 'series' ? `${id}:${season}:${episode}` : id;
    const cached = this.torrentStreamsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < STREAM_CACHE_TTL_MS) {
      logger.debug(`Cache HIT for torrents of media: ${cacheKey}`);
      return cached.streams;
    }

    const templates = this.getProviderTemplates(type);
    if (templates.length === 0) {
      logger.error(`No torrent stream provider configured for ${type}. Please set TORRENT_${type === 'movie' ? 'MOVIE' : 'SHOW'}_PROVIDERS in .env`);
      throw new ServiceUnavailableError(ErrorCode.PROVIDER_NOT_CONFIGURED);
    }

    // If any template requires title and none was passed, resolve title
    let resolvedTitle = title;
    const needsTitle = templates.some(t => t.includes('{title}'));
    if (needsTitle && !resolvedTitle) {
      resolvedTitle = await this.resolveTitle(id, type);
    }

    const results = await Promise.allSettled(
      templates.map((template, idx) =>
        this._fetchStreamsFromSingleProvider(template, id, type, season, episode, resolvedTitle, idx)
      )
    );

    const allDiscovered: StreamInfo[] = [];
    let hadSuccessfulQuery = false;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        hadSuccessfulQuery = true;
        allDiscovered.push(...result.value);
      }
    }

    if (!hadSuccessfulQuery && allDiscovered.length === 0) {
      logger.error(`All torrent stream providers failed for ${cacheKey}`);
      throw new BadGatewayError(ErrorCode.PROVIDER_UNAVAILABLE);
    }

    // Deduplicate streams across all providers by infoHash
    const uniqueStreams: StreamInfo[] = [];
    const seenHashes = new Set<string>();
    for (const s of allDiscovered) {
      const h = s.hash?.toLowerCase();
      if (h && !seenHashes.has(h)) {
        seenHashes.add(h);
        uniqueStreams.push(s);
      } else if (!h) {
        uniqueStreams.push(s);
      }
    }

    if (uniqueStreams.length > 0) {
      this.torrentStreamsCache.set(cacheKey, {
        streams: uniqueStreams,
        timestamp: Date.now()
      });
    }

    logger.info(`Discovered ${uniqueStreams.length} streams for ${cacheKey} from ${templates.length} provider(s)`);
    return uniqueStreams;
  }

  private _hasMorePages(rawData: unknown, currentPage: number): boolean {
    if (!rawData || typeof rawData !== 'object') return false;
    const obj = rawData as Record<string, unknown>;

    // 1. Paginated count format: torrents_count, limit, page
    if (obj.torrents_count !== undefined && obj.limit !== undefined) {
      const total = parseInt(String(obj.torrents_count), 10);
      const limit = parseInt(String(obj.limit), 10);
      if (!isNaN(total) && !isNaN(limit) && limit > 0) {
        return total > currentPage * limit;
      }
    }

    // 2. Generic total_pages or pages count
    if (typeof obj.total_pages === 'number') return currentPage < obj.total_pages;
    if (typeof obj.pages === 'number') return currentPage < obj.pages;
    if (typeof obj.page_count === 'number') return currentPage < obj.page_count;

    // 3. Full result page indicator
    const torrentsList = obj.torrents || obj.results || obj.items || obj.data;
    if (Array.isArray(torrentsList) && torrentsList.length >= 25) {
      return true;
    }

    return false;
  }

  /**
   * Fetches torrent streams and returns the top `count` ranked matches.
   */
  async getTopTorrents(
    id: string,
    type: 'movie' | 'series' = 'movie',
    season?: number | string,
    episode?: number | string,
    count = 3,
    title?: string
  ): Promise<StreamInfo[]> {
    const torrents = await this.getTorrentStreams(id, type, season, episode, title);
    return this.filterAndRankTorrents(torrents, type, count);
  }
}

const torrentProviderClient = new TorrentProviderClient();

export { torrentProviderClient };
export default torrentProviderClient;
