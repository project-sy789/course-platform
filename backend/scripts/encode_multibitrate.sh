#!/usr/bin/env bash
# encode_multibitrate.sh — produce an HLS multi-bitrate ladder with AES-128.
#
# Usage:
#   ./encode_multibitrate.sh <source.mp4> <out_dir> [api-base]
#
#   api-base defaults to https://api.example.com — must match production so that
#   Safari (native HLS) can find the key endpoint. Other browsers go through
#   hls.js's loader override and don't read this URI.
#
# Output:
#   <out_dir>/key.hex                 — paste this into the upload form
#   <out_dir>/master.m3u8             — master playlist (variant selector)
#   <out_dir>/360p/index.m3u8 + seg_*.ts
#   <out_dir>/720p/index.m3u8 + seg_*.ts
#   <out_dir>/1080p/index.m3u8 + seg_*.ts

set -euo pipefail

SRC="${1:?missing source.mp4}"
OUT="${2:?missing out_dir}"
API_BASE="${3:-https://api.example.com}"

command -v ffmpeg >/dev/null || { echo "ffmpeg required" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl required" >&2; exit 1; }

mkdir -p "$OUT"
KEY_HEX=$(openssl rand -hex 16)
echo -n "$KEY_HEX" | tee "$OUT/key.hex" >/dev/null
echo -n "$KEY_HEX" | xxd -r -p > "$OUT/key.bin"

# All variants share one key. The URI is overridden by hls.js at playback,
# but Safari reads it verbatim — so it must point at the real backend.
KEY_URI="$API_BASE/api/v1/videos/PLACEHOLDER/key"
cat > "$OUT/key_info.txt" <<EOF
$KEY_URI
$OUT/key.bin
EOF

encode_variant() {
  local label="$1" height="$2" bitrate="$3" maxrate="$4" bufsize="$5"
  local dir="$OUT/$label"
  mkdir -p "$dir"

  ffmpeg -y -i "$SRC" \
    -vf "scale=-2:${height}" \
    -c:v libx264 -profile:v main -preset veryfast -crf 21 \
    -b:v "$bitrate" -maxrate "$maxrate" -bufsize "$bufsize" \
    -g 48 -keyint_min 48 -sc_threshold 0 \
    -c:a aac -b:a 128k -ac 2 \
    -hls_time 6 -hls_playlist_type vod \
    -hls_key_info_file "$OUT/key_info.txt" \
    -hls_segment_filename "$dir/seg_%03d.ts" \
    "$dir/index.m3u8"
}

encode_variant "360p"  360   "800k"  "856k"  "1200k"
encode_variant "720p"  720   "2800k" "2996k" "4200k"
encode_variant "1080p" 1080  "5000k" "5350k" "7500k"

# Master playlist — paths are relative to master, no leading slash.
cat > "$OUT/master.m3u8" <<'EOF'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=856000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2996000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5350000,RESOLUTION=1920x1080,CODECS="avc1.4d4028,mp4a.40.2"
1080p/index.m3u8
EOF

# Tidy up artifacts the upload UI doesn't want
rm -f "$OUT/key_info.txt" "$OUT/key.bin"

echo
echo "Done. Upload the '$OUT' folder via /admin/upload."
echo "Manifest filename: master.m3u8"
echo "AES key (paste into form): $KEY_HEX"
