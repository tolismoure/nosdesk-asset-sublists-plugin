#!/usr/bin/env bash
# Sourced by install.sh. Commands stay in their original, fail-fast sequence.
HISTORY_PROGRESS_PID=''
HISTORY_PROGRESS_TOTAL=6
HISTORY_PROGRESS_STARTED=$SECONDS
HISTORY_PROGRESS_STAGE_STARTED=$SECONDS
HISTORY_PROGRESS_TOOL="$HISTORY_PACKAGE_DIR/tools/install_progress.py"

history_progress_stop() {
  if [[ -n "$HISTORY_PROGRESS_PID" ]]; then
    kill "$HISTORY_PROGRESS_PID" 2>/dev/null || true
    wait "$HISTORY_PROGRESS_PID" 2>/dev/null || true
    HISTORY_PROGRESS_PID=''
  fi
  return 0
}

history_progress_start() {
  local owner_pid="$BASHPID"
  history_progress_stop
  HISTORY_PROGRESS_STAGE_STARTED=$SECONDS
  "${HISTORY_PROGRESS_PYTHON:-python3}" "$HISTORY_PROGRESS_TOOL" \
    --completed "$1" --total "$HISTORY_PROGRESS_TOTAL" --label "$2" \
    --overall-elapsed "$((SECONDS - HISTORY_PROGRESS_STARTED))"
  # A status child must never run the installer's rollback or retain its lock.
  (
    trap - ERR INT TERM EXIT
    set +e
    exec 9>&-
    exec "${HISTORY_PROGRESS_PYTHON:-python3}" "$HISTORY_PROGRESS_TOOL" \
      --completed "$1" --total "$HISTORY_PROGRESS_TOTAL" --label "$2" \
      --overall-elapsed "$((SECONDS - HISTORY_PROGRESS_STARTED))" \
      --watch --parent "$owner_pid" --interval "${HISTORY_PROGRESS_INTERVAL:-10}"
  ) &
  HISTORY_PROGRESS_PID=$!
}

history_progress_complete() {
  history_progress_stop
  "${HISTORY_PROGRESS_PYTHON:-python3}" "$HISTORY_PROGRESS_TOOL" \
    --completed "$1" --total "$HISTORY_PROGRESS_TOTAL" --label "$2" --done \
    --elapsed "$((SECONDS - HISTORY_PROGRESS_STAGE_STARTED))" \
    --overall-elapsed "$((SECONDS - HISTORY_PROGRESS_STARTED))"
}
