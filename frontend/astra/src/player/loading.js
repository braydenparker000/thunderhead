// What the player says while it waits or after it stops: the loading screen
// (how long, how much has arrived, and a way out when it drags on), the error
// card with what can help, and the short notice across the top.

import {h} from '../ui/dom.js';
import {externalPlayerUrl, canOpenExternally} from './external.js';
import {addressNotice} from './address.js';

export class Loading {
  constructor(p) {
    this.p = p;
    this.timer = 0;
    this.since = null;
  }

  show(on) {
    const p = this.p;
    p.loading.hidden = !on;
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
    this.show(false);
    p.loading.hidden = false;
    p.loadingStatus.textContent = 'Choose a source for this episode.';
    p.loadingSlow.replaceChildren(h('div', {class: 'ap-loading-actions'}, h('button', {class: 'ap-chip primary', type: 'button', onclick: () => p.openPanel('sources')}, 'Sources')));
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
        others ? h('button', {class: 'ap-chip', type: 'button', onclick: () => p.openPanel('sources')}, 'Other sources') : null,
        external ? h('button', {class: 'ap-chip', type: 'button', onclick: () => p.openExternally()}, 'Play in another app') : null) : null);
    p.loadingSlow.hidden = false;
  }

  /** A short message across the top for a few seconds, perhaps with one button ({label, run}); a tap anywhere on it puts it away. */
  notice(text, action = null) {
    const p = this.p;
    text = addressNotice(p.stream?.resolved, text); // Chrome plays the add-on's link: why that link was used (address.js)
    p.noticeEl.replaceChildren(h('span', {}, text), action ? h('button', {class: 'ap-chip ap-notice-action', type: 'button', onclick: action.run}, action.label) : '');
    p.noticeEl.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { p.noticeEl.hidden = true; }, 7000);
  }

  /** The host connection lost and found again: playback goes on from the buffer meanwhile, so this is a notice, not an error. */
  networkState(state) {
    const p = this.p;
    if (state === 'reconnecting') { this.notice('Reconnecting…'); clearTimeout(this.noticeTimer); }
    else if (state === 'connected' && !p.noticeEl.hidden) this.notice('Connected again');
    else if (state === 'lost') p.noticeEl.hidden = true;
  }

  showError(message, plan = null, {network = false} = {}) {
    const p = this.p;
    this.show(false);
    p.noticeEl.hidden = true;
    const report = h('button', {class: 'ap-chip', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(await p.engine.report(), null, 2)); report.textContent = 'Report copied'; } catch { report.textContent = 'Copy failed'; }
    }}, 'Copy report');
    // What can help depends on why it stopped: a lost connection is tried again
    // (from where it stopped), a dead link needs another source, and only a file
    // the browser cannot play is worth another app.
    const connection = network || plan?.retry, gone = !!plan?.gone;
    const external = !connection && !gone && canOpenExternally() && externalPlayerUrl(p.stream?.url);
    const others = p.sources.length > 1, retry = connection || plan?.mode !== 'unsupported';
    const primary = connection ? 'retry' : external ? 'external' : others ? 'sources' : 'retry';
    p.errorCard.replaceChildren(
      h('h3', {}, gone ? 'This link no longer works' : connection ? 'Lost the connection' : plan?.mode === 'unsupported' ? 'Can’t play this here' : 'Playback stopped'), h('p', {}, message),
      external ? h('p', {class: 'ap-error-hint'}, 'Another app on your phone, such as VLC, can play it.') : null,
      h('div', {class: 'ap-error-actions'},
        external ? h('button', {class: 'ap-chip primary', type: 'button', onclick: () => p.openExternally()}, 'Play in another app') : null,
        plan?.silent ? h('button', {class: 'ap-chip', type: 'button', onclick: () => p.load(p.stream, p.resumePoint(), {allowSilent: true})}, 'Play without sound') : null,
        others ? h('button', {class: 'ap-chip' + (primary === 'sources' ? ' primary' : ''), type: 'button', onclick: () => { p.errorCard.hidden = true; p.openPanel('sources'); }}, 'Choose another source') : null,
        retry ? h('button', {class: 'ap-chip' + (primary === 'retry' ? ' primary' : ''), type: 'button', onclick: () => p.load(p.stream, p.resumePoint())}, 'Try again') : null,
        report,
        h('button', {class: 'ap-chip', type: 'button', onclick: () => p.close('user')}, 'Close')));
    p.errorCard.hidden = false;
    p.showControls(false);
  }

  /** Opening or closing: no clock, no notice, no error left from before. */
  close() {
    const p = this.p;
    this.show(false);
    clearTimeout(this.noticeTimer);
    p.noticeEl.hidden = true;
    p.errorCard.hidden = true;
  }
}
