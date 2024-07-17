#!/bin/bash

set -e

# Export default values for environment variables if they are not set
export EVOBOT_MAX_PLAYLIST_SIZE=${EVOBOT_MAX_PLAYLIST_SIZE:-10}
export EVOBOT_PRUNING=${EVOBOT_PRUNING:-false}
export EVOBOT_LOCALE=${EVOBOT_LOCALE:-en}
export EVOBOT_STAY_TIME=${EVOBOT_STAY_TIME:-30}
export EVOBOT_DEFAULT_VOLUME=${EVOBOT_DEFAULT_VOLUME:-100}

# Check and set UID and GID if provided
if [ "$(id -u)" = '0' ]; then
  # Handle UID and GID if provided
  if [ -z "$UID" ] || [ -z "$GID" ]; then
    printf "Using Default UID:GID (1001:1001)\n"
  else
    echo "Using provided UID = $UID / GID = $GID"
    usermod -u "$UID" evobot
    groupmod -g "$GID" evobot
  fi

  # Check if configuration file exists, else create it
  if [ ! -f "/home/evobot/dist/config.json" ]; then
    # Check if DISCORD_TOKEN is set
    if [ -z "$DISCORD_TOKEN" ]; then
    echo "Error: DISCORD_TOKEN is not set."
    exit 1
    fi
    # Generate config.json file with default values
    printf '%s\n' '{
      "TOKEN": "'"$DISCORD_TOKEN"'",
      "MAX_PLAYLIST_SIZE": '"$EVOBOT_MAX_PLAYLIST_SIZE"',
      "PRUNING": '"$EVOBOT_PRUNING"',
      "LOCALE": "'"$EVOBOT_LOCALE"'",
      "STAY_TIME": '"$EVOBOT_STAY_TIME"',
      "DEFAULT_VOLUME": '"$EVOBOT_DEFAULT_VOLUME"'
    }' > /home/evobot/dist/config.json

    printf "Configuration file created: /home/evobot/dist/config.json\n"
  else
    printf "Configuration file already exists. Skipping file creation.\n"
  fi

  # Change ownership of /home/evobot directory
  chown -R evobot:evobot /home/evobot/

  exec gosu evobot "$@"
fi