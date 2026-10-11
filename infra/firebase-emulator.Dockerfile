# Firestore emulator for local development and tests — the replacement for the Postgres
# container this project used to run.
#
# Built here rather than pulled from a community image because the Firestore emulator is a
# Java program: it needs a JRE alongside firebase-tools, and the third-party images that
# bundle both vary in which of the two they actually include.
# syntax=docker/dockerfile:1

FROM node:25-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends default-jre-headless \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g firebase-tools@13

# Fetch the emulator jar at build time. Without this the CLI downloads it on first start
# into a container-local cache, so every recreated container pays for it again — and a
# fresh `make up` needs the network just to get a database.
RUN firebase setup:emulators:firestore

WORKDIR /workspace

# 8080 (data), 4001 (emulator UI), 4400 (hub), 9150 (the UI's request-monitor websocket).
EXPOSE 8080 4001 4400 9150

# docker-compose overrides this to pass the project id from .env. The project is only a
# default: firebase.json sets singleProjectMode false, so the emulator serves whatever
# project id a client connects with — which is what lets each test file use its own.
CMD ["firebase", "emulators:start", "--only", "firestore", "--project", "wally-local"]
