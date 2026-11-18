#!/usr/bin/env bash
# Makes the small films the browser checks play (tests/fixtures/astra/, committed: about 3 MB in
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

# mixed.mkv: H.264 with Dolby Digital 5.1 at 660 Hz (rebuilt on the device, the default) and AAC stereo at 440 Hz (passed
# through): what plays when the converter cannot be downloaded. 10 s.
want mixed.mkv && ff -f lavfi -i "$(pic 10)" -f lavfi -i "$(tone 660 10)" -f lavfi -i "$(tone 440 10)" -map 0:v -map 1:a -map 2:a "${x264[@]}" \
  -c:a:0 ac3 -b:a:0 96k -ac:a:0 6 -c:a:1 aac -b:a:1 24k -ac:a:1 2 -metadata:s:a:0 language=eng -metadata:s:a:0 title=Surround \
  -metadata:s:a:1 language=eng -metadata:s:a:1 title=Stereo -disposition:a:0 default -disposition:a:1 0 "$out/mixed.mkv"

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

# centre.mkv: H.264 with AAC 5.1 whose only sound is a 1 kHz tone in the centre channel (dialogue lift). 8 s.
want centre.mkv && ff -f lavfi -i "$(pic 8)" -f lavfi -i "$(tone 1000 8)" -filter_complex "[1]pan=5.1|FC=c0[a]" -map 0:v -map "[a]" \
  -c:v libx264 -preset veryslow -profile:v main -pix_fmt yuv420p -b:v 40k -g 24 -bf 2 -c:a aac -b:a 64k "$out/centre.mkv"

# truehd.mkv: H.264 with Dolby TrueHD stereo, 770 Hz (decoded and rebuilt on the device). ffmpeg's TrueHD
# encoder is experimental (-strict -2); lossless sound is large, so the film is 6 s (under 300 kB).
want truehd.mkv && ff -f lavfi -i "$(pic 6)" -f lavfi -i "$(tone 770 6)" -map 0:v -map 1:a \
  -c:v libx264 -preset veryslow -profile:v main -pix_fmt yuv420p -b:v 40k -g 24 -bf 2 -c:a truehd -strict -2 -ac 2 \
  -metadata:s:a:0 language=eng "$out/truehd.mkv"

# dts.mkv: H.264 with DTS 5.1 at 880 Hz (decoded and rebuilt on the device). ffmpeg's DTS encoder is experimental
# (-strict -2) and takes no less than 704 kbit/s for 5.1, so the film is 3 s (under 300 kB).
want dts.mkv && ff -f lavfi -i "$(pic 3)" -f lavfi -i "$(tone 880 3)" -map 0:v -map 1:a \
  -c:v libx264 -preset veryslow -profile:v main -pix_fmt yuv420p -b:v 40k -g 24 -bf 2 -c:a dca -strict -2 -b:a 704k -ac 6 \
  -metadata:s:a:0 language=eng "$out/dts.mkv"

# hevc.mkv: HEVC (which this headless Chromium cannot decode, so the software decoder plays it) and a 1 kHz AAC tone. 8 s.
want hevc.mkv && ff -f lavfi -i "$(pic 8)" -f lavfi -i "$(tone 1000 8)" -map 0:v -map 1:a -c:v libx265 -preset slow -b:v 40k -x265-params log-level=error \
  -c:a aac -b:a 24k -ac 2 "$out/hevc.mkv"

# clusters.mkv: H.264 with a key frame every 10 s and a cluster every 5 s (so half the clusters begin between key
# frames), and AAC at 440 Hz: Astra's own Matroska reader (mkv-packets.js) reads a cluster as it arrives. 30 s.
want clusters.mkv && ff -f lavfi -i "$(pic 30)" -f lavfi -i "$(tone 440 30)" -map 0:v -map 1:a -c:v libx264 -preset veryslow -profile:v main \
  -pix_fmt yuv420p -b:v 50k -g 120 -bf 2 -c:a aac -b:a 24k -ac 2 -cluster_time_limit 5000 -cluster_size_limit 5000000 "$out/clusters.mkv"

# frontcues.mkv: the same kind of film with its cue index before the clusters (space kept for it at the front). 12 s.
want frontcues.mkv && ff -f lavfi -i "$(pic 12)" -f lavfi -i "$(tone 440 12)" -map 0:v -map 1:a -c:v libx264 -preset veryslow -profile:v main \
  -pix_fmt yuv420p -b:v 50k -g 24 -bf 2 -c:a aac -b:a 24k -ac 2 -reserve_index_space 4096 "$out/frontcues.mkv"

# h264.avi, h263.3gp, wma.mkv: kinds only the software decoder plays, each through a small patch to libmedia's readers
# (frontend/assets/libmedia/licenses/libmedia-modifications.txt). H.264 in an AVI with no decoder setup in its header
# (as ffmpeg and most tools write it) and MP3 at 440 Hz; H.263 in 3GP (its own picture sizes) and AAC at 550 Hz;
# H.264 with Windows Media Audio in an MKV at 660 Hz. 6 s each.
small=(-c:v libx264 -preset veryslow -profile:v main -pix_fmt yuv420p -b:v 40k -g 24 -bf 2)
want h264.avi && ff -f lavfi -i "$(pic 6)" -f lavfi -i "$(tone 440 6)" -map 0:v -map 1:a "${small[@]}" -c:a libmp3lame -b:a 32k -ac 1 "$out/h264.avi"
want h263.3gp && ff -f lavfi -i "testsrc2=size=176x144:rate=12:duration=6" -f lavfi -i "$(tone 550 6)" -map 0:v -map 1:a -c:v h263 -b:v 60k -g 24 \
  -c:a aac -b:a 24k -ac 1 -ar 22050 "$out/h263.3gp"
want wma.mkv && ff -f lavfi -i "$(pic 6)" -f lavfi -i "$(tone 660 6)" -map 0:v -map 1:a "${small[@]}" -c:a wmav2 -b:a 32k -ac 1 "$out/wma.mkv"

# hls/ and dash/: the same 6 s of picture and a 440 Hz tone as an HLS stream (three 2 s transport-stream segments
# and their playlist) and as a DASH stream (2 s fragmented-MP4 segments, picture and sound apart, and the manifest).
adaptive=(-f lavfi -i "$(pic 6)" -f lavfi -i "$(tone 440 6)" -map 0:v -map 1:a -c:v libx264 -preset veryslow -profile:v main -pix_fmt yuv420p
  -b:v 40k -g 24 -keyint_min 24 -sc_threshold 0 -bf 2 -c:a aac -b:a 24k -ac 2)
want hls && rm -rf "$out/hls" && mkdir -p "$out/hls" && ff "${adaptive[@]}" -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename "$out/hls/seg%d.ts" "$out/hls/index.m3u8"
want dash && rm -rf "$out/dash" && mkdir -p "$out/dash" && ff "${adaptive[@]}" -f dash -seg_duration 2 -use_template 1 -use_timeline 0 \
  -init_seg_name 'init-$RepresentationID$.m4s' -media_seg_name 'chunk-$RepresentationID$-$Number$.m4s' "$out/dash/index.mpd"

ls -l "$out"
