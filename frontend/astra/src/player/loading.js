// What the player says while it waits or after it stops: the loading screen
// (how long, how much has arrived, and a way out when it drags on), how long a
// wait for a slow link has left, in the words over the waiting line, the error
// card with what can help, and the short notice across the top (or, for the
// sleep timer, at the bar's edge). Each comes from somewhere: the loading
// layer fades (passage.js makes the opening's dim), the error card rises into
// place, a notice drops from the top edge or rises from the bar's edge.

import {h} from '../ui/dom.js';
import {T, appear, arrive, leave, ghost} from './feel.js';
import {externalPlayerUrl, canOpenExternally} from './external.js';
import {addressNotice, tryAgain} from './address.js';
import {copyFromPlayer} from './playback-report.js';
import {whenIdle} from '../ui/motion-core.js';

export const WAITING = 'Waiting for the film…';
/** The error card's actions with the filled (primary) one first, where the eye and the thumb land. */
const lead = (...els) => els.filter(Boolean).sort((a, b) => Number(b.classList?.contains('primary') ?? 0) - Number(a.classList?.contains('primary') ?? 0));

export class Loading {
  constructor(p) {
    this.p = p;
    this.timer = 0;
    this.since = null;
    p.engine.addEventListener('rebuffer', e => this.waitFor(e.detail));
    p.engine.addEventListener('notice', e => this.notice(e.detail)); // what the engine finds while it plays (a converter late or refused)
  }

  /**
   * On a link slower than the film the engine waits until enough is read to play a good while (rebuffer.js): when that
   * wait has more than a couple of seconds left, a line under the spinner says how long, and why.
   */
  waitFor({holding, left}) {
    const p = this.p;
    const slow = holding && left != null && left > 2;
    const words = slow ? `The connection is slower than this film. Playing again in ${Math.ceil(left)} s` : WAITING;
    if (p.waitWords.textContent !== words) p.waitWords.textContent = words;
  }

  /**
   * The loading layer on or off. Off, it fades as the picture (or the error card) shows through
   * (passage.js reveal); while the player is closing it is left to passage.js.
   */
  show(on) {
    const p = this.p;
    if (on) arrive(p.loading, {name: 'player:loading'});
    else if (p.isOpen) { leave(p.loading, {name: 'player:loaded', ms: 180}); p.passage.reveal(); }
    if (!on) { clearInterval(this.timer); this.timer = 0; this.since = null; p.loadingSlow.hidden = true; p.loadingInfo.textContent = ''; return; }
    p.loadingStatus.textContent = 'Finding the stream…';
    // A load that takes a while says how long and how much has arrived, then offers a way out.
    this.since ??= performance.now();
    this.timer ||= setInterval(() => this.tick(), 500);
  }

  /**
   * Nothing to load until the viewer picks a source (the next episode had
   * none from the same release): the loading screen says so, without a clock.
   */
  waitForPick() {
    const p = this.p;
    clearInterval(this.timer); this.timer = 0; this.since = null; p.loadingInfo.textContent = '';
    arrive(p.loading);
    p.loadingStatus.textContent = 'Choose a source for this episode.';
    p.loadingSlow.replaceChildren(h('div', {class: 'ap-loading-actions'}, h('button', {class: 'ap-btn primary', type: 'button', onclick: () => p.openPanel('sources')}, 'Sources')));
    p.loadingSlow.hidden = false;
  }

  /** Another source: the slow-load clock counts afresh. */
  restart() {
    if (!this.p.loadingSlow.hidden) { this.since = null; this.p.loadingSlow.hidden = true; }
  }

  tick() {
    const p = this.p;
    const seconds = (performance.now() - this.since) / 1000, bytes = p.engine.source?.bytesFetched || 0;
    p.loadingInfo.textContent = seconds < 5 ? '' : [`${Math.floor(seconds)} s`, bytes ? `${(bytes / 1e6).toFixed(1)} MB received` : ''].filter(Boolean).join(' · ');
    if (seconds * 1000 < p.constructor.SLOW_LOAD_MS || !p.loadingSlow.hidden) return;
    const status = p.loadingStatus.textContent;
    const why = /Resolving/.test(status) ? 'Your server or TorBox is slow to answer.'
      : !bytes ? 'The host has not started sending the file.'
      : 'The host is sending the file slowly.';
    const others = p.sources.some(s => s.id !== p.sourceId);
    const external = canOpenExternally() && externalPlayerUrl(p.stream?.url);
    p.loadingSlow.replaceChildren(h('span', {}, `This is taking a while. ${why}`),
      others || external ? h('div', {class: 'ap-loading-actions'},
        others ? h('button', {class: 'ap-btn', type: 'button', onclick: () => p.openPanel('sources')}, 'Other sources') : null,
        external ? h('button', {class: 'ap-btn', type: 'button', onclick: () => p.openExternally()}, 'Play in another app') : null) : null);
    p.loadingSlow.hidden = false;
    appear(p.loadingSlow, {name: 'player:slow', offset: 'translateY(8px)', ms: T.normal});
  }

