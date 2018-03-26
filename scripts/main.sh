#!/bin/bash

basedir=`dirname "$0"`

node "$basedir/../cli.js" "$@"

read wait
