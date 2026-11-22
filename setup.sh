#!/usr/bin/env bash
# Quick setup: install, set the admin password, and optionally put Caddy
# (automatic HTTPS) in front of the app.
#
# Usage: ./setup.sh [--python | --docker]
#   --python  virtualenv in .venv (default)
#   --docker  build the image and run the app in a container with a data volume
# Without a flag, a terminal session is asked which one to use when Docker is available.
set -euo pipefail

cd "$(dirname "$0")"

IMAGE=fgc-scoreboard
CONTAINER=fgc-scoreboard
VOLUME=fgc-data

mode=""
case "${1:-}" in
    "") ;;
    --python) mode=python ;;
    --docker) mode=docker ;;
    *) echo "Usage: $0 [--python | --docker]" >&2; exit 2 ;;
esac

docker_usable() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

if [ -z "$mode" ]; then
    mode=python
    if [ -t 0 ] && docker_usable; then
        read -r -p "Install with [1] Python virtualenv or [2] Docker? [1] " choice
        [ "$choice" = 2 ] && mode=docker
    fi
fi

# ---- install + password ----
if [ "$mode" = docker ]; then
    if ! docker_usable; then
        echo "Docker is not installed or the daemon is not reachable by this user." >&2
        exit 1
    fi
    docker build -t "$IMAGE" .
    tty_flags=(-i)
    [ -t 0 ] && tty_flags=(-it)
    if docker run --rm -v "$VOLUME":/data "$IMAGE" -c 'import sys; from auth import is_configured; sys.exit(0 if is_configured() else 1)'; then
        echo "Admin password already set (reset it with: docker run --rm -it -v $VOLUME:/data $IMAGE setup_password.py)."
    else
        docker run --rm "${tty_flags[@]}" -v "$VOLUME":/data "$IMAGE" setup_password.py
    fi
else
    if ! command -v python3 >/dev/null 2>&1; then
        echo "python3 not found; install Python 3.10+ first." >&2
        exit 1
    fi
    if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
        echo "Python 3.10+ required (found $(python3 -V))." >&2
        exit 1
    fi

    if [ ! -d .venv ]; then
        python3 -m venv .venv
    fi

    .venv/bin/python -m pip install --quiet --upgrade pip
    .venv/bin/python -m pip install --quiet -r requirements.txt

    if .venv/bin/python -c 'import sys; from auth import is_configured; sys.exit(0 if is_configured() else 1)'; then
        echo "Admin password already set (reset it with: .venv/bin/python setup_password.py)."
    else
        .venv/bin/python setup_password.py
    fi
fi

# ---- optional HTTPS via Caddy (interactive only) ----
tls=0
URL="http://localhost:8000/control"
if [ -t 0 ]; then
    echo
    read -r -p "Set up HTTPS with Caddy? Needs a domain pointing at this server and ports 80/443 open. [y/N] " want_tls
    if [[ "$want_tls" =~ ^[Yy]$ ]]; then
        read -r -p "Domain (e.g. scoreboard.example.com): " domain
        if [[ ! "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
            echo "Invalid domain; skipping Caddy setup." >&2
        elif ! command -v caddy >/dev/null 2>&1; then
            echo "Caddy is not installed; see https://caddyserver.com/docs/install and re-run ./setup.sh." >&2
        else
            snippet="$domain {
	reverse_proxy localhost:8000
}"
            conf=/etc/caddy/Caddyfile
            if sudo grep -qsF "$domain {" "$conf"; then
                echo "$conf already has a block for $domain; leaving it unchanged."
            else
                printf '\n%s\n' "$snippet" | sudo tee -a "$conf" >/dev/null
                echo "Appended $domain to $conf."
            fi
            sudo systemctl reload caddy
            tls=1
            URL="https://$domain/control"
        fi
    fi
fi

# ---- start / finish ----
if [ "$mode" = docker ]; then
    # With a reverse proxy in front, publish on loopback only.
    publish=8000:8000
    [ "$tls" = 1 ] && publish=127.0.0.1:8000:8000
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$CONTAINER" --restart unless-stopped \
        -p "$publish" -v "$VOLUME":/data "$IMAGE" >/dev/null
    cat <<EOF

Setup complete. The app is running in container "$CONTAINER".

    docker logs -f $CONTAINER     # logs
    docker stop $CONTAINER        # stop
    docker start $CONTAINER       # start again

Open $URL
EOF
else
    START_CMD=".venv/bin/python run.py"
    [ "$tls" = 1 ] && START_CMD="$START_CMD --host 127.0.0.1"
    cat <<EOF

Setup complete. Start the server with:

    $START_CMD

Then open $URL
EOF
fi