  /**
   * A short message for a few seconds, perhaps with one button ({label, run}); a tap anywhere on it
   * puts it away. Across the top, dropping from the top edge; `edge` (the sleep timer): at the bar's
   * edge, rising from it with the spring.
   */
  notice(text, action = null, {edge = false, hold = false} = {}) {
    const p = this.p, n = p.noticeEl;
    text = addressNotice(p.stream?.resolved, text); // Chrome plays the add-on's link: why that link was used (address.js)
    const fresh = n.hidden || n.classList.contains('edge') !== edge;
    n.replaceChildren(h('span', {}, text), action ? h('button', {class: 'ap-chip ap-notice-action', type: 'button', onclick: action.run}, action.label) : '');
    n.classList.toggle('edge', edge);
    n.hidden = false;
    clearTimeout(this.noticeTimer);
    if (fresh) {
      // Never urgent: held unseen until the main thread is free (the film's first picture is busy), then it moves.
      this.cancelNotice?.();
      Object.assign(n.style, {opacity: '0', pointerEvents: 'none'});
      this.cancelNotice = whenIdle(() => {
        this.cancelNotice = null;
        n.style.opacity = ''; n.style.pointerEvents = '';
        if (n.hidden) return;
        appear(n, edge ? {name: 'notice:edge', offset: 'translateY(16px)'} : {name: 'notice:in', offset: 'translateY(-8px)', ms: T.normal, curve: 'snappy'});
        clearTimeout(this.noticeTimer);
        if (!hold) this.noticeTimer = setTimeout(() => this.dropNotice(), 7000);
      }, {timeout: 1500});
    } else if (!hold) this.noticeTimer = setTimeout(() => this.dropNotice(), 7000);
  }

  /** A notice still waiting to be seen is dropped with it. */
  quietNotice() { this.cancelNotice?.(); this.cancelNotice = null; const n = this.p.noticeEl; n.style.opacity = ''; n.style.pointerEvents = ''; }

  /** The notice goes back where it came from (a copy fades; the notice itself is gone at once). */
  dropNotice() {
    const n = this.p.noticeEl;
    if (n.hidden) return;
    if (this.cancelNotice) { this.quietNotice(); n.hidden = true; return; } // never seen: nothing to fade
    ghost(n, {name: 'notice:out', offset: n.classList.contains('edge') ? 'translateY(8px)' : 'translateY(-8px)'});
    n.hidden = true;
  }

  /** The host connection lost and found again: playback goes on from the buffer meanwhile, so this is a notice, not an error. */
  networkState(state) {
    const p = this.p;
    if (state === 'reconnecting') this.notice('Reconnecting…', null, {hold: true}); // stays until connected or lost
    else if (state === 'connected' && !p.noticeEl.hidden) this.notice('Connected again');
    else if (state === 'lost') this.dropNotice();
  }

  showError(message, plan = null, {network = false} = {}) {
    const p = this.p;
    this.show(false);
    p.noticeEl.hidden = true;
    // The playback report in plain words (playback-report.js): no address, hash, key, token or file name in it.
    const report = h('button', {class: 'ap-btn quiet', type: 'button', onclick: async () => { report.textContent = await copyFromPlayer(p) ? 'Report copied' : 'Copy failed'; }}, 'Copy report');
    // What can help depends on why it stopped: a lost connection is tried again
    // (from where it stopped), a dead link needs another source, and only a file
    // the browser cannot play is worth another app.
    const connection = network || plan?.retry, gone = !!plan?.gone;
    const external = !connection && !gone && canOpenExternally() && externalPlayerUrl(p.stream?.url);
    const others = p.sources.length > 1, retry = connection || plan?.mode !== 'unsupported';
    const primary = connection ? 'retry' : external ? 'external' : others ? 'sources' : 'retry';
    p.errorCard.replaceChildren(
      h('h3', {}, gone ? 'This link no longer works' : connection ? 'Lost the connection' : plan?.mode === 'unsupported' ? 'Can’t play this here' : 'Playback stopped'), h('p', {}, message),
      external ? h('p', {class: 'ap-error-hint'}, 'Another app on your phone, such as VLC, can play it.') : '', // '' and not null: replaceChildren would write the word
      h('div', {class: 'ap-error-actions'}, ...lead(
        external ? h('button', {class: 'ap-btn primary', type: 'button', onclick: () => p.openExternally()}, 'Play in another app') : null,
        plan?.silent ? h('button', {class: 'ap-btn', type: 'button', onclick: () => p.load(p.stream, p.resumePoint(), {allowSilent: true})}, 'Play without sound') : null,
        others ? h('button', {class: 'ap-btn' + (primary === 'sources' ? ' primary' : ''), type: 'button', onclick: () => { p.errorCard.hidden = true; p.openPanel('sources'); }}, 'Choose another source') : null,
        retry ? h('button', {class: 'ap-btn' + (primary === 'retry' ? ' primary' : ''), type: 'button', onclick: () => tryAgain(p)}, 'Try again') : null,
        h('div', {class: 'ap-error-quiet'}, report, h('button', {class: 'ap-btn quiet', type: 'button', onclick: () => p.close('user')}, 'Close')))));
    const fresh = p.errorCard.hidden;
    p.errorCard.hidden = false;
    if (fresh) appear(p.errorCard, {name: 'error:in', offset: 'translateY(12px) scale(0.98)'});
    p.showControls(false);
  }

  /** Opening or closing: no clock, no notice, no error left from before. */
  close() {
    const p = this.p;
    this.show(false);
    p.waitWords.textContent = WAITING;
    clearTimeout(this.noticeTimer);
    this.quietNotice();
    p.noticeEl.hidden = true;
    p.errorCard.hidden = true;
  }
}
