FROM node:lts-bookworm AS base

ENV PNPM_HOME="/pnpm" \
  PATH="$PNPM_HOME:$PATH" \
  USER=akibot \
  UID=1001 \
  GID=1001 \
  TZ="Asia/Seoul"

WORKDIR /home/akibot

RUN corepack enable \
  && groupadd --gid ${GID} ${USER} \
  && useradd --uid ${UID} --gid ${GID} --home-dir /home/akibot/ --shell /bin/bash ${USER} \
  && chown -R ${USER}:${USER} /home/akibot/

RUN apt-get update \
  && apt-get -y --no-install-recommends install tini \
  && apt-get install -y --no-install-recommends python3 build-essential  \
  && apt-get purge -y --auto-remove  \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=${USER}:${USER}  . .

USER ${USER}  

RUN pnpm import && \
    pnpm install && \
    pnpm build  && \
    pnpm install --prod

FROM node:lts-bookworm-slim AS Final

ENV PNPM_HOME="/pnpm" \
  PATH="$PNPM_HOME:$PATH" \
  USER=akibot \
  UID=1001 \
  GID=1001 \
  TZ="Asia/Seoul"

WORKDIR /home/akibot

RUN corepack enable \
  && groupadd --gid ${GID} ${USER} \
  && useradd --uid ${UID} --gid ${GID} --home-dir /home/akibot/ --shell /bin/bash ${USER} \
  && chown -R ${USER}:${USER} /home/akibot/

COPY --from=base --chown=${USER}:${USER} /usr/bin/tini /usr/bin/tini
COPY --from=base --chown=${USER}:${USER} /home/akibot/ /home/akibot/

USER ${USER}

ENTRYPOINT ["tini", "--"]
CMD [ "node", "dist/index.js" ]