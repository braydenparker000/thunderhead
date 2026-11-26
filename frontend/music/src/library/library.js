// The music library: the R2 index's tracks, lazily opened media/cover URLs,
// and category views (albums, artists, genres, folders).
import {idleWork} from '../view/idle-work.js';
import {LibraryDb} from './db.js';
import {readSnapshot, readWave, saveSnapshot, touchSnapshot} from './snapshot.js';
import {readRemotePicture} from './tags.js';
import {makeSplitter, GENRE_DEFAULT_SPLIT} from './split.js';
import {Playlists} from './playlists.js';
import {ListMemory} from './list-memory.js';
import {cueTracks} from './cue.js';
import {shelfSteps} from './shelves.js';
import {albumArtistSteps, albumSteps, folderSteps, namedSteps, PATHS, PLAIN, run} from './groups.js';
import {fetchR2Library, r2Tracks, R2_LIBRARY_URL, fetchWaveform, peaksToBars, decodeWave} from './r2.js';
import {barsFromMeanSquares, rmsBytesToMeanSquares, loudnessFromPeaks, waveSteps, MIN_WAVE_STEPS} from './waveform.js';
import {isWide, packRect} from './cover-crop.js';
import {cropBlob, cropRect, decide, FIT_KEY, installCoverFit, later} from './cover-fit.js';

// Remote covers: full images in Cache Storage on first view (capped, oldest
// out first); 256 px thumbnails made once per cover for list rows (kept).
// Object URLs live in small in-memory LRUs that release their images.
const COVERS = 'claude-player-covers', THUMBS = 'claude-player-thumbs';
const COVER_CAP = 1500, THUMB_PX = 256, MEM_FULL = 60, MEM_THUMB = 800;
// A wide cover shown as its square (cover-fit.js): the full one cut at up to FIT_PX, its thumbnail kept beside
// the whole one under its own key, tagged with the square it was cut to.
const FIT_PX = 1600;
const cropKey = ck => localKey('covers/crop/', ck);
const COVER_SLOTS = 3, ROW_SETTLE_MS = 150;
const R2_REFRESH_MS = 10 * 60 * 1000; // a revalidation: an unchanged index costs a 304
const SKIPPED = Symbol('skipped'), FAILED = Symbol('failed'), HURRY = Symbol('hurry');
// A cover that did not arrive (not a "no cover") is asked again after these, then at a bind as long after it.
const RETRY_MS = [2000, 8000, 30000];
const isRemoteArt = key => /^(https:|embedded:)/.test(key);
// Cache Storage needs URL keys: embedded covers and shared bucket covers ('cover:<coverKey>') get a local pseudo-URL.
const localKey = (dir, k) => new URL(dir + encodeURIComponent(k), location.href).href;
const cacheKey = key => (key.startsWith('embedded:') ? localKey('covers/embedded/', key.slice(9)) : key.startsWith('cover:') ? localKey('covers/shared/', key.slice(6)) : key);

// Per-track listening data for remote tracks (state store, key u:<id>); ratedAt: when the rating
// was set, for the sync between phones (th/music/sync.js).
const USER_FIELDS = ['wave', 'waveSrc', 'durationMs', 'plays', 'lastPlayed', 'rating', 'ratedAt', 'decodedPeak'];

export class Library {
  constructor(ctx) {
    this.ctx = ctx;
    this.db = null;
    this.tracks = [];
    this.allTracks = [];
    // The scan settings apply to the loaded records at once (the reference rescans).
    ctx.bus.subscribe('bus_app', (msg, src, d) => {
      if (msg === 'msg_app_setting_changed' && /^(scan_min_track_duration|skip_video|process_cues|show_cue_source)$/.test(d?.key ?? '')) this.setTracks(this.allTracks);
    });
    this.byId = new Map();
    this.artCache = new Map();
    this.thumbCache = new Map();
    ctx.bus.subscribe('bus_app', (msg, src, d) => { if (msg === 'msg_app_setting_changed' && (d?.key === 'aa_force_default' || d?.key === FIT_KEY)) this.refreshArt(); });
    installCoverFit(ctx);
    this.coverPuts = 0;
    this.fileUrls = new Map();
    this.remoteTracks = [];
    this.userData = new Map();
    ctx.library = this;
    this.playlists = new Playlists(ctx, this);
    this.listMemory = new ListMemory(ctx, this);
    this.customArt = new Map(); // 'a:<album>\0<artist>' or 't:<id>' -> Blob (picked images)
    ctx.bus.subscribe('bus_data_cmd', (msg, src, d) => {
      if (msg === 'cmd_data_track_rating' && d?.track) this.setRating(d.track, d.arg1 ?? 0);
    });
  }

  /**
   * Opens stored imports and the last R2 index snapshot (fast start), then
   * refreshes the R2 index in the background.
   */
  async open() {
    try {
      this.db = await LibraryDb.open();
      for (const [k, v] of await this.db.stateEntries('u:')) this.userData.set(k.slice(2), v);
      // The snapshot in parts (snapshot.js); the single record of before is read once and moved.
      // Each part takes the songs' own data as it comes (a part at a time, not all in one task).
      const snap = await readSnapshot(this.db, part => this.withUserData(part));
      if (snap?.tracks) { this.r2Generated = snap.generatedAt; this.r2SavedAt = snap.savedAt ?? 0; this.remoteTracks = snap.old ? this.withUserData(snap.tracks) : snap.tracks; }
      this.setTracks([...this.remoteTracks]);
      if (snap?.old) this.saveSnapshot();
      for (const [k, v] of await this.db.stateEntries('ca:')) if (v instanceof Blob) this.customArt.set(k.slice(3), v);
      await this.playlists.load();
      await this.listMemory.load();
    } catch (e) {
      console.warn('[claude-player] library storage unavailable', e);
    }
    this.r2Ready = this.refreshR2();
    return this;
  }

  withUserData(list) {
    for (const t of list) {
      const u = this.userData.get(t.id);
      // The index's own waveform wins over one stored from an earlier source;
      // a stored copy of a served waveform made another way (an older kind or
      // drawing) is fetched again.
      const stale = k => k === 'wave' && (t.waveB64 || t.wave || (t.waveUrl && u.waveSrc !== waveSrcFor(t)));
      if (u) for (const k of USER_FIELDS) if (u[k] !== undefined && !stale(k)) t[k] = u[k];
      t.meta = trackMetaLabel(t);
      // Remote covers: the Worker's image, else the audio file's embedded cover (artFor).
      // Songs that share a bucket cover (coverKey) share its download, thumbnail and memo (coverOf).
      if (t.remote) t.artId = t.artUrl || 'embedded:' + t.id;
      if (t.remote && t.artUrl && t.coverKey) (this.coverIds ??= new Map()).set(t.artUrl, 'cover:' + t.coverKey);
    }
    return list;
  }

