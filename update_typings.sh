#!/bin/bash

# Generate typescript definitions from JSDoc comments
./node_modules/.bin/jsdoc  -t node_modules/@otris/jsdoc-tsd -r ./lib -d ./index.d.ts 2>&1 | \
    grep -v "Unsupported jsdoc item kind: event" # strip away error message for @event jsdoc comments (not supported)

# Add imports for stream
sed -i '1 i\import { Writable, Readable } from "stream"; ' ./index.d.ts
sed -i '1 i\import { Socket } from "net"; ' ./index.d.ts

# Fix classes that extend Writable/ReadableStream
sed -i -E "s/declare class MumbleInputStream/declare class MumbleInputStream extends Writable/g" ./index.d.ts
sed -i -E "s/declare class MumbleOutputStream/declare class MumbleOutputStream extends Readable/g" ./index.d.ts

set -e
./node_modules/.bin/tsc ./index.d.ts
