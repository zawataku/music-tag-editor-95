#!/bin/sh
# テスト用サンプルの再生成。テスト実行には不要（生成物をコミット済み）。
set -e
cd "$(dirname "$0")"
ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 blank.mp3
ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -c:a aac blank.m4a
ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 blank.flac
ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -c:a libvorbis blank.ogg
ffmpeg -loglevel error -y -f lavfi -i color=red:s=8x8 -frames:v 1 cover-red.png
ffmpeg -loglevel error -y -f lavfi -i color=blue:s=8x8 -frames:v 1 cover-blue.jpg
printf 'not audio' > broken.mp3
