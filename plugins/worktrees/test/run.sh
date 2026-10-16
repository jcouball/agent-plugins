#!/usr/bin/env bash
#
# Run both hook suites and fail if either does. Each suite builds its own
# throwaway repositories under its own temporary root and removes them again,
# so nothing here touches the repository it lives in.
#
# BIN points the suites at a different copy of the hooks:
#
#   BIN=/path/to/other/bin bash plugins/worktrees/test/run.sh

set -uo pipefail

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
status=0

for suite in create remove; do
  bash "$here/$suite.sh" || status=1
done

exit "$status"
