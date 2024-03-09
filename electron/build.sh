#!/bin/bash
cd ../occluder && yarn && ./deploy.sh && cd -
cd .. && yarn && yarn build && cd -
cp -f ../build/index.html ../build/favicon.ico .
cp -r -f ../build/static .
sed -i -re 's/React App/parsegraph/g' ./index.html
sed -i -re 's#/static/#static/#g' ./index.html
sed -i -re 's#/favicon.ico#favicon.ico#g' ./index.html
yarn make
