#!/bin/bash
# A matrix of short test films, one for each container and codec pairing worth trying: gen.sh <dir>
# Each is 8 s of a moving test picture with a running clock and a 440 Hz tone (a second track, where there is one, is 880 Hz).
D=${1:-media}; mkdir -p "$D"; cd "$D"
V="-f lavfi -i testsrc2=size=640x360:rate=24:duration=8"; A1="-f lavfi -i sine=frequency=440:sample_rate=48000:duration=8"; A2="-f lavfi -i sine=frequency=880:sample_rate=48000:duration=8"
ff() { out=$1; shift; [ -s "$out" ] || ffmpeg -hide_banner -loglevel error -y "$@" "$out" || echo "could not make $out"; }
x264="-c:v libx264 -preset veryfast -pix_fmt yuv420p -g 48"; x264_10="-c:v libx264 -preset veryfast -pix_fmt yuv420p10le -g 48"
x265="-c:v libx265 -preset ultrafast -pix_fmt yuv420p -g 48 -tag:v hvc1 -x265-params log-level=error"; x265_10="-c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -g 48 -tag:v hvc1 -x265-params log-level=error"
av1="-c:v libsvtav1 -preset 10 -g 48 -svtav1-params lp=2"; vp9="-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -g 48"; vp8="-c:v libvpx -deadline realtime -cpu-used 8 -g 48"
ff mp4_h264_aac.mp4 $V $A1 $x264 -c:a aac -movflags +faststart
ff mp4_h264_aac_notfast.mp4 $V $A1 $x264 -c:a aac
ff mp4_h264hi10_aac.mp4 $V $A1 $x264_10 -c:a aac
ff mp4_hevc_aac.mp4 $V $A1 $x265 -c:a aac
ff mp4_hevc10_eac3.mp4 $V $A1 $x265_10 -c:a eac3 -ac 6
ff mp4_av1_aac.mp4 $V $A1 $av1 -c:a aac
ff mp4_vp9_opus.mp4 $V $A1 $vp9 -c:a libopus
ff mp4_h264_ac3.mp4 $V $A1 $x264 -c:a ac3
ff mp4_h264_mp3.mp4 $V $A1 $x264 -c:a libmp3lame
ff mp4_h264_alac.mp4 $V $A1 $x264 -c:a alac
ff mp4_h264_flac.mp4 $V $A1 $x264 -c:a flac -strict -2
ff mp4_mpeg4_aac.mp4 $V $A1 -c:v mpeg4 -q:v 5 -c:a aac
ff mov_h264_pcm.mov $V $A1 $x264 -c:a pcm_s16le
ff mov_prores_pcm.mov $V $A1 -c:v prores_ks -profile:v 0 -c:a pcm_s16le
ff mov_mjpeg_pcm.mov $V $A1 -c:v mjpeg -q:v 5 -c:a pcm_s16le
ff mkv_h264_aac.mkv $V $A1 $x264 -c:a aac
ff mkv_h264_ac3_51.mkv $V $A1 $x264 -c:a ac3 -ac 6
ff mkv_h264_eac3.mkv $V $A1 $x264 -c:a eac3 -ac 6
ff mkv_h264_dts.mkv $V $A1 $x264 -c:a dca -strict -2 -ac 6
ff mkv_h264_truehd.mkv $V $A1 $x264 -c:a truehd -strict -2 -ac 6
ff mkv_h264_flac.mkv $V $A1 $x264 -c:a flac
ff mkv_h264_opus.mkv $V $A1 $x264 -c:a libopus
ff mkv_h264_vorbis.mkv $V $A1 $x264 -c:a libvorbis
ff mkv_h264_mp3.mkv $V $A1 $x264 -c:a libmp3lame
ff mkv_h264_pcm24.mkv $V $A1 $x264 -c:a pcm_s24le
ff mkv_h264_mp2.mkv $V $A1 $x264 -c:a mp2
ff mkv_h264_2audio_subs.mkv $V $A1 $A2 -f lavfi -i "color=c=black:s=16x16:d=0.1" $x264 -map 0:v -map 1:a -map 2:a -c:a:0 aac -c:a:1 ac3 -metadata:s:a:0 language=eng -metadata:s:a:1 language=spa
ff mkv_h264hi10_aac.mkv $V $A1 $x264_10 -c:a aac
ff mkv_hevc_aac.mkv $V $A1 $x265 -c:a aac
ff mkv_hevc10_dts.mkv $V $A1 $x265_10 -c:a dca -strict -2 -ac 6
ff mkv_hevc10_truehd_ac3.mkv $V $A1 $A2 $x265_10 -map 0:v -map 1:a -map 2:a -c:a:0 truehd -strict -2 -c:a:1 ac3
ff mkv_av1_opus.mkv $V $A1 $av1 -c:a libopus
ff mkv_vp9_flac.mkv $V $A1 $vp9 -c:a flac
ff mkv_mpeg2_ac3.mkv $V $A1 -c:v mpeg2video -q:v 5 -c:a ac3
ff mkv_mpeg4_mp3.mkv $V $A1 -c:v mpeg4 -q:v 5 -c:a libmp3lame
ff mkv_vp8_vorbis.mkv $V $A1 $vp8 -c:a libvorbis
ff mkv_theora_vorbis.mkv $V $A1 -c:v libtheora -q:v 6 -c:a libvorbis
ff mkv_wmv2_wma.mkv $V $A1 -c:v wmv2 -q:v 5 -c:a wmav2
ff mkv_mjpeg_pcm.mkv $V $A1 -c:v mjpeg -q:v 5 -c:a pcm_s16le
ff mkv_h264_60fps_aac.mkv -f lavfi -i testsrc2=size=1280x720:rate=60:duration=8 $A1 $x264 -c:a aac
ff mkv_h264_bframes_opengop.mkv $V $A1 -c:v libx264 -preset medium -pix_fmt yuv420p -bf 3 -x264-params open-gop=1:keyint=96 -c:a aac
ff webm_vp9_opus.webm $V $A1 $vp9 -c:a libopus
ff webm_vp8_vorbis.webm $V $A1 $vp8 -c:a libvorbis
ff webm_av1_opus.webm $V $A1 $av1 -c:a libopus
ff avi_xvid_mp3.avi $V $A1 -c:v libxvid -q:v 5 -c:a libmp3lame
ff avi_h264_ac3.avi $V $A1 $x264 -c:a ac3
ff avi_msmpeg4_mp3.avi $V $A1 -c:v msmpeg4 -q:v 5 -c:a libmp3lame
ff avi_mjpeg_pcm.avi $V $A1 -c:v mjpeg -q:v 5 -c:a pcm_s16le
ff ts_h264_aac.ts $V $A1 $x264 -c:a aac
ff ts_h264_ac3.ts $V $A1 $x264 -c:a ac3
ff ts_hevc_ac3.ts $V $A1 -c:v libx265 -preset ultrafast -pix_fmt yuv420p -g 48 -x265-params log-level=error -c:a ac3
ff ts_mpeg2_mp2.ts $V $A1 -c:v mpeg2video -q:v 5 -c:a mp2
ff m2ts_h264_ac3.m2ts $V $A1 $x264 -c:a ac3 -f mpegts -mpegts_m2ts_mode 1
ff mpg_mpeg2_mp2.mpg $V $A1 -c:v mpeg2video -q:v 5 -c:a mp2
ff mpg_mpeg1_mp2.mpg $V $A1 -c:v mpeg1video -q:v 5 -c:a mp2
ff vob_mpeg2_ac3.vob $V $A1 -c:v mpeg2video -q:v 5 -c:a ac3 -f vob
ff flv_h264_aac.flv $V $A1 $x264 -c:a aac -ar 44100
ff flv_flv1_mp3.flv $V $A1 -c:v flv -q:v 5 -c:a libmp3lame -ar 44100
ff wmv_wmv2_wma.wmv $V $A1 -c:v wmv2 -q:v 5 -c:a wmav2
ff asf_msmpeg4_wma.asf $V $A1 -c:v msmpeg4 -q:v 5 -c:a wmav2
ff 3gp_h263_aac.3gp -f lavfi -i testsrc2=size=352x288:rate=24:duration=8 $A1 -c:v h263 -q:v 5 -c:a aac
ff ogv_theora_vorbis.ogv $V $A1 -c:v libtheora -q:v 6 -c:a libvorbis
ff mkv_hevc_4k_aac.mkv -f lavfi -i testsrc2=size=3840x2160:rate=24:duration=4 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=4 $x265 -c:a aac
ff mkv_h264_1080p_aac.mkv -f lavfi -i testsrc2=size=1920x1080:rate=24:duration=8 $A1 $x264 -c:a aac
# AVI variants: H.264 (which the software decoder's reader fails on), tags in both cases, B-frames, Windows Media and ADPCM sound.
ff avi_h264_mp3.avi $V $A1 $x264 -c:a libmp3lame
ff avi_h264nob_ac3.avi $V $A1 $x264 -bf 0 -c:a ac3
ff avi_h264_adpcm.avi $V $A1 $x264 -bf 0 -c:a adpcm_ms
ff avi_XVID_mp3.avi $V $A1 -c:v mpeg4 -q:v 5 -vtag XVID -c:a libmp3lame
ff avi_divx_ac3.avi $V $A1 -c:v mpeg4 -q:v 5 -vtag DX50 -bf 2 -c:a ac3
ff avi_wmv2_wma.avi $V $A1 -c:v wmv2 -q:v 5 -c:a wmav2
ff mkv_h264_wma.mkv $V $A1 $x264 -c:a wmav2
ff ts_h264_mp2.ts $V $A1 $x264 -c:a mp2
# Three minutes at 1080p and about 8 Mbit/s with two sounds, for smooth.cjs and seektrace.cjs.
ff long_h264_ac3_aac.mkv -f lavfi -i testsrc2=size=1920x1080:rate=24:duration=180 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=180 -f lavfi -i sine=frequency=880:sample_rate=48000:duration=180 \
  -map 0:v -map 1:a -map 2:a -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 48 -b:v 8M -maxrate 10M -bufsize 16M -c:a:0 ac3 -ac:a:0 6 -b:a:0 448k -c:a:1 aac -ac:a:1 2 -metadata:s:a:0 language=eng -metadata:s:a:1 language=spa
ls -la | awk '{print $5, $9}' | tail -n +2 | wc -l