  /**
   * Decodes a track's inline index waveform (peak bars) on first use. One kept apart in the snapshot
   * (`waveB64: true`, snapshot.js) is there once read (loadWave: waveFor, prefetchWave).
   */
  ensureWave(t) {
    if (t && !t.wave && typeof t.waveB64 === 'string') { const w = decodeWave(t.waveB64); if (w) t.wave = loudnessFromPeaks(w); }
    return t?.wave ?? null;
  }

  /** A waveform kept apart in the snapshot, read and decoded as ensureWave does an inline one. */
  async loadWave(t) {
    const w = this.db ? await readWave(this.db, t.id) : null;
    if (!t.wave && typeof w === 'string') { const v = decodeWave(w); if (v) t.wave = loudnessFromPeaks(v); }
    else if (!t.wave && Array.isArray(w)) t.wave = w;
    return t.wave ?? null;
  }

  /** The snapshot written again from the shown songs, in their sorted order (snapshot.js), in the background. */
  saveSnapshot() {
    if (!this.db) return Promise.resolve();
    const tracks = this.allTracks.filter(t => t.remote && !t.cueOf);
    return saveSnapshot(this.db, {generatedAt: this.r2Generated, savedAt: this.r2SavedAt ?? 0, tracks}).catch(e => console.warn('[claude-player] snapshot', e));
  }

  /**
   * Loads the R2 index; replaces the remote tracks when it changed. A snapshot
   * younger than R2_REFRESH_MS is kept unless forced (Rescan); older, the
   * browser revalidates its cached index (304 when unchanged).
   */
  async refreshR2({force = false, url = this.ctx.settings?.r2_library_url || R2_LIBRARY_URL} = {}) {
    if (!force && this.remoteTracks.length && Date.now() - (this.r2SavedAt ?? 0) < R2_REFRESH_MS) return false;
    try {
      const data = await fetchR2Library(url);
      this.r2Error = null;
      if (data.generatedAt && data.generatedAt === this.r2Generated) {
        this.r2SavedAt = Date.now();
        // Only the head's time (snapshot.js), not the whole snapshot again.
        if (this.db) touchSnapshot(this.db, this.r2SavedAt).catch(() => {});
        return false;
      }
      const tracks = r2Tracks(data, url);
      this.r2Generated = data.generatedAt;
      this.remoteTracks = this.withUserData(tracks);
      this.r2SavedAt = Date.now();
      // The snapshot keeps index data only (no decoded waves or images), in parts, its waveforms apart.
      if (await this.replaceTracks([...this.remoteTracks])) this.saveSnapshot();
      return true;
    } catch (e) {
      console.warn('[claude-player] R2 library unavailable:', e.message);
      // Why, for library/access.js (a status, or none for a network failure).
      this.r2Error = e;
      return false;
    }
  }

  /** Persists a track's changed data (imports: the record; R2 tracks: listening data). */
  saveTrack(t) {
    if (!this.db) return Promise.resolve();
    // Virtual CUE tracks keep their listening data like remote ones.
    if (!t.remote && !t.cueOf) {
      // Runtime fields (images, object URLs) stay out of the stored record.
      const {art, thumb, ...rec} = t;
      if (typeof rec.src === 'string' && rec.src.startsWith('blob:')) delete rec.src;
      return this.db.updateTrack(rec).catch(e => console.warn('[claude-player] save track', e));
    }
    const u = {};
    for (const k of USER_FIELDS) if (t[k] !== undefined) u[k] = t[k];
    this.userData.set(t.id, u);
    return this.db.setState('u:' + t.id, u);
  }

  /**
   * The library's tracks: every record (allTracks, byId), of which the scan
   * settings keep tracks (scan_min_track_duration: shorter tracks are
   * ignored, 0 keeps all; skip_video: files with a video stream are ignored).
   */
  setTracks(list) {
    this.commitTracks(this.arrange(list));
  }

  /**
   * A refreshed catalog's songs shown without a long task: sorted (sortTracks: the shown order as a
   * hint), then, for a large library, the category views for them built ahead in idle slices
   * (warmSteps, kept beside the shown ones), and only then shown, in one go, with their views made.
   * False when a later refresh took its place meanwhile.
   */
  async replaceTracks(list) {
    const token = this._replacing = {};
    let a = this.arrange(list);
    if (a.shown.length >= PREPARE_MIN && this.tracks.length && globalThis.requestIdleCallback) {
      this._nextTracks = a.shown;
      await idleWork(this.ctx, 'groups', [() => this.warmSteps(a.shown), () => this.ctx.orderSteps?.(a.shown)]);
      if (this._nextTracks === a.shown) this._nextTracks = null;
      if (token !== this._replacing) return false;
      // A scan setting changed meanwhile: arranged again with it (the views then build on use).
      if (a.prefs !== this.scanPrefs()) a = this.arrange(a.list);
    }
    this.commitTracks(a);
    return true;
  }

  /** The scan settings that pick the shown songs (setTracks), as one key. */
  scanPrefs() {
    return ['scan_min_track_duration', 'skip_video', 'process_cues', 'show_cue_source'].map(k => String(this.ctx.pref?.(k) ?? '')).join('\u0002');
  }

  /** The songs sorted and the shown ones picked (setTracks), not yet shown. */
  arrange(list) {
    sortTracks(list, this.allTracks);
    const prefs = this.scanPrefs();
    const minMs = (+(this.ctx.pref?.('scan_min_track_duration') ?? 6) || 0) * 1000, noVideo = !!this.ctx.pref?.('skip_video');
    // process_cues: disc images with a sheet show as their virtual tracks
    // (kept per image, so a playing one stays the same object); the image
    // itself only with show_cue_source.
    const cues = this.ctx.pref?.('process_cues') !== false, showSource = !!this.ctx.pref?.('show_cue_source');
    this.cueCache ??= new Map();
    const shown = [], virtual = [];
    for (const t of list) {
      if (!cues || !t.cue?.tracks?.length) { shown.push(t); continue; }
      let v = this.cueCache.get(t.id);
      if (!v || v.image !== t || v.duration !== t.durationMs) {
        v = {image: t, duration: t.durationMs, tracks: this.withUserData(cueTracks(t, trackMetaLabel))};
        this.cueCache.set(t.id, v);
      }
      virtual.push(...v.tracks);
      shown.push(...v.tracks);
      if (showSource) shown.push(t);
    }
    if (virtual.length) shown.sort(compareTracks);
    return {list, virtual, prefs, shown: shown.filter(t => !(minMs && t.durationMs && t.durationMs < minMs) && !(noVideo && t.video))};
  }

