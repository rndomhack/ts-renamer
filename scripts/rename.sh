#!/bin/bash

basedir=`dirname "$0"`

while [ $# -gt 0 ]; do
    echo -e "\n### \"$1\""

    node "$basedir/../cli.js" -i "$1" -d "\${title}" -f "\${title}([ ‘æ\${count2}˜b])([ u\${subTitle}v])([ (\${channelUserName})])"

    if [ $? -eq 0 ]; then
        echo "OK: $1" >> "$basedir/../log/rename.log"
    else
        echo "NG: $1" >> "$basedir/../log/rename.log"
    fi

    shift
done

echo done
read wait
