#!/usr/bin/env bash
# Makes the small films the browser checks play (tests/fixtures/astra/, committed: about 1.5 MB in
# all). Each is a moving test picture with a clock and a sine tone per sound track, so a check can
# tell by pitch which track is heard. Needs ffmpeg. Usage: bash scripts/astra/fixtures.sh [film…]
# (names such as anime.mkv make only those films; x264 builds differ, so remaking all churns them).
set -euo pipefail
out="$(cd "$(dirname "$0")/../.." && pwd)/tests/fixtures/astra"
mkdir -p "$out"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
pic() { echo "testsrc2=size=320x180:rate=12:duration=$1"; }
tone() { echo "sine=frequency=$1:sample_rate=48000:duration=$2"; }
only=("$@")
want() { [ ${#only[@]} -eq 0 ] && return 0; local n; for n in "${only[@]}"; do [ "$n" = "$1" ] && return 0; done; return 1; }
x264=(-c:v libx264 -preset veryslow -profile:v main -pix_fmt yuv420p -b:v 70k -g 24 -bf 2)

# Two subtitle files: one for inside the film, one to load beside it.
printf '1\n00:00:01,000 --> 00:00:04,000\nFirst line inside the film\n\n2\n00:00:20,000 --> 00:00:24,000\nA line at twenty seconds\n\n3\n00:00:40,000 --> 00:00:44,000\nA line at forty seconds\n' > "$tmp/in.srt"
printf '1\n00:00:01,000 --> 00:00:05,000\nA line from a file beside the film\n' > "$out/beside.srt"
# Chapters: an opening, the story, the credits.
cat > "$tmp/chapters.txt" <<'EOF'
;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=0
END=8000
title=Opening
[CHAPTER]
TIMEBASE=1/1000
START=8000
END=50000
title=The story
[CHAPTER]
TIMEBASE=1/1000
START=50000
END=60000
title=Credits
EOF

# multi.mkv: H.264, two AAC tracks (English at 440 Hz, Japanese at 880 Hz), an SRT track, chapters. 60 s.
want multi.mkv && ff -f lavfi -i "$(pic 60)" -f lavfi -i "$(tone 440 60)" -f lavfi -i "$(tone 880 60)" -i "$tmp/in.srt" -i "$tmp/chapters.txt" \
  -map 0:v -map 1:a -map 2:a -map 3:s -map_metadata 4 -map_chapters 4 "${x264[@]}" -c:a aac -b:a 24k -ac 2 -c:s srt \
  -metadata:s:a:0 language=eng -metadata:s:a:0 title=English -metadata:s:a:1 language=jpn -metadata:s:a:1 title=Japanese \
  -metadata:s:s:0 language=eng -disposition:a:0 default -disposition:a:1 0 "$out/multi.mkv"

# surround.mkv: H.264 with Dolby Digital 5.1 only (the sound is rebuilt on the device). 20 s.
want surround.mkv && ff -f lavfi -i "$(pic 20)" -f lavfi -i "$(tone 660 20)" -map 0:v -map 1:a "${x264[@]}" -c:a ac3 -b:a 96k -ac 6 \
  -metadata:s:a:0 language=eng "$out/surround.mkv"

# plain.mp4: one picture, one AAC track, the index first: the browser plays it as it is. 20 s.
want plain.mp4 && ff -f lavfi -i "$(pic 20)" -f lavfi -i "$(tone 440 20)" -map 0:v -map 1:a "${x264[@]}" -c:a aac -b:a 24k -ac 2 \
  -movflags +faststart "$out/plain.mp4"

# open.webm: VP9 and Opus, for a browser with no H.264 decoder. 20 s.
want open.webm && ff -f lavfi -i "$(pic 20)" -f lavfi -i "$(tone 440 20)" -map 0:v -map 1:a -c:v libvpx-vp9 -b:v 60k -g 24 -deadline good -cpu-used 2 \
  -c:a libopus -b:a 24k "$out/open.webm"

# anime.mkv: H.264, AAC, the invented signs.ass as an ASS track (signs, \\move, rotation, karaoke) and,
# as a font attachment, Inter Bold from Astra's own fonts (SIL OFL 1.1, frontend/astra/fonts/LICENSE.md),
# which the script's Sign style names. Matroska keeps the file's mimetype; font/woff2 is a WOFF2 font. 20 s.
want anime.mkv && ff -f lavfi -i "$(pic 20)" -f lavfi -i "$(tone 550 20)" -i "$out/signs.ass" \
  -map 0:v -map 1:a -map 2:s "${x264[@]}" -c:a aac -b:a 24k -ac 2 -c:s ass -metadata:s:s:0 language=eng -metadata:s:s:0 title=Signs \
  -attach "$out/../../../frontend/astra/fonts/inter-700.woff2" -metadata:s:t:0 mimetype=font/woff2 -metadata:s:t:0 filename=Inter-Bold.woff2 \
  "$out/anime.mkv"

ls -l "$out"