  commitTracks({list, shown, virtual}) {
    this.allTracks = list;
    this.tracks = shown;
    this.byId = new Map([...list, ...virtual].map(t => [t.id, t]));
    this.ctx.bus.post('bus_library', 'msg_library_changed', this, {count: this.tracks.length});
    this.warmGroups();
  }

  /**
   * The category views built in idle time (view/idle-work.js), so the first search or category list
   * finds them made: each view's steps (groups.js) run in slices of a few milliseconds.
   */
  warmGroups() {
    if (!globalThis.requestIdleCallback || this._warmQueued) return;
    this._warmQueued = true;
    idleWork(this.ctx, 'groups', [() => this.warmSteps()]).then(() => { this._warmQueued = false; });
  }

  /** Every view for the shown tracks (or tracks still to show: replaceTracks), as steps. */
  *warmSteps(tracks = this.tracks) {
    for (const k of WARM_KINDS) yield* this.groupedSteps(k, tracks);
  }

  /** Media URL for a track (object URL over the stored file). */
  async mediaUrl(t) {
    if (t.src) return t.src;
    // A CUE track plays a range of its disc image.
    if (t.cueOf) { const image = this.byId.get(t.cueOf); return image ? this.mediaUrl(image) : null; }
    let url = this.fileUrls.get(t.id);
    if (!url) {
      const file = await this.db?.file(t.id);
      if (!file) return null;
      url = URL.createObjectURL(file);
      this.fileUrls.set(t.id, url);
    }
    return url;
  }

  /** Custom art keys: the album (album + album artist) and the track. */
  artKeys(t) {
    return {album: 'a:' + (t.album || '') + '\0' + (t.albumArtist || t.artist || ''), track: 't:' + t.id};
  }

  /** A picked image for the track (its own, else its album's), as a loaded cover. */
  customArtFor(t) {
    const {album, track} = this.artKeys(t);
    const key = this.customArt.has(track) ? track : t.album && this.customArt.has(album) ? album : null;
    if (!key) return null;
    let p = this.artCache.get('ca:' + key);
    if (!p) this.artCache.set('ca:' + key, p = loadArt(this.customArt.get(key)));
    return p;
  }

  /** Sets (blob) or removes (null) a picked cover for a track or its whole album. */
  async setCustomArt(t, blob, forAlbum) {
    const {album, track} = this.artKeys(t);
    const key = forAlbum ? album : track;
    const old = this.artCache.get('ca:' + key);
    this.artCache.delete('ca:' + key);
    old?.then(a => a?.url && URL.revokeObjectURL(a.url));
    if (blob) { this.customArt.set(key, blob); await this.db?.setState('ca:' + key, blob).catch(() => {}); }
    else { this.customArt.delete(key); await this.db?.deleteState?.('ca:' + key).catch(() => {}); }
    const changed = forAlbum ? this.tracks.filter(x => this.artKeys(x).album === album) : [t];
    if (!changed.includes(t)) changed.push(t);
    for (const x of changed) { x.art = null; x.thumb = null; }
    this.ctx.bus.post('bus_data', 'msg_data_art_changed', this, {tracks: changed});
  }

  /** Every track shows its art again (after a cache clear or aa_force_default). */
  refreshArt() {
    for (const map of [this.artCache, this.thumbCache]) {
      for (const e of map.values()) Promise.resolve(e?.p ?? e).then(a => { if (a?.url?.startsWith('blob:')) URL.revokeObjectURL(a.url); }, () => {});
      map.clear();
    }
    for (const x of this.tracks) { x.art = null; x.thumb = null; }
    const t = this.ctx.player?.track;
    if (t && !this.tracks.includes(t)) { t.art = null; t.thumb = null; }
    this.ctx.bus.post('bus_data', 'msg_data_art_changed', this, {tracks: t ? [...this.tracks, t] : this.tracks});
  }

  /** clear_aa_cache: deletes the downloaded cover and thumbnail caches. */
  async clearArtCache() {
    if (globalThis.caches) await Promise.all([caches.delete(COVERS), caches.delete(THUMBS)]).catch(() => {});
    this.refreshArt();
  }

  /** Cover {url, width, height} or null (full size). */
  artFor(t) {
    // aa_force_default (c6): the default image instead of any art.
    if (this.ctx.pref?.('aa_force_default')) return Promise.resolve(null);
    if (t.art) return Promise.resolve(t.art);
    const custom = this.customArt.size ? this.customArtFor(t) : null;
    if (custom) return custom;
    if (!t.artId) return Promise.resolve(null);
    if (!isRemoteArt(t.artId)) {
      let p = this.artCache.get(t.artId);
      if (!p) this.artCache.set(t.artId, p = this.db.art(t.artId).then(b => (b ? this.fitted(t, b) : null)));
      return p;
    }
    // The player's cover goes ahead of list thumbnails.
    return this.memo(this.artCache, MEM_FULL, t, 'art', () => this.remoteCover(t.artId, {priority: true}).then(b => {
      if (b === FAILED) throw b;
      return b ? this.fitted(t, b) : null;
    })).catch(e => this.coverMissed(e, t));
  }

  /** A full cover as shown: a wide one with filler sides cut to its square (cover-fit.js), else as it is. */
  async fitted(t, b) {
    const size = await imageSize(b), key = this.coverOf(t.artId);
    if (!size || !isWide(size[0], size[1])) return loadArt(b);
    await decide(key, b, size[0], size[1]);
    // A thumbnail cut from the old whole one meanwhile is made again, sharp, from this cover.
    if (this.softThumbs?.has(key)) later(this.ctx, () => this.sharpThumb(key, b, size));
    const rect = cropRect(key), cut = rect ? await cropBlob(b, rect, size[0], size[1], FIT_PX) : null;
    return loadArt(cut ?? b);
  }

  /**
   * A thumbnail as shown, from the whole one kept (`whole`; `full`: the cover it was just made from). A wide cover
   * shown as its square takes the square's own thumbnail (cropKey), made from the full cover: sharp, 256 px of
   * the centre. One made before covers were cut has no such thumbnail: the whole one is cut for now, and the
   * square's is made in idle time from the full cover on the phone (claude-player-covers), or, when there is
   * none, once the cover is next read anyway (fitted); nothing is downloaded for it.
   */
  async fittedThumb(t, ck, whole, store, full = null) {
    const size = await imageSize(whole), key = this.coverOf(t.artId);
    if (!size || !isWide(size[0], size[1])) return loadArt(whole);
    const fs = full ? await imageSize(full) : null;
    await decide(key, full && fs ? full : whole, ...(full && fs ? fs : size));
    const rect = cropRect(key);
    if (!rect) return loadArt(whole);
    const kept = await store?.match(cropKey(ck)).catch(() => null);
    if (kept && kept.headers.get('x-cover-crop') === packRect(rect).join()) return loadArt(await kept.blob());
    if (full && fs) return loadArt(await this.putSharp(store, ck, rect, full, fs) ?? whole);
    (this.softThumbs ??= new Map()).set(key, ck);
    later(this.ctx, async () => {
      const covers = globalThis.caches ? await caches.open(COVERS).catch(() => null) : null;
      const hit = (await covers?.match(cacheKey(key)).catch(() => null)) ?? (await covers?.match(cacheKey(t.artId)).catch(() => null));
      const b = hit && !hit.headers.get('x-cover-none') ? await hit.blob() : null, bs = b ? await imageSize(b) : null;
      if (bs) await this.sharpThumb(key, b, bs);
    });
    return loadArt(await cropBlob(whole, rect, size[0], size[1], THUMB_PX) ?? whole);
  }

