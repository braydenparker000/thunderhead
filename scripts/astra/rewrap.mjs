// A film's video re-wrapped the way Astra's remux does it, early fragments included, saved as one fragmented
// MP4 that ffmpeg can check (it decodes HEVC, which desktop Chrome does not): node rewrap.mjs <in> <out>
//   ffmpeg -v error -i <out> -f null -        no output means every frame decoded
import fs from 'node:fs';
import * as MB from '../../frontend/astra/vendor/mediabunny.js';
import { EarlyCuts } from '../../frontend/astra/src/engine/early.js';

const [inp, out] = process.argv.slice(2);
const input = new MB.Input({ source: new MB.BufferSource(fs.readFileSync(inp)), formats: MB.ALL_FORMATS });
const track = await input.getPrimaryVideoTrack(), sink = new MB.EncodedPacketSink(track), early = new EarlyCuts();
const parts = []; let head = [], moof = null, fragments = 0;
const format = new MB.Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 0,
  onFtyp: (d) => head.push(d.slice()), onMoov: (d) => { head.push(d.slice()); parts.push(...head); },
  onMoof: (d) => { moof = d.slice(); early.settle(moof); fragments++; }, onMdat: (d) => { parts.push(moof, d.slice()); } });
const output = new MB.Output({ format, target: new MB.NullTarget() });
const source = new MB.EncodedVideoPacketSource(track.codec); output.addVideoTrack(source); await output.start();
let first = true, packets = 0; const config = await track.getDecoderConfig();
for await (const packet of sink.packets(await sink.getFirstPacket())) { packets++; await source.add(early.mark(packet), first ? { decoderConfig: config } : undefined); first = false; }
await output.finalize();
fs.writeFileSync(out, Buffer.concat(parts.map((x) => Buffer.from(x))));
console.log(`${packets} packets in ${fragments} fragments; ${early.forced.length} left unsettled (should be 0)`);
