// Settings › About and diagnostics: the "Copy feel report" row, as Astra's (Settings › About). A tap copies the
// shell's feel report (ui/feel/report.js) to the clipboard: how the last movements ran on this phone and what
// froze in the worst, numbers and fixed names only. Nothing is shown, kept or sent.
import { toast } from '/th/ui.js';
import { row } from '/apps/settings/components.js';
import { feelReport } from './report.js';

/** The row, for the page's Diagnostics group. @returns {HTMLElement} */
export function feelRow() {
  const r = row({
    title: 'Copy feel report',
    detail: 'How the last movements ran on this phone, and what froze: numbers and names only. Paste it to the Thunderhead.',
    onClick: async () => {
      try { await navigator.clipboard.writeText(feelReport()); toast('Feel report copied'); } catch { toast('Copying is not allowed here'); }
    },
  });
  r.id = 'about-feel';
  r.dataset.action = 'feel-report'; // an action of the page's own, not a catalogue setting
  return r;
}