  /** The square's thumbnail made from a full cover and kept (tagged with the square); the blob, or null. */
  async putSharp(store, ck, rect, full, fs) {
    const blob = await cropBlob(full, rect, fs[0], fs[1], THUMB_PX);
    if (blob) store?.put(cropKey(ck), new Response(blob, {headers: {'content-type': 'image/jpeg', 'x-cover-crop': packRect(rect).join()}})).catch(() => {});
    return blob;
  }

  /** A cut-for-now thumbnail made again from the full cover, and swapped in for the songs showing it. */
  async sharpThumb(key, full, fs) {
    const ck = this.softThumbs?.get(key), rect = cropRect(key);
    if (!ck || !rect) return;
    this.softThumbs.delete(key);
    const store = globalThis.caches ? await caches.open(THUMBS).catch(() => null) : null;
    const blob = await this.putSharp(store, ck, rect, full, fs), e = this.thumbCache.get(key);
    if (!blob || !e) return;
    const art = await loadArt(blob), old = e.p;
    e.p = Promise.resolve(art);
    old.then(a => { if (a?.url?.startsWith('blob:')) URL.revokeObjectURL(a.url); }, () => {});
    for (const o of e.owners) o.thumb = art;
    this.ctx.bus?.post('bus_data', 'msg_data_art_changed', this, {tracks: [...e.owners]});
  }

  /** The covers shown again after the owner's pick for them changed (cover-fit.js): their songs rebind. */
  refreshCovers(keys) {
    for (const map of [this.artCache, this.thumbCache]) for (const k of keys) {
      const e = map.get(k);
      if (!e) continue;
      map.delete(k);
      Promise.resolve(e?.p ?? e).then(a => { if (a?.url?.startsWith('blob:')) URL.revokeObjectURL(a.url); }, () => {});
    }
    const p = this.ctx.player?.track, all = p && !this.tracks.includes(p) ? [...this.tracks, p] : this.tracks;
    const tracks = all.filter(x => x.artId && keys.has(this.coverOf(x.artId)));
    for (const x of tracks) { x.art = null; x.thumb = null; }
    if (tracks.length) this.ctx.bus.post('bus_data', 'msg_data_art_changed', this, {tracks});
  }

  /** The identity a cover is cached and read by: the bucket cover's own (shared by its songs), else the song's address. */
  coverOf(artId) {
    return this.coverIds?.get(artId) ?? artId;
  }

  /** A cover that could not be read now: null, and the song is told when it is asked again (coverAgain). */
  coverMissed(e, t) {
    if (e === FAILED) this.coverFails?.get(cacheKey(this.coverOf(t.artId)))?.owners.add(t);
    return null;
  }

  /**
   * A cover that did not arrive (a network failure or a refusal, never a 404): nothing remembers it.
   * It is asked again after 2 s, 8 s and 30 s, then at a bind 30 s on, or at once when the phone is back online.
   */
  coverFailed(ck) {
    this.coverFails ??= new Map();
    const f = this.coverFails.get(ck) ?? {n: 0, owners: new Set()};
    this.coverFails.set(ck, f);
    const wait = RETRY_MS[Math.min(f.n, RETRY_MS.length - 1)];
    f.at = Date.now() + wait;
    clearTimeout(f.timer);
    if (++f.n <= RETRY_MS.length) f.timer = setTimeout(() => this.coverAgain(ck), wait);
    if (!this.coverOnline) {
      this.coverOnline = true;
      globalThis.addEventListener?.('online', () => { for (const k of this.coverFails.keys()) this.coverAgain(k); });
    }
  }

  /** A cover's songs ask for it again (their items and the player rebind on msg_data_art_changed). */
  coverAgain(ck) {
    const f = this.coverFails?.get(ck);
    // Signed out, its songs wait for the session (coversAgain).
    if (!f || this.ctx.access?.state === 'signin') return;
    clearTimeout(f.timer);
    f.at = 0;
    const tracks = [...f.owners];
    f.owners.clear();
    if (tracks.length) this.ctx.bus?.post('bus_data', 'msg_data_art_changed', this, {tracks});
  }

  /** Every cover that could not be read asks again (the session is back: access.js). */
  coversAgain() {
    for (const ck of this.coverFails?.keys() ?? []) this.coverAgain(ck);
  }

  /**
   * Small cover for list rows: a cached 256 px thumbnail of a remote cover.
   * wanted() is asked before any download (rows scrolled past skip it).
   */
  thumbFor(t, wanted = null) {
    if (this.ctx.pref?.('aa_force_default')) return Promise.resolve(null);
    if (this.customArt.size && this.customArtFor(t)) return this.artFor(t);
    if (!t.artId || !isRemoteArt(t.artId)) return this.artFor(t);
    if (t.thumb) return Promise.resolve(t.thumb);
    const key = t.artId, ck = cacheKey(this.coverOf(key)), old = cacheKey(key);
    // A skipped row or a failed read is not remembered (memo): it loads when shown again, or when asked again (coverAgain).
    return this.memo(this.thumbCache, MEM_THUMB, t, 'thumb', async () => {
      const store = globalThis.caches ? await caches.open(THUMBS).catch(() => null) : null;
      let hit = await store?.match(ck).catch(() => null);
      // One kept under the song's own address (before songs shared their cover) is found there, and kept under the cover's.
      if (!hit && old !== ck && (hit = await store?.match(old).catch(() => null))) store.put(ck, hit.clone()).catch(() => {});
      if (hit) return hit.headers.get('x-cover-none') ? null : this.fittedThumb(t, ck, await hit.blob(), store);
      const full = await this.remoteCover(key, {wanted});
      if (full === SKIPPED || full === FAILED) throw full;
      if (!full) return null;
      const blob = await makeThumb(full) ?? full;
      store?.put(ck, new Response(blob, {headers: {'content-type': blob.type || 'image/jpeg'}})).catch(() => {});
      return this.fittedThumb(t, ck, blob, store, full);
    }).catch(e => this.coverMissed(e, t));
  }

