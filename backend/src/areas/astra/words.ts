// Every sentence Astra's relay can say (ASTRA.md §5.2): a step's `note` and an error's
// `details.reason` are built from these fixed sentences and numbers only, never from an address, a
// hash, a key, a file name or a host's own words, so nothing the owner watches can reach a reply, a
// log or an error report through them.
import { ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';

/** What one step found, for the page's Stream info. */
export const NOTE = {
  noKey: 'No TorBox key is set on your server.',
  noHash: 'The stream did not say which torrent it is.',
  notCached: 'TorBox does not have this film ready.',
  notOwned: 'It is not in your TorBox account yet, and nothing is added before a tap.',
  owned: 'It was already in your TorBox account.',
  remembered: 'Your server remembered this torrent from the last half hour.',
  forgotten: 'TorBox no longer knew the remembered torrent, so it was asked again.',
  saidExisting: 'TorBox said it was already in your account.',
  saidNew: 'TorBox said it added it to your account now.',
  saidNothing: 'TorBox did not say whether it was new to your account.',
  notCachedNow: 'TorBox no longer has it ready, and nothing uncached is ever added.',
  noFiles: 'TorBox has not listed its files yet.',
  fileUnclear: 'The file could not be told apart from the others in this torrent.',
  noLink: 'TorBox gave no address for the file.',
  notHanded: "The address pointed at TorBox's API itself, so it was not passed on.",
  stillApi: 'TorBox kept answering with its own API address, so nothing was passed on.',
  linked: (fileServer: boolean, exchanges: number, token: boolean) =>
    `The address is ${fileServer ? 'on a TorBox file server' : 'on another host, not a TorBox file server'}, ${
      exchanges
        ? `came after ${exchanges} ${exchanges === 1 ? 'exchange' : 'exchanges'} with TorBox`
        : 'came straight from TorBox'
    }, and ${token ? "carries your account's token" : 'carries no account token'}.`,
  slow: 'TorBox did not answer in time.',
  unreachable: 'TorBox could not be reached.',
  badKey: 'TorBox did not accept the key.',
  busy: 'TorBox asked to slow down.',
  refused: 'TorBox refused the request.',
  unreadable: 'TorBox answered in a way the Worker could not read.',
  budget: 'This request already asked TorBox as often as it may.',
  status: (n: number) => `TorBox answered with status ${n}.`,
  notPublic: 'Only public https addresses are followed.',
  noLocation: 'A redirect named no address.',
  followOff:
    "Astra's server does not open add-on links for the phone, since an add-on may tie a link to the connection that asked for it.",
  placeholder: 'The add-on answered with its own short video, not the film.',
  followSlow: `No answer came within ${L.follow_ms / 1000} seconds.`,
  addonUnreachable: 'The add-on could not be reached.',
  tooMany: `The forward took more than ${L.hops} hops.`,
  ended: (n: number) => `The forward ended with status ${n}.`,
  reached: (hops: number) => `Reached the film in ${hops} ${hops === 1 ? 'hop' : 'hops'}.`,
} as const;

/** One plain sentence for the owner when nothing could be played. */
export const REASON = {
  linkNotPublic: "The add-on's link is not a public https address.",
  leftHttps: "The add-on's forward led to an address that is not public https.",
  broken: "The add-on's forward was broken.",
  slow: 'The add-on took too long to answer.',
  unreachable: 'The add-on could not be reached.',
  notReady: 'The add-on says this film is not ready on TorBox yet.',
  notOnTorbox: 'This film is not on TorBox yet, so Astra did not start it.',
  notHanded: 'The address could not be passed on safely.',
  endedInError: "The add-on's forward ended in an error.",
  tooLong: "The add-on's forward went on too long.",
  torboxLink: "TorBox did not give the file's address.",
  tooMany: 'Too many films were asked for in a minute. Try again shortly.',
} as const;
