#!/bin/sh
# 用法: ./run.sh 图片.png [参数]
exec node "$(dirname "$0")/img2cad.mjs" "$@"