  /**
   * In-memory LRU of object-URL images keyed by cover (coverOf): an evicted entry
   * revokes its URL and clears the field on the records that used it. A read that
   * fails (rejects) leaves it at once.
   */
  memo(map, cap, t, field, make) {
    const key = this.coverOf(t.artId);
    let e = map.get(key);
    if (e) { map.delete(key); map.set(key, e); }
    else {
      e = {p: make(), owners: new Set()};
      const made = e;
      made.p.catch(() => { if (map.get(key) === made) map.delete(key); });
      map.set(key, made);
      while (map.size > cap) {
        const [k, old] = map.entries().next().value;
        map.delete(k);
        old.p.then(a => { if (a?.url?.startsWith('blob:')) URL.revokeObjectURL(a.url); }, () => {});
        for (const o of old.owners) if (o[field]) o[field] = null;
      }
    }
    e.owners.add(t);
    return e.p;
  }

  /**
   * A remote cover's bytes: Cache Storage first (including "no cover"
   * markers), else the network through the download slots, then cached.
   * Worker covers are images; "embedded:<id>" covers come from the audio
   * file's own tags with range requests. Kept and read once per cover
   * (coverOf), though addressed by a song; FAILED: not now (coverFailed).
   */
  async remoteCover(key, {priority = false, wanted = null} = {}) {
    const store = globalThis.caches ? await caches.open(COVERS).catch(() => null) : null;
    const ck = cacheKey(this.coverOf(key)), old = cacheKey(key);
    // (One kept under the song's own address, before songs shared their cover, is found there.)
    const hit = (await store?.match(ck).catch(() => null)) ?? (old !== ck ? await store?.match(old).catch(() => null) : null);
    if (hit) return hit.headers.get('x-cover-none') ? null : hit.blob();
    // A cover that failed lately is not asked for again before its time.
    if (Date.now() < (this.coverFails?.get(ck)?.at ?? 0)) return FAILED;
    // Signed out (access.js): nothing goes out; the session back asks again (coversAgain).
    if (this.ctx.access?.state === 'signin') {
      this.coverFails ??= new Map();
      if (!this.coverFails.has(ck)) this.coverFails.set(ck, {n: 0, at: 0, owners: new Set()});
      return FAILED;
    }
    if (wanted) {
      await new Promise(r => setTimeout(r, ROW_SETTLE_MS));
      if (!wanted()) return SKIPPED;
    }
    // One read of a cover at a time (the player's cover and its row's thumbnail asked for the same file's bytes twice;
    // an album's songs share one). The player's cover joining a grid read that waits makes it go at once (hurry).
    this.coverReads ??= new Map();
    const reading = this.coverReads.get(ck);
    if (reading) {
      if (priority) reading.hurry();
      const r = await reading.job;
      if (r !== SKIPPED) return r;
    }
    let hurry;
    const hurried = new Promise(r => { hurry = r; });
    const read = {job: this.readCover(key, ck, store, priority, wanted, hurried), hurry};
    this.coverReads.set(ck, read);
    try {
      const r = await read.job;
      if (r === FAILED) this.coverFailed(ck);
      // Read at last: the songs that were told "not now" ask again (from the cache).
      else if (r !== SKIPPED && this.coverFails?.has(ck)) { this.coverAgain(ck); this.coverFails.delete(ck); }
      return r;
    } finally {
      if (this.coverReads.get(ck) === read) this.coverReads.delete(ck);
    }
  }

