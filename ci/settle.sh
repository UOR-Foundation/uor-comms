#!/bin/sh
# TEMPORARY, not for merge: relock and format with the locked SDK.
set -eu
cd app
lexlean lock
lexlean fmt --all
lexlean lock
