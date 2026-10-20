#!/bin/bash
# medical-ethics部署脚本(1020代码审查产出): 同步+版本对齐校验
set -e
SRC=/root/workspace/medical-ethics
DST=/www/wwwroot/medical-ethics-web

# 1. bump chat.js引用版本(若chat.js有未同步改动)
GIT_HASH=$(git -C $SRC log -1 --format=%h -- assets/chat.js)
DEPLOYED_HASH=$(md5sum $DST/assets/chat.js | cut -d' ' -f1)
SRC_HASH=$(md5sum $SRC/assets/chat.js | cut -d' ' -f1)
if [ "$DEPLOYED_HASH" != "$SRC_HASH" ]; then
    # chat.js有变化→bump html引用
    NEWV=$(( $(grep -oP 'chat\.js\?v=\K[0-9]+' $SRC/chat.html | head -1) + 1 ))
    sed -i "s/chat\.js?v=[0-9]*/chat.js?v=$NEWV/g" $SRC/chat.html
    echo "bumped chat.js引用→v$NEWV"
fi

# chat.js同款: style.css变化→bump所有页面的style.css引用
CSS_DEPLOYED=$(md5sum $DST/assets/style.css | cut -d' ' -f1)
CSS_SRC=$(md5sum $SRC/assets/style.css | cut -d' ' -f1)
if [ "$CSS_DEPLOYED" != "$CSS_SRC" ]; then
    NEWC=$(( $(grep -oP 'style\.css\?v=\K[0-9]+' $SRC/index.html | head -1) + 1 ))
    sed -i "s/style\.css?v=[0-9]*/style.css?v=$NEWC/g" $SRC/index.html $SRC/chat.html $SRC/expert.html $SRC/calc.html
    echo "bumped style.css引用→v$NEWC"
fi

# 1.5 生成version.json(单一版本真源: commit短hash+构建时间)
V=$(git -C $SRC log -1 --format=%h)
printf '{"v": "%s", "built": "%s"}' "$V" "$(date +%m-%d\ %H:%M)" > $SRC/version.json

# 2. 同步文件
cp -f $SRC/index.html $SRC/chat.html $SRC/expert.html $DST/
cp -f $SRC/assets/*.js $SRC/assets/*.css $DST/assets/
cp -f $SRC/version.json $DST/version.json
chown -R www:www $DST

# 3. 验证: html引用版本与chat.js md5记录
echo "部署完成 $(date +%H:%M:%S)"
grep -o "chat.js?v=[0-9]*" $DST/chat.html