  async readCover(key, ck, store, priority, wanted, hurried) {
    // A read of the same cover that ended after this caller looked has kept it (it keeps before it leaves coverReads).
    const kept = await store?.match(ck).catch(() => null);
    if (kept) return kept.headers.get('x-cover-none') ? null : kept.blob();
    // The player's cover (priority, or hurried: it joined this read) is one small request: no wait, no queue.
    let urgent = priority;
    const hurry = hurried.then(() => { urgent = true; return HURRY; });
    const want = () => urgent || !wanted || wanted();
    let release = null, low = {};
    if (!urgent) {
      // Grid covers: the playing song's stream first (Player.linkFree), before taking a slot: up to 3 s, or until it
      // pauses or has 10 s ahead. Past that (a link that never gets so far) they load one at a time, at low priority.
      const free = (await Promise.race([this.ctx.player?.linkFree?.(), hurry])) !== false;
      if (!want()) return SKIPPED;
      if (!urgent) {
        const slot = free ? this.coverSlot(wanted) : this.lowSlot();
        release = await Promise.race([slot, hurry]);
        if (release === HURRY) { slot.then(r => r?.()); release = null; }
        else if (!release) return SKIPPED;
        else if (!free) low = {priority: 'low'};
      }
    }
    try {
      if (!want()) return SKIPPED;
      // Signed out while it waited: not now (asked again once the session is back).
      if (this.ctx.access?.state === 'signin') return FAILED;
      let blob = null;
      if (key.startsWith('embedded:')) {
        const t = this.byId.get(key.slice(9));
        const pic = t?.src ? await readRemotePicture(t.src, low) : null;
        blob = pic ? new Blob([pic.bytes], {type: pic.mime || 'image/jpeg'}) : null;
      } else {
        const r = await fetch(key, {mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', ...low});
        if (r.ok) blob = await r.blob();
        else if (r.status !== 404) return FAILED; // asked again later (coverFailed); a 404 is final
      }
      if (store) {
        const res = blob ? new Response(blob, {headers: {'content-type': blob.type || 'image/jpeg'}}) : new Response('', {headers: {'x-cover-none': '1'}});
        await store.put(ck, res).catch(() => {});
        if (++this.coverPuts % 50 === 0) this.pruneCovers(store);
      }
      return blob;
    } catch {
      return FAILED;
    } finally {
      release?.();
    }
  }

  /** The one low-priority slot: grid covers read while the playing song is short of its stream, one at a time. */
  lowSlot() {
    const prev = this.lowTail ?? Promise.resolve();
    let free;
    this.lowTail = new Promise(r => { free = r; });
    return prev.then(() => free);
  }

  /** Download slots for grid covers (COVER_SLOTS at once), in turn (the player's cover takes none). */
  coverSlot(wanted) {
    this.slotWaiters ??= [];
    this.slotsBusy ??= 0;
    if (this.slotsBusy < COVER_SLOTS) {
      this.slotsBusy++;
      return Promise.resolve(() => this.freeSlot());
    }
    return new Promise(resolve => this.slotWaiters.push({resolve, wanted}));
  }

  freeSlot() {
    // Hand the slot to the next waiter that still wants it.
    while (this.slotWaiters.length) {
      const w = this.slotWaiters.shift();
      if (w.wanted && !w.wanted()) { w.resolve(null); continue; }
      w.resolve(() => this.freeSlot());
      return;
    }
    this.slotsBusy--;
  }

  async pruneCovers(store) {
    const keys = await store.keys().catch(() => []);
    for (let i = 0; i < keys.length - COVER_CAP; i++) await store.delete(keys[i]).catch(() => {});
  }

  /**
   * Waveform for the seek bar, the reference's way (waveform.js): a library
   * track's served loudness bins, or its older peak bars until they are
   * replaced; an imported file or CUE track measured here. Cached in the
   * track record. One request per track at a time.
   */
  waveFor(t, bars = 100) {
    if (this.ensureWave(t)) return Promise.resolve(t.wave);
    this.waveJobs ??= new Map();
    let job = this.waveJobs.get(t.id);
    if (!job) {
      job = (t.waveB64 === true ? this.loadWave(t) : this.measureWave(t, bars)).finally(() => this.waveJobs.delete(t.id));
      this.waveJobs.set(t.id, job);
    }
    return job;
  }

  async measureWave(t, bars) {
    if (t.cueOf) return this.cueWave(t, bars);
    if (!this.byId.has(t.id)) return null;
    // Remote tracks only use pre-generated waveforms (a small file on R2):
    // decoding would download the whole song.
    if (t.remote) {
      if (!t.waveUrl) return null;
      // The song's own download competes on a slow line: tries again twice.
      let w = null;
      for (const wait of [0, 2000, 6000]) {
        if (wait) await new Promise(r => setTimeout(r, wait));
        w = await fetchWaveform(t.waveUrl);
        if (w) break;
      }
      if (!w || w.missing) {
        // A snapshot from an older index can point at waveform files the
        // current one no longer has: the index is fetched again once a
        // session; the player then takes the new records (adoptRecords).
        if (w?.missing && !this.waveRefresh) this.waveRefresh = this.refreshR2({force: true});
        return null;
      }
      const rms = t.waveKind === 'rms' && !w.durationMs;
      if (rms) t.wave = barsFromMeanSquares(rmsBytesToMeanSquares(w.peaks), bars);
      else t.wave = loudnessFromPeaks(w.durationMs ? peaksToBars(w.peaks, bars) : Array.from(w.peaks, x => x / 255));
      // A cut-decode waveform is drawn but not kept: the next session asks again, until it is measured again.
      t.waveSrc = rms && waveSteps(w.peaks) < MIN_WAVE_STEPS ? undefined : waveSrcFor(t);
      await this.saveTrack(t);
      return t.wave;
    }
    const p = await this.fileMeanSquares(t.id);
    if (!p) return null;
    t.wave = barsFromMeanSquares(p.ms, bars);
    await this.saveTrack(t);
    return t.wave;
  }

  /** Waveforms ahead of time (the next song's): fetched quietly, kept with the track. */
  prefetchWave(t) {
    if (t && t.remote && (t.waveUrl || t.waveB64 === true) && !t.wave && this.byId.has(t.id)) this.waveFor(t).catch(() => {});
  }

  /**
   * An imported file's peaks: the decoded audio (8 kHz) in bars(durationMs)
   * equal slices, each its largest sample over the channels; null when it
   * cannot be decoded.
   */
  async fileMeanSquares(id) {
    const file = await this.db?.file(id);
    if (!file || typeof OfflineAudioContext !== 'function') return null;
    try {
      const buf = await file.arrayBuffer();
      const ac = new OfflineAudioContext(1, 8000, 8000);
      const audio = await ac.decodeAudioData(buf);
      // Ten blocks a second (a CUE track takes its range of them).
      const n = audio.length, chans = audio.numberOfChannels, count = Math.max(1, Math.ceil(audio.duration * 10));
      const data = [];
      for (let c = 0; c < chans; c++) data.push(audio.getChannelData(c));
      const out = new Array(count).fill(0);
      for (let b = 0; b < count; b++) {
        const s0 = Math.floor((b * n) / count), s1 = Math.floor(((b + 1) * n) / count);
        let sum = 0;
        for (let c = 0; c < chans; c++) {
          const d = data[c];
          for (let i = s0; i < s1; i++) sum += d[i] * d[i];
        }
        out[b] = s1 > s0 ? sum / ((s1 - s0) * chans) : 0;
      }
      return {ms: out, durationMs: audio.duration * 1000};
    } catch (e) {
      console.warn('[claude-player] waveform', e);
      return null;
    }
  }

  /**
   * A CUE track's waveform (F77): its range of the disc image's peaks (the
   * image decoded once per session at 10 slices a second), in bars slices,
   * normalised like a file's. Inferred: the reference analyses natively.
   */
  async cueWave(t, bars) {
    const image = this.byId.get(t.cueOf);
    if (!image || image.remote) return null;
    this.cuePeaks ??= new Map();
    let p = this.cuePeaks.get(image.id);
    if (!p) { p = this.fileMeanSquares(image.id); this.cuePeaks.set(image.id, p); }
    const fine = await p;
    if (!fine?.ms.length) return null;
    const per = fine.durationMs / fine.ms.length, n = fine.ms.length;
    const a = Math.max(0, Math.min(n - 1, Math.floor((t.startMs || 0) / per)));
    const end = t.endMs ?? fine.durationMs;
    const b = Math.max(a + 1, Math.min(n, Math.ceil(end / per)));
    t.wave = barsFromMeanSquares(fine.ms.slice(a, b), bars);
    return t.wave;
  }

  /** Track rating 0..5 (like 5, unlike 1); items follow msg_data_track_rating_changed. */
  setRating(t0, rating) {
    const t = this.byId.get(t0.id) ?? t0;
    t.rating = Math.max(0, Math.min(5, rating | 0));
    if (t0 !== t) t0.rating = t.rating;
    if (this.byId.has(t.id)) this.saveTrack(t);
    this.ctx.bus.post('bus_data', 'msg_data_track_rating_changed', this, {track: t, arg1: t.rating});
  }

  /** A completed play (played_dur of the track): count and time. */
  markPlayed(t0) {
    const t = this.byId.get(t0.id) ?? t0;
    t.plays = (t.plays ?? 0) + 1;
    t.lastPlayed = Date.now();
    if (this.byId.has(t.id)) this.saveTrack(t);
    this.ctx.bus.post('bus_data', 'msg_data_track_played', this, {track: t});
  }

  /**
   * A song's decoded peak (linear) measured while it plays (the engine's input meter): the phone keeps
   * the larger of what it kept and what it measured, with the song's plays; it trims the song from its
   * next start (dsp/trim.js). Saved at most once per 2 s per song, the last growth included.
   */
  notePeak(t0, peak) {
    const t = this.byId.get(t0?.id) ?? t0;
    if (!t || !(peak > (t.decodedPeak ?? 0))) return;
    t.decodedPeak = Math.ceil(peak * 1e4) / 1e4;
    if (t0 !== t) t0.decodedPeak = t.decodedPeak;
    if (!this.byId.has(t.id)) return;
    this.peakSaves ??= new Map();
    if (!this.peakSaves.has(t.id)) this.peakSaves.set(t.id, setTimeout(() => { this.peakSaves.delete(t.id); this.saveTrack(t); }, 2000));
  }

  /** Settings → Reset stats (hs.H): every track's played times and last played go to zero. */
  async resetStats() {
    for (const t of this.tracks) {
      if (!t.plays && !t.lastPlayed) continue;
      t.plays = 0;
      t.lastPlayed = 0;
      await this.saveTrack(t);
    }
    this.ctx.bus.post('bus_app', 'msg_app_data_changed', this);
    this.ctx.bus.post('bus_data', 'msg_data_track_played', this, {});
  }

  /** The last position of a track (folder_files.last_pos), kept when leaving it. */
  rememberPosition(t0, ms) {
    const t = this.byId.get(t0.id) ?? t0;
    if ((t.lastPos ?? 0) === ms) return;
    t.lastPos = ms;
    if (t0 !== t) t0.lastPos = ms;
    if (this.byId.has(t.id)) this.saveTrack(t);
  }

  async rememberDuration(t, ms) {
    if (!ms || t.durationMs === ms || !this.byId.has(t.id)) return;
    t.durationMs = ms;
    await this.saveTrack(t);
  }

  // Category views (Poweramp library categories; the scanner's tables, zj /
  // mg1). Names match case-insensitively, the first spelling shows; an empty
  // tag is the unknown entry. Albums are keyed by album and album artist;
  // join_albums moves a track without an album artist into the album of the
  // same name whose album artist is the track's artist.
  /**
   * A category view built once for the shown tracks and the preferences that
   * shape it (search and the category lists ask for them on every change;
   * the reference reads its tables). Callers copy before sorting.
   */
  grouped(name) {
    return run(this.groupedSteps(name));
  }

  /** The preferences that shape the views, as one key. */
  groupKey() {
    const p = k => String(this.ctx.pref?.(k) ?? '');
    return GROUP_PREFS.map(p).join('\u0002');
  }

  /**
   * grouped() as steps (groups.js): the view kept for these tracks, else built step by step and kept
   * when the preferences did not change meanwhile. Two lists' views are kept (the shown one's and one
   * built ahead for a refreshed library before it shows: replaceTracks).
   */
  *groupedSteps(name, tracks = this.tracks) {
    const key = this.groupKey(), kept = (this._grouped ??= new Map()).get(name) ?? [];
    const c = kept.find(e => e.tracks === tracks && e.key === key);
    if (c) return c.value;
    const value = yield* this.groupSteps(name, tracks);
    if (key === this.groupKey()) {
      const now = (this._grouped.get(name) ?? []).filter(e => e.tracks !== tracks && (e.tracks === this.tracks || e.tracks === this._nextTracks));
      this._grouped.set(name, [...now.slice(-1), {tracks, key, value}]);
    }
    return value;
  }

  groupSteps(name, tracks) {
    switch (name) {
      case 'albums': return albumSteps(this, tracks);
      case 'artists': return namedSteps(this, tracks, 'artist', 'artist', 'unknown_artist_name', 'Unknown artist');
      case 'shelves': return this.shelvesSteps(tracks);
      case 'albumArtists': return albumArtistSteps(this, tracks);
      case 'composers': return namedSteps(this, tracks, 'composer', 'composer', 'unknown_composer_name', 'Unknown composer');
      case 'genres': return namedSteps(this, tracks, 'genre', 'genre', 'unknown_genre_name', 'Unknown genre');
      case 'folders': return folderSteps(tracks);
      default: throw new Error('no view ' + name);
    }
  }

  albums() {
    return this.grouped('albums');
  }

  buildAlbums() {
    return run(albumSteps(this, this.tracks));
  }

  /** The split symbols in effect (artists / album artists, composers, genres). */
  splitters() {
    const p = k => this.ctx.pref?.(k);
    const key = [p('artists_split_chars'), p('artists_split_ignore'), p('composers_split_chars'), p('genres_split_chars')].join('\u0002');
    if (this._splitKey !== key) {
      this._splitKey = key;
      const artists = makeSplitter(p('artists_split_chars'), p('artists_split_ignore'));
      this._split = {artist: artists, albumArtist: artists, composer: makeSplitter(p('composers_split_chars')), genre: makeSplitter(p('genres_split_chars') || GENRE_DEFAULT_SPLIT)};
    }
    return this._split;
  }

  /**
   * A track's names in a category: the split parts (genres from one part,
   * the others from two), plus the whole value as an unsplit entry for
   * show_unsplit_cats.
   */
  namesOf(t, field, splitters = this.splitters()) {
    const v = t[field] || '';
    if (!v) return {names: [''], unsplit: null};
    const split = splitters[field];
    const parts = split ? split(v) : [v];
    const min = field === 'genre' ? 1 : 2;
    if (parts.length < min) return {names: [v], unsplit: null};
    return {names: parts, unsplit: parts.length >= 2 ? v : null};
  }

  /** Artists, album artists, composers or genres as groups of tracks. */
  namedGroups(field, kind, unknownName, unknownFallback) {
    return run(namedSteps(this, this.tracks, field, kind, unknownName, unknownFallback));
  }

  artists() {
    return this.grouped('artists');
  }

  /** Albums, Singles, Artists and Possible duplicates as the library lists show them (shelves.js). */
  shelves() {
    return this.grouped('shelves');
  }

  *shelvesSteps(tracks) {
    const albumGroups = yield* this.groupedSteps('albums', tracks), artistGroups = yield* this.groupedSteps('artists', tracks);
    return yield* shelfSteps({albumGroups, artistGroups, names: s => this.namesOf({albumArtist: s}, 'albumArtist').names});
  }

  albumArtists() {
    return this.grouped('albumArtists');
  }

  buildAlbumArtists() {
    return run(albumArtistSteps(this, this.tracks));
  }

  composers() {
    return this.grouped('composers');
  }

  genres() {
    return this.grouped('genres');
  }

  /**
   * Folders Hierarchy (the folders table with parent_id, hier_num_files and
   * hier_duration; cg1.a1): every track folder and its parents under the
   * root '' (folders: subfolders by name, files: the folder's tracks).
   */
  folderTree() {
    if (this._tree?.tracks === this.tracks) return this._tree;
    const nodes = new Map();
    const node = path => {
      let n = nodes.get(path);
      if (n) return n;
      const cut = path.lastIndexOf('/');
      n = {path, name: path.slice(cut + 1) || path, parent: null, folders: [], files: [], hierFiles: 0, hierMs: 0};
      nodes.set(path, n);
      if (path) { n.parent = node(cut < 0 ? '' : path.slice(0, cut)); n.parent.folders.push(n); }
      return n;
    };
    const root = node('');
    for (const t of this.tracks) node((t.folder || '').replace(/\/+$/, '')).files.push(t);
    const byPath = (a, b) => PATHS.compare(a.path, b.path);
    const sum = n => {
      n.folders.sort(byPath);
      n.hierFiles = n.files.length;
      n.hierMs = n.files.reduce((s, t) => s + (t.durationMs || 0), 0);
      for (const c of n.folders) { sum(c); n.hierFiles += c.hierFiles; n.hierMs += c.hierMs; }
    };
    sum(root);
    // Folders with files in sort_path order (the hierarchy's category order).
    const withFiles = [];
    const walk = n => { if (n.files.length) withFiles.push(n); n.folders.forEach(walk); };
    walk(root);
    this._tree = {tracks: this.tracks, root, nodes, withFiles};
    return this._tree;
  }

  /**
   * The hierarchy's top (root_hier_immediate, cg1.a1): with one root folder
   * its contents show at once, going deeper (8 levels at most) until a
   * folder with tracks or several subfolders.
   */
  hierRoot() {
    let n = this.folderTree().root;
    if (!this.ctx.pref?.('root_hier_immediate')) return n;
    for (let i = 0; i < 8 && n.folders.length === 1 && !n.files.length; i++) {
      n = n.folders[0];
      if (n.files.length || n.folders.length > 1) break;
    }
    return n;
  }

  folders() {
    return this.grouped('folders');
  }

  buildFolders() {
    return run(folderSteps(this.tracks));
  }
}

// Preferences that shape the category views (grouped).
const WARM_KINDS = ['albums', 'artists', 'shelves', 'albumArtists', 'genres', 'composers', 'folders'];
const GROUP_PREFS = ['join_albums', 'show_unsplit_cats', 'artists_split_chars', 'artists_split_ignore', 'composers_split_chars', 'genres_split_chars'];

// A refreshed library of this many shown songs or more builds its views ahead, in idle slices (replaceTracks).
const PREPARE_MIN = 2000;

/**
 * list.sort(compareTracks), in place, as fast as the order allows: the songs are laid out in the order
 * they had (prev, the last sorted list, by id; new ones after) and sorted from there with ties kept in
 * list's own order, so the result is the plain stable sort's while the engine's sort, finding the songs
 * nearly in order, compares each about once. The snapshot keeps the sorted order too (snapshot.js).
 */
export function sortTracks(list, prev = []) {
  if (list.length < 2) return list;
  const at = new Map();
  list.forEach((t, i) => at.set(t, i));
  let laid = list;
  if (prev.length && prev !== list) {
    const pos = new Map(), slots = new Array(prev.length), rest = [];
    prev.forEach((t, i) => pos.set(t.id, i));
    for (const t of list) {
      const p = pos.get(t.id);
      if (p !== undefined && slots[p] === undefined) slots[p] = t;
      else rest.push(t);
    }
    laid = [];
    for (const t of slots) if (t !== undefined) laid.push(t);
    for (const t of rest) laid.push(t);
  } else laid = list.slice();
  laid.sort((a, b) => compareTracks(a, b) || at.get(a) - at.get(b));
  for (let i = 0; i < laid.length; i++) list[i] = laid[i];
  return list;
}

export function compareTracks(a, b) {
  return PLAIN.compare(a.albumArtist || a.artist || '', b.albumArtist || b.artist || '') || PLAIN.compare(a.album || '', b.album || '') || (a.disc - b.disc) || (a.track - b.track) || PLAIN.compare(a.title, b.title);
}

/** How a served waveform was drawn (stored with the track; another means fetch it again). */
// 'rms2': rms waveforms stored before cut decodes were refused are fetched again.
// A stored waveform's source: its kind, and the catalog's time for it (waveAt), so one made again is fetched again.
const waveSrcFor = t => (t.waveKind === 'rms' ? 'rms2' : 'peak2') + (t.waveAt ? ':' + t.waveAt : '');

/** Provisional format line ("FLAC 44.1kHz 16bit"); the reference formatter is not ported yet. */
export function trackMetaLabel(t) {
  const parts = [];
  if (t.format) parts.push(t.format);
  if (t.sampleRate) parts.push((t.sampleRate / 1000).toString().replace(/\.0$/, '') + 'kHz');
  if (t.bits) parts.push(t.bits + 'bit');
  else if (t.bitrate) parts.push(t.bitrate + 'kbps');
  return parts.join(' ');
}

/**
 * An image's pixel size from its header (PNG, GIF, JPEG, WebP), or null:
 * rows need the size for their fit rule, and decoding a whole image for it
 * costs a decode and an image bitmap per row scrolled in.
 */
export async function imageSize(blob) {
  try {
    const b = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
    const u16 = (i, le = false) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
    const u32 = i => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return [u32(16), u32(20)];
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return [u16(6, true), u16(8, true)];
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === 'VP8 ') return [u16(26, true) & 0x3fff, u16(28, true) & 0x3fff];
      if (kind === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
      if (kind === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
      return null;
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      // Frame header: the first SOFn marker (not DHT C4, JPG C8 or DAC CC).
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [u16(i + 7), u16(i + 5)];
        i += 2 + u16(i + 2);
      }
    }
  } catch { /* unreadable */ }
  return null;
}

/** A 256 px JPEG thumbnail of an image blob, or null when the browser cannot resize. */
async function makeThumb(blob) {
  try {
    // Decoded at the thumbnail size where the header gives the image's size.
    const size = await imageSize(blob);
    let bmp, w, h;
    if (size && size[0] > 0 && size[1] > 0) {
      const k = Math.min(1, THUMB_PX / Math.max(size[0], size[1]));
      w = Math.max(1, Math.round(size[0] * k)); h = Math.max(1, Math.round(size[1] * k));
      bmp = await createImageBitmap(blob, k < 1 ? {resizeWidth: w, resizeHeight: h, resizeQuality: 'high'} : undefined);
    } else {
      bmp = await createImageBitmap(blob);
      const k = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
      w = Math.max(1, Math.round(bmp.width * k)); h = Math.max(1, Math.round(bmp.height * k));
    }
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), {width: w, height: h});
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return canvas.convertToBlob ? await canvas.convertToBlob({type: 'image/jpeg', quality: 0.85}) : await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  } catch {
    return null;
  }
}

async function loadArt(blob) {
  const url = URL.createObjectURL(blob);
  const size = await imageSize(blob);
  if (size && size[0] > 0 && size[1] > 0) return {url, width: size[0], height: size[1]};
  try {
    const bmp = await createImageBitmap(blob);
    const art = {url, width: bmp.width, height: bmp.height};
    bmp.close?.();
    return art;
  } catch {
    return {url, width: 1, height: 1};
  }
}
