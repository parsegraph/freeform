#!/bin/bash
cd ../occluder && ./deploy.sh && cd -
cd .. && yarn build && cd -
cp -f ../build/index.html ../build/favicon.ico .
cp -r -f ../build/static .
