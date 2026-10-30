// th library cite "<question>": the blocks of the owner's books an answer may cite (STUDY.md §8.1),
// as `{q, candidates: [{ref, label, text}]}`. The answer ends each sentence with its block's
// `[[book:…]]` marker and goes out with `th say … --meta '{"cite":{"q":"<question>"}}'`; the Worker
// keeps only what those blocks back.
import {request} from './http.mjs';
import {invalid, out} from './io.mjs';

export async function library(argv) {
  const [sub, ...words] = argv;
  const q = words.join(' ').trim();
  if (sub !== 'cite' || !q) throw invalid('usage: th library cite <question>');
  if (q.length > 500) throw invalid('the question is over 500 characters');
  out((await request('GET', '/v1/library/cite', {query: {q}})).data);
}
