FROM node:lts-bookworm AS BASE

ENV PNPM_HOME="/pnpm" \
  PATH="$PNPM_HOME:$PATH" \
  USER=evobot \
  UID=1001 \
  GID=1001 \
  TZ="Asia/Seoul"

WORKDIR /home/evobot

RUN corepack enable \
  && groupadd --gid ${GID} ${USER} \
  && useradd --uid ${UID} --gid ${GID} --home-dir /home/evobot/ --shell /bin/bash ${USER} \
  && chown -R ${USER}:${USER} /home/evobot/

RUN apt-get update \
  && apt-get -y --no-install-recommends install tini \
  && apt-get install -y --no-install-recommends python3 build-essential git  \
  && apt-get purge -y --auto-remove  \
  && rm -rf /var/lib/apt/lists/*

RUN find . -mindepth 1 -maxdepth 1 -name '.*' ! -name '.' ! -name '..' -exec bash -c 'echo "Deleting {}"; rm -rf {}' \; \
  && rm -rf docker-compose.yml \
  && rm -rf Dockerfile

COPY --chown=${USER}:${USER}  . .

USER ${USER}  

RUN pnpm import && \
    pnpm install && \
    pnpm build  && \
    pnpm install --prod

FROM node:lts-bookworm-slim AS FINAL

ENV PNPM_HOME="/pnpm" \
  PATH="$PNPM_HOME:$PATH" \
  USER=evobot \
  UID=1001 \
  GID=1001 \
  TZ="Asia/Seoul" \
  GOSU_VERSION=1.17 \
  NODE_DEBUG=net

WORKDIR /home/evobot

RUN set -eux; \
  corepack enable; \
  groupadd --gid ${GID} ${USER}; \
  useradd --uid ${UID} --gid ${GID} --home-dir /home/evobot/ --shell /bin/bash ${USER}; \
  install -d -o ${USER} -g ${USER} -m 700 /home/evobot/

  RUN set -eux; \
  # save list of currently installed packages for later so we can clean up
  savedAptMark="$(apt-mark showmanual)"; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates gnupg wget; \
  rm -rf /var/lib/apt/lists/*; \
  \
  dpkgArch="$(dpkg --print-architecture | awk -F- '{ print $NF }')"; \
  wget -O /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch"; \
  wget -O /usr/local/bin/gosu.asc "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch.asc"; \
  \
  # verify the signature
  export GNUPGHOME="$(mktemp -d)"; \
  gpg --batch --keyserver hkps://keys.openpgp.org --recv-keys B42F6819007F00F88E364FD4036A9C25BF357DD4; \
  gpg --batch --verify /usr/local/bin/gosu.asc /usr/local/bin/gosu; \
  gpgconf --kill all; \
  rm -rf "$GNUPGHOME" /usr/local/bin/gosu.asc; \
  \
  # clean up fetch dependencies
  apt-mark auto '.*' > /dev/null; \
  [ -z "$savedAptMark" ] || apt-mark manual $savedAptMark; \
  apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \
  \
  chmod +x /usr/local/bin/gosu; \
  # verify that the binary works
  gosu --version; \
  gosu nobody true

COPY --from=BASE /usr/bin/tini /usr/bin/tini
COPY start.sh /usr/bin/start
COPY --from=BASE --chown=${USER}:${USER} /home/evobot/ /home/evobot/

ENTRYPOINT ["tini", "--", "start"]
CMD [ "node", "dist/index.js" ]